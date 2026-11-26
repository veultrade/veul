import type { Metadata } from "next";
import { LegalPage } from "@/components/site/LegalPage";

export const metadata: Metadata = { title: "Terms · Veul" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use" updated="20 November 2026">
      <h2>What Veul is</h2>
      <p>Veul is an interface for swapping tokens on Robinhood Chain through Uniswap pools. You sign every transaction yourself. Veul does not hold your funds.</p>
      <h2>Who can use it</h2>
      <p>Veul is not available to US persons or to residents of countries where stock tokens or this service are restricted. By using it you confirm you are allowed to.</p>
      <h2>Fees and paybacks</h2>
      <ul>
        <li>Each swap carries a 0.5% fee, shown before you sign.</li>
        <li>Half of that fee (0.25% of the trade) is recorded as a payback owed to you, in USDG.</li>
        <li>Your payback can be claimed from the day after your trade. The claim pays it as USDG or swaps it into the stock token you picked, in a transaction you sign.</li>
        <li>Stock tokens are issued by Robinhood, not by Veul. Their issuer can pause them or restrict wallets.</li>
      </ul>
      <h2>Risk</h2>
      <p>Tokens on Robinhood Chain, memecoins above all, can lose all their value. Stock tokens follow their stocks and go down as well as up. Nothing on Veul is financial advice.</p>
      <h2>Changes</h2>
      <p>These terms are a draft and will be reviewed before launch. Material changes will be announced on the site.</p>
    </LegalPage>
  );
}
