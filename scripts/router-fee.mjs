// Phase 0: estimate the fee a router keeps on ETH buys.
// For buy transactions (tx.value > 0) sent to a router, compare the ETH sent with the WETH the
// router wrapped into the swap (WETH Deposit events). The gap is what the router kept (its fee),
// as long as the router wraps the swap amount itself. Sample is capped.
// Usage: node scripts/router-fee.mjs <pools.json> <rpc-env-file> <router...>
import { readFileSync } from 'node:fs';

const [poolsFile, envFile, ...routers] = process.argv.slice(2);
const env = readFileSync(envFile, 'utf8');
const rpcUrl = (env.match(/^ROBINHOOD_RPC_URL\s*=\s*"?([^"\r\n]+)"?/m) || [])[1];
const DEPOSIT = '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c'; // WETH Deposit(address,uint256)
const MAX_RPC_REQUESTS = 25;
let requests = 0;
const routerSet = new Set(routers.map((r) => r.toLowerCase()));

async function rpcBatch(calls) {
  if (requests >= MAX_RPC_REQUESTS) throw new Error('rpc cap reached');
  requests++;
  const body = calls.map((c, id) => ({ jsonrpc: '2.0', id, method: c[0], params: c[1] }));
  const res = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  return (await res.json()).sort((a, b) => a.id - b.id).map((r) => r.result);
}

const pools = JSON.parse(readFileSync(poolsFile, 'utf8')).filter((p) => /^(MOW|BiscuitBandit|STMINT|CDOG) /.test(p.attributes.name));
const samples = new Map([...routerSet].map((r) => [r, []]));
for (const p of pools) {
  const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${p.attributes.address}/trades`, { headers: { 'User-Agent': 'research/1.0' } });
  if (!res.ok) continue;
  const buys = ((await res.json()).data || []).filter((t) => t.attributes.kind === 'buy').map((t) => t.attributes.tx_hash).slice(0, 40);
  const txs = await rpcBatch(buys.map((h) => ['eth_getTransactionByHash', [h]]));
  const picked = txs.filter((tx) => tx && routerSet.has((tx.to || '').toLowerCase()) && BigInt(tx.value) > 0n);
  if (!picked.length) continue;
  const receipts = await rpcBatch(picked.map((tx) => ['eth_getTransactionReceipt', [tx.hash]]));
  picked.forEach((tx, i) => {
    const deposits = (receipts[i]?.logs || []).filter((l) => l.topics[0] === DEPOSIT);
    if (!deposits.length) return;
    const wrapped = deposits.reduce((sum, l) => sum + BigInt(l.data), 0n);
    const sent = BigInt(tx.value);
    const feePct = Number(sent - wrapped) * 100 / Number(sent);
    samples.get(tx.to.toLowerCase()).push(feePct);
  });
  await new Promise((r) => setTimeout(r, 7000));
}
for (const [router, fees] of samples) {
  fees.sort((a, b) => a - b);
  const median = fees.length ? fees[Math.floor(fees.length / 2)] : NaN;
  console.log(router, 'buys sampled', fees.length, 'median kept %', median.toFixed(3), 'range', fees.length ? `${fees[0].toFixed(3)} .. ${fees[fees.length - 1].toFixed(3)}` : '-');
}
console.log('rpc requests used', requests);
