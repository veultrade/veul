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

/** Token logo: our company logo for stocks, else the data source's, else a gradient from the symbol. */
export function TokenAvatar({ token, size = 28 }: { token: AvatarToken | "ETH"; size?: number }) {
  const symbol = token === "ETH" ? "ETH" : token.symbol;
  const stockLogo = token !== "ETH" && token.kind === "stock" && STOCK_LOGOS.has(symbol);
  const imageUrl = token === "ETH" ? null : stockLogo ? `/stocks/${symbol}.png` : token.imageUrl;
  const [failed, setFailed] = useState<string | null>(null);
  if (imageUrl && failed !== imageUrl) {
    // Remote logos from DexScreener/CoinGecko; plain img because Workers has no image optimizer here.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={`${styles.avatar} ${stockLogo ? styles.stock : ""}`} src={imageUrl} alt="" width={size} height={size} style={stockLogo ? { width: size, height: size, padding: Math.round(size * 0.14), background: LIGHT_LOGOS.has(symbol) ? "#1c1c1c" : undefined } : undefined} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(imageUrl)} />;
  }
  let background: string;
  if (token === "ETH") {
    background = "conic-gradient(from 200deg, #8a92b2, #62688f, #c5c8e8, #8a92b2)";
  } else if (token.kind === "stock") {
    // Stocks share the accent blue (the logo gradient), so paybacks read as one colour across the app.
    background = "linear-gradient(140deg, #7cc4ec, #1f5f86)";
  } else {
    // Stable hue per symbol so a token keeps its colour everywhere.
    let hash = 0;
    for (const char of symbol) hash = (hash * 31 + char.charCodeAt(0)) % 360;
    background = `radial-gradient(circle at 32% 30%, hsl(${hash} 85% 72%), hsl(${(hash + 40) % 360} 60% 32%))`;
  }
  return (
    <span className={styles.avatar} style={{ width: size, height: size, background, fontSize: size * 0.36 }} aria-hidden="true">
      {symbol.slice(0, 1)}
    </span>
  );
}
