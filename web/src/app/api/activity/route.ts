import { recentLedger } from "@/lib/server/ledger";
import { fail, json, rateLimited } from "@/lib/server/http";

/** GET /api/activity — the latest verified swaps through Veul, every wallet (public onchain data). Cached 30 s. */
export async function GET(request: Request) {
  const limited = await rateLimited(request);
  if (limited) return limited;
  try {
    return json(await recentLedger(50), 30);
  } catch (error) {
    return fail(error);
  }
}
