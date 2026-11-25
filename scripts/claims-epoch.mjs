// Weekly claim epoch (session 1.6). Run every Monday:
//   node scripts/claims-epoch.mjs            dry run: shows the new root, totals and what the owner must do
//   node scripts/claims-epoch.mjs --write    also stores the epoch in D1 and writes the public JSON
//
// Reads every verified swap from the D1 ledger (remote), sums each wallet's payback into a cumulative amount,
// builds the Merkle tree (scripts/lib/merkle.mjs, same rules as contracts/src/VeulClaims.sol) and prints the
// owner's two steps: fund the contract with the missing USDG, then call setRoot(root, total). Claude prepares
// these; the owner signs them in their own wallet.
// Needs: wrangler logged in (D1 access). Optional: CLAIMS_ADDRESS (deployed contract) and RH_RPC_URL to read its
// balance and claimed total, so the funding amount is exact.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildTree, verify } from "./lib/merkle.mjs";

const web = new URL("../web/", import.meta.url);
const require = createRequire(new URL("package.json", web));
const { createPublicClient, http, encodeFunctionData, formatUnits } = require("viem");

const WRITE = process.argv.includes("--write");
const DB = "stockup-ledger";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";

function d1(sql) {
  // shell: true (npx on Windows) joins the arguments into one command line, so the SQL must be quoted as one word.
  if (sql.includes('"')) throw new Error("SQL must not contain double quotes");
  const out = execFileSync("npx", ["wrangler", "d1", "execute", DB, "--remote", "--json", "--command", `"${sql}"`], { cwd: web, encoding: "utf8", shell: true });
  return JSON.parse(out.slice(out.indexOf("[")))[0].results;
}

function d1File(path) {
  execFileSync("npx", ["wrangler", "d1", "execute", DB, "--remote", "--file", path], { cwd: web, stdio: "inherit", shell: true });
}

// 1. Cumulative payback per wallet (owed and already claimed both count: the contract pays the difference).
const rows = d1("SELECT wallet, SUM(payback_usdg) AS cumulative, MAX(block_number) AS last_block FROM swaps GROUP BY wallet ORDER BY wallet");
if (rows.length === 0) {
  console.log("No verified swaps yet: nothing to post.");
  process.exit(0);
}
const entries = rows.map((row) => ({ wallet: row.wallet, cumulative: BigInt(row.cumulative) }));
const total = entries.reduce((sum, entry) => sum + entry.cumulative, 0n);
const upToBlock = Math.max(...rows.map((row) => row.last_block));

// 2. Tree, checked leaf by leaf with the contract's own rule before anything is stored.
const { root, leaves } = buildTree(entries);
if (!leaves.every((leaf) => verify(leaf.proof, root, leaf.wallet, leaf.cumulative))) throw new Error("A proof does not verify; nothing stored");
const previous = d1("SELECT MAX(epoch) AS epoch, MAX(total_usdg) AS total FROM claim_epochs")[0];
const epoch = (previous?.epoch ?? 0) + 1;
if (previous?.total != null && total < BigInt(previous.total)) throw new Error("Total went down; the ledger lost rows?");

console.log(`Epoch ${epoch}: ${entries.length} wallets, cumulative total ${formatUnits(total, 6)} USDG, ledger up to block ${upToBlock}`);
console.log(`Root ${root}`);

// 3. What the owner must do. With the contract address, read what it already holds and has paid.
const claimsAddress = process.env.CLAIMS_ADDRESS;
let missing = total;
if (claimsAddress && process.env.RH_RPC_URL) {
  const client = createPublicClient({ transport: http(process.env.RH_RPC_URL) });
  const erc20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];
  const claimsAbi = [{ type: "function", name: "totalClaimed", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }];
  const [balance, claimed] = await Promise.all([
    client.readContract({ address: USDG, abi: erc20, functionName: "balanceOf", args: [claimsAddress] }),
    client.readContract({ address: claimsAddress, abi: claimsAbi, functionName: "totalClaimed" }),
  ]);
  missing = total > balance + claimed ? total - balance - claimed : 0n;
  console.log(`Contract holds ${formatUnits(balance, 6)} USDG, has paid ${formatUnits(claimed, 6)} USDG`);
}
const setRootData = encodeFunctionData({
  abi: [{ type: "function", name: "setRoot", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "uint256" }], outputs: [] }],
  functionName: "setRoot",
  args: [root, total],
});
console.log("\nOwner steps (sign in your own wallet):");
console.log(`  1. Send ${formatUnits(missing, 6)} USDG to the claims contract${claimsAddress ? ` ${claimsAddress}` : ""}${missing === 0n ? " (nothing to send)" : ""}`);
console.log(`  2. Call setRoot on the claims contract, data: ${setRootData}`);

if (!WRITE) {
  console.log("\nDry run: nothing stored. Run with --write to store the epoch and write the public JSON.");
  process.exit(0);
}

// 4. Store the epoch and its leaves in D1, and write the public file (published to the claims repo).
const tmp = new URL("../web/.wrangler/claims-epoch.sql", import.meta.url);
mkdirSync(new URL(".", tmp), { recursive: true });
const sql = [
  `INSERT INTO claim_epochs (epoch, root, total_usdg, up_to_block, created_at) VALUES (${epoch}, '${root}', ${total}, ${upToBlock}, ${Math.floor(Date.now() / 1000)});`,
  ...leaves.map((leaf) => `INSERT INTO claim_leaves (epoch, wallet, cumulative_usdg, proof) VALUES (${epoch}, '${leaf.wallet}', ${leaf.cumulative}, '${JSON.stringify(leaf.proof)}');`),
].join("\n");
writeFileSync(tmp, sql);
d1File(tmp.pathname.replace(/^\/([A-Za-z]:)/, "$1"));

const publicDir = new URL("../claims/epochs/", import.meta.url);
mkdirSync(publicDir, { recursive: true });
const file = new URL(`epoch-${String(epoch).padStart(4, "0")}.json`, publicDir);
writeFileSync(
  file,
  JSON.stringify(
    {
      epoch,
      root,
      totalUsdg: total.toString(),
      upToBlock,
      leaf: "keccak256(keccak256(abi.encode(address wallet, uint256 cumulativeUsdg)))",
      claims: leaves.map((leaf) => ({ wallet: leaf.wallet, cumulativeUsdg: leaf.cumulative.toString(), proof: leaf.proof })),
    },
    null,
    2,
  ),
);
console.log(`\nStored epoch ${epoch} in D1 and wrote ${file.pathname}`);
