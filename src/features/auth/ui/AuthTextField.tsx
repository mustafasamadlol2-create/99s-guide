/**
 * AuthTextField — design-system text input primitive for auth screens.
 *
 * A named ui-layer re-export of AnimatedField so callers can import every
 * auth component from a single barrel path:
 *
 *   import { AuthTextField } from "../ui";
 *
 * Features (all from AnimatedField)
 *   • 10-state spring animation: idle → hover → focused → typing → filled
 *                                 → valid → invalid → disabled → loading → autofilled
 *   • Animated floating label with colour-reactive WCAG-AA contrast tokens
 *   • Leading icon slot, trailing custom element slot, valid checkmark, loading spinner
 *   • Per-state border + box-shadow spring transitions (no abrupt jumps)
 *   • Below-field error message (aria-live="assertive") and hint text
 *   • Autofill detection via CSS animation event (suppresses browser-yellow flash)
 *   • prefers-reduced-motion: skips all physics, pure CSS only
 *   • forwardRef compatible; all HTMLInputElement props forwarded
 *
 * Usage
 *   // Uncontrolled
 *   <AuthTextField label="Email" type="email" required />
 *
 *   // Controlled with validation
 *   <AuthTextField
 *     label="Username"
 *     value={username}
 *     onChange={e => setUsername(e.target.value)}
 *     validationState={usernameError ? "invalid" : username ? "valid" : "idle"}
 *     errorMessage={usernameError}
 *     hint="Letters and numbers only"
 *   />
 *
 *   // With leading icon and stagger animation
 *   <AuthTextField
 *     label="Search"
 *     icon={<Search className="w-4 h-4" />}
 *     motionVariants={FIELD_V}
 *   />
 */

export { default as AuthTextField } from "../components/AnimatedField";
export type { AnimatedFieldProps as AuthTextFieldProps } from "../components/AnimatedField";
