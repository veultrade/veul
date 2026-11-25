import { formatUnits, type Address } from "viem";
import allowlist from "@/data/stock-allowlist.json";
import type { BalancesResponse } from "@/lib/market";
import { erc20Abi } from "@/lib/uniswap";
import { decimalsOf } from "@/lib/server/dexscreener";
import { rpc } from "@/lib/server/env";
import { trendingTokens } from "@/lib/server/gecko";
import { ADDRESS, fail, json } from "@/lib/server/http";

/**
 * GET /api/balances?address=0x… — ETH, every allowlisted stock token, and trending memes when that list
 * is available. Everything is read onchain; the trending list is optional so balances never depend on it.
 */
export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address") ?? "";
  if (!ADDRESS.test(address)) return fail(new Error("Not a wallet address"), 400);
  try {
    const client = await rpc();
    const trending = await trendingTokens().catch(() => []);
    const stocks = await Promise.all(allowlist.tokens.map(async (t) => ({ address: t.address, symbol: t.symbol, decimals: await decimalsOf(t.address) })));
    const listed = [...stocks, ...trending.map((t) => ({ address: t.address, symbol: t.symbol, decimals: t.decimals }))].filter(
      (t, i, all) => all.findIndex((x) => x.address === t.address) === i,
    );
    const [eth, ...raw] = await Promise.all([
      client.getBalance({ address: address as Address }),
      ...listed.map((t) => client.readContract({ address: t.address as Address, abi: erc20Abi, functionName: "balanceOf", args: [address as Address] }).catch(() => 0n)),
    ]);
    const body: BalancesResponse = {
      address,
      eth: formatUnits(eth, 18),
      tokens: listed.map((t, i) => ({ address: t.address, symbol: t.symbol, amount: formatUnits(raw[i], t.decimals) })).filter((t) => Number(t.amount) > 0),
    };
    return json(body);
  } catch (error) {
    return fail(error);
  }
}
