/**
 * Halftone sources for landing v3, in one place. Generated grayscale renders (scripts/generate-v3-stills.mjs),
 * animated into loops (scripts/generate-v3-videos.mjs + scripts/build-v3-loops.sh). A .jpg here means the
 * still is used until its loop exists.
 */
export const MEDIA = {
  hero: "/v3/hero.mp4",
  flow: "/v3/flow.mp4",
  swap: "/v3/swap.mp4",
  dollar: "/v3/dollar.mp4",
  stack: "/v3/stack.mp4",
  // Footer horizon: sharp-ridged dunes, cropped to a 2:1 strip (2048x640 → 1280x400), after the reference's footer.
  dunes: "/v3/footer.jpg",
} as const;
