import { redirect } from "next/navigation";
import { appPath } from "@/lib/urls";

// The ledger became Activity, "Yours" tab (2026-11-25); old links land there.
export default function LedgerPage() {
  redirect(appPath("/activity"));
}
