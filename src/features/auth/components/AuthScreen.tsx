/**
 * AuthScreen — premium auth experience.
 *
 * Motion highlights:
 * - Card springs in on mount (scale 0.96 → 1, y 20 → 0)
 * - Logo soft scale spring (0.88 → 1)
 * - Title/subtitle directionally slides between modes
 * - Form fields stagger in (65ms apart)
 * - Input borders/glows spring on focus (via AnimatedField)
 * - Error box shakes horizontally with spring physics
 * - Button content morphs while loading / between states
 * - Navigation between Login / Register / Forgot uses directional slides
 * - All animations ≤ 300ms effective duration
 * - prefers-reduced-motion: all motion disabled when set
 * - layout prop on card animates height changes smoothly
 */

import { apiClient } from "../../../core/api/apiClient";
import React, {
  useState, useRef, useCallback, useEffect, memo,
} from "react";
import {
  motion, AnimatePresence, useReducedMotion,
} from "motion/react";
import { NativeBridge } from "../../../core/device/capacitor/nativeBridge";
import { isIosDevice, isStandalonePwa } from "../../../core/utils/platform";
import { Browser } from "@capacitor/browser";
import AppLogo from "../../../components/ui/AppLogo";
import AnimatedField from "./AnimatedField";
import { useDarkMode, TOKENS, WRAP_SPRING, COLOR_TWEEN } from "./fieldTokens";
import AuthBackground from "./AuthBackground";
import {
  SP, CARD_V, LOGO_V, STAGGER_V, FIELD_V, SUCCESS_V,
  slideVariants, AuthMode, MODE_IDX,
} from "../motionConfig";
import {
  Mail, Lock, User, ArrowRight,
  Eye, EyeOff, CheckCircle, ChevronLeft, ChevronRight,
  GraduationCap, ClipboardCheck, ShieldCheck,
} from "lucide-react";
import {
  AuthSpinner, AuthSocialButton, AuthPasswordField,
  AuthValidation, DEFAULT_RULES, AuthAnimatedCheck,
  AuthErrorMessage,
} from "../ui";

// ─── Props ────────────────────────────────────────────────────────────────────

interface AuthScreenProps {
  onLoginSuccess: (user: {
    name: string;
    email: string;
    password?: string;
    studentGroup?: string;
    isNewUser?: boolean;
  }) => Promise<void>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type SocialStatus = "idle" | "loading" | "success" | "error";


// ─── Auto-countdown progress bar ─────────────────────────────────────────────

const CountdownBar = memo(function CountdownBar({
  durationMs, reduce,
}: { durationMs: number; reduce: boolean }) {
  return (
    <div
      className="w-full h-[2px] bg-neutral-100 dark:bg-white/[0.07] rounded-full overflow-hidden"
      aria-hidden="true"
    >
      <motion.div
        className="h-full bg-emerald-500/65 dark:bg-emerald-400/55 rounded-full"
        initial={{ width: "100%" }}
        animate={{ width: "0%" }}
        transition={reduce ? { duration: 0 } : { duration: durationMs / 1000, ease: "linear" }}
      />
    </div>
  );
});

// ─── Pulsing loading dots ─────────────────────────────────────────────────────

const PulsingDots = memo(function PulsingDots({ reduce }: { reduce: boolean }) {
  return (
    <div className="flex justify-center gap-[5px]" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-[5px] h-[5px] rounded-full bg-emerald-500 dark:bg-emerald-400"
          animate={reduce ? {} : {
            opacity: [0.28, 1, 0.28],
            scale:   [0.82, 1.22, 0.82],
          }}
          transition={{ duration: 1.15, repeat: Infinity, delay: i * 0.19, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
});

// ─── Main component ───────────────────────────────────────────────────────────

export default function AuthScreen({ onLoginSuccess }: AuthScreenProps) {
  const reduce = !!useReducedMotion();

  // ── Navigation state ──
  const [mode, setMode]           = useState<AuthMode>("login");
  const [direction, setDirection] = useState(1);
  const prevMode                  = useRef<AuthMode>("login");

  // ── Form state ──
  const [showPassword,    setShowPassword]    = useState(false);
  const [email,           setEmail]           = useState("");
  const [password,        setPassword]        = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name,            setName]            = useState("");
  const [studentGroup,    setStudentGroup]    = useState("A");
  const [registerStep,    setRegisterStep]    = useState(1);
  const [termsAccepted,   setTermsAccepted]   = useState(false);
  // Focus / hover states for the Academic Group animated select
  const [groupFocused,  setGroupFocused]  = useState(false);
  const [groupHovered,  setGroupHovered]  = useState(false);
  const dark = useDarkMode();
  const [showTerms,       setShowTerms]       = useState(false);
  const [showPrivacy,     setShowPrivacy]     = useState(false);
  const [error,           setError]           = useState("");
  const [isLoading,       setIsLoading]       = useState(false);
  const [socialState,     setSocialState]     = useState<Record<string, SocialStatus>>({});
  const [loginSuccess,    setLoginSuccess]    = useState(false);
  const [registerEmailValidationAttempted, setRegisterEmailValidationAttempted] = useState(false);
  const registerStepRef   = useRef<HTMLDivElement>(null);
  const registrationRequestRef = useRef(false);
  const successPanelRef   = useRef<HTMLDivElement>(null);
  const modalRef          = useRef<HTMLDivElement>(null);
  const modalTriggerRef   = useRef<HTMLElement | null>(null);
  // OAuth session polling (for native Capacitor where postMessage is unavailable)
  const oauthPollRef            = useRef<ReturnType<typeof setInterval> | null>(null);
  // Shared flag — set true by EITHER the postMessage OR the polling path so the
  // popup-closed check never fires onOAuthFailed after a successful sign-in.
  const oauthCompletedRef       = useRef<boolean>(false);
  // ── Reliability refs ────────────────────────────────────────────────────────
  const oauthInFlightRef        = useRef(false);                                       // concurrent-call guard
  const resetTimerRef           = useRef<ReturnType<typeof setTimeout> | null>(null);  // single tracked reset timer
  const popupCleanupTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);  // retained for cleanup compat
  const browserListenerRef      = useRef<{ remove: () => void } | null>(null);         // native browserFinished handle
  const browserFinishedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);  // 1.8s grace timer after browser close
  const isMountedRef            = useRef(true);                                        // guards callbacks after unmount
  // ── Desktop popup refs (web, non-iOS) ───────────────────────────────────────
  const oauthPopupRef              = useRef<Window | null>(null);                           // the popup window
  const popupMessageListenerRef    = useRef<((e: MessageEvent) => void) | null>(null);      // message event handler
  const popupClosedIntervalRef     = useRef<ReturnType<typeof setInterval> | null>(null);   // popup.closed polling

  // Full cleanup on unmount — stops all intervals, cancels all timers,
  // removes the native browser-finished listener.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (oauthPollRef.current             !== null) clearInterval(oauthPollRef.current);
      if (resetTimerRef.current            !== null) clearTimeout(resetTimerRef.current);
      if (popupCleanupTimerRef.current     !== null) clearTimeout(popupCleanupTimerRef.current);
      if (browserFinishedTimerRef.current  !== null) clearTimeout(browserFinishedTimerRef.current);
      if (browserListenerRef.current       !== null) { browserListenerRef.current.remove(); browserListenerRef.current = null; }
      if (popupClosedIntervalRef.current   !== null) clearInterval(popupClosedIntervalRef.current);
      if (popupMessageListenerRef.current  !== null) window.removeEventListener("message", popupMessageListenerRef.current);
      try { oauthPopupRef.current?.close(); } catch { /* ignore */ }
      oauthInFlightRef.current = false;
    };
  }, []);

  const isValidEmail = useCallback((value: string) => {
    const normalized = value.trim();
    return normalized.length <= 254
      && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized);
  }, []);

  // Move focus to the first control in the newly rendered step. This avoids
  // focus getting lost inside AnimatePresence on mobile keyboards.
  useEffect(() => {
    if (mode !== "register" || registerStep === 5) return;
    const timer = window.setTimeout(() => {
      const firstControl = registerStepRef.current?.querySelector<HTMLElement>(
        "input:not([type='checkbox']), select, button",
      );
      firstControl?.focus();
    }, reduce ? 0 : 120);
    return () => window.clearTimeout(timer);
  }, [mode, reduce, registerStep]);

  // ── Navigation helper (must precede effects that use it) ──
  const go = useCallback((next: AuthMode) => {
    const prev = prevMode.current;
    setDirection(MODE_IDX[next] >= MODE_IDX[prev] ? 1 : -1);
    prevMode.current = next;
    setMode(next);
    setError("");
  }, []);

  // ── Error shake ──
  const [shakeCount, setShakeCount] = useState(0);

  // ── Error helper (must precede effects that use it) ──
  const showError = useCallback((msg: string) => {
    setError(msg);
    if (msg) setShakeCount((c) => c + 1);
  }, []);

  // Schedules a button→idle reset after a failure/cancel, always cancelling
  // any existing pending reset first.  Every async failure path must use this
  // instead of a bare setTimeout so a subsequent tap can always pre-empt the
  // reset and start a fresh flow without the old timer corrupting new state.
  const scheduleReset = useCallback((key: string, delayMs: number) => {
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    resetTimerRef.current = setTimeout(() => {
      resetTimerRef.current = null;
      if (!isMountedRef.current) return;
      setSocialState(s => ({ ...s, [key]: "idle" }));
      setError("");
      oauthInFlightRef.current = false;
    }, delayMs);
  }, []);

  // ── Handle OAuth redirect-flow errors ─────────────────────────────────────
  // When the web redirect flow is cancelled or rejected, App.tsx dispatches
  // this custom event so AuthScreen can surface a human-readable error message
  // without coupling App.tsx to the auth UI internals.
  useEffect(() => {
    const handleRedirectError = (e: Event) => {
      const reason = (e as CustomEvent<string>).detail || "access_denied";
      const friendly =
        reason === "access_denied"
          ? "Sign-in was cancelled. Please try again."
          : reason.includes("domain") || reason.includes("hd")
            ? "Access denied — only @comed.uobaghdad.edu.iq student emails are allowed."
            : `Sign-in failed: ${reason}. Please try again.`;
      showError(friendly);
    };
    window.addEventListener("oauth-redirect-error", handleRedirectError);
    return () => window.removeEventListener("oauth-redirect-error", handleRedirectError);
  }, [showError]);

  // ── Handle OAuth popup messages ────────────────────────────────────────────
  // OAUTH_DOMAIN_REJECTED — email not from the allowed institutional domain (native)
  // OAUTH_CANCELLED       — user dismissed the sign-in sheet (native)
  // OAUTH_AUTH_SUCCESS    — OAuth completed via native polling dispatch
  useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      const type = event.data?.type;

      if (type === "OAUTH_DOMAIN_REJECTED") {
        // Stop any running poll
        if (oauthPollRef.current !== null) {
          clearInterval(oauthPollRef.current);
          oauthPollRef.current = null;
        }
        const msg =
          (event.data.message as string | undefined) ??
          "Access denied — only @comed.uobaghdad.edu.iq student emails are allowed.";
        showError(msg);
        // Cancel any pending reset before starting the new 4.5 s window so the
        // old timer cannot fire while a new flow is already in "loading" state.
        if (resetTimerRef.current !== null) {
          clearTimeout(resetTimerRef.current);
          resetTimerRef.current = null;
        }
        setSocialState((s) => {
          const activeKey =
            Object.keys(s).find((k) => s[k] !== "idle") ?? "google";
          // Tracked timeout — cancelled by the next tap so a quick retry is
          // never interrupted by a stale reset belonging to this attempt.
          resetTimerRef.current = setTimeout(() => {
            resetTimerRef.current = null;
            if (!isMountedRef.current) return;
            setSocialState((prev) => ({ ...prev, [activeKey]: "idle" }));
            setError("");
            oauthInFlightRef.current = false;
          }, 4500);
          return { ...s, [activeKey]: "error" };
        });
        return;
      }

      if (type === "OAUTH_AUTH_SUCCESS") {
        // Popup (or polling dispatch) sent auth success.
        // Set the shared ref immediately so the popup-closed interval cannot
        // fire onOAuthFailed() after the popup self-closes post-postMessage.
        oauthCompletedRef.current = true;
        if (popupClosedIntervalRef.current !== null) {
          clearInterval(popupClosedIntervalRef.current);
          popupClosedIntervalRef.current = null;
        }
        // Mark the active button as completed
        setSocialState((s) => {
          const activeKey = Object.keys(s).find((k) => s[k] === "loading");
          if (!activeKey) return s;
          return { ...s, [activeKey]: "success" };
        });
        return;
      }

      if (type === "OAUTH_CANCELLED") {
        // Stop any running poll and quietly reset whichever button is active
        if (oauthPollRef.current !== null) {
          clearInterval(oauthPollRef.current);
          oauthPollRef.current = null;
        }
        setSocialState((s) => {
          const activeKey = Object.keys(s).find((k) => s[k] !== "idle");
          if (!activeKey) return s;
          return { ...s, [activeKey]: "idle" };
        });
      }
    };

    window.addEventListener("message", handleOAuthMessage);
    return () => window.removeEventListener("message", handleOAuthMessage);
  }, [showError]);

  // ── Auto-return from "sent" to "login" after 8 s ──
  useEffect(() => {
    if (mode !== "sent") return;
    const timer = setTimeout(() => go("login"), 8000);
    return () => clearTimeout(timer);
  }, [mode, go]);

  // ── Focus success panel for accessibility ──
  useEffect(() => {
    if (!loginSuccess && registerStep !== 5) return;
    const delay = reduce ? 0 : 120;
    const id = setTimeout(() => successPanelRef.current?.focus(), delay);
    return () => clearTimeout(id);
  }, [loginSuccess, registerStep, reduce]);

  // ── Terms / Privacy modal helpers ──
  const openTerms = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    modalTriggerRef.current = e.currentTarget;
    setShowTerms(true);
  }, []);

  const openPrivacy = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    modalTriggerRef.current = e.currentTarget;
    setShowPrivacy(true);
  }, []);

  const closeModal = useCallback(() => {
    setShowTerms(false);
    setShowPrivacy(false);
    requestAnimationFrame(() => {
      (modalTriggerRef.current as HTMLElement | null)?.focus();
    });
  }, []);

  // ── Focus trap + Escape for Terms / Privacy modal ──
  useEffect(() => {
    if (!showTerms && !showPrivacy) return;

    const modal = modalRef.current;
    if (!modal) return;

    // Move focus into modal on open (after animation frame so element is painted)
    const focusTimer = window.setTimeout(() => {
      const firstFocusable = modal.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      firstFocusable?.focus();
    }, reduce ? 0 : 80);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = Array.from(
        modal.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showTerms, showPrivacy, reduce, closeModal]);

  // ── Submit ──
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (mode === "forgot") {
      if (!isValidEmail(email)) {
        showError("Please enter a valid student email address.");
        return;
      }
      setIsLoading(true);
      try {
        const res  = await apiClient("/api/auth/forgot-password", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ email }),
        });
        const data = await res.json();
        if (res.ok) {
          go("sent");
          setShowPassword(false);
        } else {
          showError(data.error || "Failed to trigger password recovery.");
        }
      } catch (err: any) {
        showError(err.message || "Connection error initiating password reset.");
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (mode === "register") {
      await handleRegisterSubmit(e);
      return;
    }

    if (!isValidEmail(email)) {
      showError("Please provide a valid academic email address.");
      return;
    }
    if (password.length < 6) {
      showError("Password must be at least 6 characters.");
      return;
    }
    setIsLoading(true);
    try {
      await onLoginSuccess({
        name:       mode === "login"
          ? email.split("@")[0].replace(".", " ") || "Candidate"
          : name,
        email,
        password,
        studentGroup,
        isNewUser:  false,
      });
      setLoginSuccess(true);
    } catch (err: any) {
      showError(err.message || "Authentication failed. Please verify your credentials.");
    } finally {
      setIsLoading(false);
    }
  };

  const validateRegisterStep = useCallback((step: number): boolean => {
    if (step === 1 && !name.trim()) {
      showError("Please enter your full name as registered in the university databases.");
      return false;
    }
    if (step === 1 && name.trim().length > 200) {
      showError("Your full name must be under 200 characters.");
      return false;
    }
    if (step === 2 && !isValidEmail(email)) {
      setRegisterEmailValidationAttempted(true);
      return false;
    }
    if (step === 2 && !["A", "B", "C", "D"].includes(studentGroup)) {
      showError("Please choose a valid academic group.");
      return false;
    }
    if (step === 3 && password.length < 6) {
      showError("Password must be at least 6 characters.");
      return false;
    }
    if (step === 3 && password.length > 128) {
      showError("Password must be under 128 characters.");
      return false;
    }
    if (step === 3 && password !== confirmPassword) {
      showError("The passwords do not match.");
      return false;
    }
    if (step === 3 && !termsAccepted) {
      showError("You must accept the Terms of Service and Privacy Policy to register.");
      return false;
    }
    return true;
  }, [confirmPassword, email, isValidEmail, name, password, showError, studentGroup, termsAccepted]);

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (registrationRequestRef.current || isLoading) return;

    if (registerStep < 4) {
      if (!validateRegisterStep(registerStep)) return;
      setDirection(1);
      setRegisterStep((step) => step + 1);
      return;
    }

    if (registerStep === 4) {
      if (!validateRegisterStep(1) || !validateRegisterStep(2) || !validateRegisterStep(3)) {
        return;
      }

      setIsLoading(true);
      registrationRequestRef.current = true;
      try {
        // Keep the review state stable while the request is in flight. The
        // success step is only entered after the auth callback succeeds.
        if (!reduce) {
          await new Promise((resolve) => setTimeout(resolve, 180));
        }
        await onLoginSuccess({
          name: name.trim(),
          email: email.trim(),
          password,
          studentGroup,
          isNewUser: true,
        });
        setRegisterStep(5);
      } catch (err: any) {
        setRegisterStep(4);
        showError(err.message || "Registration failed. Please review your information and try again.");
      } finally {
        registrationRequestRef.current = false;
        setIsLoading(false);
      }
    }
  };

  const handleRegisterBack = () => {
    setError("");
    setDirection(-1);
    setRegisterStep((step) => Math.max(1, step - 1));
  };

  // ── Social login ──
  const handleSocialLogin = async (provider: string) => {
    const key = provider.toLowerCase();

    // ── Apple Sign-In: temporarily disabled for current release ───────────────
    // The full OAuth flow below is preserved for future activation.
    // Remove this block when Apple credentials are configured and ready.
    if (key === "apple") {
      showError(
        "Apple Sign-In is not available yet — please use your " +
        "@comed.uobaghdad.edu.iq university email and password to sign in.",
      );
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Prevent concurrent OAuth flows — a second tap while one is already in
    // progress is silently dropped.  Without this guard, rapid taps orphan poll
    // intervals and corrupt socialState beyond recovery without a page reload.
    if (oauthInFlightRef.current) return;
    oauthInFlightRef.current = true;

    // Cancel any pending auto-reset from a previous failed attempt before
    // starting a fresh flow — the stale timer must never clobber the new
    // "loading" state that is about to be set below.
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }

    setError("");

    // Stop any previous native poll before starting a new OAuth attempt
    if (oauthPollRef.current !== null) {
      clearInterval(oauthPollRef.current);
      oauthPollRef.current = null;
    }
    // Reset the shared completion flag for this fresh attempt
    oauthCompletedRef.current = false;

    setSocialState(s => ({ ...s, [key]: "loading" }));

    if (NativeBridge.isNativePlatform()) {
      // ── Native path (iOS / Android Capacitor): in-app browser + polling ───
      // The Capacitor in-app browser is a proper modal overlay within the app.
      // postMessage is unavailable there, so session completion is detected by
      // polling /api/auth/oauth-session/:stateToken every 1.5 s.

      const onOAuthFailed = (msg?: string) => {
        if (!isMountedRef.current) return;
        if (oauthCompletedRef.current) return;
        if (oauthPollRef.current !== null) {
          clearInterval(oauthPollRef.current);
          oauthPollRef.current = null;
        }
        if (browserListenerRef.current !== null) {
          browserListenerRef.current.remove();
          browserListenerRef.current = null;
        }
        setSocialState(s => ({ ...s, [key]: "error" }));
        showError(msg ?? "Sign-in was cancelled. Please try again.");
        scheduleReset(key, 3000);
      };

      try {
        const res = await apiClient(`/api/auth/oauth-url?provider=${key}`);
        if (!res.ok) throw new Error(`Failed to initialize ${provider} login session.`);
        const data = await res.json();
        const targetUrl = data.url ?? data.sandboxUrl;
        if (!targetUrl) throw new Error(`Authentication URL was not returned for ${provider}.`);
        const stateToken: string | undefined = data.stateToken;

        Browser.open({ url: targetUrl, presentationStyle: "popover" }).catch(() => {
          window.open(targetUrl, "_blank");
        });

        // Store listener handle so it can be removed on success / failure / unmount.
        Browser.addListener("browserFinished", () => {
          // Clear any stale grace timer from a previous attempt before starting
          // a new one — prevents the old attempt's failure from clobbering a
          // new attempt that started immediately after the browser closed.
          if (browserFinishedTimerRef.current !== null) {
            clearTimeout(browserFinishedTimerRef.current);
          }
          browserFinishedTimerRef.current = setTimeout(() => {
            browserFinishedTimerRef.current = null;
            if (!isMountedRef.current) return;
            onOAuthFailed();
            if (browserListenerRef.current !== null) {
              browserListenerRef.current.remove();
              browserListenerRef.current = null;
            }
          }, 1800);
        }).then(h => {
          if (isMountedRef.current) {
            browserListenerRef.current = h;
          } else {
            h.remove();
          }
        }).catch(() => {});

        if (stateToken) {
          const MAX_POLL_MS   = 3 * 60 * 1000;
          const POLL_INTERVAL = 1500;
          const startTime     = Date.now();
          // Prevents overlapping polls when network latency exceeds the interval.
          // Without this guard, multiple concurrent requests can each detect
          // success and race to update state / close the browser.
          let pollInFlight = false;

          oauthPollRef.current = setInterval(async () => {
            if (pollInFlight) return; // skip — previous poll still in flight
            pollInFlight = true;
            try {
              if (Date.now() - startTime > MAX_POLL_MS) {
                clearInterval(oauthPollRef.current!);
                oauthPollRef.current = null;
                onOAuthFailed("Sign-in timed out. Please try again.");
                return;
              }
              const pollRes = await apiClient(`/api/auth/oauth-session/${stateToken}`);
              if (pollRes.ok) {
                const pollData = await pollRes.json();
                if (pollData.success && pollData.token) {
                  if (!isMountedRef.current) return; // component unmounted mid-poll
                  oauthCompletedRef.current = true;
                  clearInterval(oauthPollRef.current!);
                  oauthPollRef.current = null;
                  if (browserFinishedTimerRef.current !== null) {
                    clearTimeout(browserFinishedTimerRef.current);
                    browserFinishedTimerRef.current = null;
                  }
                  if (browserListenerRef.current !== null) {
                    browserListenerRef.current.remove();
                    browserListenerRef.current = null;
                  }
                  oauthInFlightRef.current = false;
                  setSocialState(s => ({ ...s, [key]: "success" }));
                  // Delay Browser.close() by 1 second so the in-app browser's
                  // success card is visible before the sheet dismisses.
                  setTimeout(() => { Browser.close().catch(() => {}); }, 1000);
                  window.dispatchEvent(new MessageEvent("message", {
                    data: {
                      type:   "OAUTH_AUTH_SUCCESS",
                      token:  pollData.token,
                      userId: pollData.userId,
                      email:  pollData.email,
                    },
                    origin: window.location.origin,
                  }));
                }
              }
            } catch { /* network error — keep polling */ }
            finally { pollInFlight = false; }
          }, POLL_INTERVAL);
        }
      } catch (err: any) {
        if (!isMountedRef.current) return;
        setSocialState(s => ({ ...s, [key]: "error" }));
        showError(err.message || "Social authentication error.");
        scheduleReset(key, 2200);
      }

    } else {
      // ── Web path ────────────────────────────────────────────────────────────
      //
      // Strategy depends on the browser/platform:
      //
      // iOS Safari (web, non-native):
      //   window.open() opens a NEW TAB — not a popup — and window.close() is
      //   blocked on tabs not opened by script.  Redirect the whole page instead.
      //
      // Desktop Chrome / Firefox / Safari macOS:
      //   Pre-open "about:blank" SYNCHRONOUSLY inside the user gesture so
      //   popup blockers see it as trusted, then navigate it to the OAuth URL
      //   after the async fetch resolves.  The popup closes itself on
      //   success/rejection; the app learns the outcome via postMessage (fast
      //   path) or popup.closed polling → /api/auth/oauth-session/:token
      //   (Safari ITP fallback, because ITP nullifies window.opener after a
      //   cross-origin navigation so postMessage may not reach the parent).

      const isIosSafari = isIosDevice();

      // ── Standalone-PWA note ───────────────────────────────────────────────
      // Previously the installed PWA (home-screen) used window.location.href
      // to open the OAuth URL, which opens Safari.app as an EXTERNAL browser.
      // window.close() cannot close a page the user navigated to themselves
      // (only script-opened windows), so the success screen was permanently
      // stranded.  The fix: let standalone PWA fall through to the popup path
      // below.  window.open() opens a new Safari tab that CAN be closed by
      // window.close(), window.opener is preserved so postMessage works, and
      // token delivery via Bearer header sidesteps the separate-cookie-jar
      // issue entirely.  The redirect flow is still used for regular iPhone
      // Safari (non-standalone) because that has no reliable popup support.

      if (isIosSafari && !isStandalonePwa()) {
        // ── iOS Safari (browser tab): full-page redirect flow ────────────────
        // Cookie set by the callback is first-party (ITP-safe).
        // App.tsx reads ?oauth_done=1 / ?oauth_error=… on return.
        try {
          const res = await apiClient(`/api/auth/oauth-url?provider=${key}&flow=redirect`);
          if (!res.ok) throw new Error(`Failed to initialize ${provider} login session.`);
          const data = await res.json();
          const targetUrl = data.url ?? data.sandboxUrl;
          if (!targetUrl) throw new Error(`Authentication URL was not returned for ${provider}.`);
          window.location.href = targetUrl;
        } catch (err: any) {
          oauthInFlightRef.current = false;
          setSocialState(s => ({ ...s, [key]: "error" }));
          showError(err.message || "Social authentication error.");
          scheduleReset(key, 2200);
        }

      } else {
        // ── Desktop: popup window flow ────────────────────────────────────────
        //
        // Step 1 — open popup SYNCHRONOUSLY (inside user gesture) so browsers
        //   don't block it.  We navigate it to "about:blank" for now and will
        //   set its URL after the async fetch returns.
        const sw = screen.availWidth  || screen.width;
        const sh = screen.availHeight || screen.height;
        const pw = 500, ph = 640;
        const popupFeatures = [
          `width=${pw}`, `height=${ph}`,
          `top=${Math.round((sh - ph) / 2)}`,
          `left=${Math.round((sw - pw) / 2)}`,
          "popup=1", "scrollbars=yes", "resizable=yes",
        ].join(",");
        const popup = window.open("about:blank", `oauth_${key}_${Date.now()}`, popupFeatures);

        if (!popup) {
          // Popup was blocked — fall back to the redirect flow instead of failing.
          oauthInFlightRef.current = false;
          setSocialState(s => ({ ...s, [key]: "error" }));
          showError(
            "Your browser blocked the sign-in popup. " +
            "Please allow popups for this site, or try refreshing.",
          );
          scheduleReset(key, 4500);
          return;
        }

        oauthPopupRef.current = popup;

        // ── helpers ──────────────────────────────────────────────────────────
        const cleanupPopupListeners = () => {
          if (popupClosedIntervalRef.current !== null) {
            clearInterval(popupClosedIntervalRef.current);
            popupClosedIntervalRef.current = null;
          }
          if (popupMessageListenerRef.current !== null) {
            window.removeEventListener("message", popupMessageListenerRef.current);
            popupMessageListenerRef.current = null;
          }
          oauthPopupRef.current = null;
          // Clear any pending stateToken stored for PWA cold-start recovery.
          // This is intentionally in cleanupPopupListeners (called by every
          // outcome path: success, failure, domain-reject, manual cancel) so
          // the key is removed once the in-page popup flow has concluded.
          localStorage.removeItem("_oauth_pending_token");
        };

        const onPopupSuccess = (token: string, userId: string, email: string) => {
          if (!isMountedRef.current || oauthCompletedRef.current) return;
          oauthCompletedRef.current = true;
          cleanupPopupListeners();
          // The popup page sends postMessage immediately and shows a 1-second
          // success card before calling window.close() itself.
          // We give it up to 1.5 s to self-close, then force-close as a safety
          // net — this way the user always sees the success message.
          setTimeout(() => { try { popup.close(); } catch { /* ignore */ } }, 1500);
          oauthInFlightRef.current = false;
          setSocialState(s => ({ ...s, [key]: "success" }));
          // Re-use the same OAUTH_AUTH_SUCCESS event that App.tsx already listens for.
          window.dispatchEvent(new MessageEvent("message", {
            data: { type: "OAUTH_AUTH_SUCCESS", token, userId, email },
            origin: window.location.origin,
          }));
        };

        const onPopupFailed = (msg?: string) => {
          if (!isMountedRef.current || oauthCompletedRef.current) return;
          cleanupPopupListeners();
          try { popup.close(); } catch { /* ignore */ }
          oauthInFlightRef.current = false;
          setSocialState(s => ({ ...s, [key]: "error" }));
          showError(msg ?? "Sign-in was cancelled. Please try again.");
          scheduleReset(key, 3000);
        };

        const onDomainRejected = (msg?: string) => {
          if (!isMountedRef.current || oauthCompletedRef.current) return;
          // Mark completed so popup.closed poll doesn't override this.
          oauthCompletedRef.current = true;
          cleanupPopupListeners();
          // Popup self-closes after 4.5 s — no need to force-close it.
          oauthInFlightRef.current = false;
          setSocialState(s => ({ ...s, [key]: "error" }));
          showError(
            msg ??
            "Access denied: only @comed.uobaghdad.edu.iq accounts can sign in.",
          );
          scheduleReset(key, 6000);
        };

        // ── Step 2 — fetch OAuth URL async (popup is already open) ───────────
        let stateToken: string | undefined;
        try {
          const res = await apiClient(`/api/auth/oauth-url?provider=${key}`);
          if (!res.ok) throw new Error(`Failed to initialize ${provider} login session.`);
          const data = await res.json();
          const targetUrl = data.url ?? data.sandboxUrl;
          if (!targetUrl) throw new Error(`Authentication URL was not returned for ${provider}.`);
          stateToken = data.stateToken as string | undefined;

          // Persist stateToken for cold-start recovery: if iOS kills the PWA
          // while the popup is still open, App.tsx's startup effect can query
          // /api/auth/oauth-session/:token and recover the completed session.
          // cleanupPopupListeners() (called by every outcome path) removes it.
          if (stateToken) {
            localStorage.setItem("_oauth_pending_token", stateToken);
          }

          // Navigate the already-open popup to the OAuth provider.
          popup.location.href = targetUrl;
        } catch (err: any) {
          try { popup.close(); } catch { /* ignore */ }
          oauthPopupRef.current = null;
          oauthInFlightRef.current = false;
          setSocialState(s => ({ ...s, [key]: "error" }));
          showError(err.message || "Social authentication error.");
          scheduleReset(key, 2200);
          return;
        }

        // ── Step 3 — postMessage listener ─────────────────────────────────────
        // Chrome / Firefox / Safari (desktop, no ITP on same-origin callbacks):
        // the success/rejection page posts a message the moment it loads.
        const messageHandler = (e: MessageEvent) => {
          // Only accept messages from our own origin.
          if (e.origin !== window.location.origin) return;
          const msg = e.data as { type?: string; token?: string; userId?: string; email?: string; message?: string };
          if (msg?.type === "OAUTH_AUTH_SUCCESS") {
            onPopupSuccess(msg.token ?? "", msg.userId ?? "", msg.email ?? "");
          } else if (msg?.type === "OAUTH_DOMAIN_REJECTED") {
            onDomainRejected(msg.message);
          }
        };
        window.addEventListener("message", messageHandler);
        popupMessageListenerRef.current = messageHandler;

        // ── Step 4 — popup.closed polling (Safari ITP fallback) ───────────────
        // Safari ITP nullifies window.opener after the popup navigates through
        // accounts.google.com (cross-origin), so postMessage may never arrive.
        // When we detect the popup is closed without a prior postMessage, we
        // poll the session API to find out what happened:
        //   • { success: true, token }  → login (ITP Safari success path)
        //   • { rejected: true }        → domain rejection
        //   • { pending: true } / 404   → user closed popup manually
        popupClosedIntervalRef.current = setInterval(async () => {
          let isClosed = false;
          try { isClosed = popup.closed; } catch { isClosed = true; }
          if (!isClosed) return;

          // Popup is now closed.
          cleanupPopupListeners();
          if (oauthCompletedRef.current) return; // already handled by postMessage

          if (!stateToken) {
            onPopupFailed("Sign-in was cancelled. Please try again.");
            return;
          }

          // Ask the server what happened during this auth attempt.
          try {
            const pollRes = await apiClient(`/api/auth/oauth-session/${stateToken}`);
            if (pollRes.ok) {
              const pollData = await pollRes.json() as {
                success?: boolean; token?: string; userId?: string; email?: string;
                rejected?: boolean; pending?: boolean;
              };
              if (pollData.success && pollData.token) {
                onPopupSuccess(pollData.token, pollData.userId ?? "", pollData.email ?? "");
                return;
              }
              if (pollData.rejected) {
                onDomainRejected();
                return;
              }
            }
          } catch { /* network error — treat as manual cancel */ }

          // Session not found → user closed popup before completing.
          onPopupFailed("Sign-in was cancelled. Please try again.");
        }, 500);
      }
    }
  };

  // ── Per-mode header copy ──
  const headers: Record<AuthMode, { title: string; subtitle: string }> = {
    login:    { title: "Portal Access",                subtitle: "Medical Education Platform"                   },
    register: { title: "Create Account",               subtitle: "Join the collaborative medical study network" },
    forgot:   { title: "Reset Password",               subtitle: "Provide your registered university email"     },
    sent:     { title: "Check Your Inbox",             subtitle: "Secure recovery link dispatched"              },
  };
  const registerStepMeta = [
    { title: "Personal Information", subtitle: "Tell us a little about yourself", icon: User },
    { title: "University Information", subtitle: "Connect your academic identity", icon: GraduationCap },
    { title: "Password", subtitle: "Secure your student account", icon: ShieldCheck },
    { title: "Review", subtitle: "Make sure everything is correct", icon: ClipboardCheck },
    { title: "Success", subtitle: "Your student account is ready", icon: CheckCircle },
  ];
  const activeHeader = mode === "register"
    ? registerStepMeta[registerStep - 1]
    : { ...headers[mode], icon: undefined };

  const sv = slideVariants(direction);

  // ── Shared button tap/hover props ──
  const btnMotion = reduce
    ? {}
    : { whileHover: { scale: 1.015 }, whileTap: { scale: 0.985 }, transition: SP.tap };

  return (
    <motion.div
      id="auth-screen-container"
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.22 }}
      className="relative w-full h-full overflow-y-auto overflow-x-hidden bg-[#F8F9FC] dark:bg-[#1C1C1E] select-text ios-scrollable"
    >
      <div
        className="relative min-h-[100dvh] w-full flex flex-col justify-start items-center px-4 sm:px-6 md:px-8 auth-scroll-column"
        style={{
          zIndex:     1,
          paddingTop: "calc(env(safe-area-inset-top) + 2rem)",
          // paddingBottom: handled by .auth-scroll-column — env(safe-area-inset-bottom)
          // on mobile, calc(safe-area + 6rem) on md+ (no blank rectangle on iPhone/iPad)
        }}
      >
        {/* Premium layered background — grows with the full scrollable auth content */}
        <AuthBackground />

        <div className="flex-grow shrink-0 min-h-[20px] max-h-[10vh]" />

        <div className="w-full max-w-[400px] sm:max-w-[440px] md:max-w-[540px] lg:max-w-[620px] pb-8 shrink-0 flex flex-col items-center">

          {/* ── Card ── */}
          <motion.div
            id="auth-card"
            layout={!reduce}
            layoutRoot
            variants={reduce ? undefined : CARD_V}
            initial={reduce ? false : "hidden"}
            animate="visible"
            transition={SP.gentle}
            className="w-full bg-[#F8F9FC] dark:bg-[#1C1C1E] border border-med-beige/60 dark:border-white/[0.10] rounded-2xl sm:rounded-3xl shadow-elevation-3 overflow-hidden p-6 sm:p-10 md:p-12 relative gpu-accelerate"
            style={{ willChange: "transform, opacity" }}
          >

            {/* ── Logo (spring scale 0.88 → 1) ── */}
            <div className="mb-6 mt-2">
              <motion.div
                variants={reduce ? undefined : LOGO_V}
                initial={reduce ? false : "hidden"}
                animate="visible"
                transition={SP.logo}
                className="mb-4"
                style={{ willChange: "transform, opacity" }}
              >
                <AppLogo size="lg" darkTheme={true} className="mx-auto" />
              </motion.div>

              {/* ── Directional header slide ── */}
              <div className="relative overflow-hidden min-h-[62px] flex flex-col justify-center">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={mode}
                    initial={reduce ? false : sv.enter}
                    animate={sv.center}
                    exit={sv.exit}
                    transition={SP.gentle}
                    className="text-center"
                  >
                    <h2 className="text-title font-display font-semibold text-neutral-800 dark:text-white">
                      {activeHeader.title}
                    </h2>
                    <p className="text-callout text-med-muted dark:text-[#EBEBF599] mt-2 leading-snug">
                      {activeHeader.subtitle}
                    </p>
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>

            {/* ── Error box (shake on spring physics) ── */}
            <AuthErrorMessage error={error} shakeKey={shakeCount} className="mb-4" />

            {/* ── Directional content panels ── */}
            <AnimatePresence mode="wait" initial={false}>

              {/* ── Login success ────────────────────────────────────────────── */}
              {loginSuccess && (
                <motion.div
                  key="login-success"
                  ref={successPanelRef}
                  tabIndex={-1}
                  role="status"
                  aria-live="polite"
                  aria-label="Signed in successfully"
                  initial={reduce ? false : { opacity: 0, scale: 0.94, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.04, y: -14 }}
                  transition={SP.gentle}
                  className="text-center py-6 focus:outline-none"
                >
                  {/* Check icon */}
                  <motion.div
                    initial={reduce ? false : { scale: 0.44, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 20, mass: 1 }}
                    className="flex justify-center mb-6"
                  >
                    <div className="relative">
                      <div className="absolute inset-0 rounded-full bg-emerald-400/15 dark:bg-emerald-400/10 blur-2xl scale-[1.6]" />
                      <div className="relative text-emerald-500 dark:text-emerald-400">
                        <AuthAnimatedCheck size={88} />
                      </div>
                    </div>
                  </motion.div>

                  {/* Copy */}
                  <motion.div
                    variants={reduce ? undefined : STAGGER_V}
                    initial={reduce ? false : "hidden"}
                    animate="visible"
                    className="space-y-2"
                  >
                    <motion.h3
                      variants={reduce ? undefined : FIELD_V}
                      transition={{ ...SP.gentle, delay: 0.52 }}
                      className="text-[21px] font-display font-semibold text-neutral-800 dark:text-white tracking-tight"
                    >
                      Welcome back
                    </motion.h3>
                    <motion.p
                      variants={reduce ? undefined : FIELD_V}
                      transition={{ ...SP.gentle, delay: 0.60 }}
                      className="text-secondary-label dark:text-[#EBEBF599]"
                    >
                      Signing you in to your dashboard…
                    </motion.p>
                  </motion.div>

                  {/* Progress dots */}
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={reduce ? { duration: 0 } : { delay: 0.82, duration: 0.35 }}
                    className="mt-7"
                  >
                    <PulsingDots reduce={reduce} />
                  </motion.div>
                </motion.div>
              )}

              {/* ── Password reset sent ──────────────────────────────────────── */}
              {!loginSuccess && mode === "sent" && (
                <motion.div
                  key="sent"
                  ref={successPanelRef}
                  tabIndex={-1}
                  role="status"
                  aria-live="polite"
                  aria-label="Recovery email dispatched"
                  initial={reduce ? false : sv.enter}
                  animate={sv.center}
                  exit={sv.exit}
                  transition={SP.gentle}
                  className="text-center py-4 focus:outline-none"
                >
                  {/* Icon */}
                  <motion.div
                    initial={reduce ? false : { scale: 0.44, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 20, mass: 1 }}
                    className="flex justify-center mb-5"
                  >
                    <div className="relative">
                      <div className="absolute inset-0 rounded-full bg-emerald-400/15 dark:bg-emerald-400/10 blur-2xl scale-[1.6]" />
                      <div className="relative text-emerald-500 dark:text-emerald-400">
                        <AuthAnimatedCheck size={80} />
                      </div>
                    </div>
                  </motion.div>

                  {/* Copy */}
                  <motion.div
                    variants={reduce ? undefined : STAGGER_V}
                    initial={reduce ? false : "hidden"}
                    animate="visible"
                    className="space-y-2"
                  >
                    <motion.h3
                      variants={reduce ? undefined : FIELD_V}
                      transition={{ ...SP.gentle, delay: 0.50 }}
                      className="text-body font-semibold text-neutral-800 dark:text-white"
                    >
                      Check Your Student Inbox
                    </motion.h3>
                    <motion.p
                      variants={reduce ? undefined : FIELD_V}
                      transition={{ ...SP.gentle, delay: 0.58 }}
                      className="text-secondary-label dark:text-[#EBEBF599] max-w-[280px] mx-auto leading-relaxed"
                    >
                      A secure recovery link was sent to{" "}
                      <span className="font-mono font-semibold text-neutral-700 dark:text-neutral-200 break-all">
                        {email}
                      </span>
                      . Check spam if it doesn't arrive shortly.
                    </motion.p>
                  </motion.div>

                  {/* Countdown */}
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={reduce ? { duration: 0 } : { delay: 0.70, duration: 0.30 }}
                    className="mt-7 space-y-2"
                  >
                    <CountdownBar durationMs={8000} reduce={reduce} />
                    <p className="text-caption text-med-muted dark:text-white/38 text-center">
                      Returning to login in 8 seconds
                    </p>
                  </motion.div>

                  {/* Manual return */}
                  <motion.div
                    initial={reduce ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={reduce ? { duration: 0 } : { ...SP.gentle, delay: 0.78 }}
                    className="mt-5"
                  >
                    <motion.button
                      type="button"
                      aria-label="Back to login portal"
                      whileHover={reduce ? {} : { scale: 1.03 }}
                      whileTap={reduce  ? {} : { scale: 0.97 }}
                      transition={SP.tap}
                      onClick={() => go("login")}
                      className="text-caption font-semibold text-med-blue dark:text-amber-400 hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-med-blue dark:focus-visible:ring-amber-400 rounded-sm px-1"
                    >
                      Back to Login Portal
                    </motion.button>
                  </motion.div>
                </motion.div>
              )}

              {/* ── Forgot password form ── */}
              {mode === "forgot" && (
                <motion.form
                  noValidate
                  id="forgot-password-form"
                  key="forgot-password-form"
                  initial={reduce ? false : sv.enter}
                  animate={sv.center}
                  exit={sv.exit}
                  transition={SP.gentle}
                  onSubmit={handleAuthSubmit}
                >
                  <motion.div
                    variants={reduce ? undefined : STAGGER_V}
                    initial={reduce ? false : "hidden"}
                    animate="visible"
                    className="space-y-4"
                  >
                    <AnimatedField
                      label="Academic Email Address"
                      id="forgot-email-input"
                      type="email"
                      inputMode="email"
                      value={email}
                      required
                      autoComplete="email"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      dir="ltr"
                      placeholder="yourname24001@comed.uobaghdad.edu.iq"
                      onChange={(e) => setEmail(e.target.value)}
                      icon={<Mail className="w-icon-sm h-icon-sm" />}
                      motionVariants={FIELD_V as any}
                    />

                    <motion.div variants={reduce ? undefined : FIELD_V as any}>
                      <motion.button
                        id="send-recovery-btn"
                        type="submit"
                        disabled={isLoading}
                        aria-busy={isLoading}
                        aria-label={isLoading ? "Sending recovery link, please wait" : "Send recovery link"}
                        {...btnMotion}
                        className={`w-full py-3 bg-med-dark dark:bg-med-gold hover:bg-neutral-800 dark:hover:bg-amber-400 text-[#D5C7B5] dark:text-black font-semibold text-caption rounded-xl shadow-elevation-1 flex items-center justify-center gap-2 cursor-pointer uppercase transition-colors duration-200 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-amber-400/60 ${isLoading ? "opacity-70 cursor-not-allowed" : ""}`}
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          {isLoading ? (
                            <motion.span key="loading"
                              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.1 }}
                              className="flex items-center gap-2"
                            >
                              <AuthSpinner /><span>Sending…</span>
                            </motion.span>
                          ) : (
                            <motion.span key="idle"
                              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.1 }}
                              className="flex items-center gap-2"
                            >
                              Send Recovery Link <ArrowRight aria-hidden="true" className="w-icon-sm h-icon-sm" />
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </motion.button>
                    </motion.div>

                    <motion.div variants={reduce ? undefined : FIELD_V as any} className="text-center pt-1">
                      <motion.button
                        id="cancel-forgot-btn"
                        type="button"
                        whileHover={reduce ? {} : { scale: 1.03 }}
                        whileTap={reduce  ? {} : { scale: 0.97 }}
                        transition={SP.tap}
                        onClick={() => go("login")}
                        className="text-secondary-label hover:text-med-blue dark:text-[#EBEBF599] dark:hover:text-amber-400 font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-med-blue dark:focus-visible:ring-amber-400 rounded-sm px-1"
                      >
                        Cancel and Return
                      </motion.button>
                    </motion.div>
                  </motion.div>
                </motion.form>
              )}

              {/* ── Registration onboarding flow ── */}
              {mode === "register" && (
                <motion.form
                  noValidate
                  id="registration-onboarding-form"
                  key="registration-onboarding-form"
                  initial={reduce ? false : sv.enter}
                  animate={sv.center}
                  exit={sv.exit}
                  transition={SP.gentle}
                  onSubmit={handleAuthSubmit}
                  className="w-full"
                >
                  <div
                    role="group"
                    aria-label={`Registration progress, step ${registerStep} of 5`}
                    className="mb-6"
                  >
                    <div className="flex items-center justify-between gap-1" aria-hidden="true">
                      {registerStepMeta.map((step, index) => {
                        const stepNumber = index + 1;
                        const StepIcon = step.icon;
                        const isCurrent = registerStep === stepNumber;
                        const isComplete = registerStep > stepNumber;
                        return (
                          <React.Fragment key={step.title}>
                            <div className="flex flex-col items-center gap-1.5 min-w-0">
                              <motion.div
                                animate={{
                                  scale: isCurrent ? 1.08 : 1,
                                  backgroundColor: isComplete || isCurrent ? "var(--color-med-dark, #1C1C1E)" : "transparent",
                                  color: isComplete || isCurrent ? "#D5C7B5" : "currentColor",
                                }}
                                transition={reduce ? { duration: 0 } : SP.snappy}
                                className={`w-8 h-8 rounded-full border flex items-center justify-center ${
                                  isCurrent || isComplete
                                    ? "border-med-dark dark:border-med-gold dark:bg-med-gold dark:text-black"
                                    : "border-med-beige/80 dark:border-white/20 text-med-muted dark:text-white/40"
                                }`}
                              >
                                {isComplete ? <CheckCircle className="w-4 h-4" /> : <StepIcon className="w-4 h-4" />}
                              </motion.div>
                              <span className={`hidden sm:block text-[10px] font-semibold text-center leading-tight ${
                                isCurrent ? "text-med-dark dark:text-med-gold" : "text-med-muted dark:text-white/45"
                              }`}>
                                {step.title}
                              </span>
                            </div>
                            {index < registerStepMeta.length - 1 && (
                              <div className="h-px flex-1 bg-med-beige/70 dark:bg-white/10 mx-1 relative overflow-hidden">
                                <motion.div
                                  className="absolute inset-y-0 left-0 bg-med-dark dark:bg-med-gold"
                                  initial={false}
                                  animate={{ width: registerStep > stepNumber ? "100%" : "0%" }}
                                  transition={reduce ? { duration: 0 } : { duration: 0.3, ease: "easeOut" }}
                                />
                              </div>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex items-center justify-between text-caption text-med-muted dark:text-white/45">
                      <span aria-live="polite" aria-atomic="true">Step {registerStep} of 5</span>
                      <span>{Math.round((registerStep / 5) * 100)}% complete</span>
                    </div>
                  </div>

                  <AnimatePresence mode="wait" initial={false} custom={direction}>
                    <motion.div
                      ref={registerStepRef}
                      key={`register-step-${registerStep}`}
                      initial={reduce ? false : { opacity: 0, x: direction > 0 ? 24 : -24 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={reduce ? { opacity: 0 } : { opacity: 0, x: direction > 0 ? -24 : 24 }}
                      transition={reduce ? { duration: 0 } : SP.gentle}
                      className="space-y-4"
                    >
                      {registerStep === 1 && (
                        <>
                          <AnimatedField
                            label="Full Name"
                            id="register-fullname-input"
                            type="text"
                            value={name}
                            required
                            autoComplete="name"
                            autoCorrect="off"
                            spellCheck={false}
                            placeholder="Mustafa Al-Saeed"
                            onChange={(e) => { setName(e.target.value); setError(""); }}
                            icon={<User className="w-icon-sm h-icon-sm" />}
                          />
                        </>
                      )}

                      {registerStep === 2 && (
                        <>
                          <AnimatedField
                            label="Student Email Address"
                            id="register-email-input"
                            type="email"
                            inputMode="email"
                            value={email}
                            required
                            autoComplete="email"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            dir="ltr"
                            placeholder="yourname24001@comed.uobaghdad.edu.iq"
                            onChange={(e) => {
                              setEmail(e.target.value);
                              setRegisterEmailValidationAttempted(false);
                              setError("");
                            }}
                            icon={<Mail className="w-icon-sm h-icon-sm" />}
                            validationState={registerEmailValidationAttempted && email && !isValidEmail(email) ? "invalid" : "idle"}
                            errorMessage={registerEmailValidationAttempted && email && !isValidEmail(email) ? "Enter a valid academic email address." : undefined}
                          />
                          <div className="flex flex-col">
                            {/* Label — colour-reactive like AnimatedField */}
                            <motion.label
                              htmlFor="register-group-select"
                              animate={{ color: (dark ? TOKENS.dark : TOKENS.light).label[groupFocused ? "focused" : groupHovered ? "hover" : "idle"] }}
                              transition={reduce ? { duration: 0 } : COLOR_TWEEN}
                              style={{ color: (dark ? TOKENS.dark : TOKENS.light).label[groupFocused ? "focused" : groupHovered ? "hover" : "idle"] }}
                              className="block text-subhead font-semibold uppercase select-none cursor-default mb-1.5"
                            >
                              Academic Group
                            </motion.label>
                            {/* Animated wrapper — same spring system as AnimatedField */}
                            <motion.div
                              animate={reduce ? undefined : {
                                borderColor:     (dark ? TOKENS.dark : TOKENS.light).border[groupFocused ? "focused" : groupHovered ? "hover" : "idle"],
                                boxShadow:       (dark ? TOKENS.dark : TOKENS.light).shadow[groupFocused ? "focused" : groupHovered ? "hover" : "idle"],
                                backgroundColor: (dark ? TOKENS.dark : TOKENS.light).bg[groupFocused ? "focused" : groupHovered ? "hover" : "idle"],
                              }}
                              transition={reduce ? { duration: 0 } : WRAP_SPRING}
                              style={{
                                borderColor:     (dark ? TOKENS.dark : TOKENS.light).border[groupFocused ? "focused" : groupHovered ? "hover" : "idle"],
                                boxShadow:       (dark ? TOKENS.dark : TOKENS.light).shadow[groupFocused ? "focused" : groupHovered ? "hover" : "idle"],
                                backgroundColor: (dark ? TOKENS.dark : TOKENS.light).bg[groupFocused ? "focused" : groupHovered ? "hover" : "idle"],
                              }}
                              className="relative rounded-xl border overflow-hidden"
                              onMouseEnter={() => setGroupHovered(true)}
                              onMouseLeave={() => setGroupHovered(false)}
                            >
                              <motion.div
                                aria-hidden="true"
                                animate={{ color: (dark ? TOKENS.dark : TOKENS.light).icon[groupFocused ? "focused" : groupHovered ? "hover" : "idle"] }}
                                transition={reduce ? { duration: 0 } : COLOR_TWEEN}
                                style={{ color: (dark ? TOKENS.dark : TOKENS.light).icon[groupFocused ? "focused" : groupHovered ? "hover" : "idle"] }}
                                className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none z-10"
                              >
                                <GraduationCap className="w-icon-sm h-icon-sm" />
                              </motion.div>
                              <select
                                id="register-group-select"
                                value={studentGroup}
                                onChange={(e) => setStudentGroup(e.target.value)}
                                onFocus={() => setGroupFocused(true)}
                                onBlur={() => setGroupFocused(false)}
                                style={{ paddingLeft: "48px", paddingRight: "40px" }}
                                className="relative z-0 w-full min-h-[48px] py-3 text-body bg-transparent outline-none focus:outline-none focus-visible:outline-none appearance-none text-neutral-800 dark:text-white cursor-pointer"
                              >
                                <option value="A">Group A</option>
                                <option value="B">Group B</option>
                                <option value="C">Group C</option>
                                <option value="D">Group D</option>
                              </select>
                              <ChevronLeft aria-hidden="true" className="absolute right-3 top-1/2 -translate-y-1/2 -rotate-90 w-4 h-4 pointer-events-none opacity-50" />
                            </motion.div>
                            <p className="mt-1.5 text-caption text-med-muted dark:text-white/45">You can update your group later in settings.</p>
                          </div>
                        </>
                      )}

                      {registerStep === 3 && (
                        <>
                          <AnimatedField
                            label="Create Password"
                            id="register-password-input"
                            type={showPassword ? "text" : "password"}
                            value={password}
                            required
                            autoFocus
                            maxLength={128}
                            autoComplete="new-password"
                            dir="ltr"
                            placeholder="At least 6 characters"
                            onChange={(e) => { setPassword(e.target.value); setError(""); }}
                            icon={<Lock className="w-icon-sm h-icon-sm" />}
                            hint="Use a password you do not use elsewhere."
                            rightElement={
                              <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((v) => !v)} className="text-med-sand hover:text-neutral-600 dark:hover:text-neutral-300 cursor-pointer">
                                {showPassword ? <EyeOff className="w-icon-sm h-icon-sm" /> : <Eye className="w-icon-sm h-icon-sm" />}
                              </button>
                            }
                          />
                          <AuthPasswordField
                            label="Confirm Password"
                            id="register-confirm-password-input"
                            value={confirmPassword}
                            required
                            maxLength={128}
                            autoComplete="new-password"
                            dir="ltr"
                            spellCheck={false}
                            autoCapitalize="none"
                            autoCorrect="off"
                            placeholder="Re-enter your password"
                            onChange={(e) => { setConfirmPassword(e.target.value); setError(""); }}
                            icon={<Lock className="w-icon-sm h-icon-sm" />}
                            validationState={confirmPassword && password === confirmPassword ? "valid" : "idle"}
                          />
                          {/* Custom animated checkbox */}
                          <div className="flex items-start gap-3 px-1 pt-1">
                            <div className="relative shrink-0 mt-0.5 w-5 h-5">
                              <input
                                type="checkbox"
                                id="register-terms-checkbox"
                                checked={termsAccepted}
                                onChange={(e) => { setTermsAccepted(e.target.checked); setError(""); }}
                                className="peer absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                              />
                              <motion.div
                                aria-hidden="true"
                                animate={{
                                  backgroundColor: termsAccepted
                                    ? (dark ? "rgb(245,158,11)" : "rgb(0,122,255)")
                                    : "transparent",
                                  borderColor: termsAccepted
                                    ? (dark ? "rgb(245,158,11)" : "rgb(0,122,255)")
                                    : (dark ? "rgba(255,255,255,0.22)" : "rgb(209,209,214)"),
                                }}
                                transition={reduce ? { duration: 0 } : { duration: 0.15 }}
                                className="absolute inset-0 rounded-[5px] border-2 flex items-center justify-center pointer-events-none"
                              >
                                <AnimatePresence>
                                  {termsAccepted && (
                                    <motion.svg
                                      key="check"
                                      initial={reduce ? false : { scale: 0, opacity: 0 }}
                                      animate={{ scale: 1, opacity: 1 }}
                                      exit={reduce ? {} : { scale: 0.3, opacity: 0 }}
                                      transition={{ type: "spring", stiffness: 600, damping: 28, mass: 0.4 }}
                                      className="w-3 h-3"
                                      viewBox="0 0 12 12"
                                      fill="none"
                                      aria-hidden
                                    >
                                      <motion.path
                                        d="M2 6l3 3 5-5"
                                        stroke="white"
                                        strokeWidth="2.2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        initial={reduce ? false : { pathLength: 0 }}
                                        animate={{ pathLength: 1 }}
                                        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                                      />
                                    </motion.svg>
                                  )}
                                </AnimatePresence>
                              </motion.div>
                            </div>
                            <label htmlFor="register-terms-checkbox" className="text-caption text-neutral-500 dark:text-[#EBEBF599] leading-tight cursor-pointer select-none">
                              I agree to the{" "}
                              <button type="button" onClick={openTerms} className="text-med-blue dark:text-amber-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-med-blue dark:focus-visible:ring-amber-400 rounded-sm px-0.5">Terms of Service</button>{" "}and{" "}
                              <button type="button" onClick={openPrivacy} className="text-med-blue dark:text-amber-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-med-blue dark:focus-visible:ring-amber-400 rounded-sm px-0.5">Privacy Policy</button>
                              {" "}and confirm I am an authorized medical student.
                            </label>
                          </div>
                        </>
                      )}

                      {registerStep === 4 && (
                        <div className="space-y-3">
                          <div className="rounded-2xl border border-med-beige/60 dark:border-white/10 overflow-hidden">
                            <div className="px-4 py-3 bg-med-bg/70 dark:bg-white/[0.04] border-b border-med-beige/50 dark:border-white/[0.08]">
                              <p className="text-caption uppercase tracking-wide font-semibold text-med-muted dark:text-white/50">Account summary</p>
                            </div>
                            <div className="divide-y divide-med-beige/40 dark:divide-white/[0.08]">
                              {[
                                ["Full name", name],
                                ["Student email", email],
                                ["Academic group", `Group ${studentGroup}`],
                                ["Password", "••••••••"],
                              ].map(([label, value]) => (
                                <div key={label} className="px-4 py-3 flex items-center justify-between gap-4">
                                  <span className="text-caption text-med-muted dark:text-white/50">{label}</span>
                                  <span className="text-caption font-semibold text-neutral-800 dark:text-white text-right break-all">{value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {registerStep === 5 && (
                        <div
                          ref={successPanelRef}
                          tabIndex={-1}
                          role="status"
                          aria-live="polite"
                          aria-label={isLoading ? "Creating your account" : "Registration complete"}
                          className="text-center py-6 focus:outline-none"
                        >
                          {/* Animated check / spinner */}
                          <motion.div
                            initial={reduce ? false : { scale: 0.44, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 20, mass: 1 }}
                            className="flex justify-center mb-6"
                          >
                            <div className="relative">
                              <div className="absolute inset-0 rounded-full bg-emerald-400/15 dark:bg-emerald-400/10 blur-2xl scale-[1.7]" />
                              <div className="relative text-emerald-500 dark:text-emerald-400">
                                {isLoading ? (
                                  <div className="w-[88px] h-[88px] flex items-center justify-center">
                                    <AuthSpinner size="lg" className="text-emerald-500 dark:text-emerald-400" />
                                  </div>
                                ) : (
                                  <AuthAnimatedCheck size={88} />
                                )}
                              </div>
                            </div>
                          </motion.div>

                          {/* Copy — stagger in after check draws */}
                          <motion.div
                            variants={reduce ? undefined : STAGGER_V}
                            initial={reduce ? false : "hidden"}
                            animate="visible"
                            className="space-y-2"
                          >
                            <motion.h3
                              variants={reduce ? undefined : FIELD_V}
                              transition={{ ...SP.gentle, delay: isLoading ? 0 : 0.55 }}
                              className="text-[21px] font-display font-semibold text-neutral-800 dark:text-white tracking-tight"
                            >
                              {isLoading
                                ? "Creating your account…"
                                : `Welcome, ${name.split(" ")[0] || "Doctor"}`}
                            </motion.h3>
                            <motion.p
                              variants={reduce ? undefined : FIELD_V}
                              transition={{ ...SP.gentle, delay: isLoading ? 0 : 0.63 }}
                              className="text-secondary-label dark:text-[#EBEBF599] max-w-[280px] mx-auto leading-relaxed"
                            >
                              {isLoading
                                ? "Preparing your secure student profile."
                                : "Your account is active. Loading your medical education workspace."}
                            </motion.p>
                          </motion.div>

                          {/* Progress indicator */}
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={reduce ? { duration: 0 } : { delay: isLoading ? 0.2 : 0.84, duration: 0.35 }}
                            className="mt-7"
                          >
                            <PulsingDots reduce={reduce} />
                          </motion.div>
                        </div>
                      )}
                    </motion.div>
                  </AnimatePresence>

                  {registerStep < 5 && (
                    <div className="flex gap-3 mt-6">
                      <motion.button
                        type="button"
                        aria-label={registerStep === 1 ? "Cancel and go back to sign in" : "Go back to previous step"}
                        onClick={registerStep === 1 ? () => go("login") : handleRegisterBack}
                        {...btnMotion}
                        className="flex-1 min-h-[48px] rounded-xl border border-med-beige/70 dark:border-white/15 text-neutral-700 dark:text-white font-semibold text-caption flex items-center justify-center gap-2 hover:bg-med-bg dark:hover:bg-white/[0.06] cursor-pointer focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-amber-400/60"
                      >
                        <ChevronLeft aria-hidden="true" className="w-4 h-4" />
                        {registerStep === 1 ? "Sign in" : "Back"}
                      </motion.button>
                      <motion.button
                        id="registration-next-btn"
                        type="submit"
                        disabled={isLoading}
                        aria-busy={isLoading}
                        aria-label={registerStep === 4 ? (isLoading ? "Creating account, please wait" : "Create account") : "Continue to next step"}
                        {...btnMotion}
                        className={`flex-[1.35] min-h-[48px] rounded-xl bg-med-dark dark:bg-med-gold hover:bg-neutral-800 dark:hover:bg-amber-400 text-[#D5C7B5] dark:text-black font-semibold text-caption flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-amber-400/60 ${isLoading ? "opacity-70 cursor-not-allowed" : ""}`}
                      >
                        {registerStep === 4
                          ? (isLoading
                            ? <><AuthSpinner /><span>Creating…</span></>
                            : <><span>Create account</span><CheckCircle aria-hidden="true" className="w-4 h-4" /></>)
                          : <><span>Continue</span><ChevronRight aria-hidden="true" className="w-4 h-4" /></>}
                      </motion.button>
                    </div>
                  )}
                </motion.form>
              )}

              {/* ── Login form ── */}
              {mode === "login" && (
                <motion.form
                  noValidate
                  id="auth-form"
                  key={mode}
                  initial={reduce ? false : sv.enter}
                  animate={sv.center}
                  exit={sv.exit}
                  transition={SP.gentle}
                  onSubmit={handleAuthSubmit}
                >
                  <motion.div
                    variants={reduce ? undefined : STAGGER_V}
                    initial={reduce ? false : "hidden"}
                    animate="visible"
                    className="space-y-4 md:space-y-5"
                  >
                    {/* Email */}
                    <AnimatedField
                      label="Student Email Address"
                      id="auth-email-input"
                      type="email"
                      inputMode="email"
                      value={email}
                      required
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      dir="ltr"
                      placeholder="yourname24001@comed.uobaghdad.edu.iq"
                      onChange={(e) => setEmail(e.target.value)}
                      icon={<Mail className="w-icon-sm h-icon-sm" />}
                      motionVariants={FIELD_V as any}
                    />

                    {/* Password */}
                    <AnimatedField
                      label="Security Password"
                      labelRight={mode === "login" ? (
                        <motion.button
                          id="auth-forgot-password-link"
                          type="button"
                          whileHover={reduce ? {} : { scale: 1.03 }}
                          whileTap={reduce  ? {} : { scale: 0.97 }}
                          transition={SP.tap}
                          onClick={() => go("forgot")}
                          className="text-secondary-label hover:text-med-blue dark:text-[#EBEBF599] dark:hover:text-amber-400 font-semibold cursor-pointer transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-med-blue"
                        >
                          Forgot Password?
                        </motion.button>
                      ) : undefined}
                      id="auth-password-input"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      required
                      maxLength={128}
                      autoComplete="current-password"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      dir="ltr"
                      placeholder="••••••••"
                      onChange={(e) => setPassword(e.target.value)}
                      icon={<Lock className="w-icon-sm h-icon-sm" />}
                      motionVariants={FIELD_V as any}
                      rightElement={
                        <motion.button
                          id="auth-password-toggle-btn"
                          type="button"
                          aria-label={showPassword ? "Hide password" : "Show password"}
                          aria-pressed={showPassword}
                          whileHover={reduce ? {} : { scale: 1.15 }}
                          whileTap={reduce  ? {} : { scale: 0.88 }}
                          transition={SP.tap}
                          onClick={() => setShowPassword((v) => !v)}
                          className="text-med-sand hover:text-neutral-600 dark:hover:text-neutral-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 rounded"
                        >
                          {showPassword
                            ? <EyeOff aria-hidden="true" className="w-icon-sm h-icon-sm" />
                            : <Eye    aria-hidden="true" className="w-icon-sm h-icon-sm" />}
                        </motion.button>
                      }
                    />

                    {/* Submit */}
                    <motion.div variants={FIELD_V as any}>
                      <motion.button
                        id="auth-submit-btn"
                        type="submit"
                        disabled={isLoading}
                        aria-busy={isLoading}
                        aria-label={isLoading ? "Verifying credentials, please wait" : "Sign in to your dashboard"}
                        whileHover={reduce || isLoading ? {} : { scale: 1.015 }}
                        whileTap={reduce  || isLoading ? {} : { scale: 0.985 }}
                        transition={SP.tap}
                        className={`w-full mt-2 py-3 bg-med-dark dark:bg-med-gold hover:bg-neutral-800 dark:hover:bg-amber-400 text-[#D5C7B5] dark:text-black font-semibold text-caption rounded-xl shadow-elevation-1 flex items-center justify-center gap-2 cursor-pointer uppercase transition-colors duration-200 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-amber-400/60 ${isLoading ? "opacity-70 cursor-not-allowed" : ""}`}
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          {isLoading ? (
                            <motion.span key="loading"
                              initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.1 }}
                              className="flex items-center gap-2 font-semibold"
                            >
                              <AuthSpinner /><span>Verifying…</span>
                            </motion.span>
                          ) : mode === "login" ? (
                            <motion.span key="signin"
                              initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.1 }}
                              className="flex items-center gap-2 font-semibold"
                            >
                              Sign In to Dashboard <ArrowRight aria-hidden="true" className="w-icon-sm h-icon-sm" />
                            </motion.span>
                          ) : (
                            <motion.span key="register"
                              initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.1 }}
                              className="flex items-center gap-2 font-semibold"
                            >
                              Register Account <ArrowRight aria-hidden="true" className="w-icon-sm h-icon-sm" />
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </motion.button>
                    </motion.div>

                    {/* Social divider */}
                    <motion.div variants={FIELD_V as any} className="relative my-2 text-center">
                      <span className="h-px bg-med-beige/80 dark:bg-white/[0.08] w-full block absolute top-1/2 -translate-y-1/2" />
                      <span className="bg-[#F8F9FC] dark:bg-[#1C1C1E] px-3 relative text-caption text-med-muted dark:text-[#EBEBF599] uppercase font-semibold tracking-widest">
                        OR CONNECT WITH
                      </span>
                    </motion.div>

                    {/* Social buttons */}
                    <motion.div variants={FIELD_V as any} className="flex flex-col gap-3">
                      <AuthSocialButton
                        id="auth-google-btn"
                        label="Continue with Google"
                        status={socialState["google"] ?? "idle"}
                        anyLoading={Object.values(socialState).some(s => s === "loading")}
                        onClick={() => handleSocialLogin("Google")}
                        icon={
                          <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden>
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
                          </svg>
                        }
                      />
                      {/* Apple Sign-In — Apple HIG: logo adapts to light/dark */}
                      <AuthSocialButton
                        id="auth-apple-btn"
                        label="Continue with Apple"
                        status={socialState["apple"] ?? "idle"}
                        anyLoading={Object.values(socialState).some(s => s === "loading")}
                        onClick={() => handleSocialLogin("apple")}
                        icon={
                          <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden fill="currentColor">
                            <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.42c1.32.07 2.23.73 3 .78 1.15-.18 2.24-.86 3.46-.78 1.46.12 2.56.63 3.28 1.62-3.01 1.81-2.29 5.77.71 6.9-.52 1.39-1.2 2.76-2.45 4.34zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                          </svg>
                        }
                      />
                    </motion.div>

                    {/* Toggle login ↔ register */}
                    <motion.div variants={FIELD_V as any} className="text-center pt-2">
                      <motion.button
                        id="auth-toggle-mode-btn"
                        type="button"
                        aria-label={mode === "login" ? "New student? Create a free account" : "Already registered? Sign in"}
                        whileHover={reduce ? {} : { scale: 1.03 }}
                        whileTap={reduce  ? {} : { scale: 0.97 }}
                        transition={SP.tap}
                        onClick={() => go(mode === "login" ? "register" : "login")}
                        className="text-secondary-label hover:text-med-blue dark:text-[#EBEBF599] dark:hover:text-amber-400 font-semibold cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 rounded-sm px-1"
                      >
                        {mode === "login" ? (
                          <span>New student?{" "}
                            <span className="text-med-teal dark:text-amber-400 underline font-semibold">Create account</span>
                          </span>
                        ) : (
                          <span>Already registered?{" "}
                            <span className="text-med-blue dark:text-amber-400 underline font-semibold">Sign In</span>
                          </span>
                        )}
                      </motion.button>
                    </motion.div>

                  </motion.div>
                </motion.form>
              )}
            </AnimatePresence>

          </motion.div>

          {/* ── Privacy footer ── */}
          <motion.div
            id="auth-privacy-footer"
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SP.gentle, delay: 0.35 }}
            className="mt-8 text-center max-w-xs text-caption text-med-muted dark:text-[#EBEBF599] p-3 bg-white/40 dark:bg-[#1C1C1E]/30 border border-med-beige/40 dark:border-white/[0.05] rounded-md select-none"
          >
            <div className="flex items-center justify-center gap-1.5 font-semibold mb-1">
              <ShieldCheck aria-hidden="true" className="w-3.5 h-3.5 text-med-teal dark:text-amber-400/80 shrink-0" />
              <span>Privacy &amp; Medical Integrity</span>
            </div>
            <p>Exclusive to Medical Students. Passwords encrypted. Multi-device syncing enabled locally.</p>
          </motion.div>

        </div>
        <div className="flex-grow shrink-0 min-h-[20px] max-h-[10vh]" />
      </div>

      {/* ── Terms / Privacy modal ── */}
      <AnimatePresence>
        {(showTerms || showPrivacy) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeModal();
            }}
          >
            <motion.div
              ref={modalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="legal-modal-title"
              initial={{ scale: 0.93, y: 18, opacity: 0 }}
              animate={{ scale: 1,    y: 0,  opacity: 1 }}
              exit={{    scale: 0.93, y: 18, opacity: 0 }}
              transition={SP.gentle}
              className="bg-white dark:bg-[#1c1c1e] w-full max-w-md rounded-2xl p-6 shadow-elevation-3 max-h-[80vh] overflow-y-auto"
            >
              <h3
                id="legal-modal-title"
                className="text-xl font-semibold mb-4 text-neutral-900 dark:text-white"
              >
                {showTerms ? "Terms of Service" : "Privacy Policy"}
              </h3>
              <div className="text-sm text-neutral-600 dark:text-[#EBEBF599] space-y-4">
                {showTerms ? (
                  <>
                    <p>1. <strong>Acceptance:</strong> By using this application, you agree to abide by these terms. This application is exclusively for medical students.</p>
                    <p>2. <strong>User Content:</strong> You are responsible for any materials or comments you post. Do not post offensive, illegal, or copyrighted material without permission.</p>
                    <p>3. <strong>Moderation:</strong> We reserve the right to remove any content and revoke access for users who violate these terms.</p>
                    <p>4. <strong>Accountability:</strong> Do not share your account credentials. You are responsible for all activities that occur under your account.</p>
                    <p>5. <strong>Medical Disclaimer:</strong> The application is intended exclusively for education and study. It must never be used for diagnosis or replace professional medical advice.</p>
                  </>
                ) : (
                  <>
                    <p>1. <strong>Data Collection:</strong> We collect your name, email, and academic group for authentication and app functionality.</p>
                    <p>2. <strong>Usage:</strong> Your data is used exclusively within the educational context to provide features like scheduling, leaderboards, and file sharing.</p>
                    <p>3. <strong>Data Sharing:</strong> We do not sell or share your personal data with third-party marketers.</p>
                    <p>4. <strong>Deletion:</strong> You can permanently delete your account and all associated data from the Settings screen at any time.</p>
                  </>
                )}
              </div>
              <motion.button
                aria-label={`Close ${showTerms ? "Terms of Service" : "Privacy Policy"} dialog`}
                whileTap={reduce ? {} : { scale: 0.97 }}
                transition={SP.tap}
                onClick={closeModal}
                className="mt-6 w-full py-2.5 rounded-xl bg-med-blue dark:bg-amber-500 text-white dark:text-black font-semibold text-sm transition-colors duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-amber-400/60"
              >
                Understood
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
