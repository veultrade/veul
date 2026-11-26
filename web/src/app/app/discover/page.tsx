import { redirect } from "next/navigation";
import { appPath } from "@/lib/urls";

// Discover became Markets, the app's home (2026-11-25); old links land there.
export default function DiscoverPage() {
  redirect(appPath("/"));
}
