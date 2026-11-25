import type { MarketToken, TokenSafety } from "./market";
import { formatUsd } from "./tokens";
import allowlist from "@/data/stock-allowlist.json";

const STOCK_TICKERS = allowlist.tokens.map((t) => t.symbol.toUpperCase());

/**
 * Rule-based risk check from live data: pool liquidity and age (DexScreener/GeckoTerminal), and when known,
 * holders, top-10 share, dev share and the honeypot check (GMGN with the list, else GeckoTerminal token info).
 * Snipers, bundled buys, taxes and wash trading come from GMGN when its key is set.
 */
export type RiskLevel = "low" | "medium" | "high";
export type RiskFlag = { label: string; level: RiskLevel };
export type RiskResult = { level: RiskLevel; flags: RiskFlag[]; summary: string };

const RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

function band(value: number, medium: number, high: number): RiskLevel {
  if (value >= high) return "high";
  if (value >= medium) return "medium";
  return "low";
}

export function formatAge(minutes: number): string {
  if (minutes < 0) return "–"; // unknown (token found onchain, no indexer data)
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 60 * 48) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

export function riskCheck(token: MarketToken, safety?: TokenSafety | null): RiskResult {
  if (token.kind === "stock") {
    return {
      level: "low",
      flags: [{ label: "Verified stock token address", level: "low" }],
      summary: `${token.symbol} is on the stock-token allowlist, matched by contract address. Its price follows the stock; pool depth still limits trade size.`,
    };
  }

  // Data that came with the list (GMGN) counts when the token has not been opened yet.
  safety = safety ?? token.safety ?? null;
  const source = safety?.source === "gmgn" ? "GMGN" : "GeckoTerminal";
  const flags: RiskFlag[] = [];
  // A meme using a stock's ticker (AMC, NVDAc, ...) is not the stock token: the real ones are matched by address.
  // Exact ticker in any case, or the ticker plus a short lowercase/number suffix ("NVDAc", "TSLA2").
  const copied = STOCK_TICKERS.find((stock) => token.symbol.toUpperCase() === stock || new RegExp(`^${stock}[a-z0-9.]{1,2}$`).test(token.symbol));
  if (copied) flags.push({ label: `Uses the ${copied} ticker, not the real ${copied} stock token`, level: "high" });
  if (safety?.honeypot) flags.push({ label: `Flagged as honeypot (${source})`, level: "high" });
  if (safety?.sellTaxPct != null && safety.sellTaxPct > 0) flags.push({ label: `Sell tax ${safety.sellTaxPct.toFixed(1)}%`, level: band(safety.sellTaxPct, 1, 10) });
  if (safety?.buyTaxPct != null && safety.buyTaxPct > 0) flags.push({ label: `Buy tax ${safety.buyTaxPct.toFixed(1)}%`, level: band(safety.buyTaxPct, 1, 10) });
  if (safety?.washTrading) flags.push({ label: "Wash trading suspected", level: "high" });
  if (!token.pool) flags.push({ label: "No Uniswap route", level: "high" });
  flags.push(
    token.liquidity > 0
      ? { label: `Liquidity ${formatUsd(token.liquidity)}`, level: token.liquidity < 20_000 ? "high" : token.liquidity < 100_000 ? "medium" : "low" }
      : { label: "Liquidity not reported", level: "medium" },
  );
  if (token.ageMinutes >= 0) flags.push({ label: `Pool age ${formatAge(token.ageMinutes)}`, level: token.ageMinutes < 60 * 24 ? "medium" : "low" });
  if (safety?.top10Pct != null) flags.push({ label: `Top 10 hold ${Math.round(safety.top10Pct)}%`, level: band(safety.top10Pct, 35, 50) });
  if (safety?.devPct != null) flags.push({ label: `Dev holds ${safety.devPct.toFixed(1)}%`, level: band(safety.devPct, 5, 10) });
  if (safety?.holders != null) flags.push({ label: `${safety.holders.toLocaleString("en-US")} holders`, level: safety.holders < 100 ? "high" : safety.holders < 500 ? "medium" : "low" });
  if (safety?.snipers != null && safety.snipers > 0) flags.push({ label: `${safety.snipers} snipers`, level: band(safety.snipers, 20, 60) });
  if (safety?.bundlePct != null && safety.bundlePct > 0) flags.push({ label: `Bundled buys ${Math.round(safety.bundlePct)}%`, level: band(safety.bundlePct, 10, 25) });

  const level = flags.reduce<RiskLevel>((worst, flag) => (RANK[flag.level] > RANK[worst] ? flag.level : worst), "low");
  const warnings = flags.filter((flag) => flag.level !== "low").sort((a, b) => RANK[b.level] - RANK[a.level]);
  const summary = warnings.length
    ? `Watch: ${warnings
        .slice(0, 3)
        .map((flag) => flag.label.toLowerCase())
        .join(", ")}. ${level === "high" ? "Size small and expect sharp moves." : "Normal for a young meme; still trade small."}`
    : "No warning signs in the data we have. It is still a meme: the price can move fast.";

  return { level, flags, summary };
}
