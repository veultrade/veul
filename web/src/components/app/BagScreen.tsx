"use client";

import { PAYBACK_TICKERS, formatFixed, formatPrice } from "@/lib/tokens";
import { useMarket } from "./MarketProvider";
import { useBag } from "./BagStore";
import { ClaimPanel } from "./ClaimPanel";
import { useTrade } from "./TradeContext";
import { Tween } from "./motion";
import { TokenAvatar } from "./TokenAvatar";
import calm from "./Calm.module.css";
import styles from "./BagScreen.module.css";

// A tint per payback stock for its card, in the spirit of Circuit's agent cards.
const TINT: Record<string, string> = { NVDA: "#76b900", SPY: "#9aa4b5", TSLA: "#e33d3d", GOOGL: "#4285f4" };

/** The bag: what has been paid back so far (one wide card with the claim), then one card per stock. */
export function BagScreen() {
  const bag = useBag();
  const market = useMarket();
  const trade = useTrade();
  const prices = market.data?.paybacks ?? {};
  // Real paybacks lead whenever the wallet has any (verified or being checked); a preview-only visitor sees the
  // simulation, clearly labelled. The two are never added together.
  const hasReal = (bag.verified?.totals.trades ?? 0) > 0 || bag.pending.length > 0;
  const showTotals = hasReal ? bag.totals : bag.simulatedTotals;
  const headlineUsd = hasReal ? bag.totalUsd : bag.simulatedUsd;
  const realTrades = bag.verified?.totals.trades ?? 0;
  const simulated = bag.paybacks.length;
  const summary = [
    realTrades > 0 && `From ${realTrades} verified ${realTrades === 1 ? "trade" : "trades"}, owed in USDG, paid in ${bag.ticker}`,
    bag.pending.length > 0 && `${bag.pending.length} being checked`,
    simulated > 0 && `${simulated} simulated in this browser${hasReal ? " (not counted)" : ""}`,
  ].filter(Boolean);
  const stockToken = (ticker: string) => market.data?.stocks.find((token) => token.symbol === ticker);

  return (
    <div className={calm.col}>
      <h1 className={calm.title}>Bag</h1>
      <p className={calm.lead}>Every trade adds a little stock here. Claim it into your wallet from the next day.</p>

      <div className={styles.cards}>
        <article className={`${styles.card} ${styles.wide}`}>
          <div className={styles.stack} aria-hidden="true">
            {PAYBACK_TICKERS.map((ticker) => (
              <TokenAvatar key={ticker} token={stockToken(ticker) ?? { symbol: ticker, kind: "stock" }} size={36} />
            ))}
          </div>
          <div>
            <span className={styles.kicker}>{!hasReal && bag.simulatedUsd > 0 ? "Simulated, not real" : "Paid back so far"}</span>
            <h2 className={styles.big}>
              <Tween value={headlineUsd} format={(v) => `$${formatFixed(v, v > 0 && v < 1 ? 4 : 2)}`} />
            </h2>
            <p>{summary.length > 0 ? summary.join(" · ") : "No trades yet. Make a trade and the payback lands here."}</p>
            <ClaimPanel />
          </div>
        </article>

        {PAYBACK_TICKERS.map((ticker) => {
          const amount = showTotals[ticker];
          const collecting = bag.ticker === ticker;
          const token = stockToken(ticker);
          return (
            <article
              key={ticker}
              className={`${styles.card} ${collecting ? styles.collecting : ""}`}
              style={{ "--tint": TINT[ticker] } as React.CSSProperties}
            >
              <div className={styles.cardTop}>
                <TokenAvatar token={token ?? { symbol: ticker, kind: "stock" }} size={36} />
                {collecting ? (
                  <span className={styles.badge}>Collecting</span>
                ) : (
                  <button type="button" className={styles.switch} onClick={() => bag.setTicker(ticker)}>
                    Collect {ticker}
                  </button>
                )}
              </div>
              <div>
                <h2>
                  <Tween value={amount} format={(v) => (v > 0 ? formatFixed(v, 6) : "0")} /> {ticker}
                </h2>
                <p>
                  ${formatFixed(amount * (prices[ticker] ?? 0), 2)} · {formatPrice(prices[ticker] ?? 0)} each
                  {token && (
                    <>
                      {" · "}
                      <button type="button" className={styles.link} onClick={() => trade.openDrawer(token)}>
                        Chart
                      </button>
                    </>
                  )}
                </p>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
