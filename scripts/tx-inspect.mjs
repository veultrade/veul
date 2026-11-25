// Debug helper: show value, sender and token transfers of a few router transactions.
// Usage: node scripts/tx-inspect.mjs <pools.json> <rpc-env-file> <router> [poolNamePrefix]
import { readFileSync } from 'node:fs';

const [poolsFile, envFile, router, prefix = 'MOW'] = process.argv.slice(2);
const env = readFileSync(envFile, 'utf8');
const rpcUrl = (env.match(/^ROBINHOOD_RPC_URL\s*=\s*"?([^"\r\n]+)"?/m) || [])[1];
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const DEPOSIT = '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c';
const WITHDRAWAL = '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65';
async function rpcBatch(calls) {
  const body = calls.map((c, id) => ({ jsonrpc: '2.0', id, method: c[0], params: c[1] }));
  const res = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return (await res.json()).sort((a, b) => a.id - b.id).map((r) => r.result);
}
const pool = JSON.parse(readFileSync(poolsFile, 'utf8')).find((p) => p.attributes.name.startsWith(prefix + ' '));
const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${pool.attributes.address}/trades`, { headers: { 'User-Agent': 'research/1.0' } });
const trades = ((await res.json()).data || []).slice(0, 60);
const txs = await rpcBatch(trades.map((t) => ['eth_getTransactionByHash', [t.attributes.tx_hash]]));
const mine = txs.map((tx, i) => [tx, trades[i].attributes]).filter(([tx]) => tx && (tx.to || '').toLowerCase() === router.toLowerCase()).slice(0, 4);
const receipts = await rpcBatch(mine.map(([tx]) => ['eth_getTransactionReceipt', [tx.hash]]));
mine.forEach(([tx, t], i) => {
  console.log(`\n${t.kind} $${Number(t.volume_in_usd).toFixed(2)} value ${Number(BigInt(tx.value)) / 1e18} ETH from ${tx.from.slice(0, 10)}`);
  for (const l of receipts[i].logs) {
    const kind = l.topics[0] === TRANSFER ? 'Transfer' : l.topics[0] === DEPOSIT ? 'Deposit' : l.topics[0] === WITHDRAWAL ? 'Withdrawal' : l.topics[0].slice(0, 10);
    const from = l.topics[1] ? '0x' + l.topics[1].slice(26, 34) : '';
    const to = l.topics[2] ? '0x' + l.topics[2].slice(26, 34) : '';
    const amount = l.data && l.data.length <= 66 ? (Number(BigInt(l.data)) / 1e18).toPrecision(6) : '';
    console.log(`  ${l.address.slice(0, 10)} ${kind} ${from} -> ${to} ${amount}`);
  }
});
