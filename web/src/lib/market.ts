/**
 * Shapes shared by the live data API (server) and the app (client).
 * Prices and pools come from GeckoTerminal; quotes and balances from the chain.
 */
export type PoolVersion = "v3" | "v4";

export type MarketPool = {
  id: string; // v3: pool address, v4: 32-byte pool id
  version: PoolVersion;
  quoteSymbol: string;
  quoteAddress: string; // 0x000… means native ETH in a v4 pool
  liquidityUsd: number;
  /** Pool creation time (ms), used to find a v4 pool's Initialize event when its key is not stored elsewhere. */
  createdAt: number | null;
};

export type MarketToken = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  kind: "meme" | "stock";
  imageUrl: string | null;
  priceUsd: number;
  change24h: number;
  volume24h: number;
  liquidity: number;
  ageMinutes: number; // -1 when unknown
  /** Deepest Uniswap v3/v4 pool against ETH, WETH or USDG; null when Stockup cannot route the token. */
  pool: MarketPool | null;
  /** Holder and launch data when the list source has it (GMGN); otherwise loaded when the token is opened. */
  safety?: TokenSafety | null;
};

export type MarketResponse = {
  updatedAt: string;
  ethUsd: number;
  trending: MarketToken[];
  fresh: MarketToken[];
  stocks: MarketToken[];
  /** Live prices of the stocks a payback can be paid in. */
  paybacks: Record<string, number>;
  /** Sources that failed this round (their list may be an older copy or empty). */
  errors?: Record<string, string>;
};

export type TokenSafety = {
  holders: number | null;
  top10Pct: number | null;
  devPct: number | null;
  honeypot: boolean | null;
  gtScore: number | null;
  /** From GMGN only: wallets that bought in the first blocks, share of volume from bundled buys, taxes. */
  snipers?: number | null;
  bundlePct?: number | null;
  buyTaxPct?: number | null;
  sellTaxPct?: number | null;
  washTrading?: boolean | null;
  source?: "gmgn" | "geckoterminal";
};

export type TokenResponse = { token: MarketToken; safety: TokenSafety };

export type QuoteResponse = {
  side: "buy" | "sell";
  amountIn: string; // decimal string in the input asset
  amountOut: string; // after the 0.5% fee
  feeEth: string;
  route: string; // e.g. "ETH → USDG (v3) → SPY (v4)"
  quotedAt: string;
};

export type BalancesResponse = { address: string; eth: string; tokens: { address: string; symbol: string; amount: string }[] };

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${response.status})`);
  return body as T;
}
