import { getAddress, type Address, type Hex } from "viem";
import { ADDRESS, fail, json } from "@/lib/server/http";
import { resolveToken, type TokenRef } from "@/lib/server/resolve-token";
import { buildSwap, prepareSell, swapConfig } from "@/lib/server/swap";
import { ethPriceUsd } from "@/lib/server/quote";
import type { PermitSingle } from "@/lib/swap/encode";

const AMOUNT = /^\d{1,12}(\.\d{1,18})?$/;

/** GET /api/swap?account=0x… — may this wallet make real swaps, and the per-trade cap. */
export async function GET(request: Request) {
  const account = new URL(request.url).searchParams.get("account");
  const config = await swapConfig(account && ADDRESS.test(account) ? account : null);
  return json({ enabled: config.enabled, reason: config.reason, maxEth: config.maxEth });
}

type Body = TokenRef & {
  step?: "prepare" | "build";
  side?: "buy" | "sell";
  amount?: string;
  slippageBps?: number;
  account?: string;
  permit?: { details: { token: string; amount: string; expiration: number; nonce: number }; spender: string; sigDeadline: string };
  signature?: string;
};

/**
 * POST /api/swap
 * - step "prepare" (sells): approval needed? plus the Permit2 permit to sign.
 * - step "build": the router transaction, simulated from the trader's wallet. The trader signs and sends it.
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return fail(new Error("Body must be JSON"), 400);
  }
  const account = String(body.account ?? "");
  if (!ADDRESS.test(account)) return fail(new Error("Connect a wallet first"), 400);
  const config = await swapConfig(account);
  if (!config.enabled || !config.feeWallet) return fail(new Error(config.reason ?? "Real swaps are off"), 403);
  const side = body.side;
  const amount = String(body.amount ?? "");
  if (side !== "buy" && side !== "sell") return fail(new Error("side must be buy or sell"), 400);
  if (!AMOUNT.test(amount) || Number(amount) <= 0) return fail(new Error("Enter an amount above 0"), 400);
  const slippageBps = Math.round(Number(body.slippageBps ?? 300));
  if (!(slippageBps >= 10 && slippageBps <= 2000)) return fail(new Error("Slippage must be between 0.1% and 20%"), 400);

  try {
    const token = await resolveToken(body);
    if (!token?.pool) return fail(new Error("This token has no Uniswap route Stockup can use"), 400);

    if (body.step === "prepare") {
      if (side !== "sell") return fail(new Error("Only sells need a permit"), 400);
      const prepared = await prepareSell(token, getAddress(account), amount);
      return json(prepared, 0);
    }

    // Cap while testing, on the ETH side of the trade (sells are checked after the quote below).
    if (side === "buy" && Number(amount) > config.maxEth) return fail(new Error(`While testing, one trade can be at most ${config.maxEth} ETH.`), 400);
    const build = await buildSwap({
      token,
      side,
      amount,
      slippageBps,
      account: getAddress(account) as Address,
      feeWallet: config.feeWallet,
      permit:
        side === "sell" && body.permit && body.signature
          ? {
              permit: {
                details: {
                  token: getAddress(body.permit.details.token),
                  amount: BigInt(body.permit.details.amount),
                  expiration: Number(body.permit.details.expiration),
                  nonce: Number(body.permit.details.nonce),
                },
                spender: getAddress(body.permit.spender),
                sigDeadline: BigInt(body.permit.sigDeadline),
              } satisfies PermitSingle,
              signature: body.signature as Hex,
            }
          : undefined,
    });
    const ethSize = side === "buy" ? Number(amount) : build.usd / (await ethPriceUsd());
    if (ethSize > config.maxEth * 1.0001) return fail(new Error(`While testing, one trade can be at most ${config.maxEth} ETH.`), 400);
    return json(build, 0);
  } catch (error) {
    return fail(error, 422);
  }
}
