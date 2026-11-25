"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PAYBACK_TICKERS, paybackUnits, type PaybackTicker } from "@/lib/tokens";
import { USDG_UNIT, fetchWalletLedger, reportSwap, type WalletLedger } from "@/lib/ledger";
import { useAuth } from "./AuthProvider";
import { useMarket } from "./MarketProvider";

/**
 * Stock bag state.
 * - Real swaps: the server ledger (verified onchain, session 1.5) is the only source. The app reports each
 *   confirmed swap; until the server has it, its hash waits in `pending` (kept in this browser, retried on load).
 * - Simulated swaps (wallets without real swaps): kept in localStorage per browser, as before.
 * Paybacks are owed in USDG and paid out in the stock chosen at claim time, so verified paybacks are shown
 * in the currently chosen stock at its live price.
 */
export type Payback = { id: string; at: string; side: "buy" | "sell"; token: string; eth: number; usd: number; ticker: PaybackTicker; amount: number };

type Bag = {
  ticker: PaybackTicker;
  setTicker: (ticker: PaybackTicker) => void;
  /** Simulated swaps in this browser. */
  paybacks: Payback[];
  /** Verified real swaps of the signed-in wallet (null while loading or signed out). */
  verified: WalletLedger | null;
  /** Real swaps sent but not yet in the ledger. */
  pending: string[];
  /** Stock amounts per ticker: simulated paybacks, plus verified owed paybacks in the chosen stock. */
  totals: Record<PaybackTicker, number>;
  /** USD value of everything owed: verified (USDG) plus simulated. */
  totalUsd: number;
  record: (trade: { token: string; side: "buy" | "sell"; eth: number; usd: number; stockPriceUsd: number }) => Payback;
  /** Hand a confirmed real swap to the ledger. */
  trackReal: (txHash: string) => void;
};

const KEY = "stockup-preview-bag-v2"; // v2: amounts from live prices
const PENDING_KEY = "stockup-ledger-pending-v1";
const BagContext = createContext<Bag | null>(null);

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function BagProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const market = useMarket();
  const [ticker, setTicker] = useState<PaybackTicker>("NVDA");
  const [paybacks, setPaybacks] = useState<Payback[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [verified, setVerified] = useState<WalletLedger | null>(null);
  const restored = useRef(false);
  const reporting = useRef(new Set<string>());

  // Restore after hydration (the server has no storage); storage may be blocked, so every access is guarded.
  useEffect(() => {
    const saved = readStorage(KEY);
    const savedPending = readStorage(PENDING_KEY);
    const timer = setTimeout(() => {
      const hashes: string[] = [];
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (PAYBACK_TICKERS.includes(parsed.ticker)) setTicker(parsed.ticker);
          if (Array.isArray(parsed.paybacks)) {
            // Real swaps used to be kept here (session 1.4); they now belong to the server ledger.
            for (const entry of parsed.paybacks) if (entry?.txHash) hashes.push(entry.txHash);
            setPaybacks(parsed.paybacks.filter((entry: { txHash?: string }) => !entry?.txHash));
          }
        } catch {}
      }
      if (savedPending) {
        try {
          const list = JSON.parse(savedPending);
          if (Array.isArray(list)) hashes.push(...list.filter((hash) => typeof hash === "string"));
        } catch {}
      }
      setPending([...new Set(hashes)]);
      restored.current = true;
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    writeStorage(KEY, JSON.stringify({ ticker, paybacks }));
    writeStorage(PENDING_KEY, JSON.stringify(pending));
  }, [ticker, paybacks, pending]);

  const account = auth.authenticated ? auth.address : null;
  const refresh = useCallback(async () => {
    if (!account) return;
    try {
      const ledger = await fetchWalletLedger(account);
      setVerified(ledger);
      // Anything the server already has is no longer pending.
      const known = new Set(ledger.entries.map((entry) => entry.txHash.toLowerCase()));
      setPending((list) => list.filter((hash) => !known.has(hash.toLowerCase())));
    } catch {
      // Keep the last good copy; the next refresh tries again.
    }
  }, [account]);

  useEffect(() => {
    if (!account) {
      const timer = setTimeout(() => setVerified(null), 0);
      return () => clearTimeout(timer);
    }
    const first = setTimeout(refresh, 0);
    const timer = setInterval(refresh, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [account, refresh]);

  // Report every pending hash once per page load; "rejected" ones are dropped, "pending" ones stay for later.
  useEffect(() => {
    for (const hash of pending) {
      if (reporting.current.has(hash)) continue;
      reporting.current.add(hash);
      void reportSwap(hash).then(async (result) => {
        if (result.status === "recorded" || result.status === "already" || result.status === "rejected") {
          // Load the ledger first, so the row never disappears from both lists for a moment.
          await refresh();
          setPending((list) => list.filter((item) => item !== hash));
        }
      });
    }
  }, [pending, refresh]);

  const trackReal = useCallback((txHash: string) => {
    setPending((list) => (list.includes(txHash) ? list : [txHash, ...list]));
  }, []);

  const prices = market.data?.paybacks;
  const owedUsd = (verified?.totals.owedUsdg ?? 0) / USDG_UNIT;

  const { totals, totalUsd } = useMemo(() => {
    const sum = Object.fromEntries(PAYBACK_TICKERS.map((t) => [t, 0])) as Record<PaybackTicker, number>;
    let usd = owedUsd;
    for (const p of paybacks) {
      sum[p.ticker] += p.amount;
      usd += p.amount * (prices?.[p.ticker] ?? 0);
    }
    const price = prices?.[ticker] ?? 0;
    if (price > 0) sum[ticker] += owedUsd / price;
    return { totals: sum, totalUsd: usd };
  }, [paybacks, prices, ticker, owedUsd]);

  const record = useCallback(
    ({ token, side, eth, usd, stockPriceUsd }: { token: string; side: "buy" | "sell"; eth: number; usd: number; stockPriceUsd: number }) => {
      const entry: Payback = { id: crypto.randomUUID(), at: new Date().toISOString(), side, token, eth, usd, ticker, amount: paybackUnits(usd, stockPriceUsd) };
      setPaybacks((list) => [entry, ...list]);
      return entry;
    },
    [ticker],
  );

  return <BagContext.Provider value={{ ticker, setTicker, paybacks, verified, pending, totals, totalUsd, record, trackReal }}>{children}</BagContext.Provider>;
}

export function useBag(): Bag {
  const bag = useContext(BagContext);
  if (!bag) throw new Error("useBag must be used inside BagProvider");
  return bag;
}
