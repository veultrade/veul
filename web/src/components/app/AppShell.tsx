"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Wordmark } from "@/components/site/Wordmark";
import { appPath, siteUrl, stripAppBase } from "@/lib/urls";
import { AuthProvider } from "./AuthProvider";
import { BagProvider } from "./BagStore";
import { MarketProvider } from "./MarketProvider";
import { AccountButton } from "./AccountButton";
import { useBag } from "./BagStore";
import { TokenPicker } from "./TokenPicker";
import { formatFixed } from "@/lib/tokens";
import { AgentIcon, BagIcon, DiscoverIcon, GiftIcon, LedgerIcon, MoreIcon, SwapIcon, WalletIcon } from "./icons";
import styles from "./AppShell.module.css";

// Paths are the app host's own (app.veul.trade/bag); next.config.ts maps them onto the /app routes.
const NAV = [
  { href: "/", label: "Trade", Icon: SwapIcon },
  { href: "/discover", label: "Discover", Icon: DiscoverIcon },
  { href: "/wallet", label: "Wallet", Icon: WalletIcon },
  { href: "/bag", label: "Stock bag", Icon: BagIcon },
  { href: "/ledger", label: "Ledger", Icon: LedgerIcon },
  { href: "/rewards", label: "Rewards", Icon: GiftIcon },
  { href: "/agents", label: "Agents", Icon: AgentIcon },
];

// Phones get five tabs; the rest sit behind More.
const TABS = [...NAV.slice(0, 4), { href: "/more", label: "More", Icon: MoreIcon }];
const MORE_PATHS = ["/more", "/ledger", "/rewards", "/agents"];

function isActive(href: string, pathname: string, tabs = false) {
  if (href === "/") return pathname === "/";
  if (tabs && href === "/more") return MORE_PATHS.some((path) => pathname.startsWith(path));
  return pathname.startsWith(href);
}

/**
 * The top navigation with an underline that slides to the active tab (measured from the links, so it follows any
 * label width). It jumps without animation on first paint and glides on later route changes.
 */
function TopNav({ pathname }: { pathname: string }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number; animate: boolean } | null>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLAnchorElement>("[aria-current='page']");
    if (!list || !active) return;
    const place = () => setPill((previous) => ({ left: active.offsetLeft, width: active.offsetWidth, animate: previous !== null }));
    place();
    const observer = new ResizeObserver(place);
    observer.observe(list);
    return () => observer.disconnect();
  }, [pathname]);

  return (
    <nav className={styles.topNav} aria-label="App">
      <div ref={listRef} className={styles.topNavList}>
        {pill && (
          <span
            className={`${styles.pill} ${pill.animate ? styles.pillAnimate : ""}`}
            style={{ transform: `translateX(${pill.left}px)`, width: pill.width }}
            aria-hidden="true"
          />
        )}
        {NAV.map(({ href, label }) => {
          const active = isActive(href, pathname);
          return (
            <Link key={href} href={appPath(href)} className={`${styles.topLink} ${active ? styles.topLinkActive : ""}`} aria-current={active ? "page" : undefined}>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Global token search in the top bar: opens the token picker (also on "/"), and picking a token opens it on the
 * trade screen.
 */
function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button type="button" className={styles.search} onClick={() => setOpen(true)}>
        <span>Search tokens, stocks or paste an address</span>
        <kbd>/</kbd>
      </button>
      <TokenPicker open={open} onClose={() => setOpen(false)} onPick={(token) => router.push(`${appPath()}?token=${token.address}`)} />
    </>
  );
}

/** What the wallet has been paid back so far (verified), linking to the stock bag. Hidden until there is any. */
function PaidBack() {
  const bag = useBag();
  if (!bag.verified || bag.verified.totals.trades === 0) return null;
  return (
    <Link href={appPath("/bag")} className={styles.paid}>
      <span>Paid back</span>
      <span className="mono">${formatFixed(bag.totalUsd, bag.totalUsd < 1 ? 4 : 2)}</span>
    </Link>
  );
}

/**
 * App frame, in the landing's look: a slim top bar with the tabs (bottom tabs on phones), and the full width for
 * the screens. Providers live here so the landing never loads Privy.
 */
export function AppShell({ children }: { children: ReactNode }) {
  // Compare against the app's own paths ("/bag"), whatever prefix the host serves them under.
  const pathname = stripAppBase(usePathname());

  return (
    <AuthProvider>
      <MarketProvider>
        <BagProvider>
          <div className={styles.frame}>
            <header className={styles.top}>
              <div className={styles.topInner}>
                <Wordmark name="Veul" href={siteUrl()} />
                <TopNav pathname={pathname} />
                <GlobalSearch />
                <div className={styles.topEnd}>
                  <span className={styles.preview} title="Live prices and quotes. Swaps are simulated until real swaps go live.">
                    Preview
                  </span>
                  <PaidBack />
                  <AccountButton compact />
                </div>
              </div>
            </header>

            {/* The trade screen runs edge to edge (a terminal); the other screens keep the centred page width. */}
            <main className={pathname === "/" ? styles.mainFull : styles.main}>
              {/* Keyed by route so each screen fades up as it opens. */}
              <div key={pathname} className={styles.screen}>
                {children}
              </div>
            </main>

            <nav className={styles.tabs} aria-label="App">
              {TABS.map(({ href, label, Icon }) => {
                const active = isActive(href, pathname, true);
                return (
                  <Link key={href} href={appPath(href)} className={`${styles.tab} ${active ? styles.tabActive : ""}`} aria-current={active ? "page" : undefined}>
                    <Icon />
                    <span>{label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </BagProvider>
      </MarketProvider>
    </AuthProvider>
  );
}
