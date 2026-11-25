// Phase 0: identify the top swap entry contracts found by router-share.mjs.
// For each address: verified name on Sourcify (chain 4663), bytecode size, and from a sample of
// recent trades, how many distinct senders use it (a bot router has many users; an MEV bot has few).
// Usage: node scripts/router-identify.mjs <pools.json> <rpc-env-file> <address...>
import { readFileSync } from 'node:fs';

const [poolsFile, envFile, ...addresses] = process.argv.slice(2);
const env = readFileSync(envFile, 'utf8');
const rpcUrl = (env.match(/^ROBINHOOD_RPC_URL\s*=\s*"?([^"\r\n]+)"?/m) || [])[1];
const MAX_RPC_REQUESTS = 30;
let requests = 0;

async function rpcBatch(calls) {
  if (requests >= MAX_RPC_REQUESTS) throw new Error('rpc cap reached');
  requests++;
  const body = calls.map((c, id) => ({ jsonrpc: '2.0', id, method: c[0], params: c[1] }));
  const res = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const out = await res.json();
  return out.sort((a, b) => a.id - b.id).map((r) => r.result);
}

// Bytecode size per address.
const codes = await rpcBatch(addresses.map((a) => ['eth_getCode', [a, 'latest']]));

for (const [i, address] of addresses.entries()) {
  let name = 'not verified';
  try {
    const r = await fetch(`https://sourcify.dev/server/v2/contract/4663/${address}?fields=compilation`, { signal: AbortSignal.timeout(15000) });
    if (r.ok) { const j = await r.json(); name = j.compilation?.name || 'verified, no name'; }
  } catch { name = 'sourcify error'; }
  console.log(address, `code ${((codes[i] || '0x').length - 2) / 2} bytes`, name);
}

// Distinct senders per address from recent trades of the busiest pools (one GeckoTerminal call per pool).
const pools = JSON.parse(readFileSync(poolsFile, 'utf8')).filter((p) => /^(MOW|BiscuitBandit|STMINT|CDOG|SDQST|RobinInfinity) /.test(p.attributes.name)).slice(0, 6);
const senders = new Map(addresses.map((a) => [a.toLowerCase(), new Set()]));
const counts = new Map(addresses.map((a) => [a.toLowerCase(), 0]));
for (const p of pools) {
  const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${p.attributes.address}/trades`, { headers: { 'User-Agent': 'research/1.0' } });
  if (!res.ok) continue;
  const data = (await res.json()).data || [];
  const hashes = data.map((t) => t.attributes.tx_hash).slice(0, 150);
  const txs = await rpcBatch(hashes.map((h) => ['eth_getTransactionByHash', [h]]));
  for (const tx of txs) {
    if (!tx?.to) continue;
    const to = tx.to.toLowerCase();
    if (senders.has(to)) { senders.get(to).add(tx.from.toLowerCase()); counts.set(to, counts.get(to) + 1); }
  }
  await new Promise((r) => setTimeout(r, 7000));
}
console.log('\nsample: tx count / distinct senders');
for (const a of addresses) console.log(a, counts.get(a.toLowerCase()), '/', senders.get(a.toLowerCase()).size);
console.log('rpc requests used', requests);
