import Link from "next/link";
import { AgentIcon, GiftIcon, LedgerIcon } from "./icons";
import screens from "./Screens.module.css";
import styles from "./Features.module.css";

const ITEMS = [
  { href: "/app/ledger", label: "Ledger", note: "Every fee and payback, line by line", Icon: LedgerIcon },
  { href: "/app/rewards", label: "Rewards", note: "Invite friends, earn stock from their trades", Icon: GiftIcon },
  { href: "/app/agents", label: "Agents", note: "Let an AI agent trade for you", Icon: AgentIcon },
];

/** Phone-only menu for the pages that do not fit in the bottom tabs. */
export function MoreScreen() {
  return (
    <div className={screens.page}>
      <header className={screens.title}>
        <h1>More</h1>
      </header>
      <ul className={styles.moreList}>
        {ITEMS.map(({ href, label, note, Icon }) => (
          <li key={href}>
            <Link href={href}>
              <Icon />
              <span>
                {label}
                <small>{note}</small>
              </span>
            </Link>
          </li>
        ))}
        <li>
          <Link href="/">
            <span>
              Stockup home
              <small>Back to the website</small>
            </span>
          </Link>
        </li>
      </ul>
    </div>
  );
}
