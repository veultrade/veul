import { getAddress, parseUnits, type Address } from "viem";
import { ADDRESS, fail, json } from "@/lib/server/http";
import { buildClaim, claimQuote, claimStatus } from "@/lib/server/claims";
import { PAYBACK_TICKERS } from "@/lib/tokens";

const TICKERS = PAYBACK_TICKERS as readonly string[];

/**
 * GET /api/claim?account=0x…&ticker=NVDA — what the wallet can claim now, and roughly how much stock that buys.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const account = params.get("account") ?? "";
  const ticker = params.get("ticker") ?? "NVDA";
  if (!ADDRESS.test(account)) return fail(new Error("account must be a wallet address"), 400);
  if (!TICKERS.includes(ticker)) return fail(new Error("Unknown stock"), 400);
  try {
    const { proof: _proof, ...status } = await claimStatus(getAddress(account) as Address);
    void _proof;
    let estimate: string | null = null;
    if (Number(status.claimableUsdg) > 0) {
      const quote = await claimQuote(parseUnits(status.claimableUsdg, 6), ticker);
      estimate = quote.amountOut.toString();
    }
    return json({ ...status, ticker, estimateOut: estimate });
  } catch (error) {
    return fail(error);
  }
}

/**
 * POST /api/claim { account, ticker, slippageBps } — the claim transaction, simulated from the wallet first.
 * The wallet signs and sends it; the server never holds keys.
 */
export async function POST(request: Request) {
  let body: { account?: string; ticker?: string; slippageBps?: number };
  try {
    body = await request.json();
  } catch {
    return fail(new Error("Body must be JSON"), 400);
  }
  const account = String(body.account ?? "");
  const ticker = String(body.ticker ?? "");
  const slippageBps = Math.min(Math.max(Number(body.slippageBps ?? 100), 10), 500);
  if (!ADDRESS.test(account)) return fail(new Error("Connect a wallet first"), 400);
  if (!TICKERS.includes(ticker)) return fail(new Error("Unknown stock"), 400);
  try {
    return json(await buildClaim(getAddress(account) as Address, ticker, slippageBps));
  } catch (error) {
    return fail(error, 422);
  }
}
