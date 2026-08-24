/**
 * AuthErrorMessage — animated, accessible error alert for auth screens.
 *
 * Features
 *   • AnimatePresence fade+scale entrance / exit (ERROR_V variant)
 *   • Horizontal shake triggered whenever shakeKey increments
 *     (parent calls showError() → increments shakeKey → this shakes)
 *   • Premium glass-like background with left border accent
 *   • role="alert" aria-live="assertive" — immediately announced to screen readers
 *   • AlertCircle icon is aria-hidden (decorative)
 *   • prefers-reduced-motion: skips all animations
 *
 * Usage
 *   const [shakeKey, setShakeKey] = useState(0);
 *   const showError = (msg) => { setError(msg); if (msg) setShakeKey(k => k + 1); };
 *
 *   <AuthErrorMessage error={error} shakeKey={shakeKey} />
 */

import React, { useRef, useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion, animate } from "motion/react";
import { AlertCircle } from "lucide-react";
import { ERROR_V, SP } from "../motionConfig";

interface AuthErrorMessageProps {
  error?:     string | null;
  /** Increment to trigger a horizontal shake (even if error text is unchanged) */
  shakeKey?:  number;
  className?: string;
}

export function AuthErrorMessage({
  error,
  shakeKey  = 0,
  className = "",
}: AuthErrorMessageProps) {
  const reduce   = !!useReducedMotion();
  const innerRef = useRef<HTMLDivElement>(null);

  // Shake whenever shakeKey increases (parent called showError)
  useEffect(() => {
    if (shakeKey > 0 && !reduce && innerRef.current) {
      const id = setTimeout(() => {
        if (innerRef.current) {
          animate(
            innerRef.current,
            { x: [0, -9, 9, -6, 6, -3, 3, 0] },
            { duration: 0.38 },
          );
        }
      }, 60);
      return () => clearTimeout(id);
    }
  }, [shakeKey, reduce]);

  return (
    <AnimatePresence>
      {!!error && (
        <motion.div
          ref={innerRef}
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          variants={reduce ? undefined : ERROR_V}
          initial={reduce ? false : "hidden"}
          animate="visible"
          exit="exit"
          transition={SP.snappy}
          className={className}
          style={{ willChange: "transform, opacity", originY: 0 }}
        >
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-red-50/50 dark:bg-red-950/20 border border-red-200/60 dark:border-red-900/30">
            <AlertCircle
              aria-hidden="true"
              className="w-4 h-4 shrink-0 text-red-500 dark:text-red-400"
            />
            <span className="text-sm font-medium text-red-600 dark:text-red-400 leading-snug">
              {error}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
