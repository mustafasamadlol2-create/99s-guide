/**
 * AuthAnimatedCheck — animated SVG checkmark shared by all auth success states.
 *
 * Sequence:
 *   1. Stroke circle draws via pathLength spring (0.56 s)
 *   2. Check path draws after 0.50 s delay (0.40 s)
 *
 * prefers-reduced-motion: both animations skip to final state instantly.
 * aria-hidden: always — parent element carries accessible role/label.
 */

import { memo } from "react";
import { motion, useReducedMotion } from "motion/react";

interface AuthAnimatedCheckProps {
  /** Diameter in px. Default 80. */
  size?: number;
}

export const AuthAnimatedCheck = memo(function AuthAnimatedCheck({
  size = 80,
}: AuthAnimatedCheckProps) {
  const reduce = !!useReducedMotion();

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* Soft inner fill */}
      <circle
        cx="40" cy="40" r="36"
        className="fill-emerald-500/[0.08] dark:fill-emerald-400/[0.07]"
      />

      {/* Stroke circle — draws via pathLength */}
      <motion.circle
        cx="40" cy="40" r="30"
        stroke="currentColor" strokeWidth="2.5" fill="none"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={reduce ? { duration: 0 } : {
          pathLength: { duration: 0.56, ease: [0.22, 1, 0.36, 1] },
          opacity:    { duration: 0.04 },
        }}
      />

      {/* Check path — draws after circle completes */}
      <motion.path
        d="M24 40.5L35.5 52 57 28"
        stroke="currentColor" strokeWidth="3.5"
        strokeLinecap="round" strokeLinejoin="round" fill="none"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={reduce ? { duration: 0 } : {
          pathLength: { duration: 0.40, delay: 0.50, ease: [0.22, 1, 0.36, 1] },
          opacity:    { duration: 0.01, delay: 0.50 },
        }}
      />
    </svg>
  );
});
