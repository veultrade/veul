// Redesign v2 visuals, second set (2026-11-23): stills that copy the LOOK of the reference's videos, studied frame by frame:
// real high-tech subjects, 80% of the frame black, one soft diffused indigo light with haze, big cropped silhouettes.
// (The first set had thin neon outlines on abstract shapes; the user said it did not match.)
// 5 images on Replicate openai/gpt-image-2, quality high, 16:9. Hard cap 5 calls per run. About $0.15 each.
// Token: see scripts/lib/replicate-token.mjs; never printed.
// Usage: node scripts/generate-v2-stills.mjs [name ...]   Output: assets-src/redesign-v2/scene2/<name>.jpg (skips files that exist).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { replicateToken } from "./lib/replicate-token.mjs";

const token = replicateToken();
const OUT = new URL("../assets-src/redesign-v2/scene2/", import.meta.url);
const MAX_CALLS = 5;
const TIMEOUT_MS = 240_000;
mkdirSync(OUT, { recursive: true });

const LOOK =
  "Frame from a high-end cinematic 3D commercial, heavily underexposed: about 80 percent of the image is pure black shadow. " +
  "One soft, diffused, deep indigo-blue light (desaturated navy blue, never neon, never cyan) grazes the subject from behind and the side, " +
  "revealing only parts of its silhouette with broad soft highlights and gentle falloff into black. Thin volumetric haze drifts through the light. " +
  "Matte black painted metal and carbon surfaces with fine panel lines and tiny engraved details. Long lens, shallow depth of field, soft bloom, subtle film grain. " +
  "No glowing outlines, no neon edge lines, no light strips, no text, no letters, no numbers, no logos, no people.";

const SCENES = {
  bull: "Low-angle close view of a massive charging bull sculpture in matte black metal, almost a silhouette: the lowered head, one horn and the shoulder emerge from darkness on the right, cropped by the frame; empty black on the left.",
  press: "Three-quarter view from above of an industrial coin minting press: a heavy steel die hovering just above a single blank coin on a round anvil, small machined parts around it fading into darkness; subject in the lower right, empty black upper left.",
  towers: "Aerial oblique view of a dense cluster of dark abstract skyscraper blocks, like a model of a financial district at night, with only a few tiny cool-white window lights; the blocks fade into black toward the edges.",
  arm: "Side view of a sleek industrial robotic arm whose precision gripper holds a single dark coin between its fingers; a second arm is a blurred silhouette behind it; mostly black frame.",
  vault: "Extreme close-up of a huge bank vault door: thick round locking bolts and part of a spoked handle wheel, cropped so the curve of the door runs across the lower half; black above.",
};

async function generate(prompt) {
  const res = await fetch("https://api.replicate.com/v1/models/openai/gpt-image-2/predictions", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "wait=60" },
    body: JSON.stringify({ input: { prompt, quality: "high", aspect_ratio: "16:9", output_format: "jpeg", output_compression: 88, number_of_images: 1 } }),
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
for (const [name, scene] of Object.entries(SCENES)) {
  if (pick.length && !pick.includes(name)) continue;
  const file = new URL(`${name}.jpg`, OUT);
  if (existsSync(file)) { console.log("skip", name); continue; }
  if (++calls > MAX_CALLS) { console.log("cap reached"); break; }
  try {
    const url = await generate(`${scene} ${LOOK}`);
    writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
    console.log("ok", name);
  } catch (error) {
    console.log("fail", name, error.message);
    if (/^402 /.test(error.message)) break;
  }
}
