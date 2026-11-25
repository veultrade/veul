"use client";

import { useEffect, useState } from "react";
import { RateLimitError, fetchTrades, type Trade } from "@/lib/gecko-client";
import type { MarketToken, TokenSafety } from "@/lib/market";
import type { RiskResult } from "@/lib/risk";
import { explorerTx } from "@/lib/swap/client";
import { USDG_UNIT } from "@/lib/ledger";
import { formatAmount, formatFixed, formatPrice } from "@/lib/tokens";
import { useBag } from "./BagStore";
import { Skeleton } from "./motion";
import styles from "./TokenTabs.module.css";

/** Under the chart: the pool's live trades, the risk check, and this wallet's own verified trades in the token. */

const ago = (seconds: number) => {
  const s = Math.max(0, Math.round(Date.now() / 1000 - seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

function Trades({ pool, token }: { pool: string; token: string }) {
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const list = await fetchTrades(pool, token);
        if (!alive) return;
        setTrades(list);
        setNote(null);
      } catch (error) {
        if (alive) setNote(error instanceof RateLimitError ? "Trades are busy right now. Retrying…" : "Trades could not load.");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [pool, token]);

  if (!trades) {
    return note ? (
      <p className={styles.empty}>{note}</p>
    ) : (
      <div className={styles.skeletons}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} height={14} />
        ))}
      </div>
    );
  }
  if (trades.length === 0) return <p className={styles.empty}>No trades in this pool yet.</p>;

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Age</th>
          <th>Type</th>
          <th>USD</th>
          <th>Amount</th>
          <th>Price</th>
          <th>Wallet</th>
        </tr>
      </thead>
      <tbody>
        {trades.slice(0, 60).map((trade) => (
          <tr key={trade.hash + trade.wallet + trade.usd}>
            <td className={`mono ${styles.faint}`}>{ago(trade.time)}</td>
            <td className={trade.side === "buy" ? styles.buy : styles.sell}>{trade.side === "buy" ? "Buy" : "Sell"}</td>
            <td className="mono">${formatFixed(trade.usd, 2)}</td>
            <td className="mono">{formatAmount(trade.tokenAmount)}</td>
            <td className="mono">{formatPrice(trade.priceUsd)}</td>
            <td className="mono">
              <a href={explorerTx(trade.hash)} target="_blank" rel="noreferrer" className={styles.wallet}>
                {short(trade.wallet)}
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Risk({ risk, safety }: { risk: RiskResult; safety: TokenSafety | null }) {
  const rows: [string, string][] = [
    ["Holders", safety?.holders != null ? safety.holders.toLocaleString("en-US") : "–"],
    ["Top 10 hold", safety?.top10Pct != null ? `${Math.round(safety.top10Pct)}%` : "–"],
    ["Dev holds", safety?.devPct != null ? `${formatFixed(safety.devPct, 1)}%` : "–"],
    ["Honeypot", safety?.honeypot == null ? "–" : safety.honeypot ? "Yes" : "No"],
    ["Snipers", safety?.snipers != null ? String(safety.snipers) : "–"],
    ["Bundled buys", safety?.bundlePct != null ? `${Math.round(safety.bundlePct)}%` : "–"],
  ];
  return (
    <div className={styles.risk}>
      <p className={styles.summary}>{risk.summary}</p>
      <ul className={styles.flags}>
        {risk.flags.map((flag) => (
          <li key={flag.label} className={styles[flag.level]}>
            {flag.label}
          </li>
        ))}
      </ul>
      <dl className={styles.grid}>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="mono">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Mine({ token }: { token: MarketToken }) {
  const bag = useBag();
  const entries = (bag.verified?.entries ?? []).filter((entry) => entry.token.toLowerCase() === token.address.toLowerCase());
  if (!bag.verified) return <p className={styles.empty}>Log in to see your trades in {token.symbol}.</p>;
  if (entries.length === 0) return <p className={styles.empty}>You have no verified trades in {token.symbol} yet.</p>;
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Age</th>
          <th>Type</th>
          <th>USD</th>
          <th>Amount</th>
          <th>Paid back</th>
          <th>Tx</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.txHash}>
            <td className={`mono ${styles.faint}`}>{ago(entry.blockTime)}</td>
            <td className={entry.side === "buy" ? styles.buy : styles.sell}>{entry.side === "buy" ? "Buy" : "Sell"}</td>
            <td className="mono">${formatFixed(entry.usd, 2)}</td>
            <td className="mono">{formatAmount(Number(entry.tokenAmount) / 10 ** entry.tokenDecimals)}</td>
            <td className={`mono ${styles.back}`}>${formatFixed(entry.paybackUsdg / USDG_UNIT, 4)}</td>
            <td className="mono">
              <a href={explorerTx(entry.txHash)} target="_blank" rel="noreferrer" className={styles.wallet}>
                {short(entry.txHash)}
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TokenTabs({ token, risk, safety }: { token: MarketToken | null; risk: RiskResult | null; safety: TokenSafety | null }) {
  const bag = useBag();
  const [tab, setTab] = useState<"trades" | "risk" | "mine">("trades");
  const mineCount = token ? (bag.verified?.entries ?? []).filter((e) => e.token.toLowerCase() === token.address.toLowerCase()).length : 0;

  return (
    <div className={styles.wrap}>
      <div className={styles.tabs} role="tablist">
        <button type="button" role="tab" aria-selected={tab === "trades"} className={tab === "trades" ? styles.on : ""} onClick={() => setTab("trades")}>
          Trades
        </button>
        <button type="button" role="tab" aria-selected={tab === "risk"} className={tab === "risk" ? styles.on : ""} onClick={() => setTab("risk")}>
          Risk check
        </button>
        <button type="button" role="tab" aria-selected={tab === "mine"} className={tab === "mine" ? styles.on : ""} onClick={() => setTab("mine")}>
          Your trades{mineCount > 0 && <span className={styles.count}>{mineCount}</span>}
        </button>
      </div>
      <div className={styles.body} role="tabpanel">
        {!token ? (
          <p className={styles.empty}>Loading…</p>
        ) : tab === "trades" ? (
          token.pool ? <Trades pool={token.pool.id} token={token.address} /> : <p className={styles.empty}>No Uniswap pool, so no trades to show.</p>
        ) : tab === "risk" ? (
          risk ? <Risk risk={risk} safety={safety} /> : null
        ) : (
          <Mine token={token} />
        )}
      </div>
    </div>
  );
}
