"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PAYBACK_TICKERS, formatAmount, formatFixed } from "@/lib/tokens";
import { appPath, siteUrl } from "@/lib/urls";
import { useBag } from "./BagStore";
import { useMarket } from "./MarketProvider";
import { useTrade } from "./TradeContext";
import { TokenAvatar } from "./TokenAvatar";
import { TokenPicker } from "./TokenPicker";
import { TradeTicket } from "./TradeTicket";
import styles from "./TradeDock.module.css";

const usd = (value: number) => `$${formatFixed(value, value > 0 && value < 1 ? 4 : 2)}`;

/** The dock with no ticket open: the wallet's bag, then a few ways to start. */
function Idle() {
  const bag = useBag();
  const market = useMarket();
  const trade = useTrade();
  const stocks = market.data?.stocks ?? [];
  const stockToken = (ticker: string) => stocks.find((token) => token.symbol === ticker);
  const real = PAYBACK_TICKERS.filter((ticker) => bag.totals[ticker] > 0);
  const simulated = PAYBACK_TICKERS.filter((ticker) => bag.simulatedTotals[ticker] > 0);
  // Suggestions: the two most traded routable memes and the payback stock, so the first trade is one click away.
  const suggestions = [...(market.data?.trending ?? []).filter((token) => token.pool).slice(0, 2), stockToken(bag.ticker)].filter((token) => token !== undefined);

  return (
    <>
      <section className={styles.group} aria-label="Your bag">
        <Link href={appPath("/bag")} className={styles.item}>
          <strong>Your bag</strong>
          <small>{bag.totalUsd > 0 ? `${usd(bag.totalUsd)} paid back` : "Nothing paid back yet"}</small>
        </Link>
        {real.map((ticker) => (
          <Link key={ticker} href={appPath("/bag")} className={styles.item}>
            <TokenAvatar token={stockToken(ticker) ?? { symbol: ticker, kind: "stock" }} size={24} />
            <span>
              {formatAmount(bag.totals[ticker])} {ticker}
            </span>
          </Link>
        ))}
        {simulated.length > 0 && (
          <Link href={appPath("/bag")} className={styles.item}>
            <span className={styles.icon}>~</span>
            <span>Simulated</span>
            <small>{usd(bag.simulatedUsd)}</small>
          </Link>
        )}
      </section>

      <div className={styles.spacer} />

      <section className={styles.group} aria-label="Get started">
        <a href={siteUrl("/#how")} className={styles.item}>
          <span className={styles.icon}>↺</span>
          How Veul pays you back
        </a>
        {suggestions.map((token) => (
          <button key={token.address} type="button" className={styles.item} onClick={() => trade.openTicket(token)}>
            <TokenAvatar token={token} size={24} />
            {token.kind === "stock" ? `Buy ${token.symbol}, earn ${token.symbol} back` : `Trade ${token.symbol}`}
            <small className={token.change24h >= 0 ? styles.up : styles.down}>
              {token.change24h >= 0 ? "+" : ""}
              {token.change24h.toFixed(1)}%
            </small>
          </button>
        ))}
        {!market.data && <span className={styles.item}>Loading markets…</span>}
      </section>
    </>
  );
}

/**
 * The left dock (after app.circuit.org): the one place where you trade, on every screen. Empty, it shows your bag
 * and ways to start; with a token it shows the ticket under a "Trade X" line. Phones get it as a bottom sheet.
 */
export function TradeDock() {
  const trade = useTrade();
  const [search, setSearch] = useState(false);

  // "/" opens the token search from anywhere, unless the trader is typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setSearch(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <aside className={`${styles.dock} ${trade.sheetOpen ? styles.sheetOpen : ""}`} aria-label="Trade">
      <button type="button" className={styles.handle} onClick={() => trade.setSheetOpen(!trade.sheetOpen)} aria-expanded={trade.sheetOpen}>
        <strong>Trade</strong>
        <span>{trade.ticket ? trade.ticket.symbol : "Pick a token"}</span>
      </button>

      <div className={styles.thread}>
        {trade.ticket ? (
          <>
            <p className={styles.bubble}>Trade {trade.ticket.symbol}</p>
            {/* Keyed by token so a new token starts a fresh ticket. */}
            <TradeTicket key={trade.ticket.address} token={trade.ticket} onClose={trade.closeTicket} />
          </>
        ) : (
          <Idle />
        )}
      </div>

      <button type="button" className={styles.ask} onClick={() => setSearch(true)}>
        <span>Search a token or paste an address</span>
        <span className={styles.askFoot}>
          <small>Every trade pays back 0.25% in stock</small>
          <kbd>/</kbd>
        </span>
      </button>

      <TokenPicker open={search} onClose={() => setSearch(false)} onPick={(token) => trade.openDrawer(token)} />
    </aside>
  );
}
