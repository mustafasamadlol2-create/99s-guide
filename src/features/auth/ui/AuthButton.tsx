/**
 * AuthButton — motion-aware multi-variant button for the auth design system.
 *
 * Variants
 *   primary    filled dark/gold, uppercase, elevation shadow
 *   secondary  border-only, no fill
 *   ghost      text-only, colour shifts on hover (nav links, cancel buttons)
 *   link       text-only, underlines on hover (inline text links)
 *
 * All variants
 *   • isLoading — morphs content to spinner + loadingLabel via AnimatePresence
 *   • aria-busy set automatically while loading
 *   • focus-visible rings matching the design system gold/blue palette
 *   • Scale hover/tap via spring (prefers-reduced-motion safe — no animation at all)
 *   • All native button + motion.button props forwarded
 */

import React from "react";
import {
  motion, AnimatePresence, useReducedMotion,
} from "motion/react";
import { SP } from "../motionConfig";
import { AuthSpinner } from "./AuthSpinner";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuthButtonVariant = "primary" | "secondary" | "ghost" | "link";
export type AuthButtonSize    = "sm" | "md" | "lg";

export interface AuthButtonProps
  extends Omit<React.ComponentProps<typeof motion.button>, "children"> {
  variant?:      AuthButtonVariant;
  size?:         AuthButtonSize;
  isLoading?:    boolean;
  /** Text shown next to spinner while isLoading (sr-only also reads it) */
  loadingLabel?: string;
  /** Icon rendered before children in the idle state */
  leftIcon?:     React.ReactNode;
  /** Icon rendered after children in the idle state */
  rightIcon?:    React.ReactNode;
  fullWidth?:    boolean;
  children?:     React.ReactNode;
}

// ─── Class maps ───────────────────────────────────────────────────────────────

const BASE =
  "relative inline-flex items-center justify-center gap-2 font-semibold " +
  "transition-colors duration-200 select-none cursor-pointer focus-visible:outline-none";

const VARIANT: Record<AuthButtonVariant, string> = {
  primary: [
    "bg-med-dark dark:bg-med-gold",
    "hover:bg-neutral-800 dark:hover:bg-amber-400",
    "text-[#D5C7B5] dark:text-black",
    "rounded-xl shadow-elevation-1",
    "uppercase tracking-wide",
    "focus-visible:ring-[3px] focus-visible:ring-amber-400/60",
  ].join(" "),

  secondary: [
    "border border-med-beige/70 dark:border-white/15",
    "text-neutral-700 dark:text-white",
    "hover:bg-med-bg dark:hover:bg-white/[0.06]",
    "rounded-xl",
    "focus-visible:ring-[3px] focus-visible:ring-amber-400/60",
  ].join(" "),

  ghost: [
    "text-secondary-label hover:text-med-blue",
    "dark:text-[#EBEBF599] dark:hover:text-amber-400",
    "rounded-sm px-1",
    "focus-visible:ring-2 focus-visible:ring-med-blue dark:focus-visible:ring-amber-400",
  ].join(" "),

  link: [
    "text-med-blue dark:text-amber-400",
    "hover:underline",
    "rounded-sm px-0.5",
    "focus-visible:ring-2 focus-visible:ring-med-blue dark:focus-visible:ring-amber-400",
  ].join(" "),
};

const SIZE: Record<AuthButtonSize, string> = {
  sm: "py-2 px-4 text-sm   min-h-[40px]",
  md: "py-3       text-caption min-h-[48px]",
  lg: "py-3.5     text-body    min-h-[52px]",
};

const HOVER_SCALE: Record<AuthButtonVariant, number> = {
  primary:   1.015,
  secondary: 1.020,
  ghost:     1.030,
  link:      1.030,
};

const TAP_SCALE: Record<AuthButtonVariant, number> = {
  primary:   0.985,
  secondary: 0.980,
  ghost:     0.970,
  link:      0.970,
};

// ─── Component ────────────────────────────────────────────────────────────────

export function AuthButton({
  variant      = "primary",
  size         = "md",
  isLoading    = false,
  loadingLabel,
  leftIcon,
  rightIcon,
  fullWidth    = false,
  children,
  className    = "",
  disabled,
  ...rest
}: AuthButtonProps) {
  const reduce     = !!useReducedMotion();
  const isDisabled = disabled || isLoading;
  const hasSizing  = variant === "primary" || variant === "secondary";

  return (
    <motion.button
      {...rest}
      disabled={isDisabled}
      aria-busy={isLoading || undefined}
      whileHover={reduce || isDisabled ? {} : { scale: HOVER_SCALE[variant] }}
      whileTap={reduce   || isDisabled ? {} : { scale: TAP_SCALE[variant]   }}
      transition={SP.tap}
      className={[
        BASE,
        VARIANT[variant],
        hasSizing ? SIZE[size] : "",
        fullWidth ? "w-full" : "",
        isDisabled && hasSizing ? "opacity-70 cursor-not-allowed" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <AnimatePresence mode="wait" initial={false}>
        {isLoading ? (
          <motion.span
            key="loading"
            initial={{ opacity: 0, y:  4 }}
            animate={{ opacity: 1, y:  0 }}
            exit={{    opacity: 0, y: -4 }}
            transition={reduce ? { duration: 0 } : { duration: 0.1 }}
            className="flex items-center gap-2"
          >
            <AuthSpinner />
            {loadingLabel && <span>{loadingLabel}</span>}
          </motion.span>
        ) : (
          <motion.span
            key="idle"
            initial={{ opacity: 0, y:  4 }}
            animate={{ opacity: 1, y:  0 }}
            exit={{    opacity: 0, y: -4 }}
            transition={reduce ? { duration: 0 } : { duration: 0.1 }}
            className="flex items-center gap-2"
          >
            {leftIcon  && <span aria-hidden="true" className="shrink-0">{leftIcon}</span>}
            {children}
            {rightIcon && <span aria-hidden="true" className="shrink-0">{rightIcon}</span>}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
