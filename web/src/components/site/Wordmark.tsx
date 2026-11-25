import Link from "next/link";
import styles from "./Wordmark.module.css";

/**
 * The V mark (user-designed, assets/brand/veul-mark.svg) next to the product name.
 * The viewBox is cropped to the mark's own bounds so it lines up with the text; it fills with currentColor.
 * The name defaults to Veul.
 */
export function Wordmark({ size = "md", href = "/", name = "Veul" }: { size?: "sm" | "md"; href?: string; name?: string }) {
  return (
    <Link href={href} className={`${styles.brand} ${size === "sm" ? styles.sm : ""}`}>
      <svg className={styles.mark} viewBox="130 264 741 500" aria-hidden="true" focusable="false">
        <path d="M376.5 264L510 514H737L603 764H357L473.5 546.5H281.5L130.5 264H376.5ZM870.5 264L803.5 389H557.5L624.5 264H870.5Z" />
      </svg>
      {name}
    </Link>
  );
}
