import { getAddress } from "viem";
import { walletLedger } from "@/lib/server/ledger";
import { ADDRESS, fail, json, rateLimited } from "@/lib/server/http";

/** GET /api/ledger?account=0x… — verified swaps and payback totals of one wallet (public onchain data). */
export async function GET(request: Request) {
  const limited = await rateLimited(request);
  if (limited) return limited;
  const account = new URL(request.url).searchParams.get("account") ?? "";
  if (!ADDRESS.test(account)) return fail(new Error("Not a wallet address"), 400);
  try {
    return json(await walletLedger(getAddress(account)));
  } catch (error) {
    return fail(error);
  }
}
