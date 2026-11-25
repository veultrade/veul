"use client";

import { useState } from "react";
import styles from "./EarnTabs.module.css";

/** Side list of launch stocks; the panel shows what that stock is and a strip of sample paybacks into it. */
const STOCKS = [
  { ticker: "NVDA", name: "NVIDIA", note: "The chips behind most AI models." },
  { ticker: "SPY", name: "S&P 500 ETF", note: "Five hundred US companies in one." },
  { ticker: "TSLA", name: "Tesla", note: "Cars, batteries and robots." },
  { ticker: "GOOGL", name: "Alphabet", note: "Search, YouTube and Gemini." },
];

// Sample paybacks for the moving strip: which token was traded, the volume, and what came back. Labelled as samples.
const SAMPLES = [
  { from: "BONK", volume: "$740", back: "$1.85" },
  { from: "ETH", volume: "$2,400", back: "$6.00" },
  { from: "PEPE", volume: "$310", back: "$0.78" },
  { from: "WIF", volume: "$1,120", back: "$2.80" },
  { from: "MOG", volume: "$560", back: "$1.40" },
  { from: "DOGE", volume: "$880", back: "$2.20" },
];

export function EarnTabs() {
  const [active, setActive] = useState(0);
  const stock = STOCKS[active];

  return (
    <div className={styles.layout}>
      <div className={styles.tabs} role="tablist" aria-label="Launch stocks">
        {STOCKS.map((item, index) => (
          <button
            key={item.ticker}
            type="button"
            role="tab"
            id={`earn-tab-${item.ticker}`}
            aria-selected={index === active}
            aria-controls="earn-panel"
            className={styles.tab}
            onClick={() => setActive(index)}
          >
            {item.ticker}
          </button>
        ))}
      </div>

      <div className={styles.panel} role="tabpanel" id="earn-panel" aria-labelledby={`earn-tab-${stock.ticker}`}>
        <div className={styles.panelHead}>
          <h3>
            {stock.name} <span>{stock.ticker}</span>
          </h3>
          <p>{stock.note} Every swap you make on Veul adds a slice of it to your stock bag.</p>
          <div className={styles.sources}>
            <span>Paid back from</span>
            <span className={styles.chip}>Memecoins</span>
            <span className={styles.chip}>ETH</span>
            <span className={styles.chipMuted}>Any token on Robinhood Chain</span>
          </div>
        </div>

        {/* Two rows moving in opposite directions; the list is doubled so the loop has no seam. */}
        <div className={styles.strip} aria-label="Sample paybacks">
          {[0, 1].map((row) => (
            <div key={row} className={`${styles.track} ${row === 1 ? styles.trackReverse : ""}`}>
              {[...SAMPLES, ...SAMPLES].map((sample, index) => (
                <div key={index} className={styles.card} aria-hidden={index >= SAMPLES.length || undefined}>
                  <div className={styles.cardTop}>
                    <span className={styles.cardIcon}>{stock.ticker.slice(0, 1)}</span>
                    <span className={styles.cardTitle}>
                      {sample.from} swap
                    </span>
                    <span className={styles.cardValue}>{sample.back}</span>
                  </div>
                  <div className={styles.cardTags}>
                    <span>{sample.volume} traded</span>
                    <span>paid in {stock.ticker}</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className={styles.sampleNote}>Sample paybacks at 0.25% of volume.</p>
      </div>
    </div>
  );
}
