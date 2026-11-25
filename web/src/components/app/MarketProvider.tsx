"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getJson, type MarketResponse, type MarketToken } from "@/lib/market";

/**
 * Live market data for the whole app: trending memes, new pools, stock tokens, ETH and payback prices.
 * Loaded once and refreshed every minute while the tab is open.
 */
type Market = {
  data: MarketResponse | null;
  error: string | null;
  loading: boolean;
  /** Every token we know about, for lookups by symbol or address. */
  all: MarketToken[];
  reload: () => void;
};

const MarketContext = createContext<Market | null>(null);
const REFRESH_MS = 60_000;

export function MarketProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<MarketResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    getJson<MarketResponse>("/api/market")
      .then((next) => {
        if (!alive) return;
        setData(next);
        setError(null);
      })
      .catch((reason: Error) => alive && setError(reason.message));
    const timer = setTimeout(() => setTick((n) => n + 1), REFRESH_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const all = useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    return [...data.stocks, ...data.trending, ...data.fresh].filter((t) => !seen.has(t.address) && seen.add(t.address));
  }, [data]);

  return <MarketContext.Provider value={{ data, error, loading: !data && !error, all, reload }}>{children}</MarketContext.Provider>;
}

export function useMarket(): Market {
  const market = useContext(MarketContext);
  if (!market) throw new Error("useMarket must be used inside MarketProvider");
  return market;
}
