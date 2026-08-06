/**
 * AuthSuccessMessage — animated success-state container.
 *
 * Provides the standard SUCCESS_V entrance / exit animation and the
 * accessible role="status" / aria-live="polite" semantics.  Inner
 * content (icon, heading, description, CTA buttons) is entirely up
 * to the caller via children — keeping the component generic enough
 * for login success, password-sent, register-complete, etc.
 *
 * Usage
 *   <AuthSuccessMessage aria-label="Password reset sent">
 *     <AnimatedCheck size={80} reduce={reduce} />
 *     <h3>Check your inbox</h3>
 *     <p>A recovery link was sent to {email}.</p>
 *   </AuthSuccessMessage>
 */

import React from "react";
import { motion, useReducedMotion } from "motion/react";
import { SUCCESS_V, SP } from "../motionConfig";

export interface AuthSuccessMessageProps
  extends Omit<React.ComponentProps<typeof motion.div>, "children"> {
  children:   React.ReactNode;
  className?: string;
}

export function AuthSuccessMessage({
  children,
  className = "",
  ...motionProps
}: AuthSuccessMessageProps) {
  const reduce = !!useReducedMotion();

  return (
    <motion.div
      role="status"
      aria-live="polite"
      tabIndex={-1}
      variants={reduce ? undefined : SUCCESS_V}
      initial={reduce ? false : "hidden"}
      animate="visible"
      exit="exit"
      transition={SP.gentle}
      className={`text-center py-6 focus:outline-none ${className}`}
      {...motionProps}
    >
      {children}
    </motion.div>
  );
}
