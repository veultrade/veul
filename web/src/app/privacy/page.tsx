import type { Metadata } from "next";
import { LegalPage } from "@/components/site/LegalPage";

export const metadata: Metadata = { title: "Privacy · Stockup" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="20 November 2026">
      <h2>What we store</h2>
      <ul>
        <li>Your wallet address, and your login email if you sign in with email or Google (handled by our login provider, Privy).</li>
        <li>The swaps you make through Stockup and the paybacks they earn, so we can pay you. These are public on Robinhood Chain anyway.</li>
        <li>Your country, read from your connection, only to block regions where the service is not allowed.</li>
      </ul>
      <h2>What we do not do</h2>
      <p>We do not sell your data, we do not use ad trackers, and we never ask for your private keys or seed phrase.</p>
      <h2>Contact</h2>
      <p>Questions about your data go to the contact listed on the site once Stockup launches.</p>
    </LegalPage>
  );
}
