import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * Default OpenNext config, no incremental-cache override.
 * The landing is fully static today; revisit when the app adds dynamic pages.
 */
export default defineCloudflareConfig();
