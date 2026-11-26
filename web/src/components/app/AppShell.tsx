"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Wordmark } from "@/components/site/Wordmark";
import { appPath, siteUrl, stripAppBase } from "@/lib/urls";
import { formatFixed } from "@/lib/tokens";
import { AuthProvider } from "./AuthProvider";
import { BagProvider, useBag } from "./BagStore";
import { MarketProvider } from "./MarketProvider";
import { AccountButton } from "./AccountButton";
import { TokenDrawer } from "./TokenDrawer";
import { TokenPicker } from "./TokenPicker";
import { TradeDock } from "./TradeDock";
import { TradeProvider, useTrade } from "./TradeContext";
import styles from "./AppShell.module.css";

// Paths are the app host's own (app.veul.trade/bag); next.config.ts maps them onto the /app routes.
// `phone: false` links sit behind More on phones.
const NAV = [
  { href: "/", label: "Markets", phone: true },
  { href: "/bag", label: "Bag", phone: true },
  { href: "/activity", label: "Activity", phone: true },
  { href: "/rewards", label: "Rewards", phone: false },
  { href: "/agents", label: "Agents", phone: false },
  { href: "/wallet", label: "Wallet", phone: false },
  { href: "/more", label: "More", phone: true, phoneOnly: true },
];
const MORE_PATHS = ["/more", "/rewards", "/agents", "/wallet", "/ledger"];

function isActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  if (href === "/more") return MORE_PATHS.some((path) => pathname.startsWith(path));
  return pathname.startsWith(href);
}

/** What the wallet has been paid back so far (verified), linking to the bag. Hidden until there is any. */
function PaidBack() {
  const bag = useBag();
  if (!bag.verified || bag.verified.totals.trades === 0) return null;
  return (
    <Link href={appPath("/bag")} className={styles.paid}>
      Paid back <b>${formatFixed(bag.totalUsd, bag.totalUsd < 1 ? 4 : 2)}</b>
    </Link>
  );
}

/** Search icon in the top bar: the same token search as the dock's box (which also opens on "/"). */
function SearchButton() {
  const trade = useTrade();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={styles.iconBtn} onClick={() => setOpen(true)} aria-label="Search tokens">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </button>
      <TokenPicker open={open} onClose={() => setOpen(false)} onPick={(token) => trade.openDrawer(token)} />
    </>
  );
}

function Frame({ children }: { children: ReactNode }) {
  // Compare against the app's own paths ("/bag"), whatever prefix the host serves them under.
  const pathname = stripAppBase(usePathname());
  const trade = useTrade();

  return (
    <div className={styles.frame}>
      <header className={styles.top}>
        <div className={styles.topDock}>
          <Wordmark name="veul" href={siteUrl()} />
          <button type="button" className={styles.newTrade} onClick={trade.closeTicket} aria-label="New trade" title="New trade">
            +
          </button>
        </div>
        <div className={styles.topMain}>
          <nav className={styles.nav} aria-label="App">
            {NAV.map(({ href, label, phone, phoneOnly }) => {
              const active = isActive(href, pathname);
              return (
                <Link
                  key={href}
                  href={appPath(href)}
                  className={`${active ? styles.on : ""} ${phone ? "" : styles.desktopOnly} ${phoneOnly ? styles.phoneOnly : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className={styles.topEnd}>
            <SearchButton />
            <span className={styles.preview} title="Live prices and quotes. Swaps are simulated until real swaps go live.">
              Preview
            </span>
            <PaidBack />
            <AccountButton compact />
          </div>
        </div>
      </header>

      <TradeDock />

      <main className={styles.main}>
        {/* Keyed by route so each screen fades in as it opens. */}
        <div key={pathname} className={styles.screen}>
          {children}
        </div>
      </main>

      <TokenDrawer />
    </div>
  );
}

/**
 * App frame (after app.circuit.org): a top bar without chrome, the trade dock on the left on every screen, one calm
 * column for the screens, and the token drawer. Providers live here so the landing never loads Privy.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <MarketProvider>
        <BagProvider>
          <TradeProvider>
            <Frame>{children}</Frame>
          </TradeProvider>
        </BagProvider>
      </MarketProvider>
    </AuthProvider>
  );
}
