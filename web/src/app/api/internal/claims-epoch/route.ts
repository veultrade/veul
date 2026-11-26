import { runClaimsEpoch } from "@/lib/server/claims-epoch";
import { serverEnv } from "@/lib/server/env";
import { fail, json, sameSecret } from "@/lib/server/http";

/**
 * POST /api/internal/claims-epoch — called once a day by the VPS cron (scripts/vps/market-feed.mjs).
 * Builds the claims tree and posts it with the poster key when the total grew (lib/server/claims-epoch.ts).
 * `?dry=1` reports what it would do without storing or sending anything. `?first=1` allows a contract's first root,
 * which is stored and returned for the owner to post, never sent by the poster. Bearer CLAIMS_TOKEN required.
 */
export async function POST(request: Request) {
  const { CLAIMS_TOKEN } = await serverEnv();
  if (!CLAIMS_TOKEN) return fail(new Error("Not configured"), 503);
  if (!sameSecret(request.headers.get("authorization") ?? "", `Bearer ${CLAIMS_TOKEN}`)) return fail(new Error("Unauthorized"), 401);
  try {
    const params = new URL(request.url).searchParams;
    return json(await runClaimsEpoch({ dryRun: params.get("dry") === "1", first: params.get("first") === "1" }));
  } catch (error) {
    return fail(error);
  }
}
