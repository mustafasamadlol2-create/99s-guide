/**
 * Auth Design System — barrel export.
 *
 * Every auth UI primitive is available from this single path:
 *
 *   import {
 *     AuthButton, AuthCard, AuthDivider, AuthErrorMessage,
 *     AuthLabel, AuthPasswordField, AuthSocialButton,
 *     AuthSpinner, AuthSuccessMessage, AuthTextField,
 *     AuthValidation,
 *   } from "../ui";
 *
 * Component catalogue
 * ───────────────────
 *   AuthButton        — multi-variant motion button (primary / secondary / ghost / link)
 *   AuthCard          — glass-morphism card shell with elevation + responsive padding
 *   AuthDivider       — hairline rule with centred label ("OR", "OR CONNECT WITH", …)
 *   AuthErrorMessage  — accessible shake-animated alert (role="alert")
 *   AuthLabel         — polymorphic typography primitive (section / caption / muted)
 *   AuthPasswordField — AnimatedField wrapper with show/hide toggle
 *   AuthSocialButton  — OAuth button: idle → loading → success → error micro-states
 *   AuthSpinner       — accessible SVG spinner (xs / sm / md / lg)
 *   AuthSuccessMessage — animated success container (role="status")
 *   AuthTextField     — full 10-state animated input (wraps AnimatedField)
 *   AuthValidation    — password strength bar + rule checklist
 */

// ── Buttons ──────────────────────────────────────────────────────────────────
export { AuthButton }       from "./AuthButton";
export type { AuthButtonProps, AuthButtonVariant, AuthButtonSize } from "./AuthButton";

// ── Cards ─────────────────────────────────────────────────────────────────────
export { AuthCard }         from "./AuthCard";
export type { AuthCardProps } from "./AuthCard";

// ── Dividers ──────────────────────────────────────────────────────────────────
export { AuthDivider }      from "./AuthDivider";

// ── Error Messages ────────────────────────────────────────────────────────────
export { AuthErrorMessage } from "./AuthErrorMessage";

// ── Labels ────────────────────────────────────────────────────────────────────
export { AuthLabel }        from "./AuthLabel";
export type { AuthLabelVariant } from "./AuthLabel";

// ── Password Fields ───────────────────────────────────────────────────────────
export { AuthPasswordField } from "./AuthPasswordField";
export type { AuthPasswordFieldProps } from "./AuthPasswordField";

// ── Social Buttons ────────────────────────────────────────────────────────────
export { AuthSocialButton } from "./AuthSocialButton";
export type { AuthSocialButtonProps, SocialStatus } from "./AuthSocialButton";

// ── Loading Indicators ────────────────────────────────────────────────────────
export { AuthSpinner }      from "./AuthSpinner";
export type { SpinnerSize } from "./AuthSpinner";

// ── Success Messages ──────────────────────────────────────────────────────────
export { AuthSuccessMessage } from "./AuthSuccessMessage";
export type { AuthSuccessMessageProps } from "./AuthSuccessMessage";

// ── Text Fields ───────────────────────────────────────────────────────────────
export { AuthTextField }    from "./AuthTextField";
export type { AuthTextFieldProps } from "./AuthTextField";

// ── Animated Check ────────────────────────────────────────────────────────────
export { AuthAnimatedCheck } from "./AuthAnimatedCheck";

// ── Validation Helpers ────────────────────────────────────────────────────────
export {
  AuthValidation,
  DEFAULT_RULES,
  getPasswordStrength,
} from "./AuthValidation";
export type { AuthValidationProps, ValidationRule } from "./AuthValidation";
