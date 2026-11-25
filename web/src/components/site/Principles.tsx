import Link from "next/link";
import { Section, SectionTitle } from "./Section";
import styles from "./Principles.module.css";

const rows = [
  {
    title: "You sign every transaction",
    text: "Stockup never holds your money. Each swap goes from your wallet straight into a Uniswap pool, and you see the price and the fee before you sign.",
    action: { href: "/terms", label: "Read the terms" },
  },
  {
    title: "Every payout in public",
    text: "Each week's paybacks are listed with their transactions, so anyone can check that the half of the fee we promised really went back to traders.",
  },
  {
    title: "Real stocks in your wallet",
    text: "Paybacks become Robinhood stock tokens that follow NVDA, SPY, TSLA or GOOGL. They are yours to hold, trade or send. Their issuer can pause them, as with any stock token.",
  },
];

/** Glow's white numbered trio ("01 Audited smart contracts"), for how Stockup earns trust. */
export function Principles() {
  return (
    <Section tone="light" id="trust">
      <SectionTitle>
        Built to be <em>checked</em>, not trusted
      </SectionTitle>
      <ol className={styles.list}>
        {rows.map((row, i) => (
          <li key={row.title} className={styles.row}>
            <span className={styles.num}>{String(i + 1).padStart(2, "0")}</span>
            <div className={styles.body}>
              <h3>{row.title}</h3>
              <p>{row.text}</p>
              {row.action && (
                <Link className={styles.action} href={row.action.href}>
                  {row.action.label}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
