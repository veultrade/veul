import type { TokenResponse, TokenSafety } from "@/lib/market";
import { tokenSafety } from "@/lib/server/gecko";
import { feedToken } from "@/lib/server/gmgn";
import { ADDRESS, fail, json, rateLimited } from "@/lib/server/http";
import { lookupToken } from "@/lib/server/lookup";
import { tokenOnchain } from "@/lib/server/onchain-lookup";

const UNKNOWN: TokenSafety = { holders: null, top10Pct: null, devPct: null, honeypot: null, gtScore: null };

/**
 * One token by contract address: market numbers, its Uniswap route, and safety data.
 * Route: DexScreener, else onchain. Safety: GMGN data from the VPS feed when the token is listed there,
 * else GeckoTerminal (which often refuses Cloudflare; then the fields stay unknown).
 */
export async function GET(request: Request, { params }: { params: Promise<{ address: string }> }) {
  const limited = await rateLimited(request);
  if (limited) return limited;
  const { address } = await params;
  if (!ADDRESS.test(address)) return fail(new Error("Not a contract address"), 400);
  try {
    // ?source=chain skips DexScreener (read-only; for checking the onchain path).
    const onlyChain = new URL(request.url).searchParams.get("source") === "chain";
    const [token, fromFeed] = await Promise.all([onlyChain ? tokenOnchain(address) : lookupToken(address), feedToken(address).catch(() => null)]);
    if (!token) return fail(new Error("This address is not a token on Robinhood Chain"), 404);
    const safety = fromFeed?.safety ?? (await tokenSafety(address).catch(() => null)) ?? UNKNOWN;
    const enriched = {
      ...token,
      imageUrl: token.imageUrl ?? fromFeed?.imageUrl ?? null,
      ageMinutes: token.ageMinutes >= 0 ? token.ageMinutes : (fromFeed?.ageMinutes ?? -1),
    };
    const body: TokenResponse = { token: enriched, safety };
    return json(body, 30);
  } catch (error) {
    return fail(error);
  }
}
