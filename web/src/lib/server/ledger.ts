import "server-only";
import { decodeAbiParameters, decodeFunctionData, erc20Abi, formatUnits, getAddress, parseAbi, type Address, type Hex } from "viem";
import { NATIVE, UNIVERSAL_ROUTER, USDG, WETH } from "@/lib/swap/encode";
import { UNISWAP, USDG_DECIMALS, WETH_USDG_V3, quoterV2Abi } from "@/lib/uniswap";
import { PAYBACK_RATE } from "@/lib/tokens";
import type { LedgerEntry } from "@/lib/ledger";
import { rpc, serverEnv } from "./env";
import { ethPriceUsd } from "./quote";

/**
 * Ledger (session 1.5): a swap counts only after the server has checked it onchain.
 * A transaction is a Stockup swap when it called our Universal Router with our fee step in it
 * (TRANSFER of ETH to the fee wallet before a buy, PAY_PORTION of ETH to it after a sell)
 * and the fee wallet really received ETH in that transaction. Nothing the app sends is trusted
 * except the transaction hash.
 *
 * Why a hand-made router call cannot farm paybacks: the payback (0.25%) is always half of the fee that
 * was really paid (0.5%), because the trade size is derived from the fee received, never the other way round.
 */

/** Raised when the transaction is not (yet) something we can record; `pending` means "try again shortly". */
export class LedgerError extends Error {
  constructor(
    message: string,
    readonly pending = false,
  ) {
    super(message);
  }
}

const CMD_TRANSFER = 0x05;
const CMD_PAY_PORTION = 0x06;
const FEE_BIPS = 50n;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const executeAbi = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
const threeArgs = [{ type: "address" }, { type: "address" }, { type: "uint256" }] as const;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const topicAddress = (topic: Hex | undefined) => (topic ? (`0x${topic.slice(26)}` as Address) : null);

async function ledgerDb(): Promise<D1Database> {
  const { LEDGER } = await serverEnv();
  if (!LEDGER) throw new Error("Ledger database is not configured");
  return LEDGER;
}

async function feeWallet(): Promise<Address> {
  const { FEE_WALLET } = await serverEnv();
  if (!FEE_WALLET || !/^0x[0-9a-fA-F]{40}$/.test(FEE_WALLET)) throw new Error("Fee wallet is not configured");
  return getAddress(FEE_WALLET);
}

type AssetTransfer = { hash: string; blockNum: string; rawContract: { value: string | null } };

/**
 * Internal ETH transfers to an address, from Alchemy's transfer index (the free tier has no tx tracing).
 * This is the only way to see the router's ETH payment to the fee wallet: plain ETH transfers emit no log.
 */
async function internalTransfersTo(to: Address, fromBlock: bigint, toBlock: bigint | "latest", pageKey?: string) {
  const { ALCHEMY_RPC_URL } = await serverEnv();
  if (!ALCHEMY_RPC_URL) throw new Error("ALCHEMY_RPC_URL is not set");
  const params: Record<string, unknown> = {
    toAddress: to,
    category: ["internal"],
    fromBlock: `0x${fromBlock.toString(16)}`,
    toBlock: toBlock === "latest" ? "latest" : `0x${toBlock.toString(16)}`,
    excludeZeroValue: true,
    maxCount: "0x3e8",
  };
  if (pageKey) params.pageKey = pageKey;
  const response = await fetch(ALCHEMY_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "alchemy_getAssetTransfers", params: [params] }),
  });
  if (!response.ok) throw new Error(`HTTP request failed. Status: ${response.status}`);
  const body = (await response.json()) as { result?: { transfers: AssetTransfer[]; pageKey?: string }; error?: { message: string } };
  if (body.error || !body.result) throw new Error(`Transfer index: ${body.error?.message ?? "no result"}`);
  return body.result;
}

/** ETH price in USD at a past block, from the same ETH/USDG pool the app quotes against. */
async function ethPriceAt(blockNumber: bigint): Promise<number> {
  try {
    const { result } = await (await rpc()).simulateContract({
      address: UNISWAP.v3QuoterV2,
      abi: quoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn: WETH, tokenOut: USDG, amountIn: 10n ** 18n, fee: WETH_USDG_V3.fee, sqrtPriceLimitX96: 0n }],
      blockNumber,
    });
    return Number(formatUnits(result[0], USDG_DECIMALS));
  } catch {
    // Old state can be unavailable on the node; the price a few minutes later is close enough for a fallback.
    return ethPriceUsd();
  }
}

/** Which fee step the router call contains, if any. */
function feeStep(input: Hex, fee: Address): "buy" | "sell" | null {
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: executeAbi, data: input });
  } catch {
    return null;
  }
  const [commands, inputs] = decoded.args;
  const cmds = commands.slice(2).match(/../g)?.map((byte) => parseInt(byte, 16) & 0x3f) ?? [];
  for (let i = 0; i < cmds.length; i++) {
    if (cmds[i] !== CMD_TRANSFER && cmds[i] !== CMD_PAY_PORTION) continue;
    const [token, recipient, value] = decodeAbiParameters(threeArgs, inputs[i]);
    if (!same(token, NATIVE) || !same(recipient, fee)) continue;
    if (cmds[i] === CMD_TRANSFER) return "buy";
    if (value === FEE_BIPS) return "sell";
  }
  return null;
}

/** Checks a transaction onchain and returns the ledger row it earns. Throws LedgerError when it does not qualify. */
export async function verifySwap(hash: Hex): Promise<LedgerEntry> {
  const client = await rpc();
  const fee = await feeWallet();
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash }).catch(() => null),
    client.getTransactionReceipt({ hash }).catch(() => null),
  ]);
  if (!tx) throw new LedgerError("Transaction not found yet.", true);
  if (!receipt) throw new LedgerError("Transaction is not confirmed yet.", true);
  if (receipt.status !== "success") throw new LedgerError("The transaction failed onchain, so no fee was paid.");
  if (!tx.to || !same(tx.to, UNIVERSAL_ROUTER)) throw new LedgerError("Not a swap through the Stockup router call.");

  const side = feeStep(tx.input, fee);
  if (!side) throw new LedgerError("This swap did not pay the Stockup fee.");

  // The fee actually received in this transaction (exact wei, from the transfer index).
  const { transfers } = await internalTransfersTo(fee, receipt.blockNumber, receipt.blockNumber);
  const feeWei = transfers.filter((t) => same(t.hash, hash)).reduce((sum, t) => sum + BigInt(t.rawContract.value ?? "0x0"), 0n);
  // The index can trail the chain by a few seconds.
  if (feeWei === 0n) throw new LedgerError("Waiting for the fee transfer to be indexed.", true);

  // Trade size before the fee. Buy: the ETH sent with the call. Sell: the fee is exactly 0.5% of the ETH out.
  const ethWei = side === "buy" ? tx.value : (feeWei * 10_000n) / FEE_BIPS;
  if (side === "buy" && feeWei !== (tx.value * FEE_BIPS) / 10_000n) throw new LedgerError("The fee paid does not match the trade size.");

  // The traded token: what reached the trader (buy) or left the trader (sell), from ERC-20 Transfer logs.
  const trader = tx.from;
  const moves = receipt.logs.filter((log) => {
    if (log.topics[0] !== TRANSFER_TOPIC || log.topics.length !== 3) return false;
    const party = topicAddress(side === "buy" ? log.topics[2] : log.topics[1]);
    return party !== null && same(party, trader) && !same(log.address, WETH);
  });
  const tokens = [...new Set(moves.map((log) => log.address.toLowerCase()))];
  if (tokens.length !== 1) throw new LedgerError("Could not tell which token was traded.");
  const token = getAddress(tokens[0]);
  const tokenAmount = moves.reduce((sum, log) => sum + BigInt(log.data), 0n);

  const [decimals, symbol, block, ethUsd] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
    client.getBlock({ blockNumber: receipt.blockNumber }),
    ethPriceAt(receipt.blockNumber),
  ]);
  const usd = Number(formatUnits(ethWei, 18)) * ethUsd;

  return {
    txHash: hash.toLowerCase(),
    wallet: trader.toLowerCase(),
    side,
    token: token.toLowerCase(),
    tokenSymbol: symbol ? String(symbol).slice(0, 32) : null,
    tokenDecimals: Number(decimals),
    tokenAmount: tokenAmount.toString(),
    ethWei: ethWei.toString(),
    feeWei: feeWei.toString(),
    ethUsd,
    usd,
    // USDG has 6 decimals; round down so we never owe more than 0.25%.
    paybackUsdg: Math.floor(usd * PAYBACK_RATE * 10 ** USDG_DECIMALS),
    paybackStatus: "owed",
    blockNumber: Number(receipt.blockNumber),
    blockTime: Number(block.timestamp),
  };
}

type Row = {
  tx_hash: string;
  wallet: string;
  side: "buy" | "sell";
  token: string;
  token_symbol: string | null;
  token_decimals: number;
  token_amount: string;
  eth_wei: string;
  fee_wei: string;
  eth_usd: number;
  usd: number;
  payback_usdg: number;
  payback_status: "owed" | "claimed";
  block_number: number;
  block_time: number;
};

const fromRow = (row: Row): LedgerEntry => ({
  txHash: row.tx_hash,
  wallet: row.wallet,
  side: row.side,
  token: row.token,
  tokenSymbol: row.token_symbol,
  tokenDecimals: row.token_decimals,
  tokenAmount: row.token_amount,
  ethWei: row.eth_wei,
  feeWei: row.fee_wei,
  ethUsd: row.eth_usd,
  usd: row.usd,
  paybackUsdg: row.payback_usdg,
  paybackStatus: row.payback_status,
  blockNumber: row.block_number,
  blockTime: row.block_time,
});

export async function findEntry(hash: string): Promise<LedgerEntry | null> {
  const row = await (await ledgerDb()).prepare("SELECT * FROM swaps WHERE tx_hash = ?").bind(hash.toLowerCase()).first<Row>();
  return row ? fromRow(row) : null;
}

/** Inserts a verified row; a second insert of the same transaction is ignored. */
export async function saveEntry(entry: LedgerEntry): Promise<void> {
  await (await ledgerDb())
    .prepare(
      `INSERT OR IGNORE INTO swaps (tx_hash, wallet, side, token, token_symbol, token_decimals, token_amount, eth_wei, fee_wei,
        eth_usd, usd, payback_usdg, payback_status, block_number, block_time, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      entry.txHash,
      entry.wallet,
      entry.side,
      entry.token,
      entry.tokenSymbol,
      entry.tokenDecimals,
      entry.tokenAmount,
      entry.ethWei,
      entry.feeWei,
      entry.ethUsd,
      entry.usd,
      entry.paybackUsdg,
      entry.paybackStatus,
      entry.blockNumber,
      entry.blockTime,
      Math.floor(Date.now() / 1000),
    )
    .run();
}

/** Verifies and stores a transaction, or returns the row already stored. */
export async function recordSwap(hash: Hex): Promise<{ entry: LedgerEntry; created: boolean }> {
  const existing = await findEntry(hash);
  if (existing) return { entry: existing, created: false };
  const entry = await verifySwap(hash);
  await saveEntry(entry);
  return { entry, created: true };
}

export async function walletLedger(wallet: Address, limit = 200) {
  const db = await ledgerDb();
  const account = wallet.toLowerCase();
  const [rows, totals] = await Promise.all([
    db.prepare("SELECT * FROM swaps WHERE wallet = ? ORDER BY block_time DESC LIMIT ?").bind(account, limit).all<Row>(),
    db
      .prepare(
        `SELECT COUNT(*) AS trades,
           COALESCE(SUM(usd), 0) AS volume_usd,
           COALESCE(SUM(CASE WHEN payback_status = 'owed' THEN payback_usdg END), 0) AS owed_usdg,
           COALESCE(SUM(CASE WHEN payback_status = 'claimed' THEN payback_usdg END), 0) AS claimed_usdg
         FROM swaps WHERE wallet = ?`,
      )
      .bind(account)
      .first<{ trades: number; volume_usd: number; owed_usdg: number; claimed_usdg: number }>(),
  ]);
  return {
    entries: rows.results.map(fromRow),
    totals: {
      trades: totals?.trades ?? 0,
      volumeUsd: totals?.volume_usd ?? 0,
      owedUsdg: totals?.owed_usdg ?? 0,
      claimedUsdg: totals?.claimed_usdg ?? 0,
    },
  };
}

/** The latest verified swaps of every wallet, for the public Activity feed (all of it is public onchain data). */
export async function recentLedger(limit = 50) {
  const db = await ledgerDb();
  const rows = await db.prepare("SELECT * FROM swaps ORDER BY block_time DESC LIMIT ?").bind(Math.min(Math.max(limit, 1), 100)).all<Row>();
  return { entries: rows.results.map(fromRow) };
}

const SCAN_KEY = "scan:fee-wallet:block";

/**
 * Catches swaps the app never reported (tab closed, network drop): scans the fee wallet's incoming
 * internal ETH transfers since the last scan and records every one that verifies.
 */
export async function reconcile() {
  const db = await ledgerDb();
  const fee = await feeWallet();
  const client = await rpc();
  const saved = await db.prepare("SELECT value FROM meta WHERE key = ?").bind(SCAN_KEY).first<{ value: string }>();
  const latest = await client.getBlockNumber();
  const from = saved ? BigInt(saved.value) + 1n : 0n;

  const hashes = new Set<string>();
  let pageKey: string | undefined;
  for (let page = 0; page < 5; page++) {
    const result = await internalTransfersTo(fee, from, latest, pageKey);
    for (const transfer of result.transfers) hashes.add(transfer.hash.toLowerCase());
    pageKey = result.pageKey;
    if (!pageKey) break;
  }

  const outcome = { scannedFrom: Number(from), scannedTo: Number(latest), found: hashes.size, recorded: 0, skipped: [] as { hash: string; reason: string }[] };
  let retryLater = false;
  for (const hash of hashes) {
    try {
      const { created } = await recordSwap(hash as Hex);
      if (created) outcome.recorded++;
    } catch (error) {
      if (error instanceof LedgerError && error.pending) retryLater = true;
      outcome.skipped.push({ hash, reason: error instanceof Error ? error.message.slice(0, 120) : "error" });
    }
  }
  // Only move the cursor when nothing needs another look; a later run rescans the same range otherwise.
  if (!retryLater && !pageKey) {
    await db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(SCAN_KEY, latest.toString()).run();
  }
  return outcome;
}
