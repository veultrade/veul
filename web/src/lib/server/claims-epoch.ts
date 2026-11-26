import "server-only";
import { createWalletClient, getAddress, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhoodChain } from "@/lib/chain";
import { USDG } from "@/lib/swap/encode";
import { rpc, serverEnv } from "./env";
import { buildTree, verify, type Entry } from "./merkle";

/**
 * The daily claims epoch on VeulClaimsV2, run by POST /api/internal/claims-epoch (the VPS cron, once a day).
 *
 * 1. Each wallet's leaf = every payback the ledger owes it, minus what it already took out of the first (v1)
 *    contract. v1 is paused, so that part never changes; only wallets in v1's trees are checked.
 * 2. If the total grew, the tree is stored in D1 and posted with the poster key. The contract enforces the
 *    poster's limits (cap per root, one root per interval, enough USDG); this code checks them first so a run
 *    that cannot succeed says why instead of sending a failing transaction.
 *
 * The poster key can only post roots. Funding the contract and every other power stay with the owner's wallet.
 */

const v2Abi = parseAbi([
  "function rootTotal() view returns (uint256)",
  "function totalClaimed() view returns (uint256)",
  "function epoch() view returns (uint256)",
  "function paused() view returns (bool)",
  "function poster() view returns (address)",
  "function maxIncrease() view returns (uint256)",
  "function minInterval() view returns (uint64)",
  "function lastPostedAt() view returns (uint64)",
  "function setRoot(bytes32 newRoot, uint256 total)",
]);
const v1Abi = parseAbi(["function claimed(address) view returns (uint256)"]);
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export type EpochRun = {
  status: "posted" | "nothing-new" | "too-soon" | "over-cap" | "underfunded" | "paused" | "not-configured" | "dry-run";
  message: string;
  wallets?: number;
  totalUsdg?: string;
  previousTotalUsdg?: string;
  root?: Hex;
  tx?: Hex;
};

const usdg = (units: bigint) => (Number(units) / 1e6).toFixed(6);

/** Every wallet's cumulative payback on v2: the ledger's total minus what v1 already paid it. */
async function entries(db: D1Database, v1: Address | null): Promise<Entry[]> {
  const owed = await db.prepare("SELECT wallet, SUM(payback_usdg) AS cumulative FROM swaps GROUP BY wallet").all<{ wallet: string; cumulative: number }>();
  const paidOnV1 = new Map<string, bigint>();
  if (v1) {
    // Only wallets that were ever in a v1 tree can have claimed there.
    const v1Wallets = await db
      .prepare("SELECT DISTINCT l.wallet AS wallet FROM claim_leaves l JOIN claim_epochs e ON e.epoch = l.epoch WHERE e.contract = ?")
      .bind(v1.toLowerCase())
      .all<{ wallet: string }>();
    const client = await rpc();
    await Promise.all(
      v1Wallets.results.map(async ({ wallet }) => {
        const claimed = await client.readContract({ address: v1, abi: v1Abi, functionName: "claimed", args: [getAddress(wallet)] });
        paidOnV1.set(wallet.toLowerCase(), claimed);
      }),
    );
  }
  return owed.results
    .map(({ wallet, cumulative }) => {
      const left = BigInt(cumulative) - (paidOnV1.get(wallet.toLowerCase()) ?? 0n);
      return { wallet: getAddress(wallet), cumulative: left > 0n ? left : 0n };
    })
    .filter((entry) => entry.cumulative > 0n);
}

export async function runClaimsEpoch({ dryRun = false } = {}): Promise<EpochRun> {
  const env = await serverEnv();
  const db = env.LEDGER;
  const contract = env.CLAIMS_ADDRESS && /^0x[0-9a-fA-F]{40}$/.test(env.CLAIMS_ADDRESS) ? getAddress(env.CLAIMS_ADDRESS) : null;
  const v1 = env.CLAIMS_V1_ADDRESS && /^0x[0-9a-fA-F]{40}$/.test(env.CLAIMS_V1_ADDRESS) ? getAddress(env.CLAIMS_V1_ADDRESS) : null;
  if (!db || !contract) return { status: "not-configured", message: "LEDGER or CLAIMS_ADDRESS is not set." };

  const list = await entries(db, v1);
  if (list.length === 0) return { status: "nothing-new", message: "No paybacks owed yet." };
  const { root, leaves } = buildTree(list);
  // Every proof is checked with the contract's rule before anything is stored or sent.
  if (!leaves.every((leaf) => verify(leaf.proof, root, leaf.wallet, leaf.cumulative))) throw new Error("A proof does not verify; nothing posted");
  const total = leaves.reduce((sum, leaf) => sum + leaf.cumulative, 0n);

  const client = await rpc();
  const read = <T>(functionName: string) => client.readContract({ address: contract, abi: v2Abi, functionName } as never) as Promise<T>;
  const [rootTotal, totalClaimed, epoch, paused, poster, maxIncrease, minInterval, lastPostedAt, balance] = await Promise.all([
    read<bigint>("rootTotal"),
    read<bigint>("totalClaimed"),
    read<bigint>("epoch"),
    read<boolean>("paused"),
    read<Address>("poster"),
    read<bigint>("maxIncrease"),
    read<bigint>("minInterval"),
    read<bigint>("lastPostedAt"),
    client.readContract({ address: USDG, abi: erc20Abi, functionName: "balanceOf", args: [contract] }),
  ]);
  const base = { wallets: leaves.length, totalUsdg: usdg(total), previousTotalUsdg: usdg(rootTotal), root };

  if (total <= rootTotal) return { ...base, status: "nothing-new", message: "No new paybacks since the last root." };
  if (paused) return { ...base, status: "paused", message: "The contract is paused; the poster may not post." };
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (lastPostedAt > 0n && now < lastPostedAt + minInterval) {
    return { ...base, status: "too-soon", message: `Next root allowed at ${new Date(Number(lastPostedAt + minInterval) * 1000).toISOString()}.` };
  }
  if (total - rootTotal > maxIncrease) {
    return { ...base, status: "over-cap", message: `The total grew by ${usdg(total - rootTotal)} USDG, over the poster's cap of ${usdg(maxIncrease)}. The owner must post this one.` };
  }
  if (balance + totalClaimed < total) {
    return { ...base, status: "underfunded", message: `The contract needs ${usdg(total - balance - totalClaimed)} more USDG. Fund it, and the next run posts.` };
  }
  if (dryRun) return { ...base, status: "dry-run", message: "Would post this root now." };

  if (!env.CLAIMS_POSTER_KEY) return { ...base, status: "not-configured", message: "CLAIMS_POSTER_KEY is not set." };
  const account = privateKeyToAccount(env.CLAIMS_POSTER_KEY as Hex);
  if (account.address.toLowerCase() !== poster.toLowerCase()) {
    return { ...base, status: "not-configured", message: `This key (${account.address}) is not the contract's poster.` };
  }

  // Stored first, so the app can serve proofs the moment the root lands. A root that never lands is harmless: the
  // app looks leaves up by the root the contract holds.
  const nextId = ((await db.prepare("SELECT MAX(epoch) AS id FROM claim_epochs").first<{ id: number | null }>())?.id ?? 0) + 1;
  const upToBlock = (await db.prepare("SELECT MAX(block_number) AS block FROM swaps").first<{ block: number | null }>())?.block ?? 0;
  await db.batch([
    db
      .prepare("INSERT INTO claim_epochs (epoch, root, total_usdg, up_to_block, created_at, contract, contract_epoch) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(nextId, root.toLowerCase(), Number(total), upToBlock, Number(now), contract.toLowerCase(), Number(epoch) + 1),
    ...leaves.map((leaf) =>
      db
        .prepare("INSERT INTO claim_leaves (epoch, wallet, cumulative_usdg, proof) VALUES (?, ?, ?, ?)")
        .bind(nextId, leaf.wallet.toLowerCase(), Number(leaf.cumulative), JSON.stringify(leaf.proof)),
    ),
  ]);

  const wallet = createWalletClient({ account, chain: robinhoodChain, transport: http(env.ALCHEMY_RPC_URL) });
  const tx = await wallet.writeContract({ address: contract, abi: v2Abi, functionName: "setRoot", args: [root, total] });
  const receipt = await client.waitForTransactionReceipt({ hash: tx, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error(`setRoot failed onchain: ${tx}`);
  await db.prepare("UPDATE claim_epochs SET posted_tx = ? WHERE epoch = ?").bind(tx, nextId).run();
  return { ...base, status: "posted", message: `Posted epoch ${Number(epoch) + 1}.`, tx };
}
