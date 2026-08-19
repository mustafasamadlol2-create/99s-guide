/**
 * AuthPasswordField — AnimatedField with a built-in show/hide toggle.
 *
 * Manages its own visibility state (uncontrolled by default).
 * All AnimatedField props are forwarded except `type` and `rightElement`
 * (both are provided by this wrapper).
 *
 * The toggle button is:
 *   • aria-label="Show / Hide <label>" — screenreader-friendly
 *   • aria-pressed — announces current visibility state
 *   • focus-visible ring matching the design system
 *   • prefers-reduced-motion safe scale via useReducedMotion
 */

import React, { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Eye, EyeOff } from "lucide-react";
import AnimatedField, { AnimatedFieldProps } from "../components/AnimatedField";
import { SP } from "../motionConfig";

export interface AuthPasswordFieldProps
  extends Omit<AnimatedFieldProps, "type" | "rightElement"> {
  /** Initial visibility (uncontrolled). Default: false */
  defaultShow?: boolean;
}

export function AuthPasswordField({
  label,
  defaultShow = false,
  ...rest
}: AuthPasswordFieldProps) {
  const reduce      = !!useReducedMotion();
  const [show, setShow] = useState(defaultShow);

  const toggleBtn = (
    <motion.button
      type="button"
      aria-label={show ? `Hide ${label}` : `Show ${label}`}
      aria-pressed={show}
      whileHover={reduce ? {} : { scale: 1.15 }}
      whileTap={reduce  ? {} : { scale: 0.88 }}
      transition={SP.tap}
      onClick={() => setShow((v) => !v)}
      className="text-med-sand hover:text-neutral-600 dark:hover:text-neutral-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 rounded"
    >
      {show
        ? <EyeOff aria-hidden="true" className="w-icon-sm h-icon-sm" />
        : <Eye    aria-hidden="true" className="w-icon-sm h-icon-sm" />}
    </motion.button>
  );

  return (
    <AnimatedField
      label={label}
      type={show ? "text" : "password"}
      rightElement={toggleBtn}
      {...rest}
    />
  );
}
