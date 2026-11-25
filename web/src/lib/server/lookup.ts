import "server-only";
import type { MarketToken } from "@/lib/market";
import { tokenByAddress } from "./dexscreener";
import { feedToken } from "./gmgn";
import { tokenOnchain } from "./onchain-lookup";

const DEXSCREENER_TIMEOUT_MS = 4000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

/**
 * Any token by address, in order:
 * 1. DexScreener (volume, 24h change, logo, every DEX's pools), when it answers within 4 s;
 * 2. the VPS feed's route (GMGN pools, including v4 pools with hooks), if the token is in the lists;
 * 3. onchain: metadata plus v3 pools and hookless v4 pools found from the chain alone.
 */
export async function lookupToken(address: string): Promise<MarketToken | null> {
  const fromApi = await withTimeout(tokenByAddress(address), DEXSCREENER_TIMEOUT_MS).catch(() => null);
  if (fromApi?.pool) return fromApi;
  const [fromChain, fromFeed] = await Promise.all([tokenOnchain(address).catch(() => null), feedToken(address).catch(() => null)]);
  const base = fromApi ?? fromChain;
  if (!base) return null;
  // The feed's pool beats the onchain guess: it can be a v4 pool with hooks, which the chain alone cannot find.
  const pool = fromFeed?.pool ?? fromChain?.pool ?? null;
  return {
    ...base,
    pool,
    decimals: fromChain?.decimals ?? base.decimals,
    priceUsd: base.priceUsd || fromChain?.priceUsd || 0,
    imageUrl: base.imageUrl ?? fromFeed?.imageUrl ?? null,
    ageMinutes: base.ageMinutes >= 0 && fromApi ? base.ageMinutes : (fromFeed?.ageMinutes ?? -1),
    safety: fromFeed?.safety ?? base.safety,
  };
}
