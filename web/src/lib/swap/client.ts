import type { Hex, WalletClient } from "viem";
import { getJson, type MarketToken } from "@/lib/market";

/**
 * Real swap from the browser: the server builds and simulates the router call, the trader's wallet signs it.
 * Buy: build -> send -> wait. Sell: prepare -> (one-time approval to Permit2) -> sign permit -> build -> send -> wait.
 */
export type SwapStep = "preparing" | "approving" | "signing-permit" | "building" | "confirm-in-wallet" | "pending" | "done";

type BuiltTx = { tx: { to: Hex; data: Hex; value: string; gas: string }; minOut: string; usd: number; quote: { amountOut: string } };
type Prepared = {
  approveTx: { to: Hex; data: Hex; value: string } | null;
  permit: { details: { token: Hex; amount: string; expiration: number; nonce: number }; spender: Hex; sigDeadline: string };
  typedData: {
    domain: { name: string; chainId: number; verifyingContract: Hex };
    types: Record<string, { name: string; type: string }[]>;
    primaryType: "PermitSingle";
  };
};

async function post<T>(body: unknown): Promise<T> {
  return getJson<T>("/api/swap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function waitFor(hash: Hex): Promise<"success" | "failed"> {
  for (let i = 0; i < 90; i++) {
    const { status } = await getJson<{ status: string }>(`/api/tx/${hash}`).catch(() => ({ status: "pending" }));
    if (status === "success" || status === "failed") return status;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("No confirmation after 3 minutes. Check the transaction on the explorer.");
}

export async function realSwap(args: {
  wallet: WalletClient;
  account: Hex;
  token: MarketToken;
  side: "buy" | "sell";
  amount: string;
  slippageBps: number;
  onStep: (step: SwapStep) => void;
}): Promise<{ hash: Hex; minOut: string; usd: number; amountOut: string }> {
  const { wallet, account, token, side, amount, slippageBps, onStep } = args;
  const pool = token.pool;
  if (!pool) throw new Error("This token has no route");
  const ref = { token: token.address, pool: pool.id, version: pool.version, quote: pool.quoteAddress, createdAt: pool.createdAt ?? undefined, symbol: token.symbol };
  const base = { ...ref, side, amount, slippageBps, account };
  let permitPart = {};

  if (side === "sell") {
    onStep("preparing");
    const prepared = await post<Prepared>({ ...base, step: "prepare" });
    if (prepared.approveTx) {
      onStep("approving");
      const approveHash = await wallet.sendTransaction({
        account,
        chain: wallet.chain,
        to: prepared.approveTx.to,
        data: prepared.approveTx.data,
        value: 0n,
      });
      if ((await waitFor(approveHash)) !== "success") throw new Error("The approval failed onchain.");
    }
    onStep("signing-permit");
    const message = {
      details: { ...prepared.permit.details, amount: BigInt(prepared.permit.details.amount) },
      spender: prepared.permit.spender,
      sigDeadline: BigInt(prepared.permit.sigDeadline),
    };
    const signature = await wallet.signTypedData({
      account,
      domain: prepared.typedData.domain,
      types: prepared.typedData.types,
      primaryType: "PermitSingle",
      message,
    });
    permitPart = { permit: prepared.permit, signature };
  }

  onStep("building");
  const built = await post<BuiltTx>({ ...base, ...permitPart, step: "build" });
  onStep("confirm-in-wallet");
  const hash = await wallet.sendTransaction({
    account,
    chain: wallet.chain,
    to: built.tx.to,
    data: built.tx.data,
    value: BigInt(built.tx.value),
    gas: BigInt(built.tx.gas),
  });
  onStep("pending");
  const status = await waitFor(hash);
  if (status !== "success") throw new Error("The swap failed onchain. Nothing was traded; only gas was spent.");
  onStep("done");
  return { hash, minOut: built.minOut, usd: built.usd, amountOut: built.quote.amountOut };
}

/**
 * Weekly claim (session 1.6): the server builds and simulates claimAndSwap on the VeulClaims contract; the wallet
 * signs and sends it. The stock lands in the wallet in that one transaction.
 */
export async function realClaim(args: { wallet: WalletClient; account: Hex; ticker: string; slippageBps: number; onStep: (step: SwapStep) => void }) {
  const { wallet, account, ticker, slippageBps, onStep } = args;
  onStep("building");
  const built = await getJson<{ tx: { to: Hex; data: Hex; value: string; gas: string }; claimableUsdg: string; amountOut: string; minOut: string }>("/api/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account, ticker, slippageBps }),
  });
  onStep("confirm-in-wallet");
  const hash = await wallet.sendTransaction({ account, chain: wallet.chain, to: built.tx.to, data: built.tx.data, value: 0n, gas: BigInt(built.tx.gas) });
  onStep("pending");
  const status = await waitFor(hash);
  if (status !== "success") throw new Error("The claim failed onchain. Nothing was paid out; only gas was spent.");
  onStep("done");
  return { hash, claimedUsdg: built.claimableUsdg, amountOut: built.amountOut };
}

export const explorerTx = (hash: string) => `https://robinhoodchain.blockscout.com/tx/${hash}`;
