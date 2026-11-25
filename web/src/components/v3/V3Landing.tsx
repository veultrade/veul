import { appUrl } from "@/lib/urls";
import { Button, V3Shell } from "./Chrome";
import { DotField } from "./DotField";
import { EarnTabs } from "./EarnTabs";
import { Estimate } from "./Estimate";
import { Halftone } from "./Halftone";
import { MEDIA } from "./media";
import { Steps } from "./Steps";
import styles from "./V3Landing.module.css";

/**
 * The landing (v3, after datavendor.ai, 2026-11-25): black ground, Geist, blue accent from the logo,
 * every visual a halftone of a grayscale render. Header and footer come from Chrome.tsx.
 */

const TICKERS = ["NVDA", "TSLA", "SPY", "GOOGL", "AAPL", "MSFT", "AMZN", "META"];

const FAQS = [
  { q: "Is Veul a broker or an exchange?", a: "No. Veul is an interface for Uniswap pools on Robinhood Chain. Your tokens stay in your wallet, and you sign every swap yourself." },
  { q: "Where does the payback come from?", a: "From the fee. Each swap pays 0.5%; half of that, 0.25% of the trade, is recorded for you and paid back every week." },
  { q: "Which stocks can I be paid back in?", a: "NVDA, SPY, TSLA and GOOGL at launch. You pick one, and you can change it at any time for your next trades." },
  { q: "When and how do I claim?", a: "Every Monday. The claim pays your payback in USDG and swaps it into your stock in one transaction you sign, so the stock lands in your own wallet." },
  { q: "Can I use Veul from the US?", a: "No. Stock tokens are not available to US persons, and Veul blocks the US and other restricted regions." },
  { q: "What are the risks?", a: "Memecoins can go to zero. Stock tokens follow their stocks, so they fall as well as rise, and their issuer can pause them. Nothing on Veul is financial advice." },
  { q: "Is there a Veul token?", a: "No. The product comes first. If a token ever comes, it will be announced here and on our X account, never in a DM." },
];

export function V3Landing() {
  return (
    <V3Shell>
      <main>
        {/* Hero: the halftone fills the screen; type sits on a soft dark wash so it stays readable. */}
        <section className={styles.hero}>
          <Halftone src={MEDIA.hero} cell={10} maxDot={0.9} floor={0.1} gamma={1.9} interactive className={styles.heroMedia} />
          <div className={styles.heroWash} aria-hidden="true" />
          <div className={styles.heroCopy}>
            <h1 className={styles.heroTitle}>
              Get paid back
              <br />
              in stocks
            </h1>
            <p className={styles.heroLead}>
              Veul swaps any token on <strong>Robinhood Chain</strong> through Uniswap. <strong>0.25% of every trade</strong> comes back to you as
              <strong> NVDA, SPY</strong> or the stock you pick.
            </p>
            <div className={styles.heroActions}>
              <Button href={appUrl()}>Go to app</Button>
              <Button href="#how" tone="dark">
                See how it works
              </Button>
            </div>
          </div>
        </section>

        <div className={styles.container}>
          <section className={styles.statement}>
            <p className={styles.statementText}>
              Every swap pays a fee. <span className={styles.bright}>Usually it&apos;s gone.</span> On Veul, part of it{" "}
              <span className={styles.squiggle}>comes back</span> as <span className={styles.bright}>stock you own.</span>
            </p>
            <DotField labels={TICKERS} />
          </section>

          <section className={styles.split}>
            <div className={styles.splitCopy}>
              <h2 className={styles.splitTitle}>Veul is the swap that pays you back.</h2>
              <div className={styles.actions}>
                <Button href={appUrl()}>Start swapping</Button>
                <Button href="#stocks" tone="dark">
                  See the stocks
                </Button>
              </div>
            </div>
            <div className={styles.splitMedia}>
              <Halftone src={MEDIA.flow} cell={10} interactive />
            </div>
          </section>

          <section className={styles.block} id="stocks">
            <div className={styles.blockHead}>
              <h2 className={styles.blockTitle}>What you get back</h2>
              <div className={styles.blockAside}>
                <p>Real stock tokens on Robinhood Chain, priced onchain. Pick the one you want to own.</p>
                <Button href={appUrl("/bag")} tone="dark">
                  Open your stock bag
                </Button>
              </div>
            </div>
            <EarnTabs />
          </section>

          <section className={styles.block} id="estimate">
            <div className={styles.blockHead}>
              <h2 className={styles.blockTitle}>Estimate</h2>
              <div className={styles.blockAside}>
                <p>How much could come back? Set your monthly trading volume.</p>
              </div>
            </div>
            <Estimate />
          </section>

          <section className={styles.block} id="how">
            <div className={styles.stepsHead}>
              <h2 className={styles.blockTitle}>How it works</h2>
              <Button href={appUrl()} tone="dark">
                Start swapping
              </Button>
            </div>
            <Steps media={{ swap: MEDIA.swap, earn: MEDIA.dollar, collect: MEDIA.stack }} />
          </section>

          <section className={styles.closing}>
            <h2 className={styles.closingTitle}>
              Trade memes.
              <br />
              Keep the stocks.
            </h2>
            <div className={styles.actionsCenter}>
              <Button href={appUrl()}>Go to app</Button>
              <Button href="#faq" tone="dark">
                Read the FAQ
              </Button>
            </div>
          </section>

          <section className={styles.faq} id="faq">
            <h2 className={styles.faqTitle}>Questions about getting paid back</h2>
            <div className={styles.faqList}>
              {FAQS.map((item) => (
                <details key={item.q} className={styles.faqItem}>
                  <summary>
                    {item.q}
                    <svg className={styles.chevron} viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M4.5 6.5 8 10l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </section>
        </div>
      </main>
    </V3Shell>
  );
}
