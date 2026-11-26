"use client";

import { useEffect, useState } from "react";
import { getJson } from "@/lib/market";
import { USDG_UNIT, type LedgerEntry } from "@/lib/ledger";
import { explorerTx } from "@/lib/swap/client";
import { FEE_RATE, PAYBACK_RATE, formatAmount, formatFixed } from "@/lib/tokens";
import { useAuth } from "./AuthProvider";
import { useBag } from "./BagStore";
import { useMarket } from "./MarketProvider";
import { Skeleton } from "./motion";
import { TokenAvatar } from "./TokenAvatar";
import calm from "./Calm.module.css";
import styles from "./ActivityScreen.module.css";

type Tab = "everyone" | "yours";

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const ago = (seconds: number) => {
  const s = Math.max(0, Math.round(Date.now() / 1000 - seconds));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};
const units = (amount: string, decimals: number) => Number(BigInt(amount)) / 10 ** decimals;

/** One verified swap as a feed row: what was traded, by whom, what it paid back. Opens the transaction. */
function EntryRow({ entry, mine }: { entry: LedgerEntry; mine: boolean }) {
  const market = useMarket();
  const known = market.all.find((token) => token.address === entry.token.toLowerCase());
  const symbol = entry.tokenSymbol ?? known?.symbol ?? "token";
  const verb = entry.side === "buy" ? "Bought" : "Sold";
  const payback = entry.paybackUsdg / USDG_UNIT;
  return (
    <a className={calm.row} href={explorerTx(entry.txHash)} target="_blank" rel="noreferrer">
      <TokenAvatar token={known ?? { symbol, kind: "meme" }} size={32} />
      <span className={calm.name}>
        <strong>
          {verb} {formatAmount(units(entry.tokenAmount, entry.tokenDecimals))} {symbol}
        </strong>
        <small>
          {mine ? "You" : short(entry.wallet)} · {ago(entry.blockTime)} · paid back ${formatFixed(payback, payback < 0.01 ? 4 : 2)}
          {entry.paybackStatus === "claimed" ? " · claimed" : ""}
        </small>
      </span>
      <span className={calm.end}>${formatFixed(entry.usd, 2)}</span>
    </a>
  );
}

function Everyone() {
  const auth = useAuth();
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getJson<{ entries: LedgerEntry[] }>("/api/activity")
        .then((body) => alive && (setEntries(body.entries), setError(null)))
        .catch((reason: Error) => alive && setError(reason.message));
    void load();
    const timer = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (error && !entries) return <p className={calm.empty}>Activity could not load: {error}</p>;
  if (!entries)
    return (
      <>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={calm.row}>
            <Skeleton width={32} height={32} />
            <span className={calm.name}>
              <Skeleton width="55%" height={14} />
            </span>
          </div>
        ))}
      </>
    );
  if (entries.length === 0) return <p className={calm.empty}>No verified trades yet. The first real swap through Veul shows up here.</p>;
  const me = auth.address?.toLowerCase();
  return (
    <>
      {entries.map((entry) => (
        <EntryRow key={entry.txHash} entry={entry} mine={entry.wallet.toLowerCase() === me} />
      ))}
    </>
  );
}

function Yours() {
  const auth = useAuth();
  const bag = useBag();
  const verified = bag.verified?.entries ?? [];
  const time = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  if (verified.length === 0 && bag.pending.length === 0 && bag.paybacks.length === 0) {
    return (
      <p className={calm.empty}>
        {auth.authenticated ? "No trades yet. Trades you make show up here, with the fee and the payback." : "Log in to see your trades. Simulated trades from this browser show up here too."}
      </p>
    );
  }
  return (
    <>
      {bag.pending.map((hash) => (
        <a key={hash} className={calm.row} href={explorerTx(hash)} target="_blank" rel="noreferrer">
          <span className={styles.dot} aria-hidden="true" />
          <span className={calm.name}>
            <strong>Real swap</strong>
            <small>Checking it onchain…</small>
          </span>
        </a>
      ))}
      {verified.map((entry) => (
        <EntryRow key={entry.txHash} entry={entry} mine />
      ))}
      {bag.paybacks.map((entry) => (
        <div key={entry.id} className={calm.row}>
          <TokenAvatar token={{ symbol: entry.token, kind: "meme" }} size={32} />
          <span className={calm.name}>
            <strong>
              {entry.side === "buy" ? "Bought" : "Sold"} {entry.token} <em className={styles.sim}>Simulated</em>
            </strong>
            <small>
              {time.format(new Date(entry.at))} · {formatFixed(entry.eth, 4)} ETH · +{formatAmount(entry.amount)} {entry.ticker}
            </small>
          </span>
          <span className={calm.end}>${formatFixed(entry.usd ?? 0, 2)}</span>
        </div>
      ))}
    </>
  );
}

/**
 * Activity (after Circuit's feed): every verified swap through Veul and what it paid back, or only yours.
 * Real swaps count only after the ledger checks them onchain; simulated ones are marked.
 */
export function ActivityScreen() {
  const [tab, setTab] = useState<Tab>("everyone");
  return (
    <div className={calm.col}>
      <h1 className={calm.title}>Activity</h1>
      <div className={calm.tabs} role="tablist" aria-label="Whose trades">
        {(["everyone", "yours"] as const).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? calm.tabOn : ""} onClick={() => setTab(key)}>
            {key === "everyone" ? "Everyone" : "Yours"}
          </button>
        ))}
      </div>
      <div className={calm.list}>{tab === "everyone" ? <Everyone /> : <Yours />}</div>
      <p className={calm.foot}>
        Fee {FEE_RATE * 100}% per trade, {PAYBACK_RATE * 100}% of it back to the trader in stock. Each row opens its transaction on the explorer.
      </p>
    </div>
  );
}
