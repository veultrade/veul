import type { Metadata } from "next";
import { LegalPage } from "@/components/site/LegalPage";

export const metadata: Metadata = { title: "Privacy · Veul" };

// Draft for legal review (launch plan L4, 2026-11-26). Items in [brackets] are open decisions, not final text.
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="26 November 2026">
      <h2>What we keep</h2>
      <ul>
        <li>Your wallet address, and your login email if you sign in with email or Google. Login is handled by Privy, which stores those details for us.</li>
        <li>The swaps you make through Veul and the paybacks they earn, so we can pay you. They are public on Robinhood Chain anyway.</li>
        <li>Simulated swaps you try in preview mode stay in your own browser.</li>
      </ul>

      <h2>What passes through but is not kept by us</h2>
      <ul>
        <li>
          Your IP address and the country it points to: our host, Cloudflare, uses them to block regions where Veul is not offered and to limit abusive traffic.
          We do not store them.
        </li>
        <li>
          Requests to the blockchain go through our node provider, Alchemy. Charts and trades are loaded by your browser straight from GeckoTerminal, which sees
          your IP address like any website you visit.
        </li>
      </ul>

      <h2>What we do not do</h2>
      <p>We do not sell your data, we do not use ad trackers or analytics cookies, and we never ask for your private keys or seed phrase.</p>

      <h2>Your choices</h2>
      <p>
        You can ask us to delete your login account (email). Swaps and paybacks recorded on Robinhood Chain cannot be deleted by anyone, because the chain is
        public and permanent.
      </p>

      <h2>Contact</h2>
      <p>[Contact address for privacy questions: to decide before launch.]</p>
    </LegalPage>
  );
}
