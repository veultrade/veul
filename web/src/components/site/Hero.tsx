import Link from "next/link";
import styles from "./Hero.module.css";

/**
 * Hero: the portal scene (picked 2026-11-20) as a silent looping video.
 * Source: gpt-image-2 still at 2048x1152 (also the poster), animated with Grok at 720p,
 * looped forward and back with ffmpeg (scripts/generate-video.mjs, docs/tasks.md).
 * People who prefer reduced motion get the still instead of the video.
 */
export function Hero() {
  return (
    <section className={styles.hero}>
      <video className={styles.scene} autoPlay muted loop playsInline preload="auto" poster="/hero/hero-portal-hq.jpg" aria-hidden="true">
        <source src="/hero/hero-portal.mp4" type="video/mp4" />
      </video>
      {/* Shown instead of the video when the visitor prefers reduced motion. */}
      <div className={styles.still} aria-hidden="true" />
      <div className={styles.shade} aria-hidden="true" />
      <div className={styles.inner}>
        <h1 className={styles.title}>
          <span className={styles.soft}>Trade memes on Robinhood Chain.</span>
          <br />
          Get paid back in stocks.
        </h1>
        <p className={styles.lede}>Swap any token through Uniswap. Part of every fee comes back to you as NVDA, SPY or the stock you pick.</p>
        <div className={styles.actions}>
          <Link className="btn btn-main" href="/app">
            Go to app
          </Link>
          <Link className="btn btn-quiet" href="/#how">
            How it works
          </Link>
        </div>
      </div>
    </section>
  );
}
