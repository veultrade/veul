import Link from "next/link";
import { Wordmark } from "./Wordmark";
import styles from "./SiteHeader.module.css";

/** Thin, quiet top bar, like Glow's: wordmark, three links, one lavender action. */
export function SiteHeader() {
  return (
    <header className={styles.nav}>
      <Wordmark />
      <nav className={styles.links} aria-label="Main">
        <Link href="/#product">Swap</Link>
        <Link href="/#stocks">Stocks</Link>
        <Link href="/#how">How it works</Link>
        <Link href="/#faq">FAQ</Link>
      </nav>
      <Link className="btn btn-main btn-sm" href="/app">
        Go to app
      </Link>
    </header>
  );
}
