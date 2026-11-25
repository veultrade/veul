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
 * The swap screen's left column: a compact live market list. Picking a row loads that token into the swap card,
 * so the wide screen's left side is useful instead of empty. Tokens without a Uniswap pool are listed dimmed;
 * the swap card explains that they cannot be traded yet.
 */
export function MarketRail({ selected, onPick }: { selected: string | null; onPick: (token: MarketToken) => void }) {
  const market = useMarket();
  const [chosen, setList] = useState<ListKey | null>(null);
  // Until the trader picks a list, show Trending, or Stocks when Trending is empty (its source can pause).
  const list: ListKey = chosen ?? (market.data && market.data.trending.length === 0 ? "stocks" : "trending");
  const tokens = (market.data?.[list] ?? []).slice(0, 16);

  return (
    <section className={styles.rail} aria-label="Markets">
      <div className={styles.tabs} role="tablist" aria-label="Market lists">
        {LISTS.map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={list === option.key}
            className={`${styles.tab} ${list === option.key ? styles.tabOn : ""}`}
            onClick={() => setList(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <ul className={styles.rows}>
        {!market.data &&
          Array.from({ length: 8 }, (_, index) => (
            <li key={index} className={styles.skeletonRow}>
              <Skeleton width={28} height={28} />
              <Skeleton width="45%" />
              <Skeleton width="25%" />
            </li>
          ))}
        {tokens.map((token) => {
          const active = token.address === selected;
          return (
            <li key={token.address}>
              <button type="button" className={`${styles.row} ${active ? styles.rowOn : ""} ${token.pool ? "" : styles.rowDim}`} onClick={() => onPick(token)} aria-pressed={active}>
                <TokenAvatar token={token} size={28} />
                <span className={styles.name}>
                  <strong>{token.symbol}</strong>
                  <span className="mono">{formatUsd(token.volume24h)} vol</span>
                </span>
                <span className={styles.price}>
                  <Flash value={token.priceUsd} className="mono">
                    {formatPrice(token.priceUsd)}
                  </Flash>
                  <span className={`mono ${token.change24h >= 0 ? styles.up : styles.down}`}>
                    {token.change24h >= 0 ? "+" : ""}
                    {token.change24h.toFixed(1)}%
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {market.data && tokens.length === 0 && <li className={styles.empty}>Nothing in this list right now.</li>}
      </ul>
    </section>
  );
}
