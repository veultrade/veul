import type { Address } from "viem";

/**
 * Uniswap contracts on Robinhood Chain (4663), copied from Uniswap's official deployment pages on 2026-11-20:
 * developers.uniswap.org/docs/protocols/v4/deployments and .../v3/deployments/v3-robinhood-chain-deployments.
 */
export const UNISWAP = {
  v3Factory: "0x1f7d7550b1b028f7571e69a784071f0205fd2efa",
  v3QuoterV2: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
  v4PoolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  v4PositionManager: "0x58daec3116aae6d93017baaea7749052e8a04fa7",
  v4Quoter: "0x8dc178efb8111bb0973dd9d722ebeff267c98f94",
  v4StateView: "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b",
  universalRouter: "0x8876789976decbfcbbbe364623c63652db8c0904",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
} as const satisfies Record<string, Address>;

/** Tokens the router needs by address (checked onchain: WETH symbol() = "WETH"). */
export const WETH: Address = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
export const USDG: Address = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
export const NATIVE: Address = "0x0000000000000000000000000000000000000000";
export const USDG_DECIMALS = 6;

/** Deepest Uniswap ETH/USDG pool (v3, 0.01%, about $10M): the hop for tokens priced in USDG. */
export const WETH_USDG_V3 = { pool: "0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca" as Address, fee: 100 };

export const FEE_BPS = 50n; // 0.5%

export const v3PoolAbi = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
] as const;

export const quoterV2Abi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

const poolKey = {
  name: "poolKey",
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
} as const;

export const v4QuoterAbi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [poolKey, { name: "zeroForOne", type: "bool" }, { name: "exactAmount", type: "uint128" }, { name: "hookData", type: "bytes" }],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

/** PositionManager keeps the PoolKey of every pool it has seen, by the first 25 bytes of the pool id. */
export const positionManagerAbi = [
  {
    type: "function",
    name: "poolKeys",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes25" }],
    outputs: [
      { name: "currency0", type: "address" },
      { name: "currency1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "hooks", type: "address" },
    ],
  },
] as const;

export const initializeEvent = {
  type: "event",
  name: "Initialize",
  inputs: [
    { name: "id", type: "bytes32", indexed: true },
    { name: "currency0", type: "address", indexed: true },
    { name: "currency1", type: "address", indexed: true },
    { name: "fee", type: "uint24", indexed: false },
    { name: "tickSpacing", type: "int24", indexed: false },
    { name: "hooks", type: "address", indexed: false },
    { name: "sqrtPriceX96", type: "uint160", indexed: false },
    { name: "tick", type: "int24", indexed: false },
  ],
} as const;

export const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
