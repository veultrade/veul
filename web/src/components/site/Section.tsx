import type { ReactNode } from "react";
import styles from "./Section.module.css";

/**
 * Page band with one of Glow's four grounds. Each tone sets the --s-* variables
 * so headings, text and lines inside adapt without per-section overrides.
 */
export type Tone = "dark" | "night" | "light" | "mist";

export function Section({ tone, id, children, className = "" }: { tone: Tone; id?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`${styles.section} ${styles[tone]} ${className}`}>
      <div className={styles.wrap}>{children}</div>
    </section>
  );
}

/** Section heading in Clash Display; wrap the highlighted words in <em>. */
export function SectionTitle({ children, center = false }: { children: ReactNode; center?: boolean }) {
  return <h2 className={`${styles.title} ${center ? styles.center : ""}`}>{children}</h2>;
}

export function SectionLede({ children, center = false }: { children: ReactNode; center?: boolean }) {
  return <p className={`${styles.lede} ${center ? styles.center : ""}`}>{children}</p>;
}
