import "server-only";
import { serverEnv } from "./env";

/**
 * JSON responses with a short shared cache for price data, and readable errors without internals.
 * bigint values (token amounts, permit fields) are sent as decimal strings.
 */
export function json(body: unknown, maxAgeSeconds = 0, status = 200) {
  return new Response(
    JSON.stringify(body, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": maxAgeSeconds > 0 ? `public, max-age=${maxAgeSeconds}, s-maxage=${maxAgeSeconds}` : "no-store",
      },
    },
  );
}

export function fail(error: unknown, status = 502) {
  const message = error instanceof Error ? error.message : "Something went wrong";
  // RPC errors carry the request body and node details; users only need to know to retry.
  if (/HTTP request failed|Status: 429|rate limit/i.test(message) && !/^GMGN|^DexScreener|^GeckoTerminal/.test(message)) {
    return json({ error: "The chain node is busy right now. Try again in a moment." }, 0, 503);
  }
  // RPC URLs carry the API key; never echo them back.
  const safe = message.replace(/https?:\/\/\S+/g, "[rpc]").slice(0, 200);
  return json({ error: safe }, 0, status);
}

export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;


/** Constant-time comparison, so a shared token cannot be guessed from response timing. */
export function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * Per-IP rate limit for a public route (2026-11-26 review). Returns a 429 response when the caller is over the
 * limit, otherwise null. Without the binding (local dev) nothing is limited.
 */
export async function rateLimited(request: Request, which: "RPC_LIMIT" | "API_LIMIT" = "API_LIMIT"): Promise<Response | null> {
  const limiter = (await serverEnv())[which];
  if (!limiter) return null;
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const { success } = await limiter.limit({ key: ip });
  return success ? null : json({ error: "Too many requests. Wait a minute and try again." }, 0, 429);
}
