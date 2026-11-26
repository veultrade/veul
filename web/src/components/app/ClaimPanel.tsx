"use client";

import { useCallback, useEffect, useState } from "react";
import { formatUnits } from "viem";
import { getJson } from "@/lib/market";
import { explorerTx, realClaim, type SwapStep } from "@/lib/swap/client";
import { formatAmount, formatFixed } from "@/lib/tokens";
import { useAuth } from "./AuthProvider";
import { useBag } from "./BagStore";
import styles from "./Screens.module.css";

type Status = {
  open: boolean;
  usdgOpen: boolean;
  reason: string | null;
  contract: string | null;
  epoch: number;
  cumulativeUsdg: string;
  claimedUsdg: string;
  claimableUsdg: string;
  /** All that is owed; above claimableUsdg when the contract's daily payout limit is short. */
  owedUsdg?: string;
  minUsdg: string;
  estimateOut: string | null;
};

const STEP_TEXT: Partial<Record<SwapStep, string>> = {
  building: "Preparing your claim…",
  "confirm-in-wallet": "Confirm the claim in your wallet…",
  pending: "Waiting for Robinhood Chain to confirm…",
};

/**
 * The bag's claim control. Shows what the wallet can claim now and, when open, claims it as the
 * chosen stock in one transaction the wallet signs. Closed states say why (not live yet, nothing yet, below minimum).
 */
export function ClaimPanel() {
  const auth = useAuth();
  const bag = useBag();
  const [status, setStatus] = useState<Status | null>(null);
  const [step, setStep] = useState<SwapStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ hash: string; usdg: string; out: string; asset: string } | null>(null);

  const account = auth.authenticated ? auth.address : null;
  const load = useCallback(async () => {
    if (!account) return;
    try {
      setStatus(await getJson<Status>(`/api/claim?account=${account}&ticker=${bag.ticker}`));
    } catch {
      setStatus(null);
    }
  }, [account, bag.ticker]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  // asUsdg: claim the USDG itself (no swap, no minimum); otherwise swap into the chosen stock.
  const claim = async (asUsdg = false) => {
    if (!account) return auth.login();
    setError(null);
    try {
      const wallet = await auth.walletClient();
      const ticker = asUsdg ? "USDG" : bag.ticker;
      const result = await realClaim({ wallet, account: account as `0x${string}`, ticker, slippageBps: 100, onStep: setStep });
      setDone({ hash: result.hash, usdg: result.claimedUsdg, out: result.amountOut, asset: ticker });
      await load();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(/reject|denied|cancel/i.test(message) ? "You cancelled in your wallet. Nothing was claimed." : message.split("\n")[0].slice(0, 200));
    } finally {
      setStep(null);
    }
  };

  const busy = step !== null;
  const claimable = Number(status?.claimableUsdg ?? 0);
  const estimate = status?.estimateOut ? Number(formatUnits(BigInt(status.estimateOut), 18)) : 0;

  let label = "Claim to wallet";
  if (!account) label = "Log in to claim";
  else if (busy) label = step === "confirm-in-wallet" ? "Check your wallet…" : "Claiming…";
  else if (status?.open) label = `Claim $${formatFixed(claimable, 2)} as ${bag.ticker}`;

  let note: React.ReactNode = "Paybacks are posted once a day and claimed into your wallet as USDG or the stock you pick.";
  if (step && STEP_TEXT[step]) note = STEP_TEXT[step];
  else if (error) note = error;
  else if (done)
    note = (
      <>
        {done.asset === "USDG"
          ? `Claimed ${done.usdg} USDG to your wallet.`
          : `Claimed ${formatFixed(Number(done.usdg), 2)} USDG as about ${formatAmount(Number(formatUnits(BigInt(done.out), 18)))} ${done.asset}.`}{" "}
        <a href={explorerTx(done.hash)} target="_blank" rel="noreferrer">
          View transaction
        </a>
      </>
    );
  else if (status?.owedUsdg && Number(status.claimableUsdg) > 0 && Number(status.owedUsdg) > Number(status.claimableUsdg))
    note = `This claim pays ${status.claimableUsdg} of the ${status.owedUsdg} USDG you are owed; the rest opens as today's payout limit refills.`;
  else if (status?.open && estimate > 0) note = `About ${formatAmount(estimate)} ${bag.ticker} at today's price, in one transaction you sign.`;
  else if (status?.reason) note = status.reason;

  return (
    <div className={styles.claim}>
      <div className={styles.claimButtons}>
        <button type="button" className="btn btn-main" disabled={Boolean(account) && (busy || !status?.open)} onClick={() => claim(false)}>
          {label}
        </button>
        {/* Small paybacks (below the swap minimum) can still be taken as plain USDG. */}
        {account && status?.usdgOpen && !busy && (
          <button type="button" className="btn btn-quiet" onClick={() => claim(true)}>
            Claim {status.claimableUsdg} USDG
          </button>
        )}
      </div>
      <span className={`${styles.muted} ${done ? styles.claimDone : ""}`} role="status">
        {note}
      </span>
      {status && Number(status.claimedUsdg) > 0 && <span className={`mono ${styles.muted}`}>Claimed so far: {formatFixed(Number(status.claimedUsdg), 2)} USDG</span>}
    </div>
  );
}
