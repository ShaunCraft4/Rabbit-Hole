import type { CSSProperties } from "react";

import styles from "./DreamBackdrop.module.css";

/** A tiny seeded generator: the same sky on the server and in the browser (no hydration mismatch). */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const rand = seeded(20261121);

const STARS = Array.from({ length: 46 }, () => ({
  left: `${(rand() * 100).toFixed(2)}%`,
  top: `${(rand() * 100).toFixed(2)}%`,
  size: rand() < 0.18 ? 2.2 : rand() < 0.5 ? 1.6 : 1.1,
  gold: rand() < 0.22,
  delay: `${(rand() * 6).toFixed(2)}s`,
  duration: `${(3 + rand() * 4).toFixed(2)}s`,
}));

const SUITS = ["♠", "♥", "♦", "♣", "♥", "♠", "♣", "♦"].map((glyph, i) => ({
  glyph,
  left: `${(6 + i * 12 + rand() * 6).toFixed(1)}%`,
  top: `${(18 + rand() * 70).toFixed(1)}%`,
  size: `${(18 + rand() * 22).toFixed(0)}px`,
  delay: `${(-rand() * 30).toFixed(1)}s`,
  duration: `${(26 + rand() * 18).toFixed(1)}s`,
}));

/**
 * The dreamy sky behind the entrance, the plan and the Golden Key (not the map): slow nebula
 * clouds, twinkling stars, an occasional shooting star and a few faint card suits drifting up.
 * Purely decorative, behind everything, and still under prefers-reduced-motion.
 */
/** Inline fallbacks: even if the stylesheet is missing, the sky stays behind the page and faint. */
const SKY_STYLE: CSSProperties = { position: "fixed", inset: 0, zIndex: -1, overflow: "hidden", pointerEvents: "none" };

export function DreamBackdrop() {
  return (
    <div className={styles.sky} style={SKY_STYLE} aria-hidden>
      <div className={`${styles.cloud} ${styles.violet}`} />
      <div className={`${styles.cloud} ${styles.teal}`} />
      <div className={`${styles.cloud} ${styles.gold}`} />
      {STARS.map((star, i) => (
        <span
          key={`star-${i}`}
          className={`${styles.star} ${star.gold ? styles.goldStar : ""}`}
          style={
            {
              position: "absolute",
              left: star.left,
              top: star.top,
              width: star.size,
              height: star.size,
              animationDelay: star.delay,
              animationDuration: star.duration,
            } as CSSProperties
          }
        />
      ))}
      <span className={styles.shootingStar} />
      {SUITS.map((suit, i) => (
        <span
          key={`suit-${i}`}
          className={styles.suit}
          style={{
            position: "absolute",
            color: "rgb(214 183 107 / 0.09)",
            left: suit.left,
            top: suit.top,
            fontSize: suit.size,
            animationDelay: suit.delay,
            animationDuration: suit.duration,
          }}
        >
          {suit.glyph}
        </span>
      ))}
    </div>
  );
}
