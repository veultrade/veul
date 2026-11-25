import { Section, SectionLede, SectionTitle } from "./Section";
import styles from "./Compare.module.css";

// Fee rates as published in third-party guides (Nov 2026); each app shows its exact fee before you trade.
const apps = [
  { name: "GMGN", fee: "1%", back: "Nothing", weekly: "$0" },
  { name: "Banana Gun", fee: "0.5 to 1%", back: "Nothing", weekly: "$0" },
  { name: "Fomo", fee: "0.5%", back: "Nothing", weekly: "$0" },
  { name: "Stockup", fee: "0.5%", back: "0.25% as stock", weekly: "$2.50 in NVDA", ours: true },
];

/** Side-by-side fees: the clearest way to say what Stockup changes. */
export function Compare() {
  return (
    <Section tone="mist" id="compare">
      <div className={styles.head}>
        <SectionTitle>
          Same trade. <em>Different leftovers.</em>
        </SectionTitle>
        <SectionLede>Every trading app charges a fee. Stockup is the one that hands half of it back, as a stock you keep.</SectionLede>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">App</th>
              <th scope="col">Fee per trade</th>
              <th scope="col">Comes back to you</th>
              <th scope="col">On $1,000 of trades a week</th>
            </tr>
          </thead>
          <tbody>
            {apps.map((app) => (
              <tr key={app.name} className={app.ours ? styles.ours : undefined}>
                <th scope="row">{app.name}</th>
                <td className="mono">{app.fee}</td>
                <td>{app.back}</td>
                <td className="mono">{app.weekly}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.note}>Other apps&apos; fees from public guides, November 2026; check each app before trading. Stockup row: 0.25% of $1,000 = $2.50, paid as the stock you pick.</p>
    </Section>
  );
}
