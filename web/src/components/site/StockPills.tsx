import Image from "next/image";
import styles from "./StockPills.module.css";

// Sample weekly totals until the ledger is live (session 1.5).
const pills = [
  { ticker: "NVDA", logo: "/logos/nvidia.svg", paid: "1.84" },
  { ticker: "GOOGL", logo: "/logos/google.svg", paid: "0.42" },
];

/** Glow's APY pills, reused as "paid back this week". */
export function StockPills() {
  return (
    <div className={styles.pills} aria-label="Stocks paid back this week, sample">
      {pills.map((p) => (
        <div key={p.ticker} className={styles.pill}>
          <span className={styles.icon}>
            <Image src={p.logo} alt="" width={15} height={15} style={{ width: 15, height: "auto" }} />
          </span>
          <b>{p.ticker}</b>
          <span className={`mono ${styles.num}`}>{p.paid}</span>
          <span className={styles.label}>paid back this week</span>
        </div>
      ))}
    </div>
  );
}
