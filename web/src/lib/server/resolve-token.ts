import "server-only";
import type { MarketToken } from "@/lib/market";
import { NATIVE, USDG, WETH } from "@/lib/uniswap";
import { decimalsOf } from "./dexscreener";
import { lookupToken } from "./lookup";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const POOL_ID = /^0x([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
const QUOTES = new Set<string>([NATIVE, WETH, USDG]);

export type TokenRef = { token: string; pool?: string; version?: string; quote?: string; createdAt?: string | number; symbol?: string };

/**
 * The token to trade. When the app sends the pool it already knows, only decimals are read (onchain); a wrong
 * pool simply fails at the onchain quoter or simulation. Otherwise the token is looked up.
 */
export async function resolveToken(ref: TokenRef): Promise<MarketToken | null> {
  const address = String(ref.token ?? "").toLowerCase();
  if (!ADDRESS.test(address)) throw new Error("Not a contract address");
  const poolId = String(ref.pool ?? "").toLowerCase();
  const quoteAddress = String(ref.quote ?? "").toLowerCase();
  const version = ref.version;
  if (POOL_ID.test(poolId) && (version === "v3" || version === "v4") && QUOTES.has(quoteAddress)) {
    const createdAt = Number(ref.createdAt);
    return {
      symbol: String(ref.symbol ?? "TOKEN").slice(0, 20),
      name: "",
      address,
      decimals: await decimalsOf(address),
      kind: "meme",
      imageUrl: null,
      priceUsd: 0,
      change24h: 0,
      volume24h: 0,
      liquidity: 0,
      ageMinutes: -1,
      pool: {
        id: poolId,
        version,
        quoteSymbol: quoteAddress === USDG ? "USDG" : quoteAddress === WETH ? "WETH" : "ETH",
        quoteAddress,
        liquidityUsd: 0,
        createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : null,
      },
    };
  }
  return lookupToken(address);
}
