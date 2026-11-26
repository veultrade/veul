import { geoBlocked } from "@/lib/server/geo";
import { serverEnv } from "@/lib/server/env";
import { fail, rateLimited } from "@/lib/server/http";

/**
 * POST /api/rpc — JSON-RPC for the trader's wallet (Privy), forwarded to our Alchemy node.
 * Needed because the public Robinhood Chain RPC rate-limits and is blocked by some ISPs.
 * Only the methods a wallet needs to send a transaction are allowed; no logs, no traces, no batches over 10.
 */
const ALLOWED = new Set([
  "eth_chainId",
  "net_version",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getTransactionCount",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_estimateGas",
  "eth_call",
  "eth_getCode",
  "eth_getBlockByNumber",
  "eth_sendRawTransaction",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
]);

type RpcRequest = { jsonrpc?: string; id?: unknown; method?: string; params?: unknown };

export async function POST(request: Request) {
  const limited = await rateLimited(request, "RPC_LIMIT");
  if (limited) return limited;
  // Not offered in blocked regions (lib/server/geo.ts).
  const blocked = await geoBlocked(request);
  if (blocked) return blocked;
  // A separate Alchemy key for wallets (optional), so abuse of this public proxy cannot use up the key the ledger,
  // quotes and the claims job run on (2026-11-26 swap review, finding 4).
  const { ALCHEMY_RPC_URL, ALCHEMY_PROXY_URL } = await serverEnv();
  const upstreamUrl = ALCHEMY_PROXY_URL || ALCHEMY_RPC_URL;
  if (!upstreamUrl) return fail(new Error("RPC is not configured"), 503);
  const text = await request.text();
  if (text.length > 200_000) return fail(new Error("Request too large"), 413);
  let body: RpcRequest | RpcRequest[];
  try {
    body = JSON.parse(text);
  } catch {
    return fail(new Error("Body must be JSON"), 400);
  }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > 10) return fail(new Error("Send 1 to 10 calls"), 400);
  for (const call of calls) {
    if (!call || typeof call.method !== "string" || !ALLOWED.has(call.method)) {
      return Response.json({ jsonrpc: "2.0", id: call?.id ?? null, error: { code: -32601, message: `Method not allowed: ${String(call?.method)}` } });
    }
    // eth_call / eth_estimateGas take [tx, block]; a third parameter is a state override, which a wallet never needs.
    if ((call.method === "eth_call" || call.method === "eth_estimateGas") && Array.isArray(call.params) && call.params.length > 2) {
      return Response.json({ jsonrpc: "2.0", id: call.id ?? null, error: { code: -32602, message: "State overrides are not allowed" } });
    }
  }
  // Forward a request rebuilt from the fields checked above, never the raw text: with duplicate keys
  // ({"method":"debug_x","method":"eth_call"}) JSON.parse keeps the last one, and the upstream parser might keep the
  // first (swap review, finding B).
  const rebuilt = calls.map((call) => ({ jsonrpc: "2.0", id: call.id ?? null, method: call.method, params: call.params ?? [] }));
  const upstream = await fetch(upstreamUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Array.isArray(body) ? rebuilt : rebuilt[0]) });
  return new Response(upstream.body, { status: upstream.status, headers: { "content-type": "application/json", "Cache-Control": "no-store" } });
}
