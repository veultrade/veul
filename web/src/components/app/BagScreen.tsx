"use client";

import Link from "next/link";
import { useCallback } from "react";
import { Halftone } from "@/components/v3/Halftone";
import { PAYBACK_TICKERS, formatFixed, formatPrice } from "@/lib/tokens";
import { useMarket } from "./MarketProvider";
import { useBag } from "./BagStore";
import { Tween } from "./motion";
import { TokenAvatar } from "./TokenAvatar";
import styles from "./Screens.module.css";
import { appPath } from "@/lib/urls";

/** Stock bag: what has been paid back so far, per stock, and when it can be claimed. */
export function BagScreen() {
  const bag = useBag();
  const market = useMarket();
  const prices = market.data?.paybacks ?? {};
  const values = PAYBACK_TICKERS.map((ticker) => ({ ticker, amount: bag.totals[ticker], usd: bag.totals[ticker] * (prices[ticker] ?? 0) }));
  const realTrades = bag.verified?.totals.trades ?? 0;
  const simulated = bag.paybacks.length;
  const summary = [
    realTrades > 0 && `${realTrades} verified ${realTrades === 1 ? "trade" : "trades"} (owed in USDG, paid in ${bag.ticker})`,
    bag.pending.length > 0 && `${bag.pending.length} being checked`,
    simulated > 0 && `${simulated} simulated in this browser`,
  ].filter(Boolean);

  const totalText = `$${formatFixed(bag.totalUsd, 2)}`;
  // The total drawn white on black at the sampler's size; the halftone turns it into blue dots.
  const drawTotal = useCallback(
    (context: CanvasRenderingContext2D, width: number, height: number) => {
      context.fillStyle = "#fff";
      context.textAlign = "center";
      context.textBaseline = "middle";
      let size = height * 0.82;
      context.font = `700 ${size}px Arial, sans-serif`;
      const fit = (width * 0.92) / context.measureText(totalText).width;
      if (fit < 1) {
        size *= fit;
        context.font = `700 ${size}px Arial, sans-serif`;
      }
      context.fillText(totalText, width / 2, height / 2 + size * 0.04);
    },
    [totalText],
  );

  return (
    <div className={styles.page}>
      <header className={styles.title}>
        <h1>Stock bag</h1>
        <p>Every trade adds a little stock here. Claim it once a week into your wallet.</p>
      </header>

      <section className={styles.hero} aria-label="Bag total">
        <div>
          <div className={styles.heroFacts}>
            <span className={styles.kicker}>Paid back so far</span>
            <Tween value={bag.totalUsd} format={(v) => `$${formatFixed(v, 2)}`} className={styles.total} />
            <span className={`mono ${styles.muted}`}>
              {summary.length > 0 ? summary.join(" · ") : "No trades yet"} · valued at live prices
            </span>
          </div>
          <div className={styles.claim}>
            <button type="button" className="btn btn-main" disabled>
              Claim to wallet
            </button>
            <span className={styles.muted}>Weekly claims are the next step; paybacks are already counted.</span>
          </div>
        </div>
        <div className={styles.heroDots}>
          <Halftone draw={drawTotal} drawKey={totalText} cell={9} maxDot={0.95} floor={0.2} interactive className={styles.heroDotsInner} />
        </div>
      </section>

      <ul className={styles.stocks}>
        {values.map(({ ticker, amount, usd }) => (
          <li key={ticker} className={`${styles.stock} ${bag.ticker === ticker ? styles.stockOn : ""}`}>
            <div className={styles.stockHead}>
              <TokenAvatar token={{ symbol: ticker, kind: "stock" }} size={32} />
              <strong>{ticker}</strong>
              {bag.ticker === ticker && <span className={`mono ${styles.badge}`}>Collecting</span>}
            </div>
            <Tween value={amount} format={(v) => formatFixed(v, 6)} className={`mono ${styles.amount}`} />
            <span className={`mono ${styles.muted}`}>
              ${formatFixed(usd, 2)} · {formatPrice(prices[ticker] ?? 0)} each
            </span>
            {bag.ticker !== ticker && (
              <button type="button" className={styles.switch} onClick={() => bag.setTicker(ticker)}>
                Collect {ticker} next
              </button>
            )}
          </li>
        ))}
      </ul>

      {realTrades === 0 && simulated === 0 && bag.pending.length === 0 && (
        <div className={styles.empty}>
          <p>Your bag is empty. Make a swap and watch the payback land here.</p>
          <Link href={appPath()} className="btn btn-quiet btn-sm">
            Go to swap
          </Link>
        </div>
      )}
    </div>
  );
}
