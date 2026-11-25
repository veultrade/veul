import Link from "next/link";
import { SwapPreview } from "@/components/swap/SwapPreview";
import { sampleBag } from "@/lib/sample";
import { Section, SectionLede, SectionTitle } from "./Section";
import { Wordmark } from "./Wordmark";
import styles from "./ProductWindow.module.css";

/** The dark app window on a white band, like Glow's "Built for every yield strategy", but live. */
export function ProductWindow() {
  return (
    <Section tone="light" id="product">
      <div className={styles.head}>
        <SectionTitle>
          One swap. <em>Two things</em> land in your wallet.
        </SectionTitle>
        <SectionLede>The token you bought, and a slice of a real stock. Routed through Uniswap pools on Robinhood Chain, fee 0.5%, half of it back to you. Try it below; every number is a sample.</SectionLede>
      </div>
      <div className={styles.window}>
        <div className={styles.bar}>
          <Wordmark size="sm" />
          <nav aria-hidden="true" className={styles.tabs}>
            <span className={styles.tabOn}>Swap</span>
            <span>Stock bag</span>
            <span>Ledger</span>
          </nav>
          <span className={`mono ${styles.wallet}`}>0x7da1…a1c4</span>
        </div>
        <div className={styles.body}>
          <SwapPreview />
          <aside className={styles.bag} aria-label="Your stock bag, sample">
            <div className={styles.bagTop}>
              <h3>Your stock bag</h3>
              <span className={`mono ${styles.tag}`}>Sample</span>
            </div>
            <div className={styles.total}>
              $4.15<small>in stocks</small>
            </div>
            <ul className={styles.rows}>
              {sampleBag.map((row) => (
                <li key={row.id}>
                  <span>{row.label}</span>
                  <span className={`mono ${styles.gold}`}>{row.payback}</span>
                  <span className={`mono ${styles.age}`}>{row.age}</span>
                </li>
              ))}
            </ul>
            <Link className="btn btn-quiet" href="/#faq">
              Claim on Monday
            </Link>
          </aside>
        </div>
      </div>
    </Section>
  );
}
