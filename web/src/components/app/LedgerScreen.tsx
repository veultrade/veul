"use client";

import Link from "next/link";
import { FEE_RATE, PAYBACK_RATE, formatAmount, formatFixed } from "@/lib/tokens";
import { explorerTx } from "@/lib/swap/client";
import { USDG_UNIT } from "@/lib/ledger";
import { useBag } from "./BagStore";
import styles from "./Screens.module.css";
import { appPath } from "@/lib/urls";

const time = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ethOf = (wei: string) => Number(BigInt(wei)) / 1e18;

/**
 * Ledger: one line per trade with the fee taken and the payback owed.
 * Real swaps come from the server ledger (checked onchain) and link to their transaction;
 * swaps still being checked and simulated swaps from this browser are listed too, clearly marked.
 */
export function LedgerScreen() {
  const bag = useBag();
  const verified = bag.verified?.entries ?? [];
  const empty = verified.length === 0 && bag.pending.length === 0 && bag.paybacks.length === 0;

  return (
    <div className={styles.page}>
      <header className={styles.title}>
        <h1>Ledger</h1>
        <p>
          Every fee and every payback, line by line. Fee {FEE_RATE * 100}%, back to you {PAYBACK_RATE * 100}%. Real swaps are checked onchain before
          they count.
        </p>
      </header>

      {empty ? (
        <div className={styles.empty}>
          <p>No trades yet. Swaps you make show up here.</p>
          <Link href={appPath()} className="btn btn-quiet btn-sm">
            Go to swap
          </Link>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Trade</th>
                <th scope="col" className={styles.num}>
                  Size
                </th>
                <th scope="col" className={styles.num}>
                  Fee
                </th>
                <th scope="col" className={styles.num}>
                  Payback
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {bag.pending.map((hash) => (
                <tr key={hash}>
                  <td className="mono" data-label="Time">
                    –
                  </td>
                  <td data-label="Trade">Real swap</td>
                  <td className={`mono ${styles.num}`} data-label="Size">
                    –
                  </td>
                  <td className={`mono ${styles.num}`} data-label="Fee">
                    –
                  </td>
                  <td className={`mono ${styles.num}`} data-label="Payback">
                    –
                  </td>
                  <td data-label="Status">
                    <a className={`mono ${styles.pill}`} href={explorerTx(hash)} target="_blank" rel="noreferrer">
                      Checking
                    </a>
                  </td>
                </tr>
              ))}

              {verified.map((entry) => {
                const eth = ethOf(entry.ethWei);
                return (
                  <tr key={entry.txHash}>
                    <td className="mono" data-label="Time">
                      {time.format(new Date(entry.blockTime * 1000))}
                    </td>
                    <td data-label="Trade">
                      <span>
                        <span className={entry.side === "buy" ? styles.buy : styles.sell}>{entry.side === "buy" ? "Buy" : "Sell"}</span> {entry.tokenSymbol ?? "token"}
                      </span>
                    </td>
                    <td className={`mono ${styles.num}`} data-label="Size">
                      {formatFixed(eth, 4)} ETH
                    </td>
                    <td className={`mono ${styles.num}`} data-label="Fee">
                      ${formatFixed(ethOf(entry.feeWei) * entry.ethUsd, 2)}
                    </td>
                    <td className={`mono ${styles.num} ${styles.gold}`} data-label="Payback">
                      +${formatFixed(entry.paybackUsdg / USDG_UNIT, 4)}
                    </td>
                    <td data-label="Status">
                      <a className={`mono ${styles.pill} ${styles.pillReal}`} href={explorerTx(entry.txHash)} target="_blank" rel="noreferrer">
                        {entry.paybackStatus === "claimed" ? "Claimed" : "Verified"}
                      </a>
                    </td>
                  </tr>
                );
              })}

              {bag.paybacks.map((entry) => (
                <tr key={entry.id}>
                  <td className="mono" data-label="Time">
                    {time.format(new Date(entry.at))}
                  </td>
                  <td data-label="Trade">
                    <span>
                      <span className={entry.side === "buy" ? styles.buy : styles.sell}>{entry.side === "buy" ? "Buy" : "Sell"}</span> {entry.token}
                    </span>
                  </td>
                  <td className={`mono ${styles.num}`} data-label="Size">
                    {formatFixed(entry.eth, 4)} ETH
                  </td>
                  <td className={`mono ${styles.num}`} data-label="Fee">
                    ${formatFixed((entry.usd ?? 0) * FEE_RATE, 2)}
                  </td>
                  <td className={`mono ${styles.num} ${styles.gold}`} data-label="Payback">
                    +{formatAmount(entry.amount)} {entry.ticker}
                  </td>
                  <td data-label="Status">
                    <span className={`mono ${styles.pill}`}>Simulated</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
