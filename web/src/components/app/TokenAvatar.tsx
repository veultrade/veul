"use client";

import { useState } from "react";
import type { MarketToken } from "@/lib/market";
import styles from "./TokenAvatar.module.css";

type AvatarToken = Pick<MarketToken, "symbol" | "kind"> & { imageUrl?: string | null };

/** Token logo when the data source has one; otherwise a gradient from the symbol. ETH and stocks get fixed looks. */
export function TokenAvatar({ token, size = 28 }: { token: AvatarToken | "ETH"; size?: number }) {
  const symbol = token === "ETH" ? "ETH" : token.symbol;
  const imageUrl = token !== "ETH" ? token.imageUrl : null;
  const [failed, setFailed] = useState<string | null>(null);
  if (imageUrl && failed !== imageUrl) {
    // Remote logos from DexScreener/CoinGecko; plain img because Workers has no image optimizer here.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={styles.avatar} src={imageUrl} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(imageUrl)} />;
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
