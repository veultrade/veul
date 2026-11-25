"use client";

import { useState } from "react";
import { useAuth } from "./AuthProvider";
import styles from "./AccountButton.module.css";

/**
 * Login / account control. With Privy configured it opens Privy's modal (email, Google, wallet).
 * Without an App ID it says so instead of pretending to log in.
 */
export function AccountButton({ compact = false }: { compact?: boolean }) {
  const auth = useAuth();
  const [hint, setHint] = useState(false);

  if (!auth.configured) {
    return (
      <div className={styles.wrap}>
        <button type="button" className={`btn btn-quiet btn-sm ${styles.button}`} onClick={() => setHint((v) => !v)} aria-expanded={hint}>
          Log in
        </button>
        {hint && (
          <p className={styles.hint} role="status">
            Login is not switched on in this preview yet. Swaps here use sample data.
          </p>
        )}
      </div>
    );
  }

  if (!auth.ready) {
    return <span className={`btn btn-quiet btn-sm ${styles.button}`} aria-busy="true">…</span>;
  }

  if (!auth.authenticated) {
    return (
      <button type="button" className={`btn btn-main btn-sm ${styles.button}`} onClick={auth.login}>
        Log in
      </button>
    );
  }

  return (
    <div className={styles.account}>
      {!compact && <span className={styles.dot} aria-hidden="true" />}
      <span className={`mono ${styles.label}`} title={auth.address ?? undefined}>
        {auth.label}
      </span>
      <button type="button" className={styles.logout} onClick={auth.logout}>
        Log out
      </button>
    </div>
  );
}
