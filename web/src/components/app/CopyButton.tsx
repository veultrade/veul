"use client";

import { useState } from "react";

/** Copies a value and confirms for two seconds. Clipboard can be blocked; then it says so. */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("done");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  };
  return (
    <button type="button" className="btn btn-quiet btn-sm" onClick={copy} disabled={!value}>
      {state === "done" ? "Copied" : state === "failed" ? "Copy blocked" : label}
    </button>
  );
}
