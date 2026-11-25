"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/site/Wordmark";
import { AuthProvider } from "./AuthProvider";
import { BagProvider } from "./BagStore";
import { MarketProvider } from "./MarketProvider";
import { AccountButton } from "./AccountButton";
import { AgentIcon, BagIcon, DiscoverIcon, GiftIcon, LedgerIcon, MoreIcon, SwapIcon, WalletIcon } from "./icons";
import styles from "./AppShell.module.css";

const NAV = [
  { href: "/app", label: "Swap", Icon: SwapIcon },
  { href: "/app/discover", label: "Discover", Icon: DiscoverIcon },
  { href: "/app/wallet", label: "Wallet", Icon: WalletIcon },
  { href: "/app/bag", label: "Stock bag", Icon: BagIcon },
  { href: "/app/ledger", label: "Ledger", Icon: LedgerIcon },
  { href: "/app/rewards", label: "Rewards", Icon: GiftIcon },
  { href: "/app/agents", label: "Agents", Icon: AgentIcon },
];

// Phones get five tabs; the rest sit behind More.
const TABS = [...NAV.slice(0, 4), { href: "/app/more", label: "More", Icon: MoreIcon }];
const MORE_PATHS = ["/app/more", "/app/ledger", "/app/rewards", "/app/agents"];

/**
 * App frame: sidebar on desktop, top bar + bottom tabs on phones.
 * Providers live here so the landing page never loads Privy.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  const nav = (variant: "side" | "tabs") => (
    <nav className={variant === "side" ? styles.sideNav : styles.tabs} aria-label="App">
      {(variant === "side" ? NAV : TABS).map(({ href, label, Icon }) => {
        const active =
          href === "/app"
            ? pathname === "/app"
            : href === "/app/more" && variant === "tabs"
              ? MORE_PATHS.some((path) => pathname.startsWith(path))
              : pathname.startsWith(href);
        return (
          <Link key={href} href={href} className={`${styles.navLink} ${active ? styles.active : ""}`} aria-current={active ? "page" : undefined}>
            <Icon />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <AuthProvider>
      <MarketProvider>
      <BagProvider>
        <div className={styles.frame}>
          <aside className={styles.side}>
            <Wordmark name="Veul" />
            {nav("side")}
            <div className={styles.sideFoot}>
              <p className={styles.preview}>
                <span className="mono">Preview</span>
                Live prices and quotes. Swaps are simulated until real swaps go live.
              </p>
              <AccountButton />
            </div>
          </aside>

          <header className={styles.top}>
            <Wordmark size="sm" href="/" name="Veul" />
            <AccountButton compact />
          </header>

          <main className={styles.main}>{children}</main>

          {nav("tabs")}
        </div>
      </BagProvider>
      </MarketProvider>
    </AuthProvider>
  );
}
