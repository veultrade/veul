// Generates the Moneda-style option's images with Replicate openai/gpt-image-2 (medium, about $0.05 each).
// Every run costs money: pass only the images you mean to generate. Approved by the user 2026-11-20 (3 images).
// Usage: node scripts/generate-images.mjs hero-trader chrome-stack chrome-piggy
// Output: prototype/options/assets/<name>.jpg, or the entry's own "out" folder. Images carry no text; all copy stays in HTML.
// Token: see scripts/lib/replicate-token.mjs; never printed.
import fs from "fs";
import { replicateToken } from "./lib/replicate-token.mjs";
import path from "path";
import { fileURLToPath } from "url";

const projectDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectDir, "prototype", "options", "assets");
const API = "https://api.replicate.com/v1";
const MAX_IMAGES_PER_RUN = 3; // hard cap so a typo can't trigger a large paid batch

const CHROME =
  "Photorealistic 3D product render of a single object made of highly polished mirror chrome and brushed silver, " +
  "soft studio lighting with gentle reflections, centred, floating slightly, on a pure flat black background (#0e0e0e) with no floor and no horizon. " +
  "Premium fintech brand illustration. No text, no letters, no numbers, no logos, no symbols engraved, no frame.";

// Hero visuals for the Glow-style landing (user approved gpt-image-2 for the hero, 2026-11-20).
const GLOW_WORLD =
  "Cinematic, photorealistic 3D render. Near-black surroundings (#0b0b0d), palette of soft lavender (#a3a4ec), lavender white, a little plum, " +
  "and one small warm gold accent. Calm, premium, quiet, like a high-end fintech brand film. The whole upper half and the centre of the frame " +
  "stay dark and empty so a white headline can sit there; the subject sits in the lower third. Wide 3:2 frame. " +
  "No text, no letters, no numbers, no logos, no symbols, no people, no frame, no watermark.";

const IMAGES = {
  "hero-lightwell": {
    aspect: "3:2",
    out: "web/public/hero",
    prompt:
      "A vast, dark, minimal concrete hall at night. High above, a single large rectangular opening in the ceiling glows with soft lavender white light, " +
      "and volumetric beams fall through faint haze onto a polished dark floor. In the pool of light on the floor stands a small neat stack of glass coins; " +
      "the top coin is warm gold. " + GLOW_WORLD,
  },
  "hero-glass-coins": {
    aspect: "3:2",
    out: "web/public/hero",
    prompt:
      "A row of translucent frosted glass coins floating in a gentle rising arc from lower left to lower right, each a little higher than the last, " +
      "lit from behind by lavender rim light with soft haze glowing behind them; the last, highest coin is solid warm gold. Shallow depth of field. " + GLOW_WORLD,
  },
  "hero-portal": {
    aspect: "3:2",
    out: "web/public/hero",
    prompt:
      "A tall, thin rectangular doorway of pure glowing lavender light stands on a mirror-like dark floor in an endless dark space with low soft fog. " +
      "A few tiny warm gold sparks drift out of the doorway towards the viewer, and the light reflects in a long streak on the floor. " + GLOW_WORLD,
  },
  // The picked hero (user, 2026-11-20): the portal again at high quality, 2048x1152, as the video's first frame and poster.
  "hero-portal-hq": {
    aspect: "2048x1152",
    quality: "high",
    out: "web/public/hero",
    prompt:
      "A tall, thin rectangular doorway of pure glowing lavender light stands on a wet, mirror-like dark stone floor in an endless dark space. " +
      "Low soft fog drifts across the floor and glows lavender near the doorway. A few tiny warm gold sparks float out of the doorway towards the viewer. " +
      "The doorway's light reflects in one long sharp streak on the floor. Crisp detail, clean edges, rich subtle gradients in the dark, no banding. " + GLOW_WORLD.replace('Wide 3:2 frame. ', 'Wide 16:9 frame. '),
  },
  "hero-trader": {
    aspect: "3:2",
    prompt:
      "Editorial lifestyle photograph, shot on 35mm film look with soft natural daylight: a young adult in a light grey oversized blazer and white t-shirt " +
      "sits relaxed on wide pale concrete steps in a bright minimalist interior, looking down at a smartphone in one hand, calm and confident. " +
      "The person sits in the lower right third; the upper half and the centre of the frame are calm, softly out of focus pale grey wall, " +
      "so large white text can sit on top. Muted palette of warm greys, off-white and soft black. " +
      "No text, no logos, no visible screen content, no brand marks.",
  },
  "chrome-stack": {
    aspect: "1:1",
    prompt: "The object: a short stack of four thick round coins, the top coin lifted a little above the stack and tilted, as if just added. " + CHROME,
  },
  "chrome-piggy": {
    aspect: "1:1",
    prompt: "The object: a smooth, minimal piggy bank with a coin slot on its back, seen at a three-quarter angle, simple rounded form. " + CHROME,
  },
};


async function api(token, pathname, options = {}) {
  const response = await fetch(API + pathname, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

async function generate(token, name) {
  const { prompt, aspect, quality = "medium", out } = IMAGES[name];
  const targetDir = out ? path.join(projectDir, out) : outputDir;
  // No "Prefer: wait": a held-open request can time out locally while the job still runs and bills.
  let prediction = await api(token, "/models/openai/gpt-image-2/predictions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: { prompt, aspect_ratio: aspect, quality, output_format: "jpeg", number_of_images: 1 } }),
  });
  const started = Date.now();
  while (!["succeeded", "failed", "canceled"].includes(prediction.status)) {
    if (Date.now() - started > 5 * 60 * 1000) throw new Error(`timeout ${prediction.id}`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    prediction = await api(token, `/predictions/${prediction.id}`);
  }
  if (prediction.status !== "succeeded") throw new Error(`${name}: ${prediction.status} ${prediction.error}`);
  const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  const image = await fetch(url);
  fs.mkdirSync(targetDir, { recursive: true });
  const file = path.join(targetDir, `${name}.jpg`);
  fs.writeFileSync(file, Buffer.from(await image.arrayBuffer()));
  console.log(`saved ${name}.jpg (${Math.round(fs.statSync(file).size / 1024)} KB, ${prediction.metrics?.predict_time?.toFixed(1) ?? "?"}s)`);
}

const names = process.argv.slice(2);
const unknown = names.filter((name) => !IMAGES[name]);
if (!names.length || unknown.length) throw new Error(`Pass images from: ${Object.keys(IMAGES).join(", ")}`);
if (names.length > MAX_IMAGES_PER_RUN) throw new Error(`At most ${MAX_IMAGES_PER_RUN} images per run`);

const token = replicateToken();
const results = await Promise.allSettled(names.map((name) => generate(token, name)));
results.forEach((result, index) => {
  if (result.status === "rejected") console.log(`FAILED ${names[index]}: ${result.reason.message}`);
});
