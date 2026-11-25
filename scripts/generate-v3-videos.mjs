// Landing v3 (after datavendor.ai, approved 2026-11-25): animates the grayscale stills (assets-src/v3/*.jpg)
// into short clips for the halftone canvas. Slow, smooth motion reads best as dots.
// Replicate xai/grok-imagine-video, image to video, 6 s at 720p. Costs money every run:
// about $0.05 to $0.07 per second, so roughly $0.30 to $0.45 per clip. Hard cap: 5 clips per run.
// Usage: node scripts/generate-v3-videos.mjs [name ...]     (skips clips that already exist)
// Output: assets-src/v3/<name>-raw.mp4. Loops for the site: bash scripts/build-v3-loops.sh
// Token: see scripts/lib/replicate-token.mjs; never printed.
import fs from "node:fs";
import { replicateToken } from "./lib/replicate-token.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const stillDir = path.join(projectDir, "assets-src", "v3");
const outDir = path.join(projectDir, "assets-src", "v3");
const API = "https://api.replicate.com/v1";
const DURATION_SECONDS = 6;
const MAX_CLIPS = 5;
const token = replicateToken();

const RULES =
  " Very slow, smooth, continuous motion. Keep it grayscale on a pure black background, same lighting and materials. " +
  "No people, no text, no new objects, no cuts, no flashes, no camera shake, no colour.";

const MOTION = {
  hero: "The camera glides slowly forward and low over the white sand dunes while the clouds drift and billow gently on the horizon.",
  flow: "The coins flow slowly along the curved stream toward the camera, tumbling gently over each other like a slow river.",
  swap: "The two coins orbit each other slowly in a circle, each one turning gently as it moves, the motion trail following them.",
  dollar: "The dollar sign sculpture rotates slowly and steadily around its vertical axis, the light sliding across its rounded surfaces.",
  stack: "Coins drop softly one by one onto the tops of the stacks, which grow a little taller from left to right.",
};

async function api(pathname, options = {}) {
  const response = await fetch(API + pathname, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

fs.mkdirSync(outDir, { recursive: true });
const pick = process.argv.slice(2);
let clips = 0;
for (const [name, motion] of Object.entries(MOTION)) {
  if (pick.length && !pick.includes(name)) continue;
  const target = path.join(outDir, `${name}-raw.mp4`);
  if (fs.existsSync(target)) { console.log("skip", name); continue; }
  if (++clips > MAX_CLIPS) { console.log("cap reached"); break; }
  try {
    const image = "data:image/jpeg;base64," + fs.readFileSync(path.join(stillDir, `${name}.jpg`)).toString("base64");
    // No "Prefer: wait": a dropped connection must not hide a running (billed) job.
    let prediction = await api("/models/xai/grok-imagine-video/predictions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: { image, prompt: motion + RULES, duration: DURATION_SECONDS, resolution: "720p", aspect_ratio: "auto" } }),
    });
    console.log(`started ${name} ${prediction.id}`);
    const started = Date.now();
    while (!["succeeded", "failed", "canceled"].includes(prediction.status)) {
      if (Date.now() - started > 8 * 60 * 1000) throw new Error(`timeout, check prediction ${prediction.id} on Replicate`);
      await new Promise((resolve) => setTimeout(resolve, 4000));
      prediction = await api(`/predictions/${prediction.id}`);
    }
    if (prediction.status !== "succeeded") throw new Error(`${prediction.status}: ${prediction.error}`);
    const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    fs.writeFileSync(target, Buffer.from(await (await fetch(url)).arrayBuffer()));
    console.log(`ok ${name} (${Math.round(fs.statSync(target).size / 1024)} KB, ${prediction.metrics?.predict_time?.toFixed(1) ?? "?"}s compute)`);
  } catch (error) {
    console.log(`fail ${name}: ${error.message}`);
    if (/^402 /.test(error.message)) break;
  }
}
