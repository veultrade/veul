"use client";

import { PAYBACK_RATE } from "@/lib/tokens";
import { useAuth } from "./AuthProvider";
import { useBag } from "./BagStore";
import { CopyButton } from "./CopyButton";
import screens from "./Screens.module.css";
import styles from "./Features.module.css";

/*
  Launch rates, decided 2026-11-20 (docs/rates.md): one flat payback for everyone, no volume tiers.
  Referral: a share of each referred friend's volume for their first 180 days, never for the referrer's own wallets.
*/
const REFERRAL_RATE = 0.05;
const REFERRAL_DAYS = 180;

/** Rewards: the flat payback, and the invite link that pays in stock. */
export function RewardsScreen() {
  const auth = useAuth();
  const bag = useBag();
  // Short code from the wallet address; the real code is issued by the server with the ledger.
  const code = auth.address ? auth.address.slice(2, 8).toUpperCase() : "";
  const link = code ? `https://stockup.xyz/r/${code}` : "";

  return (
    <div className={screens.page}>
      <header className={screens.title}>
        <h1>Rewards</h1>
        <p>One payback rate for everyone, plus stock for every friend you bring. Every reward is paid in the stock you collect.</p>
      </header>

      <div className={styles.grid3}>
        <div className={styles.tier}>
          <strong>Your payback</strong>
          <span className={styles.rate}>{PAYBACK_RATE * 100}%</span>
          <small>of every trade, for everyone. No tiers, no volume targets.</small>
        </div>
        <div className={styles.tier}>
          <strong>Per friend</strong>
          <span className={styles.rate}>{REFERRAL_RATE}%</span>
          <small>of their trades for their first {REFERRAL_DAYS} days, on top of their own payback.</small>
        </div>
        <div className={styles.tier}>
          <strong>Your net cost</strong>
          <span className={styles.rate}>0.25%</span>
          <small>0.5% fee minus 0.25% back. Fomo charges 0.5%, GMGN 1%.</small>
        </div>
      </div>

      <section className={styles.panel} aria-labelledby="ref-title">
        <div className={styles.panelHead}>
          <h2 id="ref-title">Invite friends</h2>
          <span className={`mono ${styles.tag}`}>Not live yet</span>
        </div>
        <p>
          Share your link. When a friend trades, you get {REFERRAL_RATE}% of their trade as {bag.ticker} for {REFERRAL_DAYS} days. They lose nothing: their own {PAYBACK_RATE * 100}% stays the same. Your own extra wallets do not count.
        </p>
        {link ? (
          <div className={styles.copyRow}>
            <code>{link}</code>
            <CopyButton value={link} label="Copy link" />
          </div>
        ) : (
          <p>{auth.configured ? "Log in to get your invite link." : "Login is not switched on in this preview."}</p>
        )}
        <div className={styles.grid3}>
          <div className={styles.stat}>
            <span>Friends joined</span>
            <strong>0</strong>
          </div>
          <div className={styles.stat}>
            <span>Their volume</span>
            <strong>$0</strong>
          </div>
          <div className={styles.stat}>
            <span>Earned</span>
            <strong className={styles.gold}>0 {bag.ticker}</strong>
          </div>
        </div>
      </section>
    </div>
  );
}
