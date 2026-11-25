"use client";

import { useEffect, useRef, useState } from "react";
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { RateLimitError, TIMEFRAMES, fetchCandles, type Timeframe } from "@/lib/gecko-client";
import styles from "./PriceChart.module.css";

/**
 * Candlestick chart of one token in its Uniswap pool, with volume underneath. Candles come from GeckoTerminal in
 * the visitor's browser (lib/gecko-client.ts). States: loading, busy (rate limited, retrying), new pool (few or no
 * candles), error. Refreshes every 30 s while open.
 */

const UP = "#2fc27a";
const DOWN = "#ef5a67";

/** Readable prices from $0.0000012 to $59,027: more decimals for smaller prices. */
function formatPrice(value: number) {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (abs >= 1) return value.toFixed(2);
  if (abs === 0) return "0";
  const decimals = Math.min(10, Math.max(4, 2 - Math.floor(Math.log10(abs)) + 2));
  return value.toFixed(decimals);
}

type State = { status: "loading" | "ready" | "busy" | "empty" | "error"; count: number; message?: string };

export function PriceChart({ pool, token }: { pool: string | null; token: string }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [state, setState] = useState<State>({ status: "loading", count: 0 });

  // One chart per mount; series data changes with the pool and timeframe.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const api = createChart(element, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#64635f", fontFamily: "Geist Mono, ui-monospace, monospace", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: "rgba(255,255,255,0.03)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#3a3a37", labelBackgroundColor: "#232321" }, horzLine: { color: "#3a3a37", labelBackgroundColor: "#232321" } },
      rightPriceScale: { borderColor: "#232321", scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: "#232321", timeVisible: true, secondsVisible: false, rightOffset: 4 },
      localization: { priceFormatter: formatPrice },
    });
    candles.current = api.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderVisible: false,
      priceFormat: { type: "custom", formatter: formatPrice, minMove: 1e-10 },
    });
    volume.current = api.addSeries(HistogramSeries, { priceScaleId: "volume", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    api.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    chart.current = api;
    return () => {
      api.remove();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    if (!pool) return;
    let alive = true;
    const load = async (first: boolean) => {
      if (first) setState({ status: "loading", count: 0 });
      try {
        const list = await fetchCandles(pool, token, timeframe);
        if (!alive || !candles.current || !volume.current) return;
        candles.current.setData(list.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
        volume.current.setData(list.map((c) => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? "rgba(47,194,122,0.28)" : "rgba(239,90,103,0.28)" })));
        // Fit after layout: on the first load the chart may not have its final size yet.
        if (first) requestAnimationFrame(() => chart.current?.timeScale().fitContent());
        setState({ status: list.length === 0 ? "empty" : "ready", count: list.length });
      } catch (error) {
        if (!alive) return;
        setState((previous) =>
          previous.status === "ready"
            ? previous // keep the last good chart; the next refresh tries again
            : { status: error instanceof RateLimitError ? "busy" : "error", count: 0, message: error instanceof Error ? error.message : String(error) },
        );
      }
    };
    void load(true);
    const timer = setInterval(() => void load(false), 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [pool, token, timeframe]);

  return (
    <div className={styles.wrap}>
      <div className={styles.tools}>
        {TIMEFRAMES.map((frame) => (
          <button key={frame.key} type="button" className={timeframe === frame.key ? styles.on : ""} onClick={() => setTimeframe(frame.key)} aria-pressed={timeframe === frame.key}>
            {frame.label}
          </button>
        ))}
        <span className={styles.source}>
          {state.status === "ready" && state.count < 20 ? "New pool · few trades so far · " : ""}GeckoTerminal · USD
        </span>
      </div>
      <div className={styles.canvas}>
        <div ref={box} className={styles.chart} />
        {!pool && <p className={styles.overlay}>This token has no Uniswap pool, so there is no chart.</p>}
        {pool && state.status === "loading" && <p className={styles.overlay}>Loading the chart…</p>}
        {pool && state.status === "busy" && <p className={styles.overlay}>Chart data is busy right now. Retrying…</p>}
        {pool && state.status === "empty" && <p className={styles.overlay}>No trades in this pool yet for this time range.</p>}
        {pool && state.status === "error" && <p className={styles.overlay}>{state.message}</p>}
      </div>
    </div>
  );
}
