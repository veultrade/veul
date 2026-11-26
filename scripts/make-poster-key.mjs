// Creates the claims poster key (VeulClaimsV2's daily root poster) on this computer.
//   node scripts/make-poster-key.mjs
// Writes the private key to web/.poster-key (gitignored, never printed) and prints only the address. Then:
//   1. On the setup page, set that address as the poster (owner wallet signs).
//   2. Send the address a little ETH for gas (0.0005 ETH lasts many months of daily roots).
//   3. Put the key in the Worker, from the web folder:  npx wrangler secret put CLAIMS_POSTER_KEY < .poster-key
// The key can only post roots within the contract's limits. If it leaks: pause the contract, set a new poster.
import { existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../web/package.json", import.meta.url));
const { generatePrivateKey, privateKeyToAccount } = require("viem/accounts");

const FILE = new URL("../web/.poster-key", import.meta.url);
if (existsSync(FILE)) {
  const { address } = privateKeyToAccount((await import("node:fs")).readFileSync(FILE, "utf8").trim());
  console.log(`A poster key already exists (not replaced). Address: ${address}`);
  process.exit(0);
}
const key = generatePrivateKey();
writeFileSync(FILE, key, { mode: 0o600 });
console.log(`Poster key written to web/.poster-key. Address: ${privateKeyToAccount(key).address}`);
