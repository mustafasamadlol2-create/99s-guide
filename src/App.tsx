import { ErrorBoundary } from "./components/ErrorBoundary";
import { safeJsonParse } from "./core/utils/safeJson";
import { SecureStorage } from "./core/utils/secureStorage";
import { getLectureProgressStats } from "./core/utils/progressUtils";
import { HapticFeedback } from "./core/device/haptic";
import { apiClient } from "./core/api/apiClient";
import { getApiBaseUrl } from "./core/api/api";
import { getSubjectIconInfo } from "./core/utils/subjectIcons";
import { formatToBaghdadISO, dayjs } from "./core/utils/timezone";
import AppLogo from "./components/ui/AppLogo";
import { CommandPalette, SearchResultItem } from "./components/ui/CommandPalette";
import IOSAlert from "./core/layout/iOSAlert";
import { showiOSAlert } from "./core/device/alert";
import { Language } from "./core/i18n/translations";
import { SwipeableSubjectButton } from "./features/subjects/components/SwipeableSubjectButton";
import { OfflineEngine } from "./core/offline/OfflineEngine";
import { IDBManager } from "./core/utils/indexedDB";
import { DataSyncManager } from "./core/offline/DataSyncManager";
import { CacheManager, CACHE_TTL } from "./core/cache/CacheManager";
import { pdfCache } from "./core/cache/pdfCache";
import { useDeviceProfile } from "./core/hooks/useDeviceProfile";
import { useUserPreferences } from "./core/hooks/useUserPreferences";
import { useIsTouchDevice } from "./core/hooks/useIsTouchDevice";
import { NativeBridge } from "./core/device/capacitor/nativeBridge";
import {
  Home,
  BookOpen,
  Calendar as CalIcon,
  User as UserIcon,
  Bell,
  ChevronRight,
  ChevronLeft,
  LogOut,
  Settings,
  Database,
  X,
  CircleCheck,
  TrendingUp,
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
import {
  User,
  Subject,
  Lecture,
  UserProgress,
  PointsLog,
  CalendarEvent,
  SubjectId,
} from "./core/types";
import { subjects as seedSubjects, initialCalendarEvents } from "./core/constants/seedData";
import { DashboardSkeleton } from "./components/ui/Skeleton";

// Custom Apple-quality Lazy Preloading utility for sub-second, stutter-free visual navigations
const lazyWithPreload = <T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) => {
  const LazyComponent = lazy(factory) as any;
  LazyComponent.preload = () => {
    return factory().catch((err) => {
      
    });
  };
  return LazyComponent as React.LazyExoticComponent<T> & {
    preload: () => Promise<any>;
  };
};

// Code Splitting using Dynamic Imports & Suspense Boundaries (Apple-Quality Performance)
const AuthScreen = lazyWithPreload(() => import("./features/auth/components/AuthScreen"));
const ResetPasswordScreen = lazyWithPreload(
  () => import("./features/auth/components/ResetPasswordScreen"),
);
const HomeDashboard = lazyWithPreload(
  () => import("./features/home/components/HomeDashboard"),
);
const SubjectView = lazyWithPreload(() => import("./features/subjects/components/SubjectView"));
const LectureDetailView = lazyWithPreload(
  () => import("./features/lectures/components/LectureDetailView"),
);
const CalendarView = lazyWithPreload(() => import("./features/calendar/components/CalendarView"));
const ProfileView = lazyWithPreload(() => import("./features/profile/components/ProfileView"));
const ControlCenterView = lazyWithPreload(
  () => import("./features/admin/components/ControlCenterView"),
);
const SettingsView = lazyWithPreload(() => import("./features/settings/components/SettingsView"));
const PrivacyPolicyView = lazyWithPreload(() => import("./features/legal/components/PrivacyPolicyView"));
const TermsOfServiceView = lazyWithPreload(() => import("./features/legal/components/TermsOfServiceView"));
const SupportView = lazyWithPreload(() => import("./features/legal/components/SupportView"));
const MedicalDisclaimerView = lazyWithPreload(() => import("./features/legal/components/MedicalDisclaimerView"));
const BulletinCenter = lazyWithPreload(
  () => import("./features/bulletin/components/BulletinCenter"),
);
const EditCalendarEvent = lazyWithPreload(
  () => import("./features/calendar/components/EditCalendarEvent"),
);

export interface AppNotification {
  id: string;
  title: string;
  titleAr: string;
  desc: string;
  descAr: string;
  date: string;        // send/creation timestamp (used for sorting & "X ago" display)
  eventDate?: string;  // YYYY-MM-DD of the actual scheduled event — used in subtitle
  read: boolean;
  pinned?: boolean;
  type:
    | "lecture"
    | "event"
    | "quiz"
    | "quiz"
    | "exam"
    | "achievement"
    | "discussion"
    | "system" | "holiday"
    | "announcement";
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

export default function App() {
  const device = useDeviceProfile();
  const isTouchDevice = useIsTouchDevice();
  const shouldReduceMotion = useReducedMotion();

  // --- Core Session States ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
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
      setCurrentUser(null);
      setBannedInfo({
        reason: detail.reason ?? null,
        isPermanent: detail.isPermanent ?? true,
        endTime: detail.endTime ?? null,
      });
    };
    window.addEventListener("user-account-banned", handleBanEvent);
    return () => window.removeEventListener("user-account-banned", handleBanEvent);
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
  const [activeTab, setActiveTab] = useState<string>("home"); // home | subjects | calendar | pomodoro | profile | settings

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [activeToast, setActiveToast] = useState<{
    id: string;
    title: string;
    desc: string;
  } | null>(null);
  const [isProfileDropdownOpen, setProfileDropdownOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    // Removed redundant non-passive touchmove listener since CSS touch-action: pan-y handles it

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

  useEffect(() => {
    // Initialize edge-to-edge / full-screen native UI first — must run before
    // any status-bar style calls so the overlay flag is set on Android.
    NativeBridge.initializeFullScreen();

    const unbindNetwork = NativeBridge.onNetworkChange((online) => {
      setIsOnline(online);
      if (online) {
        // Re-sync or refresh cache when coming back online
        
      }
    });

    const unbindLifecycle = NativeBridge.addAppLifecycleListener((active) => {
      setIsActive(active);
    });

    const unbindKeyboard = NativeBridge.listenToKeyboard((state) => {
      setKeyboardState(state);
    });

    return () => {
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
      query: { userId: currentUser.id },
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    socket.on("connect_error", (err) => {
      
    });

    socket.on("error", (err) => {
      
    });

    socket.on("connect", () => {
      

      // Clean avatar strings (strip base64 data to avoid Websocket packet limits)
      const cleanAvatar =
        currentUser.avatar && currentUser.avatar.startsWith("data:")
          ? "base64-stored-db"
          : currentUser.avatar;
      const cleanAvatarUrl =
        currentUser.avatar && currentUser.avatar.startsWith("data:")
          ? "base64-stored-db"
          : currentUser.avatar || currentUser.avatar;

      // Automatically emit the user's data to the registerUser event
      socket.emit("registerUser", {
        id: currentUser.id,
        email: currentUser.email,
        name: currentUser.name,
        role: currentUser.role,
        avatar: cleanAvatar,
        avatarUrl: cleanAvatarUrl,
        totalPoints: currentUser.totalPoints,
        level: currentUser.level,
        levelBadge: currentUser.levelBadge,
        streakDays: currentUser.streakDays,
        totalTimeSpent: currentUser.totalTimeSpent,
      });
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

    // Instant calendar synchronization: re-fetch from server whenever any client mutates events
    socket.on("calendar_updated", () => {
      fetchCalendarEvents(true).catch(() => {});
      window.dispatchEvent(new CustomEvent("socket-calendar-updated"));
    });

    // Real-time mute status — update permissions instantly without refresh
    socket.on("userMuteUpdate", (data: { userId: string; isMuted: boolean; isPermanent: boolean; endTime: string | null; reason: string | null }) => {
      if (data.userId !== currentUser?.id) return;
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
      if (data.userId !== currentUser?.id) return;
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
    socket.on("userBanRemoved", (data: { userId: string }) => {
      if (data.userId !== currentUser?.id) return;
      window.dispatchEvent(new CustomEvent("socket-user-ban-removed", { detail: data }));
    });

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
      window.dispatchEvent(new CustomEvent("socket-materials-updated"));
    });
    socket.on("roster_updated", () => {
      window.dispatchEvent(new CustomEvent("socket-roster-updated"));
    });
    socket.on("motto_updated", () => {
      window.dispatchEvent(new CustomEvent("socket-motto-updated"));
    });

    // ── Real-time profile sync: update currentUser instantly when profile changes ──
    socket.on("userUpdated", (updatedUser: any) => {
      if (updatedUser?.id === currentUser?.id) {
        setCurrentUser((prev) => prev ? { ...prev, ...updatedUser } : prev);
      }
      // Dispatch so admin roster/console views refresh without a page reload
      window.dispatchEvent(new CustomEvent("socket-user-updated", { detail: updatedUser }));
    });

    socket.on("receiveSystemNotification", (newNotification: any) => {
      // Group filter: if the notification targets a specific group, ignore it
      // for users who are not in that group. Global notifications (no targetGroup)
      // are always shown. This is a defence-in-depth check — the backend already
      // scopes the socket.io room broadcast, but REST-fetched history also carries
      // the field so both paths are consistent.
      const notifGroup: string | undefined = newNotification.targetGroup;
      if (notifGroup && notifGroup !== currentUser?.studentGroup) {
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
      (window as any).socket = null;
      socket.disconnect();
    };
  }, [currentUser?.id, isActive]);

  // Notifications state

  const [notifications, setNotifications] = useState<AppNotification[]>(() => {
    try {
      const saved = localStorage.getItem("app_notifications_v1");
      if (saved) return safeJsonParse(saved, null);
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
      // Intentionally disable the connection error toast to prevent spamming
      // the user with network connectivity issues.
      /*
 const customEvent = event as CustomEvent<string>;
 setActiveToast({
 id: Date.now().toString(),
 title: language === "ar" ? "فشل الاتصال" : "Connection Error",
 desc:
 customEvent.detail ||
 (language === "ar"
 ? "حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى."
 : "An unexpected error occurred. Please try again."),
 });
 */
    };

    window.addEventListener("app-api-error", handleApiError);
    return () => window.removeEventListener("app-api-error", handleApiError);
  }, [language]);

  // Gracefully handle expired sessions with state cleanups and high-fidelity iOS alerts
  useEffect(() => {
    const handleSessionExpired = () => {
      SecureStorage.remove("auth_token");
      SecureStorage.remove("logged_user");

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
              SecureStorage.set("auth_token", data.token);
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
  const [dbLectures, setDbLectures] = useState<any[]>([]);

  // Performance Optimization: Memoize subject lecture counts in O(N + M) time
  const subjectLectureCounts = useMemo(() => {
    const dbCountsBySubject: Record<string, number> = {};
    if (dbLectures) {
      for (let i = 0; i < dbLectures.length; i++) {
        const subj = dbLectures[i].mainSubject;
        dbCountsBySubject[subj] = (dbCountsBySubject[subj] || 0) + 1;
      }
    }

    return subjects.reduce(
      (acc, subItem) => {
        const seededCount = subItem.modules.reduce(
          (sum, m) => sum + m.lectures.length,
          0,
        );
        acc[subItem.id] = seededCount + (dbCountsBySubject[subItem.id] || 0);
        return acc;
      },
      {} as Record<string, number>,
    );
  }, [subjects, dbLectures]);

  const totalLectureCount = useMemo(() => {
    return Object.values(subjectLectureCounts).reduce((a: number, b: number) => a + b, 0);
  }, [subjectLectureCounts]);

  const globalSearchData = useMemo(() => {
    const results: any[] = [];

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
        setActiveLecture(null);
      } else if (activeSubjectId !== null) {
        setActiveSubjectId(null);
      }
    },
    isEnabled: activeLecture !== null || activeSubjectId !== null,
    onSwipeMove: (dx) => {
      if (activeLecture !== null) {
        setLectureSwipeX(dx);
      } else if (activeSubjectId !== null) {
        setSubjectSwipeX(dx);
      }
    },
    onSwipeEnd: (success) => {
      if (!success) {
        if (activeLecture !== null) {
          setIsReleasingLecture(true);
          setLectureSwipeX(0);
          setTimeout(() => setIsReleasingLecture(false), 300);
        } else if (activeSubjectId !== null) {
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
    setActiveSubjectId(null);
  }, []);

  const handleBackLecture = useCallback(() => {
    setActiveLecture(null);
  }, []);

  const handleBackHomeLecture = useCallback(() => {
    setActiveHomeLecture(null);
    if (lectureDetailSource === "dashboard") {
      setActiveHomeSubjectId(null);
    }
  }, [lectureDetailSource]);

  const handleSelectNestedLecture = useCallback((lect: Lecture, tab?: "pdf" | "notes" | "mcqs" | "flashcards" | "videos" | "qa") => { setLectureDetailSource("subject"); if (tab) setActiveLectureTab(tab); else setActiveLectureTab("pdf"); setActiveHomeLecture(lect); }, []);

  // --- Deep-Linking, State Restoration & Universal Linking Sync Engine ---
  const targetHomeLectureIdRef = useRef<string | null>(null);
  const targetLectureIdRef = useRef<string | null>(null);

  const handleSidebarTabClick = useCallback((id: string) => {
    if (id === "search") {
      setIsCommandPaletteOpen(true);
      return;
    }
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
          setActiveSubjectId(null);
          setActiveLecture(null);
        }
        return "subjects";
      }
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

  // Performance Optimization: Global Subject Progress Metrics
  const dbLecturesBySubject = useMemo(() => {
    const map = new Map<string, any[]>();
    if (dbLectures) {
      for (let i = 0; i < dbLectures.length; i++) {
        const l = dbLectures[i];
        let arr = map.get(l.mainSubject);
        if (!arr) {
          arr = [];
          map.set(l.mainSubject, arr);
        }
        arr.push(l);
      }
    }
    return map;
  }, [dbLectures]);

  const subjectProgressMetrics = useMemo(() => {
    const metrics = new Map<string, { totalTasks: number, completedTasks: number, progressPercentage: number }>();
    const progressMap = new Map();
    for (let i = 0; i < progressDb.length; i++) {
      progressMap.set(progressDb[i].lectureId, progressDb[i]);
    }

    for (let i = 0; i < subjects.length; i++) {
      const subject = subjects[i];
      let subjectLectures: any[] = [];
      for (let j = 0; j < subject.modules.length; j++) {
        subjectLectures = subjectLectures.concat(subject.modules[j].lectures);
      }
      const subjectDbLecs = dbLecturesBySubject.get(subject.id) || [];
      const totalTasks = (subjectLectures.length + subjectDbLecs.length) * 5;
      
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
      for (let j = 0; j < subjectDbLecs.length; j++) countTasks(subjectDbLecs[j]);

      const progressPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
      metrics.set(subject.id, { totalTasks, completedTasks, progressPercentage });
    }
    return metrics;
  }, [subjects, dbLecturesBySubject, progressDb]);

  // Try to resolve target deep link IDs once subjects or dbLectures update
  useEffect(() => {
    if (subjects.length > 0) {
      if (targetHomeLectureIdRef.current) {
        let found: Lecture | null = null;
        // Search in dbLectures
        if (dbLectures.length > 0) {
          found = dbLectures.find(
            (l) => l.id === targetHomeLectureIdRef.current,
          );
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
          found = dbLectures.find((l) => l.id === targetLectureIdRef.current);
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
          setActiveLecture(found);
          setActiveSubjectId(found.subjectId);
          targetLectureIdRef.current = null;
        }
      }
    }
  }, [subjects, dbLectures]);

  // --- Tab-Level Scroll Memory Controller with Session Storage Restoration (Apple Human Interface Guidelines) ---
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

  const prevNavigationPathRef = useRef<string>(getNavigationPath());

  // Handle capturing scroll top values on scroll and storing them securely in sessionStorage
  useEffect(() => {
    const canvas = document.getElementById("main-scroll-canvas");
    if (!canvas) return;

    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const currentPath = prevNavigationPathRef.current;
          const scrollTop = canvas.scrollTop;
          try {
            sessionStorage.setItem(
              `scroll_pos_${currentPath}`,
              scrollTop.toString(),
            );
          } catch (e) {
            // Ignore
          }
          ticking = false;
        });
        ticking = true;
      }
    };

    // canvas.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      // canvas.removeEventListener("scroll", handleScroll);
    };
       
  }, []);

  const fetchMaterials = async (bypassCache = false) => {
    // Stale-while-revalidate: render from cache instantly, then update with fresh data
    if (!bypassCache) {
      const cached = await CacheManager.get<any[]>("materials", CACHE_TTL.MATERIALS);
      if (cached) setSubjects(cached);
    }
    try {
      const response = await apiClient("/api/materials", { bypassCache });
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

  useEffect(() => {
    if (currentUser && isActive) {
      fetchMaterials(true);
      fetchDbLectures(true);
      fetchCalendarEvents(true);

      // Seed and synchronize local IndexedDB database stores
      DataSyncManager.fetchAndStoreAcademicMaterials().catch(() => {});
      DataSyncManager.triggerBackgroundSync().catch(() => {});
    }
  }, [currentUser, isActive]);

  // Window focus revalidation and background polling to keep data perfectly synchronized
  useEffect(() => {
    const fetchLatestData = () => {
      if (currentUser && isActive) {
        fetchMaterials(true);
        fetchDbLectures(true);
        fetchCalendarEvents(true);
      }
    };
    
    // 1. Revalidate on window focus
    window.addEventListener('focus', fetchLatestData);
    
    // 2. Intelligent, adaptive background synchronization
    let syncTimer = null;
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
      });
      if (response.ok) {
        const data = await response.json();
        if (data.user) {
          setCurrentUser(data.user);
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
  useEffect(() => {
    let localProgress: UserProgress[] = [];
    let localLogs: PointsLog[] = [];
    let localEvents: CalendarEvent[] = [];

    // Set up standard placeholders if no cache in localStorage
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

    // Attempt secure automatic session restoration from httpOnly cookie JWT
    const restoreSession = async () => {
      try {
        const response = await apiClient("/api/auth/me");
        if (response.ok) {
          const data = await response.json();
          if (data.user) {
            setCurrentUser(data.user);
            setProgressDb(data.progress || localProgress);
            setPointsLogDb(data.pointsLogs || localLogs);
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
            return;
          }
        }
      } catch (err: any) {
        
        if (err && err.status === 401) {
          SecureStorage.remove("logged_user");
          setProgressDb(localProgress);
          setPointsLogDb(localLogs);
          setCalendarEventsDb(localEvents);
          return;
        }
        // Banned user — show suspension screen; do NOT fall through to local cache
        if (err && err.status === 403 && err.body?.banned) {
          SecureStorage.remove("auth_token");
          SecureStorage.remove("logged_user");
          setBannedInfo({
            reason: err.body.reason ?? null,
            isPermanent: err.body.isPermanent ?? true,
            endTime: err.body.endTime ?? null,
          });
          return;
        }
      }

      // Local fallback checking if server is offline or not configured
      const cachedUser = await SecureStorage.get("logged_user");
      if (cachedUser) {
        try {
          const parsed = safeJsonParse(cachedUser, null);
          if (parsed.avatar && parsed.avatar.includes("unsplash.com")) { parsed.avatar = ""; SecureStorage.set("logged_user", JSON.stringify(parsed)); }
          setCurrentUser(parsed);
          setProgressDb(localProgress);
          setPointsLogDb(localLogs);
          setCalendarEventsDb(localEvents);
          // Sync with server as fallback background attempt
          syncWithBackend(parsed, localProgress, localLogs, localEvents);
        } catch (e) {
          
        }
      } else {
        // Safe defaults if completely unauthenticated
        setProgressDb(localProgress);
        setPointsLogDb(localLogs);
        setCalendarEventsDb(localEvents);
      }
    };

    restoreSession().finally(() => {
      setIsInitializing(false);
    });
       
  }, []);

  // --- Listen to OAuth Popup success messages ---
  useEffect(() => {
    const handleOAuthSuccess = async (event: MessageEvent) => {
      const origin = event.origin;
      // Allow relative origin or current window domain
      if (
        origin &&
        !origin.endsWith(".run.app") &&
        !origin.includes("localhost") &&
        origin !== window.location.origin
      ) {
        return;
      }

      if (event.data?.type === "OAUTH_AUTH_SUCCESS") {
        setIsInitializing(true);
        if (event.data.token) {
          SecureStorage.set("auth_token", event.data.token);
        }
        try {
          // Fetch `/api/auth/me` to retrieve the fully updated session
          const response = await apiClient("/api/auth/me");
          if (response.ok) {
            const data = await response.json();
            if (data.user) {
              setCurrentUser(data.user);
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
            }
          }
        } catch (err) {
          
        } finally {
          setIsInitializing(false);
        }
      }
    };

    window.addEventListener("message", handleOAuthSuccess);
    return () => window.removeEventListener("message", handleOAuthSuccess);
       
  }, []);

  // --- Capacitor & Apple HIG Integrations ---

  // 1. Splash Screen Concealer + launch screen signal
  useEffect(() => {
    if (!isInitializing) {
      NativeBridge.hideSplashScreen().catch(() => {});
      // Signal the web launch screen to begin its exit transition.
      // hasSidebar = desktop layout with persistent sidebar visible.
      const hasSidebar =
        device.horizontalSizeClass !== "compact" && !!currentUser;
      document.dispatchEvent(
        new CustomEvent("app-ready", { detail: { hasSidebar } }),
      );
    }
  }, [isInitializing]);  

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

        // Warm up the memory cache with dynamic academic datasets immediately following component preloads
        if (currentUser) {
          const apisToPrefetch = [
            "/api/materials",
            "/api/lectures",
            "/api/calendar/events",
            "/api/notifications",
            "/api/users",
          ];
          apisToPrefetch.forEach((api, index) => {
            setTimeout(
              () => {
                apiClient(api, { silent: true }).catch(() => {});
              },
              routesToPreload.length * 200 + index * 150,
            );
          });
        }
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
          const isLibrary =
            title.includes("Library") ||
            title.includes("المكتبة") ||
            text.includes("Library") ||
            text.includes("المكتبة");
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

          if (isLibrary) {
            SubjectView.preload?.();
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

  // 4. Adapt to Native Virtual Keyboard height transitions
  useEffect(() => {
    const unsubscribe = NativeBridge.listenToKeyboard((state) => {
      setKeyboardState(state);
    });
    return unsubscribe;
       
  }, []);

  // 5. Track foreground execution resuming to sync database
  useEffect(() => {
    const unsubscribe = NativeBridge.addAppLifecycleListener((isActive) => {
      
      if (isActive) {
        fetchMaterials().catch(() => {});
        fetchDbLectures().catch(() => {});
      }
    });
    return unsubscribe;
       
  }, []);

  // 5b. Handle hardware back button for true native mobile navigation
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
            setActiveLecture(foundLec);
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
  ) => {
    const endpoint = isNewUser ? "/api/auth/register" : "/api/auth/login";
    const res = await apiClient(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: authorEmail,
        name: authorName,
        password: authorPassword,
        studentGroup,
      }),
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

    if (!data?.user || typeof data.user !== "object" || !data.user.id) {
      throw new Error("Authentication succeeded, but the session response was incomplete. Please try again.");
    }

    setCurrentUser(data.user);
    setProgressDb(data.progress || []);
    setPointsLogDb(data.pointsLogs || []);
    setCalendarEventsDb(data.calendarEvents || []);

    if (data.token) {
      SecureStorage.set("auth_token", data.token);
    }
    SecureStorage.set("logged_user", JSON.stringify(data.user));
    localStorage.setItem("progress_db", JSON.stringify(data.progress || []));
    localStorage.setItem("points_log", JSON.stringify(data.pointsLogs || []));
    localStorage.setItem("calendar_events", JSON.stringify(data.calendarEvents || []));
  };

  // Profile updaters
  const handleUpdateProfile = useCallback(
    async (newName: string, newEmail: string, newAvatar: string, newGroup?: string) => {
      if (!currentUser) return;
      const updatedUser = {
        ...currentUser,
        name: newName,
        email: newEmail,
        avatar: newAvatar,
        studentGroup: newGroup || currentUser.studentGroup || "A",
      };
      setCurrentUser(updatedUser);
      SecureStorage.set("logged_user", JSON.stringify(updatedUser));

      try {
        const res = await apiClient("/api/auth/update-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: currentUser.id,
            name: newName,
            email: newEmail,
            avatar: newAvatar,
            studentGroup: newGroup,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.user) {
            setCurrentUser(data.user);
            SecureStorage.set("logged_user", JSON.stringify(data.user));
          }
        } else {
          throw new Error("HTTP update profile failure: " + res.status);
        }
      } catch (e) {
        
        OfflineEngine.addToQueue({
          type: "UPDATE_PROFILE",
          payload: {
            userId: currentUser.id,
            name: newName,
            email: newEmail,
            avatar: newAvatar,
            studentGroup: newGroup,
          },
        });
      }
    },
    [currentUser],
  );

  const handleSignOut = useCallback(async () => {
    try {
      await apiClient("/api/auth/logout", { method: "POST" });
    } catch (err) {
      
    }
    SecureStorage.remove("auth_token");
    SecureStorage.remove("logged_user");
    // Clear all user-associated offline caches so no PII persists post-logout
    localStorage.removeItem("progress_db");
    localStorage.removeItem("points_log");
    localStorage.removeItem("calendar_events");
    localStorage.removeItem("subjects_catalog_cache");
    localStorage.removeItem("detailed_lectures_cache");
    localStorage.removeItem("offline_mutations_queue");
    localStorage.removeItem("offline_dlq");
    localStorage.removeItem("app_notifications_v1");
    // Clear IndexedDB caches (Apple Guideline 5.1.1(v) — no user data persists post-logout)
    IDBManager.removeItem("subjects_cache").catch(() => {});
    IDBManager.removeItem("db_lectures_list_cache").catch(() => {});
    pdfCache.clearAll().catch(() => {});
    indexedDB.deleteDatabase("BaghdadMedicalOfflineDB_v2");
    setCurrentUser(null);
    setProfileDropdownOpen(false);
       
  }, []);

  const handleForceLocalReset = useCallback(async () => {
    try {
      await apiClient("/api/auth/logout", { method: "POST" });
    } catch (err) {
      
    }
    SecureStorage.remove("auth_token");
    SecureStorage.remove("logged_user");
    localStorage.removeItem("progress_db");
    localStorage.removeItem("points_log");
    localStorage.removeItem("calendar_events");
    localStorage.removeItem("subjects_catalog_cache");
    localStorage.removeItem("detailed_lectures_cache");
    localStorage.removeItem("offline_mutations_queue");
    localStorage.removeItem("offline_dlq");
    localStorage.removeItem("app_notifications_v1");
    IDBManager.removeItem("subjects_cache").catch(() => {});
    IDBManager.removeItem("db_lectures_list_cache").catch(() => {});
    pdfCache.clearAll().catch(() => {});
    indexedDB.deleteDatabase("BaghdadMedicalOfflineDB_v2");
    setCurrentUser(null);
    setProfileDropdownOpen(false);
       
  }, []);

  const handleAccountSelfDelete = useCallback(async () => {
    try {
      const response = await apiClient("/api/auth/self-delete", {
        method: "POST",
      });
      if (response.ok) {
        SecureStorage.remove("auth_token");
        SecureStorage.remove("logged_user");
        localStorage.removeItem("progress_db");
        localStorage.removeItem("points_log");
        localStorage.removeItem("calendar_events");
        localStorage.removeItem("subjects_catalog_cache");
        localStorage.removeItem("detailed_lectures_cache");
        localStorage.removeItem("offline_mutations_queue");
        localStorage.removeItem("offline_dlq");
        localStorage.removeItem("app_notifications_v1");
        IDBManager.removeItem("subjects_cache").catch(() => {});
        IDBManager.removeItem("db_lectures_list_cache").catch(() => {});
        pdfCache.clearAll().catch(() => {});
        indexedDB.deleteDatabase("BaghdadMedicalOfflineDB_v2");
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

  const handleSearchSelect = useCallback((result: any) => {
    setIsCommandPaletteOpen(false);
    if (result.type === "subject") {
      setActiveSubjectId(result.subjectId as any);
      setActiveTab("subjects");
    } else if (result.type === "setting") {
      setActiveTab("settings");
    } else {
      setActiveTab("subjects");
      setActiveSubjectId(result.subjectId as any);

      // Determine the initial tab
      let tabToOpen: "pdf" | "notes" | "mcqs" | "flashcards" | "videos" | "qa" =
        "pdf";
      if (result.type === "notes") tabToOpen = "notes";
      if (result.type === "video") tabToOpen = "videos";
      if (result.type === "mcq") tabToOpen = "mcqs";
      if (result.type === "flashcard") tabToOpen = "flashcards";

      // Find the correct Lecture object
      let foundLec: any = null;
      if (result.type === "lecture" && result.raw && result.raw.title) {
        foundLec = result.raw;
      } else if (result.lectureId) {
        // Look in globalSearchData first (seeded lectures)
        const seeded = globalSearchData.find(
          (d) => d.lectureId === result.lectureId && d.type === "lecture",
        );
        if (seeded) {
          foundLec = seeded.raw;
        } else {
          // Look in dbLectures
          const dbL = dbLectures?.find((l: any) => l.id === result.lectureId);
          if (dbL) {
            const fromGlobal = globalSearchData.find(
              (d) => d.lectureId === result.lectureId && d.type === "lecture",
            );
            if (fromGlobal) {
              foundLec = fromGlobal.raw;
            }
          }
        }
      }

      if (!foundLec) {
        foundLec = result.raw;
      }

      setTimeout(() => {
        setActiveLectureTab(tabToOpen);
        setActiveLecture(foundLec);
      }, 150);
    }
  }, [globalSearchData, dbLectures]);

  const globalProgressStats = useMemo(() => {
    return getLectureProgressStats(dbLectures, progressDb);
  }, [dbLectures, progressDb]);

  const sidebarMainItems = useMemo(
    () => [
      {
        id: "home",
        icon: Home,
        label: language === "ar" ? "الرئيسية" : "Welcome",
      },
      {
        id: "subjects",
        icon: BookOpen,
        label: language === "ar" ? "المكتبة" : "Library",
      },
      {
        id: "calendar",
        icon: CalIcon,
        label: language === "ar" ? "الجدول" : "Schedule",
      },
      ...(currentUser?.isAdmin ||
      currentUser?.role === "admin" ||
      currentUser?.role === "owner" ||
      currentUser?.email === "mostafa.samad24001@comed.uobaghdad.edu.iq"
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
        icon: BookOpen,
        label: language === "ar" ? "المكتبة" : "Library",
      },
      {
        id: "calendar",
        icon: CalIcon,
        label: language === "ar" ? "الجدول" : "Schedule",
      },
      ...(currentUser?.isAdmin ||
      currentUser?.role === "admin" ||
      currentUser?.role === "owner" ||
      currentUser?.email === "mostafa.samad24001@comed.uobaghdad.edu.iq"
        ? [
            {
              id: "control-center",
              icon: Database,
              label: language === "ar" ? "التحكم" : "Console",
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

  // --- Auth screen validation guard ---
  if (isInitializing) {
    return (
      <div className="min-h-[100svh] bg-[#F8F9FC] dark:bg-[#000000] text-[#1E2D4A] dark:text-white">
        <div className="max-w-4xl mx-auto pt-16 px-4">
          <div className="flex flex-col items-center gap-2 mb-8">
            <h1 className="text-title font-display font-medium text-neutral-800 dark:text-white uppercase flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-med-gold animate-pulse" />
              Restoring Medical Database...
            </h1>
            <p className="text-caption font-mono text-neutral-500 dark:text-[#EBEBF599]">
              ESTABLISHING LOCAL SYNERGY & OFFLINE PRE-CACHES
            </p>
          </div>
          <DashboardSkeleton />
        </div>
      </div>
    );
  }

  // Intercept password reset path
  const isResetPasswordPath =
    window.location.pathname === "/reset-password" ||
    window.location.search.includes("token=");
  if (isResetPasswordPath) {
    return (
      <Suspense
        fallback={
          <div className="h-[100svh] w-full flex flex-col flex items-center justify-center bg-[#F8F9FC] dark:bg-[#000000]">
            <DashboardSkeleton />
          </div>
        }
      >
        <ResetPasswordScreen />
      </Suspense>
    );
  }

  if (bannedInfo) {
    return (
      <Suspense fallback={
        <div className="min-h-[100svh] w-full bg-[#0a0a0b] flex items-center justify-center">
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
        className="h-[100svh] w-full flex flex-col bg-[#F8F9FC] dark:bg-[#000000] selection:bg-med-gold/20 relative"
      >
        <Suspense
          fallback={
            <div className="h-[100svh] w-full flex flex-col flex items-center justify-center bg-[#F8F9FC] dark:bg-[#000000]">
              <DashboardSkeleton />
            </div>
          }
        >
          <AuthScreen
            onLoginSuccess={(u) =>
              handleAuthSuccess(u.name, u.email, u.password, u.studentGroup, u.isNewUser)
            }
          />
        </Suspense>
      </div>
    );
  }

  // Size Class checks instead of specific device models
  const isCompactWidth = device.horizontalSizeClass === "compact";
  const isRegularWidth = device.horizontalSizeClass === "regular";
  const isCompactHeight = device.verticalSizeClass === "compact";

  const isAsideCollapsed = isSidebarCollapsed;
  return (
    <div
      className={`h-[100svh] max-h-[100svh] w-full max-w-full bg-neutral-50 dark:bg-[#000000] text-[#1C1C1E] dark:text-white font-sans flex flex-col ${isCompactWidth ? "" : "flex-row"} justify-between selection:bg-med-blue/20 relative overflow-hidden`}
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
        className={`${isCompactWidth ? "hidden" : "flex"} shrink-0 flex-col bg-[#F7F7F8] dark:bg-[#1C1C1E] border-r border-black/[0.05] dark:border-white/[0.08] h-[100svh] max-h-[100svh] select-none z-30 justify-between overflow-hidden relative transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]`}
        style={{
          width: isAsideCollapsed ? "78px" : "264px",
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
          <motion.div
            className="flex pt-2 pb-5"
            animate={isAsideCollapsed
              ? { flexDirection: "column", alignItems: "center", gap: "10px", paddingLeft: 0, paddingRight: 0 }
              : { flexDirection: "row", alignItems: "center", gap: "10px", paddingLeft: "6px", paddingRight: "6px" }
            }
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* id used by LaunchScreen for FLIP shared-element transition */}
            <div id="sidebar-app-logo" style={{ display: "inline-flex", flexShrink: 0 }}>
              <AppLogo size="sm" iconOnly circle />
            </div>

            {/* Brand text — fades + collapses horizontally when sidebar shrinks */}
            <motion.div
              className="flex flex-col justify-center min-w-0"
              animate={isAsideCollapsed
                ? { opacity: 0, width: 0, flexGrow: 0 }
                : { opacity: 1, width: "auto", flexGrow: 1 }
              }
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              style={{ overflow: "hidden" }}
            >
              <h2 className="text-[13.5px] font-semibold text-neutral-900 dark:text-white leading-none tracking-[-0.3px] truncate antialiased">
                {"99's Guide"}
              </h2>
              <p className="text-[11px] text-neutral-400 dark:text-[#EBEBF560] font-medium leading-none tracking-[0.01em] truncate antialiased mt-[6px]">
                {language === "ar"
                  ? "مساحة العمل الأكاديمية"
                  : "Academic Workspace"}
              </p>
            </motion.div>

            {/* Collapse / expand toggle — always visible, rotates chevron */}
            <motion.button
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
                "hover:text-neutral-700 dark:hover:text-neutral-200",
                "hover:bg-black/[0.06] dark:hover:bg-white/[0.08]",
                "focus-visible:ring-2 focus-visible:ring-med-blue focus-visible:ring-offset-2",
                "dark:focus-visible:ring-offset-neutral-950",
                "transition-colors duration-200 ease-out",
                device.isTablet ? "w-9 h-9" : "w-7 h-7",
              ].join(" ")}
              whileTap={{ scale: 0.85, opacity: 0.7 }}
              transition={{ type: "spring", stiffness: 500, damping: 28 }}
            >
              <motion.div
                animate={{ rotate: isAsideCollapsed ? 180 : 0 }}
                transition={{ type: "spring", stiffness: 320, damping: 28 }}
                style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <ChevronLeft className={device.isTablet ? "w-[18px] h-[18px]" : "w-4 h-4"} />
              </motion.div>
            </motion.button>
          </motion.div>
          {/* Navigation */}
          <motion.nav
            aria-label={language === "ar" ? "التنقل الرئيسي" : "Main Navigation"}
            className={`flex flex-col ${device.isTablet ? "gap-1.5" : "gap-0.5"} overflow-y-auto min-h-0 flex-1 hide-scrollbar overscroll-y-contain`}
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
                : `justify-between px-2.5 py-2 rounded-xl
                   bg-neutral-100/50 dark:bg-white/[0.04]
                   border border-black/[0.04] dark:border-white/[0.07]
                   hover:bg-neutral-100/90 dark:hover:bg-white/[0.08]
                   transition-colors duration-200 ease-out`
            }`}
          >
            {/* Avatar + name */}
            <button
              onClick={() => handleSidebarTabClick("profile")}
              className={`flex items-center ${device.isTablet ? "gap-3" : "gap-2.5"} cursor-pointer outline-none
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
                  className={`${device.isTablet ? "w-10 h-10" : "w-9 h-9"} border border-white/25 dark:border-white/[0.12]`}
                />
                {/* Online dot */}
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-white dark:border-[#1C1C1E]" />
              </div>
              {!isAsideCollapsed && (
                <div className="flex-1 min-w-0">
                  <h4 className={`${device.isTablet ? "text-[13.5px]" : "text-[13px]"} font-semibold text-neutral-900 dark:text-white leading-none truncate antialiased`}>
                    {currentUser.name}
                  </h4>
                  <p className={`${device.isTablet ? "text-[11.5px]" : "text-[11px]"} font-medium text-neutral-400 dark:text-[#EBEBF560] truncate antialiased mt-[5px]`}>
                    {currentUser.email}
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
                ${isAsideCollapsed
                  ? `${device.isTablet ? "w-12 h-12" : "w-10 h-10"} bg-neutral-100/70 dark:bg-white/[0.05] border border-black/[0.04] dark:border-white/[0.07]`
                  : device.isTablet ? "w-9 h-9" : "w-8 h-8"
                }`}
              title={language === "ar" ? "تسجيل الخروج" : "Sign Out"}
              aria-label={language === "ar" ? "تسجيل الخروج" : "Sign Out"}
              whileHover={{ scale: 1.1, rotate: -15 }}
              whileTap={{ scale: 0.88, opacity: 0.7 }}
              transition={{ type: "spring", stiffness: 500, damping: 25 }}
            >
              <LogOut className={device.isTablet ? "w-4 h-4" : "w-[15px] h-[15px]"} />
            </motion.button>
          </div>
        </div>
      </aside>
      {/* Main Content Workspace wrapper */}
      <div className="flex-1 flex flex-col min-w-0 h-[100svh] max-h-[100svh] overflow-hidden relative transition duration-300">
        {/* 2. Main Content Canvas */}
        <main
          id="main-scroll-canvas"
          className={`flex-1 w-full ${
            isCompactWidth
              ? "max-w-full"
              : isRegularWidth
                ? "max-w-full"
                : "max-w-full"
          } mx-auto ${device.margins} overflow-y-auto overflow-x-clip ios-scrollable overscroll-y-contain`}
          style={{
            paddingTop: "calc(16px + env(safe-area-inset-top, 0px))",
            paddingBottom: isCompactWidth
              ? "calc(100px + env(safe-area-inset-bottom, 16px))"
              : "calc(24px + env(safe-area-inset-bottom, 0px))",
          }}
        >
          {/* iOS Native Large Title (Scrolls with Content) */}
          {((activeTab === "subjects" && activeSubjectId === null) ||
            ["calendar", "control-center", "profile", "settings"].includes(
              activeTab,
            )) && (
            <div className="mb-6 pt-2 select-none md:hidden">
              <h1 className="text-large-title font-display font-semibold text-neutral-900 dark:text-white">
                {activeTab === "subjects"
                  ? language === "ar"
                    ? "المكتبة"
                    : "Library"
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
            </div>
          )}

          {/* VIEW CONDITIONAL SWITCH WITH FLUID GESTURE TRANSITIONS */}
          <div className="w-full relative h-full">
            {/* Tab 1: Welcome (Home) */}
            <div
              
              style={{ display: activeTab === "home" ? "block" : "none" }}
              className="w-full"
            >
              <motion.div
                initial={false}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
                style={{ willChange: "transform, opacity" }}
                className="w-full"
              >
                <AnimatePresence mode="wait">
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

                        <AnimatePresence>
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
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </div>

            {/* Tab 2: Library (Subjects) */}
            <div
              
              style={{ display: activeTab === "subjects" ? "block" : "none" }}
              className="w-full"
            >
              <div className="w-full">
                  {activeSubjectId === null ? (
                    <div
                      key="subjects-grid-outer"
                      className="space-y-8"
                    >
                      {/* Premium Apple HIG Library Header */}
                      <div className="flex flex-col gap-5 pt-4 pb-6">
                        <div className="flex flex-col gap-3">
                          <h1 className="text-large-title font-display font-semibold text-neutral-900 dark:text-white">
                            Medical Library
                          </h1>
                          <p className="text-subhead font-medium text-neutral-500 dark:text-[#EBEBF599] max-w-lg">
                            Explore your medical subjects and continue learning
                            where you left off.
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 mt-1">
                          <div className="flex items-center gap-3 bg-neutral-100 dark:bg-[#1C1C1E] px-4 py-2 rounded-lg ring-1 ring-black/[0.04] dark:ring-white/10">
                            <Database className="w-icon-sm h-icon-sm text-neutral-500 dark:text-[#EBEBF599]" />
                            <span className="text-footnote font-medium text-neutral-700 dark:text-[#EBEBF599]">
                              <span className="font-semibold text-neutral-900 dark:text-white">
                                {subjects.length}
                              </span>{" "}
                              Subjects
                            </span>
                          </div>

                          <div className="flex items-center gap-3 bg-neutral-100 dark:bg-[#1C1C1E] px-4 py-2 rounded-lg ring-1 ring-black/[0.04] dark:ring-white/10">
                            <BookOpen className="w-icon-sm h-icon-sm text-neutral-500 dark:text-[#EBEBF599]" />
                            <span className="text-footnote font-medium text-neutral-700 dark:text-[#EBEBF599]">
                              <span className="font-semibold text-neutral-900 dark:text-white">
                                {totalLectureCount}
                              </span>{" "}
                              Lectures
                            </span>
                          </div>

                          <div className="flex items-center gap-3 bg-neutral-100 dark:bg-[#1C1C1E] px-4 py-2 rounded-lg ring-1 ring-black/[0.04] dark:ring-white/10">
                            <CircleCheck className="w-icon-sm h-icon-sm text-neutral-500 dark:text-[#EBEBF599]" />
                            <span className="text-footnote font-medium text-neutral-700 dark:text-[#EBEBF599]">
                              <span className="font-semibold text-neutral-900 dark:text-white">
                                {
globalProgressStats.completedLecturesCount
                                }
                              </span>{" "}
                              Completed
                            </span>
                          </div>

                          <div className="flex items-center gap-3 bg-neutral-100 dark:bg-[#1C1C1E] px-4 py-2 rounded-lg ring-1 ring-black/[0.04] dark:ring-white/10">
                            <TrendingUp className="w-icon-sm h-icon-sm text-neutral-500 dark:text-[#EBEBF599]" />
                            <span className="text-footnote font-medium text-neutral-700 dark:text-[#EBEBF599]">
                              <span className="font-semibold text-neutral-900 dark:text-white">
                                {(
                                  Object.values(
                                    subjectLectureCounts,
                                  ) as number[]
                                ).reduce((a: number, b: number) => a + b, 0) > 0
                                  ? globalProgressStats.overallCompletionPercentage
                                  : 0}
                                %
                              </span>{" "}
                              Progress
                            </span>
                          </div>
                        </div>
                      </div>

                      <div
                        key={`subjects-grid-${activeTab}`}
                        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
                        style={
                          {
                            WebkitOverflowScrolling: "touch",
                            isolation: "isolate",
                          } as any
                        }
                      >
                        {subjects.map((subItem, index) => {
                          const lCount = subjectLectureCounts[subItem.id] || 0;
                          const iconInfo = getSubjectIconInfo(subItem.id);
                          const IconComponent = iconInfo.icon;

                          // Use precalculated progress metrics
                          const metrics = subjectProgressMetrics.get(subItem.id);
                          const progressPct = metrics ? metrics.progressPercentage : 0;

                          return (
                            <SwipeableSubjectButton
                              key={subItem.id}
                              subject={subItem}
                              lecturesCount={lCount}
                              iconInfo={iconInfo}
                              IconComponent={IconComponent}
                              onSelectSubject={setActiveSubjectId}
                              isRtl={language === "ar"}
                              isTouchDevice={isTouchDevice}
                              index={index}
                              progressPct={progressPct}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div
                      key="subject-details-wrapper"
                      className="relative overflow-hidden w-full"
                      style={{
                        transform: `translate3d(${subjectSwipeX}px, 0, 0)`,
                      }}
                    >
                      <div className="w-full grid grid-cols-1 grid-rows-1 relative">
                        {/* Smooth state-driven preservation of SubjectView without unmounting (keeps states and scroll) */}
                        <div
                          style={{
                            gridArea: "1 / 1 / 2 / 2",
                            pointerEvents:
                              activeLecture === null ? "auto" : "none",
                          }}
                          className="w-full"
                        >
                          <Suspense fallback={iOSLoadingFallback}>
<ErrorBoundary>
                            <SubjectView
                              key={activeSubjectId}
                              subject={subjects.find(
                                (s) => s.id === activeSubjectId,
                              ) || subjects[0]}
                              progress={progressDb}
                              dbLectures={dbLectures}
                              deepLinkedLecture={activeLecture}
                              onBack={handleBackSubject}
                              onSelectLecture={(lect, tab) => { if (tab) setActiveLectureTab(tab); else setActiveLectureTab("pdf"); setActiveLecture(lect); }}
                              language={language}
                              calendarEvents={calendarEventsDb}
                            />
                          </ErrorBoundary>
</Suspense>
                        </div>

                        <AnimatePresence>
                          {activeLecture !== null && (
                            <motion.div
                              key="lecture-detail"
                              style={{
                                gridArea: "1 / 1 / 2 / 2",
                                zIndex: 10,
                                boxShadow:
                                  "0 20px 40px -15px rgba(0, 0, 0, 0.15), 0 15px 25px -10px rgba(0, 0, 0, 0.08)",
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
                        </AnimatePresence>
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
              currentUser?.role === "owner" ||
              currentUser?.email === "mostafa.samad24001@comed.uobaghdad.edu.iq") && (
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

        {/* 3. iOS-Native Glassmorphism Tab Bar (Apple Full-Width) */}
        <footer
          id="ios_native_tabbar_wrapper"
          className={`fixed bottom-0 left-0 right-0 z-50 select-none transition duration-300 border-t border-black/5 dark:border-white/[0.12] bg-white/80 dark:bg-[#1C1C1E]/80 backdrop-blur-sm ${isCompactWidth ? "block" : "hidden"}`}
        >
          <div
            id="ios_native_tabbar"
            className="relative w-full px-2 transition duration-300"
            style={{
              height: isCompactHeight ? "49px" : "64px",
              paddingBottom: "env(safe-area-inset-bottom, 0px)",
              boxSizing: "content-box",
            }}
          >
            <div
              className={`grid ${currentUser?.isAdmin || currentUser?.role === "admin" || currentUser?.role === "owner" || currentUser?.email === "mostafa.samad24001@comed.uobaghdad.edu.iq" ? "grid-cols-5" : "grid-cols-4"} h-full text-center items-center relative z-0 max-w-md mx-auto`}
            >
              {bottomTabBarItems.map((item) => (
                <TabBarItem
                  key={item.id}
                  id={item.id}
                  icon={item.icon}
                  label={item.label}
                  isActive={activeTab === item.id}
                  isCompactHeight={isCompactHeight}
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
      <AnimatePresence>
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
      </AnimatePresence>
    </div>
  );
}
