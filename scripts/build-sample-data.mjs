// Builds the prototype's sample token data from the GeckoTerminal pool snapshot.
// Real names, prices, volumes and pool ages; holder stats are generated (marked sample in the UI).
// Usage: node scripts/build-sample-data.mjs data/pools-2026-11-20.json web/src/data/sample-tokens.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [input, output] = process.argv.slice(2);
const pools = JSON.parse(readFileSync(input, 'utf8'));
const majors = /^(WETH|ETH|USDG|USDC|USDT|WBTC|cbBTC)$/;
// Stock tokens are matched by verified address, never by name: same-name meme clones exist.
const allowlist = JSON.parse(readFileSync(new URL('../data/stock-allowlist.json', import.meta.url), 'utf8')).tokens;
const stockAddresses = new Set(allowlist.map((t) => t.address.toLowerCase()));
const stockSymbols = new Set(allowlist.map((t) => t.symbol.toUpperCase()));
const snapshotAt = Date.parse('2026-11-20T06:00:00Z');

// Deterministic pseudo-random numbers per symbol, so the sample stays stable between builds.
function seeded(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h >>>= 0) % 10000) / 10000;
  };
}

const seen = new Set();
const tokens = [];
for (const pool of pools) {
  const a = pool.attributes;
  const [base, quote] = a.name.split(' / ').map((s) => s.split(' ')[0]);
  if (majors.test(base)) continue; // majors, or WETH quoted in something else
  const tx = a.transactions.h24.buys + a.transactions.h24.sells;
  const volume = Number(a.volume_usd.h24) || 0;
  if (/PEACH/i.test(a.name) || (tx < 200 && volume > 1e6)) continue; // farming or glitched pools
  const symbol = base;
  if (seen.has(symbol)) continue;
  seen.add(symbol);
  const rand = seeded(symbol);
  const isStock = stockAddresses.has(pool.relationships.base_token.data.id.split('_')[1].toLowerCase());
  // Skip memes that copy a stock's name (fake TTWO, "Anthropic"): a terminal should not surface them as stocks.
  if (!isStock && (stockSymbols.has(symbol.toUpperCase()) || /anthropic|^ttwo$|^amd$/i.test(symbol))) continue;
  tokens.push({
    symbol,
    name: symbol,
    quote,
    kind: isStock ? 'stock' : 'meme',
    address: pool.relationships.base_token.data.id.split('_')[1],
    pool: a.address,
    dex: pool.relationships.dex.data.id,
    priceUsd: Number(a.base_token_price_usd),
    marketCap: Number(a.market_cap_usd || a.fdv_usd) || 0,
    liquidity: Number(a.reserve_in_usd) || 0,
    volume24h: volume,
    change24h: Number(a.price_change_percentage?.h24) || 0,
    txns24h: tx,
    buyers24h: a.transactions.h24.buyers,
    ageMinutes: Math.max(1, Math.round((snapshotAt - Date.parse(a.pool_created_at)) / 60000)),
    // Generated sample holder stats (Axiom-style risk row).
    holders: Math.round(150 + rand() * 4800),
    top10Pct: Math.round(12 + rand() * 40),
    devPct: Math.round(rand() * 9 * 10) / 10,
    snipersPct: Math.round(rand() * 14),
    bundlePct: Math.round(rand() * 22),
  });
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ snapshotAt: new Date(snapshotAt).toISOString(), tokens }, null, 1));
console.log('tokens', tokens.length, 'stocks', tokens.filter((t) => t.kind === 'stock').map((t) => t.symbol).join(','));
