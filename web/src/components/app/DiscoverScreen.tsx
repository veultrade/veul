"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { MarketToken } from "@/lib/market";
import { formatPrice, formatUsd } from "@/lib/tokens";
import { formatAge, riskCheck, type RiskLevel } from "@/lib/risk";
import { appPath } from "@/lib/urls";
import { useMarket } from "./MarketProvider";
import { Flash, Skeleton } from "./motion";
import { RiskBadge } from "./RiskBadge";
import { TokenAvatar } from "./TokenAvatar";
import styles from "./DiscoverScreen.module.css";

/**
 * Discover, in the trade screen's terminal look: a toolbar (lists, filter, risk, routable only), a strip of
 * market totals, and a dense sortable table. A row opens the token on the trade screen.
 */

const VIEWS = { trending: "Trending", stocks: "Stocks", fresh: "New pools" } as const;
type View = keyof typeof VIEWS;

type SortKey = "rank" | "price" | "change" | "volume" | "liquidity" | "age" | "risk";
const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

type Row = { token: MarketToken; rank: number; risk: RiskLevel };

export function DiscoverScreen() {
  const router = useRouter();
  const market = useMarket();
  const [chosen, setView] = useState<View | null>(null);
  const [filter, setFilter] = useState("");
  const [risk, setRisk] = useState<RiskLevel | "all">("all");
  const [routable, setRoutable] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; down: boolean }>({ key: "rank", down: false });

  // Until a list is chosen, show Trending, or Stocks when Trending is empty (its source can pause).
  const view: View = chosen ?? (market.data && market.data.trending.length === 0 ? "stocks" : "trending");
  const href = (token: MarketToken) => `${appPath()}?token=${token.address}`;

  const all: Row[] = useMemo(() => (market.data?.[view] ?? []).map((token, i) => ({ token, rank: i + 1, risk: riskCheck(token).level })), [market.data, view]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const kept = all.filter(
      ({ token, risk: level }) =>
        (!q || token.symbol.toLowerCase().includes(q) || token.name.toLowerCase().includes(q) || token.address.includes(q)) &&
        (risk === "all" || level === risk) &&
        (!routable || token.pool),
    );
    const value = (row: Row): number => {
      switch (sort.key) {
        case "price":
          return row.token.priceUsd;
        case "change":
          return row.token.change24h;
        case "volume":
          return row.token.volume24h;
        case "liquidity":
          return row.token.liquidity;
        case "age":
          return row.token.ageMinutes < 0 ? Number.MAX_SAFE_INTEGER : row.token.ageMinutes;
        case "risk":
          return RISK_ORDER[row.risk];
        default:
          return row.rank;
      }
    };
    return [...kept].sort((a, b) => (sort.down ? value(b) - value(a) : value(a) - value(b)));
  }, [all, filter, risk, routable, sort]);

  // Totals over the whole list (not the filter), so the strip describes the market.
  const totals = useMemo(() => {
    const tokens = all.map((row) => row.token);
    const volume = tokens.reduce((sum, t) => sum + (t.volume24h || 0), 0);
    const byChange = [...tokens].sort((a, b) => b.change24h - a.change24h);
    return { count: tokens.length, volume, gainer: byChange[0], loser: byChange.at(-1) };
  }, [all]);

  const sortBy = (key: SortKey) => setSort((current) => (current.key === key ? { key, down: !current.down } : { key, down: key !== "rank" && key !== "age" && key !== "risk" }));
  const header = (key: SortKey, label: string, className = "") => (
    <th scope="col" className={className} aria-sort={sort.key === key ? (sort.down ? "descending" : "ascending") : "none"}>
      <button type="button" className={`${styles.sort} ${sort.key === key ? styles.sortOn : ""}`} onClick={() => sortBy(key)}>
        {label}
        <span aria-hidden="true">{sort.key === key ? (sort.down ? "↓" : "↑") : "↕"}</span>
      </button>
    </th>
  );

  const updated = market.data ? new Date(market.data.updatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div className={styles.screen}>
      <h1 className={styles.srOnly}>Discover</h1>

      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist" aria-label="Lists">
          {(Object.keys(VIEWS) as View[]).map((key) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? styles.tabOn : ""} onClick={() => setView(key)}>
              {VIEWS[key]}
              <span className={styles.count}>{market.data?.[key].length ?? "…"}</span>
            </button>
          ))}
        </div>
        <div className={styles.controls}>
          <input className={styles.filter} value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter by name or address" aria-label="Filter tokens" spellCheck={false} />
          <div className={styles.riskPick} role="radiogroup" aria-label="Risk">
            {(["all", "low", "medium", "high"] as const).map((level) => (
              <button key={level} type="button" role="radio" aria-checked={risk === level} className={risk === level ? styles.riskOn : ""} onClick={() => setRisk(level)}>
                {level === "all" ? "All" : level[0].toUpperCase() + level.slice(1)}
              </button>
            ))}
          </div>
          <label className={styles.check}>
            <input type="checkbox" checked={routable} onChange={(event) => setRoutable(event.target.checked)} />
            Tradeable only
          </label>
          <span className={`mono ${styles.updated}`}>{updated ? `Live · ${updated}` : "Loading…"}</span>
        </div>
      </div>

      <dl className={styles.strip}>
        <div>
          <dt>Tokens</dt>
          <dd className="mono">{market.data ? totals.count : <Skeleton width={40} height={18} />}</dd>
        </div>
        <div>
          <dt>Volume 24h</dt>
          <dd className="mono">{market.data ? formatUsd(totals.volume) : <Skeleton width={70} height={18} />}</dd>
        </div>
        <div>
          <dt>Top gainer</dt>
          <dd className="mono">
            {totals.gainer ? (
              <Link href={href(totals.gainer)}>
                {totals.gainer.symbol} <span className={styles.up}>+{totals.gainer.change24h.toFixed(1)}%</span>
              </Link>
            ) : (
              "–"
            )}
          </dd>
        </div>
        <div>
          <dt>Top loser</dt>
          <dd className="mono">
            {totals.loser ? (
              <Link href={href(totals.loser)}>
                {totals.loser.symbol} <span className={styles.down}>{totals.loser.change24h.toFixed(1)}%</span>
              </Link>
            ) : (
              "–"
            )}
          </dd>
        </div>
      </dl>

      {market.error && !market.data ? (
        <div className={styles.empty}>
          <p>Prices could not load: {market.error}</p>
          <button type="button" className="btn btn-quiet btn-sm" onClick={market.reload}>
            Try again
          </button>
        </div>
      ) : (
        <div className={styles.tableWrap} aria-busy={market.loading}>
          <table className={styles.table}>
            <thead>
              <tr>
                {header("rank", "#", styles.colRank)}
                <th scope="col" className={styles.colToken}>
                  Token
                </th>
                {header("price", "Price")}
                {header("change", "24h")}
                {header("volume", "Volume", styles.hideSm)}
                {header("liquidity", "Liquidity", styles.hideMd)}
                {header("age", "Age", styles.hideMd)}
                {header("risk", "Risk")}
                <th scope="col" className={styles.colAction}>
                  <span className={styles.srOnly}>Trade</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {!market.data &&
                Array.from({ length: 12 }, (_, i) => (
                  <tr key={i} className={styles.skeleton}>
                    <td colSpan={9}>
                      <Skeleton height={16} />
                    </td>
                  </tr>
                ))}
              {market.data && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className={styles.none}>
                    {all.length === 0
                      ? view === "stocks"
                        ? "Stock prices could not be read right now. Try again in a minute."
                        : "This list is not available right now: its data source is limiting requests. Stocks and swaps still work."
                      : "No token matches these filters."}
                  </td>
                </tr>
              )}
              {rows.map(({ token, rank, risk: level }) => (
                <tr key={token.address} className={token.pool ? "" : styles.dim} onClick={() => router.push(href(token))}>
                  <td className={`mono ${styles.colRank}`}>{rank}</td>
                  <td className={styles.colToken}>
                    <Link
                      className={styles.token}
                      href={href(token)}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <TokenAvatar token={token} size={28} />
                      <span>
                        <strong>
                          {token.symbol}
                          {token.kind === "stock" && <em className={styles.stock}>Stock</em>}
                        </strong>
                        <small>{token.pool ? token.name : "No Uniswap route"}</small>
                      </span>
                    </Link>
                  </td>
                  <td className="mono">
                    <Flash value={token.priceUsd}>{formatPrice(token.priceUsd)}</Flash>
                  </td>
                  <td className={`mono ${token.change24h >= 0 ? styles.up : styles.down}`}>
                    {token.change24h >= 0 ? "+" : ""}
                    {Math.abs(token.change24h) >= 100 ? Math.round(token.change24h) : token.change24h.toFixed(1)}%
                  </td>
                  <td className={`mono ${styles.hideSm}`}>{formatUsd(token.volume24h)}</td>
                  <td className={`mono ${styles.hideMd}`}>{token.liquidity > 0 ? formatUsd(token.liquidity) : "–"}</td>
                  <td className={`mono ${styles.hideMd}`}>{formatAge(token.ageMinutes)}</td>
                  <td>
                    <RiskBadge level={level} />
                  </td>
                  <td className={styles.colAction}>
                    <span className={styles.trade}>Trade →</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.foot}>
        Risk checks liquidity, pool age and whether Veul can route the token. Open a token for holders, dev share and the honeypot check. Not advice.
      </p>
    </div>
  );
}
