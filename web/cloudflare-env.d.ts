// Worker bindings and secrets. Secrets live in .dev.vars locally and in `wrangler secret` in production,
// never in .env files (OpenNext copies every .env value into the Worker bundle).
interface CloudflareEnv {
  ASSETS: Fetcher;
  /** Lists pushed by the VPS fetcher (key "gmgn:lists"). */
  MARKET_FEED?: KVNamespace;
  /** Verified real swaps and paybacks (D1 "stockup-ledger", schema in migrations/). */
  LEDGER?: D1Database;
  /** Shared token the VPS fetcher sends to POST /api/internal/market-feed and /api/internal/reconcile. */
  FEED_TOKEN?: string;
  /** Wallet that receives the 0.5% fee. Real swaps stay off until it is set. */
  FEE_WALLET?: string;
  /** Comma-separated wallets allowed to make real swaps while testing. */
  SWAP_OWNERS?: string;
  /** Per-trade cap in ETH for real swaps (default 0.01). */
  MAX_REAL_SWAP_ETH?: string;
  ALCHEMY_RPC_URL?: string;
  PRIVY_APP_SECRET?: string;
  /** Optional CoinGecko key for GeckoTerminal data; without it the public, IP-limited API is used. */
  COINGECKO_API_KEY?: string;
  /** "demo" (default) or "pro" for paid plans. */
  COINGECKO_PLAN?: string;
  /** GMGN OpenAPI key for trending and new pools (market routes only, no private key needed). */
  GMGN_API_KEY?: string;
  /** The live claims contract (VeulClaimsV2 since the daily switch), a plain var in wrangler.jsonc. Claims stay closed until it is set. */
  CLAIMS_ADDRESS?: string;
  /** The first, weekly claims contract (VeulClaims, paused after the switch); its paid-out amounts are subtracted in v2. */
  CLAIMS_V1_ADDRESS?: string;
  /** Private key of the poster: it may only post roots on VeulClaimsV2, within the contract's limits. Secret. */
  CLAIMS_POSTER_KEY?: string;
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
