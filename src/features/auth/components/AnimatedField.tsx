/**
 * AnimatedField — complete 10-state input system.
 *
 * States: idle | hover | focused | typing | filled | valid | invalid | disabled | loading | autofilled
 *
 * Design principles:
 *  - Apple Human Interface Guidelines — motion, spacing, contrast, keyboard nav
 *  - WCAG 2.1 AA — 4.5:1 text contrast, 3:1 UI-element contrast, visible focus ring
 *  - All state transitions via spring physics (motion/react) — zero abrupt changes
 *  - Autofill detected via CSS animation event (no browser-yellow flash)
 *  - prefers-reduced-motion fully respected throughout
 *  - Full keyboard navigation; aria-invalid, aria-describedby, aria-required, aria-busy
 */

import React, {
  useState, useRef, useCallback, useEffect, forwardRef, useId,
} from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { SP } from "../motionConfig";
import { useDarkMode, TOKENS, WRAP_SPRING, COLOR_TWEEN } from "./fieldTokens";

// ─── Types ────────────────────────────────────────────────────────────────────

type FieldState =
  | "idle" | "hover" | "focused" | "typing" | "filled"
  | "valid" | "invalid" | "disabled" | "loading" | "autofilled";

export interface AnimatedFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Element rendered to the right of the label (e.g. "Forgot Password?" link) */
  labelRight?: React.ReactNode;
  icon?: React.ReactNode;
  rightElement?: React.ReactNode;
  /** Motion stagger variants from parent */
  motionVariants?: Record<string, unknown>;
  /** Validation state — drives border/glow/icon colour */
  validationState?: "idle" | "valid" | "invalid";
  /** Error message shown below field when validationState === "invalid" */
  errorMessage?: string;
  /** Helper text shown below field in idle / focused states */
  hint?: string;
  /** Puts field in loading state — shows spinner, blocks interaction */
  loading?: boolean;
}

/** Sub-field messages slide in */
const MSG_SPRING  = { type: "spring", stiffness: 420, damping: 36, mass: 0.55 } as const;

// ─── State derivation ─────────────────────────────────────────────────────────

function deriveState({
  disabled, loading, validationState, focused, hovered, hasValue, autofilled,
}: {
  disabled: boolean;
  loading: boolean;
  validationState: "idle" | "valid" | "invalid";
  focused: boolean;
  hovered: boolean;
  hasValue: boolean;
  autofilled: boolean;
}): FieldState {
  if (disabled)                       return "disabled";
  if (loading)                        return "loading";
  if (validationState === "invalid")  return "invalid";
  if (focused) {
    if (validationState === "valid")  return "valid";   // keep green feedback while editing
    return hasValue ? "typing" : "focused";
  }
  if (validationState === "valid")    return "valid";
  if (autofilled)                     return "autofilled";
  if (hasValue)                       return "filled";
  if (hovered)                        return "hover";
  return "idle";
}

// ─── Component ────────────────────────────────────────────────────────────────

const AnimatedField = forwardRef<HTMLInputElement, AnimatedFieldProps>(
  (
    {
      label, labelRight, icon, rightElement, motionVariants,
      validationState = "idle",
      errorMessage, hint,
      loading = false,
      onFocus, onBlur, onChange,
      style, disabled, value, defaultValue,
      id: idProp, required,
      ...rest
    },
    ref,
  ) => {
    const uid     = useId();
    const fieldId = idProp ?? `af-${uid}`;
    const errorId = `${fieldId}-err`;
    const hintId  = `${fieldId}-hint`;
    const reduce  = !!useReducedMotion();
    const dark    = useDarkMode();

    // ── Local interaction state ──
    const [focused,    setFocused]    = useState(false);
    const [hovered,    setHovered]    = useState(false);
    const [autofilled, setAutofilled] = useState(false);
    const [hasValue,   setHasValue]   = useState(
      () => String(value ?? defaultValue ?? "").length > 0,
    );

    // Sync with controlled value
    useEffect(() => {
      if (value !== undefined) setHasValue(String(value).length > 0);
    }, [value]);

    // ── Derive effective state ──
    const effectiveState = deriveState({
      disabled:        !!disabled,
      loading,
      validationState,
      focused,
      hovered,
      hasValue,
      autofilled,
    });

    const palette = dark ? TOKENS.dark : TOKENS.light;
    const tok = {
      border: palette.border[effectiveState],
      shadow: palette.shadow[effectiveState],
      bg:     palette.bg[effectiveState],
      label:  palette.label[effectiveState],
      icon:   palette.icon[effectiveState],
    };

    // ── Autofill detection via CSS animation event ──
    const handleAnimationStart = useCallback((e: React.AnimationEvent) => {
      if (e.animationName === "af-detect-start")  setAutofilled(true);
      if (e.animationName === "af-detect-cancel") setAutofilled(false);
    }, []);

    // ── Shake on invalid transition ──
    const wrapRef    = useRef<HTMLDivElement>(null);
    const prevState  = useRef<FieldState>("idle");

    useEffect(() => {
      const el = wrapRef.current;
      if (!reduce && effectiveState === "invalid" && prevState.current !== "invalid" && el) {
        el.classList.remove("af-shake");
        void el.offsetWidth; // reflow to restart animation
        el.classList.add("af-shake");
        const onEnd = () => el.classList.remove("af-shake");
        el.addEventListener("animationend", onEnd, { once: true });
      }
      prevState.current = effectiveState;
    }, [effectiveState, reduce]);

    // ── Trailing slot — priority: loading > valid checkmark > rightElement ──
    const showValidCheck = validationState === "valid" && !focused;
    const hasTrailing    = loading || showValidCheck || !!rightElement;

    const trailingContent = loading ? (
      <motion.span
        key="loader"
        initial={{ opacity: 0, scale: 0.6, rotate: -30 }}
        animate={{ opacity: 1, scale: 1,   rotate: 0   }}
        exit={{    opacity: 0, scale: 0.6, rotate: 30  }}
        transition={WRAP_SPRING}
        className="flex items-center justify-center"
        style={{ color: tok.icon }}
        aria-label="Loading"
      >
        <Loader2 className="w-[18px] h-[18px] animate-spin" />
      </motion.span>
    ) : showValidCheck ? (
      <motion.span
        key="valid"
        initial={{ opacity: 0, scale: 0.4 }}
        animate={{ opacity: 1, scale: 1   }}
        exit={{    opacity: 0, scale: 0.4 }}
        transition={{ type: "spring", stiffness: 520, damping: 30 }}
        className="flex items-center justify-center"
        style={{ color: tok.icon }}
        aria-label="Valid"
      >
        <CheckCircle className="w-[18px] h-[18px]" />
      </motion.span>
    ) : rightElement ? (
      <motion.span
        key="custom"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{    opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="flex items-center justify-center"
      >
        {rightElement}
      </motion.span>
    ) : null;

    // ── ARIA describedby ──
    const describedBy = [
      validationState === "invalid" && errorMessage ? errorId : null,
      hint ? hintId : null,
    ].filter(Boolean).join(" ") || undefined;

    return (
      <motion.div variants={motionVariants as any} className="flex flex-col">

        {/* ── Label row ── */}
        {(label || labelRight) && (
          <div className="flex items-center justify-between mb-1.5">
            {label && (
              <motion.label
                htmlFor={fieldId}
                animate={{ color: tok.label }}
                transition={reduce ? { duration: 0 } : COLOR_TWEEN}
                style={{ color: tok.label }}
                className="block text-subhead font-semibold uppercase select-none cursor-default"
              >
                {label}
                {required && (
                  <motion.span
                    aria-hidden="true"
                    animate={{ color: validationState === "invalid" ? palette.label.invalid : palette.icon.focused }}
                    transition={reduce ? { duration: 0 } : COLOR_TWEEN}
                    className="ml-0.5 font-bold"
                  >
                    {" "}·
                  </motion.span>
                )}
              </motion.label>
            )}
            {labelRight && (
              <div className="shrink-0">{labelRight}</div>
            )}
          </div>
        )}

        {/* ── Input wrapper ── */}
        <motion.div
          ref={wrapRef}
          animate={reduce ? undefined : {
            borderColor:     tok.border,
            boxShadow:       tok.shadow,
            backgroundColor: tok.bg,
            opacity: effectiveState === "disabled" ? 0.46 : 1,
          }}
          transition={reduce ? { duration: 0 } : WRAP_SPRING}
          onHoverStart={() => !disabled && !loading && setHovered(true)}
          onHoverEnd={()   => setHovered(false)}
          style={{
            borderColor:     tok.border,
            boxShadow:       tok.shadow,
            backgroundColor: tok.bg,
            opacity: effectiveState === "disabled" ? 0.46 : 1,
            cursor:  effectiveState === "disabled" ? "not-allowed" : "text",
          }}
          className="relative rounded-xl border overflow-hidden"
        >

          {/* Leading icon */}
          {icon && (
            <motion.div
              aria-hidden="true"
              animate={{ color: tok.icon }}
              transition={reduce ? { duration: 0 } : COLOR_TWEEN}
              style={{ color: tok.icon }}
              className="absolute left-4 top-1/2 z-10 -translate-y-1/2 pointer-events-none flex items-center justify-center"
            >
              {icon}
            </motion.div>
          )}

          {/* Input */}
          <input
            ref={ref}
            id={fieldId}
            required={required}
            disabled={disabled || loading}
            value={value}
            defaultValue={defaultValue}
            aria-invalid={validationState === "invalid" ? "true" : undefined}
            aria-describedby={describedBy}
            aria-required={required}
            aria-busy={loading ? "true" : undefined}
            aria-disabled={disabled || loading ? "true" : undefined}
            onAnimationStart={handleAnimationStart}
            onFocus={(e)  => {
              setFocused(true);
              setHovered(false);
              onFocus?.(e);
            }}
            onBlur={(e)   => {
              setFocused(false);
              onBlur?.(e);
            }}
            onChange={(e) => {
              setHasValue(e.target.value.length > 0);
              onChange?.(e);
            }}
            style={{
              paddingLeft:  icon         ? "48px" : "16px",
              paddingRight: hasTrailing  ? "48px" : "16px",
              cursor: (disabled || loading) ? "not-allowed" : "text",
              ...style,
            }}
            className={[
               "relative z-0 w-full py-3 text-body bg-transparent outline-none font-medium text-left",
              "text-neutral-800 dark:text-white",
              "placeholder:text-neutral-400 dark:placeholder:text-[rgba(235,235,245,0.35)]",
              "disabled:cursor-not-allowed",
              // Focus ring handled by wrapper; suppress browser default
              "focus:outline-none focus-visible:outline-none",
            ].join(" ")}
            {...rest}
          />

          {/* Trailing slot */}
          {hasTrailing && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center">
              <AnimatePresence mode="wait" initial={false}>
                {trailingContent}
              </AnimatePresence>
            </div>
          )}

          {/* Autofill ambient overlay — tints bg without browser yellow */}
          <AnimatePresence>
            {autofilled && (
              <motion.div
                key="af-tint"
                aria-hidden="true"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{    opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="absolute inset-0 pointer-events-none rounded-xl"
                style={{
                  background: dark
                    ? "rgba(251,191,36,0.05)"
                    : "rgba(245,158,11,0.06)",
                }}
              />
            )}
          </AnimatePresence>
        </motion.div>

        {/* ── Below-field messages (error / hint) ── */}
        <AnimatePresence mode="wait" initial={false}>

          {validationState === "invalid" && errorMessage ? (
            <motion.p
              key="error-msg"
              id={errorId}
              role="alert"
              aria-live="assertive"
              initial={{ opacity: 0, y: -6, height: 0,    marginTop: 0 }}
              animate={{ opacity: 1, y: 0,  height: "auto", marginTop: 6 }}
              exit={{    opacity: 0, y: -4, height: 0,    marginTop: 0 }}
              transition={reduce ? { duration: 0 } : MSG_SPRING}
              className="flex items-start gap-1.5 text-caption font-medium overflow-hidden"
              style={{ color: palette.label.invalid }}
            >
              <AlertCircle
                className="w-3.5 h-3.5 shrink-0 mt-[1px]"
                aria-hidden="true"
              />
              <span>{errorMessage}</span>
            </motion.p>

          ) : hint ? (
            <motion.p
              key="hint-msg"
              id={hintId}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0  }}
              exit={{    opacity: 0, y: -4  }}
              transition={reduce ? { duration: 0 } : { type: "tween", duration: 0.2 }}
              className="mt-1.5 text-caption leading-snug"
              style={{ color: dark ? "rgba(235,235,245,0.44)" : "#8e8e93" }}
            >
              {hint}
            </motion.p>
          ) : null}

        </AnimatePresence>
      </motion.div>
    );
  },
);

AnimatedField.displayName = "AnimatedField";
export default AnimatedField;
