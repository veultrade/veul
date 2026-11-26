"use client";

import { useEffect, useState } from "react";
import { fetchTrades, type Trade } from "@/lib/gecko-client";
import { getJson, type MarketToken, type TokenResponse, type TokenSafety } from "@/lib/market";
import { formatAge, riskCheck } from "@/lib/risk";
import { formatFixed, formatPrice, formatUsd } from "@/lib/tokens";
import { useTrade } from "./TradeContext";
import { PriceChart } from "./PriceChart";
import { RiskBadge } from "./RiskBadge";
import { TokenAvatar } from "./TokenAvatar";
import { TokenTabs } from "./TokenTabs";
import { Flash } from "./motion";
import styles from "./TokenDrawer.module.css";

const ago = (seconds: number) => {
  const s = Math.max(0, Math.round(Date.now() / 1000 - seconds));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/**
 * One line on what moved the price, from the pool's own recent trades (no news source, no AI): the biggest trade in
 * the latest batch. Trades come from the same cached GeckoTerminal call as the Trades tab, so this costs no extra call.
 */
function MoveNote({ token }: { token: MarketToken }) {
  const [biggest, setBiggest] = useState<{ address: string; trade: Trade | null } | null>(null);
  const pool = token.pool?.id;

  useEffect(() => {
    if (!pool) return;
    let alive = true;
    fetchTrades(pool, token.address)
      .then((trades) => {
        if (!alive) return;
        const top = trades.reduce<Trade | null>((best, trade) => (!best || trade.usd > best.usd ? trade : best), null);
        setBiggest({ address: token.address, trade: top });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pool, token.address]);

  const trade = biggest?.address === token.address ? biggest.trade : null;
  if (!trade || trade.usd < 1) return <p className={styles.note}>{token.name}</p>;
  return (
    <p className={styles.note}>
      Biggest recent trade: a ${formatFixed(trade.usd, trade.usd < 100 ? 2 : 0)} {trade.side}, {ago(trade.time)}.
    </p>
  );
}

/**
 * Token detail as a drawer over the list (after app.circuit.org), so the list never disappears: price, what moved
 * it, chart, facts, risk and trades. Trade hands the token to the dock. Esc or the backdrop closes it.
 */
export function TokenDrawer() {
  const trade = useTrade();
  const listed = trade.drawer;
  const [details, setDetails] = useState<{ address: string; token: MarketToken; safety: TokenSafety } | null>(null);

  // Holders, top 10 and the honeypot check come with the per-token lookup.
  useEffect(() => {
    if (!listed) return;
    let alive = true;
    getJson<TokenResponse>(`/api/token/${listed.address}`)
      .then((body) => alive && setDetails({ address: listed.address, token: body.token, safety: body.safety }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [listed]);

  const { closeDrawer } = trade;
  useEffect(() => {
    if (!listed) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && closeDrawer();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listed, closeDrawer]);

  const current = listed && details?.address === listed.address ? details : null;
  // List numbers win (same source as the list); a token without list data (a pasted address) takes the lookup's.
  const token = listed && current && !(listed.volume24h > 0) ? current.token : listed;
  const safety = listed?.safety?.source === "gmgn" ? listed.safety : (current?.safety ?? listed?.safety ?? null);
  const risk = token ? riskCheck(token, safety) : null;
  const up = (token?.change24h ?? 0) >= 0;

  return (
    <>
      <div className={`${styles.scrim} ${token ? styles.scrimOn : ""}`} onClick={closeDrawer} aria-hidden="true" />
      <aside className={`${styles.drawer} ${token ? styles.open : ""}`} aria-label={token ? `${token.symbol} details` : undefined} aria-hidden={!token} inert={!token}>
        {token && (
          <>
            <div className={styles.body}>
              <div className={`${styles.tint} ${up ? styles.tintUp : styles.tintDown}`} aria-hidden="true" />
              <div className={styles.top}>
                <TokenAvatar token={token} size={40} />
                <div className={styles.name}>
                  <h2>
                    {token.symbol}
                    {token.kind === "stock" && <em className={styles.stock}>Stock</em>}
                  </h2>
                  <span>{token.pool ? `${token.pool.quoteSymbol} pool · Uniswap ${token.pool.version}` : "No Uniswap pool"}</span>
                </div>
                <button type="button" className={styles.close} onClick={closeDrawer} aria-label="Close">
                  ✕
                </button>
              </div>

              <div className={styles.price}>
                <Flash value={token.priceUsd} className={styles.big}>
                  {formatPrice(token.priceUsd)}
                </Flash>
                <span className={up ? styles.up : styles.down}>
                  {up ? "↗" : "↘"} {Math.abs(token.change24h).toFixed(2)}% today
                </span>
                <MoveNote token={token} />
              </div>

              <div className={styles.chart}>
                <PriceChart pool={token.pool?.id ?? null} token={token.address} />
              </div>

              <h3 className={styles.h}>About</h3>
              <dl className={styles.stats}>
                <div>
                  <dt>Volume 24h</dt>
                  <dd>{formatUsd(token.volume24h)}</dd>
                </div>
                <div>
                  <dt>Liquidity</dt>
                  <dd>{token.liquidity > 0 ? formatUsd(token.liquidity) : "–"}</dd>
                </div>
                <div>
                  <dt>Pool age</dt>
                  <dd>{formatAge(token.ageMinutes)}</dd>
                </div>
                <div>
                  <dt>Holders</dt>
                  <dd>{safety?.holders != null ? safety.holders.toLocaleString("en-US") : "–"}</dd>
                </div>
                <div>
                  <dt>Top 10 hold</dt>
                  <dd>{safety?.top10Pct != null ? `${Math.round(safety.top10Pct)}%` : "–"}</dd>
                </div>
                <div>
                  <dt>Risk</dt>
                  <dd>{risk && <RiskBadge level={risk.level} />}</dd>
                </div>
              </dl>

              <div className={styles.tabs}>
                <TokenTabs token={token} risk={risk} safety={safety} />
              </div>
            </div>

            <div className={styles.foot}>
              <button type="button" className={styles.trade} disabled={!token.pool} onClick={() => trade.openTicket(token)}>
                {token.pool ? `Trade ${token.symbol}` : "Not tradeable yet"}
              </button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
