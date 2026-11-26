import "server-only";
import { concat, encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

/**
 * Merkle tree for Veul's claims, the same rules as contracts/src/VeulClaimsV2.sol and scripts/lib/merkle.mjs:
 * leaf = keccak256(keccak256(abi.encode(address wallet, uint256 cumulative))), inner node = keccak256 of the two
 * children in ascending order, an odd node moves up unchanged. Leaves are sorted by hash, so the same amounts always
 * give the same root.
 */
export type Entry = { wallet: Address; cumulative: bigint };
export type Leaf = Entry & { proof: Hex[] };

export function leafHash(wallet: Address, cumulative: bigint): Hex {
  return keccak256(keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [wallet, cumulative])));
}

const pair = (a: Hex, b: Hex): Hex => (BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a])));

export function buildTree(entries: Entry[]): { root: Hex; leaves: Leaf[] } {
  if (entries.length === 0) throw new Error("No entries");
  const sorted = entries.map((entry) => ({ ...entry, hash: leafHash(entry.wallet, entry.cumulative) })).sort((x, y) => (BigInt(x.hash) < BigInt(y.hash) ? -1 : 1));
  const layers: Hex[][] = [sorted.map((leaf) => leaf.hash)];
  while (layers[layers.length - 1].length > 1) {
    const level = layers[layers.length - 1];
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? pair(level[i], level[i + 1]) : level[i]);
    layers.push(next);
  }
  const leaves = sorted.map((leaf, index) => {
    const proof: Hex[] = [];
    let position = index;
    for (let depth = 0; depth < layers.length - 1; depth++) {
      const level = layers[depth];
      const sibling = position % 2 === 0 ? position + 1 : position - 1;
      if (sibling < level.length) proof.push(level[sibling]);
      position = Math.floor(position / 2);
    }
    return { wallet: leaf.wallet, cumulative: leaf.cumulative, proof };
  });
  return { root: layers[layers.length - 1][0], leaves };
}

/** The contract's own check. */
export function verify(proof: Hex[], root: Hex, wallet: Address, cumulative: bigint): boolean {
  let hash = leafHash(wallet, cumulative);
  for (const sibling of proof) hash = pair(hash, sibling);
  return hash.toLowerCase() === root.toLowerCase();
}
