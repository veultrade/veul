import { FEED_KEY, type GmgnFeed } from "@/lib/server/gmgn";
import { serverEnv } from "@/lib/server/env";
import { fail, json, sameSecret } from "@/lib/server/http";

const MAX_BYTES = 1_000_000;
const MAX_ITEMS = 80;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const cleanList = (value: unknown) =>
  (Array.isArray(value) ? value : [])
    .filter((item): item is { address: string } => Boolean(item) && typeof item === "object" && ADDRESS.test(String((item as { address?: unknown }).address)))
    .slice(0, MAX_ITEMS);

/**
 * POST /api/internal/market-feed — the VPS fetcher (scripts/vps/market-feed.mjs) pushes GMGN's trending and
 * new-pool lists here every 15 minutes, because GMGN bans Cloudflare's shared IPs. Bearer FEED_TOKEN required.
 */
export async function POST(request: Request) {
  const { FEED_TOKEN, MARKET_FEED } = await serverEnv();
  if (!FEED_TOKEN || !MARKET_FEED) return fail(new Error("Feed is not configured"), 503);
  const auth = request.headers.get("authorization") ?? "";
  if (!sameSecret(auth, `Bearer ${FEED_TOKEN}`)) return fail(new Error("Unauthorized"), 401);

  const text = await request.text();
  if (text.length > MAX_BYTES) return fail(new Error("Payload too large"), 413);
  let body: { rank?: unknown; newCreation?: unknown; pairs?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return fail(new Error("Body must be JSON"), 400);
  }

  const pairs = (Array.isArray(body.pairs) ? body.pairs : [])
    .filter((pair) => {
      const p = pair as { pairAddress?: unknown; baseToken?: { address?: unknown }; quoteToken?: { address?: unknown } };
      return typeof p?.pairAddress === "string" && ADDRESS.test(String(p.baseToken?.address)) && ADDRESS.test(String(p.quoteToken?.address));
    })
    .slice(0, 120);
  const feed = { fetchedAt: new Date().toISOString(), rank: cleanList(body.rank), newCreation: cleanList(body.newCreation), pairs } as GmgnFeed;
  if (!feed.rank.length && !feed.newCreation.length) return fail(new Error("Both lists are empty"), 400);
  await MARKET_FEED.put(FEED_KEY, JSON.stringify(feed), { expirationTtl: 2 * 86_400 });
  return json({ ok: true, fetchedAt: feed.fetchedAt, rank: feed.rank.length, newCreation: feed.newCreation.length, pairs: pairs.length });
}
