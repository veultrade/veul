// Merkle tree for Veul's weekly claims, matching contracts/src/VeulClaims.sol exactly:
// leaf = keccak256(keccak256(abi.encode(address wallet, uint256 cumulative))), inner node = keccak256 of the two
// children in ascending order. An odd node at any level moves up unchanged.
import { createRequire } from "node:module";

// viem comes from the web app's node_modules (the scripts folder has no packages of its own).
const require = createRequire(new URL("../../web/package.json", import.meta.url));
const { encodeAbiParameters, keccak256, concat } = require("viem");

export function leafHash(wallet, cumulative) {
  return keccak256(keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [wallet, BigInt(cumulative)])));
}

const pair = (a, b) => (BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a])));

/** Builds the tree over [{ wallet, cumulative }]; returns the root and each wallet's proof. */
export function buildTree(entries) {
  if (entries.length === 0) throw new Error("No entries");
  // Deterministic order: sort leaves by hash, so the same ledger always gives the same root.
  const leaves = entries.map((entry) => ({ ...entry, hash: leafHash(entry.wallet, entry.cumulative) })).sort((x, y) => (BigInt(x.hash) < BigInt(y.hash) ? -1 : 1));
  const layers = [leaves.map((leaf) => leaf.hash)];
  while (layers.at(-1).length > 1) {
    const level = layers.at(-1);
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? pair(level[i], level[i + 1]) : level[i]);
    layers.push(next);
  }
  const proofs = leaves.map((_, index) => {
    const proof = [];
    let position = index;
    for (let depth = 0; depth < layers.length - 1; depth++) {
      const level = layers[depth];
      const sibling = position % 2 === 0 ? position + 1 : position - 1;
      if (sibling < level.length) proof.push(level[sibling]);
      position = Math.floor(position / 2);
    }
    return proof;
  });
  return { root: layers.at(-1)[0], leaves: leaves.map((leaf, i) => ({ wallet: leaf.wallet, cumulative: leaf.cumulative, proof: proofs[i] })) };
}

/** Same check the contract runs. */
export function verify(proof, root, wallet, cumulative) {
  let hash = leafHash(wallet, cumulative);
  for (const sibling of proof) hash = pair(hash, sibling);
  return hash.toLowerCase() === root.toLowerCase();
}
