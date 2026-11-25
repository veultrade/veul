import { Section, SectionLede, SectionTitle } from "./Section";
import styles from "./HowItWorks.module.css";

const stroke = { fill: "none", stroke: "#e8e8f2", strokeWidth: 1 } as const;
const tint = { fill: "#a3a4ec", fillOpacity: 0.35 } as const;

/** Line-art marks in Glow's style: one per step. */
const art = {
  swap: (
    <svg viewBox="0 0 120 120" {...stroke} aria-hidden="true">
      <rect x="20" y="20" width="80" height="80" />
      <rect x="34" y="34" width="52" height="52" />
      <rect x="48" y="48" width="24" height="24" {...tint} />
      <path d="M20 60h28M72 60h28M60 20v28M60 72v28" />
    </svg>
  ),
  fee: (
    <svg viewBox="0 0 120 120" {...stroke} aria-hidden="true">
      <path d="M38 34h56v56H38z" fill="#a3a4ec" fillOpacity={0.12} />
      <path d="M32 40h56v56H32z" />
      <path d="M26 46h56v56H26z" />
      <path d="M20 52h56v56H20z" />
    </svg>
  ),
  claim: (
    <svg viewBox="0 0 120 120" {...stroke} aria-hidden="true">
      <path d="M60 18 100 46 60 74 20 46z" {...tint} />
      <path d="M20 60l40 28 40-28" />
      <path d="M20 74l40 28 40-28" />
    </svg>
  ),
};

const steps = [
  { key: "swap", title: "Swap through Uniswap", text: "Paste a contract or pick a trending token. We route through Uniswap pools and show the price before you sign." },
  { key: "fee", title: "Half the fee comes back", text: "The fee is 0.5%. A quarter of a percent of every trade is set aside for you, recorded in a public ledger." },
  { key: "claim", title: "Claim it as stock", text: "Every Monday your payback becomes NVDA, SPY, TSLA or GOOGL, in a swap you sign yourself. Your wallet, your shares." },
] as const;

export function HowItWorks() {
  return (
    <Section tone="night" id="how">
      <div>
        <SectionTitle>
          Swap as usual. <em>Stock up</em> while you do.
        </SectionTitle>
        <SectionLede>No staking, no points, no lockups. The payback is a real Robinhood stock token in your own wallet.</SectionLede>
        <div className={styles.cards}>
          {steps.map((step) => (
            <article key={step.key} className={styles.card}>
              <i className={`${styles.tick} ${styles.tl}`} />
              <i className={`${styles.tick} ${styles.tr}`} />
              <i className={`${styles.tick} ${styles.bl}`} />
              <i className={`${styles.tick} ${styles.br}`} />
              {art[step.key]}
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>
          ))}
        </div>
      </div>
    </Section>
  );
}
