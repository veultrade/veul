// Worker bindings and secrets. Secrets live in .dev.vars locally and in `wrangler secret` in production,
// never in .env files (OpenNext copies every .env value into the Worker bundle).
interface CloudflareEnv {
  ASSETS: Fetcher;
  /** Lists pushed by the VPS fetcher (key "gmgn:lists"). */
  MARKET_FEED?: KVNamespace;
  /** Verified real swaps and paybacks (D1 "stockup-ledger", schema in migrations/). */
  LEDGER?: D1Database;
  /** Token the VPS fetcher sends to POST /api/internal/market-feed. One token per internal endpoint (2026-11-26 review). */
  FEED_TOKEN?: string;
  /** Token for POST /api/internal/reconcile. */
  RECONCILE_TOKEN?: string;
  /** Token for POST /api/internal/claims-epoch. */
  CLAIMS_TOKEN?: string;
  /** Wallet that receives the 0.5% fee. Real swaps stay off until it is set. */
  FEE_WALLET?: string;
  /** Comma-separated wallets allowed to make real swaps while testing. */
  SWAP_OWNERS?: string;
  /** Per-trade cap in ETH for real swaps (default 0.01). */
  MAX_REAL_SWAP_ETH?: string;
  ALCHEMY_RPC_URL?: string;
  /** Optional second Alchemy key for the public wallet proxy (/api/rpc), so abuse there cannot use up ALCHEMY_RPC_URL. */
  ALCHEMY_PROXY_URL?: string;
  PRIVY_APP_SECRET?: string;
  /** Optional CoinGecko key for GeckoTerminal data; without it the public, IP-limited API is used. */
  COINGECKO_API_KEY?: string;
  /** "demo" (default) or "pro" for paid plans. */
  COINGECKO_PLAN?: string;
  /** GMGN OpenAPI key for trending and new pools (market routes only, no private key needed). */
  GMGN_API_KEY?: string;
  /** The live claims contract (VeulClaimsV3), a plain var in wrangler.jsonc. Claims stay closed until it is set. */
  CLAIMS_ADDRESS?: string;
  /** Earlier claims contracts, comma-separated (v1, v2). They must be paused; what they paid is subtracted. */
  CLAIMS_PREVIOUS?: string;
  /** "off" disables the geo-block (Preview only); anything else, or unset, keeps it on. */
  GEO_BLOCK?: string;
  /** Private key of the poster: it may only post roots on the claims contract, within its limits. Secret. */
  CLAIMS_POSTER_KEY?: string;
  /** Per-IP rate limits (wrangler.jsonc "ratelimits"): /api/rpc, and the other public API routes. */
  RPC_LIMIT?: RateLimit;
  API_LIMIT?: RateLimit;
}

interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

// The few D1 types the ledger uses (avoids adding @cloudflare/workers-types for one binding).
interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}
