/**
 * Sample numbers for the site preview (session 1.1). Real quotes and the ledger replace these in sessions 1.3 to 1.5.
 * Prices are from the 20 Nov 2026 snapshot; ETH is an assumption shown as "sample" in the UI.
 */
export const ETH_USD = 3000;
export const FEE_RATE = 0.005;
export const PAYBACK_RATE = 0.0025;

export const sampleToken = { symbol: "MOW", priceUsd: 0.1888, pool: "MOW / WETH · Uniswap v4" };

export const paybackStocks = [
  { ticker: "NVDA", priceUsd: 143.32 },
  { ticker: "SPY", priceUsd: 715.38 },
  { ticker: "TSLA", priceUsd: 370.06 },
  { ticker: "GOOGL", priceUsd: 271.17 },
] as const;

export type StockTicker = (typeof paybackStocks)[number]["ticker"];

export const sampleBag = [
  { id: "1", label: "Buy MOW · 0.05 ETH", payback: "+0.00262 NVDA", age: "5h" },
  { id: "2", label: "Sell STMINT · 0.12 ETH", payback: "+0.00628 NVDA", age: "7h" },
  { id: "3", label: "Buy CDOG · 0.08 ETH", payback: "+0.00419 NVDA", age: "13h" },
  { id: "4", label: "Buy PONS · 0.2 ETH", payback: "+0.00210 SPY", age: "1d" },
];

export function formatFixed(value: number, digits: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
