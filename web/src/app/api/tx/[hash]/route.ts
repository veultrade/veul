import { rpc } from "@/lib/server/env";
import { fail, json, rateLimited } from "@/lib/server/http";

const HASH = /^0x[0-9a-fA-F]{64}$/;

/** GET /api/tx/0x… — "pending", "success" or "failed" for a transaction the trader sent. */
export async function GET(_request: Request, { params }: { params: Promise<{ hash: string }> }) {
  const limited = await rateLimited(_request);
  if (limited) return limited;
  const { hash } = await params;
  if (!HASH.test(hash)) return fail(new Error("Not a transaction hash"), 400);
  try {
    const receipt = await (await rpc()).getTransactionReceipt({ hash: hash as `0x${string}` }).catch(() => null);
    if (!receipt) return json({ status: "pending" });
    return json({ status: receipt.status === "success" ? "success" : "failed", block: Number(receipt.blockNumber), gasUsed: receipt.gasUsed.toString() });
  } catch (error) {
    return fail(error);
  }
}
