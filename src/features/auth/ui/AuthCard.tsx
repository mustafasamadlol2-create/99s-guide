/**
 * AuthCard — glass-card shell shared by all auth screens.
 *
 * Extends motion.div so callers can pass layout, variants, initial,
 * animate, exit, transition, ref, id, role, aria-label, etc. directly.
 *
 * Visual contract
 *   • bg-[#F8F9FC] light / [#1C1C1E] dark (override via className)
 *   • med-beige / white-10 border
 *   • elevation-3 shadow  •  rounded-2xl sm:rounded-3xl
 *   • overflow-hidden  •  gpu-accelerate will-change layer
 *   • Responsive padding via the padding prop
 */

import React from "react";
import { motion } from "motion/react";

const PADDING = {
  none: "",
  sm:   "p-5 sm:p-8",
  md:   "p-6 sm:p-10",
  lg:   "p-6 sm:p-10 md:p-12 lg:p-16",
} as const;

export interface AuthCardProps
  extends React.ComponentProps<typeof motion.div> {
  /** Inner padding scale. Defaults to "md" */
  padding?: keyof typeof PADDING;
}

export function AuthCard({
  padding   = "md",
  className = "",
  style,
  children,
  ...motionProps
}: AuthCardProps) {
  return (
    <motion.div
      className={[
        "w-full",
        "bg-[#F8F9FC] dark:bg-[#1C1C1E]",
        "border border-med-beige/60 dark:border-white/[0.10]",
        "rounded-2xl sm:rounded-3xl",
        "shadow-elevation-3 overflow-hidden relative gpu-accelerate",
        PADDING[padding],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ willChange: "transform, opacity", ...style }}
      {...motionProps}
    >
      {children}
    </motion.div>
  );
}
