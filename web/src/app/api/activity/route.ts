import { recentLedger } from "@/lib/server/ledger";
import { fail, json } from "@/lib/server/http";

/** GET /api/activity — the latest verified swaps through Veul, every wallet (public onchain data). Cached 30 s. */
export async function GET() {
  try {
    return json(await recentLedger(50), 30);
  } catch (error) {
    return fail(error);
  }
}
