import "server-only";
import allowlist from "@/data/stock-allowlist.json";
import type { MarketPool, MarketToken, TokenSafety } from "@/lib/market";
import { NATIVE, USDG, WETH } from "@/lib/uniswap";
import { cached } from "./cache";
import { decimalsOf, routable, type Pair } from "./dexscreener";
import { serverEnv } from "./env";

/**
 * GMGN OpenAPI for Robinhood Chain: trending tokens (/v1/market/rank) and new pools (/v1/trenches).
 * Market routes need only the API key (X-APIKEY + timestamp + client_id); no request signing.
 * Limit seen on 2026-11-21: 5 per window (rank costs 1, trenches 3), and a temporary ban after repeated 429s.
 * So lists are cached 2 minutes and fetched one after the other. Stock tokens are excluded by address.
 */
const HOST = "https://openapi.gmgn.ai";
const STOCKS = new Set(allowlist.tokens.map((t) => t.address));
const QUOTES: Record<string, string> = { [NATIVE]: "ETH", [WETH]: "WETH", [USDG]: "USDG" };
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const V3_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";

// After a 429 GMGN bans the caller for a while, and every request during the ban extends it,
// so this isolate stops calling until the reset time it was given.
let pausedUntil = 0;

async function gmgn<T>(method: "GET" | "POST", path: string, query: Record<string, string>, body?: unknown): Promise<T> {
  const { GMGN_API_KEY: key } = await serverEnv();
  if (!key) throw new Error("GMGN_API_KEY is not set");
  if (Date.now() < pausedUntil) throw new Error("GMGN rate limit, paused");
  const params = new URLSearchParams({ ...query, timestamp: String(Math.floor(Date.now() / 1000)), client_id: crypto.randomUUID() });
  const response = await fetch(`${HOST}${path}?${params}`, {
    method,
    headers: { "X-APIKEY": key, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await response.json().catch(() => null)) as { code?: number; data?: T; message?: string; reset_at?: number } | null;
  if (response.status === 429) {
    const reset = json?.reset_at ?? Number(response.headers.get("X-RateLimit-Reset")) ?? 0;
    pausedUntil = reset > 0 ? reset * 1000 + 2000 : Date.now() + 60_000;
  }
  if (!response.ok || !json || (json.code !== undefined && json.code !== 0)) {
    throw new Error(`GMGN ${response.status}${json?.message ? `: ${json.message}` : ""}`);
  }
  // Some routes wrap the payload twice: { code, data: { code, data: {...} } }.
  let data: unknown = json.data;
  while (data && typeof data === "object" && "code" in data && "data" in data) data = (data as { data: unknown }).data;
  return data as T;
}

type GmgnToken = {
  address: string;
  name: string;
  symbol: string;
  logo?: string;
  price?: number | string;
  price_change_percent?: number;
  volume?: number;
  volume_24h?: number;
  liquidity?: number | string;
  open_timestamp?: number;
  created_timestamp?: number;
  creation_timestamp?: number;
  holder_count?: number;
  top_10_holder_rate?: number | string;
  dev_team_hold_rate?: number | string;
  creator_balance_rate?: number | string;
  sniper_count?: number;
  bundler_rate?: number | string;
  bundler_trader_amount_rate?: number | string;
  is_honeypot?: number | boolean | string;
  is_wash_trading?: boolean | number;
  buy_tax?: number | string;
  sell_tax?: number | string;
  exchange?: string;
  pool_address?: string;
  quote_address?: string;
  launchpad_platform?: string;
};

const n = (value: unknown) => (value === undefined || value === null || value === "" ? null : Number(value));
const pct = (value: unknown) => {
  const x = n(value);
  return x === null ? null : x * 100;
};
const truthy = (value: unknown) => (value === undefined || value === null ? null : value === true || value === 1 || value === "1");

function safetyOf(t: GmgnToken): TokenSafety {
  return {
    holders: n(t.holder_count),
    top10Pct: pct(t.top_10_holder_rate),
    devPct: pct(t.dev_team_hold_rate ?? t.creator_balance_rate),
    honeypot: truthy(t.is_honeypot),
    gtScore: null,
    snipers: n(t.sniper_count),
    bundlePct: pct(t.bundler_rate ?? t.bundler_trader_amount_rate),
    buyTaxPct: pct(t.buy_tax),
    sellTaxPct: pct(t.sell_tax),
    washTrading: truthy(t.is_wash_trading),
    source: "gmgn",
  };
}

/** Launch time in ms: GMGN sends open_timestamp = 0 for some tokens, so take the first real timestamp. */
const launchedAt = (t: GmgnToken) => ([t.open_timestamp, t.creation_timestamp, t.created_timestamp].find((s) => s && s > 0) ?? 0) * 1000;

/** Pool straight from GMGN when it names one (trenches); rank items only say which Uniswap contract. */
function poolOf(t: GmgnToken): MarketPool | null {
  const id = t.pool_address?.toLowerCase();
  const quote = t.quote_address?.toLowerCase();
  const exchange = t.exchange?.toLowerCase();
  if (!id || !quote || !QUOTES[quote]) return null;
  const version = exchange === POOL_MANAGER || id.length === 66 ? "v4" : exchange === V3_FACTORY ? "v3" : null;
  if (!version) return null;
  const created = launchedAt(t);
  return { id, version, quoteSymbol: QUOTES[quote], quoteAddress: quote, liquidityUsd: n(t.liquidity) ?? 0, createdAt: created || null };
}

async function toToken(t: GmgnToken): Promise<MarketToken | null> {
  const address = t.address.toLowerCase();
  if (STOCKS.has(address) || QUOTES[address]) return null;
  const decimals = await decimalsOf(address).catch(() => null);
  if (decimals === null) return null;
  const opened = launchedAt(t);
  return {
    symbol: t.symbol,
    name: t.name,
    address,
    decimals,
    kind: "meme",
    imageUrl: t.logo || null,
    priceUsd: n(t.price) ?? 0,
    change24h: n(t.price_change_percent) ?? 0,
    volume24h: n(t.volume ?? t.volume_24h) ?? 0,
    liquidity: n(t.liquidity) ?? 0,
    ageMinutes: opened ? Math.max(0, (Date.now() - opened) / 60000) : 0,
    pool: poolOf(t),
    safety: safetyOf(t),
  };
}

const unique = (tokens: MarketToken[]) => tokens.filter((t, i) => tokens.findIndex((x) => x.address === t.address) === i);

/** Raw GMGN lists as the VPS fetcher sends them (same request shapes as below). */
export type GmgnFeed = { fetchedAt: string; rank: GmgnToken[]; newCreation: GmgnToken[]; pairs?: Pair[] };
export const FEED_KEY = "gmgn:lists";
const FEED_MAX_AGE_MS = 6 * 3_600_000; // older than this, the feed counts as missing

async function mapTrending(raw: GmgnToken[]) {
  const tokens = await Promise.all(raw.map(toToken));
  return unique(tokens.filter((t): t is MarketToken => t !== null));
}

async function mapNewPools(raw: GmgnToken[]) {
  const tokens = await Promise.all(raw.map(toToken));
  return unique(tokens.filter((t): t is MarketToken => t !== null && t.liquidity >= 1000));
}

/** The lists the VPS pushed into KV (every 15 minutes), or null when there is no recent copy. */
async function fromFeed(): Promise<{ trending: MarketToken[]; fresh: MarketToken[] } | null> {
  const { MARKET_FEED } = await serverEnv();
  if (!MARKET_FEED) return null;
  const feed = await MARKET_FEED.get<GmgnFeed>(FEED_KEY, "json").catch(() => null);
  if (!feed || Date.now() - Date.parse(feed.fetchedAt) > FEED_MAX_AGE_MS) return null;
  const pairs: Pair[] = feed.pairs ?? [];
  const { rank, newCreation } = feed;
  return cached(`gmgn:feed:${feed.fetchedAt}`, FEED_MAX_AGE_MS, async () => {
    // Routes for trending tokens come from the DexScreener pairs the fetcher sent along.
    const withRoute = (token: MarketToken): MarketToken => {
      if (token.pool) return token;
      const pool = pairs.map((pair) => routable(pair, token.address)).find((p): p is MarketPool => p !== null) ?? null;
      return { ...token, pool };
    };
    return { trending: (await mapTrending(rank)).map(withRoute), fresh: await mapNewPools(newCreation) };
  });
}

/** GMGN data for one token from the VPS feed (safety, logo, launch time), when the token is in either list. */
export async function feedToken(
  address: string,
): Promise<{ safety: TokenSafety; imageUrl: string | null; ageMinutes: number; pool: MarketPool | null } | null> {
  const { MARKET_FEED } = await serverEnv();
  if (!MARKET_FEED) return null;
  const feed = await MARKET_FEED.get<GmgnFeed>(FEED_KEY, "json").catch(() => null);
  const key = address.toLowerCase();
  const hit = feed && [...feed.rank, ...feed.newCreation].find((t) => t.address.toLowerCase() === key);
  if (!feed || !hit) return null;
  const opened = launchedAt(hit);
  // Route from GMGN's own pool (new pools) or from the DexScreener pairs the fetcher sent (trending).
  const pairs: Pair[] = feed.pairs ?? [];
  const pool = poolOf(hit) ?? pairs.map((pair) => routable(pair, key)).find((p): p is MarketPool => p !== null) ?? null;
  return { safety: safetyOf(hit), imageUrl: hit.logo || null, ageMinutes: opened ? (Date.now() - opened) / 60000 : -1, pool };
}

export async function gmgnAvailable(): Promise<boolean> {
  const env = await serverEnv();
  return Boolean(env.MARKET_FEED || env.GMGN_API_KEY);
}

/**
 * Trending (24h) and new Uniswap pools: from the VPS feed when present, else straight from GMGN
 * (works from a normal IP such as local dev; Cloudflare's shared IPs are banned by GMGN).
 */
export async function gmgnLists(): Promise<{ trending: MarketToken[]; fresh: MarketToken[] }> {
  const feed = await fromFeed();
  if (feed) return feed;
  return cached("gmgn:direct", 15 * 60_000, async () => {
    const rank = await gmgn<{ rank: GmgnToken[] }>("GET", "/v1/market/rank", RANK_QUERY);
    const fresh = await gmgn<{ new_creation?: GmgnToken[] }>("POST", "/v1/trenches", { chain: "robinhood" }, TRENCHES_BODY);
    return { trending: await mapTrending(rank.rank ?? []), fresh: await mapNewPools(fresh.new_creation ?? []) };
  });
}

/** Requests the VPS fetcher must send too (kept here so both sides agree). */
export const RANK_QUERY = { chain: "robinhood", interval: "24h", limit: "40" };
export const TRENCHES_BODY = {
  version: "v2",
  new_creation: {
    filters: ["offchain", "onchain"],
    launchpad_platform_v2: true,
    limit: 40,
    launchpad_platform: ["pool_uniswap_v3", "pool_uniswap_v4"],
    quote_address_type: [11, 20, 24, 12, 0],
  },
};
