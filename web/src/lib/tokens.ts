import type { MarketToken } from "./market";

/** Rates and formatting shared by the app. Live prices come from /api/market (MarketProvider). */
export const FEE_RATE = 0.005;
export const PAYBACK_RATE = 0.0025;

/** Stocks a payback can be claimed in at launch. */
export const PAYBACK_TICKERS = ["NVDA", "SPY", "TSLA", "GOOGL"] as const;
export type PaybackTicker = (typeof PAYBACK_TICKERS)[number];

export function findIn(list: MarketToken[], query: string): MarketToken | undefined {
  const q = query.trim().toLowerCase();
  return list.find((t) => t.address === q) ?? list.find((t) => t.symbol.toLowerCase() === q);
}

/** Units of the chosen stock paid back for a trade worth `usd`. */
export function paybackUnits(usd: number, stockPriceUsd: number): number {
  return stockPriceUsd > 0 ? (usd * PAYBACK_RATE) / stockPriceUsd : 0;
}

export function formatFixed(value: number, digits: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Token amounts: fewer decimals for big numbers, more for tiny ones. */
export function formatAmount(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  if (value >= 1000) return formatFixed(value, 0);
  if (value >= 1) return formatFixed(value, 3);
  return value.toPrecision(4);
}

export function formatPrice(value: number): string {
  if (!value) return "–";
  if (value >= 100) return `$${value.toFixed(2)}`;
  if (value >= 1) return `$${value.toFixed(3)}`;
  if (value >= 0.001) return `$${value.toFixed(5)}`;
  return `$${value.toPrecision(3)}`;
}

export function formatUsd(value: number): string {
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
