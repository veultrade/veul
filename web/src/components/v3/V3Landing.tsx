import Link from "next/link";
import { Wordmark } from "@/components/site/Wordmark";
import { DotField } from "./DotField";
import { EarnTabs } from "./EarnTabs";
import { Estimate } from "./Estimate";
import { Halftone } from "./Halftone";
import { MEDIA } from "./media";
import { Steps } from "./Steps";
import styles from "./V3Landing.module.css";

/**
 * Landing v3, after datavendor.ai (approved 2026-11-25): black ground, Geist, amber accent,
 * every visual a halftone of a grayscale render. Lives at /v3; the main landing at / is untouched.
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

// Footer link columns, laid out like the reference's (four even columns, title then links).
const FOOTER_COLUMNS = [
  { title: "Product", links: [{ href: "/app", label: "Swap" }, { href: "/app/bag", label: "Stock bag" }, { href: "/app/ledger", label: "Ledger" }, { href: "/app/rewards", label: "Rewards" }] },
  { title: "Learn", links: [{ href: "#how", label: "How it works" }, { href: "#stocks", label: "Stocks" }, { href: "#estimate", label: "Estimate" }, { href: "#faq", label: "FAQ" }] },
  { title: "Legal", links: [{ href: "/terms", label: "Terms of use" }, { href: "/privacy", label: "Privacy" }] },
  { title: "Get started", links: [{ href: "/app", label: "Go to app" }, { href: "/app/discover", label: "Discover tokens" }] },
];

function Arrow() {
  return (
    <svg className={styles.arrow} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Button({ href, children, tone = "light" }: { href: string; children: React.ReactNode; tone?: "light" | "dark" }) {
  return (
    <Link href={href} className={`${styles.button} ${tone === "light" ? styles.buttonLight : styles.buttonDark}`}>
      {children}
      <Arrow />
    </Link>
  );
}

export function V3Landing() {
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Wordmark name="Veul" href="/" />
          <nav className={styles.nav} aria-label="Main">
            <a href="#how">How it works</a>
            <a href="#stocks">Stocks</a>
            <a href="#estimate">Estimate</a>
            <a href="#faq">FAQ</a>
          </nav>
          <Link href="/app" className={`${styles.button} ${styles.buttonLight} ${styles.headerButton}`}>
            Go to app
          </Link>
        </div>
      </header>

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
              <Button href="/app">Go to app</Button>
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
                <Button href="/app">Start swapping</Button>
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
                <Button href="/app/bag" tone="dark">
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
              <Button href="/app" tone="dark">
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
              <Button href="/app">Go to app</Button>
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
            Memecoins can lose all of their value. Stock tokens are issued by Robinhood, not by Veul, and follow their stocks up and down. Veul is not available to
            US persons. Paybacks shown on this page are samples until launch. Nothing here is financial advice.
          </p>
        </div>
        <div className={styles.footerMedia}>
          <Halftone src={MEDIA.dunes} cell={10} maxDot={1} floor={0.03} gamma={0.6} interactive className={styles.footerDots} />
        </div>
      </footer>
    </div>
  );
}
