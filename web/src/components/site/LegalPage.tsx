import type { ReactNode } from "react";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import styles from "./LegalPage.module.css";

/** Reading layout for terms and privacy: one narrow column, quiet type. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className={styles.page}>
        <h1>{title}</h1>
        <p className={styles.meta}>Draft, last updated {updated}. Not yet reviewed by a lawyer; it will change before launch.</p>
        <div className={styles.body}>{children}</div>
      </main>
      <SiteFooter />
    </>
  );
}
