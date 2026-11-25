import "server-only";
import { encodeAbiParameters, formatUnits, keccak256, parseUnits, type Address, type Hex } from "viem";
import type { MarketPool, MarketToken, QuoteResponse } from "@/lib/market";
import {
  FEE_BPS,
  NATIVE,
  UNISWAP,
  USDG,
  USDG_DECIMALS,
  WETH,
  WETH_USDG_V3,
  initializeEvent,
  positionManagerAbi,
  quoterV2Abi,
  v3PoolAbi,
  v4QuoterAbi,
} from "@/lib/uniswap";
import { cached } from "./cache";
import { rpc } from "./env";

export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
type Leg = { kind: "v3"; fee: number } | { kind: "v4"; key: PoolKey };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** v3: fee tier from the pool contract. */
function v3Fee(pool: Address) {
  return cached(`v3fee:${pool}`, 86_400_000, async () => Number(await (await rpc()).readContract({ address: pool, abi: v3PoolAbi, functionName: "fee" })));
}

export const poolIdOf = (key: PoolKey) =>
  keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );

// Common hookless fee / tick spacing pairs, plus the dynamic-fee flag.
export const HOOKLESS = [
  [100, 1],
  [500, 10],
  [3000, 60],
  [10000, 200],
  [0x800000, 1],
  [0x800000, 10],
  [0x800000, 60],
  [0x800000, 200],
] as const;

/** Hookless pools: rebuild the key from the two currencies and check it hashes to the pool id. No RPC calls. */
function guessKey(poolId: Hex, tokenA: Address, tokenB: Address): PoolKey | null {
  const [currency0, currency1] = tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
  for (const [fee, tickSpacing] of HOOKLESS) {
    const key = { currency0, currency1, fee, tickSpacing, hooks: NATIVE };
    if (same(poolIdOf(key), poolId)) return key;
  }
  return null;
}

/** First block at or after a timestamp (binary search; the free RPC plan only allows 10-block log queries). */
async function blockAt(seconds: number): Promise<bigint> {
  const client = await rpc();
  let low = 0n;
  let high = await client.getBlockNumber();
  while (low < high) {
    const mid = (low + high) / 2n;
    const block = await client.getBlock({ blockNumber: mid });
    if (Number(block.timestamp) < seconds) low = mid + 1n;
    else high = mid;
  }
  return low;
}

/** Initialize event of a v4 pool, searched in 10-block windows around the pool's creation time. */
async function keyFromLogs(poolId: Hex, createdAt: number): Promise<PoolKey | null> {
  const client = await rpc();
  const center = await blockAt(Math.floor(createdAt / 1000));
  const WINDOW = 10n;
  const REACH = 200n; // blocks on each side; creation times from data sources can be a little off
  for (let offset = 0n; offset <= REACH; offset += WINDOW) {
    for (const from of offset === 0n ? [center - WINDOW / 2n] : [center - offset - WINDOW / 2n, center + offset - WINDOW / 2n]) {
      const logs = await client.getLogs({ address: UNISWAP.v4PoolManager, event: initializeEvent, args: { id: poolId }, fromBlock: from, toBlock: from + WINDOW - 1n });
      const found = logs[0]?.args;
      if (found?.currency0 && found.currency1 !== undefined && found.fee !== undefined && found.tickSpacing !== undefined && found.hooks) {
        return { currency0: found.currency0, currency1: found.currency1, fee: found.fee, tickSpacing: found.tickSpacing, hooks: found.hooks };
      }
    }
  }
  return null;
}

/**
 * v4: the PoolKey behind a pool id, in order of cost: PositionManager's stored key, a hookless guess,
 * then the Initialize event near the pool's creation time. Cached, since a key never changes.
 */
function v4Key(pool: MarketPool, token: Address) {
  const poolId = pool.id as Hex;
  return cached(`v4key:${poolId}`, 86_400_000, async (): Promise<PoolKey> => {
    const client = await rpc();
    const [currency0, currency1, fee, tickSpacing, hooks] = await client.readContract({
      address: UNISWAP.v4PositionManager,
      abi: positionManagerAbi,
      functionName: "poolKeys",
      args: [poolId.slice(0, 52) as Hex],
    });
    if (tickSpacing !== 0) return { currency0, currency1, fee, tickSpacing, hooks };
    const other = pool.quoteAddress as Address;
    const guess = guessKey(poolId, token, other) ?? (same(other, NATIVE) ? guessKey(poolId, token, WETH) : null);
    if (guess) return guess;
    const fromLogs = pool.createdAt ? await keyFromLogs(poolId, pool.createdAt) : null;
    if (fromLogs) return fromLogs;
    throw new Error("This pool's settings could not be read yet. Try another token.");
  });
}

export async function legFor(pool: MarketPool, token: Address): Promise<Leg> {
  return pool.version === "v3" ? { kind: "v3", fee: await v3Fee(pool.id as Address) } : { kind: "v4", key: await v4Key(pool, token) };
}

/** Exact-input quote through one pool. "ETH" in a v3 pool is WETH; in a v4 pool it is whichever the key uses. */
export async function quoteLeg(leg: Leg, tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<bigint> {
  const client = await rpc();
  if (leg.kind === "v3") {
    const toErc20 = (token: Address) => (same(token, NATIVE) ? WETH : token);
    const { result } = await client.simulateContract({
      address: UNISWAP.v3QuoterV2,
      abi: quoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn: toErc20(tokenIn), tokenOut: toErc20(tokenOut), amountIn, fee: leg.fee, sqrtPriceLimitX96: 0n }],
    });
    return result[0];
  }
  const { key } = leg;
  // Match ETH/WETH to the currency the pool actually uses.
  const isEth = (token: Address) => same(token, NATIVE) || same(token, WETH);
  const poolEth = isEth(key.currency0) ? key.currency0 : isEth(key.currency1) ? key.currency1 : null;
  const input = isEth(tokenIn) && poolEth ? poolEth : tokenIn;
  const { result } = await client.simulateContract({
    address: UNISWAP.v4Quoter,
    abi: v4QuoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{ poolKey: key, zeroForOne: same(input, key.currency0), exactAmount: amountIn, hookData: "0x" }],
  });
  return result[0];
}

const ethUsdgLeg: Leg = { kind: "v3", fee: WETH_USDG_V3.fee };

/** ETH price in USD from the deepest ETH/USDG Uniswap pool (quote of 1 ETH), so it needs no price API. */
export function ethPriceUsd(): Promise<number> {
  return cached("eth:usd", 60_000, async () => Number(formatUnits(await quoteLeg(ethUsdgLeg, WETH, USDG, 10n ** 18n), USDG_DECIMALS)));
}

/**
 * USD price of a token from its pool: quote of a small sell (1/100 of a token, so price impact is negligible),
 * with the pool's fee added back so the number is the pool's mid price. Dynamic-fee v4 pools keep their fee in.
 */
export function tokenPriceUsd(token: MarketToken): Promise<number> {
  return cached(`price:${token.address}`, 60_000, async () => {
    const pool = token.pool;
    if (!pool) return 0;
    const leg = await legFor(pool, token.address as Address);
    const unit = 10n ** BigInt(token.decimals);
    const amount = unit / 100n || 1n;
    const scale = Number(unit) / Number(amount);
    const feePpm = leg.kind === "v3" ? leg.fee : leg.key.fee & 0x800000 ? 0 : leg.key.fee;
    const midFactor = 1 / (1 - feePpm / 1_000_000);
    if (same(pool.quoteAddress, USDG)) {
      const out = await quoteLeg(leg, token.address as Address, USDG, amount);
      return Number(formatUnits(out, USDG_DECIMALS)) * scale * midFactor;
    }
    const out = await quoteLeg(leg, token.address as Address, NATIVE, amount);
    return Number(formatUnits(out, 18)) * scale * midFactor * (await ethPriceUsd());
  });
}

const takeFee = (amount: bigint) => amount - (amount * FEE_BPS) / 10_000n;

/**
 * Quote a buy (ETH in) or sell (token in). The 0.5% fee is always taken in ETH:
 * from the input on a buy, from the output on a sell, so Stockup never collects meme tokens.
 */
export async function quote(token: MarketToken, side: "buy" | "sell", amount: string): Promise<QuoteResponse> {
  const pool = token.pool;
  if (!pool) throw new Error(`${token.symbol} has no Uniswap pool Stockup can route yet`);
  const leg = await legFor(pool, token.address as Address);
  const viaUsdg = same(pool.quoteAddress, USDG);
  const asset = token.address as Address;
  const tokenLabel = `${token.symbol} (${pool.version})`;
  const route = viaUsdg ? (side === "buy" ? `ETH → USDG (v3) → ${tokenLabel}` : `${tokenLabel} → USDG → ETH (v3)`) : side === "buy" ? `ETH → ${tokenLabel}` : `${tokenLabel} → ETH`;

  let feeWei: bigint;
  let out: bigint;
  if (side === "buy") {
    const inWei = parseUnits(amount, 18);
    feeWei = (inWei * FEE_BPS) / 10_000n;
    const net = inWei - feeWei;
    const start = viaUsdg ? await quoteLeg(ethUsdgLeg, WETH, USDG, net) : net;
    out = await quoteLeg(leg, viaUsdg ? USDG : NATIVE, asset, start);
  } else {
    const inUnits = parseUnits(amount, token.decimals);
    const mid = await quoteLeg(leg, asset, viaUsdg ? USDG : NATIVE, inUnits);
    const gross = viaUsdg ? await quoteLeg(ethUsdgLeg, USDG, WETH, mid) : mid;
    out = takeFee(gross);
    feeWei = gross - out;
  }

  return {
    side,
    amountIn: amount,
    amountOut: formatUnits(out, side === "buy" ? token.decimals : 18),
    feeEth: formatUnits(feeWei, 18),
    route,
    quotedAt: new Date().toISOString(),
  };
}
