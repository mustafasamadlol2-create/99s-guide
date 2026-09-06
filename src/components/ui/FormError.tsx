/**
 * FormError — universal animated inline error component.
 *
 * Features
 *   • AnimatePresence fade + slide-down entrance / exit
 *   • Horizontal shake triggered whenever shakeKey increments
 *   • Glass-like bg, left-border accent, lucide AlertCircle icon
 *   • role="alert" aria-live="assertive" — announced immediately to screen readers
 *   • Optional dismiss (×) button via onDismiss prop
 *   • prefers-reduced-motion respected throughout
 *
 * Usage
 *   <FormError message={error} />
 *   <FormError message={error} shakeKey={shakeCount} onDismiss={() => setError("")} />
 */

import React, { useRef, useEffect, memo } from "react";
import { motion, AnimatePresence, useReducedMotion, animate } from "motion/react";
import { AlertCircle, X } from "lucide-react";

interface FormErrorProps {
  message?:   string | null;
  /** Increment to trigger a horizontal shake (even when error text is unchanged). */
  shakeKey?:  number;
  /** Render a dismiss (×) button; called when user clicks it. */
  onDismiss?: () => void;
  className?: string;
}

const SLIDE_V = {
  hidden:  { opacity: 0, y: -8, scaleY: 0.88, originY: 0 },
  visible: { opacity: 1, y: 0,  scaleY: 1                },
  exit:    { opacity: 0, y: -6, scaleY: 0.88, originY: 0 },
} as const;

const SPRING = {
  type:      "spring" as const,
  stiffness: 500,
  damping:   38,
  mass:      0.7,
};

export const FormError = memo(function FormError({
  message,
  shakeKey  = 0,
  onDismiss,
  className = "",
}: FormErrorProps) {
  const reduce = !!useReducedMotion();
  const ref    = useRef<HTMLDivElement>(null);

  /* Shake whenever shakeKey increments (e.g. user re-submits same invalid form). */
  useEffect(() => {
    if (shakeKey > 0 && !reduce && ref.current) {
      const id = setTimeout(() => {
        if (ref.current) {
          animate(ref.current, { x: [0, -9, 9, -6, 6, -3, 3, 0] }, { duration: 0.38 });
        }
      }, 60);
      return () => clearTimeout(id);
    }
  }, [shakeKey, reduce]);

  return (
    <AnimatePresence>
      {!!message && (
        <motion.div
          ref={ref}
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          variants={reduce ? undefined : SLIDE_V}
          initial={reduce ? false : "hidden"}
          animate="visible"
          exit="exit"
          transition={SPRING}
          style={{ willChange: "transform, opacity" }}
          className={className}
        >
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-red-50/50 dark:bg-red-950/20 border border-red-200/60 dark:border-red-900/30">
            <AlertCircle
              aria-hidden="true"
              className="w-4 h-4 shrink-0 text-red-500 dark:text-red-400"
            />
            <span className="flex-1 text-sm font-medium text-red-600 dark:text-red-400 leading-snug">
              {message}
            </span>
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss error"
                className="shrink-0 ml-1 p-0.5 rounded text-red-400/70 dark:text-red-500/70 hover:text-red-600 dark:hover:text-red-300 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
