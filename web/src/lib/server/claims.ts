import "server-only";
import { encodeFunctionData, formatUnits, getAddress, parseAbi, parseUnits, type Address, type Hex } from "viem";
import allowlist from "@/data/stock-allowlist.json";
import type { MarketPool } from "@/lib/market";
import { PAYBACK_TICKERS } from "@/lib/tokens";
import { USDG, buildClaimSwap, executeCalldata, type Hop } from "@/lib/swap/encode";
import { rpc, serverEnv } from "./env";
import { legFor, quoteLeg } from "./quote";

/**
 * Weekly payback claims (session 1.6). The VeulClaims contract (contracts/src/VeulClaims.sol) holds the USDG and
 * the current Merkle root; D1 holds each epoch's leaves and proofs (written by scripts/claims-epoch.mjs). A wallet
 * claims its cumulative amount minus what it already claimed, swapped into the stock it picked.
 */

const USDG_DECIMALS = 6;
/** Below this the swap would cost more in gas and price than it is worth; the payback just waits (1 USDG). */
export const MIN_CLAIM_USDG = 1_000_000n;

const claimsAbi = parseAbi([
  "function root() view returns (bytes32)",
  "function epoch() view returns (uint256)",
  "function paused() view returns (bool)",
  "function claimed(address) view returns (uint256)",
  "function claimAndSwap(uint256 cumulative, bytes32[] proof, bytes routerCalldata, address outToken, uint256 minOut) returns (uint256, uint256)",
]);

type Listed = { symbol: string; address: string; pool?: MarketPool | null };
const STOCKS = (allowlist.tokens as Listed[]).filter((t) => t.pool && (PAYBACK_TICKERS as readonly string[]).includes(t.symbol));

export type ClaimStatus = {
  open: boolean;
  /** Why claiming is not possible right now (contract not live, paused, nothing owed, below the minimum). */
  reason: string | null;
  contract: Address | null;
  epoch: number;
  cumulativeUsdg: string;
  claimedUsdg: string;
  claimableUsdg: string;
  minUsdg: string;
};

async function claimsAddress(): Promise<Address | null> {
  const { CLAIMS_ADDRESS } = await serverEnv();
  return CLAIMS_ADDRESS && /^0x[0-9a-fA-F]{40}$/.test(CLAIMS_ADDRESS) ? getAddress(CLAIMS_ADDRESS) : null;
}

/** The wallet's leaf in the tree the contract currently uses (null if it has none). */
async function leafFor(wallet: Address, root: Hex): Promise<{ cumulative: bigint; proof: Hex[] } | null> {
  const { LEDGER } = await serverEnv();
  if (!LEDGER) throw new Error("Ledger database is not configured");
  const row = await LEDGER.prepare(
    "SELECT l.cumulative_usdg AS cumulative, l.proof AS proof FROM claim_leaves l JOIN claim_epochs e ON e.epoch = l.epoch WHERE e.root = ? AND l.wallet = ?",
  )
    .bind(root.toLowerCase(), wallet.toLowerCase())
    .first<{ cumulative: number; proof: string }>();
  return row ? { cumulative: BigInt(row.cumulative), proof: JSON.parse(row.proof) as Hex[] } : null;
}

export async function claimStatus(wallet: Address): Promise<ClaimStatus & { proof: Hex[] }> {
  const contract = await claimsAddress();
  const empty = { contract, epoch: 0, cumulativeUsdg: "0", claimedUsdg: "0", claimableUsdg: "0", minUsdg: formatUnits(MIN_CLAIM_USDG, USDG_DECIMALS), proof: [] };
  if (!contract) return { ...empty, open: false, reason: "Claims open once the claims contract is live." };

  const client = await rpc();
  const read = <T>(functionName: "root" | "epoch" | "paused" | "claimed", args?: readonly [Address]) =>
    client.readContract({ address: contract, abi: claimsAbi, functionName, args } as never) as Promise<T>;
  const [root, epoch, paused, claimed] = await Promise.all([read<Hex>("root"), read<bigint>("epoch"), read<boolean>("paused"), read<bigint>("claimed", [wallet])]);

  const leaf = epoch > 0n ? await leafFor(wallet, root) : null;
  const cumulative = leaf?.cumulative ?? 0n;
  const claimable = cumulative > claimed ? cumulative - claimed : 0n;
  const reason = paused
    ? "Claims are paused for a moment."
    : epoch === 0n
      ? "The first weekly payout has not been posted yet."
      : claimable === 0n
        ? "Nothing to claim yet. New paybacks are added every Monday."
        : claimable < MIN_CLAIM_USDG
          ? `Claims open at ${formatUnits(MIN_CLAIM_USDG, USDG_DECIMALS)} USDG; your payback keeps adding up until then.`
          : null;

  return {
    open: reason === null,
    reason,
    contract,
    epoch: Number(epoch),
    cumulativeUsdg: formatUnits(cumulative, USDG_DECIMALS),
    claimedUsdg: formatUnits(claimed, USDG_DECIMALS),
    claimableUsdg: formatUnits(claimable, USDG_DECIMALS),
    minUsdg: formatUnits(MIN_CLAIM_USDG, USDG_DECIMALS),
    proof: leaf?.proof ?? [],
  };
}

function stockFor(ticker: string) {
  const stock = STOCKS.find((s) => s.symbol === ticker);
  if (!stock?.pool) throw new Error(`${ticker} cannot be paid out yet`);
  return { address: getAddress(stock.address), pool: stock.pool };
}

async function hopFor(stock: { address: Address; pool: MarketPool }): Promise<Hop> {
  const leg = await legFor(stock.pool, stock.address);
  return leg.kind === "v3" ? { version: "v3", fee: leg.fee } : { version: "v4", key: leg.key };
}

/** How much of the stock the claimable USDG buys right now. */
export async function claimQuote(amountUsdg: bigint, ticker: string) {
  const stock = stockFor(ticker);
  const leg = await legFor(stock.pool, stock.address);
  const out = await quoteLeg(leg, USDG, stock.address, amountUsdg);
  return { stock: stock.address, amountOut: out };
}

/**
 * The claim transaction for the wallet to sign: claimAndSwap with the router calldata, simulated from the wallet.
 * `minOut` keeps `slippageBps` off the live quote (the contract also checks it onchain).
 */
export async function buildClaim(wallet: Address, ticker: string, slippageBps: number) {
  const status = await claimStatus(wallet);
  if (!status.open || !status.contract) throw new Error(status.reason ?? "Nothing to claim");
  const claimable = parseUnits(status.claimableUsdg, USDG_DECIMALS);
  const stock = stockFor(ticker);
  const [hop, quoted] = await Promise.all([hopFor(stock), claimQuote(claimable, ticker)]);
  const minOut = (quoted.amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
  const routerCalldata = executeCalldata(buildClaimSwap({ token: stock.address, hop }, minOut, wallet), BigInt(Math.floor(Date.now() / 1000) + 600));

  const data = encodeFunctionData({
    abi: claimsAbi,
    functionName: "claimAndSwap",
    args: [parseUnits(status.cumulativeUsdg, USDG_DECIMALS), status.proof, routerCalldata, stock.address, minOut],
  });
  const tx = { to: status.contract, data };

  const client = await rpc();
  try {
    await client.call({ account: wallet, ...tx });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(/OutputTooLow|TooLittleReceived/i.test(message) ? "The price moved; try again." : "This claim would fail onchain right now.");
  }
  const gas = await client.estimateGas({ account: wallet, ...tx }).catch(() => 700_000n);
  return {
    tx: { to: tx.to, data: tx.data, value: "0x0", gas: `0x${((gas * 12n) / 10n).toString(16)}` },
    claimableUsdg: status.claimableUsdg,
    stock: ticker,
    amountOut: quoted.amountOut.toString(),
    minOut: minOut.toString(),
  };
}
