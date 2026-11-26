/**
 * Company logos for the stock tokens, served by Veul itself (web/public/stocks/<TICKER>.png).
 * The tokens' own image (CoinGecko) is the same Robinhood feather for every stock, so the list could not tell
 * them apart. Logos come once from financialmodelingprep.com's free image endpoint (no key); the allowlist then
 * points at our copy, so the app never depends on that site. Run after adding stocks:
 *   node scripts/fetch-stock-logos.mjs
 * At most 40 downloads, 1 s apart, 10 s timeout, PNG only, 300 KB cap each. Existing files are kept.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const LIST = new URL("../web/src/data/stock-allowlist.json", import.meta.url);
// Tickers with a logo file, for the client (TokenAvatar) without shipping the whole allowlist.
const INDEX = new URL("../web/src/lib/stock-logos.json", import.meta.url);
const DIR = new URL("../web/public/stocks/", import.meta.url);
const SOURCE = (ticker) => `https://financialmodelingprep.com/image-stock/${ticker}.png`;
const MAX = 40;
const MAX_BYTES = 300_000;

mkdirSync(DIR, { recursive: true });
const list = JSON.parse(readFileSync(LIST, "utf8"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Tickers are used in file names; only plain letters and digits pass.
const tokens = list.tokens.filter((token) => /^[A-Z0-9]{1,8}$/.test(token.symbol)).slice(0, MAX);

let saved = 0;
for (const token of tokens) {
  const file = new URL(`${token.symbol}.png`, DIR);
  if (!existsSync(file)) {
    await sleep(1000);
    try {
      const response = await fetch(SOURCE(token.symbol), { signal: AbortSignal.timeout(10_000) });
      const type = response.headers.get("content-type") ?? "";
      const bytes = Buffer.from(await response.arrayBuffer());
      // A real PNG starts with these 8 bytes; anything else (an error page) is skipped.
      const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      if (!response.ok || !type.startsWith("image/png") || !png || bytes.length > MAX_BYTES) {
        console.log(`${token.symbol}: skipped (HTTP ${response.status}, ${type}, ${bytes.length} bytes)`);
        continue;
      }
      writeFileSync(file, bytes);
      saved++;
      console.log(`${token.symbol}: saved ${Math.round(bytes.length / 1024)} KB`);
    } catch (error) {
      console.log(`${token.symbol}: ${error.message}`);
      continue;
    }
  }
  token.imageUrl = `/stocks/${token.symbol}.png`;
}

writeFileSync(LIST, JSON.stringify(list, null, 1) + "\n");
const withLogo = list.tokens.filter((token) => existsSync(new URL(`${token.symbol}.png`, DIR))).map((token) => token.symbol);
writeFileSync(INDEX, JSON.stringify(withLogo) + "\n");
console.log(`Saved ${saved} new logos; allowlist points at /stocks/ for every stock with a file.`);
