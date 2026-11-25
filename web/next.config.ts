import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
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
