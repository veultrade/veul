import "server-only";

/**
 * Small in-memory cache per Worker isolate for finished values (prices, pool keys, decimals).
 * Only resolved values are shared: Workers do not allow one request to await a promise started by
 * another request ("promise was created by a request that has since ended").
 */
const store = new Map<string, { expires: number; value: unknown }>();

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as T;
  const value = await load();
  store.set(key, { expires: now + ttlMs, value });
  if (store.size > 500) {
    for (const [k, entry] of store) if (entry.expires <= now) store.delete(k);
  }
  return value;
}
