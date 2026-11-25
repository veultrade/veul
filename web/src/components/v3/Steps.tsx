"use client";

import { useEffect, useState } from "react";
import { Halftone } from "./Halftone";
import styles from "./Steps.module.css";

/** Three steps; the active one has the amber bar and amber dots, and the focus moves on by itself. */
const STEP_MS = 5000;

export function Steps({ media }: { media: { swap: string; earn: string; collect: string } }) {
  const steps = [
    { title: "1. Swap", text: "Trade any token on Robinhood Chain through Uniswap, from your own wallet.", src: media.swap },
    { title: "2. Earn", text: "0.25% of every trade is recorded for you, onchain, in the stock you picked.", src: media.earn },
    { title: "3. Collect", text: "Claim every Monday. The stock lands in your wallet in one transaction.", src: media.collect },
  ];
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(() => setActive((value) => (value + 1) % 3), STEP_MS);
    return () => window.clearTimeout(timer);
  }, [active, paused]);

  return (
    <ol className={styles.steps} onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}>
      {steps.map((step, index) => (
        <li key={step.title} className={`${styles.step} ${index === active ? styles.active : ""}`}>
          <button type="button" className={styles.head} onClick={() => setActive(index)} aria-pressed={index === active}>
            <span className={styles.bar} aria-hidden="true">
              <span className={styles.fill} style={{ animationDuration: `${STEP_MS}ms`, animationPlayState: paused ? "paused" : "running" }} />
            </span>
            <span className={styles.title}>{step.title}</span>
            <span className={styles.text}>{step.text}</span>
          </button>
          <div className={styles.media}>
            <Halftone src={step.src} cell={9} interactive className={styles.dots} />
          </div>
        </li>
      ))}
    </ol>
  );
}
