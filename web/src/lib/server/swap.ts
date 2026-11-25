import "server-only";
import { encodeFunctionData, formatUnits, getAddress, parseUnits, type Address, type Hex } from "viem";
import type { MarketPool, MarketToken } from "@/lib/market";
import { PERMIT2, UNIVERSAL_ROUTER, buildBuy, buildSell, executeCalldata, permitTypedData, type PermitSingle, type Route } from "@/lib/swap/encode";
import { erc20Abi } from "@/lib/uniswap";
import { robinhoodChain } from "@/lib/chain";
import { rpc, serverEnv } from "./env";
import { ethPriceUsd, legFor, quote } from "./quote";

/**
 * Real swaps (session 1.4). Gated until the launch checks pass: only wallets in SWAP_OWNERS may build a real
 * transaction, and each trade is capped at MAX_REAL_SWAP_ETH (default 0.01 ETH). Fees go to FEE_WALLET.
 * The server builds the router call and simulates it from the trader's wallet; the trader signs and sends it.
 */
export type SwapConfig = { enabled: boolean; reason: string | null; maxEth: number };

export async function swapConfig(account: string | null): Promise<SwapConfig & { feeWallet: Address | null }> {
  const env = await serverEnv();
  const maxEth = Number(env.MAX_REAL_SWAP_ETH ?? "0.01") || 0.01;
  const feeWallet = env.FEE_WALLET && /^0x[0-9a-fA-F]{40}$/.test(env.FEE_WALLET) ? getAddress(env.FEE_WALLET) : null;
  const owners = (env.SWAP_OWNERS ?? "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  if (!feeWallet) return { enabled: false, reason: "Real swaps are not switched on yet.", maxEth, feeWallet };
  if (!account || !owners.includes(account.toLowerCase())) return { enabled: false, reason: "Real swaps are open to the team wallet only during testing.", maxEth, feeWallet };
  return { enabled: true, reason: null, maxEth, feeWallet };
}

async function routeFor(token: MarketToken): Promise<Route> {
  const pool = token.pool as MarketPool;
  const leg = await legFor(pool, token.address as Address);
  return {
    token: token.address as Address,
    quote: pool.quoteSymbol === "USDG" ? "USDG" : pool.quoteSymbol === "WETH" ? "WETH" : "ETH",
    hop: leg.kind === "v3" ? { version: "v3", fee: leg.fee } : { version: "v4", key: leg.key },
  };
}

const permit2Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }, { type: "address" }],
    outputs: [{ type: "uint160" }, { type: "uint48" }, { type: "uint48" }],
  },
] as const;
const allowanceAbi = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const approveAbi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

/** Before a sell: does the token need a one-time approval to Permit2, and the permit the trader must sign. */
export async function prepareSell(token: MarketToken, account: Address, amount: string) {
  const client = await rpc();
  const amountIn = parseUnits(amount, token.decimals);
  const [balance, allowance, [, , nonce]] = await Promise.all([
    client.readContract({ address: token.address as Address, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
    client.readContract({ address: token.address as Address, abi: allowanceAbi, functionName: "allowance", args: [account, PERMIT2] }),
    client.readContract({ address: PERMIT2, abi: permit2Abi, functionName: "allowance", args: [account, token.address as Address, UNIVERSAL_ROUTER] }),
  ]);
  if (balance < amountIn) throw new Error(`You hold ${formatUnits(balance, token.decimals)} ${token.symbol}, less than ${amount}.`);
  const now = Math.floor(Date.now() / 1000);
  const permit: PermitSingle = {
    details: { token: token.address as Address, amount: amountIn, expiration: now + 1800, nonce: Number(nonce) },
    spender: UNIVERSAL_ROUTER,
    sigDeadline: BigInt(now + 1800),
  };
  const approveTx =
    allowance >= amountIn
      ? null
      : {
          to: token.address as Address,
          // Standard Permit2 setup (as in Uniswap's app): one approval to Permit2, then a signed permit per sell
          // that lets the router take only that amount for 30 minutes.
          data: encodeFunctionData({ abi: approveAbi, functionName: "approve", args: [PERMIT2, (1n << 256n) - 1n] }),
          value: "0x0" as Hex,
        };
  return { approveTx, permit, typedData: permitTypedData(permit, robinhoodChain.id) };
}

type BuildInput = {
  token: MarketToken;
  side: "buy" | "sell";
  amount: string;
  slippageBps: number;
  account: Address;
  feeWallet: Address;
  permit?: { permit: PermitSingle; signature: Hex };
};

/** Router call for a real swap, simulated from the trader's wallet before it is handed out for signing. */
export async function buildSwap(input: BuildInput) {
  const { token, side, amount, slippageBps, account, feeWallet } = input;
  const client = await rpc();
  const q = await quote(token, side, amount);
  const route = await routeFor(token);
  const keep = BigInt(10_000 - slippageBps);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  let plan;
  let minOut: bigint;
  if (side === "buy") {
    minOut = (parseUnits(q.amountOut, token.decimals) * keep) / 10_000n;
    plan = buildBuy(route, parseUnits(amount, 18), minOut, feeWallet);
  } else {
    minOut = (parseUnits(q.amountOut, 18) * keep) / 10_000n;
    plan = buildSell(route, parseUnits(amount, token.decimals), minOut, feeWallet, input.permit);
  }
  const tx = { to: UNIVERSAL_ROUTER, data: executeCalldata(plan, deadline), value: plan.value };

  // Simulate from the trader's real wallet: a revert here means the trade would fail onchain.
  try {
    await client.call({ account, ...tx });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason = /TooLittleReceived/i.test(message)
      ? "The price moved more than your slippage allows."
      : /insufficient funds|exceeds balance/i.test(message)
        ? "Your wallet does not have enough ETH for this trade and gas."
        : "This swap would fail onchain right now.";
    throw new Error(reason);
  }
  const gas = await client.estimateGas({ account, ...tx }).catch(() => 600_000n);

  return {
    tx: { to: tx.to, data: tx.data, value: `0x${tx.value.toString(16)}`, gas: `0x${((gas * 12n) / 10n).toString(16)}` },
    quote: q,
    minOut: formatUnits(minOut, side === "buy" ? token.decimals : 18),
    usd: side === "buy" ? Number(amount) * (await ethPriceUsd()) : Number(q.amountOut) * (await ethPriceUsd()),
  };
}
