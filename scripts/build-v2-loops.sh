#!/usr/bin/env bash
# Redesign v2: turns the raw clips (assets-src/redesign-v2/scene2/<name>-raw.mp4, from generate-v2-videos.mjs) into the
# seamless loops the site ships (web/public/scene/<name>.mp4). Free: ffmpeg only.
# Each loop plays forward then backward (no visible cut), slowed 1.4x with blended frames, no audio.
# Usage: bash scripts/build-v2-loops.sh [name ...]
set -euo pipefail
cd "$(dirname "$0")/.."
names=("$@")
[ ${#names[@]} -eq 0 ] && names=(bull press towers arm vault)
mkdir -p web/public/scene
for name in "${names[@]}"; do
  raw="assets-src/redesign-v2/scene2/$name-raw.mp4"
  [ -f "$raw" ] || { echo "skip $name (no raw clip)"; continue; }
  ffmpeg -v error -y -i "$raw" \
    -filter_complex "[0:v:0]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0,setpts=1.4*PTS,minterpolate=fps=24:mi_mode=blend,format=yuv420p[v]" \
    -map "[v]" -an -c:v libx264 -crf 23 -preset slow -profile:v high -movflags +faststart "web/public/scene/$name.mp4"
  echo "ok $name $(du -k "web/public/scene/$name.mp4" | cut -f1) KB"
done
