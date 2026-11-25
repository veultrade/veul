import { getJson } from "@/lib/market";

/** One verified real swap, as stored by the server ledger (lib/server/ledger.ts). Amounts are base-unit strings. */
export type LedgerEntry = {
  txHash: string;
  wallet: string;
  side: "buy" | "sell";
  token: string;
  tokenSymbol: string | null;
  tokenDecimals: number;
  tokenAmount: string;
  ethWei: string;
  feeWei: string;
  ethUsd: number;
  usd: number;
  /** Payback owed, USDG base units (6 decimals). */
  paybackUsdg: number;
  paybackStatus: "owed" | "claimed";
  blockNumber: number;
  blockTime: number;
};

export type WalletLedger = {
  entries: LedgerEntry[];
  totals: { trades: number; volumeUsd: number; owedUsdg: number; claimedUsdg: number };
};

export const USDG_UNIT = 1_000_000;

type RecordResult = { status: "recorded" | "already" | "pending" | "rejected"; reason?: string; entry?: LedgerEntry };

/**
 * Reports a confirmed real swap to the ledger. The fee transfer can take a few seconds to show up in the
 * node's index, so "pending" is retried a few times; the 15-minute server scan catches anything left.
 */
export async function reportSwap(txHash: string, attempts = 6): Promise<RecordResult> {
  let last: RecordResult = { status: "pending" };
  for (let i = 0; i < attempts; i++) {
    const response = await fetch("/api/ledger/record", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txHash }),
    }).catch(() => null);
    if (response) {
      last = (await response.json().catch(() => ({ status: "pending" }))) as RecordResult;
      if (last.status !== "pending" && response.status < 500) return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000 * (i + 1)));
  }
  return last;
}

export const fetchWalletLedger = (account: string) => getJson<WalletLedger>(`/api/ledger?account=${account}`);
