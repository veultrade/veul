import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { serverEnv } from "./env";
import { json } from "./http";

/**
 * Where Veul is not offered (launch plan L3, 2026-11-26): the US, and places under comprehensive sanctions.
 * The country (and for Ukraine the region) comes from Cloudflare's view of the visitor's IP. A VPN gets around it;
 * the block shows intent, and the Terms say the rest. Locally there is no Cloudflare data, so nothing is blocked.
 */
const BLOCKED_COUNTRIES = new Set(["US", "CU", "IR", "KP", "SY"]);
// Crimea (UA-43), Sevastopol (UA-40), Donetsk (UA-14) and Luhansk (UA-09) oblasts.
const BLOCKED_UA_REGIONS = new Set(["43", "40", "14", "09"]);

export type GeoCheck = { blocked: boolean; country: string | null };

/**
 * `headerCountry`: the cf-ipcountry header, for callers that have headers but no Cloudflare context.
 * `testCountry`: development only (the x-veul-geo-test header), to see the block without a VPN; ignored in production.
 */
export async function geoCheck(headerCountry?: string | null, testCountry?: string | null): Promise<GeoCheck> {
  // The switch (wrangler.jsonc GEO_BLOCK): "off" during Preview, when only the team wallet can trade for real.
  // It must be "on" before real swaps open to the public (launch plan L6).
  if ((await serverEnv()).GEO_BLOCK === "off") return { blocked: false, country: null };
  if (process.env.NODE_ENV === "development" && testCountry) {
    const [country, region = null] = testCountry.toUpperCase().split("-");
    return { blocked: isBlocked(country, region), country };
  }
  let country: string | null = null;
  let region: string | null = null;
  try {
    const { cf } = await getCloudflareContext({ async: true });
    country = typeof cf?.country === "string" ? cf.country : null;
    region = typeof cf?.regionCode === "string" ? cf.regionCode : null;
  } catch {
    // Not running on Cloudflare (next dev): no location data.
  }
  country ??= headerCountry ?? null;
  return { blocked: isBlocked(country, region), country };
}

function isBlocked(country: string | null, region: string | null): boolean {
  return Boolean(country && (BLOCKED_COUNTRIES.has(country) || (country === "UA" && region !== null && BLOCKED_UA_REGIONS.has(region))));
}

/** For API routes that build or send transactions: a 451 response when the visitor's location is blocked. */
export async function geoBlocked(request: Request): Promise<Response | null> {
  const { blocked } = await geoCheck(request.headers.get("cf-ipcountry"), request.headers.get("x-veul-geo-test"));
  return blocked ? json({ error: "Veul is not available in your region." }, 0, 451) : null;
}
