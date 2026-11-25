/**
 * GeckoTerminal from the visitor's browser (session 1.7, chart-first trade screen).
 * Their public API answers CORS *, and its rate limit is per IP: fetching from each browser gives every visitor their
 * own allowance, while our Worker's shared Cloudflare IP would hit the limit for everyone (checked 2026-11-25:
 * many 429s even 7 s apart from one IP). Responses are cached for a short time, and 429s are retried with backoff.
 */
const API = "https://api.geckoterminal.com/api/v2/networks/robinhood";

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

export type Trade = {
  hash: string;
  time: number;
  side: "buy" | "sell";
  usd: number;
  tokenAmount: number;
  priceUsd: number;
  wallet: string;
};

export const TIMEFRAMES = [
  { key: "1m", label: "1m", path: "minute", aggregate: 1 },
  { key: "5m", label: "5m", path: "minute", aggregate: 5 },
  { key: "15m", label: "15m", path: "minute", aggregate: 15 },
  { key: "1h", label: "1h", path: "hour", aggregate: 1 },
  { key: "4h", label: "4h", path: "hour", aggregate: 4 },
  { key: "1d", label: "1d", path: "day", aggregate: 1 },
] as const;
export type Timeframe = (typeof TIMEFRAMES)[number]["key"];

const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

/** GET with a cache (`ttlMs`) and up to three retries on 429 (2 s, 4 s, 8 s). */
async function get<T>(path: string, ttlMs: number): Promise<T> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const running = inflight.get(path);
  if (running) return running as Promise<T>;

  const request = (async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch(API + path, { headers: { Accept: "application/json" } });
      if (response.status === 429) {
        if (attempt === 3) throw new RateLimitError();
        await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt));
        continue;
      }
      if (!response.ok) throw new Error(`Chart data unavailable (${response.status})`);
      const value = (await response.json()) as T;
      cache.set(path, { at: Date.now(), value });
      return value;
    }
    throw new RateLimitError();
  })();
  inflight.set(path, request);
  try {
    return await request;
  } finally {
    inflight.delete(path);
  }
}

export class RateLimitError extends Error {
  constructor() {
    super("Chart data is busy right now. It retries on its own.");
  }
}

/** Candles for `token` in `pool`, oldest first, in USD. `token` picks the side, so the price is always the token's. */
export async function fetchCandles(pool: string, token: string, timeframe: Timeframe): Promise<Candle[]> {
  const frame = TIMEFRAMES.find((t) => t.key === timeframe) ?? TIMEFRAMES[2];
  const body = await get<{ data?: { attributes?: { ohlcv_list?: number[][] } } }>(
    `/pools/${pool.toLowerCase()}/ohlcv/${frame.path}?aggregate=${frame.aggregate}&limit=300&currency=usd&token=${token.toLowerCase()}`,
    frame.path === "minute" ? 30_000 : 120_000,
  );
  const list = body.data?.attributes?.ohlcv_list ?? [];
  return list
    .map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }))
    .sort((a, b) => a.time - b.time);
}

type RawTrade = {
  attributes: {
    tx_hash: string;
    block_timestamp: string;
    tx_from_address: string;
    from_token_address: string;
    to_token_address: string;
    from_token_amount: string;
    to_token_amount: string;
    price_from_in_usd: string;
    price_to_in_usd: string;
    volume_in_usd: string;
  };
};

/** The pool's latest trades (up to 300), newest first, seen from `token`: buying it is a buy. */
export async function fetchTrades(pool: string, token: string): Promise<Trade[]> {
  const body = await get<{ data?: RawTrade[] }>(`/pools/${pool.toLowerCase()}/trades`, 15_000);
  const mine = token.toLowerCase();
  return (body.data ?? []).map(({ attributes: a }) => {
    const buy = a.to_token_address.toLowerCase() === mine;
    return {
      hash: a.tx_hash,
      time: Date.parse(a.block_timestamp) / 1000,
      side: buy ? "buy" : "sell",
      usd: Number(a.volume_in_usd),
      tokenAmount: Number(buy ? a.to_token_amount : a.from_token_amount),
      priceUsd: Number(buy ? a.price_to_in_usd : a.price_from_in_usd),
      wallet: a.tx_from_address,
    };
  });
}
