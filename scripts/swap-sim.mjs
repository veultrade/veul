// Simulates Stockup swaps through the Universal Router with eth_simulateV1 and fake balances (state overrides).
// No money, no keys, no signatures: a made-up trader gets ETH (and, for sells, tokens plus Permit2 allowance)
// only inside the simulation. Checks per route: it does not revert, the fee wallet gets exactly 0.5% in ETH,
// the trader gets at least minOut, and a minOut 5% above the quote makes it revert.
// Run: node scripts/swap-sim.mjs   (reads ALCHEMY_RPC_URL from web/.dev.vars)
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const web = new URL("../web/", import.meta.url);
const require = createRequire(new URL("package.json", web));
const { encodeAbiParameters, keccak256, pad, toHex, decodeAbiParameters, formatUnits } = require("viem");
const enc = await import(new URL("src/lib/swap/encode.ts", web).href);
const { UNIVERSAL_ROUTER, PERMIT2, WETH, USDG, NATIVE } = enc;

const rpcUrl = readFileSync(new URL(".dev.vars", web), "utf8").match(/^ALCHEMY_RPC_URL=(.+)$/m)[1].trim();
const rpc = async (method, params) => {
  const res = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error).slice(0, 300)}`);
  return json.result;
};

const TRADER = "0x00000000000000000000000000000000c0ffee01";
const FEE_WALLET = "0x00000000000000000000000000000000fee00001";
const ETH_PSEUDO = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"; // eth_simulateV1 logs native transfers as this token
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ONE_ETH = 10n ** 18n;

const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
const sel = (sig) => keccak256(toHex(sig)).slice(0, 10);
const addr = (a) => pad(a, { size: 32 }).slice(2);

async function poolKey(poolId) {
  const ret = await call("0x58daec3116aae6d93017baaea7749052e8a04fa7", sel("poolKeys(bytes25)") + poolId.slice(2, 52).padEnd(64, "0"));
  const [currency0, currency1, fee, tickSpacing, hooks] = decodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
    ret,
  );
  if (!tickSpacing) throw new Error(`no stored key for ${poolId}`);
  return { currency0, currency1, fee, tickSpacing, hooks };
}
const v3Fee = async (pool) => Number(BigInt(await call(pool, sel("fee()"))));

// Storage slot discovery for a token's balanceOf / allowance mappings: the usual slot numbers, plus
// OpenZeppelin v5's namespaced ERC20 storage (ERC-7201: balances at the base slot, allowances at base + 1).
const OZ5_ERC20 = BigInt("0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00");
const SLOT_CANDIDATES = [...Array.from({ length: 12 }, (_, i) => BigInt(i)), OZ5_ERC20, OZ5_ERC20 + 1n];
async function findSlot(token, kind) {
  for (const s of SLOT_CANDIDATES) {
    const key =
      kind === "balance"
        ? keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [TRADER, s]))
        : keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [PERMIT2, keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [TRADER, s]))]));
    const value = pad(toHex(123456789n), { size: 32 });
    const data = kind === "balance" ? sel("balanceOf(address)") + addr(TRADER) : sel("allowance(address,address)") + addr(TRADER) + addr(PERMIT2);
    const ret = await rpc("eth_call", [{ to: token, data }, "latest", { [token]: { stateDiff: { [key]: value } } }]).catch(() => null);
    if (ret && BigInt(ret) === 123456789n) return key;
  }
  throw new Error(`${kind} slot not found for ${token}`);
}

// Permit2 allowance[owner][token][spender] lives in slot 1 as a packed (amount, expiration, nonce).
function permit2AllowanceSlot(token) {
  const a = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [TRADER, 1n]));
  const b = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [token, a]));
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [UNIVERSAL_ROUTER, b]));
}

async function simulate(tx, overrides) {
  const result = await rpc("eth_simulateV1", [{ blockStateCalls: [{ calls: [{ from: TRADER, ...tx }], stateOverrides: overrides }], traceTransfers: true }, "latest"]);
  const c = result[0].calls[0];
  const transfers = (c.logs ?? [])
    .filter((l) => l.topics[0] === TRANSFER_TOPIC)
    .map((l) => ({ token: l.address.toLowerCase(), from: "0x" + l.topics[1].slice(26), to: "0x" + l.topics[2].slice(26), amount: BigInt(l.data) }));
  return { ok: c.status === "0x1", error: c.error?.message ?? c.returnData, transfers };
}

const received = (transfers, token, to) => transfers.filter((t) => t.token === token.toLowerCase() && t.to === to.toLowerCase()).reduce((s, t) => s + t.amount, 0n);

const market = await (await fetch("http://localhost:3031/api/market")).json();
const all = [...market.stocks, ...market.trending, ...market.fresh];
const pick = (fn) => all.find((t) => t.pool && fn(t));
const cases = [
  ["v3 WETH (meme)", pick((t) => t.pool.version === "v3" && t.pool.quoteSymbol === "WETH")],
  ["v4 native ETH (meme)", pick((t) => t.pool.version === "v4" && t.pool.quoteSymbol === "ETH")],
  ["v3 via USDG (NVDA)", all.find((t) => t.symbol === "NVDA" && t.kind === "stock")],
  ["v4 via USDG (SPY)", all.find((t) => t.symbol === "SPY" && t.kind === "stock")],
].filter(([, t]) => t);

const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
let failures = 0;
for (const [label, token] of cases) {
  const p = token.pool;
  const hop = p.version === "v3" ? { version: "v3", fee: await v3Fee(p.id) } : { version: "v4", key: await poolKey(p.id) };
  const route = { token: token.address, quote: p.quoteSymbol, hop };

  // BUY 0.01 ETH
  const amountIn = ONE_ETH / 100n;
  const q = await (await fetch(`http://localhost:3031/api/quote?token=${token.address}&side=buy&amount=0.01`)).json();
  const quoteOut = BigInt(Math.floor(Number(q.amountOut) * 10 ** token.decimals));
  const ethOverride = { [TRADER]: { balance: toHex(ONE_ETH) } };
  for (const [name, minOut, expectOk] of [["buy min -3%", (quoteOut * 97n) / 100n, true], ["buy min +5%", (quoteOut * 105n) / 100n, false]]) {
    const plan = enc.buildBuy(route, amountIn, minOut, FEE_WALLET);
    const r = await simulate({ to: UNIVERSAL_ROUTER, data: enc.executeCalldata(plan, deadline), value: toHex(plan.value) }, ethOverride);
    const fee = received(r.transfers, ETH_PSEUDO, FEE_WALLET);
    const got = received(r.transfers, token.address, TRADER);
    const pass = r.ok === expectOk && (!expectOk || (fee === amountIn / 200n && got >= minOut));
    if (!pass) failures++;
    console.log(`${pass ? "PASS" : "FAIL"} ${label.padEnd(22)} ${name.padEnd(12)} ${r.ok ? `got ${formatUnits(got, token.decimals)} ${token.symbol}, fee ${formatUnits(fee, 18)} ETH` : `reverted (${String(r.error).slice(0, 60)})`}${pass ? "" : ` [minOut ${formatUnits(minOut, token.decimals)}, quote ${formatUnits(quoteOut, token.decimals)}]`}`);
  }

  // SELL: the tokens a 0.01 ETH buy would give
  const sellAmount = (quoteOut * 9n) / 10n;
  const qs = await (await fetch(`http://localhost:3031/api/quote?token=${token.address}&side=sell&amount=${formatUnits(sellAmount, token.decimals)}`)).json();
  const quoteEth = BigInt(Math.floor(Number(qs.amountOut) * 1e18));
  const balanceSlot = await findSlot(token.address, "balance");
  const allowanceSlot = await findSlot(token.address, "allowance");
  const packed = (BigInt(2 ** 40) << 160n) | ((1n << 160n) - 1n); // max amount, far expiration, nonce 0
  const sellOverride = {
    [TRADER]: { balance: toHex(ONE_ETH / 10n) },
    [token.address]: { stateDiff: { [balanceSlot]: pad(toHex(sellAmount * 2n), { size: 32 }), [allowanceSlot]: pad(toHex((1n << 255n) - 1n), { size: 32 }) } },
    [PERMIT2]: { stateDiff: { [permit2AllowanceSlot(token.address)]: pad(toHex(packed), { size: 32 }) } },
  };
  for (const [name, minOut, expectOk] of [["sell min -3%", (quoteEth * 97n) / 100n, true], ["sell min +5%", (quoteEth * 105n) / 100n, false]]) {
    const plan = enc.buildSell(route, sellAmount, minOut, FEE_WALLET);
    const r = await simulate({ to: UNIVERSAL_ROUTER, data: enc.executeCalldata(plan, deadline), value: "0x0" }, sellOverride);
    const fee = received(r.transfers, ETH_PSEUDO, FEE_WALLET);
    const got = received(r.transfers, ETH_PSEUDO, TRADER);
    const total = fee + got;
    const feeOk = total > 0n && fee * 10_000n >= total * 49n && fee * 10_000n <= total * 51n; // 0.5% of the gross
    const pass = r.ok === expectOk && (!expectOk || (feeOk && got >= minOut));
    if (!pass) failures++;
    console.log(`${pass ? "PASS" : "FAIL"} ${label.padEnd(22)} ${name.padEnd(12)} ${r.ok ? `got ${formatUnits(got, 18)} ETH, fee ${formatUnits(fee, 18)} ETH` : `reverted (${String(r.error).slice(0, 60)})`}`);
  }
}
console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exitCode = failures ? 1 : 0;
