import type { MarketResponse, MarketToken } from "@/lib/market";
import { PAYBACK_TICKERS } from "@/lib/tokens";
import { topRoutes } from "@/lib/server/dexscreener";
import { newTokens, trendingTokens } from "@/lib/server/gecko";
import { gmgnAvailable, gmgnLists } from "@/lib/server/gmgn";
import { stockTokens } from "@/lib/server/stocks";
import { fail, json, rateLimited } from "@/lib/server/http";
import { ethPriceUsd } from "@/lib/server/quote";

const FRESH_SECONDS = 60;
const STALE_SECONDS = 86_400; // last good copy, served piece by piece when a source fails

type Edge = { match(request: Request): Promise<Response | undefined>; put(request: Request, response: Response): Promise<void> };

/**
 * Trending memes, new pools, stock tokens, ETH and payback stock prices.
 * Fresh copy: kept 60 s in Cloudflare's edge cache, so visitors in a region share one set of upstream calls.
 * Stale copy: the last good answer for each list, used when a source refuses (rate limits on shared IPs).
 */
export async function GET(request: Request) {
  const limited = await rateLimited(request);
  if (limited) return limited;
  const edge = (globalThis as { caches?: { default?: Edge } }).caches?.default;
  const freshKey = new Request(new URL("/api/market", request.url).toString());
  const staleKey = new Request(new URL("/api/market?stale=1", request.url).toString());
  const hit = await edge?.match(freshKey).catch(() => undefined);
  if (hit) return hit;

  // Trending and new pools: GMGN (VPS feed in KV, or direct with a key); else GeckoTerminal.
  const listsLoading = (await gmgnAvailable())
    ? gmgnLists().then(
        (lists) => [{ status: "fulfilled", value: lists.trending }, { status: "fulfilled", value: lists.fresh }] as const,
        (reason) => [{ status: "rejected", reason }, { status: "rejected", reason }] as const,
      )
    : Promise.all([Promise.allSettled([trendingTokens()]), Promise.allSettled([newTokens()])]).then(([a, b]) => [a[0], b[0]] as const);
  const [[trending, fresh], [stocks, eth]] = await Promise.all([listsLoading, Promise.allSettled([stockTokens(), ethPriceUsd()])]);
  const stale = (await edge
    ?.match(staleKey)
    .then((r) => r?.json() as Promise<MarketResponse> | undefined)
    .catch(() => undefined)) as MarketResponse | undefined;

  const pick = <T,>(result: PromiseSettledResult<T>, fallback: T | undefined): T | undefined => (result.status === "fulfilled" ? result.value : fallback);
  const lists = {
    trending: pick(trending, stale?.trending),
    fresh: pick(fresh, stale?.fresh),
    stocks: pick(stocks, stale?.stocks),
  };
  const ethUsd = pick(eth, stale?.ethUsd);
  if (!lists.trending && !lists.stocks) {
    const reason = [trending, stocks].find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    return fail(reason?.reason ?? new Error("Market data is unavailable"), 503);
  }

  try {
    // Trending pools are often on other DEXes; look up a Uniswap route for those tokens in one batch.
    const all = [...(lists.trending ?? []), ...(lists.fresh ?? []), ...(lists.stocks ?? [])];
    const missing = all.filter((t) => !t.pool).map((t) => t.address);
    const routes = missing.length ? await topRoutes(missing) : new Map();
    // The lists come from different sources; a logo one of them has (say Trending) also fills the token in another (New pools).
    const logos = new Map(all.filter((t) => t.imageUrl).map((t) => [t.address, t.imageUrl]));
    const fill = (list: MarketToken[] = []) =>
      list.map((t) => ({ ...t, pool: t.pool ?? routes.get(t.address) ?? null, imageUrl: t.imageUrl ?? logos.get(t.address) ?? null }));
    const stockList = fill(lists.stocks);
    const body: MarketResponse = {
      updatedAt: new Date().toISOString(),
      ethUsd: ethUsd ?? 0,
      trending: fill(lists.trending).filter((t) => t.kind === "meme"),
      fresh: fill(lists.fresh).filter((t) => t.kind === "meme"),
      stocks: stockList,
      paybacks: Object.fromEntries(PAYBACK_TICKERS.map((ticker) => [ticker, stockList.find((s) => s.symbol === ticker)?.priceUsd ?? stale?.paybacks[ticker] ?? 0])),
      errors: Object.fromEntries(
        Object.entries({ trending, fresh, stocks, eth })
          .filter(([, result]) => result.status === "rejected")
          .map(([name, result]) => [name, String((result as PromiseRejectedResult).reason?.message ?? result).replace(/https?:\/\/\S+/g, "[url]").slice(0, 160)]),
      ),
    };
    const complete = [trending, fresh, stocks, eth].every((r) => r.status === "fulfilled");
    const response = json(body, complete ? FRESH_SECONDS : 15);
    if (edge) {
      await edge.put(freshKey, response.clone()).catch(() => {});
      if (complete) await edge.put(staleKey, json(body, STALE_SECONDS)).catch(() => {});
    }
    return response;
  } catch (error) {
    return fail(error);
  }
}
