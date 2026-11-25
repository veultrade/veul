import Link from "next/link";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { LightWell } from "@/components/site/LightWell";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main style={{ position: "relative", minHeight: "80vh", display: "grid", placeItems: "center", textAlign: "center", overflow: "hidden", padding: "200px 24px 120px" }}>
        <LightWell size="sm" />
        <div style={{ position: "relative", marginTop: 80 }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "clamp(40px, 6vw, 72px)", margin: "0 0 16px" }}>Nothing to stock up on here.</h1>
          <p style={{ color: "var(--muted)", margin: "0 0 32px" }}>This page does not exist. Check the link, or head back.</p>
          <Link className="btn btn-main" href="/">
            Back to Stockup
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
