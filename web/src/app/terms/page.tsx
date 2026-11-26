import type { Metadata } from "next";
import { LegalPage } from "@/components/site/LegalPage";

export const metadata: Metadata = { title: "Terms · Veul" };

// Draft for legal review (launch plan L4, 2026-11-26). Items in [brackets] are open decisions, not final text.
export default function TermsPage() {
  return (
    <LegalPage title="Terms of use" updated="26 November 2026">
      <h2>What Veul is</h2>
      <p>
        Veul is an interface for swapping tokens on Robinhood Chain through Uniswap pools. You sign every transaction in your own wallet. Veul never holds your
        funds or your keys, and cannot move your tokens.
      </p>

      <h2>Who can use it</h2>
      <ul>
        <li>You must be at least 18 years old and able to enter into these terms.</li>
        <li>
          Veul is not offered to people in the United States, or in Cuba, Iran, North Korea, Syria, or the Crimea, Donetsk and Luhansk regions of Ukraine, nor to
          anyone on a sanctions list. Access from those places is blocked; using a VPN or other means to get around the block is not allowed.
        </li>
        <li>You are responsible for making sure that using Veul, and holding the tokens you trade or receive, is allowed where you live.</li>
      </ul>

      <h2>Fees</h2>
      <p>Each swap carries a 0.5% fee in ETH, shown before you sign and paid in the same transaction. Uniswap pool fees and network gas are separate and go to others.</p>

      <h2>Paybacks</h2>
      <ul>
        <li>For each swap made through Veul and verified on Robinhood Chain, half of the fee (0.25% of the trade) is recorded as a payback owed to you, in USDG.</li>
        <li>The USD value of a trade uses the 30-minute average ETH price of the main ETH/USDG pool at the time of the trade. One trade earns at most 25 USDG.</li>
        <li>
          Paybacks are added to the claims contract once a day. You claim them yourself, as USDG or swapped into the stock token you pick, in a transaction you
          sign. A claim into a stock token needs at least 1 USDG.
        </li>
        <li>
          To keep funds safe, the claims contract pays out at most a set amount per day across all users. On a busy day a claim may be paid in part, and the
          rest opens as the daily limit refills.
        </li>
        <li>
          Paybacks are a loyalty reward on your own trading fees. They are not interest, not a share of profits and not an investment. We may change the rate
          or end the program for future trades; paybacks already earned stay claimable. [How long unclaimed paybacks stay claimable: to decide.]
        </li>
        <li>We may refuse or reverse paybacks earned through abuse, such as wash trading, trading with yourself, or exploiting a bug.</li>
      </ul>

      <h2>Stock tokens</h2>
      <p>
        Stock tokens on Robinhood Chain are issued by Robinhood, not by Veul. They track the price of a share but may not give you the rights of a shareholder.
        Their issuer can pause them, restrict wallets or change their terms. Read the issuer&apos;s terms before you hold them.
      </p>

      <h2>Risk</h2>
      <ul>
        <li>Tokens on Robinhood Chain, memecoins above all, can lose all their value quickly. Stock tokens go down as well as up.</li>
        <li>Swaps can fill at a worse price than quoted, up to the slippage you allow. Pools can be thin, and some tokens charge taxes or cannot be sold.</li>
        <li>Veul relies on smart contracts (Uniswap&apos;s and our own), on Robinhood Chain and on outside data providers. Any of them can fail or be attacked.</li>
        <li>The risk check, prices and charts are information, not a recommendation. Nothing on Veul is financial, tax or legal advice.</li>
      </ul>

      <h2>Your responsibilities</h2>
      <p>You are responsible for your wallet and its keys, for checking every transaction before you sign it, and for any taxes on your trades and paybacks.</p>

      <h2>Not allowed</h2>
      <p>Using Veul to break sanctions or other laws, to manipulate prices, to launder money, or to attack or overload the service (including its API).</p>

      <h2>Third parties</h2>
      <p>
        Login is handled by Privy, swaps run on Uniswap, and prices come from onchain pools and data providers such as GeckoTerminal, DexScreener and GMGN. Their
        own terms apply. Company and token names and logos belong to their owners and are shown only to identify the tokens; their use does not mean any
        endorsement of Veul.
      </p>

      <h2>No warranty and limits of liability</h2>
      <p>
        Veul is provided as is, without warranties of any kind. To the extent the law allows, we are not liable for losses from trading, from token or contract
        failures, from third-party services or from interruptions of the service.
      </p>

      <h2>Changes and contact</h2>
      <p>
        We may update these terms; material changes are announced on the site before they apply. [Operator, governing law and contact address: to decide before
        launch.]
      </p>
    </LegalPage>
  );
}
