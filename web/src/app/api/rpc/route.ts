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
  const { ALCHEMY_RPC_URL } = await serverEnv();
  if (!ALCHEMY_RPC_URL) return fail(new Error("RPC is not configured"), 503);
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
  }
  const upstream = await fetch(ALCHEMY_RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: text });
  return new Response(upstream.body, { status: upstream.status, headers: { "content-type": "application/json", "Cache-Control": "no-store" } });
}
