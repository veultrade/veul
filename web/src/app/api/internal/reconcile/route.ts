import { reconcile } from "@/lib/server/ledger";
import { serverEnv } from "@/lib/server/env";
import { fail, json, sameSecret } from "@/lib/server/http";

/**
 * POST /api/internal/reconcile — called by the VPS cron every 15 minutes (scripts/vps/market-feed.mjs).
 * Records swaps that paid the fee but were never reported by the app. Bearer FEED_TOKEN required.
 */
export async function POST(request: Request) {
  const { FEED_TOKEN } = await serverEnv();
  if (!FEED_TOKEN) return fail(new Error("Not configured"), 503);
  if (!sameSecret(request.headers.get("authorization") ?? "", `Bearer ${FEED_TOKEN}`)) return fail(new Error("Unauthorized"), 401);
  try {
    return json(await reconcile());
  } catch (error) {
    return fail(error);
  }
}
