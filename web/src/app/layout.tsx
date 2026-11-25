import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Geist for everything, Geist Mono for numbers and small labels (the v3 look, after datavendor.ai, 2026-11-25).
const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Veul · Get paid back in stocks",
  description: "Veul swaps any token on Robinhood Chain through Uniswap. 0.25% of every trade comes back to you as the stock you pick.",
  robots: { index: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
