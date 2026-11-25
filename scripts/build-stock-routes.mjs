// Finds each allowlisted stock token's deepest Uniswap v3/v4 pool against ETH, WETH or USDG and writes it into
// web/src/data/stock-allowlist.json, so the app can price stocks onchain without a market-data API.
// Uses DexScreener (free, about 300 calls/min) from this machine: 21 calls, one every 400 ms.
// Run: node scripts/build-stock-routes.mjs   (rerun when a stock gets a deeper pool)
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../web/src/data/stock-allowlist.json", import.meta.url);
const NATIVE = "0x0000000000000000000000000000000000000000";
const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const QUOTES = { [NATIVE]: "ETH", [WETH]: "WETH", [USDG]: "USDG" };

const list = JSON.parse(readFileSync(FILE, "utf8"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (const token of list.tokens) {
  const address = token.address.toLowerCase();
  const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/robinhood/${address}`, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    console.log(`${token.symbol}: DexScreener ${response.status}, kept old route`);
    await sleep(2000);
    continue;
  }
  const pairs = await response.json();
  let best = null;
  for (const pair of pairs) {
    if (pair.dexId !== "uniswap") continue;
    const version = pair.labels?.includes("v4") ? "v4" : pair.labels?.includes("v3") ? "v3" : null;
    if (!version) continue;
    const base = pair.baseToken.address.toLowerCase();
    const other = base === address ? pair.quoteToken.address.toLowerCase() : base;
    if (!QUOTES[other]) continue;
    const liquidity = pair.liquidity?.usd ?? 0;
    if (!best || liquidity > best.liquidityUsd) {
      best = { id: pair.pairAddress.toLowerCase(), version, quoteSymbol: QUOTES[other], quoteAddress: other, liquidityUsd: Math.round(liquidity), createdAt: pair.pairCreatedAt ?? null };
    }
  }
  const self = pairs.find((p) => p.baseToken.address.toLowerCase() === address);
  token.name = self?.baseToken.name ?? token.name ?? token.symbol;
  token.imageUrl = pairs.find((p) => p.info?.imageUrl && p.baseToken.address.toLowerCase() === address)?.info.imageUrl ?? token.imageUrl ?? null;
  token.pool = best;
  console.log(`${token.symbol.padEnd(6)} ${best ? `${best.version} ${best.quoteSymbol} $${best.liquidityUsd.toLocaleString("en-US")} ${best.id.slice(0, 12)}…` : "no Uniswap route"}`);
  await sleep(400);
}

list.routesUpdatedAt = new Date().toISOString();
list.note =
  "Stock tokens matched by contract address (from data/stock-allowlist.json, 2026-10-15). Check against Robinhood's official list before launch; same-name clones exist. Routes from scripts/build-stock-routes.mjs (DexScreener), prices are read onchain.";
writeFileSync(FILE, JSON.stringify(list, null, 1) + "\n");
console.log(`saved ${list.tokens.length} tokens`);
