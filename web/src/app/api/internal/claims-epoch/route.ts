import { runClaimsEpoch } from "@/lib/server/claims-epoch";
import { serverEnv } from "@/lib/server/env";
import { fail, json, sameSecret } from "@/lib/server/http";

/**
 * POST /api/internal/claims-epoch — called once a day by the VPS cron (scripts/vps/market-feed.mjs).
 * Builds the claims tree and posts it with the poster key when the total grew (lib/server/claims-epoch.ts).
 * `?dry=1` reports what it would do without storing or sending anything. Bearer FEED_TOKEN required.
 */
export async function POST(request: Request) {
  const { FEED_TOKEN } = await serverEnv();
  if (!FEED_TOKEN) return fail(new Error("Not configured"), 503);
  if (!sameSecret(request.headers.get("authorization") ?? "", `Bearer ${FEED_TOKEN}`)) return fail(new Error("Unauthorized"), 401);
  try {
    return json(await runClaimsEpoch({ dryRun: new URL(request.url).searchParams.get("dry") === "1" }));
  } catch (error) {
    return fail(error);
  }
}
