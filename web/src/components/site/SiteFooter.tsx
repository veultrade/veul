import Link from "next/link";
import { Wordmark } from "./Wordmark";
import styles from "./SiteFooter.module.css";

const columns = [
  {
    title: "Product",
    links: [
      { href: "/#product", label: "Swap" },
      { href: "/#stocks", label: "Pick a stock" },
      { href: "/#how", label: "How it works" },
      { href: "/#compare", label: "Fees compared" },
    ],
  },
  {
    title: "Help",
    links: [
      { href: "/#faq", label: "FAQ" },
      { href: "/#trust", label: "How we earn trust" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/terms", label: "Terms of use" },
      { href: "/privacy", label: "Privacy" },
    ],
  },
];

// Numbered notes, as on Glow's footer: the fine print, in plain words.
const notes = [
  "Memecoins and other tokens on Robinhood Chain can lose all of their value. Only trade what you can afford to lose.",
  "Stock tokens are issued by Robinhood, not by Stockup. They follow their stocks up and down, and their issuer can pause them or restrict wallets.",
  "Paybacks are 0.25% of each swap made through Stockup, recorded in USDG and claimed weekly as the stock token you pick.",
  "Stockup is not available to US persons or in regions where stock tokens or this service are restricted.",
  "Figures on this page, including the swap preview and the stock bag, are samples until launch. Market figures name their source.",
  "Other apps' fees come from public guides as of November 2026. Check each app before you trade.",
  "Nothing on Stockup is financial, investment or tax advice.",
];

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.wrap}>
        <div className={styles.top}>
          <div className={styles.brand}>
            <Wordmark />
            <p>Trade memes on Robinhood Chain. Get paid back in stocks.</p>
            <Link className="btn btn-main" href="/app">
              Go to app
            </Link>
          </div>
          <nav className={styles.columns} aria-label="Footer">
            {columns.map((col) => (
              <div key={col.title}>
                <h2>{col.title}</h2>
                <ul>
                  {col.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href}>{link.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <ol className={styles.notes}>
          {notes.map((note, i) => (
            <li key={i}>
              <b>{i + 1}.</b> {note}
            </li>
          ))}
        </ol>

        <div className={styles.bottom}>
          <span>© 2026 Stockup. Not a live product yet.</span>
          <span className={styles.bottomLinks}>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
          </span>
        </div>
      </div>
      {/* A large, faded wordmark closes the page, cut off by the bottom edge. */}
      <p className={styles.giant} aria-hidden="true">
        Stockup
      </p>
    </footer>
  );
}
