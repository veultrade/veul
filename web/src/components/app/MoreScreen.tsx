import Link from "next/link";
import { appPath, siteUrl } from "@/lib/urls";
import calm from "./Calm.module.css";

const ITEMS = [
  { href: appPath("/rewards"), label: "Rewards", note: "Invite friends, earn stock from their trades" },
  { href: appPath("/agents"), label: "Agents", note: "Let an AI agent trade for you" },
  { href: appPath("/wallet"), label: "Wallet", note: "Your balances on Robinhood Chain" },
  { href: siteUrl(), label: "Veul home", note: "Back to the website" },
];

/** Phone menu for the pages that do not fit in the top bar. */
export function MoreScreen() {
  return (
    <div className={calm.col}>
      <h1 className={calm.title}>More</h1>
      <ul className={calm.list}>
        {ITEMS.map(({ href, label, note }) => (
          <li key={href}>
            <Link href={href} className={calm.row}>
              <span className={calm.name}>
                <strong>{label}</strong>
                <small>{note}</small>
              </span>
              <span className={calm.muted} aria-hidden="true">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
