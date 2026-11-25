"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
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
import { ChevronIcon } from "./icons";
import { MarketRail } from "./MarketRail";
import { Flash, Tween } from "./motion";
import { PriceChart } from "./PriceChart";
import { TokenTabs } from "./TokenTabs";
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
  const fromList = listed ?? (wantedAddress === fallback?.address ? fallback : undefined);
  // The per-token lookup falls back to the chain when DexScreener is slow; that copy has no volume or 24h change, so
  // the live list's market numbers (the same source as the list and the chart) win when we have them.
  const looked = current?.token;
  // Memoised: a new object each render would restart the quote effect on every render.
  const token = useMemo(
    () =>
      looked && fromList && !(looked.volume24h > 0)
        ? { ...looked, priceUsd: fromList.priceUsd, change24h: fromList.change24h, volume24h: fromList.volume24h, liquidity: fromList.liquidity || looked.liquidity }
        : (looked ?? fromList ?? null),
    [looked, fromList],
  );
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

  const prices = market.data?.paybacks ?? {};
  const buying = side === "buy";

  return (
    <div className={styles.terminal}>
      {/* The screen's heading is for screen readers; the top bar already says where you are. */}
      <h1 className={styles.srOnly}>Trade</h1>

      <MarketRail
        selected={token?.address ?? null}
        onPick={(next) => {
          setPicked(next);
          setStatus("idle");
        }}
      />

      {/* Centre: the token's facts, its chart, then trades / risk / your trades. */}
      <section className={styles.center} aria-label="Token">
        <div className={styles.tokenBar}>
          {token ? (
            <>
              <button type="button" className={styles.tokenId} onClick={() => setPicker(true)} aria-label={`Change token, now ${token.symbol}`}>
                <TokenAvatar token={token} size={34} />
                <span>
                  <strong>
                    {token.symbol}
                    {token.kind === "stock" && <em className={styles.stockTag}>Stock</em>}
                  </strong>
                  <span className="mono">{token.pool ? `${token.symbol} / ${token.pool.quoteSymbol} · ${token.pool.version}` : "No Uniswap pool"}</span>
                </span>
                <ChevronIcon className={styles.chev} />
              </button>
              <div className={styles.price}>
                <Flash value={token.priceUsd} className="mono">
                  {formatPrice(token.priceUsd)}
                </Flash>
                <span className={`mono ${token.change24h >= 0 ? styles.up : styles.down}`}>
                  {token.change24h >= 0 ? "+" : ""}
                  {token.change24h.toFixed(2)}%
                </span>
              </div>
              <dl className={styles.facts}>
                <div>
                  <dt>Liquidity</dt>
                  <dd className="mono">{token.liquidity > 0 ? formatUsd(token.liquidity) : "–"}</dd>
                </div>
                <div>
                  <dt>Volume 24h</dt>
                  <dd className="mono">{formatUsd(token.volume24h)}</dd>
                </div>
                <div>
                  <dt>Holders</dt>
                  <dd className="mono">{safety?.holders != null ? safety.holders.toLocaleString("en-US") : "–"}</dd>
                </div>
                <div>
                  <dt>Top 10</dt>
                  <dd className="mono">{safety?.top10Pct != null ? `${Math.round(safety.top10Pct)}%` : "–"}</dd>
                </div>
              </dl>
              {risk && <RiskBadge level={risk.level} />}
            </>
          ) : (
            <span className={styles.loadingBar}>Loading live prices…</span>
          )}
        </div>

        <PriceChart pool={token?.pool?.id ?? null} token={token?.address ?? ""} />

        <TokenTabs token={token} risk={risk} safety={safety} />
      </section>

      {/* Right: the trade panel. */}
      <aside className={styles.side} aria-label="Trade">
        <form className={styles.trade} onSubmit={submit} aria-label="Swap" noValidate>
          <div className={styles.sides} role="radiogroup" aria-label="Side">
            {(["buy", "sell"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={side === option}
                className={`${styles.sideBtn} ${option === "buy" ? styles.sideBuy : styles.sideSell} ${side === option ? styles.sideOn : ""}`}
                onClick={() => side !== option && flip()}
              >
                {option === "buy" ? "Buy" : "Sell"}
              </button>
            ))}
          </div>

          <div className={styles.labelRow}>
            <span>{buying ? "You pay" : `You sell`}</span>
            <span className={`mono ${styles.tag} ${realOn ? styles.tagReal : ""}`}>{realOn ? "Real swap" : "Simulated"}</span>
          </div>
          <label className={`${styles.amountBox} ${!amount || sizeOk ? "" : styles.invalid}`}>
            <input
              className={`mono ${styles.amount}`}
              inputMode="decimal"
              value={amount}
              placeholder="0"
              onChange={(event) => {
                const next = event.target.value.replace(",", ".");
                if (!AMOUNT.test(next)) return;
                setAmount(next);
                setStatus("idle");
              }}
              aria-label={`Amount in ${buying ? "ETH" : (token?.symbol ?? "tokens")}`}
              aria-invalid={Boolean(amount) && !sizeOk}
            />
            {buying ? ethChip : tokenChip}
          </label>
          {buying && (
            <div className={styles.presets}>
              {["0.001", "0.005", "0.01", "0.05"].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={amount === preset ? styles.presetOn : ""}
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
          <span className={`mono ${styles.sub}`}>
            {tradeUsd > 0 ? <Tween value={tradeUsd} format={(v) => `≈ $${formatFixed(v, 2)}`} /> : `ETH $${formatFixed(ethUsd, 2)}`}
          </span>

          <div className={styles.receive}>
            <span>You receive about</span>
            <span className={styles.receiveValue}>
              <Tween value={received} format={(v) => (v > 0 ? formatAmount(v) : "0")} className={`mono ${live.status === "loading" ? styles.pending : ""}`} />
              {buying ? tokenChip : ethChip}
            </span>
          </div>

          <div className={styles.payback}>
            <div className={styles.paybackTop}>
              <span>Paid back to you in</span>
              <span className="mono">
                +<Tween value={payback} format={formatAmount} /> {bag.ticker}
              </span>
            </div>
            <div className={styles.stocks} role="radiogroup" aria-label="Stock to be paid back in">
              {PAYBACK_TICKERS.map((ticker) => (
                <button
                  key={ticker}
                  type="button"
                  role="radio"
                  aria-checked={bag.ticker === ticker}
                  className={bag.ticker === ticker ? styles.stockOn : ""}
                  onClick={() => bag.setTicker(ticker)}
                >
                  {ticker}
                  <span className="mono">{prices[ticker] ? formatPrice(prices[ticker]) : "…"}</span>
                </button>
              ))}
            </div>
          </div>

          {realOn && (
            <div className={styles.slippage}>
              <span>Max slippage</span>
              <div>
                {SLIPPAGES.map((bps) => (
                  <button key={bps} type="button" className={slippageBps === bps ? styles.presetOn : ""} aria-pressed={slippageBps === bps} onClick={() => setSlippagePick(bps)}>
                    {bps / 100}%
                  </button>
                ))}
              </div>
            </div>
          )}

          <dl className={styles.lines}>
            <div>
              <dt>Fee {FEE_RATE * 100}%</dt>
              <dd className="mono">
                <Tween value={tradeUsd * FEE_RATE} format={(v) => `$${formatFixed(v, 2)}`} />
              </dd>
            </div>
            <div>
              <dt>Back to you</dt>
              <dd className={`mono ${styles.back}`}>
                <Tween value={tradeUsd * PAYBACK_RATE} format={(v) => `$${formatFixed(v, 2)}`} />
              </dd>
            </div>
            {quote && (
              <div>
                <dt>Route</dt>
                <dd className="mono">{quote.route}</dd>
              </div>
            )}
          </dl>

          <button
            className={`${styles.go} ${needsLogin ? styles.goNeutral : buying ? styles.goBuy : styles.goSell}`}
            disabled={!needsLogin && (!quote || status === "sending" || overRealCap)}
          >
            {button}
          </button>

          <p className={`${styles.note} ${status === "done" ? styles.done : ""}`} role="status">
            {note}
          </p>
        </form>
      </aside>

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
