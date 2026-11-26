import { decodeFunctionData, erc20Abi, parseUnits, type Hex, type WalletClient } from "viem";
import { robinhoodChain } from "@/lib/chain";
import { PERMIT2, UNIVERSAL_ROUTER } from "@/lib/swap/encode";
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

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * The wallet only signs what this trade should be, whatever the server returns (2026-11-26 swap review, finding 5):
 * the approval goes to Permit2, the permit lets only the Universal Router spend exactly this amount of this token on
 * this chain, and the swap goes to the router with the right ETH. A tampered response stops here, before any signature.
 */
function refuse(why: string): never {
  throw new Error(`Veul stopped before signing: ${why}. Nothing was sent.`);
}

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
  /** The output the trader was shown; the server refuses to build if the price got worse than that by more than the slippage. */
  expectedOut?: string;
  onStep: (step: SwapStep) => void;
}): Promise<{ hash: Hex; minOut: string; usd: number; amountOut: string }> {
  const { wallet, account, token, side, amount, slippageBps, onStep, expectedOut } = args;
  const pool = token.pool;
  if (!pool) throw new Error("This token has no route");
  const ref = { token: token.address, pool: pool.id, version: pool.version, quote: pool.quoteAddress, createdAt: pool.createdAt ?? undefined, symbol: token.symbol };
  const base = { ...ref, side, amount, slippageBps, account, expectedOut };
  let permitPart = {};

  if (side === "sell") {
    onStep("preparing");
    const prepared = await post<Prepared>({ ...base, step: "prepare" });
    const sellAmount = parseUnits(amount, token.decimals);
    if (prepared.approveTx) {
      if (!same(prepared.approveTx.to, token.address)) refuse("the approval is for another token");
      const approve = decodeFunctionData({ abi: erc20Abi, data: prepared.approveTx.data });
      if (approve.functionName !== "approve" || !same(String(approve.args?.[0]), PERMIT2)) refuse("the approval is not for Permit2");
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
    const { permit, typedData } = prepared;
    if (!same(permit.spender, UNIVERSAL_ROUTER)) refuse("the permit is not for the Uniswap router");
    if (!same(permit.details.token, token.address) || BigInt(permit.details.amount) !== sellAmount) refuse("the permit does not match this sale");
    if (!same(typedData.domain.verifyingContract, PERMIT2) || Number(typedData.domain.chainId) !== robinhoodChain.id) refuse("the permit is not for Permit2 on Robinhood Chain");
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
  const expectedValue = side === "buy" ? parseUnits(amount, 18) : 0n;
  if (!same(built.tx.to, UNIVERSAL_ROUTER)) refuse("the swap is not addressed to the Uniswap router");
  if (BigInt(built.tx.value) !== expectedValue) refuse("the swap sends a different amount of ETH");
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
 * Daily claim: the server builds and simulates claimAndSwap on the VeulClaims contract; the wallet
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
