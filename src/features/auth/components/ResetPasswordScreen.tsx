/**
 * ResetPasswordScreen — premium animated password reset.
 *
 * Motion features (same system as AuthScreen):
 * - Page fade-in on mount
 * - Card springs in (scale + y)
 * - Logo soft scale spring
 * - Form fields stagger in
 * - Input border/glow animates on focus (via AnimatedField)
 * - Error panel shakes with spring physics
 * - Success state morphs in with scale spring
 * - Button content morphs while loading
 * - prefers-reduced-motion respected throughout
 */

import { apiClient } from "../../../core/api/apiClient";
import React, { useState, useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import AppLogo from "../../../components/ui/AppLogo";
import AnimatedField from "./AnimatedField";
import {
  SP, CARD_V, LOGO_V, STAGGER_V, FIELD_V, SUCCESS_V,
} from "../motionConfig";
import {
  Lock, ArrowRight, ShieldCheck,
} from "lucide-react";
import {
  AuthSpinner, AuthPasswordField, AuthValidation,
  DEFAULT_RULES, AuthAnimatedCheck, AuthErrorMessage,
} from "../ui";

// ─── Component ────────────────────────────────────────────────────────────────

export default function ResetPasswordScreen() {
  const reduce = !!useReducedMotion();

  const [password,        setPassword]        = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error,           setError]           = useState("");
  const [success,         setSuccess]         = useState(false);
  const [isLoading,       setIsLoading]       = useState(false);

  // ── Error shake ──
  const [shakeCount, setShakeCount] = useState(0);

  const showError = (msg: string) => {
    setError(msg);
    if (msg) setShakeCount((c) => c + 1);
  };

  // URL params
  const params  = new URLSearchParams(window.location.search);
  const token   = params.get("token") || "";
  const email   = params.get("email") || "";
  const isInvalid = !token || !email;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    showError("");

    if (isInvalid) {
      showError("This password reset link is invalid or malformed. Please request a new one.");
      return;
    }
    if (password.length < 6) {
      showError("Your new password must be at least 6 characters long.");
      return;
    }
    if (password !== confirmPassword) {
      showError("The passwords you entered do not match.");
      return;
    }

    setIsLoading(true);
    try {
      const res  = await apiClient("/api/auth/reset-password", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email, token, password }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess(true);
      } else {
        showError(data.error || "Failed to update password. The reset link might be expired or already used.");
      }
    } catch (err: any) {
      showError(err.message || "An unexpected connection error occurred.");
    } finally {
      setIsLoading(false);
    }
  };

  const navigateToLogin = () => {
    window.location.href = window.location.origin + window.location.pathname;
  };

  const btnMotion = reduce
    ? {}
    : { whileHover: { scale: 1.015 }, whileTap: { scale: 0.985 }, transition: SP.tap };

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.22 }}
      className="absolute inset-0 w-full overflow-y-auto overflow-x-hidden bg-gradient-to-b from-med-bg to-med-cream dark:from-neutral-950 dark:to-neutral-900 selection:bg-med-gold/20 ios-scrollable"
    >
      <div
        className="min-h-full w-full flex flex-col justify-start items-center px-4 sm:px-6 auth-scroll-column"
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 3rem)",
          // paddingBottom: handled by .auth-scroll-column — env(safe-area-inset-bottom)
          // on mobile, calc(safe-area + 6rem) on md+ (no blank rectangle on iPhone/iPad)
        }}
      >
        <div className="flex-grow shrink-0 min-h-[20px] max-h-[10vh]" />

        {/* ── Card ── */}
        <motion.div
          layout={!reduce}
          variants={reduce ? undefined : CARD_V}
          initial={reduce ? false : "hidden"}
          animate="visible"
          transition={SP.gentle}
          className="w-full max-w-[400px] sm:max-w-[440px] md:max-w-[460px] bg-white dark:bg-[#1C1C1E] border border-med-beige/60 dark:border-white/[0.10] rounded-2xl sm:rounded-3xl shadow-elevation-3 overflow-hidden p-6 sm:p-10 relative gpu-accelerate"
          style={{ willChange: "transform, opacity" }}
        >

          {/* ── Logo ── */}
          <div className="mb-6 mt-2 text-center">
            <motion.div
              variants={reduce ? undefined : LOGO_V}
              initial={reduce ? false : "hidden"}
              animate="visible"
              transition={SP.logo}
              className="mb-4 inline-block"
              style={{ willChange: "transform, opacity" }}
            >
              <AppLogo size="lg" darkTheme={true} className="mx-auto" />
            </motion.div>

            <motion.div
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SP.gentle, delay: 0.1 }}
            >
              <h2 className="text-title font-display font-semibold text-neutral-800 dark:text-white">
                Secure Password Reset
              </h2>
              <p className="text-secondary-label dark:text-[#EBEBF599] mt-1 font-medium">
                Med Portal Recovery
              </p>
            </motion.div>
          </div>

          {/* ── Error ── */}
          <AuthErrorMessage error={error} shakeKey={shakeCount} className="mb-5" />

          {/* ── Content ── */}
          <AnimatePresence mode="wait" initial={false}>

            {/* Success state */}
            {success && (
              <motion.div
                key="success"
                variants={reduce ? undefined : SUCCESS_V}
                initial={reduce ? false : "hidden"}
                animate="visible"
                exit="exit"
                transition={SP.gentle}
                className="text-center py-2"
              >
                <motion.div
                  initial={reduce ? false : { scale: 0.44, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 20 }}
                  className="flex justify-center mb-4"
                >
                  <div className="relative">
                    <div className="absolute inset-0 rounded-full bg-emerald-400/15 dark:bg-emerald-400/10 blur-2xl scale-[1.6]" />
                    <div className="relative text-emerald-500 dark:text-emerald-400">
                      <AuthAnimatedCheck size={80} />
                    </div>
                  </div>
                </motion.div>

                <motion.div
                  variants={reduce ? undefined : STAGGER_V}
                  initial={reduce ? false : "hidden"}
                  animate="visible"
                  className="space-y-2"
                >
                  <motion.h3
                    variants={reduce ? undefined : FIELD_V as any}
                    transition={SP.gentle}
                    className="text-body font-semibold text-neutral-800 dark:text-white"
                  >
                    Password Successfully Updated
                  </motion.h3>
                  <motion.p
                    variants={reduce ? undefined : FIELD_V as any}
                    transition={SP.gentle}
                    className="text-secondary-label dark:text-[#EBEBF599] max-w-sm mx-auto"
                  >
                    Your credentials have been securely refreshed. You can now sign in with your new password.
                  </motion.p>
                </motion.div>

                <motion.button
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SP.gentle, delay: 0.2 }}
                  aria-label="Sign in to your dashboard"
                  {...btnMotion}
                  onClick={navigateToLogin}
                  className="mt-8 w-full py-3 bg-med-dark dark:bg-med-gold hover:bg-neutral-800 dark:hover:bg-amber-400 text-[#D5C7B5] dark:text-black font-semibold text-body rounded-xl shadow-elevation-1 transition-colors duration-200 flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-amber-400/60"
                >
                  Sign In to Your Dashboard <ArrowRight aria-hidden="true" className="w-icon-sm h-icon-sm" />
                </motion.button>
              </motion.div>
            )}

            {/* Form */}
            {!success && (
              <motion.form
                key="form"
                noValidate
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={SP.gentle}
                onSubmit={handleSubmit}
              >
                {isInvalid ? (
                  /* Invalid link state */
                  <motion.div
                    variants={reduce ? undefined : STAGGER_V}
                    initial={reduce ? false : "hidden"}
                    animate="visible"
                    className="text-center py-4 space-y-4"
                  >
                    <motion.p
                      variants={reduce ? undefined : FIELD_V as any}
                      className="text-caption text-med-gold font-semibold"
                    >
                      ⚠️ This reset link is missing a validation token or matching academic email.
                    </motion.p>
                    <motion.button
                      variants={reduce ? undefined : FIELD_V as any}
                      type="button"
                      aria-label="Return to portal login"
                      {...btnMotion}
                      onClick={navigateToLogin}
                      className="w-full py-3 bg-neutral-100 dark:bg-white/10 hover:bg-neutral-200 dark:hover:bg-white/15 text-neutral-700 dark:text-white font-semibold text-body rounded-xl transition-colors duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-amber-400/60"
                    >
                      Return to Portal Login
                    </motion.button>
                  </motion.div>
                ) : (
                  <motion.div
                    variants={reduce ? undefined : STAGGER_V}
                    initial={reduce ? false : "hidden"}
                    animate="visible"
                    className="space-y-4"
                  >
                    {/* Email context badge */}
                    <motion.div
                      variants={reduce ? undefined : FIELD_V as any}
                      className="p-3 bg-neutral-50 dark:bg-white/[0.04] border border-neutral-100 dark:border-white/[0.07] rounded-xl text-center"
                    >
                      <span className="text-caption text-neutral-500 dark:text-[#EBEBF599] font-mono block uppercase tracking-wide">
                        Resetting account for
                      </span>
                      <span className="text-caption font-semibold text-neutral-700 dark:text-neutral-300 font-mono">
                        {email}
                      </span>
                    </motion.div>

                    {/* New password */}
                    <AuthPasswordField
                      label="New Password"
                      value={password}
                      required
                      dir="ltr"
                      spellCheck={false}
                      autoCapitalize="none"
                      autoCorrect="off"
                      maxLength={128}
                      placeholder="6–128 characters"
                      onChange={(e) => setPassword(e.target.value)}
                      icon={<Lock className="w-icon-sm h-icon-sm" />}
                      motionVariants={FIELD_V as any}
                    />
                    {password && (
                      <motion.div variants={FIELD_V as any}>
                        <AuthValidation value={password} rules={DEFAULT_RULES} />
                      </motion.div>
                    )}

                    {/* Confirm password */}
                    <AuthPasswordField
                      label="Confirm New Password"
                      value={confirmPassword}
                      required
                      dir="ltr"
                      spellCheck={false}
                      autoCapitalize="none"
                      autoCorrect="off"
                      maxLength={128}
                      placeholder="Re-enter password"
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      icon={<Lock className="w-icon-sm h-icon-sm" />}
                      motionVariants={FIELD_V as any}
                      validationState={confirmPassword && password === confirmPassword ? "valid" : "idle"}
                    />

                    {/* Submit */}
                    <motion.div variants={FIELD_V as any}>
                      <motion.button
                        type="submit"
                        disabled={isLoading}
                        aria-busy={isLoading}
                        aria-label={isLoading ? "Updating password, please wait" : "Update password"}
                        {...btnMotion}
                        className={`w-full mt-2 py-3 bg-med-dark dark:bg-med-gold hover:bg-neutral-800 dark:hover:bg-amber-400 text-[#D5C7B5] dark:text-black font-semibold text-body rounded-xl shadow-elevation-1 transition-colors duration-200 flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-amber-400/60 ${isLoading ? "opacity-70 cursor-not-allowed" : ""}`}
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          {isLoading ? (
                            <motion.span key="loading"
                              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.1 }}
                              className="flex items-center gap-2"
                            >
                              <AuthSpinner /><span>Updating password…</span>
                            </motion.span>
                          ) : (
                            <motion.span key="idle"
                              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.1 }}
                              className="flex items-center gap-2"
                            >
                              Update Password <ArrowRight aria-hidden="true" className="w-icon-sm h-icon-sm" />
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </motion.button>
                    </motion.div>

                    {/* Cancel */}
                    <motion.div variants={FIELD_V as any} className="text-center pt-1">
                      <motion.button
                        type="button"
                        aria-label="Cancel and return to sign in"
                        whileHover={reduce ? {} : { scale: 1.03 }}
                        whileTap={reduce  ? {} : { scale: 0.97 }}
                        transition={SP.tap}
                        onClick={navigateToLogin}
                        className="text-secondary-label hover:text-med-blue dark:text-[#EBEBF599] dark:hover:text-amber-400 font-semibold cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-med-blue dark:focus-visible:ring-amber-400 rounded-sm px-1"
                      >
                        Cancel and Return to Sign In
                      </motion.button>
                    </motion.div>

                  </motion.div>
                )}
              </motion.form>
            )}
          </AnimatePresence>

        </motion.div>

        {/* Footer badge */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SP.gentle, delay: 0.38 }}
          className="mt-8 text-center max-w-xs text-caption text-med-muted dark:text-[#EBEBF599] p-3 bg-white/40 dark:bg-[#1C1C1E]/30 border border-med-beige/40 dark:border-white/[0.05] rounded-md select-none"
        >
          <div className="flex items-center justify-center gap-1.5 font-semibold mb-1">
            <ShieldCheck aria-hidden="true" className="w-3.5 h-3.5 text-med-teal dark:text-amber-400/80 shrink-0" />
            <span>Secure Academic Access</span>
          </div>
          <p>Each reset is cryptographically verified to protect medical data integrity.</p>
        </motion.div>

        <div className="flex-grow shrink-0 min-h-[20px] max-h-[10vh]" />
      </div>
    </motion.div>
  );
}
