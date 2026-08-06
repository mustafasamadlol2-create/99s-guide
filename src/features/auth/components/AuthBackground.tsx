/**
 * AuthBackground — premium layered background for auth screens.
 *
 * Layers (bottom → top):
 * 1. Mesh gradient        — static CSS, diagonal color bleeds from corners
 * 2. Radial spotlight     — static CSS, focused glow behind the card
 * 3. Floating blobs       — motion/react, 3 slow-drifting light orbs
 * 4. Noise grain          — SVG feTurbulence, static, mix-blend overlay
 *
 * GPU strategy
 *  • Blobs animate x/y only (→ CSS transform). Zero layout recalculation.
 *  • will-change: transform + backface-visibility: hidden on every blob
 *    forces individual compositor layers — safe on Safari and mobile.
 *  • filter: blur() is a static style, not animated. The browser bakes it
 *    once per layer — no per-frame repaint.
 *  • prefers-reduced-motion: blobs receive no animate prop → fully static.
 */

import React from "react";
import { motion, useReducedMotion } from "motion/react";

/* ─── Blob definitions ──────────────────────────────────────────────────── */

interface BlobDef {
  /** Diameter in px */
  size: number;
  /** CSS blur in px — baked once, not animated */
  blur: number;
  /** RGBA color — chosen so they read in both light and dark mode */
  color: string;
  /** Absolute positioning anchor */
  pos: React.CSSProperties;
  /** Keyframe path for x (px) — mirrored loop */
  kx: number[];
  /** Keyframe path for y (px) — mirrored loop */
  ky: number[];
  /** Total cycle duration in seconds before mirror-reversal */
  dur: number;
}

const BLOBS: BlobDef[] = [
  {
    // Warm amber — upper-left halo
    size:  580,
    blur:  115,
    color: "rgba(255,149,0,0.055)",
    pos:   { top: "0%", left: "-8%" },
    kx:    [0, 34, -18, 26, 0],
    ky:    [0, -26, 38, -16, 0],
    dur:   22,
  },
  {
    // Cool teal — lower-right counterweight
    size:  480,
    blur:  100,
    color: "rgba(48,176,199,0.042)",
    pos:   { bottom: "5%", right: "-6%" },
    kx:    [0, -30, 20, -24, 0],
    ky:    [0,  22, -34,  18, 0],
    dur:   28,
  },
  {
    // Honey gold — centre-right accent
    size:  360,
    blur:  85,
    color: "rgba(255,185,75,0.038)",
    pos:   { top: "36%", right: "6%" },
    kx:    [0,  22, -16, 20, 0],
    ky:    [0, -18,  24, -12, 0],
    dur:   18,
  },
];

/* ─── Component ─────────────────────────────────────────────────────────── */

export default function AuthBackground() {
  const reduce = useReducedMotion();

  return (
    <div
      aria-hidden="true"
      style={{
        position:      "absolute",
        inset:         0,
        minHeight:     "100%",
        overflow:      "hidden",
        pointerEvents: "none",
        zIndex:        0,
        // Force own stacking context so layers blend only with each other
        isolation:     "isolate",
        // Legacy Safari layer-promotion hint
        transform:     "translateZ(0)",
      }}
    >

      {/* ── 1. Mesh gradient ─────────────────────────────────────────────
          Four diagonal colour bleeds layered over the base gradient.
          Pure CSS — zero JS involved.
      ──────────────────────────────────────────────────────────────────── */}

      {/* Light mode mesh */}
      <div
        className="dark:hidden"
        style={{
          position:   "absolute",
          inset:      0,
          background: [
            "linear-gradient(135deg, rgba(255,149,0,0.07)  0%, transparent 55%)",
            "linear-gradient(225deg, rgba(48,176,199,0.05) 0%, transparent 55%)",
            "linear-gradient(315deg, rgba(255,185,75,0.05) 0%, transparent 50%)",
            "linear-gradient(45deg,  rgba(0,122,255,0.03)  0%, transparent 45%)",
          ].join(", "),
        }}
      />

      {/* Dark mode mesh */}
      <div
        className="hidden dark:block"
        style={{
          position:   "absolute",
          inset:      0,
          background: [
            "linear-gradient(135deg, rgba(255,149,0,0.09)  0%, transparent 55%)",
            "linear-gradient(225deg, rgba(48,176,199,0.06) 0%, transparent 55%)",
            "linear-gradient(315deg, rgba(255,185,75,0.06) 0%, transparent 50%)",
            "linear-gradient(45deg,  rgba(0,122,255,0.04)  0%, transparent 45%)",
          ].join(", "),
        }}
      />

      {/* ── 2. Radial spotlight behind card ──────────────────────────────
          Centred ellipse that focuses perception on the card area.
          Static — no animation, no JS.
      ──────────────────────────────────────────────────────────────────── */}

      {/* Light mode: bright white bloom */}
      <div
        className="dark:hidden"
        style={{
          position:   "absolute",
          inset:      0,
          background:
            "radial-gradient(ellipse 88% 62% at 50% 40%, " +
            "rgba(255,255,255,0.72) 0%, " +
            "rgba(255,255,255,0.18) 45%, " +
            "transparent 70%)",
        }}
      />

      {/* Dark mode: amber-teal aurora glow */}
      <div
        className="hidden dark:block"
        style={{
          position:   "absolute",
          inset:      0,
          background:
            "radial-gradient(ellipse 82% 56% at 50% 38%, " +
            "rgba(255,149,0,0.08) 0%, " +
            "rgba(48,176,199,0.045) 42%, " +
            "transparent 72%)",
        }}
      />

      {/* ── 3. Floating blobs ────────────────────────────────────────────
          Colour orbs drifting along a mirrored keyframe path.
          Only x / y are animated → transform only → GPU composited.
          reduced-motion: no animate prop → static positions.
      ──────────────────────────────────────────────────────────────────── */}

      {BLOBS.map((blob, i) => (
        <motion.div
          key={i}
          style={{
            position:           "absolute",
            width:              blob.size,
            height:             blob.size,
            borderRadius:       "50%",
            background:         blob.color,
            filter:             `blur(${blob.blur}px)`,
            willChange:         "transform",
            backfaceVisibility: "hidden",
            ...blob.pos,
          }}
          animate={reduce ? undefined : { x: blob.kx, y: blob.ky }}
          transition={
            reduce
              ? { duration: 0 }
              : {
                  duration:   blob.dur,
                  repeat:     Infinity,
                  repeatType: "mirror",
                  ease:       "easeInOut",
                }
          }
        />
      ))}

      {/* ── 4. Noise grain ───────────────────────────────────────────────
          SVG feTurbulence generates film-grain. Rendered once by the
          browser's SVG engine — fully static, no per-frame cost.
          Two <rect>s share the same filter; opacity differs per mode.
      ──────────────────────────────────────────────────────────────────── */}

      <svg
        xmlns="http://www.w3.org/2000/svg"
        style={{
          position: "absolute",
          inset:    0,
          width:    "100%",
          height:   "100%",
        }}
      >
        <defs>
          <filter
            id="auth-bg-noise"
            x="0%"
            y="0%"
            width="100%"
            height="100%"
            colorInterpolationFilters="linearRGB"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.72"
              numOctaves="4"
              stitchTiles="stitch"
              result="noise"
            />
            {/* Desaturate so it's true grey grain, not coloured */}
            <feColorMatrix
              type="saturate"
              values="0"
              in="noise"
              result="greyNoise"
            />
          </filter>
        </defs>

        {/* Light mode grain — overlay blend, very low opacity */}
        <rect
          width="100%"
          height="100%"
          filter="url(#auth-bg-noise)"
          className="dark:hidden"
          style={{ mixBlendMode: "overlay", opacity: 0.038 }}
        />

        {/* Dark mode grain — soft-light blend, slightly higher opacity */}
        <rect
          width="100%"
          height="100%"
          filter="url(#auth-bg-noise)"
          className="hidden dark:block"
          style={{ mixBlendMode: "soft-light", opacity: 0.052 }}
        />
      </svg>

    </div>
  );
}
