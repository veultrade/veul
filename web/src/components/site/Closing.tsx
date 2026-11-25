import Link from "next/link";
import { LightWell } from "./LightWell";
import styles from "./Closing.module.css";

/** The closing light well, as on Glow, with the one action again. */
export function Closing() {
  return (
    <section className={styles.close} id="close">
      <LightWell size="sm" />
      <h2 className={styles.title}>Stock up on every trade.</h2>
      <Link className="btn btn-main" href="/app">
        Go to app
      </Link>
    </section>
  );
}
