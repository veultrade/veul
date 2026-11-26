"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getJson, type MarketToken, type QuoteResponse, type TokenResponse } from "@/lib/market";
import { FEE_RATE, PAYBACK_RATE, PAYBACK_TICKERS, formatAmount, formatFixed, formatPrice, paybackUnits } from "@/lib/tokens";
import { explorerTx, realSwap, type SwapStep } from "@/lib/swap/client";
import { appPath } from "@/lib/urls";
import { useAuth } from "./AuthProvider";
import { useBag } from "./BagStore";
import { useMarket } from "./MarketProvider";
import { TokenAvatar } from "./TokenAvatar";
import { Tween } from "./motion";
import styles from "./TradeTicket.module.css";

const AMOUNT = /^\d{0,12}(\.\d{0,18})?$/;
const MAX_ETH = 50;
const SLIPPAGES = [50, 100, 300, 500]; // basis points
const PRESETS = ["0.001", "0.005", "0.01", "0.05"];

const STEP_TEXT: Record<SwapStep, string> = {
  preparing: "Checking your balance…",
  approving: "Approve Veul's router in your wallet (one time per token)…",
  "signing-permit": "Sign the permit in your wallet…",
  building: "Building and checking the swap…",
  "confirm-in-wallet": "Confirm the swap in your wallet…",
  pending: "Waiting for Robinhood Chain to confirm…",
  done: "Done.",
};

type RealConfig = { account: string; enabled: boolean; reason: string | null; maxEth: number };
type QuoteState = { status: "idle" | "loading" | "ready" | "error"; quote: QuoteResponse | null; error: string | null; key: string };

/**
 * The trade ticket in the dock. Quotes are live (Uniswap quoters onchain, fee included).
 * Real swaps run for wallets the server allows while testing; everyone else gets a simulated swap recorded in the
 * local bag. Buy: ETH in, token out. Sell: token in, ETH out. The 0.5% fee is in ETH.
 */
export function TradeTicket({ token: listed, onClose }: { token: MarketToken; onClose: () => void }) {
  const auth = useAuth();
  const bag = useBag();
  const market = useMarket();
  const [looked, setLooked] = useState<MarketToken | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("0.005");
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [lastPayback, setLastPayback] = useState(0);
  const [quoteState, setQuoteState] = useState<QuoteState>({ status: "idle", quote: null, error: null, key: "" });
  const [real, setReal] = useState<RealConfig | null>(null);
  const [slippagePick, setSlippagePick] = useState<number | null>(null);
  const [step, setStep] = useState<SwapStep | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);

  // May this wallet make real swaps? (Server allowlist and per-trade cap while testing.)
  useEffect(() => {
    if (!auth.address) return;
    const account = auth.address;
    let alive = true;
    getJson<Omit<RealConfig, "account">>(`/api/swap?account=${account}`)
      .then((config) => alive && setReal({ ...config, account }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [auth.address]);
  const realOn = Boolean(real?.enabled && real.account === auth.address && auth.authenticated);

  // A fresh lookup confirms the current route (a list can be a minute old, and a pasted address has no list entry).
  useEffect(() => {
    let alive = true;
    getJson<TokenResponse>(`/api/token/${listed.address}`)
      .then((body) => alive && setLooked(body.token))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [listed.address]);

  // The lookup can fall back to the chain when DexScreener is slow; that copy has no volume or 24h change, so the
  // list's market numbers win when the lookup lacks them. Memoised: a new object each render would restart the quote.
  const fresh = looked?.address === listed.address ? looked : null;
  const token = useMemo(
    () => (fresh ? (fresh.volume24h > 0 ? fresh : { ...fresh, priceUsd: listed.priceUsd || fresh.priceUsd, change24h: listed.change24h, volume24h: listed.volume24h }) : listed),
    [fresh, listed],
  );

  const value = Number(amount || "0");
  const ethUsd = market.data?.ethUsd ?? 0;
  const tradeUsd = side === "buy" ? value * ethUsd : value * token.priceUsd;
  const tradeEth = ethUsd > 0 ? tradeUsd / ethUsd : 0;
  const sizeOk = value > 0 && tradeEth <= MAX_ETH;
  const canQuote = Boolean(token.pool) && sizeOk && AMOUNT.test(amount);
  const quoteKey = canQuote ? `${token.address}:${side}:${amount}` : "";

  // Live quote, 400 ms after the last change.
  useEffect(() => {
    if (!quoteKey) return;
    let alive = true;
    const timer = setTimeout(() => {
      setQuoteState({ status: "loading", quote: null, error: null, key: quoteKey });
      // Send the pool we already know, so the quote needs only onchain calls.
      const query = new URLSearchParams({ token: token.address, side, amount, symbol: token.symbol });
      const pool = token.pool;
      if (pool) {
        query.set("pool", pool.id);
        query.set("version", pool.version);
        query.set("quote", pool.quoteAddress);
        if (pool.createdAt) query.set("createdAt", String(pool.createdAt));
      }
      getJson<QuoteResponse>(`/api/quote?${query}`)
        .then((quote) => alive && setQuoteState({ status: "ready", quote, error: null, key: quoteKey }))
        .catch((reason: Error) => alive && setQuoteState({ status: "error", quote: null, error: reason.message, key: quoteKey }));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [quoteKey, token, side, amount]);

  const live = quoteState.key === quoteKey ? quoteState : { status: quoteKey ? "loading" : "idle", quote: null, error: null, key: "" };
  const quote = live.status === "ready" ? live.quote : null;
  const received = quote ? Number(quote.amountOut) : 0;
  const stockPrice = market.data?.paybacks[bag.ticker] ?? 0;
  const payback = paybackUnits(tradeUsd, stockPrice);
  const needsLogin = auth.configured && !auth.authenticated;
  const buying = side === "buy";

  // Stocks move little, memes a lot: default slippage 0.5% vs 3%, unless the trader picks one.
  const slippageBps = slippagePick ?? (token.kind === "stock" ? 50 : 300);
  const overRealCap = realOn && real ? tradeEth > real.maxEth : false;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (needsLogin) return auth.login();
    if (!quote || status === "sending") return;
    setSwapError(null);
    setLastTx(null);

    if (!realOn) {
      setStatus("sending");
      setTimeout(() => {
        const entry = bag.record({ token: token.symbol, side, eth: tradeEth, usd: tradeUsd, stockPriceUsd: stockPrice });
        setLastPayback(entry.amount);
        setStatus("done");
      }, 700);
      return;
    }

    setStatus("sending");
    try {
      const wallet = await auth.walletClient();
      const result = await realSwap({ wallet, account: auth.address as `0x${string}`, token, side, amount, slippageBps, expectedOut: quote.amountOut, onStep: setStep });
      // The ledger checks the swap onchain and books the payback; until then this is the expected amount.
      bag.trackReal(result.hash);
      setLastPayback(paybackUnits(result.usd, stockPrice));
      setLastTx(result.hash);
      setStatus("done");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Wallet "user rejected" errors are long; keep it short.
      setSwapError(/reject|denied|cancel/i.test(message) ? "You cancelled in your wallet. Nothing was sent." : message.split("\n")[0].slice(0, 200));
      setStatus("idle");
    } finally {
      setStep(null);
    }
  };

  // Switching sides carries the received amount over as the new amount to pay.
  const pickSide = (next: "buy" | "sell") => {
    if (next === side) return;
    setSide(next);
    setAmount(received > 0 ? String(Number(received.toPrecision(6))) : next === "buy" ? "0.005" : "");
    setStatus("idle");
  };

  let note: React.ReactNode = null;
  if (step) note = STEP_TEXT[step];
  else if (swapError) note = swapError;
  else if (status === "done" && lastTx) {
    note = (
      <>
        Swap confirmed.{" "}
        <a href={explorerTx(lastTx)} target="_blank" rel="noreferrer">
          View transaction
        </a>
        {bag.verified?.entries.some((entry) => entry.txHash === lastTx.toLowerCase()) ? (
          <>
            . Verified: about {formatAmount(lastPayback)} {bag.ticker} added to your <Link href={appPath("/bag")}>bag</Link>.
          </>
        ) : bag.pending.includes(lastTx) ? (
          `. Checking it onchain for your payback of about ${formatAmount(lastPayback)} ${bag.ticker}…`
        ) : (
          ". The ledger has not confirmed it yet; it checks again within 15 minutes."
        )}
      </>
    );
  } else if (status === "done") {
    note = (
      <>
        Simulated swap recorded. +{formatAmount(lastPayback)} {bag.ticker} added to your <Link href={appPath("/bag")}>bag</Link>.
      </>
    );
  } else if (!token.pool) note = `${token.symbol} has no Uniswap pool against ETH or USDG, so Veul cannot route it yet.`;
  else if (live.status === "error") note = live.error;
  else if (overRealCap && real) note = `While testing, one real trade can be at most ${real.maxEth} ETH.`;
  else if (quote) note = realOn ? `Real swap from your wallet · ${quote.route}` : (real?.reason ?? "Simulated until real swaps go live.");

  let button = live.status === "loading" ? "Getting a quote…" : `Enter an amount to ${side}`;
  if (needsLogin) button = "Log in to trade";
  else if (status === "sending") button = step === "confirm-in-wallet" || step === "approving" || step === "signing-permit" ? "Check your wallet…" : "Swapping…";
  else if (!token.pool) button = "Not tradeable yet";
  else if (!sizeOk && value > 0) button = `Max ${MAX_ETH} ETH per trade`;
  else if (overRealCap && real) button = `Max ${real.maxEth} ETH while testing`;
  else if (quote) button = `${buying ? "Buy" : "Sell"} ${token.symbol}`;

  const prices = market.data?.paybacks ?? {};
  const up = token.change24h >= 0;

  return (
    <form className={styles.ticket} onSubmit={submit} aria-label={`Trade ${token.symbol}`} noValidate>
      <div className={styles.head}>
        <TokenAvatar token={token} size={32} />
        <div className={styles.headText}>
          <strong>{token.symbol}</strong>
          <span>
            {formatPrice(token.priceUsd)} ·{" "}
            <span className={up ? styles.up : styles.down}>
              {up ? "+" : ""}
              {token.change24h.toFixed(1)}%
            </span>
          </span>
        </div>
        <span className={`${styles.mode} ${realOn ? styles.modeReal : ""}`}>{realOn ? "Real" : "Simulated"}</span>
        <button type="button" className={styles.close} onClick={onClose}>
          Close
        </button>
      </div>

      <div className={styles.sides} role="radiogroup" aria-label="Side">
        {(["buy", "sell"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={side === option}
            className={side === option ? (option === "buy" ? styles.buyOn : styles.sellOn) : ""}
            onClick={() => pickSide(option)}
          >
            {option === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      <label className={`${styles.amount} ${!amount || sizeOk ? "" : styles.invalid}`}>
        <input
          inputMode="decimal"
          value={amount}
          placeholder="0"
          onChange={(event) => {
            const next = event.target.value.replace(",", ".");
            if (!AMOUNT.test(next)) return;
            setAmount(next);
            setStatus("idle");
          }}
          aria-label={`Amount in ${buying ? "ETH" : token.symbol}`}
          aria-invalid={Boolean(amount) && !sizeOk}
        />
        <span>{buying ? "ETH" : token.symbol}</span>
      </label>
      <span className={styles.usd}>{tradeUsd > 0 ? <Tween value={tradeUsd} format={(v) => `≈ $${formatFixed(v, 2)}`} /> : " "}</span>

      {buying && (
        <div className={styles.presets}>
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={amount === preset ? styles.on : ""}
              onClick={() => {
                setAmount(preset);
                setStatus("idle");
              }}
            >
              {preset}
            </button>
          ))}
        </div>
      )}

      <dl className={styles.lines}>
        <div>
          <dt>You get</dt>
          <dd className={live.status === "loading" ? styles.pending : ""}>
            ≈ <Tween value={received} format={(v) => (v > 0 ? formatAmount(v) : "0")} /> {buying ? token.symbol : "ETH"}
          </dd>
        </div>
        <div>
          <dt>Fee {FEE_RATE * 100}%</dt>
          <dd>
            <Tween value={tradeUsd * FEE_RATE} format={(v) => `$${formatFixed(v, 2)}`} />
          </dd>
        </div>
        {realOn && quote && (
          <div>
            <dt>At least</dt>
            <dd>
              {formatAmount(received * (1 - slippageBps / 10_000))} {buying ? token.symbol : "ETH"}
            </dd>
          </div>
        )}
        {realOn && (
          <div>
            <dt>Max slippage</dt>
            <dd className={styles.slippage}>
              {SLIPPAGES.map((bps) => (
                <button key={bps} type="button" className={slippageBps === bps ? styles.on : ""} aria-pressed={slippageBps === bps} onClick={() => setSlippagePick(bps)}>
                  {bps / 100}%
                </button>
              ))}
            </dd>
          </div>
        )}
      </dl>

      <div className={styles.payback}>
        <p>
          You earn <strong>+<Tween value={payback} format={formatAmount} /> {bag.ticker}</strong> back (
          <Tween value={tradeUsd * PAYBACK_RATE} format={(v) => `$${formatFixed(v, 2)}`} />)
        </p>
        <div className={styles.stocks} role="radiogroup" aria-label="Stock to be paid back in">
          {PAYBACK_TICKERS.map((ticker) => (
            <button key={ticker} type="button" role="radio" aria-checked={bag.ticker === ticker} className={bag.ticker === ticker ? styles.on : ""} onClick={() => bag.setTicker(ticker)} title={prices[ticker] ? formatPrice(prices[ticker]) : undefined}>
              {ticker}
            </button>
          ))}
        </div>
      </div>

      <button
        className={`${styles.go} ${needsLogin ? "" : buying ? styles.goBuy : styles.goSell}`}
        disabled={!needsLogin && (!quote || status === "sending" || overRealCap)}
      >
        {button}
      </button>

      {note && (
        <p className={`${styles.note} ${status === "done" ? styles.done : ""}`} role="status">
          {note}
        </p>
      )}
    </form>
  );
}
