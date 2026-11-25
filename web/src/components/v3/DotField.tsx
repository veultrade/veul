"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./DotField.module.css";

/**
 * A field of amber dots with a few "hot" points: dots swell around each point, and the point carries a label.
 * The hot points move to a new spot every few seconds, so the field reads as stocks lighting up across a map.
 * Drawn on canvas; the labels are real text in the DOM for screen readers and crisp type.
 */
type Spot = { label: string; x: number; y: number };

const CELL = 16;
const BASE_RADIUS = 5.2;
const HOT_RADIUS = 12;
const SPREAD = 64;
const HOLD_MS = 2600;

// Fixed positions (share of width/height), visited in turn; no randomness, so it renders the same on every load.
const SLOTS = [
  [0.22, 0.42], [0.42, 0.32], [0.7, 0.58], [0.84, 0.3], [0.32, 0.7], [0.58, 0.24], [0.12, 0.64], [0.76, 0.76],
];

export function DotField({ labels }: { labels: string[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [step, setStep] = useState(0);

  // Two spots are lit at once; each step moves them to the next slots and labels.
  const spots: Spot[] = [0, 1].map((lane) => {
    const slot = SLOTS[(step * 2 + lane * 3) % SLOTS.length];
    return { label: labels[(step * 2 + lane) % labels.length], x: slot[0], y: slot[1] };
  });

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setStep((value) => value + 1), HOLD_MS);
    return () => window.clearInterval(timer);
  }, []);

  // The canvas loop reads the latest spots from a ref, so it never restarts.
  const spotsRef = useRef(spots);
  useEffect(() => {
    spotsRef.current = spots;
  });

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!box || !canvas || !context) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let columns = 0;
    let rows = 0;
    let radii = new Float32Array(0);
    let frame = 0;
    let visible = false;
    let lastTime = 0;
    // Spots glide to their new places instead of jumping.
    const glide = spotsRef.current.map((spot) => ({ x: spot.x, y: spot.y }));

    const resize = () => {
      const rect = box.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      columns = Math.floor(width / CELL);
      rows = Math.floor(height / CELL);
      radii = new Float32Array(columns * rows).fill(BASE_RADIUS);
    };

    const tick = (time: number) => {
      frame = 0;
      const seconds = lastTime ? Math.min(0.05, (time - lastTime) / 1000) : 1 / 60;
      lastTime = time;
      const follow = reducedMotion ? 1 : 1 - Math.exp(-3 * seconds);
      spotsRef.current.forEach((spot, index) => {
        glide[index].x += (spot.x - glide[index].x) * follow;
        glide[index].y += (spot.y - glide[index].y) * follow;
      });
      const color = getComputedStyle(box).color;
      const offsetX = (width - (columns - 1) * CELL) / 2;
      const offsetY = (height - (rows - 1) * CELL) / 2;
      const ease = reducedMotion ? 1 : 1 - Math.exp(-10 * seconds);
      context.clearRect(0, 0, width, height);
      context.fillStyle = color;
      context.beginPath();
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const x = offsetX + column * CELL;
          const y = offsetY + row * CELL;
          let goal = BASE_RADIUS;
          for (const point of glide) {
            const distance = Math.hypot(x - point.x * width, y - point.y * height);
            // Dots shrink in a ring around each hot point and swell at its centre, like a ripple.
            const ripple = Math.exp(-(distance * distance) / (2 * SPREAD * SPREAD));
            goal = Math.min(goal, BASE_RADIUS * (1 - 0.55 * ripple * (distance > CELL * 1.2 ? 1 : 0)));
            if (distance < CELL * 0.75) goal = HOT_RADIUS;
          }
          const index = row * columns + column;
          radii[index] += (goal - radii[index]) * ease;
          const radius = radii[index];
          context.moveTo(x + radius, y);
          context.arc(x, y, radius, 0, Math.PI * 2);
        }
      }
      context.fill();
      if (visible && !reducedMotion) frame = requestAnimationFrame(tick);
      else lastTime = 0;
    };

    const wake = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };

    resize();
    wake();
    const resizeObserver = new ResizeObserver(() => {
      resize();
      wake();
    });
    resizeObserver.observe(box);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      wake();
    });
    intersectionObserver.observe(box);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
    };
  }, []);

  return (
    <div ref={boxRef} className={styles.field}>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      {spots.map((spot, lane) => (
        <span key={lane} className={styles.tag} style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%` }}>
          {spot.label}
        </span>
      ))}
    </div>
  );
}
