/**
 * Fills in missing stock token logos in web/src/data/stock-allowlist.json from GeckoTerminal's token info
 * (CoinGecko images of the Robinhood tokenized stocks). Run once after adding stocks:
 *   node scripts/add-stock-logos.mjs
 * Free public API, shared per IP: one call every 6 s, one retry after 30 s on a 429, at most 40 calls, 10 s timeout each.
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../web/src/data/stock-allowlist.json", import.meta.url);
const API = "https://api.geckoterminal.com/api/v2/networks/robinhood/tokens";
const MAX_CALLS = 40;
const GAP_MS = 6000;

const list = JSON.parse(readFileSync(FILE, "utf8"));
const missing = list.tokens.filter((token) => !token.imageUrl).slice(0, MAX_CALLS);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let found = 0;
for (const [index, token] of missing.entries()) {
  if (index > 0) await sleep(GAP_MS);
  try {
    const get = () => fetch(`${API}/${token.address}/info`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    let response = await get();
    if (response.status === 429) {
      await sleep(30_000);
      response = await get();
    }
    if (!response.ok) {
      console.log(`${token.symbol}: HTTP ${response.status}`);
      continue;
    }
    const url = (await response.json())?.data?.attributes?.image_url;
    // GeckoTerminal answers "missing.png" when it has no image.
    if (typeof url === "string" && url.startsWith("https://") && !url.includes("missing")) {
      token.imageUrl = url;
      found++;
      console.log(`${token.symbol}: ok`);
    } else console.log(`${token.symbol}: no logo`);
  } catch (error) {
    console.log(`${token.symbol}: ${error.message}`);
  }
}

writeFileSync(FILE, JSON.stringify(list, null, 1) + "\n");
console.log(`Added ${found} of ${missing.length} missing logos.`);
