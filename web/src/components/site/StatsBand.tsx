import { Section } from "./Section";
import styles from "./StatsBand.module.css";

// Market facts, not Stockup numbers: Stockup is not live yet. Sources in the footnote.
const stats = [
  { value: "$110M", label: "Stock tokens traded per day on Robinhood Chain" },
  { value: "$1.7M", label: "Fees paid to trading apps on the chain in 30 days" },
  { value: "0.25%", label: "Of every Stockup swap comes back to you as stock" },
];

/** Glow's light stats band: three big numbers with hairline dividers. */
export function StatsBand() {
  return (
    <Section tone="mist" className={styles.band}>
      <dl className={styles.stats}>
        {stats.map((s) => (
          <div key={s.value} className={styles.stat}>
            <dt>{s.label}</dt>
            <dd>{s.value}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.note}>Daily stock token volume: GeckoTerminal, top 100 pools, 20 Nov 2026. App fees: DefiLlama, GMGN, Fomo, Axiom and others, 30 days to 20 Nov 2026.</p>
    </Section>
  );
}
