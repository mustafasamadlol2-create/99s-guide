/**
 * AuthDivider — horizontal rule with a centred label.
 *
 * Accepts an optional motionVariants prop so it can participate in the
 * STAGGER_V field-entrance animation without the caller needing to wrap
 * it in an extra motion.div.
 *
 *   <AuthDivider label="OR CONNECT WITH" motionVariants={FIELD_V} />
 *
 * The label span uses bg-inherit so it matches whatever card bg it sits on.
 */

import React from "react";
import { motion } from "motion/react";

interface AuthDividerProps {
  label?:          string;
  /** Framer-motion variants object (e.g. FIELD_V) for stagger integration */
  motionVariants?: Record<string, unknown>;
  className?:      string;
}

export function AuthDivider({
  label          = "OR",
  motionVariants,
  className      = "",
}: AuthDividerProps) {
  const inner = (
    <div className={`relative text-center ${className}`}>
      {/* Hairline rule */}
      <span className="h-px bg-med-beige/80 dark:bg-white/[0.08] w-full block absolute top-1/2 -translate-y-1/2" />
      {/* Label chip — inherits card bg so the rule appears broken behind it */}
      <span className="bg-inherit px-3 relative text-caption text-med-muted dark:text-[#EBEBF599] uppercase font-semibold">
        {label}
      </span>
    </div>
  );

  if (motionVariants) {
    return (
      <motion.div variants={motionVariants as any}>
        {inner}
      </motion.div>
    );
  }

  return inner;
}
