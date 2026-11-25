import styles from "./LightWell.module.css";

/**
 * The signature of the Glow look: a glowing lavender panel seen from below, with its light falling onto the page.
 * Pure CSS, decorative only.
 */
export function LightWell({ size = "lg" }: { size?: "lg" | "sm" }) {
  return (
    <div className={`${styles.root} ${size === "sm" ? styles.sm : ""}`} aria-hidden="true">
      <div className={styles.well} />
      <div className={styles.beam} />
    </div>
  );
}
