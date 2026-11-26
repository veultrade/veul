import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";
import { GeoBlocked } from "@/components/app/GeoBlocked";
import { geoCheck } from "@/lib/server/geo";

export const metadata: Metadata = {
  title: "Veul app · Preview",
  robots: { index: false },
};

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Blocked regions see a plain notice instead of the app (lib/server/geo.ts); the landing stays readable.
  const incoming = await headers();
  const { blocked } = await geoCheck(incoming.get("cf-ipcountry"), incoming.get("x-veul-geo-test"));
  if (blocked) return <GeoBlocked />;
  return <AppShell>{children}</AppShell>;
}
