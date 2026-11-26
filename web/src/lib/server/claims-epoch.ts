import "server-only";
import { createWalletClient, encodeFunctionData, getAddress, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhoodChain } from "@/lib/chain";
import { USDG } from "@/lib/swap/encode";
import { rpc, serverEnv } from "./env";
import { buildTree, verify, type Entry } from "./merkle";

/**
 * The daily claims epoch on VeulClaimsV3, run by POST /api/internal/claims-epoch (the VPS cron, once a night).
 *
 * 1. Each wallet's leaf = every payback the ledger owes it, minus what earlier contracts (v1, v2) already paid it.
 *    Every earlier contract must be listed and paused, and what this job counts as paid there must equal what the
 *    contract says it paid in total, so nothing is paid twice.
 * 2. Before anything is posted, the new tree is checked against the one the contract holds (2026-11-26 reviews):
 *    - the contract's live root must be one this job stored (an unknown root means someone else posted: stop);
 *    - each wallet's amount must grow by exactly the paybacks recorded for it since the last root (by ledger row),
 *      so no wallet goes down and no increase lands on the wrong wallet;
 *    - the contract must hold enough USDG for what is still owed, counted per wallet from its onchain `claimed`.
 *    Then the contract's own limits (pause, interval, cap) are checked so a run says why it cannot post.
 * 3. The tree is stored in D1 and posted with the poster key. The first root on a contract, and any root over the
 *    poster's cap, are not sent: they are stored and returned as calldata for the owner to post (the owner's page).
 *
 * The poster key can only post roots. Even a wrong root can only pay out within the contract's payout budget.
 */

const claimsAbi = parseAbi([
  "function root() view returns (bytes32)",
  "function rootTotal() view returns (uint256)",
  "function totalClaimed() view returns (uint256)",
  "function epoch() view returns (uint256)",
  "function paused() view returns (bool)",
  "function poster() view returns (address)",
  "function maxIncrease() view returns (uint256)",
  "function minInterval() view returns (uint64)",
  "function lastPostedAt() view returns (uint64)",
  "function claimed(address) view returns (uint256)",
  "function setRoot(bytes32 newRoot, uint256 total)",
]);
const previousAbi = parseAbi(["function claimed(address) view returns (uint256)", "function paused() view returns (bool)", "function totalClaimed() view returns (uint256)"]);
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export type EpochRun = {
  status:
    | "posted"
    | "owner-must-post"
    | "nothing-new"
    | "too-soon"
    | "underfunded"
    | "paused"
    | "not-configured"
    | "dry-run"
    | "check-failed";
  message: string;
  wallets?: number;
  totalUsdg?: string;
  previousTotalUsdg?: string;
  root?: Hex;
  tx?: Hex;
  /** For "owner-must-post": the setRoot call for the owner's wallet to send to `to`. */
  ownerCall?: { to: Address; data: Hex };
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const usdg = (units: bigint) => (Number(units) / 1e6).toFixed(6);
const lower = (address: string) => address.toLowerCase();

type Ledger = { list: Entry[]; upToRow: number; owedByWallet: Map<string, bigint> };

/** Each wallet's cumulative on the live contract, from ledger rows up to one row read first (re-review C5). */
async function ledger(db: D1Database, paidBefore: Map<string, bigint>): Promise<Ledger> {
  const upToRow = (await db.prepare("SELECT COALESCE(MAX(rowid), 0) AS row FROM swaps").first<{ row: number }>())?.row ?? 0;
  const owed = await db
    .prepare("SELECT wallet, SUM(payback_usdg) AS cumulative FROM swaps WHERE rowid <= ? GROUP BY wallet")
    .bind(upToRow)
    .all<{ wallet: string; cumulative: number }>();
  const owedByWallet = new Map(owed.results.map((row) => [lower(row.wallet), BigInt(row.cumulative)]));
  const list = [...owedByWallet]
    .map(([wallet, cumulative]) => {
      const left = cumulative - (paidBefore.get(wallet) ?? 0n);
      return { wallet: getAddress(wallet), cumulative: left > 0n ? left : 0n };
    })
    .filter((entry) => entry.cumulative > 0n);
  return { list, upToRow, owedByWallet };
}

/**
 * What earlier contracts paid each wallet. Every contract this job ever posted to (other than the live one) must be
 * listed and paused, and the per-wallet amounts must add up to each contract's own totalClaimed (re-review C6).
 */
async function paidOnEarlierContracts(db: D1Database, live: Address, listed: Address[]): Promise<{ paid: Map<string, bigint> } | { error: string }> {
  const known = await db.prepare("SELECT DISTINCT contract FROM claim_epochs WHERE contract IS NOT NULL").all<{ contract: string }>();
  const missing = known.results.map((row) => lower(row.contract)).filter((address) => address !== lower(live) && !listed.some((item) => lower(item) === address));
  if (missing.length) return { error: `CLAIMS_PREVIOUS is missing ${missing.join(", ")}.` };
  const untagged = await db.prepare("SELECT COUNT(*) AS n FROM claim_epochs WHERE contract IS NULL").first<{ n: number }>();
  if ((untagged?.n ?? 0) > 0) return { error: "Some claim epochs have no contract recorded; tag them before posting." };

  const client = await rpc();
  const paid = new Map<string, bigint>();
  for (const contract of listed) {
    const [paused, total] = await Promise.all([
      client.readContract({ address: contract, abi: previousAbi, functionName: "paused" }),
      client.readContract({ address: contract, abi: previousAbi, functionName: "totalClaimed" }),
    ]);
    if (!paused) return { error: `Earlier contract ${contract} is not paused; pause it first.` };
    const wallets = await db
      .prepare("SELECT DISTINCT l.wallet AS wallet FROM claim_leaves l JOIN claim_epochs e ON e.epoch = l.epoch WHERE e.contract = ?")
      .bind(lower(contract))
      .all<{ wallet: string }>();
    let counted = 0n;
    for (const { wallet } of wallets.results) {
      const claimed = await client.readContract({ address: contract, abi: previousAbi, functionName: "claimed", args: [getAddress(wallet)] });
      counted += claimed;
      paid.set(lower(wallet), (paid.get(lower(wallet)) ?? 0n) + claimed);
    }
    if (counted !== total) return { error: `Earlier contract ${contract} paid ${usdg(total)} USDG but its stored trees account for ${usdg(counted)}.` };
  }
  return { paid };
}

export async function runClaimsEpoch({ dryRun = false, first = false } = {}): Promise<EpochRun> {
  const env = await serverEnv();
  const db = env.LEDGER;
  const contract = env.CLAIMS_ADDRESS && ADDRESS.test(env.CLAIMS_ADDRESS) ? getAddress(env.CLAIMS_ADDRESS) : null;
  const previousRaw = (env.CLAIMS_PREVIOUS ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  if (!db || !contract) return { status: "not-configured", message: "LEDGER or CLAIMS_ADDRESS is not set." };
  if (!previousRaw.every((address) => ADDRESS.test(address))) return { status: "not-configured", message: "CLAIMS_PREVIOUS has an invalid address." };

  const earlier = await paidOnEarlierContracts(db, contract, previousRaw.map((address) => getAddress(address)));
  if ("error" in earlier) return { status: "check-failed", message: earlier.error };
  const { list, upToRow } = await ledger(db, earlier.paid);
  if (list.length === 0) return { status: "nothing-new", message: "No paybacks owed yet." };
  const { root, leaves } = buildTree(list);
  // Every proof is checked with the contract's rule before anything is stored or sent.
  if (!leaves.every((leaf) => verify(leaf.proof, root, leaf.wallet, leaf.cumulative))) throw new Error("A proof does not verify; nothing posted");
  const total = leaves.reduce((sum, leaf) => sum + leaf.cumulative, 0n);

  const client = await rpc();
  const read = <T>(functionName: string, args?: readonly unknown[]) => client.readContract({ address: contract, abi: claimsAbi, functionName, args } as never) as Promise<T>;
  const [liveRoot, rootTotal, epoch, paused, poster, maxIncrease, minInterval, lastPostedAt, balance] = await Promise.all([
    read<Hex>("root"),
    read<bigint>("rootTotal"),
    read<bigint>("epoch"),
    read<boolean>("paused"),
    read<Address>("poster"),
    read<bigint>("maxIncrease"),
    read<bigint>("minInterval"),
    read<bigint>("lastPostedAt"),
    client.readContract({ address: USDG, abi: erc20Abi, functionName: "balanceOf", args: [contract] }),
  ]);
  const base = { wallets: leaves.length, totalUsdg: usdg(total), previousTotalUsdg: usdg(rootTotal), root };

  // ---- Checks against the live tree --------------------------------------------------------------------------
  if (epoch === 0n) {
    // The first root on a contract has nothing to compare with: only on an explicit request, and the owner posts it.
    if (!first) return { ...base, status: "check-failed", message: "No root on this contract yet. The first one is posted by the owner (?first=1)." };
  } else {
    const last = await db
      .prepare("SELECT epoch, total_usdg AS total, up_to_row AS row FROM claim_epochs WHERE contract = ? AND root = ? ORDER BY epoch DESC LIMIT 1")
      .bind(lower(contract), lower(liveRoot))
      .first<{ epoch: number; total: number; row: number | null }>();
    if (!last) return { ...base, status: "check-failed", message: `The contract's live root ${liveRoot} is not one this job stored. Pause the contract and check.` };
    if (BigInt(last.total) !== rootTotal) return { ...base, status: "check-failed", message: "The live root's total does not match what this job stored." };
    if (last.row == null) return { ...base, status: "check-failed", message: "The live root has no ledger row recorded; it cannot be compared." };

    // Per wallet: new amount = old amount + paybacks recorded for it since the last root (re-review C9).
    const oldLeaves = await db.prepare("SELECT wallet, cumulative_usdg AS cumulative FROM claim_leaves WHERE epoch = ?").bind(last.epoch).all<{ wallet: string; cumulative: number }>();
    const added = await db
      .prepare("SELECT wallet, SUM(payback_usdg) AS added FROM swaps WHERE rowid > ? AND rowid <= ? GROUP BY wallet")
      .bind(last.row, upToRow)
      .all<{ wallet: string; added: number }>();
    const before = new Map(oldLeaves.results.map((row) => [lower(row.wallet), BigInt(row.cumulative)]));
    const growth = new Map(added.results.map((row) => [lower(row.wallet), BigInt(row.added)]));
    const fresh = new Map(leaves.map((leaf) => [lower(leaf.wallet), leaf.cumulative]));
    for (const wallet of new Set([...before.keys(), ...fresh.keys(), ...growth.keys()])) {
      const expected = (before.get(wallet) ?? 0n) + (growth.get(wallet) ?? 0n);
      const actual = fresh.get(wallet) ?? 0n;
      if (actual !== expected) {
        return { ...base, status: "check-failed", message: `Wallet ${wallet} would be ${usdg(actual)} USDG, expected ${usdg(expected)}. Nothing posted; check the ledger.` };
      }
    }
  }
  if (epoch > 0n && total === rootTotal) return { ...base, status: "nothing-new", message: "No new paybacks since the last root." };

  // ---- Funding: what is still owed, per wallet, against the contract's balance (re-review C1) ------------------
  let outstanding = 0n;
  for (const leaf of leaves) {
    const claimed = await read<bigint>("claimed", [leaf.wallet]);
    if (leaf.cumulative > claimed) outstanding += leaf.cumulative - claimed;
  }
  if (balance < outstanding) {
    return { ...base, status: "underfunded", message: `Still owed ${usdg(outstanding)} USDG but the contract holds ${usdg(balance)}. Fund it, and the next run posts.` };
  }

  // ---- The contract's own limits -----------------------------------------------------------------------------
  if (paused) return { ...base, status: "paused", message: "The contract is paused; the poster may not post." };
  const now = BigInt(Math.floor(Date.now() / 1000));
  const ownerPosts = epoch === 0n || total - rootTotal > maxIncrease;
  if (!ownerPosts && lastPostedAt > 0n && now < lastPostedAt + minInterval) {
    return { ...base, status: "too-soon", message: `Next root allowed at ${new Date(Number(lastPostedAt + minInterval) * 1000).toISOString()}.` };
  }
  if (dryRun) return { ...base, status: "dry-run", message: ownerPosts ? "Would store this root for the owner to post." : "Would post this root now." };

  // Stored first, so the app can serve proofs the moment the root lands. A root that never lands is harmless: the
  // app looks leaves up by the root the contract holds.
  const nextId = ((await db.prepare("SELECT MAX(epoch) AS id FROM claim_epochs").first<{ id: number | null }>())?.id ?? 0) + 1;
  const upToBlock = (await db.prepare("SELECT MAX(block_number) AS block FROM swaps WHERE rowid <= ?").bind(upToRow).first<{ block: number | null }>())?.block ?? 0;
  await db.batch([
    db
      .prepare("INSERT INTO claim_epochs (epoch, root, total_usdg, up_to_block, up_to_row, created_at, contract, contract_epoch) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(nextId, lower(root), Number(total), upToBlock, upToRow, Number(now), lower(contract), Number(epoch) + 1),
    ...leaves.map((leaf) =>
      db.prepare("INSERT INTO claim_leaves (epoch, wallet, cumulative_usdg, proof) VALUES (?, ?, ?, ?)").bind(nextId, lower(leaf.wallet), Number(leaf.cumulative), JSON.stringify(leaf.proof)),
    ),
  ]);

  // The first root and any root over the poster's cap go to the owner (re-review C7): stored, not sent.
  if (ownerPosts) {
    const data = encodeFunctionData({ abi: claimsAbi, functionName: "setRoot", args: [root, total] });
    const why = epoch === 0n ? "This is the contract's first root." : `The total grew by ${usdg(total - rootTotal)} USDG, over the poster's cap of ${usdg(maxIncrease)}.`;
    return { ...base, status: "owner-must-post", message: `${why} Stored; the owner sends this setRoot from the owner wallet.`, ownerCall: { to: contract, data } };
  }

  if (!env.CLAIMS_POSTER_KEY) return { ...base, status: "not-configured", message: "CLAIMS_POSTER_KEY is not set." };
  const account = privateKeyToAccount(env.CLAIMS_POSTER_KEY as Hex);
  if (lower(account.address) !== lower(poster)) return { ...base, status: "not-configured", message: `This key (${account.address}) is not the contract's poster.` };
  const wallet = createWalletClient({ account, chain: robinhoodChain, transport: http(env.ALCHEMY_RPC_URL) });
  const tx = await wallet.writeContract({ address: contract, abi: claimsAbi, functionName: "setRoot", args: [root, total] });
  const receipt = await client.waitForTransactionReceipt({ hash: tx, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error(`setRoot failed onchain: ${tx}`);
  await db.prepare("UPDATE claim_epochs SET posted_tx = ? WHERE epoch = ?").bind(tx, nextId).run();
  return { ...base, status: "posted", message: `Posted epoch ${Number(epoch) + 1}.`, tx };
}
