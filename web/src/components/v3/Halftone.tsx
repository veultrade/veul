"use client";

import { useEffect, useRef } from "react";
import styles from "./Halftone.module.css";

/**
 * Halftone: redraws a video, an image or a hand-drawn source as a grid of round dots.
 * Each cell samples the source's brightness; brighter cells get bigger dots (dark ground, light dots).
 *
 * How it works, per frame:
 *  1. the source is drawn, cover-fitted, into a tiny offscreen canvas with one pixel per grid cell;
 *  2. each pixel's luminance becomes a target dot radius (below `floor` brightness there is no dot);
 *  3. the drawn radii ease toward their targets, so video motion and the pointer feel soft, not flickery;
 *  4. every dot is drawn in one path with the element's CSS `color`.
 * The loop only runs while the element is on screen. With prefers-reduced-motion it draws one still frame.
 */
type Props = {
  /** Video (.mp4/.webm) or image URL. Ignored when `draw` is given. */
  src?: string;
  /** Draws the source by hand (white on black) into a canvas of the grid size; used for numbers and symbols. */
  draw?: (context: CanvasRenderingContext2D, width: number, height: number) => void;
  /** Re-run `draw` when this value changes. */
  drawKey?: string | number;
  /** Grid step in CSS pixels. */
  cell?: number;
  /** Largest dot diameter as a share of the cell (1 = dots touch). */
  maxDot?: number;
  /** Smallest drawn dot as a share of the cell, for every lit cell; 0 lets dark cells vanish. */
  minDot?: number;
  /** Brightness (0..1) below which a cell has no dot. */
  floor?: number;
  /** Curve on brightness: above 1 keeps mid-tones small so only highlights read as big dots. */
  gamma?: number;
  /** Dots near the pointer grow, like a loupe. */
  interactive?: boolean;
  className?: string;
  label?: string;
};

const LOUPE_RADIUS = 70;
const LOUPE_GAIN = 1.9;

export function Halftone({ src, draw, drawKey, cell = 12, maxDot = 0.92, minDot = 0, floor = 0.08, gamma = 1, interactive = false, className, label }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const drawRef = useRef(draw);
  // Keep the latest draw function for the canvas loop without restarting it.
  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);
  // Set by the main effect: asks for a fresh sample of the source (used when `drawKey` changes).
  const resampleRef = useRef<() => void>(() => {});

  const isVideo = !!src && /\.(mp4|webm)(\?|$)/i.test(src);

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!box || !canvas || !context) return;

    const sampler = document.createElement("canvas");
    const sample = sampler.getContext("2d", { willReadFrequently: true });
    if (!sample) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const media: HTMLVideoElement | HTMLImageElement | null = videoRef.current ?? imageRef.current;

    let width = 0;
    let height = 0;
    let columns = 0;
    let rows = 0;
    let offsetX = 0;
    let offsetY = 0;
    let target = new Float32Array(0);
    let current = new Float32Array(0);
    let pointer: { x: number; y: number } | null = null;
    let visible = false;
    let frame = 0;
    let lastTime = 0;
    let lastVideoTime = -1;
    let needsSample = true;
    let color = getComputedStyle(box).color;

    const resize = () => {
      const rect = box.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      columns = Math.max(1, Math.floor(width / cell));
      rows = Math.max(1, Math.floor(height / cell));
      // Centre the grid so the leftover space is shared by both edges.
      offsetX = (width - (columns - 1) * cell) / 2;
      offsetY = (height - (rows - 1) * cell) / 2;
      sampler.width = columns;
      sampler.height = rows;
      target = new Float32Array(columns * rows);
      current = new Float32Array(columns * rows);
      color = getComputedStyle(box).color;
      needsSample = true;
    };

    const mediaReady = () => {
      if (!media) return false;
      if (media instanceof HTMLVideoElement) return media.readyState >= 2 && media.videoWidth > 0;
      return media.complete && media.naturalWidth > 0;
    };

    // Cover-fit the source into the sampler, one pixel per cell.
    const drawSource = () => {
      sample.fillStyle = "#000";
      sample.fillRect(0, 0, columns, rows);
      if (drawRef.current) {
        drawRef.current(sample, columns, rows);
        return true;
      }
      if (!media || !mediaReady()) return false;
      const sourceWidth = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
      const sourceHeight = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
      const scale = Math.max(columns / sourceWidth, rows / sourceHeight);
      const drawWidth = sourceWidth * scale;
      const drawHeight = sourceHeight * scale;
      sample.drawImage(media, (columns - drawWidth) / 2, (rows - drawHeight) / 2, drawWidth, drawHeight);
      return true;
    };

    const readTargets = () => {
      if (!drawSource()) return;
      const data = sample.getImageData(0, 0, columns, rows).data;
      const maxRadius = (cell * maxDot) / 2;
      const minRadius = (cell * minDot) / 2;
      for (let index = 0; index < columns * rows; index++) {
        const pixel = index * 4;
        const luminance = (0.2126 * data[pixel] + 0.7152 * data[pixel + 1] + 0.0722 * data[pixel + 2]) / 255;
        if (luminance <= floor) {
          target[index] = 0;
          continue;
        }
        const strength = Math.pow((luminance - floor) / (1 - floor), gamma);
        target[index] = minRadius + (maxRadius - minRadius) * strength;
      }
      needsSample = false;
    };

    const loupe = (x: number, y: number) => {
      if (!pointer) return 1;
      const distance = Math.hypot(x - pointer.x, y - pointer.y);
      if (distance >= LOUPE_RADIUS) return 1;
      const falloff = distance / LOUPE_RADIUS;
      return 1 + (LOUPE_GAIN - 1) * (1 - falloff * falloff);
    };

    // Ease drawn radii toward targets; growing is faster than shrinking, like ink spreading.
    const ease = (seconds: number) => {
      if (reducedMotion) {
        current.set(target);
        return false;
      }
      const grow = 1 - Math.exp(-24 * seconds);
      const shrink = 1 - Math.exp(-7 * seconds);
      let moving = false;
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const index = row * columns + column;
          const goal = target[index] * loupe(offsetX + column * cell, offsetY + row * cell);
          const now = current[index];
          const next = now + (goal - now) * (goal > now ? grow : shrink);
          if (Math.abs(goal - next) < 0.02) current[index] = goal;
          else {
            current[index] = next;
            moving = true;
          }
        }
      }
      return moving;
    };

    const paint = () => {
      context.clearRect(0, 0, width, height);
      context.fillStyle = color;
      context.beginPath();
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const radius = current[row * columns + column];
          if (radius < 0.35) continue;
          const x = offsetX + column * cell;
          const y = offsetY + row * cell;
          context.moveTo(x + radius, y);
          context.arc(x, y, radius, 0, Math.PI * 2);
        }
      }
      context.fill();
    };

    const tick = (time: number) => {
      frame = 0;
      const seconds = lastTime ? Math.min(0.05, (time - lastTime) / 1000) : 1 / 60;
      lastTime = time;
      const video = media instanceof HTMLVideoElement ? media : null;
      if (video && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        needsSample = true;
      }
      if (needsSample) readTargets();
      const moving = ease(seconds);
      paint();
      const playing = !!video && !video.paused;
      if (visible && (playing || moving || needsSample)) frame = requestAnimationFrame(tick);
      else lastTime = 0;
    };

    const wake = () => {
      if (visible && !frame) frame = requestAnimationFrame(tick);
    };

    const syncPlayback = () => {
      if (!(media instanceof HTMLVideoElement)) return;
      if (visible && !reducedMotion) media.play().catch(() => {});
      else media.pause();
    };

    resampleRef.current = () => {
      needsSample = true;
      wake();
    };

    resize();

    const resizeObserver = new ResizeObserver(() => {
      resize();
      wake();
    });
    resizeObserver.observe(box);

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        syncPlayback();
        wake();
      },
      { threshold: 0.02 },
    );
    intersectionObserver.observe(box);

    const onLoaded = () => {
      needsSample = true;
      syncPlayback();
      wake();
    };
    media?.addEventListener("loadeddata", onLoaded);
    media?.addEventListener("load", onLoaded);

    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      wake();
    };
    const onLeave = () => {
      pointer = null;
      wake();
    };
    if (interactive && !reducedMotion) {
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerleave", onLeave);
    }

    // Colour follows the CSS `color` (for a theme or hover change); re-read on transition end.
    const onColor = () => {
      color = getComputedStyle(box).color;
      wake();
    };
    box.addEventListener("transitionend", onColor);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      media?.removeEventListener("loadeddata", onLoaded);
      media?.removeEventListener("load", onLoaded);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      box.removeEventListener("transitionend", onColor);
    };
  }, [src, cell, maxDot, minDot, floor, gamma, interactive]);

  // A new hand-drawn source (for example a new number) only needs a fresh sample.
  useEffect(() => {
    resampleRef.current();
  }, [drawKey]);

  return (
    <div ref={boxRef} className={`${styles.box} ${className ?? ""}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {src && isVideo && <video ref={videoRef} className={styles.source} src={src} muted loop playsInline preload="auto" tabIndex={-1} />}
      {/* eslint-disable-next-line @next/next/no-img-element -- hidden pixel source for the canvas, never shown */}
      {src && !isVideo && <img ref={imageRef} className={styles.source} src={src} alt="" decoding="async" />}
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  );
}
