// Landing v3 (after datavendor.ai, approved 2026-11-25): source stills for the halftone videos.
// The halftone effect turns brightness into dot size, so the stills are clean grayscale 3D renders:
// one big subject, bright matte surfaces, pure black ground, no fine texture.
// 5 images on Replicate openai/gpt-image-2, quality high. Hard cap 5 calls per run. About $0.15 each.
// Token: see scripts/lib/replicate-token.mjs; never printed.
// Usage: node scripts/generate-v3-stills.mjs [name ...]   Output: assets-src/v3/<name>.jpg (skips files that exist).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { replicateToken } from "./lib/replicate-token.mjs";

const token = replicateToken();
const OUT = new URL("../assets-src/v3/", import.meta.url);
const MAX_CALLS = 5;
const TIMEOUT_MS = 240_000;
mkdirSync(OUT, { recursive: true });

const LOOK =
  "Grayscale 3D render, black and white only. Pure black background. Soft white studio light from above and the side, " +
  "high contrast, smooth matte white and light-grey surfaces with soft shadows, large simple shapes, gentle depth of field. " +
  "No fine texture, no noise, no text, no letters, no numbers, no logos, no people, no color.";

// aspect: the canvas each still fills on the page (hero is full width; the rest sit in square-ish cards).
const SCENES = {
  hero: { aspect: "16:9", scene: "Wide aerial view flying low over soft rolling sand dunes under drifting clouds at dawn, bright cloud tops and dune ridges, dark valleys, horizon in the upper third." },
  flow: { aspect: "16:9", scene: "A long stream of thick glossy coins flowing in a smooth S-curve from the upper left to the lower right, coins tumbling and overlapping, bright near the camera, fading into black at the far end." },
  swap: { aspect: "1:1", scene: "Two thick coins orbiting each other in mid-air, one smooth and one with a ridged edge, with a soft circular motion trail between them, centered." },
  dollar: { aspect: "1:1", scene: "A single large bold dollar sign sculpture standing upright, thick rounded white matte material, slightly turned, centered, filling most of the frame." },
  // Footer horizon (2026-11-25, user: "footer semirip mungkin dengan mereka, termasuk gambar assetnya"): a low panoramic
  // strip of dunes, cropped to about 3:1 afterwards. Lit faces become dots; shadow faces and sky stay black.
  footer: { aspect: "16:9", scene: "Low panoramic side view of three large sand dunes with sharp knife-edge ridges, strong low sun from the right: the sunlit slopes are bright smooth white, the shadow slopes are pitch black, a tall dune peak left of centre and smaller dunes to the sides, the dunes fill only the lower half of the frame, pure black sky above." },
  stack: { aspect: "1:1", scene: "Four stacks of thick coins rising from left to right like a bar chart, each stack taller than the last, centered on a dark reflective floor." },
};

async function generate(prompt, aspect) {
  const res = await fetch("https://api.replicate.com/v1/models/openai/gpt-image-2/predictions", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "wait=60" },
    body: JSON.stringify({ input: { prompt, quality: "high", aspect_ratio: aspect, output_format: "jpeg", output_compression: 90, number_of_images: 1 } }),
  });
  let pred = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(pred).slice(0, 200)}`);
  const started = Date.now();
  while (!["succeeded", "failed", "canceled"].includes(pred.status)) {
    if (Date.now() - started > TIMEOUT_MS) throw new Error(`timed out (${pred.id})`);
    await new Promise((r) => setTimeout(r, 3000));
    pred = await (await fetch(pred.urls.get, { headers: { Authorization: `Bearer ${token}` } })).json();
  }
  if (pred.status !== "succeeded") throw new Error(`${pred.status}: ${String(pred.error).slice(0, 200)}`);
  return Array.isArray(pred.output) ? pred.output[0] : pred.output;
}

const pick = process.argv.slice(2);
let calls = 0;
for (const [name, { aspect, scene }] of Object.entries(SCENES)) {
  if (pick.length && !pick.includes(name)) continue;
  const file = new URL(`${name}.jpg`, OUT);
  if (existsSync(file)) { console.log("skip", name); continue; }
  if (++calls > MAX_CALLS) { console.log("cap reached"); break; }
  try {
    const url = await generate(`${scene} ${LOOK}`, aspect);
    writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
    console.log("ok", name);
  } catch (error) {
    console.log("fail", name, error.message);
    if (/^402 /.test(error.message)) break;
  }
}
