import type { ReactNode } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/site/Wordmark";
import { Halftone } from "./Halftone";
import { MEDIA } from "./media";
import styles from "./V3Landing.module.css";
import { appUrl } from "@/lib/urls";

/**
 * The site's shared frame in the v3 look: tokens, the fixed header and the footer with the halftone dunes.
 * Used by the landing, the legal pages and the 404, so every public page looks the same.
 * Links point at "/#…" so they work from any page, not only the landing.
 */

// Footer link columns, laid out like datavendor's (four even columns, title then links).
const FOOTER_COLUMNS = [
  { title: "Product", links: [{ href: appUrl(), label: "Swap" }, { href: appUrl("/bag"), label: "Stock bag" }, { href: appUrl("/ledger"), label: "Ledger" }, { href: appUrl("/rewards"), label: "Rewards" }] },
  { title: "Learn", links: [{ href: "/#how", label: "How it works" }, { href: "/#stocks", label: "Stocks" }, { href: "/#estimate", label: "Estimate" }, { href: "/#faq", label: "FAQ" }] },
  { title: "Legal", links: [{ href: "/terms", label: "Terms of use" }, { href: "/privacy", label: "Privacy" }] },
  { title: "Get started", links: [{ href: appUrl(), label: "Go to app" }, { href: appUrl("/discover"), label: "Discover tokens" }] },
];

function Arrow() {
  return (
    <svg className={styles.arrow} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Small flat button with an arrow: light for the one action, dark for the rest. */
export function Button({ href, children, tone = "light" }: { href: string; children: ReactNode; tone?: "light" | "dark" }) {
  return (
    <Link href={href} className={`${styles.button} ${tone === "light" ? styles.buttonLight : styles.buttonDark}`}>
      {children}
      <Arrow />
    </Link>
  );
}

function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Wordmark name="Veul" href="/" />
        <nav className={styles.nav} aria-label="Main">
          <Link href="/#how">How it works</Link>
          <Link href="/#stocks">Stocks</Link>
          <Link href="/#estimate">Estimate</Link>
          <Link href="/#faq">FAQ</Link>
        </nav>
        <Link href={appUrl()} className={`${styles.button} ${styles.buttonLight} ${styles.headerButton}`}>
          Go to app
        </Link>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <nav className={styles.footerColumns} aria-label="Footer">
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title}>
              <h3>{column.title}</h3>
              <ul>
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className={styles.footerBottom}>
          <p className={styles.footerBy}>
            Built on <strong>Robinhood Chain</strong>. Swaps through <strong>Uniswap</strong>.
          </p>
          <svg className={styles.footerMark} viewBox="130 264 741 500" role="img" aria-label="Veul">
            <path d="M376.5 264L510 514H737L603 764H357L473.5 546.5H281.5L130.5 264H376.5ZM870.5 264L803.5 389H557.5L624.5 264H870.5Z" />
          </svg>
        </div>
        <p className={styles.footerNote}>
          Memecoins can lose all of their value. Stock tokens are issued by Robinhood, not by Veul, and follow their stocks up and down. Veul is not available to US
          persons. Paybacks shown on this site are samples until launch. Nothing here is financial advice.
        </p>
      </div>
      <div className={styles.footerMedia}>
        <Halftone src={MEDIA.dunes} cell={10} maxDot={1} floor={0.03} gamma={0.6} interactive className={styles.footerDots} />
      </div>
    </footer>
  );
}

/** Wraps a public page in the v3 tokens, header and footer. */
export function V3Shell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.root}>
      <Header />
      {children}
      <Footer />
    </div>
  );
}
