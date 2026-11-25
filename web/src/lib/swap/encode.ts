import { concat, encodeAbiParameters, encodeFunctionData, numberToHex, type Address, type Hex } from "viem";

/**
 * Calldata for Uniswap's Universal Router (v2, with v4 support) on Robinhood Chain.
 * No Uniswap SDK: the SDKs do not know chain 4663, and the router's command format is small and stable.
 * Every route here is checked by scripts/swap-sim.mjs with simulated balances before it is used.
 *
 * Fee rule (0.5%): always taken in ETH. Buy: sent from the ETH input before the swap.
 * Sell: taken from the ETH output (PAY_PORTION) before the rest is swept to the trader.
 * The self-contained imports let Node run this file directly in the simulation script.
 */

export const UNIVERSAL_ROUTER: Address = "0x8876789976decbfcbbbe364623c63652db8c0904";
export const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
export const WETH: Address = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
export const USDG: Address = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
export const NATIVE: Address = "0x0000000000000000000000000000000000000000";
export const ETH_USDG_V3_FEE = 100;
export const FEE_BIPS = 50n; // 0.5%

// Universal Router constants.
const MSG_SENDER: Address = "0x0000000000000000000000000000000000000001";
const ADDRESS_THIS: Address = "0x0000000000000000000000000000000000000002";
const CONTRACT_BALANCE = 1n << 255n;
const OPEN_DELTA = 0n; // v4: "use the whole open delta"

const CMD = {
  V3_SWAP_EXACT_IN: 0x00,
  SWEEP: 0x04,
  TRANSFER: 0x05,
  PAY_PORTION: 0x06,
  PERMIT2_PERMIT: 0x0a,
  WRAP_ETH: 0x0b,
  UNWRAP_WETH: 0x0c,
  V4_SWAP: 0x10,
} as const;

const V4 = {
  SWAP_EXACT_IN_SINGLE: 0x06,
  SETTLE: 0x0b,
  SETTLE_ALL: 0x0c,
  TAKE: 0x0e,
  TAKE_ALL: 0x0f,
} as const;

export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
/** One hop: a v3 pool (fee tier) or a v4 pool (full key). */
export type Hop = { version: "v3"; fee: number } | { version: "v4"; key: PoolKey };

/** Route between ETH and the token: either straight, or through USDG (ETH/USDG v3 pool, then the token's pool). */
export type Route = { token: Address; quote: "ETH" | "WETH" | "USDG"; hop: Hop };

export type PermitSingle = {
  details: { token: Address; amount: bigint; expiration: number; nonce: number };
  spender: Address;
  sigDeadline: bigint;
};

export type SwapPlan = { commands: Hex; inputs: Hex[]; value: bigint };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const isEth = (a: Address) => same(a, NATIVE) || same(a, WETH);

function v3Path(tokens: Address[], fees: number[]): Hex {
  const parts: Hex[] = [tokens[0]];
  fees.forEach((fee, i) => parts.push(numberToHex(fee, { size: 3 }), tokens[i + 1]));
  return concat(parts);
}

const enc = {
  transfer: (token: Address, recipient: Address, value: bigint) =>
    encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [token, recipient, value]),
  payPortion: (token: Address, recipient: Address, bips: bigint) =>
    encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [token, recipient, bips]),
  sweep: (token: Address, recipient: Address, amountMin: bigint) =>
    encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [token, recipient, amountMin]),
  wrap: (recipient: Address, amountMin: bigint) => encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [recipient, amountMin]),
  unwrap: (recipient: Address, amountMin: bigint) => encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [recipient, amountMin]),
  // Universal Router 2.1 on this chain takes a sixth input, uint256[] minHopPriceX36 (per-hop price floors).
  // Empty = no per-hop floor; the overall amountOutMin still applies (checked in scripts/swap-sim.mjs).
  v3ExactIn: (recipient: Address, amountIn: bigint, amountOutMin: bigint, path: Hex, payerIsUser: boolean) =>
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" }, { type: "uint256[]" }],
      [recipient, amountIn, amountOutMin, path, payerIsUser, []],
    ),
  permit: (permit: PermitSingle, signature: Hex) =>
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            {
              name: "details",
              type: "tuple",
              components: [
                { name: "token", type: "address" },
                { name: "amount", type: "uint160" },
                { name: "expiration", type: "uint48" },
                { name: "nonce", type: "uint48" },
              ],
            },
            { name: "spender", type: "address" },
            { name: "sigDeadline", type: "uint256" },
          ],
        },
        { type: "bytes" },
      ],
      [permit, signature],
    ),
};

const poolKeyType = {
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
} as const;

const v4Param = {
  swapExactInSingle: (key: PoolKey, zeroForOne: boolean, amountIn: bigint, amountOutMinimum: bigint) =>
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { ...poolKeyType, name: "poolKey" },
            { name: "zeroForOne", type: "bool" },
            { name: "amountIn", type: "uint128" },
            { name: "amountOutMinimum", type: "uint128" },
            // v2.1 field: per-hop price floor (0 = none). Without it the params decode wrongly.
            { name: "minHopPriceX36", type: "uint256" },
            { name: "hookData", type: "bytes" },
          ],
        },
      ],
      [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum, minHopPriceX36: 0n, hookData: "0x" }],
    ),
  settle: (currency: Address, amount: bigint, payerIsUser: boolean) =>
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bool" }], [currency, amount, payerIsUser]),
  settleAll: (currency: Address, maxAmount: bigint) => encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [currency, maxAmount]),
  take: (currency: Address, recipient: Address, amount: bigint) =>
    encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [currency, recipient, amount]),
  takeAll: (currency: Address, minAmount: bigint) => encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [currency, minAmount]),
};

function v4Swap(actions: number[], params: Hex[]): Hex {
  return encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [concat(actions.map((a) => numberToHex(a, { size: 1 }))), params]);
}

class Plan {
  private cmds: number[] = [];
  readonly inputs: Hex[] = [];
  add(cmd: number, input: Hex) {
    this.cmds.push(cmd);
    this.inputs.push(input);
    return this;
  }
  build(value: bigint): SwapPlan {
    return { commands: concat(this.cmds.map((c) => numberToHex(c, { size: 1 }))), inputs: this.inputs, value };
  }
}

/** The ETH-side currency a v4 pool uses (native ETH or WETH). */
function v4EthCurrency(key: PoolKey): Address | null {
  if (isEth(key.currency0)) return key.currency0;
  if (isEth(key.currency1)) return key.currency1;
  return null;
}

/**
 * Buy: `amountIn` ETH from the trader (msg.value). Fee goes to `feeWallet` first; the rest is swapped and the
 * token is sent to the trader, who must receive at least `minOut`.
 */
export function buildBuy(route: Route, amountIn: bigint, minOut: bigint, feeWallet: Address): SwapPlan {
  const fee = (amountIn * FEE_BIPS) / 10_000n;
  const net = amountIn - fee;
  const plan = new Plan().add(CMD.TRANSFER, enc.transfer(NATIVE, feeWallet, fee));
  const { hop, token } = route;

  if (route.quote === "USDG") {
    // ETH -> USDG on the deep v3 pool, held by the router, then USDG -> token.
    plan.add(CMD.WRAP_ETH, enc.wrap(ADDRESS_THIS, CONTRACT_BALANCE));
    if (hop.version === "v3") {
      const path = v3Path([WETH, USDG, token], [ETH_USDG_V3_FEE, hop.fee]);
      return plan.add(CMD.V3_SWAP_EXACT_IN, enc.v3ExactIn(MSG_SENDER, CONTRACT_BALANCE, minOut, path, false)).build(amountIn);
    }
    plan.add(CMD.V3_SWAP_EXACT_IN, enc.v3ExactIn(ADDRESS_THIS, CONTRACT_BALANCE, 0n, v3Path([WETH, USDG], [ETH_USDG_V3_FEE]), false));
    const actions = [V4.SETTLE, V4.SWAP_EXACT_IN_SINGLE, V4.TAKE_ALL];
    const params = [
      v4Param.settle(USDG, CONTRACT_BALANCE, false),
      v4Param.swapExactInSingle(hop.key, same(hop.key.currency0, USDG), OPEN_DELTA, minOut),
      v4Param.takeAll(token, minOut),
    ];
    return plan.add(CMD.V4_SWAP, v4Swap(actions, params)).build(amountIn);
  }

  if (hop.version === "v3") {
    plan.add(CMD.WRAP_ETH, enc.wrap(ADDRESS_THIS, CONTRACT_BALANCE));
    return plan.add(CMD.V3_SWAP_EXACT_IN, enc.v3ExactIn(MSG_SENDER, CONTRACT_BALANCE, minOut, v3Path([WETH, token], [hop.fee]), false)).build(amountIn);
  }

  const ethCurrency = v4EthCurrency(hop.key);
  if (!ethCurrency) throw new Error("Pool has no ETH side");
  const zeroForOne = same(hop.key.currency0, ethCurrency);
  if (same(ethCurrency, WETH)) {
    plan.add(CMD.WRAP_ETH, enc.wrap(ADDRESS_THIS, CONTRACT_BALANCE));
    const actions = [V4.SETTLE, V4.SWAP_EXACT_IN_SINGLE, V4.TAKE_ALL];
    const params = [v4Param.settle(WETH, CONTRACT_BALANCE, false), v4Param.swapExactInSingle(hop.key, zeroForOne, OPEN_DELTA, minOut), v4Param.takeAll(token, minOut)];
    return plan.add(CMD.V4_SWAP, v4Swap(actions, params)).build(amountIn);
  }
  // Native ETH pool: the router pays the pool from the ETH it holds.
  const actions = [V4.SWAP_EXACT_IN_SINGLE, V4.SETTLE_ALL, V4.TAKE_ALL];
  const params = [v4Param.swapExactInSingle(hop.key, zeroForOne, net, minOut), v4Param.settleAll(NATIVE, net), v4Param.takeAll(token, minOut)];
  return plan.add(CMD.V4_SWAP, v4Swap(actions, params)).build(amountIn);
}

/**
 * Sell: `amountIn` tokens from the trader through Permit2 (optional fresh permit + signature in the same call).
 * The ETH comes back to the router, 0.5% goes to `feeWallet`, and the rest (at least `minOutEth`) to the trader.
 */
export function buildSell(
  route: Route,
  amountIn: bigint,
  minOutEth: bigint,
  feeWallet: Address,
  permit?: { permit: PermitSingle; signature: Hex },
): SwapPlan {
  const plan = new Plan();
  if (permit) plan.add(CMD.PERMIT2_PERMIT, enc.permit(permit.permit, permit.signature));
  const { hop, token } = route;
  let ethHeld: "weth" | "native";

  if (route.quote === "USDG") {
    if (hop.version === "v3") {
      plan.add(CMD.V3_SWAP_EXACT_IN, enc.v3ExactIn(ADDRESS_THIS, amountIn, 0n, v3Path([token, USDG, WETH], [hop.fee, ETH_USDG_V3_FEE]), true));
    } else {
      const actions = [V4.SWAP_EXACT_IN_SINGLE, V4.SETTLE_ALL, V4.TAKE];
      const params = [
        v4Param.swapExactInSingle(hop.key, same(hop.key.currency0, token), amountIn, 0n),
        v4Param.settleAll(token, amountIn),
        v4Param.take(USDG, ADDRESS_THIS, OPEN_DELTA),
      ];
      plan.add(CMD.V4_SWAP, v4Swap(actions, params));
      plan.add(CMD.V3_SWAP_EXACT_IN, enc.v3ExactIn(ADDRESS_THIS, CONTRACT_BALANCE, 0n, v3Path([USDG, WETH], [ETH_USDG_V3_FEE]), false));
    }
    ethHeld = "weth";
  } else if (hop.version === "v3") {
    plan.add(CMD.V3_SWAP_EXACT_IN, enc.v3ExactIn(ADDRESS_THIS, amountIn, 0n, v3Path([token, WETH], [hop.fee]), true));
    ethHeld = "weth";
  } else {
    const ethCurrency = v4EthCurrency(hop.key);
    if (!ethCurrency) throw new Error("Pool has no ETH side");
    const actions = [V4.SWAP_EXACT_IN_SINGLE, V4.SETTLE_ALL, V4.TAKE];
    const params = [
      v4Param.swapExactInSingle(hop.key, same(hop.key.currency0, token), amountIn, 0n),
      v4Param.settleAll(token, amountIn),
      v4Param.take(ethCurrency, ADDRESS_THIS, OPEN_DELTA),
    ];
    plan.add(CMD.V4_SWAP, v4Swap(actions, params));
    ethHeld = same(ethCurrency, WETH) ? "weth" : "native";
  }

  if (ethHeld === "weth") plan.add(CMD.UNWRAP_WETH, enc.unwrap(ADDRESS_THIS, 0n));
  plan.add(CMD.PAY_PORTION, enc.payPortion(NATIVE, feeWallet, FEE_BIPS));
  plan.add(CMD.SWEEP, enc.sweep(NATIVE, MSG_SENDER, minOutEth));
  return plan.build(0n);
}

const executeAbi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export function executeCalldata(plan: SwapPlan, deadline: bigint): Hex {
  return encodeFunctionData({ abi: executeAbi, functionName: "execute", args: [plan.commands, plan.inputs, deadline] });
}

/** EIP-712 typed data for a Permit2 PermitSingle (the trader signs it in their wallet). */
export function permitTypedData(permit: PermitSingle, chainId: number) {
  return {
    domain: { name: "Permit2", chainId, verifyingContract: PERMIT2 },
    types: {
      PermitSingle: [
        { name: "details", type: "PermitDetails" },
        { name: "spender", type: "address" },
        { name: "sigDeadline", type: "uint256" },
      ],
      PermitDetails: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint160" },
        { name: "expiration", type: "uint48" },
        { name: "nonce", type: "uint48" },
      ],
    },
    primaryType: "PermitSingle" as const,
    message: permit,
  };
}
