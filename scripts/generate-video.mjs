// Animates the hero still with Replicate xai/grok-imagine-video (image to video, 720p is its maximum).
// Costs money every run: about $0.05 to $0.07 per second of output (8 s = roughly $0.40 to $0.56).
// Approved by the user 2026-11-20 for the portal hero. One prediction per run.
// Usage: node scripts/generate-video.mjs
// Output: assets-src/hero-portal-raw.mp4. The shipped loop is built from it with ffmpeg (see docs/tasks.md).
// Token: see scripts/lib/replicate-token.mjs; never printed.
import fs from "fs";
import { replicateToken } from "./lib/replicate-token.mjs";
import path from "path";
import { fileURLToPath } from "url";

const projectDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const still = path.join(projectDir, "web", "public", "hero", "hero-portal-hq.jpg");
const target = path.join(projectDir, "assets-src", "hero-portal-raw.mp4");
const API = "https://api.replicate.com/v1";
const DURATION_SECONDS = 8;
const PROMPT =
  "A calm, slow, cinematic shot. The camera stays perfectly still. The thin doorway of lavender light glows steadily with a very gentle, slow pulse. " +
  "Low fog drifts slowly sideways across the dark floor and swirls softly around the base of the doorway. " +
  "A few tiny warm gold sparks float up and out of the doorway, drifting slowly towards the viewer and fading. " +
  "The reflection on the wet floor shimmers softly. Keep the composition, the colours and the dark empty sky exactly as in the image. " +
  "No people, no text, no new objects, no cuts, no zoom, no camera movement, no flashes, no sudden motion.";


async function api(token, pathname, options = {}) {
  const response = await fetch(API + pathname, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

const token = replicateToken();
const image = "data:image/jpeg;base64," + fs.readFileSync(still).toString("base64");
// No "Prefer: wait": a dropped connection must not hide a running (billed) job.
let prediction = await api(token, "/models/xai/grok-imagine-video/predictions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ input: { image, prompt: PROMPT, duration: DURATION_SECONDS, resolution: "720p", aspect_ratio: "auto" } }),
});
console.log(`started prediction ${prediction.id}`);
const started = Date.now();
while (!["succeeded", "failed", "canceled"].includes(prediction.status)) {
  if (Date.now() - started > 8 * 60 * 1000) throw new Error(`timeout, check prediction ${prediction.id} on Replicate`);
  await new Promise((resolve) => setTimeout(resolve, 4000));
  prediction = await api(token, `/predictions/${prediction.id}`);
}
if (prediction.status !== "succeeded") throw new Error(`${prediction.status}: ${prediction.error}`);

const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
const video = await fetch(url);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, Buffer.from(await video.arrayBuffer()));
console.log(`saved ${path.basename(target)} (${Math.round(fs.statSync(target).size / 1024)} KB, ${prediction.metrics?.predict_time?.toFixed(1) ?? "?"}s compute)`);
