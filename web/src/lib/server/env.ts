import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createPublicClient, http, type PublicClient } from "viem";
import { robinhoodChain } from "@/lib/chain";

/** Worker secrets (wrangler secret in production, .dev.vars locally). Never read from process.env. */
export async function serverEnv(): Promise<CloudflareEnv> {
  const { env } = await getCloudflareContext({ async: true });
  return env;
}

let client: { url: string; client: PublicClient } | null = null;

/** viem client on our own Alchemy RPC; the public RPC rate-limits Cloudflare and is blocked by some ISPs. */
export async function rpc(): Promise<PublicClient> {
  const { ALCHEMY_RPC_URL } = await serverEnv();
  if (!ALCHEMY_RPC_URL) throw new Error("ALCHEMY_RPC_URL is not set");
  if (client?.url !== ALCHEMY_RPC_URL) {
    // Alchemy's free tier limits calls per second (429 on bursts): smaller batches, and retries with backoff.
    const transport = http(ALCHEMY_RPC_URL, { batch: { batchSize: 12, wait: 16 }, retryCount: 5, retryDelay: 250 });
    client = { url: ALCHEMY_RPC_URL, client: createPublicClient({ chain: robinhoodChain, transport }) };
  }
  return client.client;
}
