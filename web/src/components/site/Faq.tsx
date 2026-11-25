import { Section, SectionTitle } from "./Section";
import styles from "./Faq.module.css";

const faqs = [
  { q: "Is Stockup a broker or an exchange?", a: "No. Stockup is an interface for Uniswap pools on Robinhood Chain. Your tokens stay in your wallet, and you sign every swap yourself." },
  { q: "Where does the payback come from?", a: "From the fee. Each swap pays 0.5%; half of that, 0.25% of the trade, is recorded for you and paid back every week." },
  { q: "Which stocks can I be paid back in?", a: "NVDA, SPY, TSLA and GOOGL at launch. You pick one, and you can change it at any time for your next trades." },
  { q: "When and how do I claim?", a: "Every Monday. The claim pays your payback in USDG and swaps it into your stock in one transaction you sign, so the stock lands in your own wallet." },
  { q: "Can I use Stockup from the US?", a: "No. Stock tokens are not available to US persons, and Stockup blocks the US and other restricted regions." },
  { q: "What are the risks?", a: "Memecoins can go to zero. Stock tokens follow their stocks, so they fall as well as rise, and their issuer can pause them. Nothing on Stockup is financial advice." },
  { q: "Is there a Stockup token?", a: "No. The product comes first. If a token ever comes, it will be announced here and on our X account, never in a DM." },
];

/** Plain question and answer list, using native disclosure for keyboard and screen reader support. */
export function Faq() {
  return (
    <Section tone="light" id="faq">
      <div className={styles.layout}>
        <SectionTitle>
          Questions, <em>answered</em>
        </SectionTitle>
        <div className={styles.list}>
          {faqs.map((item) => (
            <details key={item.q} className={styles.item}>
              <summary>
                {item.q}
                <span className={styles.icon} aria-hidden="true" />
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}
