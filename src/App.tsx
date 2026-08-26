import { ErrorBoundary } from "./components/ErrorBoundary";
import { safeJsonParse } from "./core/utils/safeJson";
import { SecureStorage } from "./core/utils/secureStorage";
import { HapticFeedback } from "./core/device/haptic";
import { apiClient, clearApiCache } from "./core/api/apiClient";
import { getApiBaseUrl } from "./core/api/api";
import { getUniqueSubjectLectures, countUniqueSubjectLectures } from "./core/utils/subjectLectureCounts";
import { formatToBaghdadISO, dayjs } from "./core/utils/timezone";
import AppLogo from "./components/ui/AppLogo";
import { CommandPalette, SearchResultItem } from "./components/ui/CommandPalette";
import IOSAlert from "./core/layout/iOSAlert";
import { showiOSAlert } from "./core/device/alert";
import { Language, useTranslation } from "./core/i18n/translations";
import { OfflineEngine } from "./core/offline/OfflineEngine";
import { IDBManager } from "./core/utils/indexedDB";
import { DataSyncManager } from "./core/offline/DataSyncManager";
import { CacheManager, CACHE_TTL } from "./core/cache/CacheManager";
import { accountStorageKey, clearAccountData, getActiveAccountId, setActiveAccountId } from "./core/storage/accountData";
import { useDeviceProfile } from "./core/hooks/useDeviceProfile";
import { useUserPreferences } from "./core/hooks/useUserPreferences";
import { NativeBridge } from "./core/device/capacitor/nativeBridge";
import {
  Home,
  BookOpen,
  Layers3,
  Calendar as CalIcon,
  User as UserIcon,
  Bell,
  ChevronRight,
  ChevronLeft,
  LogOut,
  Settings,
  Database,
  X,
} from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { useSwipeBack } from "./core/hooks/useSwipeBack";
import { UserAvatar } from "./features/profile/components/UserAvatar";
import { SidebarNavItem } from "./core/layout/SidebarNavItem";
import { TabBarItem } from "./core/layout/TabBarItem";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useLayoutEffect,
  Suspense,
  memo,
  lazy,
} from "react";
import { io } from "socket.io-client";
import { toast } from "sonner";
import {
  User,
  Subject,
  Lecture,
  UserProgress,
  PointsLog,
  CalendarEvent,
  SubjectId,
  DatabaseLecture,
  AppNotification,
} from "./core/types";
import { subjects as seedSubjects, initialCalendarEvents } from "./core/constants/seedData";
import { DashboardSkeleton } from "./components/ui/Skeleton";
import { navigateInApp } from "./core/routing/clientNavigation";
import { preloadModuleArtwork } from "./features/modules/moduleVisuals";
import {
  AuthScreen,
  ProfileCompletionScreen,
  ResetPasswordScreen,
  HomeDashboard,
  ModulesView,
  ModulePlaceholderView,
  SubjectView,
  LectureDetailView,
  CalendarView,
  ProfileView,
  ControlCenterView,
  SettingsView,
  PrivacyPolicyView,
  TermsOfServiceView,
  SupportView,
  MedicalDisclaimerView,
  BulletinCenter,
  EditCalendarEvent,
  AppleEmailSelectionScreen,
} from "./core/routing/appLazyRoutes";

// Warm and decode all seven module artworks as soon as the main app bundle evaluates.
// This runs before the user can navigate to Modules, so WKWebView does not first-paint
// the low-resolution preview and then wait for a module-detail visit to decode the image.
if (typeof window !== "undefined") {
  void preloadModuleArtwork();
}

// Reusable Apple-Quality Fallback Skeleton (Apple Human Interface Guidelines)
const iOSLoadingFallback = <DashboardSkeleton />;

const handleSidebarKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
  if (e.key === "Escape") {
    const activeElement = document.activeElement as HTMLElement;
    if (activeElement) activeElement.blur();
    return;
  }

  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const nav = e.currentTarget;
    const buttons = Array.from(
      nav.querySelectorAll("button"),
    ) as HTMLButtonElement[];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;

    const nextIndex =
      e.key === "ArrowDown"
        ? (index + 1) % buttons.length
        : (index - 1 + buttons.length) % buttons.length;

    buttons[nextIndex].focus();
  }
};

const SuspensionScreen = lazy(() => import("./features/auth/components/SuspensionScreen"));

type BanInfo = { reason: string | null; isPermanent: boolean; endTime: string | null };
type AuthState = "INITIALIZING" | "AUTHENTICATED" | "UNAUTHENTICATED" | "AUTH_ERROR";

export default function App() {
  const device = useDeviceProfile();
  const shouldReduceMotion = useReducedMotion();

  // --- Core Session States ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  // Socket callbacks read this ref so profile/group updates are visible without
  // tearing down and recreating the connection for the same authenticated user.
  const currentUserRef = useRef<User | null>(currentUser);
  currentUserRef.current = currentUser;
  // Guards against duplicate handling of the same event wave. Parallel protected
  // requests (e.g. several in-flight GETs) that 401 together each dispatch
  // app-session-expired; the first handler run clears the session, so the rest
  // must be no-ops. Reset whenever a fresh session is established.
  const sessionExpiredHandledRef = useRef(false);
  // StrictMode intentionally re-runs mount effects in development. Keep startup
  // session restoration single-flight even across that lifecycle probe.
  const sessionRestoreStartedRef = useRef(false);
  // The redirect handoff must also be single-flight; two recovery POSTs can
  // otherwise race Google's one-time code and make Safari report a false error.
  const oauthRecoveryStartedRef = useRef(false);
  // A popup success message and the polling fallback can describe the same
  // session. Only perform the bearer-to-/me handoff once per token so a slow
  // duplicate callback cannot race authenticated state with an error.
  const oauthSessionCompletionRef = useRef<string | null>(null);
  // Deduplicates identical error toasts fired in quick succession from parallel
  // failing requests, so the user sees one toast instead of 2–3 stacked copies.
  const lastApiErrorToastRef = useRef<{ message: string; at: number } | null>(null);
  const [bannedInfo, setBannedInfo] = useState<BanInfo | null>(null);
  // Stores ban payload from userBanNotification so userForcedLogout can read it
  const lastBanDataRef = useRef<BanInfo | null>(null);
  useEffect(() => {
    if (currentUser) {
      OfflineEngine.setSyncPaused(false);
      OfflineEngine.processQueue();
    }
  }, [currentUser]);

  // Auto-restore access when a timed ban expires on the client side
  useEffect(() => {
    if (!bannedInfo || bannedInfo.isPermanent || !bannedInfo.endTime) return;
    const ms = new Date(bannedInfo.endTime).getTime() - Date.now();
    if (ms <= 0) { setBannedInfo(null); return; }
    const id = setTimeout(() => setBannedInfo(null), ms);
    return () => clearTimeout(id);
  }, [bannedInfo]);

  // Add listener for global ban event (any 403+banned API response while app is open)
  useEffect(() => {
    const handleBanEvent = (e: Event) => {
      const detail = (e as CustomEvent<any>).detail;
      if (!detail?.banned) return;
      SecureStorage.remove("auth_token");
      SecureStorage.remove("logged_user");
      setActiveAccountId(null);
      setCurrentUser(null);
      setBannedInfo({
        reason: detail.reason ?? null,
        isPermanent: detail.isPermanent ?? true,
        endTime: detail.endTime ?? null,
      });
    };
    const handleBanRemoved = async () => {
      setBannedInfo(null);
      try {
        const response = await apiClient("/api/auth/me", { bypassCache: true });
        if (response.ok) {
          const user = await response.json();
          setCurrentUser(user);
          setAuthState("AUTHENTICATED");
        } else {
          setAuthState("UNAUTHENTICATED");
        }
      } catch (err) {
        setAuthState("UNAUTHENTICATED");
      }
    };
    window.addEventListener("user-account-banned", handleBanEvent);
    window.addEventListener("socket-user-ban-removed", handleBanRemoved);
    return () => {
      window.removeEventListener("user-account-banned", handleBanEvent);
      window.removeEventListener("socket-user-ban-removed", handleBanRemoved);
    };
  }, []);

  // Fetch current user's mute status on login / user-change
  useEffect(() => {
    if (!currentUser) { setMuteStatus(null); return; }
    apiClient("/api/user/mute-status")
      .then((r) => r.ok ? r.json() : null)
      .then((data: any) => { if (data?.isMuted) setMuteStatus(data); else setMuteStatus(null); })
      .catch(() => {});
  }, [currentUser?.id]);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [authState, setAuthState] = useState<AuthState>("INITIALIZING");
  const [activeTab, setActiveTab] = useState<string>("home"); // home | subjects | calendar | pomodoro | profile | settings
  const [oauthRedirectError, setOauthRedirectError] = useState<string | null>(null);
  const [verificationRedirectError, setVerificationRedirectError] = useState<string | null>(null);
  const [oauthRecoveryPending, setOauthRecoveryPending] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      const query = new URLSearchParams(window.location.search);
      return query.has("oauth_pending") || Boolean(localStorage.getItem("_oauth_pending_token"));
    } catch {
      return false;
    }
  });
  const [pathname, setPathname] = useState(() => window.location.pathname);
  // Apple email selection onboarding: true when an Apple user hasn't chosen their profile email
  const [appleEmailSelectionNeeded, setAppleEmailSelectionNeeded] = useState(false);
  const [appleEmailSelectionData, setAppleEmailSelectionData] = useState<{ userName: string; appleEmail: string } | null>(null);

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    // Tablets (480–1179 px) start with the sidebar collapsed to keep content breathing room.
    // Desktop starts expanded. SSR-safe guard included.
    if (typeof window === "undefined") return false;
    const w = window.innerWidth;
    return w >= 480; // Unified with tablet
  });

  // Brief window flag during the sidebar collapse/expand transition. Applies
  // `.sidebar-animating` to the app root, which pauses the home hero's
  // continuous animations (starfield rAF + aurora CSS) so the toggle stays
  // smooth on the welcome page instead of fighting the hero for layout and
  // repaint time. Skips the initial mount so it only fires on real toggles.
  const sidebarAnimatingSkipMount = useRef(true);
  const [isSidebarAnimating, setIsSidebarAnimating] = useState(false);
  useEffect(() => {
    if (sidebarAnimatingSkipMount.current) {
      sidebarAnimatingSkipMount.current = false;
      return;
    }
    setIsSidebarAnimating(true);
    const t = setTimeout(() => setIsSidebarAnimating(false), 320);
    return () => clearTimeout(t);
  }, [isSidebarCollapsed]);

  // Auto-manage sidebar collapse when the device tier changes (e.g. browser resize).
  // Must be top-level (before any early returns) to satisfy Rules of Hooks.
  useEffect(() => {
    if (device.isTablet && !device.railNav) {
      setIsSidebarCollapsed(true);   // larger tablet: start collapsed, user can expand
    } else if (device.isDesktop) {
      setIsSidebarCollapsed(true);  // desktop: unified to start collapsed like iPad
    }
    // phone / railNav: no sidebar state to manage
  }, [device.deviceType, device.railNav]);

  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [activeToast, setActiveToast] = useState<{
    id: string;
    title: string;
    desc: string;
  } | null>(null);
  const [isProfileDropdownOpen, setProfileDropdownOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInputFocused = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;

      if ((e.metaKey || e.ctrlKey) && e.key === "b" && !isInputFocused) {
        e.preventDefault();
        setIsSidebarCollapsed((prev) => !prev);
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }

      // Quick tab navigation (Cmd+1 to Cmd+6) - Desktop only
      if ((e.metaKey || e.ctrlKey) && !isInputFocused) {
        switch (e.key) {
          case "1": e.preventDefault(); setActiveTab("home"); break;
          case "2": e.preventDefault(); setActiveTab("subjects"); break;
          case "3": e.preventDefault(); setActiveTab("calendar"); break;
          case "4": e.preventDefault(); setActiveTab("pomodoro"); break;
          case "5": e.preventDefault(); setActiveTab("profile"); break;
          case "6": e.preventDefault(); setActiveTab("settings"); break;
        }
      }

      if (e.key === "/" && !isInputFocused) {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Native iOS Integration & Offline State
  const [isOnline, setIsOnline] = useState<boolean>(NativeBridge.isOnline());
  const [isActive, setIsActive] = useState<boolean>(true);
  const [keyboardState, setKeyboardState] = useState<{
    isOpen: boolean;
    keyboardHeight: number;
  }>({ isOpen: false, keyboardHeight: 0 });

  // iOS/iPadOS foreground restoration guard.
  //
  // When WKWebView returns from the app switcher it can briefly expose the
  // intermediate app-card viewport while the native zoom animation is still
  // finishing. Updating React/device layout or refreshing server data during
  // that tiny window makes the UI visibly reflow like a website. Keep the
  // existing screen untouched until the native surface has settled.
  const lifecycleActiveRef = useRef(true);
  const resumeSettlingRef = useRef(false);

  useEffect(() => {
    // Initialize edge-to-edge / full-screen native UI first — must run before
    // any status-bar style calls so the overlay flag is set on Android.
    NativeBridge.initializeFullScreen();

    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    const RESUME_SETTLE_MS = 360;

    const clearResumeTimer = () => {
      if (resumeTimer) {
        clearTimeout(resumeTimer);
        resumeTimer = null;
      }
    };

    const unbindNetwork = NativeBridge.onNetworkChange((online) => {
      setIsOnline(online);

      // Never kick a data refresh while the native app-switcher transition is
      // still restoring the WebView. The normal active-state effect below will
      // refresh once, after the UI is stable.
      if (
        online &&
        lifecycleActiveRef.current &&
        !resumeSettlingRef.current
      ) {
        refreshAcademicDataRef.current?.(true);
      }
    });

    const unbindLifecycle = NativeBridge.addAppLifecycleListener((active) => {
      clearResumeTimer();
      lifecycleActiveRef.current = active;

      if (!active) {
        resumeSettlingRef.current = false;
        // Tell responsive hooks to ignore the app-switcher card viewport.
        window.dispatchEvent(new Event("99s-app-background"));
        setIsActive(false);
        return;
      }

      // Freeze responsive measurements immediately on foreground. Do NOT force
      // a synthetic resize/reflow here: doing so is exactly what exposes the
      // transient WKWebView dimensions in the UI.
      resumeSettlingRef.current = true;
      window.dispatchEvent(new Event("99s-app-resume"));

      resumeTimer = setTimeout(() => {
        resumeTimer = null;
        resumeSettlingRef.current = false;
        setIsActive(true);
        window.dispatchEvent(new Event("99s-app-resume-settled"));
        // No direct refresh here. The existing [currentUser, isActive] effect
        // performs one normal refresh after isActive becomes true, avoiding a
        // duplicate foreground burst and the visible repaint it caused.
      }, RESUME_SETTLE_MS);
    });

    const unbindKeyboard = NativeBridge.listenToKeyboard((state) => {
      setKeyboardState(state);
    });

    return () => {
      clearResumeTimer();
      unbindNetwork();
      unbindLifecycle();
      unbindKeyboard();
    };
       
  }, []);

  const initialPrefs = useMemo(() => {
    let theme: "light" | "dark" | "system" = "system";
    let lang: "en" | "ar" = "en";
    let pushAlerts = true;
    try {
      theme = (localStorage.getItem("app_theme") as any) || "system";
      lang = (localStorage.getItem("app_language") as any) || "en";
      const pushPref = localStorage.getItem("app_push_alerts");
      pushAlerts = pushPref ? pushPref === "true" : true;
    } catch {}
    return { theme, language: lang, pushAlerts };
       
  }, []);
  const { preferences, updatePreference, resolvedTheme } =
    useUserPreferences(initialPrefs);

  // Sync iOS native status bar style with app theme
  useEffect(() => {
    NativeBridge.setStatusBarStyle(resolvedTheme as "light" | "dark");
  }, [resolvedTheme]);

  const language = preferences.language;
  const { t } = useTranslation(language);
  const setLanguage = (lang: "en" | "ar") => {
    updatePreference("language", lang);
    try {
      localStorage.setItem("app_language", lang);
    } catch {}
  };
  const theme = preferences.theme;
  const setTheme = (t: "light" | "dark" | "system") => {
    updatePreference("theme", t);
    try {
      localStorage.setItem("app_theme", t);
    } catch {}
  };

  const isRtl = language === "ar";
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  }, [language]);

  // Unified Apple-quality iOS style sliding transitions with hardware-accelerated attributes
  const pageTransitionVariants = {
    initial: {
      opacity: 0,
      x: isRtl ? -80 : 80,
      scale: 0.99,
      willChange: "transform, opacity",
    },
    animate: {
      opacity: 1,
      x: 0,
      scale: 1,
      transition: {
        type: "spring",
        stiffness: 400,
        damping: 40,
        mass: 1,
        restDelta: 0.001,
      },
    },
    exit: {
      opacity: 0,
      x: isRtl ? 80 : -80,
      scale: 0.99,
      transition: {
        type: "spring",
        stiffness: 400,
        damping: 40,
        mass: 1,
        restDelta: 0.001,
      },
    },
  };

  const [textScale, setTextScale] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("app_text_scale");
      return saved ? parseFloat(saved) : 1.0;
    } catch {
      return 1.0;
    }
  });

  const pushAlertsRef = useRef(preferences.pushAlerts);
  useEffect(() => {
    pushAlertsRef.current = preferences.pushAlerts;
  }, [preferences.pushAlerts]);

  // Socket.io Integration for Real-Time Presence and Upsert Tracking
  useEffect(() => {
    if (!currentUser || !isActive) return;

    // Connect to Socket.io server using standard origin configuration
    const backendUrl = getApiBaseUrl() || window.location.origin;
    const socket = io(backendUrl, {
      transports: ["websocket", "polling"],
      // The backend derives identity from the verified session token. The query
      // userId is intentionally not used as an identity claim.
      auth: {},
      autoConnect: false,
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    let socketDisposed = false;
    void SecureStorage.get("auth_token").then((token) => {
      if (socketDisposed) return;
      socket.auth = token ? { token } : {};
      socket.connect();
    }).catch(() => {
      if (!socketDisposed) socket.connect();
    });

    socket.on("connect_error", (err) => {
      
    });

    socket.on("error", (err) => {
      
    });

    socket.on("connect", () => {
      const socketUser = currentUserRef.current;
      if (!socketUser) return;

      // Presence-only payload: profile fields (avatar, name, email, etc.) are
      // NEVER sent through socket registration. They belong exclusively to the
      // authenticated /api/auth/update-profile endpoint. Sending them here would
      // allow a socket reconnect to overwrite the database with stale or
      // placeholder values (the confirmed "base64-stored-db" corruption bug).
      socket.emit("registerUser", {
        id: socketUser.id,
      });

      // Re-fetch critical canonical state that could have been missed during disconnect
      apiClient("/api/lectures", { bypassCache: true })
        .then((r) => r.ok ? r.json() : [])
        .then((data) => setDbLectures(Array.isArray(data) ? data : []))
        .catch(() => {});
      apiClient("/api/calendar/events", { bypassCache: true })
        .then((r) => r.ok ? r.json() : [])
        .then((data) => setCalendarEventsDb(Array.isArray(data) ? data : []))
        .catch(() => {});
    });

    socket.on("presence-update", (onlineList) => {
      
      // Dispatch a custom domestic event so our UserPresenceWidget can automatically re-fetch
      window.dispatchEvent(
        new CustomEvent("socket-presence-update", { detail: onlineList }),
      );
    });

    socket.on("userStatusUpdate", (data) => {
      
      window.dispatchEvent(
        new CustomEvent("socket-user-status-update", { detail: data }),
      );
    });

    socket.on("userStatusChanged", (data) => {
      
      window.dispatchEvent(
        new CustomEvent("socket-user-status-update", { detail: data }),
      );
    });

    socket.on("reportStatusUpdated", (data: { id: string; status: string; reporterId: string }) => {
      window.dispatchEvent(
        new CustomEvent("socket-report-status-updated", { detail: data }),
      );
    });

    // Instant calendar synchronization: apply mutations optimistically when possible
    socket.on("calendar_updated", (payload?: { action: "delete" | "upsert", eventId?: string, event?: CalendarEvent }) => {
      if (payload?.action === "delete" && payload.eventId) {
        setCalendarEventsDb((prev) => {
          const updated = prev.filter(e => e.id !== payload.eventId);
          localStorage.setItem("calendar_events", JSON.stringify(updated));
          OfflineEngine.setCachedCalendarEvents(updated);
          return updated;
        });
      } else if (payload?.action === "upsert" && payload.event) {
        setCalendarEventsDb((prev) => {
          const existing = prev.find(e => e.id === payload.event!.id);
          let updated;
          if (existing) {
            updated = prev.map(e => e.id === payload.event!.id ? payload.event! : e);
          } else {
            updated = [...prev, payload.event!];
          }
          localStorage.setItem("calendar_events", JSON.stringify(updated));
          OfflineEngine.setCachedCalendarEvents(updated);
          return updated;
        });
      } else {
        fetchCalendarEvents(true).catch(() => {});
      }
      window.dispatchEvent(new CustomEvent("socket-calendar-updated"));
    });

    // Real-time mute status — update permissions instantly without refresh
    socket.on("userMuteUpdate", (data: { userId: string; isMuted: boolean; isPermanent: boolean; endTime: string | null; reason: string | null }) => {
      if (data.userId !== currentUserRef.current?.id) return;
      if (data.isMuted) {
        setMuteStatus({ isMuted: true, isPermanent: data.isPermanent, endTime: data.endTime, reason: data.reason });
        // Add a system notification so it appears in the Notification page
        const expiryStr = data.isPermanent
          ? "This mute is permanent."
          : data.endTime
            ? `Expires: ${new Date(data.endTime).toLocaleString()}.`
            : "";
        const muteNotif: AppNotification = {
          id: `mute-${Date.now()}`,
          title: "Participation Restricted",
          titleAr: "تم تقييد المشاركة",
          desc: `You have been muted${data.reason ? ` for: ${data.reason}` : ""}. ${expiryStr} You cannot post or reply in discussions until the mute is lifted.`.trim(),
          descAr: `تم كتم حسابك${data.reason ? ` بسبب: ${data.reason}` : ""}. ${expiryStr} لا يمكنك المشاركة في النقاشات حتى يتم رفع الكتم.`.trim(),
          date: new Date().toISOString(),
          read: false,
          type: "system",
        };
        setNotifications((prev) => (prev.some((n) => n.id === muteNotif.id) ? prev : [muteNotif, ...prev]));
      } else {
        setMuteStatus(null);
      }
    });

    // Ban notification — arrives just before userForcedLogout so the user sees the reason
    socket.on("userBanNotification", (data: { userId: string; reason: string; isPermanent: boolean; endTime: string | null }) => {
      if (data.userId !== currentUserRef.current?.id) return;
      // Store for use by userForcedLogout handler
      lastBanDataRef.current = { reason: data.reason, isPermanent: data.isPermanent, endTime: data.endTime };
      const expiryStr = data.isPermanent
        ? "This suspension is permanent."
        : data.endTime
          ? `Expires: ${new Date(data.endTime).toLocaleString()}.`
          : "";
      const banNotif: AppNotification = {
        id: `ban-${Date.now()}`,
        title: "Account Suspended",
        titleAr: "تم تعليق الحساب",
        desc: `Your account has been suspended${data.reason ? ` for: ${data.reason}` : ""}. ${expiryStr} Please contact support if you believe this is a mistake.`.trim(),
        descAr: `تم تعليق حسابك${data.reason ? ` بسبب: ${data.reason}` : ""}. ${expiryStr}`.trim(),
        date: new Date().toISOString(),
        read: false,
        type: "system",
      };
      setNotifications((prev) => (prev.some((n) => n.id === banNotif.id) ? prev : [banNotif, ...prev]));
    });

    socket.on("userForcedLogout", (data: { userId: string }) => {
      window.dispatchEvent(
        new CustomEvent("socket-user-forced-logout", { detail: data }),
      );
    });

    // ── Real-time Q&A sync ──────────────────────────────────────────────────
    socket.on("qa_question_created", (data: any) => {
      window.dispatchEvent(new CustomEvent("socket-qa-question-created", { detail: data }));
    });
    socket.on("qa_question_updated", (data: any) => {
      window.dispatchEvent(new CustomEvent("socket-qa-question-updated", { detail: data }));
    });
    socket.on("qa_question_deleted", (data: any) => {
      window.dispatchEvent(new CustomEvent("socket-qa-question-deleted", { detail: data }));
    });
    socket.on("qa_answer_created", (data: any) => {
      window.dispatchEvent(new CustomEvent("socket-qa-answer-created", { detail: data }));
    });
    socket.on("qa_answer_updated", (data: any) => {
      window.dispatchEvent(new CustomEvent("socket-qa-answer-updated", { detail: data }));
    });
    socket.on("qa_answer_deleted", (data: any) => {
      window.dispatchEvent(new CustomEvent("socket-qa-answer-deleted", { detail: data }));
    });

    // ── Real-time lecture list sync ─────────────────────────────────────────
    socket.on("lecture_created", (lecture: any) => {
      setDbLectures((prev: any[]) =>
        prev.some((l) => l.id === lecture.id) ? prev : [...prev, lecture]
      );
    });
    socket.on("lecture_deleted", (data: { lectureId: string }) => {
      setDbLectures((prev: any[]) => prev.filter((l) => l.id !== data.lectureId));
    });

    // ── Real-time report notifications (admins see new reports instantly) ───
    socket.on("report_created", (data: any) => {
      window.dispatchEvent(new CustomEvent("socket-report-created", { detail: data }));
    });

    // ── Real-time ban removal (user's ban screen clears immediately) ─────────

    // ── Admin list views: broadcast so every open admin panel re-fetches ─────
    socket.on("ban_list_updated", () => {
      window.dispatchEvent(new CustomEvent("socket-ban-list-updated"));
    });
    socket.on("mute_list_updated", () => {
      window.dispatchEvent(new CustomEvent("socket-mute-list-updated"));
    });
    socket.on("moderation_history_updated", () => {
      window.dispatchEvent(new CustomEvent("socket-moderation-history-updated"));
    });
    socket.on("materials_updated", () => {
      fetchMaterials(true).catch(() => {});
    });
    socket.on("roster_updated", () => {
      window.dispatchEvent(new CustomEvent("socket-roster-updated"));
    });
    socket.on("userCreated", () => {
      window.dispatchEvent(new CustomEvent("socket-user-created"));
    });
    socket.on("userDeleted", () => {
      window.dispatchEvent(new CustomEvent("socket-user-deleted"));
    });
    socket.on("userBanRemoved", (data: { userId: string }) => {
      // Dispatch anyway so admin views update
      window.dispatchEvent(new CustomEvent("socket-user-ban-removed", { detail: data }));
    });
    socket.on("motto_updated", () => {
      window.dispatchEvent(new CustomEvent("socket-motto-updated"));
    });

    // ── Real-time profile sync: update currentUser instantly when profile changes ──
    socket.on("userUpdated", (updatedUser: any) => {
      if (updatedUser?.id === currentUserRef.current?.id) {
        setCurrentUser((prev) => prev ? { ...prev, ...updatedUser } : prev);
      }
      // Dispatch so admin roster/console views refresh without a page reload
    });

    socket.on("receiveSystemNotification", (newNotification: any) => {
      // Group filter: if the notification targets a specific group, ignore it
      // for users who are not in that group. Global notifications (no targetGroup)
      // are always shown. This is a defence-in-depth check — the backend already
      // scopes the socket.io room broadcast, but REST-fetched history also carries
      // the field so both paths are consistent.
      const notifGroup: string | undefined = newNotification.targetGroup;
      if (notifGroup && notifGroup !== currentUserRef.current?.studentGroup) {
        return;
      }

      let nType: any = "system";
      if (typeof newNotification.title === "string") {
        if (newNotification.title.startsWith("New Lecture:")) nType = "lecture";
        else if (newNotification.title.startsWith("New Quiz:")) nType = "quiz";
        else if (newNotification.title.startsWith("New Exam:")) nType = "exam";
        else if (newNotification.title.startsWith("New Event:")) nType = "event";
        else if (newNotification.title.startsWith("New Holiday:")) nType = "holiday";
      }

      // Extract the Baghdad-timezone date from the server notification message.
      // Primary: unambiguous [date:YYYY-MM-DD] tag embedded by the server using
      //   Intl.DateTimeFormat with timeZone:'Asia/Baghdad' — no Date parsing needed.
      // Fallback A: parse month-name string directly (avoids Date constructor which
      //   shifts dates in negative-UTC-offset browsers like US timezones).
      // Fallback B: legacy "for YYYY-MM-DD" pattern.
      let socketEventDate: string | undefined;
      if (newNotification.message) {
        // Primary: [date:YYYY-MM-DD] — added by server, fully timezone-safe
        const mTag = newNotification.message.match(/\[date:(\d{4}-\d{2}-\d{2})\]/);
        if (mTag) {
          socketEventDate = mTag[1];
        }

        // Fallback A: "starting on Weekday, Month D, YYYY at …"
        if (!socketEventDate) {
          const mStart = newNotification.message.match(/starting on ([^[.]+)/);
          if (mStart?.[1]) {
            // Extract "Month D, YYYY" directly — never pass to new Date() which is
            // timezone-dependent. Map month name → number to build YYYY-MM-DD safely.
            const mDate = mStart[1].match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
            if (mDate) {
              const MONTHS: Record<string, string> = {
                January:"01", February:"02", March:"03", April:"04",
                May:"05", June:"06", July:"07", August:"08",
                September:"09", October:"10", November:"11", December:"12",
              };
              const mon = MONTHS[mDate[1]];
              if (mon) {
                socketEventDate = `${mDate[3]}-${mon}-${mDate[2].padStart(2,"0")}`;
              }
            }
          }
        }

        // Fallback B: legacy "for YYYY-MM-DD" pattern
        if (!socketEventDate) {
          const m2 = newNotification.message.match(/for (\d{4}-\d{2}-\d{2})/);
          if (m2) socketEventDate = m2[1];
        }
      }

      const mapped: AppNotification = {
        id: newNotification.id,
        title: newNotification.title,
        titleAr: newNotification.titleAr || newNotification.title,
        desc: newNotification.message,
        descAr: newNotification.message,
        date: newNotification.createdAt,
        eventDate: socketEventDate,
        read: false,
        type: nType,
      };

      setNotifications((prev) => {
        const exists = prev.some((n) => n.id === mapped.id);
        if (exists) return prev;
        return [mapped, ...prev];
      });

      if (pushAlertsRef.current) {
        // Display native app visual toast Banner
        HapticFeedback.notification(newNotification.type === "alert" ? "warning" : "success");
        setActiveToast({
          id: newNotification.id,
          title: newNotification.title,
          desc: newNotification.message,
        });
      } else {
        
      }
    });

    return () => {
      socketDisposed = true;
      (window as any).socket = null;
      socket.disconnect();
    };
  }, [currentUser?.id, isActive]);

  // Notifications state

  const [notifications, setNotifications] = useState<AppNotification[]>(() => {
    try {
      const saved = localStorage.getItem("app_notifications_v1");
      if (saved) return safeJsonParse<AppNotification[]>(saved, []);
    } catch (e) {}
    return [];
  });

  useEffect(() => {
    // Debounce localStorage writes for large arrays
    const timer = setTimeout(() => {
        // Cap notifications to keep localStorage and memory usage healthy
        const cappedNotifications = notifications.slice(0, 500);
        localStorage.setItem("app_notifications_v1", JSON.stringify(cappedNotifications));
    }, 1000);
    return () => clearTimeout(timer);
  }, [notifications]);

  // Performance Optimization: Memoize unread count to avoid redundant filtering on every render
  const unreadNotificationsCount = useMemo(() => {
    if (!preferences.pushAlerts) return 0;
    return notifications.filter((n) => !n.read).length;
  }, [notifications, preferences.pushAlerts]);

  const bulletinIconBadge = useMemo(
    () =>
      unreadNotificationsCount > 0 ? (
        <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-rose-500 border-[1.5px] border-white dark:border-white/[0.12] z-20 shadow-elevation-1" />
      ) : null,
    [unreadNotificationsCount],
  );

  const bulletinRightBadge = useMemo(
    () =>
      unreadNotificationsCount > 0 ? (
        <span className="px-2 py-1 rounded-full bg-rose-500 text-white text-xs font-semibold leading-none shadow-elevation-1 flex items-center justify-center shrink-0 min-w-[22px] ml-auto">
          {unreadNotificationsCount}
        </span>
      ) : null,
    [unreadNotificationsCount],
  );

  // Sync historical notifications from the database
  useEffect(() => {
    if (!currentUser) return; // Prevent 401 unauthenticated requests

    const fetchDbNotifications = async () => {
      try {
        const res = await apiClient("/api/notifications");
        if (res.ok) {
          const dbNotifs = await res.json();
          const mapped: AppNotification[] = dbNotifs.map((n: any) => {
            let nType: any = "system";
            if (typeof n.title === "string") {
              if (n.title.startsWith("New Lecture:")) nType = "lecture";
              else if (n.title.startsWith("New Quiz:")) nType = "quiz";
              else if (n.title.startsWith("New Exam:")) nType = "exam";
              else if (n.title.startsWith("New Event:")) nType = "event";
              else if (n.title.startsWith("New Holiday:")) nType = "holiday";
            }
            // Extract the scheduled event date from the server's natural-language message.
            // Server format: "...starting on Thursday, July 17, 2026 at 8:00 AM."
            // new Date() cannot parse "at 8:00 AM" — extract just the "Month D, YYYY" part first.
            let eventDate: string | undefined;
            if (n.message) {
              const m = n.message.match(/starting on ([^.]+)/);
              if (m && m[1]) {
                const datePart = (m[1].match(/([A-Za-z]+ \d{1,2}, \d{4})/) ?? [])[1];
                const parsed = new Date(datePart ?? m[1].trim());
                if (!isNaN(parsed.getTime())) {
                  // Store as YYYY-MM-DD so BulletinCenter can format it locale-aware
                  const y = parsed.getFullYear();
                  const mo = String(parsed.getMonth() + 1).padStart(2, "0");
                  const d = String(parsed.getDate()).padStart(2, "0");
                  eventDate = `${y}-${mo}-${d}`;
                }
              }
              // Fallback: plain YYYY-MM-DD pattern embedded in older messages
              if (!eventDate) {
                const m2 = n.message.match(/for (\d{4}-\d{2}-\d{2})/);
                if (m2) eventDate = m2[1];
              }
            }
            return {
              id: n.id,
              title: n.title,
              titleAr: n.titleAr || n.title,
              desc: n.message,
              descAr: n.message,
              date: n.createdAt,
              eventDate,
              read: false,
              type: nType,
            };
          });

          setNotifications((prev) => {
            const mergedMap = new Map();
            prev.forEach((p) => mergedMap.set(p.id, p));
            mapped.forEach((m) => {
              if (mergedMap.has(m.id)) {
                const existing = mergedMap.get(m.id);
                mergedMap.set(m.id, { ...m, read: existing.read });
              } else {
                mergedMap.set(m.id, m);
              }
            });

            const list = Array.from(mergedMap.values()) as AppNotification[];
            list.sort(
              (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
            );
            return list;
          });
        }
      } catch (err) {
        
      }
    };

    fetchDbNotifications();
  }, [currentUser?.id]);

  // Handle activeToast auto-dismiss
  useEffect(() => {
    if (activeToast) {
      const timer = setTimeout(() => {
        setActiveToast(null);
      }, 7000);
      return () => clearTimeout(timer);
    }
  }, [activeToast]);

  // Handle global API errors gracefully via Toast
  useEffect(() => {
    const handleApiError = (event: Event) => {
      const customEvent = event as CustomEvent<string>;
      const message = customEvent.detail || t("unexpectedError");
      // Missing sessions are expected while the auth screen is mounting or
      // after sign-out. They must never be shown as an application error.
      if (/no authenticated academic session|authentication required/i.test(message)) return;
      // Suppress error toasts when the user is on the auth screen (login/register).
      // The auth form displays its own inline error messages.
      if (authState === "UNAUTHENTICATED") return;
      const now = Date.now();
      const last = lastApiErrorToastRef.current;
      if (last && last.message === message && now - last.at < 2500) return;
      lastApiErrorToastRef.current = { message, at: now };
      toast.error(message);
    };

    const handleOfflineStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ status?: string; rejectedCount?: number }>).detail;
      if (detail?.status === "Failed") {
        toast.error(
          language === "ar"
            ? t("offlineChangesFailed")
            : `${detail.rejectedCount || 1} ${t("offlineChangesFailed")}`,
        );
      } else if (detail?.status === "Retrying") {
        toast.info(t("retryingOfflineChanges"));
      }
    };

    window.addEventListener("app-api-error", handleApiError);
    window.addEventListener("offline-sync-status", handleOfflineStatus);
    return () => {
      window.removeEventListener("app-api-error", handleApiError);
      window.removeEventListener("offline-sync-status", handleOfflineStatus);
    };
  }, [language]);

  // Gracefully handle expired sessions with state cleanups and high-fidelity iOS alerts
  useEffect(() => {
    const handleSessionExpired = () => {
      // Ignore late 401 responses from requests that started before logout or
      // before a new OAuth flow. There is no active session to expire here.
      if (!currentUserRef.current) return;
      if (sessionExpiredHandledRef.current) return;
      // Suppress during auth screen — login/register errors are handled inline.
      if (authState === "UNAUTHENTICATED") return;
      sessionExpiredHandledRef.current = true;
      setAuthState("UNAUTHENTICATED");
      SecureStorage.remove("auth_token");
      SecureStorage.remove("logged_user");
      setActiveAccountId(null);

      setCurrentUser((prevUser) => {
        if (prevUser) {
          setTimeout(() => {
            showiOSAlert({
              title: language === "ar" ? "انتهت الجلسة" : "Session Expired",
              message:
                language === "ar"
                  ? "انتهت صلاحية جلسة الدراسة الطبية الخاصة بك. يرجى تسجيل الدخول مرة أخرى لمتابعة تقدمك الدراسي."
                  : "Your medical clinical study session has expired or is invalid. Please log in again to continue tracking your academic progress.",
              actions: [
                {
                  label: language === "ar" ? "تسجيل الدخول" : "Log In",
                  style: "default",
                  onClick: () => {
                    setActiveTab("home");
                  },
                },
              ],
            });
          }, 0);
        }
        return null;
      });
    };

    window.addEventListener("app-session-expired", handleSessionExpired);
    return () =>
      window.removeEventListener("app-session-expired", handleSessionExpired);
  }, [language]);

  // Handle admin-initiated forced logout (ban)
  useEffect(() => {
    const handleForcedLogout = (e: Event) => {
      const { userId } = (e as CustomEvent<{ userId: string }>).detail;
      setCurrentUser((prev) => {
        if (!prev || prev.id !== userId) return prev;
        setTimeout(() => {
          SecureStorage.remove("auth_token");
          SecureStorage.remove("logged_user");
          setActiveAccountId(null);
          // Show suspension screen with ban details from the preceding userBanNotification
          const ban = lastBanDataRef.current;
          setBannedInfo({
            reason: ban?.reason ?? null,
            isPermanent: ban?.isPermanent ?? true,
            endTime: ban?.endTime ?? null,
          });
        }, 0);
        return null;
      });
    };
    window.addEventListener("socket-user-forced-logout", handleForcedLogout);
    return () => window.removeEventListener("socket-user-forced-logout", handleForcedLogout);
  }, []);

  // Periodically refresh JWT token in background if user is active to prevent session expiration
  useEffect(() => {
    if (!currentUser || !isActive) return;

    // Refresh every 20 minutes
    const intervalId = setInterval(
      async () => {
        try {
          const response = await apiClient("/api/auth/refresh", {
            method: "POST",
            silent: true,
          });
          if (response.ok) {
            const data = await response.json().catch(() => ({}));
            if (data.token) {
              await SecureStorage.set("auth_token", data.token);
            }
            
          }
        } catch (err) {
          
        }
      },
      20 * 60 * 1000,
    );

    return () => clearInterval(intervalId);
  }, [currentUser, isActive]);

  const handleMarkNotificationRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((notif) => {
        if (notif.id === id) {
          return { ...notif, read: true };
        }
        return notif;
      }),
    );
       
  }, []);

  const handleMarkNotificationUnread = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((notif) => {
        if (notif.id === id) {
          return { ...notif, read: false };
        }
        return notif;
      }),
    );
       
  }, []);

  const handleDeleteNotification = useCallback(async (id: string) => {
    setNotifications((prev) => prev.filter((notif) => notif.id !== id));
    try {
      await apiClient(`/api/notifications/${id}`, { method: "DELETE" });
    } catch {}
  }, []);

  const handleMarkAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((notif) => ({ ...notif, read: true })));
    NativeBridge.clearAllDeliveredNotifications();
       
  }, []);

  const handleClearAllNotifications = useCallback(async () => {
    const ids = notifications.map((n) => n.id);
    setNotifications([]);
    NativeBridge.clearAllDeliveredNotifications();
    try {
      await Promise.all(ids.map((id) => apiClient(`/api/notifications/${id}`, { method: "DELETE" })));
    } catch {}
  }, [notifications]);

  // Focused lecture node (for drilling down into detail view)
  const [activeSubjectId, setActiveSubjectId] = useState<SubjectId | null>(
    null,
  );
  // Modules is an independent top-level academic surface. It intentionally
  // does not reuse SubjectView; each card opens its own module placeholder.
  const [activeModuleId, setActiveModuleId] = useState<SubjectId | null>(null);
  const [activeLecture, setActiveLecture] = useState<Lecture | null>(null);
  const [activeLectureTab, setActiveLectureTab] = useState<
    "pdf" | "notes" | "mcqs" | "flashcards" | "videos" | "qa"
  >("pdf");
  const [progressDb, setProgressDb] = useState<UserProgress[]>([]);
  const [pointsLogDb, setPointsLogDb] = useState<PointsLog[]>([]);
  const [calendarEventsDb, setCalendarEventsDb] = useState<CalendarEvent[]>([]);
  const [editingCalendarEvent, setEditingCalendarEvent] = useState<CalendarEvent | null>(null);
  const [muteStatus, setMuteStatus] = useState<{
    isMuted: boolean; isPermanent: boolean; endTime: string | null; reason: string | null;
  } | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>(seedSubjects);
  const [dbLectures, setDbLectures] = useState<DatabaseLecture[]>([]);
  const refreshAcademicDataRef = useRef<((bypassCache?: boolean) => Promise<void>) | null>(null);
  const academicRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const lastAcademicRefreshAtRef = useRef(0);

  // Performance Optimization: Memoize subject lecture counts in O(N + M) time.
  // The backend already merges DB lectures into subject.modules, so counting
  // modules AND dbLectures separately double-counts; use the shared
  // id-based dedupe helper (countUniqueSubjectLectures) as the single source.
  const subjectLectureCounts = useMemo(() => {
    return subjects.reduce(
      (acc, subItem) => {
        acc[subItem.id] = countUniqueSubjectLectures(subItem, dbLectures);
        return acc;
      },
      {} as Record<string, number>,
    );
  }, [subjects, dbLectures]);

  const globalSearchData = useMemo(() => {
    const results: SearchResultItem[] = [];

    // Add seeded lectures inside subjects
    subjects.forEach((s) => {
      s.modules.forEach((m) => {
        m.lectures.forEach((l) => {
          const lTitle = language === "ar" ? l.title || l.title : l.title;
          results.push({
            id: `lecture-${l.id}`,
            title: lTitle,
            subtitle: `${m.name} • ${s.name}`,
            type: "lecture",
            subjectId: s.id,
            lectureId: l.id,
            raw: l,
          });

          if (l.pdfUrl || l.pages?.length) {
            results.push({
              id: `pdf-${l.id}`,
              title: `${lTitle} (PDF)`,
              subtitle: lTitle,
              type: "pdf",
              subjectId: s.id,
              lectureId: l.id,
              raw: l,
            });
          }
          if (l.notesPdfUrl || l.notesPages?.length) {
            results.push({
              id: `notes-${l.id}`,
              title: `${lTitle} (Notes)`,
              subtitle: lTitle,
              type: "notes",
              subjectId: s.id,
              lectureId: l.id,
              raw: l,
            });
          }
          if (l.materials?.find((m: any) => m.type.toUpperCase() === "VIDEO")) {
            results.push({
              id: `video-${l.id}`,
              title: `${lTitle} (Video)`,
              subtitle: lTitle,
              type: "video",
              subjectId: s.id,
              lectureId: l.id,
              raw: l,
            });
          }
          if (l.mcqs?.length) {
            results.push({
              id: `mcq-${l.id}`,
              title: `${lTitle} (MCQs)`,
              subtitle: lTitle,
              type: "mcq",
              subjectId: s.id,
              lectureId: l.id,
              raw: l,
            });
          }
          if (l.flashcards?.length) {
            results.push({
              id: `flashcard-${l.id}`,
              title: `${lTitle} (Flashcards)`,
              subtitle: lTitle,
              type: "flashcard",
              subjectId: s.id,
              lectureId: l.id,
              raw: l,
            });
          }
        });
      });
    });

    // Add dbLectures
    (dbLectures || []).forEach((l: any, index: number) => {
      const mappedLecture = {
        id: l.id,
        moduleId: l.mainSubject + "_" + (l.subSubject || "general"),
        subjectId: l.mainSubject,
        title: l.name,
        doctorName: l.department || "Medical Staff",
        pdfUrl:
          l.materials?.find((m: any) => m.type.toUpperCase() === "PDF")?.fileUrlOrLink || "",
        notesPdfUrl:
          l.materials?.find((m: any) => m.type.toUpperCase() === "NOTE")?.fileUrlOrLink || "",
        orderNumber: index + 1,
        type: l.trackMode as "Theory" | "Practical",
        category: l.subSubject || "",
        description: "Database Registered Course Material Module.",
        pages: [],
        notesPages: [],
        isDatabaseLecture: true,
        materials: l.materials || [],
        mcqs: l.mcqs || [],
        flashcards: l.flashcards || [],
      };

      const lTitle = mappedLecture.title;
      results.push({
        id: `db-lecture-${l.id}`,
        title: lTitle,
        subtitle: l.subSubject || l.mainSubject,
        type: "lecture",
        subjectId: l.mainSubject,
        lectureId: l.id,
        raw: mappedLecture,
      });

      if (mappedLecture.pdfUrl) {
        results.push({
          id: `db-pdf-${l.id}`,
          title: `${lTitle} (PDF)`,
          subtitle: lTitle,
          type: "pdf",
          subjectId: l.mainSubject,
          lectureId: l.id,
          raw: mappedLecture,
        });
      }
      if (mappedLecture.notesPdfUrl) {
        results.push({
          id: `db-notes-${l.id}`,
          title: `${lTitle} (Notes)`,
          subtitle: lTitle,
          type: "notes",
          subjectId: l.mainSubject,
          lectureId: l.id,
          raw: mappedLecture,
        });
      }
      if (mappedLecture.materials?.find((m: any) => m.type.toUpperCase() === "VIDEO")) {
        results.push({
          id: `db-video-${l.id}`,
          title: `${lTitle} (Video)`,
          subtitle: lTitle,
          type: "video",
          subjectId: l.mainSubject,
          lectureId: l.id,
          raw: mappedLecture,
        });
      }
      if (mappedLecture.mcqs?.length) {
        results.push({
          id: `db-mcq-${l.id}`,
          title: `${lTitle} (MCQs)`,
          subtitle: lTitle,
          type: "mcq",
          subjectId: l.mainSubject,
          lectureId: l.id,
          raw: mappedLecture,
        });
      }
      if (mappedLecture.flashcards?.length) {
        results.push({
          id: `db-flashcard-${l.id}`,
          title: `${lTitle} (Flashcards)`,
          subtitle: lTitle,
          type: "flashcard",
          subjectId: l.mainSubject,
          lectureId: l.id,
          raw: mappedLecture,
        });
      }
    });

    return results;
  }, [subjects, dbLectures, language]);

  // Home/Welcome-specific separate pathway navigation states
  const [activeHomeSubjectId, setActiveHomeSubjectId] =
    useState<SubjectId | null>(null);
  const [activeHomeLecture, setActiveHomeLecture] = useState<Lecture | null>(
    null,
  );

  // Track whether the detail view was opened directly from Home Dashboard or via nested SubjectView
  const [lectureDetailSource, setLectureDetailSource] = useState<
    "dashboard" | "subject" | null
  >(null);

  // --- Native iOS Real-time Interactive Swipe Back Drag States ---
  const [homeLectureSwipeX, setHomeLectureSwipeX] = useState(0);
  const [homeSubjectSwipeX, setHomeSubjectSwipeX] = useState(0);
  const [lectureSwipeX, setLectureSwipeX] = useState(0);
  const [subjectSwipeX, setSubjectSwipeX] = useState(0);

  const [isReleasingHomeLecture, setIsReleasingHomeLecture] = useState(false);
  const [isReleasingHomeSubject, setIsReleasingHomeSubject] = useState(false);
  const [isReleasingLecture, setIsReleasingLecture] = useState(false);
  const [isReleasingSubject, setIsReleasingSubject] = useState(false);

  // ── Navigation stack for correct Back behavior from Search ───────────
  // Each entry captures the complete navigation state so Back can restore it.
  type NavigationEntry = {
    activeTab: string;
    activeSubjectId: SubjectId | null;
    activeLecture: Lecture | null;
    activeLectureTab: "pdf" | "notes" | "mcqs" | "flashcards" | "videos" | "qa";
    activeHomeSubjectId: SubjectId | null;
    activeHomeLecture: Lecture | null;
    lectureDetailSource: "dashboard" | "subject" | null;
  };
  const navigationStackRef = useRef<NavigationEntry[]>([]);

  const pushNavigationStack = useCallback(() => {
    navigationStackRef.current.push({
      activeTab,
      activeSubjectId,
      activeLecture,
      activeLectureTab,
      activeHomeSubjectId,
      activeHomeLecture,
      lectureDetailSource,
    });
  }, [activeTab, activeSubjectId, activeLecture, activeLectureTab, activeHomeSubjectId, activeHomeLecture, lectureDetailSource]);

  const popNavigationStack = useCallback((): NavigationEntry | null => {
    return navigationStackRef.current.pop() || null;
  }, []);

  const clearNavigationStack = useCallback(() => {
    navigationStackRef.current = [];
  }, []);

  // iOS-style Extreme Left Edge Swipe Back list triggers
  useSwipeBack({
    onSwipeBack: () => {
      if (activeHomeLecture !== null) {
        setActiveHomeLecture(null);
        if (lectureDetailSource === "dashboard") {
          setActiveHomeSubjectId(null);
        }
        setLectureDetailSource(null);
      } else if (activeHomeSubjectId !== null) {
        setActiveHomeSubjectId(null);
      }
    },
    isEnabled: activeHomeLecture !== null || activeHomeSubjectId !== null,
    onSwipeMove: (dx) => {
      if (activeHomeLecture !== null) {
        setHomeLectureSwipeX(dx);
      } else if (activeHomeSubjectId !== null) {
        setHomeSubjectSwipeX(dx);
      }
    },
    onSwipeEnd: (success) => {
      if (!success) {
        if (activeHomeLecture !== null) {
          setIsReleasingHomeLecture(true);
          setHomeLectureSwipeX(0);
          setTimeout(() => setIsReleasingHomeLecture(false), 300);
        } else if (activeHomeSubjectId !== null) {
          setIsReleasingHomeSubject(true);
          setHomeSubjectSwipeX(0);
          setTimeout(() => setIsReleasingHomeSubject(false), 300);
        }
      } else {
        setHomeLectureSwipeX(0);
        setHomeSubjectSwipeX(0);
      }
    },
  });

  useSwipeBack({
    onSwipeBack: () => {
      if (activeLecture !== null) {
        const prev = popNavigationStack();
        if (prev) {
          setActiveTab(prev.activeTab);
          setActiveSubjectId(prev.activeSubjectId);
          setActiveLecture(prev.activeLecture);
          setActiveLectureTab(prev.activeLectureTab);
          setActiveHomeSubjectId(prev.activeHomeSubjectId);
          setActiveHomeLecture(prev.activeHomeLecture);
          setLectureDetailSource(prev.lectureDetailSource);
        } else {
          setActiveLecture(null);
        }
      } else if (activeSubjectId !== null) {
        const prev = popNavigationStack();
        if (prev) {
          setActiveTab(prev.activeTab);
          setActiveSubjectId(prev.activeSubjectId);
          setActiveLecture(prev.activeLecture);
          setActiveLectureTab(prev.activeLectureTab);
          setActiveHomeSubjectId(prev.activeHomeSubjectId);
          setActiveHomeLecture(prev.activeHomeLecture);
          setLectureDetailSource(prev.lectureDetailSource);
        } else {
          setActiveSubjectId(null);
        }
      } else if (activeModuleId !== null) {
        setActiveModuleId(null);
      }
    },
    isEnabled: activeLecture !== null || activeSubjectId !== null || activeModuleId !== null,
    onSwipeMove: (dx) => {
      if (activeLecture !== null) {
        setLectureSwipeX(dx);
      } else if (activeSubjectId !== null || activeModuleId !== null) {
        setSubjectSwipeX(dx);
      }
    },
    onSwipeEnd: (success) => {
      if (!success) {
        if (activeLecture !== null) {
          setIsReleasingLecture(true);
          setLectureSwipeX(0);
          setTimeout(() => setIsReleasingLecture(false), 300);
        } else if (activeSubjectId !== null || activeModuleId !== null) {
          setIsReleasingSubject(true);
          setSubjectSwipeX(0);
          setTimeout(() => setIsReleasingSubject(false), 300);
        }
      } else {
        setLectureSwipeX(0);
        setSubjectSwipeX(0);
      }
    },
  });

  // Memoized handlers to optimize rendering and prevent breaking child component memoization
  const handleSelectHomeSubject = useCallback((id: SubjectId) => {
    setActiveHomeSubjectId(id);
    setActiveHomeLecture(null);
       
  }, []);

  const handleSelectHomeLecture = useCallback((lect: Lecture, tab?: "pdf" | "notes" | "mcqs" | "flashcards" | "videos" | "qa") => { setLectureDetailSource("dashboard"); setActiveHomeSubjectId(lect.subjectId); if (tab) setActiveLectureTab(tab); else setActiveLectureTab("pdf"); setActiveHomeLecture(lect); }, []);

  const handleBackHomeSubject = useCallback(() => {
    setActiveHomeSubjectId(null);
       
  }, []);

  const handleBackSubject = useCallback(() => {
    // If there's a navigation stack entry, restore it (e.g., Back from Search result).
    const prev = popNavigationStack();
    if (prev) {
      setActiveTab(prev.activeTab);
      setActiveSubjectId(prev.activeSubjectId);
      setActiveLecture(prev.activeLecture);
      setActiveLectureTab(prev.activeLectureTab);
      setActiveHomeSubjectId(prev.activeHomeSubjectId);
      setActiveHomeLecture(prev.activeHomeLecture);
      setLectureDetailSource(prev.lectureDetailSource);
      return;
    }
    setActiveSubjectId(null);
  }, [popNavigationStack]);

  const handleBackLecture = useCallback(() => {
    // If there's a navigation stack entry, restore it (e.g., Back from Search result).
    const prev = popNavigationStack();
    if (prev) {
      setActiveTab(prev.activeTab);
      setActiveSubjectId(prev.activeSubjectId);
      setActiveLecture(prev.activeLecture);
      setActiveLectureTab(prev.activeLectureTab);
      setActiveHomeSubjectId(prev.activeHomeSubjectId);
      setActiveHomeLecture(prev.activeHomeLecture);
      setLectureDetailSource(prev.lectureDetailSource);
      return;
    }
    setActiveLecture(null);
  }, [popNavigationStack]);

  const handleBackHomeLecture = useCallback(() => {
    const prev = popNavigationStack();
    if (prev) {
      setActiveTab(prev.activeTab);
      setActiveSubjectId(prev.activeSubjectId);
      setActiveLecture(prev.activeLecture);
      setActiveLectureTab(prev.activeLectureTab);
      setActiveHomeSubjectId(prev.activeHomeSubjectId);
      setActiveHomeLecture(prev.activeHomeLecture);
      setLectureDetailSource(prev.lectureDetailSource);
      return;
    }
    setActiveHomeLecture(null);
    if (lectureDetailSource === "dashboard") {
      setActiveHomeSubjectId(null);
    }
  }, [lectureDetailSource, popNavigationStack]);

  const handleSelectNestedLecture = useCallback((lect: Lecture, tab?: "pdf" | "notes" | "mcqs" | "flashcards" | "videos" | "qa") => { setLectureDetailSource("subject"); if (tab) setActiveLectureTab(tab); else setActiveLectureTab("pdf"); setActiveHomeLecture(lect); }, []);

  // --- Deep-Linking, State Restoration & Universal Linking Sync Engine ---
  const targetHomeLectureIdRef = useRef<string | null>(null);
  const targetLectureIdRef = useRef<string | null>(null);

  const handleSidebarTabClick = useCallback((id: string) => {
    if (id === "search") {
      setIsCommandPaletteOpen(true);
      return;
    }
    // Clear navigation stack when switching main tabs — stale entries from
    // a previous context (e.g. Search) must not affect the new tab.
    clearNavigationStack();
    setActiveTab((prev) => {
      if (id === "home") {
        if (prev === "home") {
          setActiveHomeSubjectId(null);
          setActiveHomeLecture(null);
        }
        return "home";
      }
      if (id === "subjects") {
        if (prev === "subjects") {
          setActiveModuleId(null);
          setActiveSubjectId(null);
          setActiveLecture(null);
        }
        return "subjects";
      }
      setActiveModuleId(null);
      setActiveLecture(null);
      setActiveSubjectId(null);
      return id;
    });
       
  }, []);

  // Sync state variables -> URL hash (prevents page reloads, keeps standard state synchronization)
  useEffect(() => {
    let hashStr = `#${activeTab}`;
    if (activeTab === "home") {
      if (activeHomeSubjectId) {
        hashStr += `/subject/${activeHomeSubjectId}`;
        if (activeHomeLecture) {
          hashStr += `/lecture/${activeHomeLecture.id}`;
        }
      } else if (activeHomeLecture) {
        hashStr += `/lecture/${activeHomeLecture.id}`;
      }
    } else if (activeTab === "subjects") {
      if (activeSubjectId) {
        hashStr += `/subject/${activeSubjectId}`;
        if (activeLecture) {
          hashStr += `/lecture/${activeLecture.id}`;
        }
      }
    }

    if (window.location.hash !== hashStr) {
      window.history.replaceState(null, "", hashStr);
    }
  }, [
    activeTab,
    activeHomeSubjectId,
    activeHomeLecture,
    activeSubjectId,
    activeLecture,
  ]);

  // Sync URL hash -> state variables (handles back/forward browser controls, deep/universal links)
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash || "#home";
      const parts = hash.replace(/^#/, "").split("/");
      const tab = parts[0] || "home";

      const validTabs = [
        "home",
        "subjects",
        "calendar",
        "control-center",
        "profile",
        "settings",
        "bulletin",
        "privacy",
        "terms",
        "support",
        "disclaimer"
      ];
      if (!validTabs.includes(tab)) return;

      setActiveTab(tab);

      if (tab === "home") {
        if (parts[1] === "subject" && parts[2]) {
          const subId = parts[2] as SubjectId;
          setActiveHomeSubjectId(subId);
          if (parts[3] === "lecture" && parts[4]) {
            targetHomeLectureIdRef.current = parts[4];
          } else {
            setActiveHomeLecture(null);
            targetHomeLectureIdRef.current = null;
          }
        } else if (parts[1] === "lecture" && parts[2]) {
          targetHomeLectureIdRef.current = parts[2];
        } else {
          setActiveHomeSubjectId(null);
          setActiveHomeLecture(null);
          targetHomeLectureIdRef.current = null;
        }
      } else if (tab === "subjects") {
        if (parts[1] === "subject" && parts[2]) {
          const subId = parts[2] as SubjectId;
          setActiveSubjectId(subId);
          if (parts[3] === "lecture" && parts[4]) {
            targetLectureIdRef.current = parts[4];
          } else {
            setActiveLecture(null);
            targetLectureIdRef.current = null;
          }
        } else {
          setActiveSubjectId(null);
          setActiveLecture(null);
          targetLectureIdRef.current = null;
        }
      }
    };

    handleHashChange();

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
       
  }, []);

  useEffect(() => {
    if (activeSubjectId !== null && activeModuleId !== null) {
      setActiveModuleId(null);
    }
  }, [activeSubjectId, activeModuleId]);

  const subjectProgressMetrics = useMemo(() => {
    const metrics = new Map<string, { totalTasks: number, completedTasks: number, progressPercentage: number }>();
    const progressMap = new Map();
    for (let i = 0; i < progressDb.length; i++) {
      progressMap.set(progressDb[i].lectureId, progressDb[i]);
    }

    for (let i = 0; i < subjects.length; i++) {
      const subject = subjects[i];
      // Unique lectures (merged modules + matching DB rows) — prevents
      // double-counting lectures that the backend merge already added.
      const subjectLectures = getUniqueSubjectLectures(subject, dbLectures);
      const totalTasks = subjectLectures.length * 5;

      let completedTasks = 0;

      const countTasks = (l: any) => {
        const p = progressMap.get(l.id);
        if (p) {
          if (p.pdfCompleted) completedTasks++;
          if (p.notesCompleted) completedTasks++;
          if (p.videoCompleted) completedTasks++;
          if (p.flashcardsCompleted) completedTasks++;
          if (p.quizCompleted) completedTasks++;
        }
      };

      for (let j = 0; j < subjectLectures.length; j++) countTasks(subjectLectures[j]);

      const progressPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
      metrics.set(subject.id, { totalTasks, completedTasks, progressPercentage });
    }
    return metrics;
  }, [subjects, dbLectures, progressDb]);

  // Try to resolve target deep link IDs once subjects or dbLectures update
  useEffect(() => {
    if (subjects.length > 0) {
      if (targetHomeLectureIdRef.current) {
        let found: Lecture | null = null;
        // Search in dbLectures
        if (dbLectures.length > 0) {
          found = dbLectures.find(
            (l) => l.id === targetHomeLectureIdRef.current,
          ) as unknown as Lecture | undefined;
        }
        // If not found in dbLectures, search in subjects
        if (!found) {
          for (const sub of subjects) {
            for (const mod of sub.modules) {
              const match = mod.lectures.find(
                (l) => l.id === targetHomeLectureIdRef.current,
              );
              if (match) {
                found = match;
                break;
              }
            }
            if (found) break;
          }
        }
        if (found) {
          setActiveHomeLecture(found);
          setActiveHomeSubjectId(found.subjectId);
          targetHomeLectureIdRef.current = null;
        }
      }

      if (targetLectureIdRef.current) {
        let found: Lecture | null = null;
        if (dbLectures.length > 0) {
          found = dbLectures.find((l) => l.id === targetLectureIdRef.current) as unknown as Lecture | undefined;
        }
        if (!found) {
          for (const sub of subjects) {
            for (const mod of sub.modules) {
              const match = mod.lectures.find(
                (l) => l.id === targetLectureIdRef.current,
              );
              if (match) {
                found = match;
                break;
              }
            }
            if (found) break;
          }
        }
        if (found) {
          setActiveLecture(found as unknown as Lecture);
          setActiveSubjectId(found.subjectId);
          targetLectureIdRef.current = null;
        }
      }
    }
  }, [subjects, dbLectures]);

  // --- Native-like Scroll Memory Controller ---------------------------------
  // The app uses one persistent scroll canvas. Preserve an independent scroll
  // position for every navigation path so moving between pages behaves like a
  // native navigation stack instead of remounting a web page at scrollTop=0.
  const getNavigationPath = useCallback(() => {
    let path = "/" + activeTab;
    if (activeTab === "home") {
      if (activeHomeSubjectId) {
        path += `/subject/${activeHomeSubjectId}`;
      }
      if (activeHomeLecture) {
        path += `/lecture/${activeHomeLecture.id}`;
      }
    } else if (activeTab === "subjects") {
      if (activeSubjectId) {
        path += `/subject/${activeSubjectId}`;
      }
      if (activeLecture) {
        path += `/lecture/${activeLecture.id}`;
      }
    }
    return path;
  }, [
    activeTab,
    activeHomeSubjectId,
    activeHomeLecture,
    activeSubjectId,
    activeLecture,
  ]);

  const navigationPath = getNavigationPath();
  const prevNavigationPathRef = useRef<string>(navigationPath);
  const inMemoryScrollPositionsRef = useRef<Record<string, number>>({});
  const isRestoringGlobalScrollRef = useRef(false);

  const storeScrollPosition = useCallback((path: string, position: number) => {
    const safePosition = Math.max(0, Math.round(position));
    inMemoryScrollPositionsRef.current[path] = safePosition;
    try {
      sessionStorage.setItem(`scroll_pos_${path}`, String(safePosition));
    } catch {}
  }, []);

  const readScrollPosition = useCallback((path: string): number | null => {
    const memoryValue = inMemoryScrollPositionsRef.current[path];
    if (Number.isFinite(memoryValue)) return memoryValue;
    try {
      const stored = sessionStorage.getItem(`scroll_pos_${path}`);
      if (stored == null) return null;
      const parsed = Number(stored);
      return Number.isFinite(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const canvas = document.getElementById("main-scroll-canvas");
    if (!canvas) return;

    // Prevent browser/PWA history restoration from fighting the app's own
    // persistent scroll canvas restoration.
    const previousRestoration = "scrollRestoration" in window.history
      ? window.history.scrollRestoration
      : null;
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }

    let frame = 0;
    const handleScroll = () => {
      if (isRestoringGlobalScrollRef.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        storeScrollPosition(prevNavigationPathRef.current, canvas.scrollTop);
      });
    };

    const handlePageHide = () => {
      storeScrollPosition(prevNavigationPathRef.current, canvas.scrollTop);
    };

    canvas.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      cancelAnimationFrame(frame);
      storeScrollPosition(prevNavigationPathRef.current, canvas.scrollTop);
      canvas.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pagehide", handlePageHide);
      if (previousRestoration && "scrollRestoration" in window.history) {
        window.history.scrollRestoration = previousRestoration;
      }
    };
  }, [storeScrollPosition]);

  useLayoutEffect(() => {
    const canvas = document.getElementById("main-scroll-canvas");
    if (!canvas) return;

    const previousPath = prevNavigationPathRef.current;
    if (previousPath === navigationPath) return;

    // The scroll listener continuously captured the outgoing page before this
    // render. Do not overwrite it here after the new, potentially shorter,
    // page has already been mounted and clamped by the browser.
    prevNavigationPathRef.current = navigationPath;

    const requested = readScrollPosition(navigationPath) ?? 0;
    isRestoringGlobalScrollRef.current = true;

    let frame1 = 0;
    let frame2 = 0;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    let hasAppliedRestore = false;
    let lastAppliedPosition = 0;
    const restore = () => {
      if (hasAppliedRestore && Math.abs(canvas.scrollTop - lastAppliedPosition) > 6) return;
      const maxScroll = Math.max(0, canvas.scrollHeight - canvas.clientHeight);
      const nextPosition = Math.min(Math.max(0, requested), maxScroll);
      canvas.scrollTop = nextPosition;
      lastAppliedPosition = nextPosition;
      hasAppliedRestore = true;
    };

    frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(restore);
    });

    // Some views finish their auto-height/content transition after the first
    // two frames. Reapply once after settling so returning to a page lands at
    // the exact saved position rather than a browser-clamped intermediate one.
    settleTimer = setTimeout(() => {
      restore();
      isRestoringGlobalScrollRef.current = false;
    }, 460);

    return () => {
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
      if (settleTimer) clearTimeout(settleTimer);
      isRestoringGlobalScrollRef.current = false;
    };
  }, [navigationPath, readScrollPosition]);

  const fetchMaterials = async (bypassCache = false) => {
    if (!currentUserRef.current) return;
    // Stale-while-revalidate: render from cache instantly, then update with fresh data
    if (!bypassCache) {
      const cached = await CacheManager.get<any[]>("materials", CACHE_TTL.MATERIALS);
      if (cached) setSubjects(cached);
    }
    try {
      const response = await apiClient("/api/materials?scope=subjects", { bypassCache });
      if (response.ok) {
        const data = await response.json();
        if (data && data.subjects) {
          setSubjects(data.subjects);
          CacheManager.set("materials", data.subjects, CACHE_TTL.MATERIALS).catch(() => {});
          IDBManager.setItem("subjects_cache", data.subjects).catch(() => {});
        }
      }
    } catch (err) {
      // Already served from CacheManager above if available; fall back to IDB/localStorage on hard failure
      const idbCached = await IDBManager.getItem("subjects_cache");
      if (idbCached) {
        setSubjects(idbCached as any);
      } else {
        const cachedStr = localStorage.getItem("subjects_cache");
        if (cachedStr) setSubjects(safeJsonParse(cachedStr, []));
      }
    }
  };

  const fetchDbLectures = async (bypassCache = false) => {
    if (!currentUserRef.current) return;
    // Stale-while-revalidate: render from cache instantly, then update with fresh data
    if (!bypassCache) {
      const cached = await CacheManager.get<any[]>("lectures", CACHE_TTL.LECTURES);
      if (cached) setDbLectures(cached);
    }
    try {
      const res = await apiClient("/api/lectures", { bypassCache });
      if (res.ok) {
        const data = await res.json();
        setDbLectures(data);
        CacheManager.set("lectures", data, CACHE_TTL.LECTURES).catch(() => {});
        IDBManager.setItem("db_lectures_list_cache", data).catch(() => {});
      } else {
        throw new Error("HTTP error " + res.status);
      }
    } catch (e) {
      try {
        const idbCached = await IDBManager.getItem("db_lectures_list_cache");
        if (idbCached) {
          setDbLectures(idbCached as any);
        } else {
          const cachedStr = localStorage.getItem("db_lectures_list_cache");
          if (cachedStr) setDbLectures(safeJsonParse(cachedStr, []));
        }
      } catch (err) {}
    }
  };

  const fetchCalendarEvents = async (bypassCache = false) => {
    if (!currentUserRef.current) return;
    // Stale-while-revalidate: render from cache instantly, then update with fresh data
    if (!bypassCache) {
      const cached = await CacheManager.get<any[]>("calendar", CACHE_TTL.CALENDAR);
      if (cached) setCalendarEventsDb(cached);
    }
    try {
      const response = await apiClient("/api/calendar/events", { bypassCache });
      if (response.ok) {
        const data = await response.json();
        setCalendarEventsDb(data);
        CacheManager.set("calendar", data, CACHE_TTL.CALENDAR).catch(() => {});
        OfflineEngine.setCachedCalendarEvents(data);
      } else {
        throw new Error("HTTP error " + response.status);
      }
    } catch (e) {
      const cached = OfflineEngine.getCachedCalendarEvents();
      if (cached && cached.length > 0) {
        setCalendarEventsDb(cached);
      }
    }
  };

  // Coalesce lifecycle, focus, visibility, and login refreshes. Previously
  // each trigger started three independent Supabase requests, which made cold
  // starts slower and caused avoidable pool pressure.
  const refreshAcademicData = async (bypassCache = false): Promise<void> => {
    if (academicRefreshInFlightRef.current) return academicRefreshInFlightRef.current;
    if (bypassCache && Date.now() - lastAcademicRefreshAtRef.current < 15_000) return;

    lastAcademicRefreshAtRef.current = Date.now();
    const request = Promise.allSettled([
      fetchMaterials(bypassCache),
      fetchDbLectures(bypassCache),
      fetchCalendarEvents(bypassCache),
    ]).then(() => undefined);
    academicRefreshInFlightRef.current = request;
    try {
      await request;
    } finally {
      academicRefreshInFlightRef.current = null;
    }
  };
  refreshAcademicDataRef.current = refreshAcademicData;

  useEffect(() => {
    if (currentUser && isActive) {
      refreshAcademicDataRef.current?.(false);

      // Seed and synchronize local IndexedDB database stores
      DataSyncManager.fetchAndStoreAcademicMaterials().catch(() => {});
      DataSyncManager.triggerBackgroundSync().catch(() => {});
    }
  }, [currentUser, isActive]);

  // Window focus revalidation and background polling to keep data perfectly synchronized
  // OPTIMIZED: Debounce focus/visibility refreshes to avoid hammering the API when the
  // user switches tabs rapidly or the browser fires spurious visibilitychange events.
  useEffect(() => {
    let lastFetchAt = 0;
    const FOCUS_DEBOUNCE_MS = 30_000; // at most one full refresh per 30s on focus/visibility

    const fetchLatestData = () => {
      if (currentUser && isActive) {
        const now = Date.now();
        if (now - lastFetchAt < FOCUS_DEBOUNCE_MS) return;
        lastFetchAt = now;
        refreshAcademicDataRef.current?.(true);
      }
    };
    
    // 1. Revalidate on window focus
    window.addEventListener('focus', fetchLatestData);
    
    // 2. Intelligent, adaptive background synchronization
    let syncTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleNextSync = () => {
      if (document.visibilityState === 'visible' && isActive) {
        syncTimer = setTimeout(() => {
          fetchLatestData();
          scheduleNextSync();
        }, 3 * 60 * 1000); // 3 minutes
      }
    };
    
    scheduleNextSync();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchLatestData();
        scheduleNextSync();
      } else {
        if (syncTimer) clearTimeout(syncTimer);
      }
    };

    window.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('focus', fetchLatestData);
      window.removeEventListener('visibilitychange', handleVisibility);
      if (syncTimer) clearTimeout(syncTimer);
    };
  }, [currentUser, isActive]);

  // Helper to synchronize local data with backend database
  const syncWithBackend = async (
    userCtx: User | null = currentUser,
    prog: UserProgress[] = progressDb,
    logs: PointsLog[] = pointsLogDb,
    events: CalendarEvent[] = calendarEventsDb,
  ) => {
    if (!userCtx) return;

    // Always preserve locally first to ensure lightning-fast UI responses
    OfflineEngine.setCachedUser(userCtx);
    OfflineEngine.setCachedProgress(prog);
    OfflineEngine.setCachedPointsLogs(logs);
    OfflineEngine.setCachedCalendarEvents(events);

    try {
      const response = await apiClient("/api/auth/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: userCtx.id,
          user: userCtx,
          progress: prog,
          pointsLogs: logs,
          calendarEvents: events,
        }),
        // Background sync: failures are queued locally for retry and surfaced
        // via offline-sync-status, never as a global API error toast.
        silent: true,
      });
      if (response.ok) {
        const data = await response.json();
        if (data.user) {
          setCurrentUser(data.user);
          setActiveAccountId(data.user.id);
          OfflineEngine.setCachedUser(data.user);
        }
        if (data.progress) {
          // Resolve any conflict using Pick Newest Timestamp mechanism
          const resolved = OfflineEngine.resolveConflicts(prog, data.progress);
          setProgressDb(resolved);
          OfflineEngine.setCachedProgress(resolved);
        }
        if (data.pointsLogs) {
          setPointsLogDb(data.pointsLogs);
          OfflineEngine.setCachedPointsLogs(data.pointsLogs);
        }
        // ── Calendar event merge strategy ─────────────────────────────────
        // IMPORTANT: syncWithBackend is called during progress updates (PDF read,
        // quiz done, etc.) — it must NEVER overwrite or mutate personal schedule
        // events. Calendar state is managed independently via fetchCalendarEvents().
        //
        // Rule: only APPEND global academic events (supervisor-created, userId:null)
        // that the local state doesn't already know about. Never remove, replace or
        // reorder existing personal events. Use a functional setter so we always
        // read the current state — not the stale closure value from call time.
        const incomingGlobal: CalendarEvent[] = data.globalCalendarEvents || [];
        if (incomingGlobal.length > 0) {
          setCalendarEventsDb((prev: CalendarEvent[]) => {
            const existingIds = new Set(prev.map((e: CalendarEvent) => e.id));
            const trulyNew = incomingGlobal.filter((e: CalendarEvent) => !existingIds.has(e.id));
            if (trulyNew.length === 0) return prev; // nothing changed — no re-render
            return [...prev, ...trulyNew];
          });
        }
        // Update offline cache conservatively (events param = caller's local state)
        {
          const existingIds = new Set(events.map((e: CalendarEvent) => e.id));
          const newGlobals = incomingGlobal.filter((e: CalendarEvent) => !existingIds.has(e.id));
          if (newGlobals.length > 0) {
            OfflineEngine.setCachedCalendarEvents([...events, ...newGlobals]);
          }
        }
      } else {
        throw new Error("HTTP synchronization failure: " + response.status);
      }
    } catch (e) {
      
      // Queue the action to run in background once connection becomes alive
      OfflineEngine.addToQueue({
        type: "UPDATE_PROGRESS",
        payload: {
          userId: userCtx.id,
          progress: prog,
          pointsLogs: logs,
        },
      });
    }
  };

  // --- Initialize session states ---
  // OPTIMIZED: Synchronously hydrate from cached localStorage data so the UI
  // renders instantly (< 16ms) instead of blocking on the /api/auth/me round-trip
  // (which can take 2-30s on cold starts or slow connections). The network auth
  // validation fires in the background and updates state if the session is valid,
  // or shows the auth screen if it has expired.
  useEffect(() => {
    if (sessionRestoreStartedRef.current) return;
    sessionRestoreStartedRef.current = true;

    let localProgress: UserProgress[] = [];
    let localLogs: PointsLog[] = [];
    let localEvents: CalendarEvent[] = [];

    // ── Step 1: Synchronously read ALL cached data from localStorage ────────
    const cachedEvents = localStorage.getItem("calendar_events");
    if (cachedEvents) {
      try {
        localEvents = safeJsonParse(cachedEvents, []);
      } catch {
        localEvents = initialCalendarEvents;
      }
    } else {
      localEvents = initialCalendarEvents;
    }

    const cachedProgress = localStorage.getItem("progress_db");
    if (cachedProgress) {
      try {
        localProgress = safeJsonParse(cachedProgress, []);
      } catch {
        localProgress = [];
      }
    } else {
      localProgress = [];
    }

    const cachedLogs = localStorage.getItem("points_log");
    if (cachedLogs) {
      try {
        localLogs = safeJsonParse(cachedLogs, []);
      } catch {
        localLogs = [];
      }
    } else {
      localLogs = [];
    }

    // ── Step 2: Instant hydration — render from cached data immediately ─────
    // Read the cached user profile and render the UI in < 16ms instead of
    // waiting for the /api/auth/me round-trip. The background restoreSession()
    // will validate the session and either confirm (updating with fresh data)
    // or reject (showing the auth screen).
    const cachedUserStr = localStorage.getItem("logged_user");
    if (cachedUserStr) {
      try {
        const cachedUser = safeJsonParse<User | null>(cachedUserStr, null);
        if (cachedUser && cachedUser.id && cachedUser.email) {
          // Strip stale unsplash avatars (same check as the offline fallback)
          if (cachedUser.avatar && cachedUser.avatar.includes("unsplash.com")) {
            cachedUser.avatar = "";
            localStorage.setItem("logged_user", JSON.stringify(cachedUser));
          }
          // Hydrate all state from cache synchronously — the UI renders instantly
          setCurrentUser(cachedUser);
          setAuthState("AUTHENTICATED");
          setActiveAccountId(cachedUser.id);
          setProgressDb(localProgress);
          setPointsLogDb(localLogs);
          setCalendarEventsDb(localEvents);
          // Unblock the render immediately — the LaunchScreen exit transition
          // begins in the same frame via the useLayoutEffect below.
          setIsInitializing(false);
        }
      } catch {
        // Corrupted cache — fall through to network restore
      }
    }

    // ── Step 3: Background network validation (non-blocking) ────────────────
    // This runs asynchronously. If the session is valid, it updates state with
    // fresh server data. If invalid, it clears the cached user and shows auth.
    const restoreSession = async () => {
      let persistedToken: string | null = null;
      try {
        persistedToken = await SecureStorage.get("auth_token");
      } catch { /* ignore storage errors */ }

      let optimisticallyRendered = false;
      const cachedUserStr = await SecureStorage.get("logged_user");
      if (cachedUserStr && persistedToken) {
        try {
          const parsed = safeJsonParse<User | null>(cachedUserStr, null);
          if (parsed) {
            if (parsed.avatar && parsed.avatar.includes("unsplash.com")) { parsed.avatar = ""; }
            setCurrentUser(parsed);
            setAuthState("AUTHENTICATED");
            setActiveAccountId(parsed.id);
            setProgressDb(localProgress);
            setPointsLogDb(localLogs);
            setCalendarEventsDb(localEvents);
            optimisticallyRendered = true;
            setIsInitializing(false);
          }
        } catch (e) {}
      }

      try {
        const authHeaders: Record<string, string> = persistedToken
          ? { Authorization: `Bearer ${persistedToken}` }
          : {};

        const response = await apiClient("/api/auth/me", {
          timeoutMs: 15000,
          retries:   2,
          silent:    true,
          headers:   authHeaders,
        });
        if (response.ok) {
          const data = await response.json();
          if (data.user) {
            if (!optimisticallyRendered) {
              setAuthState("AUTHENTICATED");
              setCurrentUser(data.user);
              setActiveAccountId(data.user.id);
              setProgressDb(data.progress || localProgress);
              setPointsLogDb(data.pointsLogs || localLogs);
            } else {
              // Update state in background
              setCurrentUser(data.user);
              setProgressDb(data.progress || localProgress);
              setPointsLogDb(data.pointsLogs || localLogs);
            }
            
            if (data.needsEmailSelection) {
              setAppleEmailSelectionNeeded(true);
              setAppleEmailSelectionData({
                userName: data.user.name || "",
                appleEmail: data.user.email || "",
              });
            }
            
            // Merge: keep ALL local events; only append global events not in local
            {
              const globalEvts: CalendarEvent[] = data.globalCalendarEvents || [];
              const userEvts: CalendarEvent[] = data.calendarEvents || [];
              const localIdSet = new Set(localEvents.map((e: CalendarEvent) => e.id));
              const globalIdSet = new Set(globalEvts.map((e: CalendarEvent) => e.id));
              const extras = [
                ...globalEvts.filter((e: CalendarEvent) => !localIdSet.has(e.id)),
                ...userEvts.filter((e: CalendarEvent) => !localIdSet.has(e.id) && !globalIdSet.has(e.id)),
              ];
              const merged = extras.length > 0 ? [...localEvents, ...extras] : localEvents;
              setCalendarEventsDb(merged);
              localStorage.setItem("calendar_events", JSON.stringify(merged));
            }

            SecureStorage.set("logged_user", JSON.stringify(data.user));
            localStorage.setItem(
              "progress_db",
              JSON.stringify(data.progress || localProgress),
            );
            localStorage.setItem(
              "points_log",
              JSON.stringify(data.pointsLogs || localLogs),
            );
            if (data.token) {
              await SecureStorage.set("auth_token", data.token);
            }
            if (!optimisticallyRendered) setIsInitializing(false);
            return;
          }
          SecureStorage.remove("auth_token");
          SecureStorage.remove("logged_user");
          setCurrentUser(null);
          setAuthState("UNAUTHENTICATED");
          setActiveAccountId(null);
          setProgressDb(localProgress);
          setPointsLogDb(localLogs);
          setCalendarEventsDb(localEvents);
          if (!optimisticallyRendered) setIsInitializing(false);
          return;
        }
      } catch (err: any) {
        if (err && err.status === 401) {
          SecureStorage.remove("auth_token");
          SecureStorage.remove("logged_user");
          setCurrentUser(null);
          setAuthState("UNAUTHENTICATED");
          setProgressDb(localProgress);
          setPointsLogDb(localLogs);
          setCalendarEventsDb(localEvents);
          if (!optimisticallyRendered) setIsInitializing(false);
          return;
        }
        if (err && typeof err.status === "number") {
          if (err.status === 403 && err.body?.banned) {
            SecureStorage.remove("auth_token");
            SecureStorage.remove("logged_user");
            setCurrentUser(null);
            setBannedInfo({
              reason: err.body.reason ?? null,
              isPermanent: err.body.isPermanent ?? true,
              endTime: err.body.endTime ?? null,
            });
            if (!optimisticallyRendered) setIsInitializing(false);
            return;
          }
          if (!optimisticallyRendered) {
             setAuthState("AUTH_ERROR");
             setProgressDb(localProgress);
             setPointsLogDb(localLogs);
             setCalendarEventsDb(localEvents);
             setIsInitializing(false);
          }
          return;
        }
      }

      if (!optimisticallyRendered) {
        const canUseOfflineSession = typeof navigator !== "undefined" && navigator.onLine === false;
        if (cachedUserStr && canUseOfflineSession) {
          try {
            const parsed = safeJsonParse<User | null>(cachedUserStr, null);
            if (!parsed) {
              setAuthState("UNAUTHENTICATED");
              setProgressDb(localProgress);
              setPointsLogDb(localLogs);
              setCalendarEventsDb(localEvents);
              setIsInitializing(false);
              return;
            }
            if (parsed.avatar && parsed.avatar.includes("unsplash.com")) { parsed.avatar = ""; SecureStorage.set("logged_user", JSON.stringify(parsed)); }
             setCurrentUser(parsed);
             setAuthState("AUTHENTICATED");
            setActiveAccountId(parsed.id);
            setProgressDb(localProgress);
            setPointsLogDb(localLogs);
            setCalendarEventsDb(localEvents);
            syncWithBackend(parsed, localProgress, localLogs, localEvents);
            setIsInitializing(false);
          } catch (e) {
          }
        } else {
          setAuthState("UNAUTHENTICATED");
          setProgressDb(localProgress);
          setPointsLogDb(localLogs);
          setCalendarEventsDb(localEvents);
          setIsInitializing(false);
        }
      }
    };

    restoreSession();
       
  }, []);

  // --- Listen to OAuth Popup success messages ---
  useEffect(() => {
    const handleOAuthSuccess = async (event: MessageEvent) => {
      const origin = event.origin;
      const allowedOrigins = new Set<string>([window.location.origin]);
      const configuredApi = getApiBaseUrl();
      if (configuredApi) {
        try { allowedOrigins.add(new URL(configuredApi).origin); } catch { /* invalid config is ignored */ }
      }
      if (!allowedOrigins.has(origin)) {
        return;
      }
      // AuthScreen validates the real popup source and converts accepted
      // completions into same-window synthetic events. App must only consume
      // those synthetic events, never an arbitrary allowed-origin window.
      if (event.source !== null || origin !== window.location.origin) return;

      if (event.data?.type === "OAUTH_AUTH_SUCCESS") {
        const oauthToken: string | undefined = event.data.token;
        const completionKey = oauthToken || "cookie-session";
        if (oauthSessionCompletionRef.current === completionKey) return;
        oauthSessionCompletionRef.current = completionKey;
        // Do NOT call setIsInitializing(true) here — showing the full launch
        // screen during a popup OAuth completion is jarring (the user is still
        // on the auth screen, which should transition smoothly to the dashboard
        // once setCurrentUser fires).  The loading state is only needed on cold
        // starts, not for in-session auth completions.
        try {
          if (oauthToken) {
            // Persist token for all subsequent apiClient calls.
            // Awaited so the Capacitor Preferences write is durable before
            // the next SecureStorage.get() fires inside apiClient below.
            await SecureStorage.set("auth_token", oauthToken);
          }
          // ── Safari ITP guard ─────────────────────────────────────────────
          // On iOS/iPadOS Safari, cookies set inside the OAuth popup (which
          // navigated through a cross-origin site like accounts.google.com)
          // are stored in a partitioned context that the main window's fetch
          // cannot access within the same session.  The `SecureStorage.set`
          // above writes to Capacitor Preferences (sessionStorage on web), but
          // an async storage read can still race the first protected request.
          //
          // Fix: pass the OAuth token directly in the Authorization header so
          // the server can authenticate via Bearer regardless of cookie/storage
          // state.  This is safe — the same JWT is both the cookie and the
          // token, so the server accepts either authentication path.
          //
          // Also note: `silent: true` suppresses `app-api-error` but NOT
          // `app-session-expired`.  Passing an explicit token guarantees a 200
          // response, preventing the session-expired event from firing during
          // a valid OAuth completion and racing with state updates.
          const authHeaders: Record<string, string> = oauthToken
            ? { Authorization: `Bearer ${oauthToken}` }
            : {};

          // Bypass in-memory deduplication cache: a prior unauthenticated
          // /api/auth/me request might still be in the pendingRequests map.
          const response = await apiClient("/api/auth/me", {
            bypassCache: true,
            silent: true,
            headers: authHeaders,
          });
          if (response.ok) {
            const data = await response.json();
            if (data.user) {
              // OAuth has produced a fresh, verified session. Reset the guard
              // so a previous account's expired-session event cannot block it.
              sessionExpiredHandledRef.current = false;
              setAuthState("AUTHENTICATED");
              setCurrentUser(data.user);
              setActiveAccountId(data.user.id);
              // Check if Apple user needs to select their profile email
              if (data.needsEmailSelection) {
                setAppleEmailSelectionNeeded(true);
                setAppleEmailSelectionData({
                  userName: data.user.name || "",
                  appleEmail: data.user.email || "",
                });
              }
              if (data.progress) setProgressDb(data.progress);
              if (data.pointsLogs) setPointsLogDb(data.pointsLogs);
              // Append new global events without touching existing personal events
              if (data.globalCalendarEvents && data.globalCalendarEvents.length > 0) {
                setCalendarEventsDb((prev: CalendarEvent[]) => {
                  const existingIds = new Set(prev.map((e: CalendarEvent) => e.id));
                  const toAdd = data.globalCalendarEvents.filter((e: CalendarEvent) => !existingIds.has(e.id));
                  return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
                });
              }

              SecureStorage.set("logged_user", JSON.stringify(data.user));
              if (data.progress)
                localStorage.setItem(
                  "progress_db",
                  JSON.stringify(data.progress),
                );
              if (data.pointsLogs)
                localStorage.setItem(
                  "points_log",
                  JSON.stringify(data.pointsLogs),
                );
              if (data.globalCalendarEvents || data.calendarEvents) {
                localStorage.setItem(
                  "calendar_events",
                  JSON.stringify(
                    data.globalCalendarEvents || data.calendarEvents,
                  ),
                );
              }
              return;
            }
            throw new Error("Authentication succeeded, but the session could not be loaded.");
          }
          throw new Error("Authentication succeeded, but the session could not be loaded.");
        } catch (err: any) {
          oauthSessionCompletionRef.current = null;
          window.dispatchEvent(new MessageEvent("message", {
            data: {
              type: "OAUTH_AUTH_ERROR",
              message: err?.body?.error || err?.message || "Authentication succeeded, but the session could not be loaded. Please try again.",
            },
            origin: window.location.origin,
          }));
        }
      }
    };

    window.addEventListener("message", handleOAuthSuccess);
    return () => window.removeEventListener("message", handleOAuthSuccess);
       
  }, []);

  // ── iOS PWA cold-start OAuth recovery ──────────────────────────────────────
  // If the PWA was killed by iOS in background while an OAuth popup was open,
  // the popup.closed polling stops — and the session is never delivered.
  // AuthScreen stores the stateToken in localStorage before navigating the
  // popup; this effect runs once after initialisation and, if the user is not
  // yet logged in, queries the server's shared pending OAuth session entry (valid for
  // 5 min) to recover the completed token without the user having to re-auth.
  useEffect(() => {
    if (isInitializing) return;
    if (currentUser) {
      const stalePendingToken = localStorage.getItem("_oauth_pending_token");
      if (stalePendingToken) {
        localStorage.removeItem("_oauth_pending_token");
        void SecureStorage.remove(`oauth_pkce_${stalePendingToken}`);
      }
      setOauthRecoveryPending(false);
      return;
    }
    const pendingToken = localStorage.getItem("_oauth_pending_token");
    if (!pendingToken) {
      setOauthRecoveryPending(false);
      return;
    }
    if (oauthRecoveryStartedRef.current) return;
    oauthRecoveryStartedRef.current = true;

    const clearPendingOAuth = () => {
      localStorage.removeItem("_oauth_pending_token");
      void SecureStorage.remove(`oauth_pkce_${pendingToken}`);
    };
    const waitForRetry = () => new Promise<void>((resolve) => window.setTimeout(resolve, 750));

    (async () => {
      const verifier = await SecureStorage.get(`oauth_pkce_${pendingToken}`);
      // Keep the marker when storage was temporarily unavailable. A later
      // reload can still recover the handoff instead of silently discarding it.
      if (!verifier) {
        setOauthRecoveryPending(false);
        setOauthRedirectError("Google sign-in could not resume securely. Please try again.");
        return;
      }

      let data: any = null;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          const res = await apiClient(`/api/auth/oauth-session/${pendingToken}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-OAuth-State": pendingToken,
            },
            body: JSON.stringify({ code_verifier: verifier }),
            silent: true,
            retries: 0,
          });
          data = await res.json();
          break;
        } catch (err: any) {
          const status = err?.status;
          const retryable = !status || [404, 429, 502, 503].includes(status);
          if (!retryable) {
            clearPendingOAuth();
            setOauthRecoveryPending(false);
            setOauthRedirectError(err?.body?.error || err?.message || "Google authentication could not be completed.");
            return;
          }
          if (attempt === 4) {
            setOauthRecoveryPending(false);
            setOauthRedirectError("Google authentication is taking too long. Please try again.");
            return;
          }
          await waitForRetry();
        }
      }

      if (!data) {
        setOauthRecoveryPending(false);
        setOauthRedirectError("Google authentication could not be completed. Please try again.");
        return;
      }
      if (data.rejected) {
        clearPendingOAuth();
        setOauthRecoveryPending(false);
        setOauthRedirectError(data.message || "Access denied: only @comed.uobaghdad.edu.iq accounts can sign in.");
        return;
      }
      if (!data.success || !data.token) {
        setOauthRecoveryPending(false);
        setOauthRedirectError("Google authentication could not be completed. Please try again.");
        return;
      }

      // Clear the handoff only after the server has returned a verified JWT.
      // The server retains the short-lived handoff record so a lost Safari
      // response can be retried safely with the same PKCE verifier.
      await SecureStorage.set("auth_token", data.token);
      clearPendingOAuth();
      const meRes = await apiClient("/api/auth/me", {
        bypassCache: true,
        silent: true,
        retries: 2,
        headers: { Authorization: `Bearer ${data.token}` },
      });
      if (!meRes.ok) {
        setOauthRecoveryPending(false);
        setOauthRedirectError("Google authentication could not be completed. Please try again.");
        return;
      }
      const meData = await meRes.json();
      if (!meData.user) {
        setOauthRecoveryPending(false);
        setOauthRedirectError("Google authentication could not be completed. Please try again.");
        return;
      }

      oauthSessionCompletionRef.current = data.token;
      sessionExpiredHandledRef.current = false;
      setAuthState("AUTHENTICATED");
      setCurrentUser(meData.user);
      setActiveAccountId(meData.user.id);
      setOauthRecoveryPending(false);
      SecureStorage.set("logged_user", JSON.stringify(meData.user));
      if (meData.progress) {
        setProgressDb(meData.progress);
        localStorage.setItem("progress_db", JSON.stringify(meData.progress));
      }
      if (meData.pointsLogs) {
        setPointsLogDb(meData.pointsLogs);
        localStorage.setItem("points_log", JSON.stringify(meData.pointsLogs));
      }
    })().catch(() => {
      setOauthRecoveryPending(false);
      setOauthRedirectError("Google authentication could not be completed. Please try again.");
    });
  }, [isInitializing, currentUser]);

  // ── OAuth redirect-flow completion handler ──────────────────────────────────
  // When the web OAuth flow completes, the server redirects back to
  // /?oauth_done=1 (success) or /?oauth_error=REASON (error/cancel).
  //
  // The startup restoreSession() above fires concurrently and relies on the
  // httpOnly cookie set by the callback.  In most cases it succeeds.
  // But if Supabase is slow on a cold start (1–2 s responses are normal in
  // this deployment), restoreSession()'s 6 s timeout + 0 retries can expire
  // before the first /api/auth/me round-trip completes, and the fallback to
  // local SecureStorage cache finds nothing (first-ever login) — the user
  // appears logged out even though the cookie is valid.
  //
  // Fix: when we see oauth_done=1, issue a dedicated re-check with a longer
  // timeout and retries.  It is idempotent — if restoreSession() already
  // set currentUser, this call just returns the same data and the setState
  // is a no-op.  If restoreSession() failed, this call rescues the session.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthDone  = params.get("oauth_done");
    const oauthError = params.get("oauth_error");
    const oauthPending = params.get("oauth_pending");
    const oauthState = params.get("oauth_state");
    const emailVerified = params.get("email_verified");
    const verificationError = params.get("verification_error");

    if (!oauthDone && !oauthError && !oauthPending && !emailVerified && !verificationError) return;

    // Preserve the state token if the redirect landed before the browser's
    // localStorage write completed. The recovery effect below performs the
    // one-time PKCE exchange without reloading the application again.
    if (oauthPending && oauthState) {
      localStorage.setItem("_oauth_pending_token", oauthState);
    }

    // Remove the oauth params so they don't persist through navigation or
    // share links.  Use replaceState so the browser back-button behaviour
    // is natural (pressing back goes to wherever the user came from, not
    // to a stale /?oauth_done=1 URL).
    window.history.replaceState(null, "", window.location.pathname);

    if (oauthError) {
      const pendingToken = localStorage.getItem("_oauth_pending_token");
      localStorage.removeItem("_oauth_pending_token");
      if (pendingToken) void SecureStorage.remove(`oauth_pkce_${pendingToken}`);
      // Hold the error until the auth screen has mounted. On a cold redirect
      // App renders its initialization guard first, so dispatching immediately
      // would otherwise lose the event before AuthScreen registers its listener.
      setOauthRedirectError(oauthError);
    }

    if (oauthDone) {
      // Best-effort insurance re-check.  Does NOT touch isInitializing so it
      // cannot race with the startup flow's setIsInitializing(false) call.
      // setState is safe to call even if restoreSession() already set the
      // same values — React bails out of re-renders when state is identical.
      //
      // On iOS Safari ITP, the httpOnly cookie set during OAuth callback may
      // be partitioned. Use a persisted bearer token if available to bypass
      // cookie partitioning issues.
      (async () => {
        try {
          const persistedToken = await SecureStorage.get("auth_token");
          const authHeaders: Record<string, string> = persistedToken
            ? { Authorization: `Bearer ${persistedToken}` }
            : {};
          const res = await apiClient("/api/auth/me", {
            bypassCache: true,
            silent: true,
            timeoutMs: 15000,
            retries: 2,
            headers: authHeaders,
          });
          if (!res.ok) return;
          const data = await res.json();
          if (!data.user) return;
          sessionExpiredHandledRef.current = false;
          setAuthState("AUTHENTICATED");
          setCurrentUser(data.user);
          setActiveAccountId(data.user.id);
          if (data.progress)    setProgressDb(data.progress);
          if (data.pointsLogs)  setPointsLogDb(data.pointsLogs);
          SecureStorage.set("logged_user", JSON.stringify(data.user));
          if (data.token) await SecureStorage.set("auth_token", data.token);
          if (data.progress)
            localStorage.setItem("progress_db", JSON.stringify(data.progress));
          if (data.pointsLogs)
            localStorage.setItem("points_log", JSON.stringify(data.pointsLogs));
        } catch { /* network error — startup call already handled fallback */ }
      })();
    }

    // Email verification redirect: the backend issued an httpOnly session
    // cookie before redirecting, so calling /api/auth/me will return the
    // now-verified user and hydrate the authenticated app state.
    if (emailVerified) {
      (async () => {
        try {
          const res = await apiClient("/api/auth/me", {
            bypassCache: true,
            silent: true,
            timeoutMs: 15000,
            retries: 2,
          });
          if (!res.ok) return;
          const data = await res.json();
          if (!data.user) return;
          sessionExpiredHandledRef.current = false;
          setAuthState("AUTHENTICATED");
          setCurrentUser(data.user);
          setActiveAccountId(data.user.id);
          if (data.progress)    setProgressDb(data.progress);
          if (data.pointsLogs)  setPointsLogDb(data.pointsLogs);
          SecureStorage.set("logged_user", JSON.stringify(data.user));
          if (data.token) await SecureStorage.set("auth_token", data.token);
          if (data.progress)
            localStorage.setItem("progress_db", JSON.stringify(data.progress));
          if (data.pointsLogs)
            localStorage.setItem("points_log", JSON.stringify(data.pointsLogs));
        } catch { /* network error — startup call already handled fallback */ }
      })();
    }

    // Verification link error (expired or invalid token) — dispatch to
    // AuthScreen so the user sees a clear message with a resend option.
    if (verificationError) {
      setVerificationRedirectError(verificationError);
    }
  }, []);

  useEffect(() => {
    if (isInitializing || oauthRecoveryPending || !oauthRedirectError) return;
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("oauth-redirect-error", {
        detail: oauthRedirectError,
      }));
      setOauthRedirectError(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isInitializing, oauthRecoveryPending, oauthRedirectError]);

  useEffect(() => {
    if (isInitializing || oauthRecoveryPending || !verificationRedirectError) return;
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("verification-redirect-error", {
        detail: verificationRedirectError,
      }));
      setVerificationRedirectError(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isInitializing, oauthRecoveryPending, verificationRedirectError]);

  // --- Capacitor & Apple HIG Integrations ---

  // 1. Splash Screen Concealer + launch screen signal.
  // useLayoutEffect fires synchronously after React commits the DOM — before
  // the browser paints the new frame.  This means app-ready reaches the
  // LaunchScreen in the same commit cycle that the initialized app content
  // is stamped into the DOM, so there is zero extra frame of latency between
  // "initialization done" and "splash begins to exit".
  useLayoutEffect(() => {
    if (!isInitializing && !oauthRecoveryPending) {
      NativeBridge.hideSplashScreen().catch(() => {});
      // Signal the web launch screen to begin its exit transition.
      // hasSidebar = desktop layout with persistent sidebar visible.
      const hasSidebar =
        device.horizontalSizeClass !== "compact" && !!currentUser;
      document.dispatchEvent(
        new CustomEvent("app-ready", { detail: { hasSidebar } }),
      );
    }
  }, [isInitializing, oauthRecoveryPending]);

  // 2. Automated Idle Preloading (Routes & Warm API Cache Prefetching)
  useEffect(() => {
    if (!isInitializing) {
      const idleTimer = setTimeout(() => {
        // Sequentially preload dynamic route components to avoid CPU/network concurrency bottlenecks
        // ControlCenterView is admin-only (498 KB) — skip for regular users
        const isAdminUser =
          currentUser &&
          (currentUser.role === "admin" ||
            currentUser.role === "owner" ||
            (currentUser as any).isAdmin);
        const routesToPreload = [
          ModulesView,
          ModulePlaceholderView,
          SubjectView,
          CalendarView,
          ProfileView,

          BulletinCenter,
          LectureDetailView,
          ...(isAdminUser ? [ControlCenterView] : []),
          SettingsView,
        ];

        routesToPreload.forEach((component, index) => {
          setTimeout(() => {
            if (component && typeof component.preload === "function") {
              component.preload();
            }
          }, index * 200); // 200ms stagger interval to prevent parallel thread throttling
        });

      }, 1500); // Wait 1.5 seconds for UI layout to fully mount and paint first

      return () => clearTimeout(idleTimer);
    }
  }, [isInitializing, currentUser]);

  // 3. Hover & Touchstart Gesture-Driven Route Prefetcher (Event Delegation)
  useEffect(() => {
    const handleNavigationInteraction = (e: Event) => {
      let target = e.target as HTMLElement | null;
      while (target && target !== document.body) {
        if (
          target.nodeType === Node.ELEMENT_NODE &&
          typeof target.getAttribute === "function"
        ) {
          const title = target.getAttribute("title") || "";
          const text = target.textContent || "";
          const isModules =
            title.includes("Modules") ||
            title.includes("الموديولات") ||
            text.includes("Modules") ||
            text.includes("الموديولات");
          const isSchedule =
            title.includes("Schedule") ||
            title.includes("الجدول") ||
            text.includes("Schedule") ||
            text.includes("الجدول");
          const isBulletin =
            title.includes("Bulletin") ||
            title.includes("لوحة الإعلانات") ||
            text.includes("Bulletin") ||
            text.includes("لوحة الإعلانات");
          const isProfile =
            title.includes("Profile") ||
            title.includes("الملف الشخصي") ||
            text.includes("Profile") ||
            text.includes("الملف الشخصي");
          const isSettings =
            title.includes("Settings") ||
            title.includes("الإعدادات") ||
            text.includes("Settings") ||
            text.includes("الإعدادات");

          if (isModules) {
            ModulesView.preload?.();
          } else if (isSchedule) {
            CalendarView.preload?.();
          } else if (isProfile) {
            ProfileView.preload?.();
          } else if (isSettings) {
            SettingsView.preload?.();
          } else if (isBulletin) {
            BulletinCenter.preload?.();
          }
        }
        target = target.parentElement;
      }
    };

    document.addEventListener("pointerenter", handleNavigationInteraction, {
      capture: true,
      passive: true,
    });
    document.addEventListener("touchstart", handleNavigationInteraction, {
      capture: true,
      passive: true,
    });

    return () => {
      document.removeEventListener(
        "pointerenter",
        handleNavigationInteraction,
        { capture: true },
      );
      document.removeEventListener("touchstart", handleNavigationInteraction, {
        capture: true,
      });
    };
       
  }, []);

  // 4. Status Bar Style sync
  useEffect(() => {
    NativeBridge.setStatusBarStyle(resolvedTheme).catch(() => {});
  }, [resolvedTheme]);

  // 3. Monitor Network status & Local clinical caching notify
  useEffect(() => {
    // Sync with OfflineEngine connectivity listeners
    const unsubEngine = OfflineEngine.subscribe((status) => {
      setIsOnline(status);
      HapticFeedback.notification(status ? "success" : "warning");
      setActiveToast({
        id: `netStatus_${Date.now()}`,
        title: status
          ? language === "ar"
            ? "تمت العودة للاتصال بالشبكة"
            : "Synergetic Network Connected"
          : language === "ar"
            ? "أنت تعمل دون اتصال حالياً"
            : "Offline Mode Active",
        desc: status
          ? language === "ar"
            ? "يتوفر المزامنة السريعة لبيانات السجلات الطبية والأسئلة."
            : "Syncing clinical study schedules and results."
          : language === "ar"
            ? "تم تحويل الواجهات تلقائياً لوضع الأرشفة غير المتصل الكلي."
            : "Loading study outlines from device memory.",
      });
      if (status) {
        fetchMaterials().catch(() => {});
        fetchDbLectures().catch(() => {});
        fetchCalendarEvents().catch(() => {});
      }
    });

    const handleSyncFinished = () => {
      fetchMaterials().catch(() => {});
      fetchDbLectures().catch(() => {});
      fetchCalendarEvents().catch(() => {});
    };

    window.addEventListener("offline-sync-completed", handleSyncFinished);

    return () => {
      unsubEngine();
      window.removeEventListener("offline-sync-completed", handleSyncFinished);
    };
  }, [language]);

  // 4. Handle hardware back button for true native mobile navigation
  useEffect(() => {
    const unsubscribe = NativeBridge.registerBackButtonListener(() => {
      if (activeLecture) {
        setActiveLecture(null);
        return;
      }
      if (activeSubjectId) {
        setActiveSubjectId(null);
        return;
      }
      if (activeTab !== "home") {
        setActiveTab("home");
        return;
      }
    });
    return unsubscribe;
  }, [activeLecture, activeSubjectId, activeTab]);

  // 6. Push notifications setup
  useEffect(() => {
    if (!currentUser) return;

    let cleanup: (() => void) | undefined;

    NativeBridge.setupPushNotifications(
      (token) => {
        apiClient("/api/notifications/register-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: currentUser.id, token }),
        }).catch((err) => {
          
        });
      },
      (notification) => {
        const mappedNotif: AppNotification = {
          id: notification.id || `push_${Date.now()}`,
          title: notification.title || "Incoming Bulletin",
          titleAr: notification.titleAr || "إشعار أكاديمي وارد",
          desc: notification.body || "",
          descAr: notification.body || "",
          date: new Date().toISOString(),
          read: false,
          type: "system",
        };
        setNotifications((prev) => {
          const exists = prev.some((n) => n.id === mappedNotif.id);
          if (exists) return prev;
          return [mappedNotif, ...prev];
        });
        
        if (pushAlertsRef.current) {
          HapticFeedback.notification("success");
          setActiveToast({
            id: mappedNotif.id,
            title: mappedNotif.title,
            desc: mappedNotif.desc,
          });
        }
      },
    ).then((cleanupFn) => {
      cleanup = cleanupFn;
    }).catch((err) => {
      
    });

    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, [currentUser?.id]);

  // 7. Process deep links and universal routing actions
  useEffect(() => {
    const unsubscribe = NativeBridge.registerDeepLinkListener(
      (url, path, params) => {
        
        const segment = path.replace(/^\//, "");
        if (segment === "subjects") {
          setActiveTab("subjects");
        } else if (segment === "calendar") {
          setActiveTab("calendar");
        } else if (segment === "profile") {
          setActiveTab("profile");
        } else if (segment === "settings") {
          setActiveTab("settings");
        } else if (segment === "lecture" && params.id) {
          const foundLec = dbLectures.find((l) => l.id === params.id);
          if (foundLec) {
            setActiveLecture(foundLec as unknown as Lecture);
            setActiveTab("subjects");
          }
        }
      },
    );
    return unsubscribe;
  }, [dbLectures]);

  // --- Handlers ---
  const handleAuthSuccess = async (
    authorName: string,
    authorEmail: string,
    authorPassword?: string,
    studentGroup?: string,
    isNewUser?: boolean,
    authorSignature?: string | null,
  ) => {
    const endpoint = isNewUser ? "/api/auth/register" : "/api/auth/login";
    const payload: Record<string, unknown> = {
      email: authorEmail,
      name: authorName,
      password: authorPassword,
      studentGroup,
    };
    if (isNewUser && authorSignature) {
      payload.signature = authorSignature;
    }
    const res = await apiClient(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // Credential failures are surfaced inline by the auth form — never as a
      // duplicate global toast.
      silent: true,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      // Banned user — show suspension screen instead of propagating error
      if (res.status === 403 && data?.banned) {
        setBannedInfo({
          reason: data.reason ?? null,
          isPermanent: data.isPermanent ?? true,
          endTime: data.endTime ?? null,
        });
        return;
      }
      throw new Error(data?.error || "Authentication failed. Please check your credentials.");
    }

    if (data?.verificationRequired === true) {
      return { verificationRequired: true, initialEmailDeliveryFailed: !!data.initialEmailDeliveryFailed };
    }

    if (!data?.user || typeof data.user !== "object" || !data.user.id) {
      throw new Error("Authentication succeeded, but the session response was incomplete. Please try again.");
    }

    // Persist native bearer delivery before mounting any protected data
    // effects. Otherwise the first parallel request can run without a token
    // and incorrectly report that there is no authenticated session.
    if (data.token) {
      await SecureStorage.set("auth_token", data.token);
    }

    // A fresh session is established — allow future expiry events to be handled.
    sessionExpiredHandledRef.current = false;
    setAuthState("AUTHENTICATED");

    setCurrentUser(data.user);
    setActiveAccountId(data.user.id);
    setProgressDb(data.progress || []);
    setPointsLogDb(data.pointsLogs || []);
    setCalendarEventsDb(data.calendarEvents || []);

    SecureStorage.set("logged_user", JSON.stringify(data.user));
    localStorage.setItem("progress_db", JSON.stringify(data.progress || []));
    localStorage.setItem("points_log", JSON.stringify(data.pointsLogs || []));
    localStorage.setItem("calendar_events", JSON.stringify(data.calendarEvents || []));
  };

  // Profile updaters
  const handleUpdateProfile = useCallback(
    async (newName: string, newEmail: string, newAvatar: string, newGroup?: string, newSignature?: string) => {
      if (!currentUser) return;
      const previousAvatar = String(currentUser.avatar || currentUser.avatarUrl || "").trim();
      const removeAvatar = newAvatar.trim() === "" && previousAvatar !== "";
      const updatedUser = {
        ...currentUser,
        name: newName,
        email: newEmail,
        avatar: newAvatar,
        avatarUrl: newAvatar,
        signature: newSignature !== undefined ? newSignature : currentUser.signature,
        studentGroup: newGroup || currentUser.studentGroup || "A",
      };
      setCurrentUser(updatedUser);
      SecureStorage.set("logged_user", JSON.stringify(updatedUser));

      try {
        const payload: any = {
          userId: currentUser.id,
          name: newName,
          email: newEmail,
          avatar: newAvatar,
          avatarUrl: newAvatar,
          removeAvatar,
          studentGroup: newGroup
        };
        if (newSignature !== undefined) payload.signature = newSignature;
        
        const res = await apiClient("/api/auth/update-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.user) {
            const mergedUser = {
              ...data.user,
              // Respect an explicit empty avatar returned after deletion. Using || here
              // would incorrectly resurrect the previous/local image.
              avatar: removeAvatar ? "" : (data.user.avatar ?? newAvatar),
              avatarUrl: removeAvatar ? "" : (data.user.avatarUrl ?? data.user.avatar ?? newAvatar),
              signature: data.user.signature !== undefined ? data.user.signature : (newSignature !== undefined ? newSignature : currentUser.signature),
            };
            setCurrentUser(mergedUser);
            SecureStorage.set("logged_user", JSON.stringify(mergedUser));
          }
        } else {
          throw new Error("HTTP update profile failure: " + res.status);
        }
      } catch (e: any) {
        if (e.status === 413 || e.status === 400 || e.status === 403) {
          // Do not queue permanent payload size, validation, or authorization errors.
          // The apiClient has already dispatched 'app-api-error' to show a toast.
          return;
        }
        
        const offlinePayload: any = {
          userId: currentUser.id,
          name: newName,
          email: newEmail,
          avatar: newAvatar,
          removeAvatar,
          studentGroup: newGroup,
        };
        if (newSignature !== undefined) offlinePayload.signature = newSignature;
        
        OfflineEngine.addToQueue({
          type: "UPDATE_PROFILE",
          payload: offlinePayload,
        });
      }
    },
    [currentUser],
  );

  // Apple email selection handler
  const handleAppleEmailSelection = useCallback(async (choice: "apple" | "university", universityEmail?: string) => {
    if (!currentUser) return;
    const res = await apiClient("/api/auth/apple/select-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: currentUser.id, choice, universityEmail }),
    });
    const data = await res.json();
    if (res.ok && data.user) {
      setCurrentUser(data.user);
      SecureStorage.set("logged_user", JSON.stringify(data.user));
      setAppleEmailSelectionNeeded(false);
      setAppleEmailSelectionData(null);
    } else {
      throw new Error(data.error || "Failed to select email.");
    }
  }, [currentUser]);

  const signOutInFlightRef = useRef(false);

const handleSignOut = useCallback(async () => {
  // Prevent duplicate taps on iPhone/iPad while logout cleanup is running.
  if (signOutInFlightRef.current) return;
  signOutInFlightRef.current = true;

  oauthSessionCompletionRef.current = null;

  // Start server-side logout immediately, but NEVER block the UI waiting for it.
  // This fixes the iOS/iPadOS issue where Sign Out appeared to require
  // multiple taps while the network request was still pending.
  void apiClient("/api/auth/logout", {
    method: "POST",
    silent: true,
    timeoutMs: 5000,
  }).catch(() => {});

  // Change UI/session state immediately on the FIRST tap.
  setAuthState("UNAUTHENTICATED");
  setCurrentUser(null);
  setProfileDropdownOpen(false);
  setNotifications([]);

  try {
    await Promise.all([
      SecureStorage.remove("auth_token"),
      SecureStorage.remove("logged_user"),
    ]);

    clearApiCache();
    CacheManager.invalidate();

    localStorage.removeItem("progress_db");
    localStorage.removeItem("points_log");
    localStorage.removeItem("calendar_events");
    localStorage.removeItem("subjects_catalog_cache");
    localStorage.removeItem("detailed_lectures_cache");
    localStorage.removeItem("offline_mutations_queue");
    localStorage.removeItem("offline_dlq");
    localStorage.removeItem("app_notifications_v1");

    // Best-effort IndexedDB cleanup must not delay or prevent visible logout.
    void IDBManager.removeItem("subjects_cache").catch(() => {});
    void IDBManager.removeItem("db_lectures_list_cache").catch(() => {});

    try {
      indexedDB.deleteDatabase("BaghdadMedicalOfflineDB_v2");
    } catch {}

    const accountId = getActiveAccountId();
    setActiveAccountId(null);

    // Remaining account cleanup can finish after the UI has already logged out.
    await Promise.allSettled([
      clearAccountData(accountId),
      OfflineEngine.clearAccountStorage(),
    ]);
  } finally {
    signOutInFlightRef.current = false;
  }
}, []);

  const handleForceLocalReset = useCallback(async () => {
    oauthSessionCompletionRef.current = null;
    try {
      await apiClient("/api/auth/logout", { method: "POST", silent: true });
    } catch (err) {
      
    }
    await Promise.all([SecureStorage.remove("auth_token"), SecureStorage.remove("logged_user")]);
    clearApiCache();
    CacheManager.invalidate();
    localStorage.removeItem("progress_db");
    localStorage.removeItem("points_log");
    localStorage.removeItem("calendar_events");
    localStorage.removeItem("subjects_catalog_cache");
    localStorage.removeItem("detailed_lectures_cache");
    localStorage.removeItem("offline_mutations_queue");
    localStorage.removeItem("offline_dlq");
    localStorage.removeItem("app_notifications_v1");
    setNotifications([]);
    IDBManager.removeItem("subjects_cache").catch(() => {});
    IDBManager.removeItem("db_lectures_list_cache").catch(() => {});
    indexedDB.deleteDatabase("BaghdadMedicalOfflineDB_v2");
    const accountId = getActiveAccountId();
    setActiveAccountId(null);
    await clearAccountData(accountId);
    await OfflineEngine.clearAccountStorage();
    setAuthState("UNAUTHENTICATED");
    setCurrentUser(null);
    setProfileDropdownOpen(false);
       
  }, []);

  const handleAccountSelfDelete = useCallback(async (confirmation: string) => {
    try {
      const response = await apiClient("/api/auth/self-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      if (response.ok) {
        oauthSessionCompletionRef.current = null;
        await Promise.all([SecureStorage.remove("auth_token"), SecureStorage.remove("logged_user")]);
        clearApiCache();
        CacheManager.invalidate();
        localStorage.removeItem("progress_db");
        localStorage.removeItem("points_log");
        localStorage.removeItem("calendar_events");
        localStorage.removeItem("subjects_catalog_cache");
        localStorage.removeItem("detailed_lectures_cache");
        localStorage.removeItem("offline_mutations_queue");
        localStorage.removeItem("offline_dlq");
        localStorage.removeItem("app_notifications_v1");
        setNotifications([]);
        IDBManager.removeItem("subjects_cache").catch(() => {});
        IDBManager.removeItem("db_lectures_list_cache").catch(() => {});
        indexedDB.deleteDatabase("BaghdadMedicalOfflineDB_v2");
        const accountId = getActiveAccountId();
        setActiveAccountId(null);
        await clearAccountData(accountId);
        await OfflineEngine.clearAccountStorage();
        setCurrentUser(null);
        setProfileDropdownOpen(false);
        setActiveToast({
          id: String(Date.now()),
          title:
            language === "ar"
              ? "تم حذف الحساب نهائياً"
              : "Account Permanently Deleted",
          desc:
            language === "ar"
              ? "تم مسح جميع بيانات الطالب والدرجات والتقدم الدراسي بنجاح."
              : "All clinical student marks, progress, and credentials have been permanently expunged.",
        });
        setTimeout(() => {
          window.location.reload();
        }, 3000);
        return true;
      }
      return false;
    } catch (err) {
      
      return false;
    }
  }, [language]);

  // Incremental points reward engine (De-activated / Silent no-op for points removal)
  const handleAddPoints = useCallback((amount: number, reason: string) => {
    // Silent no-op under the points removal requirement
       
  }, []);

  // Update lecture specific study tasks completions
  const handleUpdateLectureProgress = useCallback(
    (updates: Partial<UserProgress>) => {
      if (!activeLecture || !currentUser) return;

      // Check if progress already exists for this node
      const exists = progressDb.find((p) => p.lectureId === activeLecture.id);
      let updatedDb: UserProgress[] = [];

      if (exists) {
        updatedDb = progressDb.map((p) => {
          if (p.lectureId === activeLecture.id) {
            return { ...p, ...updates, lastAccessed: new Date().toISOString() };
          }
          return p;
        });
      } else {
        const newProg: UserProgress = {
          userId: currentUser.id,
          lectureId: activeLecture.id,
          pdfCompleted: updates.pdfCompleted || false,
          notesCompleted: updates.notesCompleted || false,
          videoCompleted: updates.videoCompleted || false,
          flashcardsCompleted: updates.flashcardsCompleted || false,
          quizCompleted: updates.quizCompleted || false,
          quizScore: updates.quizScore,
          lastAccessed: new Date().toISOString(),
        };
        updatedDb = [...progressDb, newProg];
      }

      setProgressDb(updatedDb);
      setTimeout(() => localStorage.setItem("progress_db", JSON.stringify(updatedDb)), 0);

      // Direct synchronization
      syncWithBackend(currentUser, updatedDb, pointsLogDb, calendarEventsDb);
    },
    [activeLecture, currentUser, progressDb, pointsLogDb, calendarEventsDb],
  );

  const handleAddNewEvent = useCallback(
    async (newEvent: CalendarEvent) => {
      // If it is a global academic class (type: LECTURE, QUIZ, EXAM), we post to server
      const isGlobal =
        newEvent.eventType === "LECTURE" ||
        newEvent.eventType === "QUIZ" ||
        newEvent.eventType === "EXAM";

      if (isGlobal) {
        const startStr = `${newEvent.date}T${newEvent.time || "09:00"}:00`;
        const startIso = formatToBaghdadISO(startStr);
        const endIso = dayjs(startIso).add(1, "hour").format();

        try {
          const response = await apiClient("/api/calendar/events", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              title: newEvent.title,
              eventType: newEvent.eventType,
              startDateTime: startIso,
              endDateTime: endIso,
              targetGroups: newEvent.targetGroups || ["ALL"],
              sendNotification: true,
            }),
          });

          if (response.ok) {
            return;
          } else {
            throw new Error("HTTP failure " + response.status);
          }
        } catch (e) {
          
          OfflineEngine.addToQueue({
            type: "ADD_EVENT",
            payload: {
              title: newEvent.title,
              eventType: newEvent.eventType,
              startDateTime: startIso,
              endDateTime: endIso,
              targetGroups: newEvent.targetGroups || ["ALL"],
              sendNotification: true,
            },
          });
        }
      }

      const updated = [newEvent, ...calendarEventsDb];
      setCalendarEventsDb(updated);
      setTimeout(() => localStorage.setItem("calendar_events", JSON.stringify(updated)), 0);

      // Append beautiful active notification to database for real-time alerting
      let notifType: "lecture" | "exam" | "quiz" | "announcement" | "system" | "holiday" | "discussion" | "achievement" | "event" = "event";
      const evTypeStr = (newEvent.eventType || newEvent.type || "").toUpperCase();
      if (evTypeStr === "LECTURE" || evTypeStr === "CLASS" || evTypeStr === "LECTURES") {
        notifType = "lecture";
      } else if (evTypeStr === "EXAM" || evTypeStr === "IMPORTANT EXAM") {
        notifType = "exam";
      } else if (evTypeStr === "QUIZ" || evTypeStr === "DAILY EXAM") {
        notifType = "quiz";
      } else if (evTypeStr === "ANNOUNCEMENT" || evTypeStr === "BULLETIN") {
        notifType = "announcement";
      }

      const newNotif: AppNotification = {
        id: `not_${Date.now()}`,
        title: `Event Scheduled: ${newEvent.title}`,
        titleAr: `تم جدولة حدث: ${newEvent.title}`,
        desc: `A new task or study milestone has been added to your calendar for ${newEvent.date} at ${newEvent.time}.`,
        descAr: `تمت إضافة مهمة دراسية جديدة إلى جدولك الخاص بتاريخ ${newEvent.date} الساعة ${newEvent.time}.`,
        date: new Date().toISOString(),
        read: false,
        type: notifType,
      };
      setNotifications((prev) => [newNotif, ...prev]);

      // Direct synchronization
      syncWithBackend(currentUser, progressDb, pointsLogDb, updated);
    },
    [calendarEventsDb, currentUser, progressDb, pointsLogDb],
  );

  const handleDeleteEvent = useCallback(
    async (eventId: string) => {
      // Optimistically remove from all state layers immediately
      const updated = calendarEventsDb.filter((e) => e.id !== eventId);
      setCalendarEventsDb(updated);
      localStorage.setItem("calendar_events", JSON.stringify(updated));
      OfflineEngine.setCachedCalendarEvents(updated);

      if (eventId.startsWith("task_")) {
        syncWithBackend(currentUser, progressDb, pointsLogDb, updated);
      } else {
        try {
          const response = await apiClient(`/api/calendar/events/${eventId}`, {
            method: "DELETE",
          });
          if (!response.ok) {
            throw new Error("HTTP deletion failure: " + response.status);
          }
        } catch (err) {
          OfflineEngine.addToQueue({
            type: "DELETE_EVENT",
            payload: eventId,
          });
        }
      }
    },
    [calendarEventsDb, currentUser, progressDb, pointsLogDb],
  );

  const handleUpdateEvents = useCallback(
    (updatedEvents: CalendarEvent[]) => {
      setCalendarEventsDb(updatedEvents);
      setTimeout(() => localStorage.setItem("calendar_events", JSON.stringify(updatedEvents)), 0);

      // Direct synchronization
      syncWithBackend(currentUser, progressDb, pointsLogDb, updatedEvents);
    },
    [currentUser, progressDb, pointsLogDb],
  );

  const handleEditEvent = useCallback((event: CalendarEvent) => {
    setEditingCalendarEvent(event);
  }, []);

  const handleEditEventSave = useCallback((updatedEvent: CalendarEvent) => {
    setCalendarEventsDb((prev) => {
      const updated = prev.map((e) => e.id === updatedEvent.id ? updatedEvent : e);
      setTimeout(() => localStorage.setItem("calendar_events", JSON.stringify(updated)), 0);
      return updated;
    });
    setEditingCalendarEvent(null);
  }, []);

  // Quick navigation shortcut handler
  const handleSelectSubject = useCallback((id: SubjectId) => {
    setActiveSubjectId(id);
    setActiveLecture(null);
    setActiveTab("subjects");
       
  }, []);

  const handleSelectLectureDirect = useCallback((lect: Lecture) => {
    setActiveSubjectId(lect.subjectId);
    setActiveLecture(lect);
    setActiveTab("subjects");
       
  }, []);

  // Helper retrieve progress node for detail view
  const activeLectureProgress = useMemo(() => {
    if (!activeLecture || !currentUser)
      return {
        userId: "",
        lectureId: "",
        pdfCompleted: false,
        notesCompleted: false,
        videoCompleted: false,
        flashcardsCompleted: false,
        quizCompleted: false,
        lastAccessed: "",
      };
    const p = progressDb.find((item) => item.lectureId === activeLecture.id);
    return (
      p || {
        userId: currentUser.id,
        lectureId: activeLecture.id,
        pdfCompleted: false,
        notesCompleted: false,
        videoCompleted: false,
        flashcardsCompleted: false,
        quizCompleted: false,
        lastAccessed: new Date().toISOString(),
      }
    );
  }, [activeLecture, currentUser, progressDb]);

  // Helper retrieve progress node for home detail view
  const activeHomeLectureProgress = useMemo(() => {
    if (!activeHomeLecture || !currentUser)
      return {
        userId: "",
        lectureId: "",
        pdfCompleted: false,
        notesCompleted: false,
        videoCompleted: false,
        flashcardsCompleted: false,
        quizCompleted: false,
        lastAccessed: "",
      };
    const p = progressDb.find(
      (item) => item.lectureId === activeHomeLecture.id,
    );
    return (
      p || {
        userId: currentUser.id,
        lectureId: activeHomeLecture.id,
        pdfCompleted: false,
        notesCompleted: false,
        videoCompleted: false,
        flashcardsCompleted: false,
        quizCompleted: false,
        lastAccessed: new Date().toISOString(),
      }
    );
  }, [activeHomeLecture, currentUser, progressDb]);

  // Update home lecture specific study tasks completions
  const handleUpdateHomeLectureProgress = useCallback(
    (updates: Partial<UserProgress>) => {
      if (!activeHomeLecture || !currentUser) return;

      // Check if progress already exists for this node
      const exists = progressDb.find(
        (p) => p.lectureId === activeHomeLecture.id,
      );
      let updatedDb: UserProgress[] = [];

      if (exists) {
        updatedDb = progressDb.map((p) => {
          if (p.lectureId === activeHomeLecture.id) {
            return { ...p, ...updates, lastAccessed: new Date().toISOString() };
          }
          return p;
        });
      } else {
        const newProg: UserProgress = {
          userId: currentUser.id,
          lectureId: activeHomeLecture.id,
          pdfCompleted: updates.pdfCompleted || false,
          notesCompleted: updates.notesCompleted || false,
          videoCompleted: updates.videoCompleted || false,
          flashcardsCompleted: updates.flashcardsCompleted || false,
          quizCompleted: updates.quizCompleted || false,
          quizScore: updates.quizScore,
          lastAccessed: new Date().toISOString(),
        };
        updatedDb = [...progressDb, newProg];
      }

      setProgressDb(updatedDb);
      setTimeout(() => localStorage.setItem("progress_db", JSON.stringify(updatedDb)), 0);

      // Direct synchronization
      syncWithBackend(currentUser, updatedDb, pointsLogDb, calendarEventsDb);
    },
    [activeHomeLecture, currentUser, progressDb, pointsLogDb, calendarEventsDb],
  );

  const activeLectureUser = useMemo(() => ({
    id: currentUser?.id,
    name: currentUser?.name || "",
    email: currentUser?.email || "",
    avatar: currentUser?.avatar || "",
  }), [currentUser]);
  
  const homeDashboardUser = useMemo(
    () => ({
      id: currentUser?.id,
      name: currentUser?.name || (language === "ar" ? "طالب" : "Student"),
      email: currentUser?.email || "",
      totalPoints: currentUser?.totalPoints || 0,
      level: currentUser?.level || "Beginner",
      levelBadge: currentUser?.levelBadge || "🌱",
      streakDays: currentUser?.streakDays || 0,
    }),
    [currentUser, language],
  );

  // ── Canonical Lecture Resolution ────────────────────────────────────────
  // Maps a raw database lecture row into the app's canonical Lecture type.
  // This is the ONLY place where a DB lecture becomes a Lecture object for
  // navigation, ensuring consistency across Search and manual navigation.
  const resolveCanonicalLecture = useCallback(async (lectureId: string): Promise<Lecture | null> => {
    // 1. Try the already-loaded authoritative list (fastest path).
    const dbLecture = dbLectures?.find((l: any) => l.id === lectureId);
    if (dbLecture) {
      return {
        id: dbLecture.id,
        moduleId: `${dbLecture.mainSubject}_${dbLecture.subSubject || "general"}`,
        subjectId: dbLecture.mainSubject as SubjectId,
        title: dbLecture.name,
        doctorName: dbLecture.department || "Medical Staff",
        pdfUrl: dbLecture.materials?.find((m: any) => m.type.toUpperCase() === "PDF")?.fileUrlOrLink || "",
        notesPdfUrl: dbLecture.materials?.find((m: any) => m.type.toUpperCase() === "NOTE")?.fileUrlOrLink || "",
        orderNumber: 0,
        type: dbLecture.trackMode as "Theory" | "Practical",
        category: dbLecture.subSubject || "",
        description: "Database Registered Course Material Module.",
        pages: [],
        notesPages: [],
        isDatabaseLecture: true,
        materials: dbLecture.materials || [],
        mcqs: dbLecture.mcqs || [],
        flashcards: dbLecture.flashcards || [],
      };
    }

    // 2. Fall back to the authoritative detail endpoint (ensures full data).
    try {
      const response = await apiClient(`/api/lectures/${lectureId}`, {
        silent: true,
        bypassCache: true,
      });
      if (response.ok) {
        const data = await response.json();
        return {
          id: data.id,
          moduleId: `${data.mainSubject}_${data.subSubject || "general"}`,
          subjectId: data.mainSubject as SubjectId,
          title: data.name,
          doctorName: data.department || "Medical Staff",
          pdfUrl: data.materials?.find((m: any) => m.type.toUpperCase() === "PDF")?.fileUrlOrLink || "",
          notesPdfUrl: data.materials?.find((m: any) => m.type.toUpperCase() === "NOTE")?.fileUrlOrLink || "",
          orderNumber: 0,
          type: data.trackMode as "Theory" | "Practical",
          category: data.subSubject || "",
          description: "Database Registered Course Material Module.",
          pages: [],
          notesPages: [],
          isDatabaseLecture: true,
          materials: data.materials || [],
          mcqs: data.mcqs || [],
          flashcards: data.flashcards || [],
        };
      }
    } catch {}
    return null;
  }, [dbLectures]);

  const handleSearchSelect = useCallback(async (result: SearchResultItem) => {
    // Close search palette immediately.
    setIsCommandPaletteOpen(false);

    // ── Step 1: Determine target tab from result type ────────────────
    const tabToOpen: "pdf" | "notes" | "mcqs" | "flashcards" | "videos" | "qa" =
      result.type === "notes" ? "notes" :
      result.type === "video" ? "videos" :
      result.type === "mcq" ? "mcqs" :
      result.type === "flashcard" ? "flashcards" : "pdf";

    // ── Step 2: Resolve the canonical lecture (single source of truth) ──
    let foundLecture: Lecture | null = null;
    const rawResult = result.raw as any;

    // For seeded lecture results: the raw field already contains the complete Lecture.
    if (result.type === "lecture" && rawResult?.title && rawResult?.id && !result.id.startsWith("db-")) {
      foundLecture = rawResult as Lecture;
    }

    // For seeded non-lecture results (video, mcq, etc.): resolve from globalSearchData.
    if (!foundLecture && result.lectureId && !result.id.startsWith("db-")) {
      const match = globalSearchData.find(
        (item) => item.lectureId === result.lectureId && item.type === "lecture",
      );
      if (match?.raw && (match.raw as any).title) {
        foundLecture = match.raw as Lecture;
      }
    }

    // For all DB results: always resolve canonical from the authoritative source.
    if (!foundLecture && result.lectureId) {
      foundLecture = await resolveCanonicalLecture(result.lectureId);
    }

    if (!foundLecture) {
      // Cannot resolve — fall back to showing the subject list.
      setActiveHomeSubjectId(null);
      setActiveHomeLecture(null);
      setLectureDetailSource(null);
      setActiveLecture(null);
      setActiveSubjectId(result.subjectId as SubjectId);
      setActiveTab("subjects");
      return;
    }

    // ── Step 3: Snapshot current state for Back navigation ────────────
    // Push the pre-search state so the first Back restores where we were.
    pushNavigationStack();

    // ── Step 4: Reconstruct the canonical manual navigation path ──────
    // Search is a shortcut into the Library → Subject → Lecture hierarchy.
    // Push intermediate states so Back walks the real path, not a fake route.

    // For lecture-type results, push the Subject-level state (Back from
    // lecture should show the subject's lecture list).
    if (result.type === "lecture") {
      navigationStackRef.current.push({
        activeTab: "subjects",
        activeSubjectId: (result.subjectId || foundLecture.subjectId) as SubjectId,
        activeLecture: null,
        activeLectureTab: tabToOpen,
        activeHomeSubjectId: null,
        activeHomeLecture: null,
        lectureDetailSource: null,
      });
    }

    // ── Step 5: Set final navigation state atomically ─────────────────
    // Clear home state — Search always navigates through Library.
    setActiveHomeSubjectId(null);
    setActiveHomeLecture(null);
    setLectureDetailSource(null);
    setActiveTab("subjects");
    setActiveSubjectId((result.subjectId || foundLecture.subjectId) as SubjectId);
    setActiveLectureTab(tabToOpen);
    setActiveLecture(foundLecture);
  }, [globalSearchData, dbLectures, pushNavigationStack, resolveCanonicalLecture]);

  const sidebarMainItems = useMemo(
    () => [
      {
        id: "home",
        icon: Home,
        label: language === "ar" ? "الرئيسية" : "Welcome",
      },
      {
        id: "subjects",
        icon: Layers3,
        label: language === "ar" ? "الموديولات" : "Modules",
      },
      {
        id: "calendar",
        icon: CalIcon,
        label: language === "ar" ? "الجدول" : "Schedule",
      },
      ...(currentUser?.isAdmin ||
      currentUser?.role === "admin" ||
      currentUser?.role === "owner"
        ? [
            {
              id: "control-center",
              icon: Database,
              label: language === "ar" ? "التحكم" : "Console",
              colorClass: "text-med-gold dark:text-med-gold",
              bgClass:
                "bg-med-gold/[0.06] dark:bg-amber-400/[0.1] border border-amber-500/[0.06] dark:border-amber-400/[0.1] shadow-inner dark:shadow-inner",
            },
          ]
        : []),
    ],
    [language, currentUser],
  );

  const sidebarSystemItems = useMemo(
    () => [
      {
        id: "profile",
        icon: UserIcon,
        label: language === "ar" ? "الملف الشخصي" : "My Profile",
      },
      {
        id: "settings",
        icon: Settings,
        label: language === "ar" ? "الإعدادات" : "Settings",
        colorClass:
          "text-med-blue dark:text-blue-400 font-semibold drop-shadow-md",
        bgClass:
          "bg-blue-50 dark:bg-med-blue/10 border border-blue-200/50 dark:border-blue-500/20 shadow-elevation-1 dark:shadow-[0_2px_10px_rgba(0,0,0,0.4)]",
      },
      {
        id: "bulletin",
        icon: Bell,
        label: language === "ar" ? "التنبيهات" : "Notifications",
        colorClass: "text-rose-600 dark:text-rose-500",
        bgClass:
          "bg-rose-500/[0.06] dark:bg-rose-400/[0.1] border border-rose-500/[0.06] dark:border-rose-400/[0.1] shadow-inner dark:shadow-inner",
        iconBadge: bulletinIconBadge,
        rightBadge: bulletinRightBadge,
      },
    ],
    [language, bulletinIconBadge, bulletinRightBadge],
  );

  const bottomTabBarItems = useMemo(
    () => [
      {
        id: "home",
        icon: Home,
        label: language === "ar" ? "الرئيسية" : "Welcome",
      },
      {
        id: "subjects",
        icon: Layers3,
        label: language === "ar" ? "الموديولات" : "Modules",
      },
      {
        id: "calendar",
        icon: CalIcon,
        label: language === "ar" ? "الجدول" : "Schedule",
      },
      ...(currentUser?.isAdmin ||
      currentUser?.role === "admin" ||
      currentUser?.role === "owner"
        ? [
            {
              id: "control-center",
              icon: Database,
              label: language === "ar" ? "التحكم" : "Console",
              activeColorClass: "text-amber-500 dark:text-amber-400",
            },
          ]
        : []),
      {
        id: "profile",
        icon: UserIcon,
        label: language === "ar" ? "حسابي" : "My Profile",
      },
    ],
    [language, currentUser],
  );

  // --- Initialization guard ---
  // The LaunchScreen (z-index 9999) fully covers the app during startup.
  // Return a stable background that exactly matches the splash screen color so
  // there is no color flash if the two ever diverge in timing (e.g. bfcache
  // restore, safety-timer exit, or very fast local-cache restore).
  // Never show a skeleton / debug text here — it's always hidden by the launch
  // screen and would flash through if exposed before the real UI is ready.
  if (isInitializing || oauthRecoveryPending || authState === "INITIALIZING") {
    return (
      <div
        className="fixed inset-0 bg-[#F5F1EC] dark:bg-[#052050]"
        aria-hidden="true"
      />
    );
  }

  // Intercept password reset path
  const isResetPasswordPath =
    pathname === "/reset-password" ||
    window.location.search.includes("token=");
  if (isResetPasswordPath) {
    return (
      <Suspense
        fallback={
          <div className="h-full w-full flex flex-col flex items-center justify-center bg-[#F8F9FC] dark:bg-[#000000]">
            <DashboardSkeleton />
          </div>
        }
      >
        <ResetPasswordScreen />
      </Suspense>
    );
  }

  // Intercept public legal routes so Privacy / Terms / Support / Medical
  // Disclaimer are reachable without signing in (required for App Store
  // compliance). Reuses the same views shown inside the app; onBack returns
  // to the previous page or the auth entry point.
  const publicLegalPath = ["/privacy", "/terms", "/support", "/disclaimer"].find(
    (path) => pathname === path,
  );
  if (publicLegalPath) {
    const publicLegalViews = {
      "/privacy": PrivacyPolicyView,
      "/terms": TermsOfServiceView,
      "/support": SupportView,
      "/disclaimer": MedicalDisclaimerView,
    } as const;
    const PublicLegalView = publicLegalViews[publicLegalPath as keyof typeof publicLegalViews];
    return (
      <div className="legal-page-public h-full w-full bg-[#F8F9FC] dark:bg-[#000000]">
        <Suspense
          fallback={
            <div className="h-full w-full flex flex-col items-center justify-center bg-[#F8F9FC] dark:bg-[#000000]">
              <DashboardSkeleton />
            </div>
          }
        >
          <ErrorBoundary>
            <PublicLegalView
              onBack={() => {
                if (window.history.length > 1) {
                  window.history.back();
                } else {
                  navigateInApp("/", true);
                }
              }}
            />
          </ErrorBoundary>
        </Suspense>
      </div>
    );
  }

  if (bannedInfo) {
    return (
      <Suspense fallback={
        <div className="min-h-full w-full bg-[#0a0a0b] flex items-center justify-center">
          <DashboardSkeleton />
        </div>
      }>
        <SuspensionScreen
          reason={bannedInfo.reason}
          isPermanent={bannedInfo.isPermanent}
          endTime={bannedInfo.endTime}
          language={language}
          onExpired={() => setBannedInfo(null)}
        />
      </Suspense>
    );
  }

  if (!currentUser) {
    return (
      <div 
        className="h-full w-full flex flex-col bg-[#F8F9FC] dark:bg-[#000000] selection:bg-med-gold/20 relative"
      >
        <Suspense
          fallback={
            <div className="h-full w-full flex flex-col flex items-center justify-center bg-[#F8F9FC] dark:bg-[#000000]">
              <DashboardSkeleton />
            </div>
          }
        >
          <AuthScreen
            onNavigateToLegal={navigateInApp}
            onLoginSuccess={(u) =>
              handleAuthSuccess(u.name, u.email, u.password, u.studentGroup, u.isNewUser, u.signature)
            }
          />
        </Suspense>
      </div>
    );
  }

  // First-time OAuth onboarding. Existing accounts bypass this screen.
  if (currentUser && (currentUser.accountStatus === "PENDING_PROFILE" || currentUser.accountStatus === "pending_profile")) {
    return (
      <Suspense fallback={
        <div className="min-h-full w-full bg-[#F8F9FC] dark:bg-[#000000] flex items-center justify-center">
          <DashboardSkeleton />
        </div>
      }>
        <ProfileCompletionScreen
          user={currentUser}
          onComplete={async (data) => {
            const res = await apiClient("/api/auth/complete-profile", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(data),
            });
            const responseData = await res.json().catch(() => ({}));
            if (!res.ok || !responseData.user) {
              throw new Error(responseData.error || "Failed to complete profile.");
            }

            const completedUser = {
              ...currentUser,
              ...responseData.user,
              accountStatus: "ACTIVE" as const,
            };
            setCurrentUser(completedUser);
            currentUserRef.current = completedUser;
            await SecureStorage.set("logged_user", JSON.stringify(completedUser));
            setActiveAccountId(completedUser.id);
            if (responseData.progress) setProgressDb(responseData.progress);
            if (responseData.pointsLogs) setPointsLogDb(responseData.pointsLogs);
            if (responseData.calendarEvents) setCalendarEventsDb(responseData.calendarEvents);
          }}
        />
      </Suspense>
    );
  }

  // Apple email selection onboarding — shown after first Apple login
  if (appleEmailSelectionNeeded && appleEmailSelectionData) {
    return (
      <Suspense fallback={
        <div className="min-h-full w-full bg-[#F8F9FC] dark:bg-[#000000] flex items-center justify-center">
          <DashboardSkeleton />
        </div>
      }>
        <AppleEmailSelectionScreen
          userName={appleEmailSelectionData.userName}
          appleEmail={appleEmailSelectionData.appleEmail}
          onSelect={handleAppleEmailSelection}
        />
      </Suspense>
    );
  }

  // Size Class checks instead of specific device models
  const isCompactWidth = device.horizontalSizeClass === "compact";
  const isRegularWidth = device.horizontalSizeClass === "regular";
  const isCompactHeight = device.verticalSizeClass === "compact";

  // ── Three-tier layout discriminators ──────────────────────────────────────
  // Phone   → bottom tab bar, full-width content, no sidebar
  // Tablet  → icon rail (< 900 px) or collapsible sidebar (≥ 900 px)
  // Desktop → full collapsible sidebar
  const usePhoneLayout = device.isPhone;
  const useRailNav     = device.railNav; // thin icon-only sidebar, no expand

  // Rail nav is always visually "collapsed"; normal tablet/desktop respects user toggle
  const isAsideCollapsed = isSidebarCollapsed || useRailNav;

  return (
    <div
      className={`h-full max-h-full w-full max-w-full bg-neutral-50 dark:bg-[#000000] text-[#1C1C1E] dark:text-white font-sans flex flex-col ${usePhoneLayout ? "mobile-phone-layout" : "flex-row"} justify-between selection:bg-med-blue/20 relative overflow-hidden${device.isTablet ? " ipad-layout" : ""}${isSidebarAnimating ? " sidebar-animating" : ""}`}
      style={{
        fontSize: `${textScale}rem`,
      }}
    >
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        data={globalSearchData}
        onSelectResult={handleSearchSelect}
      />
      {!isOnline && (
        <div className="absolute top-0 left-0 right-0 bg-red-500/90 backdrop-blur-sm text-white text-xs py-1.5 text-center z-[100] font-medium" style={{ paddingTop: 'calc(4px + env(safe-area-inset-top, 0px))' }}>
          {language === "ar" ? "أنت غير متصل بالإنترنت. بعض الميزات قد تكون غير متاحة." : "You're currently offline. Some features may be unavailable."}
        </div>
      )}

      {/* macOS Style Sidebar Navigation for Desktop & Mac devices */}
      <aside
        aria-label={
          language === "ar" ? "الشريط الجانبي الرئيسي" : "Main Sidebar"
        }
        className={`${usePhoneLayout ? "hidden" : "flex"} sidebar-shell shrink-0 flex-col bg-[#F7F7F8] dark:bg-[#1C1C1E] border-r border-black/[0.05] dark:border-white/[0.08] h-full max-h-full select-none z-30 justify-between overflow-hidden relative`}
        style={{
          width: isAsideCollapsed ? device.sidebarCollapsedWidth : device.sidebarExpandedWidth,
          flexBasis: isAsideCollapsed ? device.sidebarCollapsedWidth : device.sidebarExpandedWidth,
          paddingTop: "calc(16px + env(safe-area-inset-top, 0px))",
          paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
        }}
        onKeyDown={handleSidebarKeyDown}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-white/80 to-transparent dark:from-[#222630]/40 dark:to-transparent z-[-2] pointer-events-none" />
        <div className="absolute top-0 left-0 right-0 h-[50vh] bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.9),transparent_70%)] dark:bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.04),transparent_70%)] z-[-1] pointer-events-none" />
        <div
          className="absolute inset-0 opacity-[0.015] dark:opacity-[0.03] z-[-1] pointer-events-none "
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E\")",
          }}
        />

        <div className={`flex flex-col min-h-0 flex-1 relative z-10 ${isAsideCollapsed ? "px-1" : "px-3"}`}>
          {/* Logo & Brand header — switches between row (expanded) and column (collapsed) */}
          <div
            className={`sidebar-header flex pt-2 pb-5 ${
              isAsideCollapsed ? "sidebar-header-collapsed" : "sidebar-header-expanded"
            }`}
          >
            {/* id used by LaunchScreen for FLIP shared-element transition */}
            <div id="sidebar-app-logo" style={{ display: "inline-flex", flexShrink: 0 }}>
              <AppLogo size="sm" iconOnly circle />
            </div>

            {/* Brand text — fades + collapses horizontally when sidebar shrinks */}
            <div
              className={`sidebar-brand flex flex-col justify-center min-w-0 ${
                isAsideCollapsed ? "sidebar-brand-collapsed" : "sidebar-brand-expanded"
              }`}
            >
              <h2 className={`${"text-[14.5px]"} font-semibold text-neutral-900 dark:text-white leading-none tracking-[-0.3px] truncate antialiased`}>
                {"99's Guide"}
              </h2>
              <p className={`${"text-[11.5px]"} text-neutral-400 dark:text-[#EBEBF560] font-medium leading-none tracking-[0.01em] truncate antialiased mt-[6px]`}>
                {language === "ar"
                  ? "مساحة العمل الأكاديمية"
                  : "Academic Workspace"}
              </p>
            </div>

            {/* Collapse/expand toggle — plain <button>, no Framer Motion.
                iOS/Swift feel: immediate background fill on touchDown (CSS :active),
                chevron rotation via CSS transition only. No scale, no spring, no glow.
                Hidden for rail nav (always icon-only). */}
            {!useRailNav && (
              <button
                type="button"
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                aria-label={isSidebarCollapsed
                  ? (language === "ar" ? "توسيع الشريط الجانبي" : "Expand sidebar")
                  : (language === "ar" ? "تصغير الشريط الجانبي" : "Collapse sidebar")}
                title={isSidebarCollapsed
                  ? (language === "ar" ? "توسيع" : "Expand")
                  : (language === "ar" ? "تصغير" : "Collapse")}
                className={[
                  "shrink-0 flex items-center justify-center rounded-lg",
                  "text-neutral-400 dark:text-[#EBEBF560]",
                  "hover:text-neutral-600 dark:hover:text-neutral-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-med-blue focus-visible:ring-offset-2",
                  "dark:focus-visible:ring-offset-neutral-950",
                  "sidebar-toggle",
                  "w-11 h-11",
                ].join(" ")}
              >
                <span
                  className={`sidebar-toggle-icon ${
                    isAsideCollapsed ? "sidebar-toggle-icon-collapsed" : ""
                  }`}
                >
                  <ChevronLeft className={"w-[20px] h-[20px]"} />
                </span>
              </button>
            )}
          </div>
          {/* Navigation */}
          <motion.nav
            aria-label={language === "ar" ? "التنقل الرئيسي" : "Main Navigation"}
            className={`flex flex-col ${device.isTablet ? "gap-2" : "gap-0.5"} overflow-y-auto min-h-0 flex-1 hide-scrollbar overscroll-y-contain`}
            style={{ scrollbarWidth: "none" }}
            initial="hidden"
            animate="visible"
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.045, delayChildren: 0.04 } },
            }}
          >
            {sidebarMainItems.map((item) => (
              <SidebarNavItem
                key={item.id}
                id={item.id}
                icon={item.icon}
                label={item.label}
                isActive={activeTab === item.id}
                isAsideCollapsed={isAsideCollapsed}
                isTablet={device.isTablet}
                onClick={handleSidebarTabClick}
                colorClass={item.colorClass}
                bgClass={item.bgClass}
              />
            ))}

            {/* Section divider */}
            <motion.div
              className="flex items-center gap-2.5 px-1.5 mt-5 mb-2"
              variants={{
                hidden: { opacity: 0 },
                visible: { opacity: 1, transition: { duration: 0.25, delay: 0.1 } },
              }}
            >
              <span className="flex-1 h-px bg-neutral-200/80 dark:bg-white/[0.07]" />
              {!isAsideCollapsed && (
                <span className="text-[10px] font-semibold text-neutral-400 dark:text-[#EBEBF540] uppercase tracking-[0.1em] antialiased select-none">
                  {language === "ar" ? "النظام" : "System"}
                </span>
              )}
              <span className="flex-1 h-px bg-neutral-200/80 dark:bg-white/[0.07]" />
            </motion.div>

            {sidebarSystemItems.map((item) => (
              <SidebarNavItem
                key={item.id}
                id={item.id}
                icon={item.icon}
                label={item.label}
                isActive={activeTab === item.id}
                isAsideCollapsed={isAsideCollapsed}
                isTablet={device.isTablet}
                onClick={handleSidebarTabClick}
                colorClass={item.colorClass}
                bgClass={item.bgClass}
                iconBadge={item.iconBadge}
                rightBadge={item.rightBadge}
              />
            ))}
          </motion.nav>
        </div>

        {/* User Profile Card — pinned to bottom */}
        <div className={`px-3 shrink-0 relative z-10 mt-auto ${device.isTablet ? "pb-3" : "pb-2"}`}>
          {/* Top separator */}
          <div className="h-px bg-neutral-200/60 dark:bg-white/[0.07] mb-3" />

          <div
            className={`flex items-center ${
              isAsideCollapsed
                ? "justify-center flex-col gap-3"
                : `${device.isTablet ? "px-3 py-2.5" : "px-2.5 py-2"} justify-between rounded-xl
                   bg-neutral-100/50 dark:bg-white/[0.04]
                   border border-black/[0.04] dark:border-white/[0.07]
                   hover:bg-neutral-100/90 dark:hover:bg-white/[0.08]
                   transition-colors duration-200 ease-out`
            }`}
          >
            {/* Avatar + name */}
            <button
              onClick={() => handleSidebarTabClick("profile")}
              className={`flex items-center ${"gap-3.5"} cursor-pointer outline-none
                focus-visible:ring-2 focus-visible:ring-med-blue focus-visible:ring-offset-2
                dark:focus-visible:ring-offset-neutral-950 min-w-0 group rounded-lg
                active:scale-[0.97] active:opacity-80 transition-transform duration-75
                ${isAsideCollapsed ? "hover:scale-105" : "flex-1 text-left"}`}
              title={currentUser.name}
              aria-label={`${language === "ar" ? "الملف الشخصي لـ" : "Profile for"} ${currentUser.name}`}
            >
              <div className="relative shrink-0 group-hover:scale-105 transition-transform duration-200 ease-out">
                <UserAvatar
                  name={currentUser.name}
                  avatarUrl={currentUser.avatar}
                  className={`${(isAsideCollapsed ? "w-11 h-11" : "w-12 h-12")} border border-white/25 dark:border-white/[0.12]`}
                />
                {/* Online dot */}
                <span className={`absolute bottom-0 right-0 ${"w-3 h-3"} rounded-full bg-emerald-400 border-2 border-white dark:border-[#1C1C1E]`} />
              </div>
              {!isAsideCollapsed && (
                <div className="flex-1 min-w-0">
                  <h4 className={`${"text-[15px]"} font-semibold text-neutral-900 dark:text-white leading-none truncate antialiased`}>
                    {currentUser.name}
                  </h4>
                  <p className={`${"text-[12.5px]"} font-medium text-neutral-400 dark:text-[#EBEBF560] truncate antialiased mt-[5px]`}>
                    {(currentUser as any).profileEmail || currentUser.email}
                  </p>
                </div>
              )}
            </button>

            {/* Sign-out button */}
            <motion.button
              onClick={handleSignOut}
              className={`rounded-lg flex items-center justify-center shrink-0 outline-none
                text-neutral-400 dark:text-[#EBEBF560]
                hover:text-rose-500 dark:hover:text-rose-400
                hover:bg-rose-50/70 dark:hover:bg-rose-500/10
                focus-visible:ring-2 focus-visible:ring-med-blue focus-visible:ring-offset-2
                dark:focus-visible:ring-offset-neutral-950
                transition-colors duration-200 ease-out
                ${isAsideCollapsed ? "w-11 h-11 bg-neutral-100/70 dark:bg-white/[0.05] border border-black/[0.04] dark:border-white/[0.07]" : "w-11 h-11"}`}
              title={language === "ar" ? "تسجيل الخروج" : "Sign Out"}
              aria-label={language === "ar" ? "تسجيل الخروج" : "Sign Out"}
              whileHover={{ scale: 1.1, rotate: -15 }}
              whileTap={{ scale: 0.88, opacity: 0.7 }}
              transition={{ type: "spring", stiffness: 500, damping: 25 }}
            >
              <LogOut className={device.isTablet ? "w-[18px] h-[18px]" : "w-[15px] h-[15px]"} />
            </motion.button>
          </div>
        </div>
      </aside>
      {/* Main Content Workspace wrapper */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full max-h-full overflow-hidden relative">
        {/* 2. Main Content Canvas */}
        <main
          id="main-scroll-canvas"
            className={`flex-1 min-h-0 w-full max-w-full mx-auto ${device.margins} overflow-y-auto overflow-x-clip ios-scrollable overscroll-y-contain ${usePhoneLayout ? (isCompactHeight ? "ios-main-scroll ios-main-scroll-compact" : "ios-main-scroll") : ""}`}
          style={{
            paddingTop: "calc(16px + env(safe-area-inset-top, 0px))",
             // The phone scroll inset is supplied by .ios-main-scroll so it
             // accounts for the fixed bar without creating a separate spacer.
             paddingBottom: usePhoneLayout
               ? undefined
               : "calc(24px + env(safe-area-inset-bottom, 0px))",
          }}
        >
          {/* iOS Native Large Title (Scrolls with Content) */}
          {((activeTab === "subjects" && activeSubjectId === null && activeModuleId === null) ||
            ["calendar", "control-center", "profile", "settings"].includes(
              activeTab,
            )) && (
            <div className={`mb-6 pt-2 select-none ${usePhoneLayout ? "" : "md:hidden"}`}>
              {activeTab === "profile" && usePhoneLayout ? (
                <div className="flex items-center justify-between">
                  <h1 className="text-large-title font-display font-semibold text-neutral-900 dark:text-white">
                    {language === "ar" ? "ملف الطالب" : "Profile"}
                  </h1>
                  <button
                    type="button"
                    onClick={() => setActiveTab("bulletin")}
                    className="relative flex items-center justify-center w-10 h-10 -mr-2 rounded-full active:bg-neutral-200 dark:active:bg-white/10 transition-colors"
                    aria-label={language === "ar" ? "التنبيهات" : "Notifications"}
                  >
                    <Bell className="w-[22px] h-[22px] text-neutral-600 dark:text-neutral-400" />
                    {unreadNotificationsCount > 0 && (
                      <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 border-[1.5px] border-white dark:border-neutral-950" />
                    )}
                  </button>
                </div>
              ) : (
                <h1 className="text-large-title font-display font-semibold text-neutral-900 dark:text-white">
                  {activeTab === "subjects"
                    ? language === "ar"
                      ? "الموديولات"
                      : "Modules"
                    : activeTab === "calendar"
                      ? language === "ar"
                        ? "الجدول والامتحانات"
                        : "Schedule"
                      : activeTab === "control-center"
                        ? language === "ar"
                          ? "لوحة التحكم"
                          : "Control Center"
                        : activeTab === "profile"
                          ? language === "ar"
                            ? "ملف الطالب"
                            : "Profile"
                          : activeTab === "settings"
                            ? language === "ar"
                              ? "الإعدادات"
                              : "Settings"
                            : ""}
                </h1>
              )}
            </div>
          )}

          {/* VIEW CONDITIONAL SWITCH WITH FLUID GESTURE TRANSITIONS */}
          <div className="w-full relative min-h-full">
            {/* Tab 1: Welcome (Home) */}
            <div
              
              style={{ display: activeTab === "home" ? "block" : "none" }}
              className="w-full"
            >
              {/* Plain div replaces the no-op motion.div that was here.
                  The previous wrapper had animate={{ opacity:1, scale:1 }} with initial={false}
                  — it never animated to different values, so it was a permanent no-op.
                  Its willChange:"transform,opacity" created a persistent GPU compositing layer
                  for the entire home tab that was destroyed + rebuilt on every display:none→block
                  cycle, amplifying the iOS Safari Hero brightness-glitch on tab return. */}
              <div
                className="w-full"
              >
                <>
                  {activeHomeSubjectId === null ? (
                    <motion.div
                      key="home-dashboard"
                      initial={{ opacity: 1, x: 0 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 1, x: 0 }}
                      style={{ willChange: "transform, opacity" }}
                      transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
                    >
                      <Suspense fallback={iOSLoadingFallback}>
<ErrorBoundary>
                        <HomeDashboard
                          user={currentUser}
                          subjects={subjects}
                          dbLectures={dbLectures}
                          calendarEvents={calendarEventsDb}
                          progress={progressDb}
                          globalSearchData={globalSearchData}
                          onSearchSelect={handleSearchSelect}
                          onSelectSubject={handleSelectHomeSubject}
                          onSelectLecture={handleSelectHomeLecture}
                          onNavigateTab={handleSidebarTabClick}
                          onUpdateEvents={handleUpdateEvents}
                          onAddEvent={handleAddNewEvent}
                          language={language}
                          isActive={activeTab === 'home'}
                        />
                      </ErrorBoundary>
</Suspense>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="home-subject-details"
                      initial={{ opacity: 1, x: 0, scale: 1 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 1, x: 0, scale: 1 }}
                      transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
                      className="relative overflow-hidden w-full"
                      style={{
                        transform: `translate3d(${homeSubjectSwipeX}px, 0, 0)`,
                        transition: isReleasingHomeSubject
                          ? "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)"
                          : "none",
                        willChange: "transform, opacity",
                      }}
                    >
                      <div className="w-full grid grid-cols-1 grid-rows-1 relative">
                        {/* Smooth state-driven preservation of SubjectView without unmounting (keeps states and scroll) */}
                        <motion.div
                          style={{
                            gridArea: "1 / 1 / 2 / 2",
                            pointerEvents:
                              activeHomeLecture === null ? "auto" : "none",
                            willChange: "transform, opacity",
                          }}
                          initial={{ opacity: 1 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 1 }}
                          transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
                          className="w-full"
                        >
                          <Suspense fallback={iOSLoadingFallback}>
<ErrorBoundary>
                            <SubjectView
                              key={activeHomeSubjectId}
                              subject={subjects.find(
                                (s) => s.id === activeHomeSubjectId,
                              ) || subjects[0]}
                              progress={progressDb}
                              dbLectures={dbLectures}
                              deepLinkedLecture={activeHomeLecture}
                              onBack={handleBackHomeSubject}
                              onSelectLecture={handleSelectNestedLecture}
                              language={language}
                              calendarEvents={calendarEventsDb}
                            />
                          </ErrorBoundary>
</Suspense>
                        </motion.div>

                        <>
                          {activeHomeLecture !== null && (
                            <motion.div
                              key="home-lecture-detail"
                              style={{
                                gridArea: "1 / 1 / 2 / 2",
                                zIndex: 10,
                                boxShadow:
                                  "0 20px 40px -15px rgba(0, 0, 0, 0.15), 0 15px 25px -10px rgba(0, 0, 0, 0.08)",
                                overflow: "hidden",
                                transform: `translate3d(${homeLectureSwipeX}px, 0, 0)`,
                                transition: isReleasingHomeLecture
                                  ? "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)"
                                  : "none",
                                willChange: "transform, opacity",
                              }}
                              initial={{ opacity: 1 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 1 }}
                              transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
                              className="w-full bg-neutral-50 dark:bg-[#1C1C1E] shadow-[0_8px_32px_rgba(0,0,0,0.6)] rounded-xl"
                            >
                              <Suspense fallback={iOSLoadingFallback}>
<ErrorBoundary>
                                <LectureDetailView
                                  lecture={activeHomeLecture}
                                  progress={activeHomeLectureProgress}
                                  onUpdateProgress={
                                    handleUpdateHomeLectureProgress
                                  }
                                  onAddPoints={handleAddPoints}
                                  onBack={() => {
                                    setActiveHomeLecture(null);
                                    if (lectureDetailSource === "dashboard") {
                                      setActiveHomeSubjectId(null);
                                    }
                                    setLectureDetailSource(null);
                                  }}
                                  currentUser={activeLectureUser}
                                  language={language}
                                  initialTab={activeLectureTab}
                                  calendarEvents={calendarEventsDb}
                                />
                              </ErrorBoundary>
</Suspense>
                            </motion.div>
                          )}
                        </>
                      </div>
                    </motion.div>
                  )}
                </>
              </div>
            </div>

            {/* Tab 2: Modules */}
            <div
              style={{ display: activeTab === "subjects" ? "block" : "none" }}
              className="w-full"
            >
              <div className="w-full">
                {activeModuleId !== null ? (
                  <div
                    className="w-full"
                    style={{
                      transform: `translate3d(${subjectSwipeX}px, 0, 0)`,
                      transition: isReleasingSubject
                        ? "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)"
                        : "none",
                      willChange: "transform",
                    }}
                  >
                    <Suspense fallback={iOSLoadingFallback}>
                      <ErrorBoundary>
                        <ModulePlaceholderView
                          subject={subjects.find((subject) => subject.id === activeModuleId) || subjects[0]}
                          onBack={() => setActiveModuleId(null)}
                          language={language}
                        />
                      </ErrorBoundary>
                    </Suspense>
                  </div>
                ) : activeSubjectId === null ? (
                  <Suspense fallback={iOSLoadingFallback}>
                    <ErrorBoundary>
                      <ModulesView
                        subjects={subjects}
                        lectureCounts={subjectLectureCounts}
                        progressBySubject={subjectProgressMetrics}
                        onSelectModule={(subjectId) => {
                          setActiveLecture(null);
                          setActiveModuleId(subjectId);
                        }}
                        language={language}
                      />
                    </ErrorBoundary>
                  </Suspense>
                ) : (
                  /* Legacy SubjectView remains available only for search/deep links.
                     It is no longer the visible Modules-page navigation path. */
                  <div
                    key="subject-details-wrapper"
                    className="relative overflow-hidden w-full"
                    style={{ transform: `translate3d(${subjectSwipeX}px, 0, 0)` }}
                  >
                    <div className="w-full grid grid-cols-1 grid-rows-1 relative">
                      <div
                        style={{
                          gridArea: "1 / 1 / 2 / 2",
                          pointerEvents: activeLecture === null ? "auto" : "none",
                        }}
                        className="w-full"
                      >
                        <Suspense fallback={iOSLoadingFallback}>
                          <ErrorBoundary>
                            <SubjectView
                              key={activeSubjectId}
                              subject={subjects.find((s) => s.id === activeSubjectId) || subjects[0]}
                              progress={progressDb}
                              dbLectures={dbLectures}
                              deepLinkedLecture={activeLecture}
                              onBack={handleBackSubject}
                              onSelectLecture={(lect, tab) => {
                                if (tab) setActiveLectureTab(tab);
                                else setActiveLectureTab("pdf");
                                setActiveLecture(lect);
                              }}
                              language={language}
                              calendarEvents={calendarEventsDb}
                            />
                          </ErrorBoundary>
                        </Suspense>
                      </div>

                      {activeLecture !== null && (
                        <motion.div
                          key="lecture-detail"
                          style={{
                            gridArea: "1 / 1 / 2 / 2",
                            zIndex: 10,
                            boxShadow: "0 20px 40px -15px rgba(0, 0, 0, 0.15), 0 15px 25px -10px rgba(0, 0, 0, 0.08)",
                            overflow: "hidden",
                            transform: `translate3d(${lectureSwipeX}px, 0, 0)`,
                            transition: isReleasingLecture
                              ? "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)"
                              : "none",
                            willChange: "transform, opacity",
                          }}
                          initial={{ opacity: 1 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 1 }}
                          transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
                          className="w-full bg-neutral-50 dark:bg-[#1C1C1E] shadow-[0_8px_32px_rgba(0,0,0,0.6)] rounded-xl"
                        >
                          <Suspense fallback={iOSLoadingFallback}>
                            <ErrorBoundary>
                              <LectureDetailView
                                lecture={activeLecture}
                                progress={activeLectureProgress}
                                onUpdateProgress={handleUpdateLectureProgress}
                                onAddPoints={handleAddPoints}
                                onBack={handleBackLecture}
                                currentUser={activeLectureUser}
                                language={language}
                                calendarEvents={calendarEventsDb}
                                initialTab={activeLectureTab}
                              />
                            </ErrorBoundary>
                          </Suspense>
                        </motion.div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Tab 3: Schedule (Calendar) */}
            <div
              style={{ display: activeTab === "calendar" ? "block" : "none" }}
              className="w-full"
            >
              <motion.div
                initial={false}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
                style={{ willChange: "transform, opacity" }}
                className="w-full"
              >
                <Suspense fallback={iOSLoadingFallback}>
<ErrorBoundary>
                  <CalendarView
                    isPhone={device.isPhone}
                    events={calendarEventsDb}
                    subjects={subjects}
                    onAddEvent={handleAddNewEvent}
                    onDeleteEvent={handleDeleteEvent}
                    onUpdateEvents={handleUpdateEvents}
                    language={language}
                  />
                </ErrorBoundary>
</Suspense>
              </motion.div>
            </div>

            {/* Tab 4: Profile */}
            <div
              style={{ display: activeTab === "profile" ? "block" : "none" }}
              className="w-full"
            >
              <motion.div
                initial={false}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
                style={{ willChange: "transform, opacity" }}
                className="w-full"
              >
                <Suspense fallback={iOSLoadingFallback}>
<ErrorBoundary>
                  <ProfileView
                    user={currentUser}
                    pointsLog={pointsLogDb}
                    subjects={subjects}
                    progress={progressDb}
                    dbLectures={dbLectures}
                    onUpdateProfile={handleUpdateProfile}
                    onSignOut={handleSignOut}
                    showSettingsButton={usePhoneLayout}
                    onOpenSettings={() => setActiveTab("settings")}
                  />
                </ErrorBoundary>
</Suspense>
              </motion.div>
            </div>

            {/* Tab 5: Settings */}
            <div
              style={{ display: activeTab === "settings" ? "block" : "none" }}
              className="w-full"
            >
              <motion.div
                initial={false}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
                style={{ willChange: "transform, opacity" }}
                className="w-full"
              >
                <Suspense fallback={iOSLoadingFallback}>
<ErrorBoundary>
                  <SettingsView
                    language={language}
                    onLanguageChange={setLanguage}
                    theme={theme}
                    onThemeChange={setTheme}
                    pushAlerts={preferences.pushAlerts}
                    onPushAlertsChange={(val) =>
                      updatePreference("pushAlerts", val)
                    }
                    onAccountDeleted={handleAccountSelfDelete}
                  />
                </ErrorBoundary>
</Suspense>
              </motion.div>
            </div>

            {/* Tab 6: Control Center (Admin only) */}
            {(currentUser?.isAdmin ||
              currentUser?.role === "admin" ||
              currentUser?.role === "owner") && (
              <div
                style={{
                  display: activeTab === "control-center" ? "block" : "none",
                }}
                className="w-full"
              >
                <motion.div
                  initial={false}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
                  style={{ willChange: "transform, opacity" }}
                  className="w-full"
                >
                  <Suspense fallback={iOSLoadingFallback}>
<ErrorBoundary>
                    <ControlCenterView
                      currentUser={currentUser}
                      progressDb={progressDb}
                      pointsLogDb={pointsLogDb}
                      calendarEventsDb={calendarEventsDb}
                      subjects={subjects}
                      onAddPoints={handleAddPoints}
                      onAddNewEvent={handleAddNewEvent}
                      onUpdateLectureProgress={handleUpdateLectureProgress}
                      onSync={syncWithBackend}
                      onForceLocalReset={handleForceLocalReset}
                      language={language}
                      onRefreshSubjects={async () => {
                        await Promise.all([
                          fetchMaterials(true),
                          fetchDbLectures(true),
                          fetchCalendarEvents(true),
                        ]);
                      }}
                      onDeleteEvent={handleDeleteEvent}
                      onEditEvent={handleEditEvent}
                      onRedirect={(tab) => setActiveTab(tab)}
                      isPhone={usePhoneLayout}
                    />
                  </ErrorBoundary>
</Suspense>
                </motion.div>
              </div>
            )}

            {/* Tab 7: Bulletin */}
            <div
              style={{ display: activeTab === "bulletin" ? "block" : "none" }}
              className="w-full"
            >
              <motion.div
                initial={false}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
                style={{ willChange: "transform, opacity" }}
                className="w-full"
              >
                <Suspense fallback={iOSLoadingFallback}>
<ErrorBoundary>
                  <BulletinCenter
                    notifications={notifications}
                    onMarkRead={handleMarkNotificationRead}
                    onMarkUnread={handleMarkNotificationUnread}
                    onMarkAllRead={handleMarkAllNotificationsRead}
                    onClearAll={handleClearAllNotifications}
                    onDeleteNotification={handleDeleteNotification}
                    language={language}
                    subjects={subjects}
                    onNavigateToLecture={(lect) => {
                      setActiveLecture(lect);
                      setActiveSubjectId(lect.subjectId as any);
                      setActiveTab("subjects");
                    }}
                    onNavigateToTab={(tab) => {
                      setActiveTab(tab);
                    }}
                  />
                </ErrorBoundary>
</Suspense>
              </motion.div>
            </div>

            {/* Tab 8: Privacy Policy */}
            <div
              style={{ display: activeTab === "privacy" ? "block" : "none" }}
              className="w-full h-full"
            >
              <Suspense fallback={iOSLoadingFallback}>
                <ErrorBoundary>
                  {activeTab === "privacy" && <PrivacyPolicyView onBack={() => setActiveTab("settings")} />}
                </ErrorBoundary>
              </Suspense>
            </div>

            {/* Tab 9: Terms of Service */}
            <div
              style={{ display: activeTab === "terms" ? "block" : "none" }}
              className="w-full h-full"
            >
              <Suspense fallback={iOSLoadingFallback}>
                <ErrorBoundary>
                  {activeTab === "terms" && <TermsOfServiceView onBack={() => setActiveTab("settings")} />}
                </ErrorBoundary>
              </Suspense>
            </div>

            {/* Tab 10: Support */}
            <div
              style={{ display: activeTab === "support" ? "block" : "none" }}
              className="w-full h-full"
            >
              <Suspense fallback={iOSLoadingFallback}>
                <ErrorBoundary>
                  {activeTab === "support" && <SupportView onBack={() => setActiveTab("settings")} />}
                </ErrorBoundary>
              </Suspense>
            </div>

            {/* Tab 11: Medical Disclaimer */}
            <div
              style={{ display: activeTab === "disclaimer" ? "block" : "none" }}
              className="w-full h-full"
            >
              <Suspense fallback={iOSLoadingFallback}>
                <ErrorBoundary>
                  {activeTab === "disclaimer" && <MedicalDisclaimerView onBack={() => setActiveTab("settings")} />}
                </ErrorBoundary>
              </Suspense>
            </div>

            
          </div>
        </main>

        {/* 3. iOS-Native Floating Glass Tab Bar */}
        <footer
          id="ios_native_tabbar_wrapper"
           className={`ios-floating-tabbar fixed z-50 select-none ${isCompactHeight ? "ios-floating-tabbar-compact" : ""} ${usePhoneLayout ? "block" : "hidden"}`}
        >
          <div
            id="ios_native_tabbar"
            className="liquid-glass-tabbar relative w-full px-2 transition duration-300"
            style={{
              height: isCompactHeight ? "49px" : "64px",
            }}
          >
            <div
              className={`grid ${currentUser?.isAdmin || currentUser?.role === "admin" || currentUser?.role === "owner" ? "grid-cols-5" : "grid-cols-4"} h-full text-center items-center relative z-0 max-w-md mx-auto`}
            >
              {bottomTabBarItems.map((item) => (
                <TabBarItem
                  key={item.id}
                  id={item.id}
                  icon={item.icon}
                  label={item.label}
                  isActive={activeTab === item.id}
                  isCompactHeight={isCompactHeight}
                  activeColorClass={item.activeColorClass}
                  onClick={handleSidebarTabClick}
                />
              ))}
            </div>
          </div>
        </footer>
      </div>{" "}
      {/* Closing Main Content Workspace wrapper */}
      {/* Global iOS High-Fidelity Alert Overlay */}
      <IOSAlert />

      {/* Full-page Calendar Event Editor — slides in over the current view */}
      <>
        {editingCalendarEvent && (
          <motion.div
            key="edit-calendar-event"
            initial={{ opacity: 0, y: "100%" }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            className="fixed inset-0 z-[200] overflow-y-auto"
            style={{ willChange: "transform, opacity" }}
          >
            <Suspense fallback={<div className="min-h-screen bg-neutral-50 dark:bg-[#111113] flex items-center justify-center"><div className="w-6 h-6 rounded-full border-2 border-rose-500 border-t-transparent animate-spin" /></div>}>
              <ErrorBoundary>
                <EditCalendarEvent
                  event={editingCalendarEvent}
                  language={language}
                  onSave={handleEditEventSave}
                  onBack={() => setEditingCalendarEvent(null)}
                />
              </ErrorBoundary>
            </Suspense>
          </motion.div>
        )}
      </>
    </div>
  );
}
