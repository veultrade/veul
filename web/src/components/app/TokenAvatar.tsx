"use client";

import { useState } from "react";
import type { MarketToken } from "@/lib/market";
import stockLogos from "@/lib/stock-logos.json";
import styles from "./TokenAvatar.module.css";

// Company logos served by Veul (web/public/stocks, from scripts/fetch-stock-logos.mjs). The tokens' own image is the
// same Robinhood feather for every stock, so these win for stocks wherever a stock is shown.
const STOCK_LOGOS = new Set<string>(stockLogos);
// White-on-transparent logos, which vanish on the white tile; they get a dark tile instead.
const LIGHT_LOGOS = new Set(["QQQ"]);

type AvatarToken = Pick<MarketToken, "symbol" | "kind"> & { imageUrl?: string | null };

/** Token logo: our company logo for stocks, else the data source's, else the first letter on a jewel tone. */
export function TokenAvatar({ token, size = 28 }: { token: AvatarToken | "ETH"; size?: number }) {
  const symbol = token === "ETH" ? "ETH" : token.symbol;
  const stockLogo = token !== "ETH" && token.kind === "stock" && STOCK_LOGOS.has(symbol);
  // ETH has its own logo (web/public/tokens, from Wikimedia Commons).
  const imageUrl = token === "ETH" ? "/tokens/eth.png" : stockLogo ? `/stocks/${symbol}.png` : token.imageUrl;
  const [failed, setFailed] = useState<string | null>(null);
  if (imageUrl && failed !== imageUrl) {
    // Remote logos from DexScreener/CoinGecko; plain img because Workers has no image optimizer here.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={`${styles.avatar} ${stockLogo ? styles.stock : ""}`} src={imageUrl} alt="" width={size} height={size} style={stockLogo ? { width: size, height: size, padding: Math.round(size * 0.14), background: LIGHT_LOGOS.has(symbol) ? "#1c1c1c" : undefined } : undefined} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(imageUrl)} />;
  }
  const background = token === "ETH" ? "conic-gradient(from 200deg, #8a92b2, #62688f, #c5c8e8, #8a92b2)" : jewel(symbol);
  return (
    <span className={styles.avatar} style={{ width: size, height: size, background, fontSize: size * 0.4 }} aria-hidden="true">
      {symbol.slice(0, 1).toUpperCase()}
    </span>
  );
}

// Tokens without a logo: six deep, flat "jewel" tones with a cream letter (chosen 2026-11-26). The symbol picks the
// tone, so a token keeps its colour everywhere.
const JEWELS = ["#33506b", "#4f4470", "#6b3f50", "#3f5e4f", "#6a5a33", "#2f5c60"];

function jewel(symbol: string) {
  let hash = 0;
  for (const char of symbol) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return JEWELS[hash % JEWELS.length];
}
