// Redesign v2: animates the dark 3D stills (assets-src/redesign-v2/scene2/*.jpg, second set) into short clips,
// in the manner of the reference's videos: slow camera glides, a light that sweeps, drifting haze.
// Replicate xai/grok-imagine-video, image to video, 6 s at 720p (its maximum). Costs money every run:
// about $0.05 to $0.07 per second, so roughly $0.30 to $0.45 per clip. Hard cap: 5 clips per run.
// Approved by the user 2026-11-23 ("animate the stills into video like the reference").
// Usage: node scripts/generate-v2-videos.mjs [name ...]     (skips clips that already exist)
// Output: assets-src/redesign-v2/scene2/<name>-raw.mp4. The shipped loops are built from these with ffmpeg (docs/tasks.md).
// Token: see scripts/lib/replicate-token.mjs; never printed.
import fs from "node:fs";
import { replicateToken } from "./lib/replicate-token.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const stillDir = path.join(projectDir, "assets-src", "redesign-v2", "scene2");
const outDir = path.join(projectDir, "assets-src", "redesign-v2", "scene2");
const API = "https://api.replicate.com/v1";
const DURATION_SECONDS = 6;
const MAX_CLIPS = 5;
const token = replicateToken();

const RULES =
  " Very slow, calm, cinematic, like a luxury car commercial. Keep the image almost entirely black, with the same soft indigo-blue light and drifting haze. " +
  "No people, no text, no new objects, no cuts, no flashes, no sudden motion, no change of colour, no brightening.";

const MOTION = {
  bull: "The camera glides very slowly around the bull sculpture from its head toward its shoulder while the soft blue light sweeps slowly across the metal plates; haze drifts behind it.",
  press: "The heavy steel die descends very slowly toward the coin and stops just above it, then rises again; the camera stays still and haze drifts through the blue light.",
  towers: "The camera flies very slowly over the dark model city, drifting forward and slightly sideways; a soft band of blue light passes slowly over the towers and a few tiny windows flicker.",
  arm: "The robotic arm rotates its wrist very slowly and brings the coin a little closer to the camera; the blurred arm behind moves slightly; haze drifts.",
  vault: "The spoked handle wheel turns very slowly and the round locking bolts slide a few centimetres; the soft blue light sweeps slowly along the curve of the door.",
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
