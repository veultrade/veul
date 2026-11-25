"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./motion.module.css";

/**
 * Small motion helpers for the app. Every one of them stays still under prefers-reduced-motion.
 */

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A number that glides to its new value (ease-out, 450 ms) instead of jumping, so a fresh quote reads as a change.
 */
export function Tween({ value, format, className }: { value: number; format: (value: number) => string; className?: string }) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  const shownRef = useRef(value);

  useEffect(() => {
    fromRef.current = shownRef.current;
    const start = performance.now();
    // Reduced motion (or a non-number): jump straight to the value on the next frame.
    const duration = reducedMotion() || !Number.isFinite(value) || !Number.isFinite(fromRef.current) ? 0 : 450;
    let frame = 0;
    const step = (now: number) => {
      const progress = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = fromRef.current + (value - fromRef.current) * eased;
      shownRef.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <span className={className}>{format(shown)}</span>;
}

/**
 * Text that flashes green when its number goes up and red when it goes down (live prices).
 * The flash restarts by remounting the inner span with a new key.
 */
export function Flash({ value, children, className }: { value: number; children: React.ReactNode; className?: string }) {
  const previous = useRef(value);
  const [flash, setFlash] = useState<{ direction: "up" | "down"; key: number } | null>(null);

  useEffect(() => {
    if (value !== previous.current && Number.isFinite(previous.current)) {
      const direction = value > previous.current ? "up" : "down";
      setFlash((current) => ({ direction, key: (current?.key ?? 0) + 1 }));
    }
    previous.current = value;
  }, [value]);

  return (
    <span key={flash?.key ?? 0} className={`${className ?? ""} ${flash ? styles[flash.direction] : ""}`}>
      {children}
    </span>
  );
}

/** Grey shimmer bar standing in for text that is still loading. */
export function Skeleton({ width = "100%", height = 12 }: { width?: number | string; height?: number }) {
  return <span className={styles.skeleton} style={{ width, height }} aria-hidden="true" />;
}
