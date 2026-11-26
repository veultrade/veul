// Stockup market feed: runs on the VPS every 15 minutes (cron), fetches GMGN's Robinhood Chain lists from this
// fixed IP and pushes them to the Stockup Worker, because GMGN bans Cloudflare's shared IPs.
// No dependencies (Node 22). Settings in .env next to this file: GMGN_API_KEY, FEED_TOKEN, FEED_URL.
// Request shapes must match web/src/lib/server/gmgn.ts (RANK_QUERY, TRENCHES_BODY).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("./.env", import.meta.url), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
for (const key of ["GMGN_API_KEY", "FEED_TOKEN", "FEED_URL"]) if (!env[key]) throw new Error(`${key} missing in .env`);

const RANK_QUERY = { chain: "robinhood", interval: "24h", limit: "40" };
const TRENCHES_BODY = {
  version: "v2",
  new_creation: {
    filters: ["offchain", "onchain"],
    launchpad_platform_v2: true,
    limit: 40,
    launchpad_platform: ["pool_uniswap_v3", "pool_uniswap_v4"],
    quote_address_type: [11, 20, 24, 12, 0],
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The per-IP limit is small (5 per window; rank costs 1, trenches 3), so calls are spaced out and a 429 with a
// short reset is waited out once. Longer bans are reported and left alone: retrying during a ban extends it.
async function gmgnPolite(method, path, query, body) {
  try {
    return await gmgn(method, path, query, body);
  } catch (error) {
    const waitMs = error.resetAt ? error.resetAt * 1000 - Date.now() + 2000 : -1;
    if (waitMs <= 0 || waitMs > 90_000) throw error;
    await sleep(waitMs);
    return gmgn(method, path, query, body);
  }
}

async function gmgn(method, path, query, body) {
  const params = new URLSearchParams({ ...query, timestamp: String(Math.floor(Date.now() / 1000)), client_id: randomUUID() });
  const response = await fetch(`https://openapi.gmgn.ai${path}?${params}`, {
    method,
    headers: { "X-APIKEY": env.GMGN_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json || (json.code !== undefined && json.code !== 0)) {
    // On a ban, report when it lifts and stop: retrying during a ban makes it longer.
    const reset = json?.reset_at ? ` (until ${new Date(json.reset_at * 1000).toISOString()})` : "";
    const error = new Error(`GMGN ${path} ${response.status} ${json?.message ?? ""}${reset}`);
    // GMGN can send the 429 in the JSON body with a different HTTP status.
    error.resetAt = response.status === 429 || json?.code === 429 ? json?.reset_at : undefined;
    throw error;
  }
  let data = json.data;
  while (data && typeof data === "object" && "code" in data && "data" in data) data = data.data;
  return data;
}

const started = new Date().toISOString();
try {
  const rank = await gmgnPolite("GET", "/v1/market/rank", RANK_QUERY);
  await sleep(40_000);
  const trenches = await gmgnPolite("POST", "/v1/trenches", { chain: "robinhood" }, TRENCHES_BODY);
  const payload = { rank: rank?.rank ?? [], newCreation: trenches?.new_creation ?? [], pairs: [] };
  // Uniswap routes for the trending tokens: GMGN's rank does not name the pool and DexScreener also refuses
  // Cloudflare, so the top pair per token is fetched here (30 addresses per call, about 2 calls).
  const addresses = [...new Set(payload.rank.map((t) => String(t.address).toLowerCase()))];
  for (let i = 0; i < addresses.length; i += 30) {
    const response = await fetch(`https://api.dexscreener.com/tokens/v1/robinhood/${addresses.slice(i, i + 30).join(",")}`, { headers: { Accept: "application/json" } });
    if (response.ok) payload.pairs.push(...(await response.json()));
    await sleep(1000);
  }
  const response = await fetch(env.FEED_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.FEED_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.text();
  if (!response.ok) throw new Error(`push ${response.status} ${result.slice(0, 200)}`);
  console.log(`${started} ok rank=${payload.rank.length} new=${payload.newCreation.length} pairs=${payload.pairs.length} ${result.slice(0, 120)}`);
} catch (error) {
  console.error(`${started} failed: ${error.message}`);
  process.exitCode = 1;
}

// Ledger catch-up (session 1.5): records real swaps that paid the fee but were never reported by the app.
// Independent of the feed above, so a GMGN failure does not stop it.
try {
  const response = await fetch(new URL("/api/internal/reconcile", env.FEED_URL), {
    method: "POST",
    headers: { Authorization: `Bearer ${env.FEED_TOKEN}` },
  });
  const result = await response.text();
  if (!response.ok) throw new Error(`reconcile ${response.status} ${result.slice(0, 200)}`);
  console.log(`${started} reconcile ${result.slice(0, 200)}`);
} catch (error) {
  console.error(`${started} reconcile failed: ${error.message}`);
  process.exitCode = 1;
}

// Daily claims root (VeulClaimsV2): asked in the first quarter hour of 00:00–03:00 UTC, so a failed run is retried
// within the night. Safe to repeat: the Worker posts only when the total grew, and the contract allows the poster
// one root per interval (20 h), so the later calls answer "too-soon" or "nothing-new".
const now = new Date();
if (now.getUTCHours() <= 3 && now.getUTCMinutes() < 15) {
  try {
    const response = await fetch(new URL("/api/internal/claims-epoch", env.FEED_URL), {
      method: "POST",
      headers: { Authorization: `Bearer ${env.FEED_TOKEN}` },
    });
    const result = await response.text();
    if (!response.ok) throw new Error(`claims-epoch ${response.status} ${result.slice(0, 200)}`);
    console.log(`${started} claims-epoch ${result.slice(0, 300)}`);
  } catch (error) {
    console.error(`${started} claims-epoch failed: ${error.message}`);
    process.exitCode = 1;
  }
}
