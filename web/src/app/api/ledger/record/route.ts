import { LedgerError, recordSwap } from "@/lib/server/ledger";
import { fail, json } from "@/lib/server/http";

const HASH = /^0x[0-9a-fA-F]{64}$/;

/**
 * POST /api/ledger/record { txHash } — the app reports a real swap right after it confirms.
 * The server checks it onchain (see lib/server/ledger.ts), so anyone may call this with any hash.
 * 200 recorded (or already recorded), 202 not ready yet (retry), 422 does not qualify.
 */
export async function POST(request: Request) {
  let txHash: unknown;
  try {
    ({ txHash } = (await request.json()) as { txHash?: unknown });
  } catch {
    return fail(new Error("Body must be JSON"), 400);
  }
  if (typeof txHash !== "string" || !HASH.test(txHash)) return fail(new Error("Not a transaction hash"), 400);
  try {
    const { entry, created } = await recordSwap(txHash as `0x${string}`);
    return json({ status: created ? "recorded" : "already", entry });
  } catch (error) {
    if (error instanceof LedgerError) return json({ status: error.pending ? "pending" : "rejected", reason: error.message }, 0, error.pending ? 202 : 422);
    return fail(error);
  }
}
