import { Button, V3Shell } from "@/components/v3/Chrome";

/** Branded 404 in the site's shared frame. */
export default function NotFound() {
  return (
    <V3Shell>
      <main style={{ minHeight: "70vh", display: "grid", placeItems: "center", textAlign: "center", padding: "160px 24px 96px" }}>
        <div style={{ display: "grid", justifyItems: "center", gap: 20 }}>
          <p style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--lav)", letterSpacing: "0.04em" }}>404</p>
          <h1 style={{ margin: 0, fontWeight: 600, fontSize: "clamp(40px, 6vw, 72px)", lineHeight: 1, letterSpacing: "-0.05em" }}>Nothing to swap here.</h1>
          <p style={{ margin: "0 0 12px", color: "var(--muted)" }}>This page does not exist. Check the link, or head back.</p>
          <Button href="/">Back to Veul</Button>
        </div>
      </main>
    </V3Shell>
  );
}
