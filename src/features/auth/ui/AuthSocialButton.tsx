/**
 * AuthSocialButton — animated OAuth / social-login button.
 *
 * Statuses
 *   idle     — shows brand icon + label; interactive
 *   loading  — shows spinner; disabled
 *   success  — shows animated checkmark; green tint; temporarily disabled
 *   error    — shows × mark; red tint; plays horizontal shake; briefly interactive
 *
 * Extracted from the inline SocialButton memo in AuthScreen so it can be
 * reused by any future social-auth surface without re-implementing the
 * status animation logic.
 */

import React, { memo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { SP } from "../motionConfig";
import { AuthSpinner } from "./AuthSpinner";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SocialStatus = "idle" | "loading" | "success" | "error";

export interface AuthSocialButtonProps {
  id?:         string;
  label:       string;
  icon:        React.ReactNode;
  onClick:     () => void;
  status?:     SocialStatus;
  anyLoading?: boolean;
}

// ─── Micro-icons ──────────────────────────────────────────────────────────────

const CheckIcon = ({ reduce }: { reduce: boolean }) => (
  <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" aria-hidden>
    <motion.path
      d="M4 10.5l4 4L16 6"
      stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round"
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={reduce ? { duration: 0 } : { duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
    />
  </svg>
);

const XIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
  </svg>
);

// ─── Component ────────────────────────────────────────────────────────────────

export const AuthSocialButton = memo(function AuthSocialButton({
  id,
  label,
  icon,
  onClick,
  status     = "idle",
  anyLoading = false,
}: AuthSocialButtonProps) {
  const reduce      = !!useReducedMotion();
  const interactive = status === "idle" && !anyLoading;

  const statusLabel =
    status === "loading" ? "Connecting…" :
    status === "success" ? "Connected!"  :
    status === "error"   ? "Try again"   : label;

  return (
    <motion.button
      id={id}
      type="button"
      aria-label={label}
      aria-busy={status === "loading"}
      aria-disabled={!interactive}
      disabled={!interactive}
      onClick={interactive ? onClick : undefined}
      whileHover={reduce || !interactive ? {} : { y: -2.5, scale: 1.012 }}
      whileTap={reduce   || !interactive ? {} : { scale: 0.974, y: 0   }}
      animate={
        status === "error" && !reduce
          ? { x: [0, -8, 8, -5, 5, -2, 2, 0] }
          : { x: 0 }
      }
      transition={
        status === "error" ? { duration: 0.40, ease: "easeOut" } : SP.tap
      }
      className={[
        // layout
        "relative w-full flex items-center justify-center gap-3 px-5 min-h-[52px]",
        "rounded-[14px] border outline-none select-none",
        // base colours
        "bg-white dark:bg-[#1C1C1E]",
        // border
        status === "success"
          ? "border-emerald-400/60 dark:border-emerald-400/35"
          : status === "error"
          ? "border-red-400/60 dark:border-red-400/35"
          : "border-neutral-200/90 dark:border-white/[0.10]",
        // status tint
        status === "success" ? "bg-emerald-50/50 dark:bg-emerald-950/20" : "",
        status === "error"   ? "bg-red-50/50 dark:bg-red-950/20"         : "",
        // shadows
        "shadow-[0_2px_8px_rgba(0,0,0,0.06),_0_1px_3px_rgba(0,0,0,0.04)]",
        "dark:shadow-[0_2px_8px_rgba(0,0,0,0.32),_0_1px_3px_rgba(0,0,0,0.20)]",
        interactive
          ? "hover:shadow-[0_8px_24px_rgba(0,0,0,0.10),_0_2px_8px_rgba(0,0,0,0.06)] dark:hover:shadow-[0_8px_24px_rgba(0,0,0,0.44),_0_2px_8px_rgba(0,0,0,0.28)] hover:border-neutral-300/80 dark:hover:border-white/[0.18]"
          : "cursor-not-allowed",
        "transition-[border-color,background-color,box-shadow] duration-200",
        // focus ring
        "focus-visible:ring-[3.5px] focus-visible:ring-amber-400/40 dark:focus-visible:ring-amber-400/30",
        "focus-visible:border-amber-400/55 dark:focus-visible:border-amber-400/45 focus-visible:outline-none",
        // opacity
        !interactive && status !== "error" && status !== "success" ? "opacity-70" : "",
      ].join(" ")}
    >
      {/* Icon / status icon */}
      <span className="w-5 h-5 shrink-0 flex items-center justify-center">
        <AnimatePresence mode="wait" initial={false}>
          {status === "loading" ? (
            <motion.span key="spinner"
              initial={{ opacity: 0, scale: 0.55, rotate: -30 }}
              animate={{ opacity: 1, scale: 1,    rotate:   0 }}
              exit={{    opacity: 0, scale: 0.55 }}
              transition={reduce ? { duration: 0 } : SP.snappy}
              className="flex items-center justify-center text-neutral-400 dark:text-neutral-500"
            >
              <AuthSpinner size="sm" />
            </motion.span>
          ) : status === "success" ? (
            <motion.span key="check"
              initial={{ opacity: 0, scale: 0.40 }}
              animate={{ opacity: 1, scale: 1    }}
              exit={{    opacity: 0, scale: 0.55 }}
              transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 26, mass: 0.45 }}
              className="text-emerald-500 dark:text-emerald-400"
            >
              <CheckIcon reduce={reduce} />
            </motion.span>
          ) : status === "error" ? (
            <motion.span key="xmark"
              initial={{ opacity: 0, scale: 0.40 }}
              animate={{ opacity: 1, scale: 1    }}
              exit={{    opacity: 0, scale: 0.55 }}
              transition={reduce ? { duration: 0 } : SP.snappy}
              className="text-red-500 dark:text-red-400"
            >
              <XIcon />
            </motion.span>
          ) : (
            <motion.span key="brand-icon"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{    opacity: 0 }}
              transition={reduce ? { duration: 0 } : { duration: 0.14 }}
            >
              {icon}
            </motion.span>
          )}
        </AnimatePresence>
      </span>

      {/* Label */}
      <span className={[
        "font-semibold text-[15px] tracking-[-0.01em]",
        status === "success" ? "text-emerald-700 dark:text-emerald-400" :
        status === "error"   ? "text-red-600    dark:text-red-400"      :
                               "text-neutral-800 dark:text-neutral-100",
        "transition-colors duration-200",
      ].join(" ")}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={status}
            initial={{ opacity: 0, y:  5 }}
            animate={{ opacity: 1, y:  0 }}
            exit={{    opacity: 0, y: -5 }}
            transition={reduce ? { duration: 0 } : { duration: 0.13, ease: "easeOut" }}
            className="block"
          >
            {statusLabel}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.button>
  );
});
