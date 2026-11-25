"use client";

import { useState, type FormEvent } from "react";
import { ETH_USD, FEE_RATE, PAYBACK_RATE, formatFixed, paybackStocks, sampleToken, type StockTicker } from "@/lib/sample";
import styles from "./SwapPreview.module.css";

/**
 * The swap card on the site: same layout the app will use, driven by sample numbers.
 * Changing the amount or the stock updates the quote; Swap runs a simulated confirmation.
 */
export function SwapPreview() {
  const [amount, setAmount] = useState("0.05");
  const [stock, setStock] = useState<StockTicker>("NVDA");
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");

  const eth = Number(amount.replace(",", "."));
  const valid = Number.isFinite(eth) && eth > 0 && eth <= 50;
  const stockPrice = paybackStocks.find((s) => s.ticker === stock)!.priceUsd;
  const received = valid ? (eth * ETH_USD * (1 - FEE_RATE)) / sampleToken.priceUsd : 0;
  const payback = valid ? (eth * ETH_USD * PAYBACK_RATE) / stockPrice : 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setStatus("sending");
    setTimeout(() => setStatus("done"), 700);
  };

  return (
    <form className={styles.card} onSubmit={submit} aria-label="Swap, sample data" noValidate>
      <div className={styles.head}>
        <span>Swap</span>
        <span className={`mono ${styles.tag}`}>Sample · Uniswap</span>
      </div>

      <label className={`${styles.box} ${valid ? "" : styles.invalid}`}>
        <span className={styles.label}>You pay</span>
        <span className={styles.row}>
          <input
            className={styles.amount}
            inputMode="decimal"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setStatus("idle");
            }}
            aria-label="Amount in ETH"
            aria-invalid={!valid}
          />
          <span className={styles.token}>
            <i className={`${styles.dot} ${styles.eth}`} />
            ETH
          </span>
        </span>
        <span className={`mono ${styles.sub}`}>{valid ? `≈ $${formatFixed(eth * ETH_USD, 2)}` : "Enter 0.001 to 50 ETH"}</span>
      </label>

      <div className={styles.box}>
        <span className={styles.label}>You receive</span>
        <span className={styles.row}>
          <span className={styles.amount}>{formatFixed(received, 1)}</span>
          <span className={styles.token}>
            <i className={`${styles.dot} ${styles.meme}`} />
            {sampleToken.symbol}
          </span>
        </span>
        <span className={`mono ${styles.sub}`}>{sampleToken.pool}</span>
      </div>

      <dl className={styles.lines}>
        <div>
          <dt>Fee</dt>
          <dd className="mono">{FEE_RATE * 100}%</dd>
        </div>
        <div className={styles.back}>
          <dt>Back to you as stock</dt>
          <dd className="mono">
            {formatFixed(payback, 5)} {stock}
          </dd>
        </div>
      </dl>

      <div className={styles.pick}>
        <span className={styles.label}>Pay me back in</span>
        <div className={styles.chips} role="radiogroup" aria-label="Pay me back in">
          {paybackStocks.map((s) => (
            <button
              key={s.ticker}
              type="button"
              role="radio"
              aria-checked={s.ticker === stock}
              className={`mono ${styles.chip} ${s.ticker === stock ? styles.on : ""}`}
              onClick={() => {
                setStock(s.ticker);
                setStatus("idle");
              }}
            >
              {s.ticker}
            </button>
          ))}
        </div>
      </div>

      <button className={`btn btn-main ${styles.go}`} type="submit" disabled={!valid || status === "sending"}>
        {status === "sending" ? "Confirming…" : "Swap"}
      </button>
      <p className={`${styles.note} ${status === "done" ? styles.done : ""}`} role="status">
        {status === "done"
          ? `Done (simulated). +${formatFixed(payback, 5)} ${stock} added to your stock bag.`
          : `ETH at $${ETH_USD.toLocaleString()} (sample). Paybacks are claimed weekly.`}
      </p>
    </form>
  );
}
