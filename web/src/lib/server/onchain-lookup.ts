import "server-only";
import { formatUnits, type Address, type Hex } from "viem";
import allowlist from "@/data/stock-allowlist.json";
import type { MarketPool, MarketToken } from "@/lib/market";
import { NATIVE, UNISWAP, USDG, USDG_DECIMALS, WETH, erc20Abi } from "@/lib/uniswap";
import { cached } from "./cache";
import { rpc } from "./env";
import { HOOKLESS, ethPriceUsd, legFor, poolIdOf, quoteLeg, type PoolKey } from "./quote";

/**
 * Token lookup with only our RPC (no data API), for when DexScreener refuses Cloudflare.
 * Finds Uniswap pools against ETH, WETH or USDG: v3 through the factory (all four fee tiers) and hookless v4
 * pools by computing their ids. v4 pools with hooks (some launchpads) cannot be found this way.
 * The deepest pool is the one that pays most for a sell worth about $100.
 */
const STOCKS = new Map(allowlist.tokens.map((t) => [t.address, t.symbol]));
const V3_FEES = [100, 500, 3000, 10000];
const QUOTES: { address: Address; symbol: string }[] = [
  { address: WETH, symbol: "WETH" },
  { address: USDG, symbol: "USDG" },
];

const metaAbi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;
const factoryAbi = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }],
    outputs: [{ type: "address" }],
  },
] as const;
const stateViewAbi = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
] as const;

async function candidates(token: Address): Promise<MarketPool[]> {
  const client = await rpc();
  const found: MarketPool[] = [];

  const v3 = await Promise.all(
    QUOTES.flatMap((quote) =>
      V3_FEES.map(async (fee) => {
        const pool = await client.readContract({ address: UNISWAP.v3Factory, abi: factoryAbi, functionName: "getPool", args: [token, quote.address, fee] }).catch(() => NATIVE);
        return pool && pool !== NATIVE ? { pool, quote } : null;
      }),
    ),
  );
  for (const hit of v3) {
    if (hit) found.push({ id: hit.pool.toLowerCase(), version: "v3", quoteSymbol: hit.quote.symbol, quoteAddress: hit.quote.address, liquidityUsd: 0, createdAt: null });
  }

  const v4Quotes = [{ address: NATIVE, symbol: "ETH" }, ...QUOTES];
  const v4 = await Promise.all(
    v4Quotes.flatMap((quote) =>
      HOOKLESS.map(async ([fee, tickSpacing]) => {
        const [currency0, currency1] = token.toLowerCase() < quote.address.toLowerCase() ? [token, quote.address] : [quote.address, token];
        const key: PoolKey = { currency0, currency1, fee, tickSpacing, hooks: NATIVE };
        const id = poolIdOf(key);
        const slot0 = await client.readContract({ address: UNISWAP.v4StateView, abi: stateViewAbi, functionName: "getSlot0", args: [id as Hex] }).catch(() => null);
        return slot0 && slot0[0] > 0n ? { id, quote } : null;
      }),
    ),
  );
  for (const hit of v4) {
    if (hit) found.push({ id: hit.id.toLowerCase(), version: "v4", quoteSymbol: hit.quote.symbol, quoteAddress: hit.quote.address, liquidityUsd: 0, createdAt: null });
  }
  return found;
}

/** USD value a pool pays for selling `amount` of the token, or 0 when it cannot fill it. */
async function sellValueUsd(pool: MarketPool, token: Address, amount: bigint): Promise<number> {
  try {
    const leg = await legFor(pool, token);
    if (pool.quoteAddress === USDG) return Number(formatUnits(await quoteLeg(leg, token, USDG, amount), USDG_DECIMALS));
    return Number(formatUnits(await quoteLeg(leg, token, NATIVE, amount), 18)) * (await ethPriceUsd());
  } catch {
    return 0;
  }
}

export function tokenOnchain(address: string): Promise<MarketToken | null> {
  const key = address.toLowerCase();
  return cached(`onchain:token:${key}`, 300_000, async () => {
    const client = await rpc();
    const token = key as Address;
    const [symbol, name, decimals] = await Promise.all([
      client.readContract({ address: token, abi: metaAbi, functionName: "symbol" }).catch(() => null),
      client.readContract({ address: token, abi: metaAbi, functionName: "name" }).catch(() => null),
      client.readContract({ address: token, abi: metaAbi, functionName: "decimals" }).catch(() => null),
    ]);
    if (decimals === null) return null; // not an ERC-20
    const unit = 10n ** BigInt(decimals);

    const pools = await candidates(token);
    // Price from a tiny sell on any pool, then rank pools by what they pay for about $100 worth.
    const tiny = unit / 1000n || 1n;
    const tinyValues = await Promise.all(pools.map((pool) => sellValueUsd(pool, token, tiny)));
    const unitPrice = Math.max(0, ...tinyValues) * Number(unit / tiny);
    // If no pool can fill $100, fall back to the pool with the best price for the tiny sell.
    const bestTiny = tinyValues.indexOf(Math.max(0, ...tinyValues));
    let best: MarketPool | null = unitPrice > 0 && bestTiny >= 0 ? pools[bestTiny] : null;
    let bestValue = 0;
    if (unitPrice > 0) {
      const size = BigInt(Math.max(1, Math.floor((100 / unitPrice) * Number(unit))));
      const values = await Promise.all(pools.map((pool) => sellValueUsd(pool, token, size)));
      values.forEach((value, i) => {
        if (value > bestValue) {
          bestValue = value;
          best = pools[i];
        }
      });
    }

    // Rough depth for the risk check: what the quote side of a v3 pool holds.
    let liquidity = 0;
    const chosen = best as MarketPool | null;
    if (chosen?.version === "v3") {
      const held = await client.readContract({ address: chosen.quoteAddress as Address, abi: erc20Abi, functionName: "balanceOf", args: [chosen.id as Address] }).catch(() => 0n);
      liquidity = chosen.quoteAddress === USDG ? Number(formatUnits(held, USDG_DECIMALS)) * 2 : Number(formatUnits(held, 18)) * (await ethPriceUsd()) * 2;
    }

    const stock = STOCKS.get(key);
    return {
      symbol: stock ?? symbol ?? "TOKEN",
      name: name ?? symbol ?? "Unknown token",
      address: key,
      decimals,
      kind: stock ? "stock" : "meme",
      imageUrl: null,
      priceUsd: unitPrice,
      change24h: 0,
      volume24h: 0,
      liquidity,
      ageMinutes: -1, // unknown without an indexer
      pool: chosen ? { ...chosen, liquidityUsd: liquidity } : null,
    };
  });
}
