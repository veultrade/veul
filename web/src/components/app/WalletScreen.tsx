"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getJson, type BalancesResponse } from "@/lib/market";
import { formatAmount, formatFixed, formatUsd } from "@/lib/tokens";
import { useAuth } from "./AuthProvider";
import { useMarket } from "./MarketProvider";
import { CopyButton } from "./CopyButton";
import { TokenAvatar } from "./TokenAvatar";
import screens from "./Screens.module.css";
import styles from "./Features.module.css";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Wallet: the address to fund, a withdraw form, and what the wallet holds. */
export function WalletScreen() {
  const auth = useAuth();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const market = useMarket();
  const [balances, setBalances] = useState<{ address: string; data: BalancesResponse | null; error: string | null } | null>(null);

  // Live balances for the logged-in wallet: ETH plus any listed token it holds.
  useEffect(() => {
    if (!auth.address) return;
    const address = auth.address;
    let alive = true;
    getJson<BalancesResponse>(`/api/balances?address=${address}`)
      .then((data) => alive && setBalances({ address, data, error: null }))
      .catch((reason: Error) => alive && setBalances({ address, data: null, error: reason.message }));
    return () => {
      alive = false;
    };
  }, [auth.address]);

  const mine = balances && balances.address === auth.address ? balances : null;
  const ethUsd = market.data?.ethUsd ?? 0;
  const rows = mine?.data
    ? [
        { symbol: "ETH", amount: Number(mine.data.eth), token: null, usd: Number(mine.data.eth) * ethUsd },
        ...mine.data.tokens.map((t) => {
          const token = market.all.find((m) => m.address === t.address) ?? null;
          return { symbol: t.symbol, amount: Number(t.amount), token, usd: token ? Number(t.amount) * token.priceUsd : 0 };
        }),
      ]
    : [];
  const total = rows.reduce((sum, row) => sum + row.usd, 0);

  const withdraw = (event: FormEvent) => {
    event.preventDefault();
    if (!ADDRESS.test(to.trim())) return setNote("Enter a full 0x address (42 characters).");
    const eth = Number(amount);
    if (!(eth > 0)) return setNote("Enter an amount above 0.");
    setNote("Withdrawals are not live in this preview. Nothing was sent.");
  };

  return (
    <div className={screens.page}>
      <header className={screens.title}>
        <h1>Wallet</h1>
        <p>Your Stockup wallet on Robinhood Chain. Fund it with ETH, trade, and withdraw any time. Only you can move funds.</p>
      </header>

      <div className={styles.grid2}>
        <section className={styles.panel} aria-labelledby="deposit-title">
          <h2 id="deposit-title">Deposit</h2>
          {auth.address ? (
            <>
              <div className={styles.copyRow}>
                <code title={auth.address}>{auth.address}</code>
                <CopyButton value={auth.address} />
              </div>
              <ol className={styles.steps}>
                <li>
                  Send <strong>ETH on Robinhood Chain</strong> to this address. Other networks will not arrive here.
                </li>
                <li>Coming from Ethereum or a CEX? Bridge to Robinhood Chain first, then send.</li>
                <li>Funds show up after one block, usually a few seconds.</li>
              </ol>
            </>
          ) : (
            <p>{auth.configured ? "Log in to get your wallet address." : "Login is not switched on in this preview."}</p>
          )}
          <span className={`mono ${styles.tag}`}>Card and bridge buttons come later</span>
        </section>

        <form className={styles.panel} onSubmit={withdraw} aria-labelledby="withdraw-title" noValidate>
          <h2 id="withdraw-title">Withdraw</h2>
          <label className={styles.field}>
            To address
            <input value={to} onChange={(event) => setTo(event.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" />
          </label>
          <label className={styles.field}>
            Amount (ETH)
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.1" />
          </label>
          <button className="btn btn-main">Review withdrawal</button>
          <p role="status">{note || "Check the address twice. Transfers on a blockchain cannot be undone."}</p>
        </form>
      </div>

      <section className={styles.panel} aria-labelledby="holdings-title">
        <div className={styles.panelHead}>
          <h2 id="holdings-title">Holdings</h2>
          <span className={`mono ${styles.tag}`}>Live · listed tokens only</span>
        </div>
        {!auth.address ? (
          <p>{auth.configured ? "Log in to see your balances." : "Login is not switched on in this preview."}</p>
        ) : mine?.error ? (
          <p>Balances could not load: {mine.error}</p>
        ) : !mine ? (
          <p>Reading your balances from Robinhood Chain…</p>
        ) : (
          <>
            <strong className={`mono ${styles.bigNumber}`}>{formatUsd(total)}</strong>
            <ul className={styles.list}>
              {rows.map((row) => (
                <li key={row.symbol}>
                  <TokenAvatar token={row.token ?? "ETH"} size={32} />
                  <span className={styles.grow}>
                    <strong>{row.symbol}</strong>
                    <small>{row.token ? (row.token.kind === "stock" ? "Stock token" : "Meme") : "Gas and trading"}</small>
                  </span>
                  <span className={styles.end}>
                    <span className="mono">{formatAmount(row.amount)}</span>
                    <small className="mono">{row.usd > 0 ? `$${formatFixed(row.usd, 2)}` : "–"}</small>
                  </span>
                </li>
              ))}
            </ul>
            {rows.length === 1 && rows[0].amount === 0 && <p>Your wallet is empty. Send ETH on Robinhood Chain to the address above to start.</p>}
          </>
        )}
      </section>
    </div>
  );
}
