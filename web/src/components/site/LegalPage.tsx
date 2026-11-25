import type { ReactNode } from "react";
import { V3Shell } from "@/components/v3/Chrome";
import styles from "./LegalPage.module.css";

/** Reading layout for terms and privacy: one narrow column, quiet type, in the site's shared frame. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <V3Shell>
      <main className={styles.page}>
        <h1>{title}</h1>
        <p className={styles.meta}>Draft, last updated {updated}. Not yet reviewed by a lawyer; it will change before launch.</p>
        <div className={styles.body}>{children}</div>
      </main>
    </V3Shell>
  );
}
