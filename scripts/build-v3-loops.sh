#!/usr/bin/env bash
# Landing v3: turns the raw clips (assets-src/v3/<name>-raw.mp4, from generate-v3-videos.mjs) into the
# seamless loops the halftone canvas plays (web/public/v3/<name>.mp4). Free: ffmpeg only.
# Each loop plays forward then backward (no visible cut), slowed 1.3x, grayscale, small (the canvas
# samples one pixel per dot, so 640 px is plenty), no audio.
# Usage: bash scripts/build-v3-loops.sh [name ...]
set -euo pipefail
cd "$(dirname "$0")/.."

# Seconds of each raw clip to use; some clips morph or glitch late, so they are cut before that.
declare -A KEEP=([hero]=6 [flow]=6 [swap]=6 [dollar]=3 [stack]=6)

names=("$@")
[ ${#names[@]} -eq 0 ] && names=(hero flow swap dollar stack)
mkdir -p web/public/v3
for name in "${names[@]}"; do
  raw="assets-src/v3/$name-raw.mp4"
  [ -f "$raw" ] || { echo "skip $name (no raw clip)"; continue; }
  keep="${KEEP[$name]:-6}"
  ffmpeg -v error -y -t "$keep" -i "$raw" \
    -filter_complex "[0:v:0]scale=640:-2,hue=s=0,split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0,setpts=1.3*PTS,fps=24,format=yuv420p[v]" \
    -map "[v]" -an -c:v libx264 -crf 26 -preset slow -profile:v high -movflags +faststart "web/public/v3/$name.mp4"
  echo "ok $name $(du -k "web/public/v3/$name.mp4" | cut -f1) KB"
done
