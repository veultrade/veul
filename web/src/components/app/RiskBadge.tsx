import type { RiskLevel } from "@/lib/risk";
import styles from "./Features.module.css";

const LABEL: Record<RiskLevel, string> = { low: "Low risk", medium: "Medium", high: "High risk" };

export function RiskBadge({ level }: { level: RiskLevel }) {
  return <span className={`mono ${styles.risk} ${styles[level]}`}>{LABEL[level]}</span>;
}
