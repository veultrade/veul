import "server-only";
import allowlist from "@/data/stock-allowlist.json";
import type { MarketPool, MarketToken, TokenSafety } from "@/lib/market";
import { NATIVE, USDG, WETH } from "@/lib/uniswap";
import { cached } from "./cache";
import { serverEnv } from "./env";

/**
 * GeckoTerminal data for Robinhood Chain: trending and new pools, stock tokens, token info.
 * Without a key it uses the public API, which is limited per IP; Cloudflare's shared IPs hit that limit
 * almost always. With COINGECKO_API_KEY (secret) the same endpoints go through CoinGecko's keyed API.
 * Stock tokens are recognised only by contract address from our allowlist, never by name (clones exist).
 */
const PUBLIC_API = "https://api.geckoterminal.com/api/v2";
const NET = "/networks/robinhood";
const STOCKS = new Map(allowlist.tokens.map((t) => [t.address, t.symbol]));
// Quote assets we can route from ETH: native ETH and WETH directly, USDG through one ETH/USDG hop.
const ROUTABLE_QUOTES = new Set([NATIVE, WETH, USDG]);
const QUOTE_SYMBOL: Record<string, string> = { [NATIVE]: "ETH", [WETH]: "WETH", [USDG]: "USDG" };

type GeckoRef = { data: { id: string } };
type GeckoPool = {
  attributes: {
    address: string;
    name: string;
    pool_created_at: string | null;
    base_token_price_usd: string | null;
    quote_token_price_usd: string | null;
    reserve_in_usd: string | null;
    price_change_percentage: { h24?: string };
    volume_usd: { h24?: string };
  };
  relationships: { base_token: GeckoRef; quote_token: GeckoRef; dex: GeckoRef };
};
type GeckoToken = { id: string; type: string; attributes: { address: string; name: string; symbol: string; decimals: number; image_url: string | null } };
type GeckoList = { data: GeckoPool[]; included?: GeckoToken[] };

async function gecko<T>(path: string): Promise<T> {
  const { COINGECKO_API_KEY: key, COINGECKO_PLAN: plan } = await serverEnv();
  // Keyed: Demo keys use api.coingecko.com, paid keys pro-api.coingecko.com; both under /api/v3/onchain.
  const pro = plan === "pro";
  const url = key ? `https://${pro ? "pro-api" : "api"}.coingecko.com/api/v3/onchain${path}` : `${PUBLIC_API}${path}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (key) headers[pro ? "x-cg-pro-api-key" : "x-cg-demo-api-key"] = key;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GeckoTerminal ${response.status} for ${path.split("?")[0]}`);
  return (await response.json()) as T;
}

const addressOf = (ref: GeckoRef) => ref.data.id.replace(/^robinhood_/, "").toLowerCase();
const num = (value: string | null | undefined) => (value ? Number(value) : 0);
const image = (url: string | null) => (url && !url.includes("missing") ? url : null);

function versionOf(dexId: string): MarketPool["version"] | null {
  if (dexId === "uniswap-v3-robinhood") return "v3";
  if (dexId === "uniswap-v4-robinhood") return "v4";
  return null;
}

function toPool(pool: GeckoPool, tokens: Map<string, GeckoToken>, tokenAddress: string): MarketPool | null {
  const version = versionOf(pool.relationships.dex.data.id);
  if (!version) return null;
  const base = addressOf(pool.relationships.base_token);
  const quote = addressOf(pool.relationships.quote_token);
  const other = base === tokenAddress ? quote : base;
  if (!ROUTABLE_QUOTES.has(other as `0x${string}`)) return null;
  return {
    id: pool.attributes.address.toLowerCase(),
    version,
    quoteSymbol: QUOTE_SYMBOL[other] ?? tokens.get(other)?.attributes.symbol ?? "?",
    quoteAddress: other,
    liquidityUsd: num(pool.attributes.reserve_in_usd),
    createdAt: pool.attributes.pool_created_at ? Date.parse(pool.attributes.pool_created_at) : null,
  };
}

function toToken(pool: GeckoPool, tokens: Map<string, GeckoToken>): MarketToken | null {
  const address = addressOf(pool.relationships.base_token);
  const info = tokens.get(address);
  if (!info || ROUTABLE_QUOTES.has(address as `0x${string}`)) return null;
  const created = pool.attributes.pool_created_at ? Date.parse(pool.attributes.pool_created_at) : Date.now();
  const stock = STOCKS.get(address);
  return {
    symbol: stock ?? info.attributes.symbol,
    name: info.attributes.name,
    address,
    decimals: info.attributes.decimals,
    kind: stock ? "stock" : "meme",
    imageUrl: image(info.attributes.image_url),
    priceUsd: num(pool.attributes.base_token_price_usd),
    change24h: num(pool.attributes.price_change_percentage.h24),
    volume24h: num(pool.attributes.volume_usd.h24),
    liquidity: num(pool.attributes.reserve_in_usd),
    ageMinutes: Math.max(0, (Date.now() - created) / 60000),
    pool: toPool(pool, tokens, address),
  };
}

function indexTokens(list: GeckoList) {
  return new Map((list.included ?? []).filter((item) => item.type === "token").map((item) => [item.attributes.address.toLowerCase(), item]));
}

/** One row per token (the busiest pool wins), in the API's order. */
function toTokens(list: GeckoList): MarketToken[] {
  const tokens = indexTokens(list);
  const seen = new Set<string>();
  const out: MarketToken[] = [];
  for (const pool of list.data) {
    const token = toToken(pool, tokens);
    if (!token || seen.has(token.address)) continue;
    seen.add(token.address);
    out.push(token);
  }
  return out;
}

const INCLUDE = "include=base_token,quote_token,dex";

export const trendingTokens = () => cached("gt:trending", 60_000, async () => toTokens(await gecko<GeckoList>(`${NET}/trending_pools?${INCLUDE}&page=1`)));
export const newTokens = () => cached("gt:new", 60_000, async () => toTokens(await gecko<GeckoList>(`${NET}/new_pools?${INCLUDE}&page=1`)));


export function tokenSafety(address: string): Promise<TokenSafety> {
  const key = address.toLowerCase();
  return cached(`gt:info:${key}`, 600_000, async () => {
    const body = await gecko<{
      data: {
        attributes: {
          holders?: { count?: number; distribution_percentage?: { top_10?: string } };
          developer_holding_percentage?: string | number | null;
          is_honeypot?: boolean | null;
          gt_score?: number | null;
        };
      };
    }>(`${NET}/tokens/${key}/info`);
    const a = body.data.attributes;
    return {
      holders: a.holders?.count ?? null,
      top10Pct: a.holders?.distribution_percentage?.top_10 ? Number(a.holders.distribution_percentage.top_10) : null,
      devPct: a.developer_holding_percentage != null ? Number(a.developer_holding_percentage) : null,
      honeypot: a.is_honeypot ?? null,
      gtScore: a.gt_score ?? null,
    };
  });
}
