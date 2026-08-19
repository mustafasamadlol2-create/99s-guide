/**
 * AuthValidation — password strength indicator and rule checklist.
 *
 * Shows a visual strength bar and an ordered list of validation rules,
 * each with a pass/fail indicator that animates in as the user types.
 *
 * Usage
 *   <AuthValidation value={password} />
 *   <AuthValidation value={password} rules={MY_RULES} showStrengthBar={false} />
 *
 * Exports
 *   AuthValidation     — main component
 *   DEFAULT_RULES      — built-in rule set (length, uppercase, number)
 *   ValidationRule     — rule shape for custom rule arrays
 *   getPasswordStrength — pure helper: "weak" | "fair" | "strong"
 */

import React from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { CheckCircle, Circle } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ValidationRule {
  id:    string;
  label: string;
  test:  (value: string) => boolean;
}

export interface AuthValidationProps {
  value:            string;
  rules?:           ValidationRule[];
  showStrengthBar?: boolean;
  className?:       string;
}

// ─── Default rule set ─────────────────────────────────────────────────────────

export const DEFAULT_RULES: ValidationRule[] = [
  {
    id:    "length",
    label: "At least 8 characters",
    test:  (v) => v.length >= 8,
  },
  {
    id:    "upper",
    label: "At least one uppercase letter",
    test:  (v) => /[A-Z]/.test(v),
  },
  {
    id:    "number",
    label: "At least one number",
    test:  (v) => /\d/.test(v),
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getPasswordStrength(
  value: string,
  rules: ValidationRule[] = DEFAULT_RULES,
): "empty" | "weak" | "fair" | "strong" {
  if (!value) return "empty";
  const passed = rules.filter((r) => r.test(value)).length;
  if (passed === 0)             return "weak";
  if (passed < rules.length)   return "fair";
  return "strong";
}

const STRENGTH_CONFIG = {
  empty:  { width: "0%",   color: "bg-neutral-300 dark:bg-white/10",          label: ""        },
  weak:   { width: "33%",  color: "bg-red-400 dark:bg-red-500",               label: "Weak"    },
  fair:   { width: "66%",  color: "bg-amber-400 dark:bg-amber-400",            label: "Fair"    },
  strong: { width: "100%", color: "bg-emerald-500 dark:bg-emerald-400",        label: "Strong"  },
} as const;

// ─── Component ────────────────────────────────────────────────────────────────

export function AuthValidation({
  value,
  rules           = DEFAULT_RULES,
  showStrengthBar = true,
  className       = "",
}: AuthValidationProps) {
  const reduce   = !!useReducedMotion();
  const strength = getPasswordStrength(value, rules);
  const cfg      = STRENGTH_CONFIG[strength];

  if (!value) return null;

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Strength bar */}
      {showStrengthBar && (
        <div className="space-y-1">
          <div className="h-1.5 w-full bg-neutral-100 dark:bg-white/[0.06] rounded-full overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${cfg.color}`}
              initial={false}
              animate={{ width: cfg.width }}
              transition={reduce ? { duration: 0 } : { duration: 0.35, ease: "easeOut" }}
            />
          </div>
          <AnimatePresence mode="wait" initial={false}>
            {strength !== "empty" && (
              <motion.p
                key={strength}
                initial={{ opacity: 0, y: 4  }}
                animate={{ opacity: 1, y: 0  }}
                exit={{    opacity: 0, y: -4 }}
                transition={reduce ? { duration: 0 } : { duration: 0.15 }}
                className={`text-[11px] font-semibold ${
                  strength === "strong" ? "text-emerald-600 dark:text-emerald-400" :
                  strength === "fair"   ? "text-amber-600  dark:text-amber-400"   :
                                          "text-red-600     dark:text-red-400"
                }`}
              >
                {cfg.label}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Rule checklist */}
      <ul className="space-y-1" aria-label="Password requirements">
        {rules.map((rule) => {
          const passed = rule.test(value);
          return (
            <li key={rule.id} className="flex items-center gap-1.5 text-[11px]">
              <AnimatePresence mode="wait" initial={false}>
                {passed ? (
                  <motion.span
                    key="pass"
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1,   opacity: 1 }}
                    exit={{    scale: 0.4, opacity: 0 }}
                    transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 26 }}
                    className="text-emerald-500 dark:text-emerald-400 shrink-0"
                  >
                    <CheckCircle aria-hidden className="w-3.5 h-3.5" />
                  </motion.span>
                ) : (
                  <motion.span
                    key="fail"
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1,   opacity: 1 }}
                    exit={{    scale: 0.4, opacity: 0 }}
                    transition={reduce ? { duration: 0 } : { duration: 0.12 }}
                    className="text-neutral-300 dark:text-white/20 shrink-0"
                  >
                    <Circle aria-hidden className="w-3.5 h-3.5" />
                  </motion.span>
                )}
              </AnimatePresence>
              <span className={passed
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-neutral-400 dark:text-white/40"
              }>
                {rule.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
