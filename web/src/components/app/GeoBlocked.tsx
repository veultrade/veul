import { siteUrl } from "@/lib/urls";
import styles from "./GeoBlocked.module.css";

/** Shown instead of the app to visitors from regions where Veul is not offered (lib/server/geo.ts). */
export function GeoBlocked() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1>Veul is not available in your region</h1>
        <p>Veul is not offered to people in the United States or in places under comprehensive sanctions. If you think this is a mistake, you may be using a connection that appears to be in one of those places.</p>
        <a className={styles.link} href={siteUrl()}>
          Back to veul.trade
        </a>
      </div>
    </main>
  );
}
