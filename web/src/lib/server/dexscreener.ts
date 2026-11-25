import "server-only";
import type { Address } from "viem";
import allowlist from "@/data/stock-allowlist.json";
import type { MarketPool, MarketToken } from "@/lib/market";
import { NATIVE, USDG, WETH } from "@/lib/uniswap";
import { cached } from "./cache";
import { rpc } from "./env";

/**
 * DexScreener for single-token lookups (paste an address, quotes): about 300 requests a minute free,
 * ten times GeckoTerminal's limit. Decimals are read onchain because DexScreener does not return them.
 */
const API = "https://api.dexscreener.com";
const STOCKS = new Map(allowlist.tokens.map((t) => [t.address, t.symbol]));
const QUOTES: Record<string, string> = { [NATIVE]: "ETH", [WETH]: "WETH", [USDG]: "USDG" };

export type Pair = {
  dexId: string;
  labels?: string[];
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  priceChange?: { h24?: number };
  volume?: { h24?: number };
  liquidity?: { usd?: number };
  pairCreatedAt?: number;
  info?: { imageUrl?: string };
};

const decimalsAbi = [{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }] as const;

export function decimalsOf(address: string) {
  return cached(`decimals:${address}`, 86_400_000, async () => Number(await (await rpc()).readContract({ address: address as Address, abi: decimalsAbi, functionName: "decimals" })));
}

export function routable(pair: Pair, token: string): MarketPool | null {
  if (pair.dexId !== "uniswap") return null;
  const version = pair.labels?.includes("v4") ? "v4" : pair.labels?.includes("v3") ? "v3" : null;
  if (!version) return null;
  const base = pair.baseToken.address.toLowerCase();
  const other = base === token ? pair.quoteToken.address.toLowerCase() : base;
  if (!QUOTES[other]) return null;
  return { id: pair.pairAddress.toLowerCase(), version, quoteSymbol: QUOTES[other], quoteAddress: other, liquidityUsd: pair.liquidity?.usd ?? 0, createdAt: pair.pairCreatedAt ?? null };
}

/** A token with market numbers from its busiest pair and the route from its deepest Uniswap v3/v4 pool. */
export function tokenByAddress(address: string): Promise<MarketToken | null> {
  const key = address.toLowerCase();
  return cached(`ds:token:${key}`, 60_000, async () => {
    // DexScreener refuses Cloudflare's shared IPs only part of the time, so one retry often gets through.
    const url = `${API}/token-pairs/v1/robinhood/${key}`;
    let response = await fetch(url, { headers: { Accept: "application/json" } });
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      response = await fetch(url, { headers: { Accept: "application/json" } });
    }
    if (!response.ok) throw new Error(`DexScreener ${response.status}`);
    const pairs = ((await response.json()) as Pair[]).filter((pair) => pair.baseToken && pair.quoteToken);
    if (!pairs.length) return null;
    // Prefer pairs where the token is the base, so price and 24h change are the token's own.
    const asBase = pairs.filter((pair) => pair.baseToken.address.toLowerCase() === key);
    const main = [...(asBase.length ? asBase : pairs)].sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0))[0];
    const isBase = main.baseToken.address.toLowerCase() === key;
    const self = isBase ? main.baseToken : main.quoteToken;
    const route = pairs
      .map((pair) => routable(pair, key))
      .filter((pool): pool is MarketPool => pool !== null)
      .sort((a, b) => b.liquidityUsd - a.liquidityUsd)[0];
    const stock = STOCKS.get(key);
    return {
      symbol: stock ?? self.symbol,
      name: self.name,
      address: key,
      decimals: await decimalsOf(key),
      kind: stock ? "stock" : "meme",
      imageUrl: pairs.find((pair) => pair.info?.imageUrl && pair.baseToken.address.toLowerCase() === key)?.info?.imageUrl ?? null,
      priceUsd: isBase ? Number(main.priceUsd ?? 0) : 0,
      change24h: isBase ? (main.priceChange?.h24 ?? 0) : 0,
      volume24h: pairs.reduce((sum, pair) => sum + (pair.volume?.h24 ?? 0), 0),
      liquidity: pairs.reduce((sum, pair) => sum + (pair.liquidity?.usd ?? 0), 0),
      ageMinutes: main.pairCreatedAt ? Math.max(0, (Date.now() - main.pairCreatedAt) / 60000) : 0,
      pool: route ?? null,
    };
  });
}

/**
 * Best routable Uniswap pool for many tokens at once (DexScreener tokens/v1 returns each token's top pair,
 * up to 30 addresses per call). Used to fill routes for list tokens whose trending pool is on another DEX.
 */
export async function topRoutes(addresses: string[]): Promise<Map<string, MarketPool>> {
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))].sort();
  const routes = new Map<string, MarketPool>();
  for (let i = 0; i < unique.length; i += 30) {
    const batch = unique.slice(i, i + 30);
    const pairs = await cached(`ds:top:${batch.join(",")}`, 60_000, async () => {
      const response = await fetch(`${API}/tokens/v1/robinhood/${batch.join(",")}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`DexScreener ${response.status}`);
      return (await response.json()) as Pair[];
    }).catch(() => [] as Pair[]);
    for (const pair of pairs) {
      for (const side of [pair.baseToken, pair.quoteToken]) {
        const address = side.address.toLowerCase();
        if (!batch.includes(address) || routes.has(address)) continue;
        const pool = routable(pair, address);
        if (pool) routes.set(address, pool);
      }
    }
  }
  return routes;
}
