"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { getJson, type MarketToken, type TokenResponse } from "@/lib/market";
import { formatPrice, formatUsd } from "@/lib/tokens";
import { useMarket } from "./MarketProvider";
import { TokenAvatar } from "./TokenAvatar";
import styles from "./TokenPicker.module.css";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// Well-known tokens that are not in the meme or stock lists, found by name and looked up by address like a paste.
const BY_NAME: Record<string, string> = {
  usdg: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", // Global Dollar, the chain's main stablecoin
};

// Stock tokens are named "Tesla • Robinhood Token"; the suffix says nothing the Stock group does not.
const displayName = (name: string) => name.replace(/\s*•\s*Robinhood Token$/i, "");
const change = (value: number) => `${value >= 0 ? "+" : ""}${Math.abs(value) >= 100 ? Math.round(value) : value.toFixed(2)}%`;

/**
 * Token search in a native <dialog> (focus trap and Esc for free), in the calm look: a pill search field, rows like
 * the Markets list, grouped into Trending and Stocks until you type. Arrow keys move, Enter opens.
 * Search the live lists by name, or paste any contract address to look it up on the chain's DEXes.
 */
export function TokenPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (token: MarketToken) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const market = useMarket();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
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

  // What is on screen, in order: one list of results, or the Trending and Stocks groups.
  const groups = useMemo<{ label: string | null; tokens: MarketToken[] }[]>(() => {
    if (results) return [{ label: null, tokens: results }];
    if (!market.data) return [];
    return [
      { label: "Trending", tokens: market.data.trending },
      { label: "Stocks", tokens: market.data.stocks },
    ].filter((group) => group.tokens.length > 0);
  }, [results, market.data]);
  const flat = useMemo(() => groups.flatMap((group) => group.tokens), [groups]);
  const current = Math.min(active, Math.max(flat.length - 1, 0));

  // Keep the highlighted row in view while moving with the arrow keys.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const pick = (token: MarketToken) => {
    onPick(token);
    setQuery("");
    setActive(0);
    onClose();
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!flat.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + flat.length) % flat.length);
    } else if (event.key === "Enter" && flat[current]) {
      event.preventDefault();
      pick(flat[current]);
    }
  };

  const searching = Boolean(lookupAddress) && !known && lookup?.address !== lookupAddress;
  let index = 0;

  return (
    <dialog ref={dialog} className={styles.dialog} onClose={onClose} onClick={(event) => event.target === dialog.current && onClose()} aria-labelledby="picker-title">
      <div className={styles.panel}>
        <h2 id="picker-title" className={styles.srOnly}>
          Search tokens
        </h2>
        <label className={styles.search}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            placeholder="Search a token or paste an address"
            autoFocus
            aria-label="Search tokens"
            aria-activedescendant={flat[current] ? `picker-${flat[current].address}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className={styles.esc} onClick={onClose} aria-label="Close">
            esc
          </button>
        </label>

        <div ref={list} className={styles.list} role="listbox" aria-label="Tokens">
          {searching ? (
            <p className={styles.empty}>{isAddress ? "Looking up this address on Robinhood Chain…" : "Looking it up on Robinhood Chain…"}</p>
          ) : results && results.length === 0 ? (
            <p className={styles.empty}>
              {isAddress ? (lookup?.error ?? "No pools found for this address.") : "No token in the live lists matches that name. Paste its contract address instead."}
            </p>
          ) : groups.length === 0 ? (
            <p className={styles.empty}>{market.error ? `Prices could not load: ${market.error}` : "Loading live prices…"}</p>
          ) : (
            groups.map((group) => (
              <section key={group.label ?? "results"} aria-label={group.label ?? "Results"}>
                {group.label && <h3>{group.label}</h3>}
                <ul className={styles.group}>
                  {group.tokens.map((token) => {
                    const at = index++;
                    return (
                      <li key={token.address}>
                        <button
                          type="button"
                          id={`picker-${token.address}`}
                          role="option"
                          aria-selected={at === current}
                          data-index={at}
                          className={`${styles.row} ${at === current ? styles.on : ""} ${token.pool ? "" : styles.dim}`}
                          onClick={() => pick(token)}
                          onMouseMove={() => at !== current && setActive(at)}
                        >
                          <TokenAvatar token={token} size={32} />
                          <span className={styles.name}>
                            <strong>{token.symbol}</strong>
                            <small>
                              {displayName(token.name) !== token.symbol ? `${displayName(token.name)} · ` : ""}
                              {token.pool ? `${formatUsd(token.volume24h)} vol` : "No Uniswap route"}
                            </small>
                          </span>
                          <span className={styles.end}>
                            {formatPrice(token.priceUsd)}
                            <small className={token.change24h >= 0 ? styles.up : styles.down}>{change(token.change24h)}</small>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>

        <p className={styles.keys} aria-hidden="true">
          <span>↑ ↓ move</span>
          <span>↵ open</span>
          <span>esc close</span>
        </p>
      </div>
    </dialog>
  );
}
