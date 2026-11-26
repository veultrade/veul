import { fail, json, rateLimited } from "@/lib/server/http";
import { quote } from "@/lib/server/quote";
import { resolveToken } from "@/lib/server/resolve-token";

const AMOUNT = /^\d{1,12}(\.\d{1,18})?$/;

/**
 * GET /api/quote?token=0x…&side=buy|sell&amount=0.05 — onchain quote, fee included.
 * The app also sends the pool it already knows (pool, version, quote, createdAt, symbol), so a quote needs
 * no data-API call. Without those, the token is looked up.
 */
export async function GET(request: Request) {
  const limited = await rateLimited(request);
  if (limited) return limited;
  const params = new URL(request.url).searchParams;
  const side = params.get("side");
  const amount = params.get("amount") ?? "";
  if (side !== "buy" && side !== "sell") return fail(new Error("side must be buy or sell"), 400);
  if (!AMOUNT.test(amount) || Number(amount) <= 0) return fail(new Error("Enter an amount above 0"), 400);
  try {
    const token = await resolveToken({
      token: params.get("token") ?? "",
      pool: params.get("pool") ?? undefined,
      version: params.get("version") ?? undefined,
      quote: params.get("quote") ?? undefined,
      createdAt: params.get("createdAt") ?? undefined,
      symbol: params.get("symbol") ?? undefined,
    });
    if (!token) return fail(new Error("Token not found"), 404);
    return json(await quote(token, side, amount));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "Not a contract address") return fail(error, 400);
    // A quoter revert usually means the pool cannot fill this size.
    if (/revert|execution reverted/i.test(message)) return fail(new Error("The pool cannot fill this amount. Try a smaller trade."), 422);
    return fail(error);
  }
}
