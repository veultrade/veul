/**
 * Where the site and the app live.
 * Production: the app has its own host (app.veul.trade); next.config.ts rewrites that host's paths onto the /app
 * routes, so links inside the app are short ("/bag"). Development: the app stays at localhost:3031/app, because
 * Privy's embedded wallet only runs on plain localhost (it refuses app.localhost).
 */
const isDev = process.env.NODE_ENV === "development";

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? (isDev ? "http://localhost:3031" : "https://veul.trade");
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? (isDev ? "http://localhost:3031/app" : "https://app.veul.trade");

/** Prefix of the app's paths on the host it is served from: "" on app.veul.trade, "/app" in development. */
export const APP_BASE = isDev ? "/app" : "";

/** A path inside the app, for links within the app: appPath("/bag"). */
export function appPath(path = "/") {
  if (!APP_BASE) return path;
  return path === "/" ? APP_BASE : `${APP_BASE}${path}`;
}

/** The current pathname without the app's prefix, so "/app/bag" in development reads as "/bag". */
export function stripAppBase(pathname: string) {
  if (!APP_BASE || !pathname.startsWith(APP_BASE)) return pathname;
  return pathname.slice(APP_BASE.length) || "/";
}

/** Absolute link into the app, for pages on the site: appUrl("/bag"). */
export function appUrl(path = "/") {
  return `${APP_URL}${path === "/" ? "" : path}`;
}

/** Absolute link to the site, for pages in the app: siteUrl("/terms"). */
export function siteUrl(path = "/") {
  return `${SITE_URL}${path === "/" ? "" : path}`;
}
