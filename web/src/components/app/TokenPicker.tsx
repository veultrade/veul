"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getJson, type MarketToken, type TokenResponse } from "@/lib/market";
import { formatPrice, formatUsd, shortAddress } from "@/lib/tokens";
import { useMarket } from "./MarketProvider";
import { TokenAvatar } from "./TokenAvatar";
import { CloseIcon } from "./icons";
import styles from "./TokenPicker.module.css";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// Well-known tokens that are not in the meme or stock lists, found by name and looked up by address like a paste.
const BY_NAME: Record<string, string> = {
  usdg: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", // Global Dollar, the chain's main stablecoin
};

/**
 * Token search in a native <dialog> (focus trap and Esc for free).
 * Search the live lists by name, or paste any contract address to look it up on the chain's DEXes.
 */
export function TokenPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (token: MarketToken) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const market = useMarket();
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<{ address: string; token: MarketToken | null; error: string | null } | null>(null);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  const q = query.trim().toLowerCase();
  const isAddress = ADDRESS.test(q);
  // A typed name of a well-known token ("usd", "usdg") resolves to its address.
  const named = !isAddress && q.length >= 3 ? Object.entries(BY_NAME).find(([name]) => name.startsWith(q))?.[1] : undefined;
  const lookupAddress = isAddress ? q : named;
  const known = lookupAddress ? market.all.find((t) => t.address === lookupAddress) : undefined;

  // An address (pasted, or from a well-known name) that is not in our lists is looked up live.
  useEffect(() => {
    if (!lookupAddress || known) return;
    let alive = true;
    getJson<TokenResponse>(`/api/token/${lookupAddress}`)
      .then((body) => alive && setLookup({ address: lookupAddress, token: body.token, error: null }))
      .catch((reason: Error) => alive && setLookup({ address: lookupAddress, token: null, error: reason.message }));
    return () => {
      alive = false;
    };
  }, [lookupAddress, known]);

  const looked = lookup && lookup.address === lookupAddress ? lookup.token : null;
  const results = useMemo(() => {
    if (!q) return null;
    if (isAddress) return known ? [known] : looked ? [looked] : [];
    const byName = market.all.filter((t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q));
    const extra = known ?? looked;
    return extra && !byName.some((t) => t.address === extra.address) ? [extra, ...byName] : byName;
  }, [q, isAddress, known, looked, market.all]);

  const pick = (token: MarketToken) => {
    onPick(token);
    setQuery("");
    onClose();
  };

  const row = (token: MarketToken) => (
    <li key={token.address}>
      <button type="button" className={styles.row} onClick={() => pick(token)}>
        <TokenAvatar token={token} size={32} />
        <span className={styles.name}>
          <strong>{token.symbol}</strong>
          <span className="mono">{shortAddress(token.address)}</span>
        </span>
        <span className={styles.nums}>
          <span className="mono">{formatPrice(token.priceUsd)}</span>
          <span className={`mono ${token.change24h >= 0 ? styles.up : styles.down}`}>
            {token.change24h >= 0 ? "+" : ""}
            {token.change24h.toFixed(1)}%
          </span>
        </span>
        <span className={`mono ${styles.vol}`}>{token.pool ? `${formatUsd(token.volume24h)} vol` : "no Uniswap route"}</span>
      </button>
    </li>
  );

  const searching = Boolean(lookupAddress) && !known && lookup?.address !== lookupAddress;

  return (
    <dialog ref={dialog} className={styles.dialog} onClose={onClose} onClick={(event) => event.target === dialog.current && onClose()} aria-labelledby="picker-title">
      <div className={styles.panel}>
        <div className={styles.head}>
          <h2 id="picker-title">Pick a token</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <input
          className={styles.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search a name or paste an address"
          autoFocus
          aria-label="Search tokens"
          autoComplete="off"
          spellCheck={false}
        />

        <div className={styles.list}>
          {results ? (
            searching ? (
              <p className={styles.empty}>{isAddress ? "Looking up this address on Robinhood Chain…" : "Looking it up on Robinhood Chain…"}</p>
            ) : results.length ? (
              <ul>{results.map(row)}</ul>
            ) : (
              <p className={styles.empty}>
                {isAddress ? (lookup?.error ?? "No pools found for this address.") : "No token in the live lists matches that name. Paste its contract address instead."}
              </p>
            )
          ) : market.data ? (
            <>
              <h3>Trending memes</h3>
              <ul>{market.data.trending.map(row)}</ul>
              <h3>Stock tokens</h3>
              <ul>{market.data.stocks.map(row)}</ul>
            </>
          ) : (
            <p className={styles.empty}>{market.error ? `Prices could not load: ${market.error}` : "Loading live prices…"}</p>
          )}
        </div>
      </div>
    </dialog>
  );
}
