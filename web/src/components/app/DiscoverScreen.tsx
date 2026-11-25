"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MarketToken } from "@/lib/market";
import { formatPrice, formatUsd } from "@/lib/tokens";
import { formatAge, riskCheck } from "@/lib/risk";
import { useMarket } from "./MarketProvider";
import { RiskBadge } from "./RiskBadge";
import { TokenAvatar } from "./TokenAvatar";
import screens from "./Screens.module.css";
import styles from "./Features.module.css";

const VIEWS = { trending: "Trending memes", stocks: "Stock tokens", fresh: "New pools" } as const;
type View = keyof typeof VIEWS;

/** Discover: what is moving on Robinhood Chain right now, with a quick risk check. A row opens the swap. */
export function DiscoverScreen() {
  const router = useRouter();
  const market = useMarket();
  const [view, setView] = useState<View>("trending");
  const href = (token: MarketToken) => `/app?token=${token.address}`;
  const list = market.data?.[view] ?? [];

  return (
    <div className={screens.page}>
      <header className={screens.title}>
        <h1>Discover</h1>
        <p>What is trading on Robinhood Chain right now, with a quick risk check on each token. Tap one to swap it.</p>
      </header>

      <div className={styles.segment} role="tablist" aria-label="Lists">
        {(Object.keys(VIEWS) as View[]).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? styles.segOn : ""} onClick={() => setView(key)}>
            {VIEWS[key]}
          </button>
        ))}
      </div>

      {market.error && !market.data ? (
        <div className={screens.empty}>
          <p>Prices could not load: {market.error}</p>
          <button type="button" className="btn btn-quiet btn-sm" onClick={market.reload}>
            Try again
          </button>
        </div>
      ) : (
        <div className={screens.tableWrap} aria-busy={market.loading}>
          <table className={styles.tokenTable}>
            <thead>
              <tr>
                <th scope="col">Token</th>
                <th scope="col">Price</th>
                <th scope="col" className={styles.hideSm}>
                  24h
                </th>
                <th scope="col" className={styles.hideSm}>
                  Volume
                </th>
                <th scope="col" className={styles.hideSm}>
                  Liquidity
                </th>
                <th scope="col" className={styles.hideSm}>
                  Age
                </th>
                <th scope="col">Risk</th>
              </tr>
            </thead>
            <tbody>
              {market.loading &&
                Array.from({ length: 8 }, (_, i) => (
                  <tr key={i} className={styles.skeletonRow}>
                    <td colSpan={7}>
                      <span />
                    </td>
                  </tr>
                ))}
              {market.data && list.length === 0 && (
                <tr className={styles.emptyRow}>
                  <td colSpan={7}>
                    {view === "stocks"
                      ? "Stock prices could not be read right now. Try again in a minute."
                      : "This list is not available right now: the market-data source is limiting requests. Stock tokens and swaps still work, and you can paste any token address in Swap."}
                  </td>
                </tr>
              )}
              {list.map((token) => (
                <tr key={token.address} onClick={() => router.push(href(token))}>
                  <td>
                    <a
                      className={styles.tokenCell}
                      href={href(token)}
                      onClick={(event) => {
                        event.preventDefault();
                        router.push(href(token));
                      }}
                    >
                      <TokenAvatar token={token} size={30} />
                      <span>
                        <strong>{token.symbol}</strong>
                        <small className="mono">{token.pool ? `${formatUsd(token.volume24h)} vol` : "No Uniswap route"}</small>
                      </span>
                    </a>
                  </td>
                  <td className="mono">
                    {formatPrice(token.priceUsd)}
                    <small className={`${styles.showSm} ${token.change24h >= 0 ? styles.up : styles.down}`}>
                      {token.change24h >= 0 ? "+" : ""}
                      {token.change24h.toFixed(1)}%
                    </small>
                  </td>
                  <td className={`mono ${styles.hideSm} ${token.change24h >= 0 ? styles.up : styles.down}`}>
                    {token.change24h >= 0 ? "+" : ""}
                    {token.change24h.toFixed(1)}%
                  </td>
                  <td className={`mono ${styles.hideSm}`}>{formatUsd(token.volume24h)}</td>
                  <td className={`mono ${styles.hideSm}`}>{token.liquidity > 0 ? formatUsd(token.liquidity) : "–"}</td>
                  <td className={`mono ${styles.hideSm}`}>{formatAge(token.ageMinutes)}</td>
                  <td>
                    <RiskBadge level={riskCheck(token).level} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={screens.muted}>
        {market.data ? `Live, updated ${new Date(market.data.updatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. ` : ""}
        Risk here checks liquidity, pool age and whether Stockup can route the token; open a token for holders, dev share and the honeypot check. Not advice.
      </p>
    </div>
  );
}
