import Image from "next/image";
import { Section, SectionLede, SectionTitle } from "./Section";
import styles from "./StockCards.module.css";

// Snapshot prices from 20 Nov 2026 (GeckoTerminal); the app will show live prices.
const stocks = [
  { ticker: "NVDA", name: "NVIDIA", price: "$143.32", note: "The chips behind most AI models.", logo: "/logos/nvidia.svg" },
  { ticker: "SPY", name: "S&P 500 ETF", price: "$715.38", note: "Five hundred US companies in one.", logo: null },
  { ticker: "TSLA", name: "Tesla", price: "$370.06", note: "Cars, batteries and robots.", logo: null },
  { ticker: "GOOGL", name: "Alphabet", price: "$271.17", note: "Search, YouTube and Gemini.", logo: "/logos/google.svg" },
];

/** Glow's light "vaults" cards, one per stock you can be paid back in. */
export function StockCards() {
  return (
    <Section tone="mist" id="stocks">
      <SectionTitle center>
        Pick what your fees <em>become</em>
      </SectionTitle>
      <SectionLede center>Four Robinhood stock tokens at launch. Change your pick any time; it applies to your next trades.</SectionLede>
      <div className={styles.grid}>
        {stocks.map((s) => (
          <article key={s.ticker} className={styles.card}>
            <h3>{s.ticker}</h3>
            <div className={styles.art} aria-hidden="true">
              {s.logo ? <Image src={s.logo} alt="" width={64} height={64} style={{ width: 64, height: "auto" }} /> : <span className={styles.ticker}>{s.ticker}</span>}
            </div>
            <div className={styles.meta}>
              <span>{s.name}</span>
              <span className="mono">{s.price}</span>
            </div>
            <p>{s.note}</p>
          </article>
        ))}
      </div>
      <p className={styles.note}>Prices from 20 Nov 2026, for illustration. Stock tokens are issued by Robinhood and follow their stocks, up and down.</p>
    </Section>
  );
}
