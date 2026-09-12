/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useLayoutEffect,
  useRef,
  memo,
  lazy,
  Suspense,
} from "react";
import { flushSync } from "react-dom";
import { animate, motion, useMotionValue } from "motion/react";
import { IOS_CONSOLE_SMOOTH_MOTION } from "../../../core/motion/swipeMotion";
import {
  User,
  UserProgress,
  PointsLog,
  CalendarEvent,
  Subject,
} from "../../../core/types";
import { Language } from "../../../core/i18n/translations";
import {
  ShieldCheck,
  Lock,
  ChevronRight,
  FolderPlus,
  FileText,
  Video,
  HelpCircle,
  Layers,
  BellRing,
  Calendar,
  Quote,
  Flag,
  MicOff,
  ShieldOff,
  ClipboardList,
} from "lucide-react";

// ── Sidebar nav button (md+ vertical list) ──────────────────────────────────
const NavButton = memo(({
  id,
  label,
  Icon,
  iconColorClass,
  isPulse,
  isActive,
  onClick,
  isRtl,
  extraClassName = "",
}: {
  id: string;
  label: string;
  Icon?: React.ElementType;
  iconColorClass?: string;
  isPulse?: boolean;
  isActive: boolean;
  onClick: (id: any) => void;
  isRtl: boolean;
  extraClassName?: string;
}) => (
  <button
    type="button"
    data-console-tab-id={id}
    onClick={() => onClick(id)}
    className={`w-full text-right font-display text-caption font-medium px-3 py-3 rounded-lg flex items-center justify-between transition cursor-pointer ${extraClassName} ${
      isActive
        ? "bg-neutral-100/80 dark:bg-white/[0.08] text-rose-600 dark:text-rose-400 border-rose-500"
        : "text-neutral-600 dark:text-[#EBEBF599] hover:bg-neutral-50 dark:hover:bg-neutral-850/40 hover:text-neutral-800 dark:hover:text-neutral-200 border-transparent"
    }`.trim()}
    style={{
      borderLeftWidth: isRtl ? "0px" : "2px",
      borderRightWidth: isRtl ? "2px" : "0px",
    }}
  >
    <div className="flex items-center gap-2">
      {isPulse ? (
        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
      ) : (
        Icon && <Icon className={`w-icon-sm h-icon-sm shrink-0 ${iconColorClass}`} />
      )}
      <span>{label}</span>
    </div>
    <ChevronRight
      className="w-icon-sm h-icon-sm opacity-50 shrink-0"
      style={{ transform: isRtl ? "rotate(180deg)" : "none" }}
    />
  </button>
));

// ── Mobile pill nav button (< md horizontal strip) ───────────────────────────
const PillNavButton = memo(({
  id,
  label,
  Icon,
  iconColorClass,
  isPulse,
  isActive,
  onClick,
}: {
  id: string;
  label: string;
  Icon?: React.ElementType;
  iconColorClass?: string;
  isPulse?: boolean;
  isActive: boolean;
  onClick: (id: any) => void;
}) => (
  <button
    type="button"
    data-console-tab-id={id}
    onClick={() => onClick(id)}
    className={`snap-center flex-none flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-150 touch-manipulation ${
      isActive
        ? "bg-rose-500 text-white shadow-sm"
        : "bg-neutral-100 dark:bg-white/[0.08] text-neutral-600 dark:text-[#EBEBF599] hover:bg-neutral-200 dark:hover:bg-white/[0.14]"
    }`}
  >
    {isPulse ? (
      <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
    ) : (
      Icon && (
        <Icon
          className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-white" : iconColorClass}`}
        />
      )
    )}
    <span>{label}</span>
  </button>
));

// ── Lazy-loaded panels ────────────────────────────────────────────────────────
import UserPresenceWidget from "../../../components/ui/UserPresenceWidget";
import CreateLecture from "../../lectures/components/CreateLecture";

// Keep the panels code-split for normal users, but warm the admin-only chunks as
// soon as Control Center becomes active on iPhone. That removes the one-frame
// Suspense gap that otherwise makes the first swipe to a never-opened tab feel
// like a web page instead of a native pager.
const loadUploadMaterial = () => import("../../lectures/components/UploadMaterial");
const loadCreateMCQ = () => import("../../lectures/components/CreateMCQ");
const loadCreateAnki = () => import("../../lectures/components/CreateAnki");
const loadSendNotification = () => import("../../bulletin/components/SendNotification");
const loadManageCalendar = () => import("../../calendar/components/ManageCalendar");
const loadManageDailyMotto = () => import("./ManageDailyMotto");
const loadUserRoleManagement = () => import("./UserRoleManagement");
const loadModerationView = () => import("../../moderation/components/ModerationView");
const loadMutedUsersView = () => import("../../moderation/components/MutedUsersView");
const loadBannedUsersView = () => import("../../moderation/components/BannedUsersView");
const loadModerationHistoryView = () => import("../../moderation/components/ModerationHistoryView");

const UploadMaterial = lazy(loadUploadMaterial);
const CreateMCQ = lazy(loadCreateMCQ);
const CreateAnki = lazy(loadCreateAnki);
const SendNotification = lazy(loadSendNotification);
const ManageCalendar = lazy(loadManageCalendar);
const ManageDailyMotto = lazy(loadManageDailyMotto);
const UserRoleManagement = lazy(loadUserRoleManagement);
const ModerationView = lazy(loadModerationView);
const MutedUsersView = lazy(loadMutedUsersView);
const BannedUsersView = lazy(loadBannedUsersView);
const ModerationHistoryView = lazy(loadModerationHistoryView);

interface ControlCenterProps {
  isActive?: boolean;
  currentUser: User;
  progressDb: UserProgress[];
  pointsLogDb: PointsLog[];
  calendarEventsDb: CalendarEvent[];
  subjects: Subject[];
  onAddPoints: (amount: number, reason: string) => void;
  onAddNewEvent: (newEvent: CalendarEvent) => void;
  onUpdateLectureProgress: (updates: Partial<UserProgress>) => void;
  onSync: (
    user: User,
    progress: UserProgress[],
    logs: PointsLog[],
    events: CalendarEvent[],
  ) => Promise<void>;
  onForceLocalReset: () => void;
  language: Language;
  onRefreshSubjects?: () => void;
  onDeleteEvent?: (eventId: string) => Promise<void> | void;
  onEditEvent?: (event: CalendarEvent) => void;
  onRedirect?: (tab: string) => void;
  isPhone: boolean;
  onBackHistoryChange?: (hasBackHistory: boolean) => void;
}

type SubTab =
  | "live-study-hall"
  | "daily-motto"
  | "lecture"
  | "pdf"
  | "note"
  | "video"
  | "mcq"
  | "anki"
  | "notifications"
  | "user-role-management"
  | "calendar"
  | "moderation"
  | "muted-users"
  | "banned-users"
  | "moderation-history";

const ControlCenterView = function ControlCenterView({
  currentUser,
  language,
  onRefreshSubjects,
  calendarEventsDb,
  onDeleteEvent,
  onEditEvent,
  onRedirect,
  isPhone,
  isActive = false,
  onBackHistoryChange,
}: ControlCenterProps) {
  const isRtl = language === "ar";

  const [activeSubTab, setActiveSubTab] = useState<SubTab>(
    currentUser.role === "admin" ? "lecture" : "live-study-hall",
  );

  // iPhone-only Console pager state. Keep this intentionally identical to the
  // approved Roles filter pager: a short content drag, atomic content handoff,
  // then one spring back to x=0. No underlay/preview page is mounted while the
  // finger is moving, so there is no second layout tree that can resize, flash,
  // or look like a refresh during the gesture.
  const consoleSwipeX = useMotionValue(0);
  const [consolePreviewSubTab, setConsolePreviewSubTab] = useState<SubTab | null>(null);
  const consolePreviewSubTabRef = useRef<SubTab | null>(null);
  const consoleSwipeSessionRef = useRef<{
    tracking: boolean;
    axis: "x" | "y" | null;
    startX: number;
    startY: number;
    lastX: number;
    lastTime: number;
    velocity: number;
    roleHeaderZone: boolean;
  }>({ tracking: false, axis: null, startX: 0, startY: 0, lastX: 0, lastTime: 0, velocity: 0, roleHeaderZone: false });
  const consoleSwipeAnimatingRef = useRef(false);
  const consolePillStripRef = useRef<HTMLDivElement>(null);
  const consoleContentShellRef = useRef<HTMLDivElement>(null);
  const consoleStableMinHeightRef = useRef(0);

  useEffect(() => {
    if (!isPhone || !isActive) return;

    // Fire-and-forget preload. Dynamic-import promises are cached by the module
    // loader, so rendering a preview later reuses the exact same chunks.
    void Promise.allSettled([
      loadUploadMaterial(),
      loadCreateMCQ(),
      loadCreateAnki(),
      loadSendNotification(),
      loadManageCalendar(),
      loadManageDailyMotto(),
      currentUser.role === "owner"
        ? loadUserRoleManagement().then((module) => module.preloadUserRoleUsers?.())
        : Promise.resolve(),
      loadModerationView(),
      loadMutedUsersView(),
      loadBannedUsersView(),
      loadModerationHistoryView(),
    ]);
  }, [currentUser.role, isActive, isPhone]);

  // Console tab paging is lateral navigation, not a pushed Back stack. Report
  // that explicitly so App never lets a stale flag interfere with root gestures.
  useEffect(() => {
    onBackHistoryChange?.(false);
    return () => onBackHistoryChange?.(false);
  }, [onBackHistoryChange]);

  // Keep the Console content shell from shrinking between sub-tabs on iPhone.
  // A shorter destination panel therefore cannot resize the shared page or move
  // the user's vertical position after a swipe. The floor only grows during the
  // current Console session and is applied before the browser paints.
  useLayoutEffect(() => {
    if (!isPhone) return;
    const shell = consoleContentShellRef.current;
    if (!shell) return;
    const measured = Math.ceil(Math.max(shell.getBoundingClientRect().height, shell.scrollHeight));
    if (measured > consoleStableMinHeightRef.current) {
      consoleStableMinHeightRef.current = measured;
      shell.style.minHeight = `${measured}px`;
    } else if (consoleStableMinHeightRef.current > 0) {
      shell.style.minHeight = `${consoleStableMinHeightRef.current}px`;
    }
  }, [activeSubTab, isPhone]);

  // Keep the active pill horizontally centered without scrolling the page
  // vertically (scrollIntoView would jump the shared main canvas on long forms).
  useEffect(() => {
    if (!isPhone || !isActive) return;
    const frame = requestAnimationFrame(() => {
      const strip = consolePillStripRef.current;
      const item = strip?.querySelector<HTMLElement>(`[data-console-tab-id="${activeSubTab}"]`);
      if (!strip || !item) return;
      const stripRect = strip.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      const delta =
        itemRect.left + itemRect.width / 2 -
        (stripRect.left + stripRect.width / 2);
      if (Math.abs(delta) > 4) {
        strip.scrollBy({ left: delta, behavior: "smooth" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeSubTab, isActive, isPhone]);

  const handleRefreshSubjects = useCallback(() => {
    onRefreshSubjects?.();
  }, [onRefreshSubjects]);

  useEffect(() => {
    if (currentUser.role === "user") {
      onRedirect?.("home");
    }
  }, [currentUser, onRedirect]);

  if (currentUser.role === "user") return null;

  if (
    !currentUser.isAdmin &&
    currentUser.role !== "admin" &&
    currentUser.role !== "owner"
  ) {
    return (
      <div
        id="forbidden_card"
        className="max-w-xl mx-auto p-card-padding sm:p-8 bg-white dark:bg-[#1C1C1E] border border-red-200 dark:border-red-950 rounded-lg text-center space-y-4 my-10 shadow-elevation-3"
        style={{ direction: isRtl ? "rtl" : "ltr" }}
      >
        <Lock className="w-12 h-12 text-med-error mx-auto animate-bounce" />
        <h2 className="text-headline font-display font-semibold text-neutral-800 dark:text-white">
          🔒 {isRtl ? "صلاحيات الوصول مقيدة" : "Administrative Access Termed"}
        </h2>
        <p className="text-secondary-label dark:text-[#EBEBF599]">
          {isRtl
            ? "يقتصر الوصول حصرياً على ممثلي الدفعة والمشرفين الأكاديميين المعتمدين لدفعة 99 كلية الطب جامعة بغداد."
            : "Access is limited to authorized administrators. Sign in with your credentials."}
        </p>
      </div>
    );
  }

  // ── Nav item definitions (single source of truth for both strip & sidebar) ──
  // Pill labels are abbreviated to fit the compact horizontal strip on mobile.
  const isOwner = currentUser.role === "owner";
  const isAdmin = currentUser.role === "admin";
  const isNonAdmin = !isAdmin;

  type NavItem = {
    id: SubTab;
    sidebarLabel: string;
    pillLabel: string;
    Icon?: React.ElementType;
    iconColorClass?: string;
    isPulse?: boolean;
    sidebarCategory?: string;
    sidebarCategoryAr?: string;
    extraClassName?: string;
  };

  const navItems: NavItem[] = [
    // Users group — owner/non-admin only
    ...(isNonAdmin ? ([
      {
        id: "live-study-hall" as SubTab,
        sidebarLabel:   isRtl ? "قاعة الدراسة الحية" : "Live Study Hall",
        pillLabel:      isRtl ? "الحية"               : "Hall",
        isPulse: true,
        sidebarCategory:   "Users",
        sidebarCategoryAr: "المستخدمين",
      },
      ...(isOwner ? ([{
        id: "user-role-management" as SubTab,
        sidebarLabel:   isRtl ? "إدارة صلاحيات الرتب" : "User Role Management",
        pillLabel:      isRtl ? "الرتب"                : "Roles",
        Icon: ShieldCheck,
        iconColorClass: "text-med-gold",
        extraClassName: "mt-1",
      }] as NavItem[]) : []),
      // Calendar group
      {
        id: "calendar" as SubTab,
        sidebarLabel:   isRtl ? "جدول الفعاليات والتقويم" : "Calendar Schedule",
        pillLabel:      isRtl ? "التقويم"                  : "Calendar",
        Icon: Calendar,
        iconColorClass: "text-rose-500",
        sidebarCategory:   "Calendar",
        sidebarCategoryAr: "التقويم",
      },
    ] as NavItem[]) : []),

    // Lecture group — always visible
    {
      id: "lecture" as SubTab,
      sidebarLabel:   isRtl ? "إدارة المحاضرات" : "Manage Lectures",
      pillLabel:      isRtl ? "محاضرة"           : "Lecture",
      Icon: FolderPlus,
      iconColorClass: "text-rose-500",
      sidebarCategory:   "Lecture",
      sidebarCategoryAr: "المحاضرة",
    },
    {
      id: "pdf" as SubTab,
      sidebarLabel:   isRtl ? "رفع ملفات PDF" : "PDFs",
      pillLabel:      "PDF",
      Icon: FileText,
      iconColorClass: "text-emerald-500",
    },
    {
      id: "note" as SubTab,
      sidebarLabel:   isRtl ? "رفع ملخصات Notes" : "Notes",
      pillLabel:      isRtl ? "ملخص" : "Note",
      Icon: FileText,
      iconColorClass: "text-teal-500",
    },
    {
      id: "video" as SubTab,
      sidebarLabel:   isRtl ? "ربط فيديو مرئي Video" : "Videos",
      pillLabel:      isRtl ? "فيديو" : "Video",
      Icon: Video,
      iconColorClass: "text-med-blue",
    },
    {
      id: "mcq" as SubTab,
      sidebarLabel:   isRtl ? "صياغة MCQ" : "MCQ",
      pillLabel:      "MCQ",
      Icon: HelpCircle,
      iconColorClass: "text-purple-500",
    },
    {
      id: "anki" as SubTab,
      sidebarLabel:   isRtl ? "بطاقات تذكر (Anki)" : "Anki",
      pillLabel:      isRtl ? "بطاقات" : "Anki",
      Icon: Layers,
      iconColorClass: "text-indigo-500",
    },

    // Notifications — non-admin only
    ...(isNonAdmin ? ([{
      id: "notifications" as SubTab,
      sidebarLabel:   isRtl ? "الرسائل وبث الإشعارات" : "Send Announcements",
      pillLabel:      isRtl ? "إشعار" : "Notif",
      Icon: BellRing,
      iconColorClass: "text-rose-500",
      sidebarCategory:   "Notifications",
      sidebarCategoryAr: "الإشعارات",
    }] as NavItem[]) : []),

    // Owner-only items
    ...(isOwner ? ([
      {
        id: "daily-motto" as SubTab,
        sidebarLabel:   isRtl ? "إدارة الشعار اليومي" : "Manage Daily Motto",
        pillLabel:      isRtl ? "شعار" : "Motto",
        Icon: Quote,
        iconColorClass: "text-indigo-500",
        sidebarCategory:   "Daily Motto",
        sidebarCategoryAr: "شعار اليوم",
      },
      {
        id: "moderation" as SubTab,
        sidebarLabel:   isRtl ? "المحتوى المُبلَّغ عنه" : "Reported Content",
        pillLabel:      isRtl ? "بلاغات" : "Reports",
        Icon: Flag,
        iconColorClass: "text-rose-500",
        sidebarCategory:   "Moderation",
        sidebarCategoryAr: "الإشراف",
      },
      {
        id: "muted-users" as SubTab,
        sidebarLabel:   isRtl ? "المستخدمون المكتومون" : "Muted Users",
        pillLabel:      isRtl ? "كتم" : "Muted",
        Icon: MicOff,
        iconColorClass: "text-amber-500",
      },
      {
        id: "banned-users" as SubTab,
        sidebarLabel:   isRtl ? "المستخدمون المحظورون" : "Banned Users",
        pillLabel:      isRtl ? "محظور" : "Banned",
        Icon: ShieldOff,
        iconColorClass: "text-neutral-500",
      },
      {
        id: "moderation-history" as SubTab,
        sidebarLabel:   isRtl ? "سجل الإشراف" : "Moderation History",
        pillLabel:      isRtl ? "تاريخ" : "History",
        Icon: ClipboardList,
        iconColorClass: "text-violet-500",
      },
    ] as NavItem[]) : []),
  ];

  // During a drag we only preview the destination in the top pill strip. The
  // content itself stays as one tree, exactly like All / Owner / Admin / Student
  // in Roles. This is deliberate: one tree means no preview mount, no hidden
  // fetch, no auto-height race, and no refresh-like handoff.
  const visualSubTab = consolePreviewSubTab ?? activeSubTab;

  const freezeConsoleContentHeight = () => {
    if (!isPhone) return;
    const shell = consoleContentShellRef.current;
    if (!shell) return;
    const measured = Math.ceil(Math.max(shell.getBoundingClientRect().height, shell.scrollHeight));
    if (measured > consoleStableMinHeightRef.current) {
      consoleStableMinHeightRef.current = measured;
    }
    if (consoleStableMinHeightRef.current > 0) {
      shell.style.minHeight = `${consoleStableMinHeightRef.current}px`;
    }
  };

  const preserveMainScrollDuringConsoleCommit = (commit: () => void) => {
    const canvas = document.getElementById("main-scroll-canvas");
    const savedTop = canvas?.scrollTop ?? null;

    // Freeze the current content footprint before React swaps panels. This is
    // the Console equivalent of Roles' stable list shell and prevents a shorter
    // destination panel from pulling the shared page upward.
    freezeConsoleContentHeight();
    if (canvas) canvas.dataset.programmaticScrollRestore = "true";

    flushSync(commit);

    // Measure the newly committed panel before paint. The floor may grow but
    // never shrinks during this Console session, so there is no resize pulse.
    freezeConsoleContentHeight();

    if (canvas && savedTop !== null) {
      const maxScroll = Math.max(0, canvas.scrollHeight - canvas.clientHeight);
      canvas.scrollTop = Math.min(savedTop, maxScroll);
      requestAnimationFrame(() => {
        if (canvas.dataset.programmaticScrollRestore === "true") {
          delete canvas.dataset.programmaticScrollRestore;
        }
      });
    }
  };

  const clearConsolePreview = () => {
    consolePreviewSubTabRef.current = null;
    setConsolePreviewSubTab(null);
  };

  // This intentionally mirrors settleRoleSwipe() one-for-one.
  const settleConsoleSwipe = () => {
    const session = consoleSwipeSessionRef.current;
    const currentX = consoleSwipeX.get();
    const direction = currentX === 0 ? 0 : Math.sign(currentX);
    const releaseVelocity = session.velocity;

    session.tracking = false;
    session.axis = null;
    session.velocity = 0;

    animate(consoleSwipeX, 0, {
      ...IOS_CONSOLE_SMOOTH_MOTION.cancelSpring,
      velocity:
        direction *
        Math.min(
          releaseVelocity * 1000,
          window.innerWidth * IOS_CONSOLE_SMOOTH_MOTION.cancelVelocityScreensPerSecond,
        ),
      onComplete: clearConsolePreview,
    });
  };

  const selectSubTab = (next: SubTab) => {
    if (next === activeSubTab || consoleSwipeAnimatingRef.current) return;

    if (!isPhone) {
      consoleSwipeX.set(0);
      clearConsolePreview();
      setActiveSubTab(next);
      return;
    }

    const currentIndex = navItems.findIndex((item) => item.id === activeSubTab);
    const nextIndex = navItems.findIndex((item) => item.id === next);
    if (currentIndex < 0 || nextIndex < 0) {
      preserveMainScrollDuringConsoleCommit(() => setActiveSubTab(next));
      return;
    }

    const logicalForward = nextIndex > currentIndex;
    const physicalSign: 1 | -1 = logicalForward
      ? (isRtl ? 1 : -1)
      : (isRtl ? -1 : 1);

    // Same tap transition as Roles: commit immediately, place the new content
    // only 22px from rest, then use the same completion spring to settle.
    consoleSwipeAnimatingRef.current = true;
    preserveMainScrollDuringConsoleCommit(() => {
      setActiveSubTab(next);
      setConsolePreviewSubTab(null);
    });
    consolePreviewSubTabRef.current = null;
    consoleSwipeX.stop();
    consoleSwipeX.set(-physicalSign * IOS_CONSOLE_SMOOTH_MOTION.underlayOffset);
    animate(consoleSwipeX, 0, {
      ...IOS_CONSOLE_SMOOTH_MOTION.completionSpring,
      onComplete: () => {
        consoleSwipeX.set(0);
        consoleSwipeAnimatingRef.current = false;
      },
    });
  };

  const shouldIgnoreConsoleSwipe = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    if (
      target.closest(
        '[data-console-nav-strip="true"], [data-role-filter-local-zone="true"], input, textarea, select, [contenteditable="true"], [data-console-swipe-ignore="true"]',
      )
    ) {
      return true;
    }

    // Preserve native horizontal carousels/sliders nested inside admin forms.
    let node: HTMLElement | null = target;
    const root = document.getElementById("control_panel_view");
    while (node && node !== root) {
      if (node.scrollWidth > node.clientWidth + 4) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") return true;
      }
      node = node.parentElement;
    }
    return false;
  };

  const handleConsoleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isPhone || !isActive || consoleSwipeAnimatingRef.current) return;
    if (event.touches.length !== 1 || shouldIgnoreConsoleSwipe(event.target)) return;

    consoleSwipeX.stop();
    consoleSwipeX.set(0);
    clearConsolePreview();

    const touch = event.touches[0];
    const target = event.target instanceof HTMLElement ? event.target : null;
    const roleHeaderZone = Boolean(
      activeSubTab === "user-role-management" &&
      target?.closest("#user_role_management_view") &&
      !target?.closest('[data-role-filter-local-zone="true"]'),
    );

    consoleSwipeSessionRef.current = {
      tracking: true,
      axis: null,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastTime: performance.now(),
      velocity: 0,
      roleHeaderZone,
    };
  };

  const handleConsoleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const session = consoleSwipeSessionRef.current;
    if (!session.tracking || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const dx = touch.clientX - session.startX;
    const dy = touch.clientY - session.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (session.axis === null) {
      if (
        absY >= IOS_CONSOLE_SMOOTH_MOTION.verticalRejectDistance &&
        absY > absX * IOS_CONSOLE_SMOOTH_MOTION.verticalRejectRatio
      ) {
        session.tracking = false;
        session.axis = "y";
        return;
      }
      if (absX < IOS_CONSOLE_SMOOTH_MOTION.axisLockDistance) return;
      if (absY > absX * IOS_CONSOLE_SMOOTH_MOTION.horizontalLockMaxVerticalRatio) return;
      session.axis = "x";
    }
    if (session.axis !== "x") return;
    if (event.cancelable) event.preventDefault();

    const now = performance.now();
    const dt = Math.max(1, now - session.lastTime);
    const instantaneousVelocity = Math.abs(touch.clientX - session.lastX) / dt;
    session.velocity =
      session.velocity * IOS_CONSOLE_SMOOTH_MOTION.velocityPreviousWeight +
      instantaneousVelocity * IOS_CONSOLE_SMOOTH_MOTION.velocityCurrentWeight;
    session.lastX = touch.clientX;
    session.lastTime = now;

    const currentIndex = navItems.findIndex((item) => item.id === activeSubTab);
    // Keep the previously approved physical mapping on the Roles heading/filter
    // strip. Elsewhere use the normal language-aware Console direction.
    const forward = session.roleHeaderZone ? dx < 0 : (isRtl ? dx > 0 : dx < 0);
    const nextIndex = currentIndex + (forward ? 1 : -1);
    const atBoundary = nextIndex < 0 || nextIndex >= navItems.length;

    if (atBoundary) {
      clearConsolePreview();
      consoleSwipeX.set(dx * IOS_CONSOLE_SMOOTH_MOTION.boundaryResistance);
      return;
    }

    const preview = navItems[nextIndex]?.id;
    if (!preview) return;
    if (consolePreviewSubTabRef.current !== preview) {
      consolePreviewSubTabRef.current = preview;
      setConsolePreviewSubTab(preview);
    }

    // Exact Roles motion: a short, direct content translation. Never move the
    // Console panel across the full screen and never mount an underlay page.
    const rendered = Math.max(
      -IOS_CONSOLE_SMOOTH_MOTION.roleDragMax,
      Math.min(
        IOS_CONSOLE_SMOOTH_MOTION.roleDragMax,
        dx * IOS_CONSOLE_SMOOTH_MOTION.roleDragFactor,
      ),
    );
    consoleSwipeX.set(rendered);
  };

  const handleConsoleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const session = consoleSwipeSessionRef.current;
    if (!session.tracking) return;
    session.tracking = false;

    const touch = event.changedTouches[0];
    if (!touch || session.axis !== "x") {
      settleConsoleSwipe();
      return;
    }

    const dx = touch.clientX - session.startX;
    const currentIndex = navItems.findIndex((item) => item.id === activeSubTab);
    const forward = session.roleHeaderZone ? dx < 0 : (isRtl ? dx > 0 : dx < 0);
    const nextIndex = currentIndex + (forward ? 1 : -1);

    // Match Roles exactly instead of using the old 30%-of-screen page threshold.
    const qualifies =
      Math.abs(dx) >= 44 ||
      (Math.abs(dx) >= 24 && session.velocity >= IOS_CONSOLE_SMOOTH_MOTION.velocityThreshold);

    if (!qualifies || nextIndex < 0 || nextIndex >= navItems.length) {
      settleConsoleSwipe();
      return;
    }

    const next = navItems[nextIndex]?.id;
    if (!next) {
      settleConsoleSwipe();
      return;
    }

    consoleSwipeAnimatingRef.current = true;

    // Same atomic handoff as Roles: the destination inherits the exact rendered
    // X position, React swaps the content once, then that same layer settles to
    // zero. No full-page exit, no underlay, no second resize/refresh phase.
    const handoffX = Math.max(
      -IOS_CONSOLE_SMOOTH_MOTION.roleDragMax,
      Math.min(IOS_CONSOLE_SMOOTH_MOTION.roleDragMax, consoleSwipeX.get()),
    );

    preserveMainScrollDuringConsoleCommit(() => {
      setActiveSubTab(next);
      setConsolePreviewSubTab(null);
    });
    consolePreviewSubTabRef.current = null;
    consoleSwipeX.set(handoffX);
    animate(consoleSwipeX, 0, {
      ...IOS_CONSOLE_SMOOTH_MOTION.completionSpring,
      velocity: 0,
      onComplete: () => {
        consoleSwipeX.set(0);
        consoleSwipeAnimatingRef.current = false;
      },
    });
  };

  const handleConsoleTouchCancel = () => {
    consoleSwipeAnimatingRef.current = false;
    settleConsoleSwipe();
  };

  const panelClassName = isPhone ? "" : "animate-fadeIn";

  const renderConsolePanel = (tab: SubTab) => {
    switch (tab) {
      case "calendar":
        return (
          <div className={panelClassName}>
            <ManageCalendar
              language={language === "ar" ? "ar" : "en"}
              onEventCreated={handleRefreshSubjects}
              events={calendarEventsDb}
              onDeleteEvent={onDeleteEvent}
              onEditEvent={onEditEvent}
            />
          </div>
        );
      case "live-study-hall":
        return (
          <div className={`space-y-4 ${panelClassName}`}>
            <div className="border-b border-neutral-100 dark:border-white/[0.12] pb-3 flex items-center gap-2 group relative">
              <h3 className="text-headline font-display font-semibold text-neutral-800 dark:text-white text-right md:text-left">
                {isRtl ? "قاعة الدراسة الحية عبر القنوات الحقيقية" : "Live Study Hall Real-time Presence"}
              </h3>
              <HelpCircle className="w-icon-sm h-icon-sm text-neutral-500 dark:text-[#EBEBF599] cursor-help" />
              <div className="absolute top-full left-0 mt-2 w-64 p-2 bg-neutral-800/95 dark:bg-neutral-700/95 backdrop-blur-sm text-white text-xs rounded-lg shadow-elevation-3 opacity-0 pointer-events-none group-hover:opacity-80 transition-opacity z-50">
                {isRtl
                  ? "قائمة بالطلبة والزملاء المتواجدين حالياً في المنصة بشكل مباشر."
                  : "Real-time list of current cohort representatives and students active on the portal."}
              </div>
            </div>
            <UserPresenceWidget isOwner={currentUser.role === "owner"} currentUserId={currentUser.id} />
          </div>
        );
      case "lecture":
        return <div className={panelClassName}><CreateLecture onLectureCreated={handleRefreshSubjects} language={language === "ar" ? "ar" : "en"} /></div>;
      case "pdf":
        return <div className={panelClassName}><UploadMaterial initialType="PDF" language={language === "ar" ? "ar" : "en"} onSuccess={handleRefreshSubjects} /></div>;
      case "note":
        return <div className={panelClassName}><UploadMaterial initialType="NOTE" language={language === "ar" ? "ar" : "en"} onSuccess={handleRefreshSubjects} /></div>;
      case "video":
        return <div className={panelClassName}><UploadMaterial initialType="VIDEO" language={language === "ar" ? "ar" : "en"} onSuccess={handleRefreshSubjects} /></div>;
      case "mcq":
        return <div className={panelClassName}><CreateMCQ language={language === "ar" ? "ar" : "en"} onSuccess={handleRefreshSubjects} /></div>;
      case "anki":
        return <div className={panelClassName}><CreateAnki language={language === "ar" ? "ar" : "en"} /></div>;
      case "notifications":
        return <div className={panelClassName}><SendNotification language={language === "ar" ? "ar" : "en"} /></div>;
      case "daily-motto":
        return currentUser.role === "owner" ? <div className={panelClassName}><ManageDailyMotto language={language === "ar" ? "ar" : "en"} /></div> : null;
      case "user-role-management":
        return currentUser.role === "owner" ? <div className={panelClassName}><UserRoleManagement currentUser={currentUser} language={language === "ar" ? "ar" : "en"} /></div> : null;
      case "moderation":
        return currentUser.role === "owner" ? <div className={panelClassName}><ModerationView language={language === "ar" ? "ar" : "en"} /></div> : null;
      case "muted-users":
        return currentUser.role === "owner" ? <div className={panelClassName}><MutedUsersView /></div> : null;
      case "banned-users":
        return currentUser.role === "owner" ? <div className={panelClassName}><BannedUsersView /></div> : null;
      case "moderation-history":
        return currentUser.role === "owner" ? <div className={panelClassName}><ModerationHistoryView language={language} /></div> : null;
      default:
        return null;
    }
  };

  // ── Sidebar: group categories to insert headings between items ───────────────
  // We track which category heading we've already rendered.
  const renderedCategories = new Set<string>();

  return (
    <div
      id="control_panel_view"
      className="cc-view-root space-y-section animate-fadeIn pb-24 w-full"
      style={{ direction: isRtl ? "rtl" : "ltr", touchAction: "pan-y" }}
      onTouchStart={handleConsoleTouchStart}
      onTouchMove={handleConsoleTouchMove}
      onTouchEnd={handleConsoleTouchEnd}
      onTouchCancel={handleConsoleTouchCancel}
    >
      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div className="w-full bg-white dark:bg-[#1C1C1E] border border-neutral-200/40 dark:border-[rgba(255,255,255,0.08)] rounded-lg p-3 sm:p-4 shadow-elevation-1">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex-1">
            <h2 className="text-lg font-display font-semibold text-neutral-800 dark:text-white flex items-center gap-2">
              <ShieldCheck className="w-icon-md h-icon-md text-rose-500 shrink-0" />
              {isRtl ? "لوحة التحكم الرئيسية" : "Console Command Station"}
            </h2>
          </div>
          {isNonAdmin && (
            <div className="flex flex-wrap items-center gap-2 shrink-0" />
          )}
        </div>
      </div>

      {/* ── Mobile pill nav strip (visible below md) ─────────────────────────── */}
      {/*
          Horizontal scrollable pill row. Replaces the full-width vertical
          sidebar on portrait/narrow viewports. No min-height, no nested
          scroll trap — this is pure flex-row with overflow-x-auto.
          The hide-scrollbar utility suppresses the visual scrollbar while
          keeping the swipe gesture functional on iOS.
      */}
      <div
        className={isPhone ? "w-full" : "md:hidden w-full"}
        aria-label={isRtl ? "تنقل اللوحة" : "Console Navigation"}
      >
        <div
          ref={consolePillStripRef}
          data-console-nav-strip="true"
          className="flex flex-row gap-2 overflow-x-auto pb-1 hide-scrollbar overscroll-x-contain snap-x snap-proximity scroll-smooth"
          style={{ WebkitOverflowScrolling: "touch", direction: isRtl ? "rtl" : "ltr", scrollPaddingInline: "16px" }}
        >
          {navItems.map((item) => (
            <PillNavButton
              key={item.id}
              id={item.id}
              label={item.pillLabel}
              Icon={item.Icon}
              iconColorClass={item.iconColorClass}
              isPulse={item.isPulse}
              isActive={visualSubTab === item.id}
              onClick={selectSubTab}
            />
          ))}
        </div>
      </div>

      {/* ── Main layout: sidebar + content ───────────────────────────────────── */}
      {/*
          On mobile (< md):
            - Sidebar is hidden (md:block hides it below md).
            - Content panel is full-width, no overflow-auto (parent scrolls).
            - No min-h floor — content grows naturally.

          On tablet/desktop (≥ md = 768 px):
            - Sidebar is visible on the left.
            - Content panel takes remaining space.
            - flex-row layout with gap.

          The sidebar itself has overflow-y-auto so it scrolls independently
          on desktop when nav items exceed viewport height.
      */}
      <div className="flex flex-col md:flex-row gap-4 items-stretch w-full">

        {/* Sidebar — hidden on mobile, shown on md+ */}
        <div
          className={`
            ${isPhone ? "hidden md:hidden" : "hidden"} md:flex md:flex-col
            md:w-56 shrink-0
            bg-white dark:bg-[#1C1C1E]
            border border-neutral-200/40 dark:border-white/[0.10]
            rounded-lg p-3 shadow-elevation-0
            space-y-3
            overflow-y-auto
          `}
        >
          <div className="space-y-3">
            <div className="text-xs font-mono font-semibold uppercase text-neutral-500 dark:text-[#EBEBF599] px-2">
              {isRtl ? "مركز التنقل باللوحة" : "Console Navigation"}
            </div>

            <div className="space-y-1">
              {navItems.map((item) => {
                // Insert category heading when the item declares one and we
                // haven't rendered that heading yet.
                const catKey = item.sidebarCategory ?? "";
                const showHeading =
                  catKey && !renderedCategories.has(catKey);
                if (showHeading) renderedCategories.add(catKey);

                return (
                  <React.Fragment key={item.id}>
                    {showHeading && (
                      <div className="font-display font-semibold text-caption text-neutral-500 dark:text-[#EBEBF599] px-2 py-1 flex items-center justify-between uppercase font-mono mt-4 first:mt-1">
                        <span>
                          {isRtl ? item.sidebarCategoryAr : item.sidebarCategory}
                        </span>
                      </div>
                    )}
                    <NavButton
                      id={item.id}
                      label={item.sidebarLabel}
                      Icon={item.Icon}
                      iconColorClass={item.iconColorClass}
                      isPulse={item.isPulse}
                      isActive={activeSubTab === item.id}
                      onClick={selectSubTab}
                      isRtl={isRtl}
                      extraClassName={item.extraClassName}
                    />
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>

        {/* Content panel */}
        {/*
            overflow-auto removed: the global #main-scroll-canvas handles
            vertical scrolling. A nested overflow-auto with a fixed height
            would trap content inside and prevent the user from scrolling
            past it normally. min-h-[300px] gives a visual floor on desktop
            so the panel doesn't collapse when lazy-loading a panel that
            hasn't rendered yet.
        */}
        <div
          ref={consoleContentShellRef}
          className={`
            flex-1 min-w-0
            bg-white dark:bg-[#1C1C1E]
            border border-neutral-200/40 dark:border-white/[0.10]
            rounded-md p-4 shadow-elevation-0
            min-h-[200px] md:min-h-[300px]
            overflow-x-hidden
          `}
          style={{ overflowAnchor: "none" }}
        >
          <div className="relative w-full min-w-0 overflow-hidden isolate">
            <motion.div
              className="relative z-10 w-full min-w-0 bg-white dark:bg-[#1C1C1E] will-change-transform"
              style={{
                x: isPhone ? consoleSwipeX : 0,
                transformOrigin: "center center",
                backfaceVisibility: isPhone ? "hidden" : "visible",
                WebkitBackfaceVisibility: isPhone ? "hidden" : "visible",
              }}
            >
              <Suspense
                fallback={<div className="animate-pulse h-32 rounded-lg bg-neutral-100 dark:bg-white/[0.05]" />}
              >
                {renderConsolePanel(activeSubTab)}
              </Suspense>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default memo(ControlCenterView);
