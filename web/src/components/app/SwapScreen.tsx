"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { getJson, type MarketToken, type QuoteResponse, type TokenResponse, type TokenSafety } from "@/lib/market";
import { FEE_RATE, PAYBACK_RATE, PAYBACK_TICKERS, findIn, formatAmount, formatFixed, formatPrice, formatUsd, paybackUnits } from "@/lib/tokens";
import { riskCheck } from "@/lib/risk";
import { explorerTx, realSwap, type SwapStep } from "@/lib/swap/client";
import { useAuth } from "./AuthProvider";
import { useBag } from "./BagStore";
import { useMarket } from "./MarketProvider";
import { RiskBadge } from "./RiskBadge";
import { TokenAvatar } from "./TokenAvatar";
import { TokenPicker } from "./TokenPicker";
import { ChevronIcon, FlipIcon } from "./icons";
import { MarketRail } from "./MarketRail";
import { Tween } from "./motion";
import styles from "./SwapScreen.module.css";
import { appPath } from "@/lib/urls";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const AMOUNT = /^\d{0,12}(\.\d{0,18})?$/;
const MAX_ETH = 50;
const SLIPPAGES = [50, 100, 300, 500]; // basis points

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
 * Swap screen. Prices and quotes are live (Uniswap quoters onchain, fee included).
 * Real swaps (session 1.4) run for wallets the server allows while testing; everyone else gets a simulated
 * swap recorded in the local bag. Buy: ETH in, token out. Sell: token in, ETH out. The 0.5% fee is in ETH.
 */
export function SwapScreen({ initialToken }: { initialToken?: string }) {
  const auth = useAuth();
  const bag = useBag();
  const market = useMarket();
  const [picked, setPicked] = useState<MarketToken | null>(null);
  const [details, setDetails] = useState<{ address: string; token: MarketToken; safety: TokenSafety } | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("0.05");
  const [picker, setPicker] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [lastPayback, setLastPayback] = useState(0);
  const [quoteState, setQuoteState] = useState<QuoteState>({ status: "idle", quote: null, error: null, key: "" });
  const [real, setReal] = useState<RealConfig | null>(null);
  const [slippagePick, setSlippagePick] = useState<number | null>(null);
  const [step, setStep] = useState<SwapStep | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);
  // Turns of the flip button, so each press spins it half a turn further.
  const [flips, setFlips] = useState(0);

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

  // Token: what the user picked, else ?token= (address or symbol), else the top trending token Veul can route.
  const fromParam = initialToken && !ADDRESS.test(initialToken) ? findIn(market.all, initialToken) : undefined;
  const fallback = market.data?.trending.find((t) => t.pool) ?? market.data?.stocks[0];
  const listed = picked ?? fromParam ?? (initialToken && ADDRESS.test(initialToken) ? market.all.find((t) => t.address === initialToken.toLowerCase()) : undefined);
  const wantedAddress = listed?.address ?? (initialToken && ADDRESS.test(initialToken) ? initialToken.toLowerCase() : fallback?.address);

  // Fresh details for the chosen token: current route plus holders, dev share and honeypot check.
  useEffect(() => {
    if (!wantedAddress) return;
    let alive = true;
    getJson<TokenResponse>(`/api/token/${wantedAddress}`)
      .then((body) => alive && setDetails({ address: wantedAddress, token: body.token, safety: body.safety }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [wantedAddress]);

  const current = details?.address === wantedAddress ? details : null;
  const token = current?.token ?? listed ?? (wantedAddress === fallback?.address ? fallback : undefined) ?? null;
  // GMGN data that came with the list is richer (snipers, bundles, taxes) than the per-token lookup.
  const listedSafety = (listed ?? (wantedAddress === fallback?.address ? fallback : undefined))?.safety;
  const safety = listedSafety?.source === "gmgn" ? listedSafety : (current?.safety ?? listedSafety ?? null);

  const value = Number(amount || "0");
  const ethUsd = market.data?.ethUsd ?? 0;
  const tradeUsd = token ? (side === "buy" ? value * ethUsd : value * token.priceUsd) : 0;
  const tradeEth = ethUsd > 0 ? tradeUsd / ethUsd : 0;
  const sizeOk = value > 0 && tradeEth <= MAX_ETH;
  const canQuote = Boolean(token?.pool) && sizeOk && AMOUNT.test(amount);
  const quoteKey = token && canQuote ? `${token.address}:${side}:${amount}` : "";

  // Live quote, 400 ms after the last change.
  useEffect(() => {
    if (!quoteKey || !token) return;
    let alive = true;
    const timer = setTimeout(() => {
      setQuoteState({ status: "loading", quote: null, error: null, key: quoteKey });
      // Send the pool we already know, so the quote needs only onchain calls.
      const pool = token.pool;
      const query = new URLSearchParams({ token: token.address, side, amount, symbol: token.symbol });
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
  const risk = token ? riskCheck(token, safety) : null;

  // Stocks move little, memes a lot: default slippage 0.5% vs 3%, unless the trader picks one.
  const slippageBps = slippagePick ?? (token?.kind === "stock" ? 50 : 300);
  const overRealCap = realOn && real ? tradeEth > real.maxEth : false;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (needsLogin) return auth.login();
    if (!token || !quote || status === "sending") return;
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
      const result = await realSwap({ wallet, account: auth.address as `0x${string}`, token, side, amount, slippageBps, onStep: setStep });
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
  const flip = () => {
    setSide((s) => (s === "buy" ? "sell" : "buy"));
    setFlips((n) => n + 1);
    setAmount(received > 0 ? String(Number(received.toPrecision(6))) : side === "buy" ? "" : "0.05");
    setStatus("idle");
  };

  const ethChip = (
    <span className={styles.asset}>
      <TokenAvatar token="ETH" size={24} />
      <span>ETH</span>
    </span>
  );
  const tokenChip = (
    <button type="button" className={styles.asset} onClick={() => setPicker(true)} aria-label={`Change token, now ${token?.symbol ?? "none"}`}>
      {token ? <TokenAvatar token={token} size={24} /> : null}
      <span>{token?.symbol ?? "Pick"}</span>
      <ChevronIcon className={styles.chev} />
    </button>
  );

  let note: React.ReactNode;
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
            . Verified: about {formatAmount(lastPayback)} {bag.ticker} added to your <Link href={appPath("/bag")}>stock bag</Link>.
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
        Simulated swap recorded. +{formatAmount(lastPayback)} {bag.ticker} added to your <Link href={appPath("/bag")}>stock bag</Link>.
      </>
    );
  } else if (!token) note = market.error ? `Prices could not load: ${market.error}` : "Loading live prices…";
  else if (!token.pool) note = `${token.symbol} has no Uniswap pool against ETH or USDG, so Veul cannot route it yet.`;
  else if (!(value > 0)) note = `Enter how much ${side === "buy" ? "ETH" : token.symbol} to ${side}.`;
  else if (live.status === "error") note = live.error;
  else if (overRealCap && real) note = `While testing, one real trade can be at most ${real.maxEth} ETH.`;
  else if (quote)
    note = realOn
      ? `Live quote · ${quote.route} · max slippage ${slippageBps / 100}%. This is a real swap from your wallet.`
      : `Live quote · ${quote.route}. ${real?.reason ?? "The swap is simulated until real swaps go live."}`;
  else note = "Getting a live quote…";

  let button = `${side === "buy" ? "Buy" : "Sell"} ${token?.symbol ?? ""}`;
  if (needsLogin) button = "Log in to swap";
  else if (status === "sending") button = step === "confirm-in-wallet" || step === "approving" || step === "signing-permit" ? "Check your wallet…" : "Swapping…";
  else if (!token?.pool) button = "Not tradeable yet";
  else if (!sizeOk && value > 0) button = `Max ${MAX_ETH} ETH per trade`;
  else if (overRealCap && real) button = `Max ${real.maxEth} ETH while testing`;

  return (
    <div className={styles.layout}>
      {/* The screen's heading is for screen readers; the top bar already says where you are. */}
      <h1 className={styles.srOnly}>Swap</h1>

      <MarketRail
        selected={token?.address ?? null}
        onPick={(next) => {
          setPicked(next);
          setStatus("idle");
        }}
      />

      <form className={styles.card} onSubmit={submit} aria-label="Swap" noValidate>
        <div className={styles.tabs} role="radiogroup" aria-label="Side">
          {(["buy", "sell"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={side === option}
              className={`${styles.tab} ${side === option ? styles.tabOn : ""}`}
              onClick={() => side !== option && flip()}
            >
              {option === "buy" ? "Buy" : "Sell"}
            </button>
          ))}
          <span className={`mono ${styles.tag} ${realOn ? styles.tagReal : ""}`}>{realOn ? "Real swap" : "Simulated"}</span>
        </div>

        <label className={`${styles.box} ${!amount || sizeOk ? "" : styles.invalid}`}>
          <span className={styles.label}>You pay</span>
          <span className={styles.row}>
            <input
              className={styles.amount}
              inputMode="decimal"
              value={amount}
              placeholder="0"
              onChange={(event) => {
                const next = event.target.value.replace(",", ".");
                if (!AMOUNT.test(next)) return;
                setAmount(next);
                setStatus("idle");
              }}
              aria-label={`Amount in ${side === "buy" ? "ETH" : (token?.symbol ?? "tokens")}`}
              aria-invalid={Boolean(amount) && !sizeOk}
            />
            {side === "buy" ? ethChip : tokenChip}
          </span>
          <span className={`mono ${styles.sub}`}>
            {tradeUsd > 0 ? <Tween value={tradeUsd} format={(v) => `≈ $${formatFixed(v, 2)}`} /> : `ETH $${formatFixed(ethUsd, 2)}`}
          </span>
        </label>

        <button type="button" className={styles.flip} onClick={flip} aria-label="Switch buy and sell">
          <span className={styles.flipIcon} style={{ transform: `rotate(${flips * 180}deg)` }}>
            <FlipIcon />
          </span>
        </button>

        <div className={styles.box}>
          <span className={styles.label}>You receive</span>
          <span className={styles.row}>
            <Tween value={received} format={(v) => (v > 0 ? formatAmount(v) : "0")} className={`${styles.amount} ${live.status === "loading" ? styles.pending : ""}`} />
            {side === "buy" ? tokenChip : ethChip}
          </span>
          <span className={`mono ${styles.sub}`}>
            {token ? `${token.symbol} ${formatPrice(token.priceUsd)}${token.pool ? ` · pool ${token.symbol} / ${token.pool.quoteSymbol} (${token.pool.version})` : ""}` : "…"}
          </span>
        </div>

        <fieldset className={styles.pick}>
          <legend>Get paid back in</legend>
          <div className={styles.chips}>
            {PAYBACK_TICKERS.map((ticker) => (
              <button
                key={ticker}
                type="button"
                className={`${styles.chip} ${bag.ticker === ticker ? styles.chipOn : ""}`}
                aria-pressed={bag.ticker === ticker}
                onClick={() => bag.setTicker(ticker)}
              >
                {ticker}
              </button>
            ))}
          </div>
        </fieldset>

        {realOn && (
          <fieldset className={styles.pick}>
            <legend>Max slippage</legend>
            <div className={styles.chips}>
              {SLIPPAGES.map((bps) => (
                <button
                  key={bps}
                  type="button"
                  className={`${styles.chip} ${slippageBps === bps ? styles.chipOn : ""}`}
                  aria-pressed={slippageBps === bps}
                  onClick={() => setSlippagePick(bps)}
                >
                  {bps / 100}%
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <dl className={styles.lines}>
          <div>
            <dt>Fee</dt>
            <dd className="mono">
              {FEE_RATE * 100}% · <Tween value={tradeUsd * FEE_RATE} format={(v) => `$${formatFixed(v, 2)}`} />
            </dd>
          </div>
          <div className={styles.back}>
            <dt>Back to you as stock</dt>
            <dd className="mono">
              <Tween value={payback} format={formatAmount} /> {bag.ticker} · <Tween value={tradeUsd * PAYBACK_RATE} format={(v) => `$${formatFixed(v, 2)}`} />
            </dd>
          </div>
        </dl>

        <button className={`btn btn-main ${styles.go}`} disabled={!needsLogin && (!quote || status === "sending" || overRealCap)}>
          {button}
        </button>

        <p className={`${styles.note} ${status === "done" ? styles.done : ""}`} role="status">
          {note}
        </p>
      </form>

      {token && risk && (
        <aside className={styles.info} aria-label="Token details">
          <div className={styles.infoHead}>
            <TokenAvatar token={token} size={40} />
            <div>
              <strong>{token.symbol}</strong>
              <span className="mono">
                {token.kind === "stock" ? "Stock token" : "Meme"} · {token.address.slice(0, 10)}…
              </span>
            </div>
          </div>
          <dl className={styles.stats}>
            <div>
              <dt>Price</dt>
              <dd className="mono">{formatPrice(token.priceUsd)}</dd>
            </div>
            <div>
              <dt>24h</dt>
              <dd className={`mono ${token.change24h >= 0 ? styles.up : styles.down}`}>
                {token.change24h >= 0 ? "+" : ""}
                {token.change24h.toFixed(2)}%
              </dd>
            </div>
            <div>
              <dt>Volume 24h</dt>
              <dd className="mono">{formatUsd(token.volume24h)}</dd>
            </div>
            <div>
              <dt>Liquidity</dt>
              <dd className="mono">{token.liquidity > 0 ? formatUsd(token.liquidity) : "–"}</dd>
            </div>
            <div>
              <dt>Holders</dt>
              <dd className="mono">{safety?.holders != null ? safety.holders.toLocaleString("en-US") : "–"}</dd>
            </div>
            <div>
              <dt>Top 10 hold</dt>
              <dd className="mono">{safety?.top10Pct != null ? `${Math.round(safety.top10Pct)}%` : "–"}</dd>
            </div>
          </dl>
          <section className={styles.riskBox} aria-label="Risk check">
            <div className={styles.riskHead}>
              <span>Risk check</span>
              <RiskBadge level={risk.level} />
            </div>
            <p>{risk.summary}</p>
            <ul>
              {risk.flags.map((flag) => (
                <li key={flag.label} className={styles[flag.level]}>
                  {flag.label}
                </li>
              ))}
            </ul>
          </section>
          <div className={styles.stockNote}>
            <span className="mono">{bag.ticker}</span>
            <p>
              Paybacks are counted at the live {bag.ticker} price ({formatPrice(stockPrice)}) and claimed weekly. Change the stock any time; it applies to your next trades.
            </p>
          </div>
        </aside>
      )}

      <TokenPicker
        open={picker}
        onClose={() => setPicker(false)}
        onPick={(next) => {
          setPicked(next);
          setStatus("idle");
        }}
      />
    </div>
  );
}
