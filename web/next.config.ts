import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Same value as src/lib/urls.ts (kept here because next.config cannot import from src at build time).
const isDev = process.env.NODE_ENV === "development";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.veul.trade";
// Matches app.veul.trade and app.localhost (any "app." host).
const APP_HOST = "app\\..+";

const nextConfig: NextConfig = {
  // Hosts. The app has its own host (app.veul.trade): its paths map onto the /app
  // routes, so app.veul.trade/bag serves /app/bag. The site's old /app paths move there, and www goes to the apex.
  async redirects() {
    return [
      { source: "/:path*", has: [{ type: "host", value: "www.veul.trade" }], destination: "https://veul.trade/:path*", permanent: true },
      // In development the app stays at localhost:3031/app (Privy's embedded wallet refuses app.localhost).
      ...(isDev
        ? []
        : [
            { source: "/app", missing: [{ type: "host" as const, value: APP_HOST }], destination: `${APP_URL}/`, permanent: false },
            { source: "/app/:path*", missing: [{ type: "host" as const, value: APP_HOST }], destination: `${APP_URL}/:path*`, permanent: false },
          ]),
    ];
  },
  // No page may be shown inside another site's frame (2026-11-26 review: clickjacking of wallet confirmations).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
  async rewrites() {
    return {
      // Before the filesystem, so the app host's "/" is the swap screen and not the landing. API routes, Next's own
      // files, the /app routes themselves and public files (anything with a dot) pass through unchanged.
      beforeFiles: [
        { source: "/", has: [{ type: "host", value: APP_HOST }], destination: "/app" },
        { source: "/:path((?!api/|_next/|app/|app$)[^.]*)", has: [{ type: "host", value: APP_HOST }], destination: "/app/:path" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  // cacheComponents and partialPrefetching (create-next-app defaults) are off: on Cloudflare Workers
  // through OpenNext every page hung with "promise created by a request that has since ended".
  turbopack: {
    rules: {
      // Tailwind only processes the global stylesheet. A "*.css" rule here turned every
      // *.module.css into plain global CSS, so component class names came out empty.
      "globals.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

// Gives `next dev` the Worker bindings and the secrets in .dev.vars (read through getCloudflareContext).
initOpenNextCloudflareForDev();
