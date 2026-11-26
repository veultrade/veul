import "server-only";
import allowlist from "@/data/stock-allowlist.json";
import type { MarketPool, MarketToken } from "@/lib/market";
import { cached } from "./cache";
import { decimalsOf } from "./dexscreener";
import { tokenPriceUsd } from "./quote";

/**
 * Stock tokens without a market-data API: addresses and Uniswap routes come from our allowlist
 * (scripts/build-stock-routes.mjs), prices from the pools onchain through our RPC.
 * Volume, 24h change and liquidity are extras from DexScreener; when it refuses, they show as unknown.
 */
type Listed = { symbol: string; address: string; name?: string; imageUrl?: string | null; pool?: MarketPool | null };

const LISTED = (allowlist.tokens as Listed[]).filter((t) => t.pool);

type Extra = { volume24h: number; change24h: number; liquidity: number; createdAt: number | null };

async function extras(): Promise<Map<string, Extra>> {
  return cached("ds:stock-extras", 120_000, async () => {
    const out = new Map<string, Extra>();
    const response = await fetch(`https://api.dexscreener.com/tokens/v1/robinhood/${LISTED.map((t) => t.address).join(",")}`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`DexScreener ${response.status}`);
    const pairs = (await response.json()) as {
      baseToken: { address: string };
      volume?: { h24?: number };
      priceChange?: { h24?: number };
      liquidity?: { usd?: number };
      pairCreatedAt?: number;
    }[];
    for (const pair of pairs) {
      const address = pair.baseToken.address.toLowerCase();
      if (out.has(address)) continue;
      out.set(address, { volume24h: pair.volume?.h24 ?? 0, change24h: pair.priceChange?.h24 ?? 0, liquidity: pair.liquidity?.usd ?? 0, createdAt: pair.pairCreatedAt ?? null });
    }
    return out;
  }).catch(() => new Map<string, Extra>());
}

export async function stockTokens(): Promise<MarketToken[]> {
  const [more, tokens] = await Promise.all([
    extras(),
    Promise.all(
      LISTED.map(async (listed): Promise<MarketToken | null> => {
        const pool = listed.pool as MarketPool;
        const base: MarketToken = {
          symbol: listed.symbol,
          name: listed.name ?? listed.symbol,
          address: listed.address,
          decimals: await decimalsOf(listed.address),
          kind: "stock",
          imageUrl: listed.imageUrl ?? null,
          priceUsd: 0,
          change24h: 0,
          volume24h: 0,
          liquidity: pool.liquidityUsd,
          ageMinutes: pool.createdAt ? (Date.now() - pool.createdAt) / 60000 : 0,
          pool,
        };
        const priceUsd = await tokenPriceUsd(base).catch(() => 0);
        return priceUsd > 0 ? { ...base, priceUsd } : null;
      }),
    ),
  ]);
  return tokens
    .filter((t): t is MarketToken => t !== null)
    .map((t) => {
      const extra = more.get(t.address);
      return extra ? { ...t, volume24h: extra.volume24h, change24h: extra.change24h, liquidity: extra.liquidity || t.liquidity } : t;
    })
    .sort((a, b) => b.volume24h - a.volume24h || b.liquidity - a.liquidity);
}

/**
 * The pool Veul uses for an allowlisted stock token, or null for any other token. Stocks always trade through this
 * pinned pool, never one picked by a data provider or sent by the app, so nobody can steer a stock buy into a pool
 * they control (2026-11-26 swap review, finding 3).
 */
export function pinnedStockPool(address: string): MarketPool | null {
  return LISTED.find((listed) => listed.address.toLowerCase() === address.toLowerCase())?.pool ?? null;
}
