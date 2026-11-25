"use client";

import { useState } from "react";
import type { MarketToken } from "@/lib/market";
import { formatPrice, formatUsd } from "@/lib/tokens";
import { useMarket } from "./MarketProvider";
import { Flash, Skeleton } from "./motion";
import { TokenAvatar } from "./TokenAvatar";
import styles from "./MarketRail.module.css";

const LISTS = [
  { key: "trending", label: "Trending" },
  { key: "stocks", label: "Stocks" },
  { key: "fresh", label: "New" },
] as const;

type ListKey = (typeof LISTS)[number]["key"];

/**
 * The trade screen's left column: a dense live market list with a filter. Picking a row loads that token into the
 * chart and the trade panel. Tokens without a Uniswap pool are dimmed (the panel explains they cannot be traded).
 */
export function MarketRail({ selected, onPick }: { selected: string | null; onPick: (token: MarketToken) => void }) {
  const market = useMarket();
  const [chosen, setList] = useState<ListKey | null>(null);
  const [filter, setFilter] = useState("");
  // Until the trader picks a list, show Trending, or Stocks when Trending is empty (its source can pause).
  const list: ListKey = chosen ?? (market.data && market.data.trending.length === 0 ? "stocks" : "trending");
  const q = filter.trim().toLowerCase();
  const tokens = (market.data?.[list] ?? []).filter((t) => !q || t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)).slice(0, 40);

  return (
    <section className={styles.rail} aria-label="Markets">
      <div className={styles.head}>
        <div className={styles.tabs} role="tablist" aria-label="Market lists">
          {LISTS.map((option) => (
            <button key={option.key} type="button" role="tab" aria-selected={list === option.key} className={list === option.key ? styles.tabOn : ""} onClick={() => setList(option.key)}>
              {option.label}
            </button>
          ))}
        </div>
        <input className={styles.filter} value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter" aria-label="Filter this list" spellCheck={false} />
      </div>
      <div className={styles.cols} aria-hidden="true">
        <span>Token · volume</span>
        <span>Price</span>
        <span>24h</span>
      </div>

      <ul className={styles.rows}>
        {!market.data &&
          Array.from({ length: 10 }, (_, index) => (
            <li key={index} className={styles.skeletonRow}>
              <Skeleton width={24} height={24} />
              <Skeleton width="45%" />
              <Skeleton width="25%" />
            </li>
          ))}
        {tokens.map((token) => {
          const active = token.address === selected;
          return (
            <li key={token.address}>
              <button type="button" className={`${styles.row} ${active ? styles.rowOn : ""} ${token.pool ? "" : styles.rowDim}`} onClick={() => onPick(token)} aria-pressed={active}>
                <span className={styles.name}>
                  <TokenAvatar token={token} size={24} />
                  <span>
                    <strong>
                      {token.symbol}
                      {token.kind === "stock" && <em className={styles.stock}>Stock</em>}
                    </strong>
                    <span className="mono">{formatUsd(token.volume24h)}</span>
                  </span>
                </span>
                <Flash value={token.priceUsd} className={`mono ${styles.price}`}>
                  {formatPrice(token.priceUsd)}
                </Flash>
                <span className={`mono ${styles.change} ${token.change24h >= 0 ? styles.up : styles.down}`}>
                  {token.change24h >= 0 ? "+" : ""}
                  {Math.abs(token.change24h) >= 100 ? Math.round(token.change24h) : token.change24h.toFixed(1)}%
                </span>
              </button>
            </li>
          );
        })}
        {market.data && tokens.length === 0 && <li className={styles.empty}>{q ? "Nothing matches that filter." : "Nothing in this list right now."}</li>}
      </ul>
    </section>
  );
}
