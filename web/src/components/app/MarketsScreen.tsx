"use client";

import { useEffect, useRef, useState } from "react";
import { getJson, type MarketToken, type TokenResponse } from "@/lib/market";
import { findIn, formatPrice, formatUsd } from "@/lib/tokens";
import { useMarket } from "./MarketProvider";
import { useTrade } from "./TradeContext";
import { Flash, Skeleton } from "./motion";
import { TokenAvatar } from "./TokenAvatar";
import calm from "./Calm.module.css";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const LISTS = { trending: "Trending", stocks: "Stocks", fresh: "New pools" } as const;
type List = keyof typeof LISTS;

const change = (value: number) => `${value >= 0 ? "+" : ""}${Math.abs(value) >= 100 ? Math.round(value) : value.toFixed(2)}%`;

/**
 * Markets, the app's home: one calm list per tab (trending memes, stock tokens, new pools). A row opens the token
 * drawer; its Trade button loads the dock. `?token=` (address or symbol, from links and the landing) opens that
 * token's drawer and ticket on arrival.
 */
export function MarketsScreen({ initialToken }: { initialToken?: string }) {
  const market = useMarket();
  const trade = useTrade();
  const [chosen, setList] = useState<List | null>(null);
  const handled = useRef(false);

  // Until a list is chosen, show Trending, or Stocks when Trending is empty (its source can pause).
  const list: List = chosen ?? (market.data && market.data.trending.length === 0 ? "stocks" : "trending");
  const tokens = market.data?.[list] ?? [];

  // ?token=: once the list has loaded, find the token there or look it up by address.
  const { openDrawer, openTicket } = trade;
  useEffect(() => {
    if (!initialToken || handled.current || !market.data) return;
    handled.current = true;
    const open = (token: MarketToken) => {
      openDrawer(token);
      if (token.pool) openTicket(token);
    };
    const known = ADDRESS.test(initialToken) ? market.all.find((t) => t.address === initialToken.toLowerCase()) : findIn(market.all, initialToken);
    if (known) open(known);
    else if (ADDRESS.test(initialToken))
      getJson<TokenResponse>(`/api/token/${initialToken.toLowerCase()}`)
        .then((body) => open(body.token))
        .catch(() => {});
  }, [initialToken, market.data, market.all, openDrawer, openTicket]);

  return (
    <div className={calm.col}>
      <h1 className={calm.title}>Markets</h1>

      <div className={calm.tabs} role="tablist" aria-label="Lists">
        {(Object.keys(LISTS) as List[]).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={list === key} className={list === key ? calm.tabOn : ""} onClick={() => setList(key)}>
            {LISTS[key]}
            {market.data && <span className={calm.count}>{market.data[key].length}</span>}
          </button>
        ))}
      </div>

      {market.error && !market.data ? (
        <div className={calm.list}>
          <p className={calm.empty}>
            Prices could not load: {market.error}.{" "}
            <button type="button" className={calm.pill} onClick={market.reload}>
              Try again
            </button>
          </p>
        </div>
      ) : (
        <ul className={calm.list} aria-busy={market.loading}>
          {!market.data &&
            Array.from({ length: 10 }, (_, i) => (
              <li key={i} className={calm.row}>
                <Skeleton width={32} height={32} />
                <span className={calm.name}>
                  <Skeleton width="30%" height={14} />
                </span>
                <Skeleton width={70} height={14} />
              </li>
            ))}
          {market.data && tokens.length === 0 && (
            <li className={calm.empty}>
              {list === "stocks" ? "Stock prices could not be read right now. Try again in a minute." : "This list is not available right now: its data source is limiting requests. Stocks and trading still work."}
            </li>
          )}
          {tokens.map((token) => (
            <li key={token.address}>
              <button
                type="button"
                className={`${calm.row} ${trade.drawer?.address === token.address ? calm.rowOn : ""} ${token.pool ? "" : calm.dim}`}
                onClick={() => trade.openDrawer(token)}
              >
                <TokenAvatar token={token} size={32} />
                <span className={calm.name}>
                  <strong>
                    {token.symbol}
                    {token.kind === "stock" && <em className={calm.stockTag}>Stock</em>}
                  </strong>
                  <small>{token.pool ? `${formatUsd(token.volume24h)} vol` : "No Uniswap route"}</small>
                </span>
                <span className={calm.end}>
                  <Flash value={token.priceUsd}>{formatPrice(token.priceUsd)}</Flash>
                  <small className={token.change24h >= 0 ? calm.up : calm.down}>{change(token.change24h)}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className={calm.foot}>Open a token for its chart, holders and risk check. Prices refresh every minute. Not advice.</p>
    </div>
  );
}
