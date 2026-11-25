"use client";

import { useCallback, useId, useState } from "react";
import { Halftone } from "./Halftone";
import styles from "./Estimate.module.css";

/** Payback estimator: a volume slider, and the monthly payback drawn as a big halftone number. */
const PAYBACK_RATE = 0.0025;
// Slider steps, so small and large volumes are both easy to reach.
const VOLUMES = [500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000];

const money = (value: number, digits = 0) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);

export function Estimate() {
  const [step, setStep] = useState(4);
  const inputId = useId();
  const volume = VOLUMES[step];
  const payback = volume * PAYBACK_RATE;
  const shown = payback < 100 ? money(payback, 2).replace(/\.00$/, "") : money(payback);

  // Draws the number white on black at the sampler's size (one pixel per dot), as big as fits.
  const drawNumber = useCallback(
    (context: CanvasRenderingContext2D, width: number, height: number) => {
      context.fillStyle = "#fff";
      context.textAlign = "center";
      context.textBaseline = "middle";
      let size = height * 0.86;
      context.font = `700 ${size}px Arial, sans-serif`;
      const fit = (width * 0.9) / context.measureText(shown).width;
      if (fit < 1) {
        size *= fit;
        context.font = `700 ${size}px Arial, sans-serif`;
      }
      context.fillText(shown, width / 2, height / 2 + size * 0.04);
    },
    [shown],
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.controls}>
        <label htmlFor={inputId} className={styles.label}>
          Monthly volume <strong>{money(volume)}</strong>
        </label>
        <input
          id={inputId}
          type="range"
          min={0}
          max={VOLUMES.length - 1}
          step={1}
          value={step}
          onChange={(event) => setStep(Number(event.target.value))}
          className={styles.range}
          aria-valuetext={money(volume)}
        />
        <p className={styles.result} aria-live="polite">
          About <strong>{shown}</strong> a month back in stock, at 0.25% of volume.
        </p>
      </div>
      <div className={styles.number}>
        <Halftone draw={drawNumber} drawKey={shown} cell={10} maxDot={0.95} floor={0.2} interactive />
      </div>
    </div>
  );
}
