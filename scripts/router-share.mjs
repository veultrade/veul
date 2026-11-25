// Phase 0: which contracts do meme swaps on Robinhood Chain go through?
// 1. Recent trades of the top meme pools from GeckoTerminal (free API, paced).
// 2. Each trade's transaction `to` address from the RPC (batched, hard request cap).
// 3. Share of trades and USD volume per `to` address.
// Usage: node scripts/router-share.mjs <pools.json> <rpc-env-file>
// The RPC URL is read from ROBINHOOD_RPC_URL in the env file and never printed.
import { readFileSync, writeFileSync } from 'node:fs';

const [poolsFile, envFile] = process.argv.slice(2);
const MAX_POOLS = 8;
const MAX_TX = 1500;
const MAX_RPC_REQUESTS = 40; // each request is a batch of up to 50 calls
const BATCH = 50;

const env = readFileSync(envFile, 'utf8');
const rpcUrl = (env.match(/^ROBINHOOD_RPC_URL\s*=\s*"?([^"\r\n]+)"?/m) || [])[1];
if (!rpcUrl) throw new Error('ROBINHOOD_RPC_URL not found');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const majors = /^(WETH|ETH|USDG|USDC|USDT|WBTC|cbBTC)$/;
const stocks = /^(NVDA|TSLA|AAPL|AMZN|MSFT|META|GOOGL|SPY|QQQ|GME|AMC|PLTR|COIN|HOOD|CRCL|RDDT|ANT|Anthropic|SPCX|TTWO|NFLX|AMD|MSTR)$/;

// Pick the busiest meme pools (same cleaning as the earlier volume check).
const pools = JSON.parse(readFileSync(poolsFile, 'utf8'))
  .filter((p) => {
    const a = p.attributes;
    const [base, quote] = a.name.split(' / ').map((s) => s.split(' ')[0]);
    const tx = a.transactions.h24.buys + a.transactions.h24.sells;
    if (stocks.test(base) || stocks.test(quote)) return false;
    if (majors.test(base) && majors.test(quote)) return false;
    if (/PEACH/i.test(a.name) || (tx < 200 && Number(a.volume_usd.h24) > 1e6)) return false;
    return true;
  })
  .slice(0, MAX_POOLS);

const trades = [];
for (const p of pools) {
  const address = p.attributes.address;
  const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${address}/trades`, {
    headers: { 'User-Agent': 'research/1.0' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) { console.log('trades failed', p.attributes.name, res.status); await sleep(15000); continue; }
  const json = await res.json();
  for (const t of json.data || []) {
    trades.push({ pool: p.attributes.name, hash: t.attributes.tx_hash, usd: Number(t.attributes.volume_in_usd) || 0 });
  }
  console.log('trades', p.attributes.name, json.data?.length || 0);
  await sleep(7000);
}

// Fetch transaction `to` for unique hashes, batched and capped.
const hashes = [...new Set(trades.map((t) => t.hash))].slice(0, MAX_TX);
const toByHash = new Map();
let requests = 0;
for (let i = 0; i < hashes.length && requests < MAX_RPC_REQUESTS; i += BATCH) {
  const chunk = hashes.slice(i, i + BATCH);
  const body = chunk.map((h, j) => ({ jsonrpc: '2.0', id: j, method: 'eth_getTransactionByHash', params: [h] }));
  requests++;
  const res = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  if (!res.ok) { console.log('rpc failed', res.status); break; }
  const out = await res.json();
  for (const r of out) if (r.result) toByHash.set(chunk[r.id], { to: (r.result.to || '').toLowerCase(), selector: r.result.input.slice(0, 10) });
}

const byTo = new Map();
let totalUsd = 0, totalTrades = 0;
for (const t of trades) {
  const info = toByHash.get(t.hash);
  if (!info) continue;
  totalUsd += t.usd; totalTrades++;
  const row = byTo.get(info.to) || { trades: 0, usd: 0, selectors: new Map(), pools: new Set() };
  row.trades++; row.usd += t.usd; row.pools.add(t.pool);
  row.selectors.set(info.selector, (row.selectors.get(info.selector) || 0) + 1);
  byTo.set(info.to, row);
}
const rows = [...byTo.entries()].sort((a, b) => b[1].usd - a[1].usd);
console.log(`\nRPC requests used: ${requests}, trades matched: ${totalTrades}, USD $${Math.round(totalUsd)}`);
for (const [to, r] of rows.slice(0, 20)) {
  const topSel = [...r.selectors.entries()].sort((a, b) => b[1] - a[1])[0][0];
  console.log(to, `trades ${(100 * r.trades / totalTrades).toFixed(1)}%`, `usd ${(100 * r.usd / totalUsd).toFixed(1)}%`, `pools ${r.pools.size}`, `selector ${topSel}`);
}
writeFileSync('data/router-share.json', JSON.stringify({ at: new Date().toISOString(), pools: pools.map((p) => p.attributes.name), totalTrades, totalUsd, rows: rows.map(([to, r]) => ({ to, trades: r.trades, usd: r.usd, pools: r.pools.size })) }, null, 2));
