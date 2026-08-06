import { apiClient } from "../../../core/api/apiClient";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  memo,
  lazy,
  Suspense,
} from "react";
import {
  User,
  UserProgress,
  PointsLog,
  CalendarEvent,
  Subject,
} from "../../../core/types";
import { useTranslation, Language } from "../../../core/i18n/translations";
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
    <ChevronRight className="w-icon-sm h-icon-sm opacity-50 shrink-0" style={{ transform: isRtl ? "rotate(180deg)" : "none" }} />
  </button>
));
// Default panels — eagerly imported (shown on first render)
import UserPresenceWidget from "../../../components/ui/UserPresenceWidget";
import CreateLecture from "../../lectures/components/CreateLecture";
// Non-default panels — lazy-loaded so only the active panel's code is fetched
const UploadMaterial = lazy(() => import("../../lectures/components/UploadMaterial"));
const CreateMCQ = lazy(() => import("../../lectures/components/CreateMCQ"));
const CreateAnki = lazy(() => import("../../lectures/components/CreateAnki"));
const SendNotification = lazy(() => import("../../bulletin/components/SendNotification"));
const ManageCalendar = lazy(() => import("../../calendar/components/ManageCalendar"));
const ManageDailyMotto = lazy(() => import("./ManageDailyMotto"));
const UserRoleManagement = lazy(() => import("./UserRoleManagement"));
const ModerationView = lazy(() => import("../../moderation/components/ModerationView"));
const MutedUsersView = lazy(() => import("../../moderation/components/MutedUsersView"));
const BannedUsersView = lazy(() => import("../../moderation/components/BannedUsersView"));
const ModerationHistoryView = lazy(() => import("../../moderation/components/ModerationHistoryView"));
import { NativeBridge } from "../../../core/device/capacitor/nativeBridge";

import { showiOSAlert } from "../../../core/device/alert";

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
}

const ControlCenterView = function ControlCenterView({
  currentUser,
  language,
  onRefreshSubjects,
  calendarEventsDb,
  onDeleteEvent,
  onEditEvent,
  onRedirect,
}: ControlCenterProps) {
  const { t } = useTranslation(language);
  const isRtl = language === "ar";

  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const feedbackTimeout = useRef<NodeJS.Timeout | null>(null);

  const triggerFeedback = useCallback((msg: string) => {
    setActionFeedback(msg);
    if (feedbackTimeout.current) clearTimeout(feedbackTimeout.current);
    feedbackTimeout.current = setTimeout(() => {
      setActionFeedback(null);
    }, 4000);
  }, []);

  const handleDbSync = useCallback(async (isSilent: boolean = false) => {
    if (!isSilent) {
      triggerFeedback(
        isRtl
          ? "⌛ جاري بدء مزامنة قاعدة البيانات وتحديث الجداول..."
          : "⌛ Launching administrative schema synchronization and generation update...",
      );
    }
    try {
      const res = await apiClient("/api/admin/db-sync", {
        method: "POST",
      });
      if (res.ok) {
        if (!isSilent) {
          triggerFeedback(
            isRtl
              ? "✅ تمت مزامنة قاعدة البيانات وجداول Prisma بنجاح!"
              : "✅ Database and Prisma ORM schemas synchronized successfully!",
          );
        }
      } else {
        const data = await res.json();
        if (!isSilent) {
          triggerFeedback(
            isRtl
              ? `❌ فشلت المزامنة: ${data.error || "خطأ داخلي"}`
              : `❌ Sync failed: ${data.error || "Internal Error"}`,
          );
          showiOSAlert({
            title: isRtl
              ? "فشلت مزامنة قاعدة البيانات"
              : "Database Sync Failed",
            message: isRtl
              ? `خطأ: ${data.error || "عادت المزامنة باستجابة غير صحيحة"}\n\nالخطأ بالتفصيل:\n${data.stderr || ""}`
              : `Error: ${data.error || "Schema sync returned non-OK output"}\n\nStderr:\n${data.stderr || ""}`,
          });
        }
      }
    } catch (err: any) {
      if (!isSilent) {
        triggerFeedback(
          isRtl
            ? "✅ وضع الأوفلاين: تمت المزامنة محلياً بنجاح!"
            : "✅ Offline Mode: Synced storage buffers successfully!",
        );
      }
    }
  }, [isRtl, triggerFeedback]);

  type SubTab = "live-study-hall" | "daily-motto" | "lecture" | "pdf" | "note" | "video" | "mcq" | "anki" | "notifications" | "user-role-management" | "calendar" | "moderation" | "muted-users" | "banned-users" | "moderation-history";

  const [activeSubTab, setActiveSubTab] = useState<SubTab>(
    currentUser.role === "admin" ? "lecture" : "live-study-hall"
  );

  const handleRefreshSubjects = useCallback(() => {
    onRefreshSubjects?.();
  }, [onRefreshSubjects]);

  useEffect(() => {
    return () => {
      if (feedbackTimeout.current) clearTimeout(feedbackTimeout.current);
    };
  }, []);

  // Automated Background Sync Hook
  useEffect(() => {
    if (currentUser.role === "user") return;
    // Initial sync on mount (silent)
    handleDbSync(true);
  }, [currentUser.role, handleDbSync]);

  useEffect(() => {
    if (currentUser.role === "user") {
      if (onRedirect) {
        onRedirect("home");
      }
    }
  }, [currentUser, onRedirect]);

  // Security gate checks
  if (currentUser.role === "user") {
    return null;
  }

  if (
    !currentUser.isAdmin &&
    currentUser.role !== "admin" &&
    currentUser.role !== "owner" &&
    currentUser.email !== "mostafa.samad24001@comed.uobaghdad.edu.iq"
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

  return (
    <div
      id="control_panel_view"
      className="space-y-section animate-fadeIn pb-24 w-full"
      style={{ direction: isRtl ? "rtl" : "ltr" }}
    >
      {actionFeedback && (
        <div
          id="toast_notification"
          className="p-3 mx-auto shadow-elevation-3 rounded-md border bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/50 text-caption font-semibold text-center animate-fadeIn w-full max-w-xl"
        >
          {actionFeedback}
        </div>
      )}

      {/* 1. Header of Console in Upper Part */}
      <div className="w-full bg-white dark:bg-[#1C1C1E] border border-neutral-200/40 dark:border-[rgba(255,255,255,0.08)] rounded-lg p-3 sm:p-4 shadow-elevation-1">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex-1">
            <h2 className="text-lg font-display font-semibold text-neutral-800 dark:text-white flex items-center gap-2">
              <ShieldCheck className="w-icon-md h-icon-md text-rose-500 shrink-0" />
              {isRtl ? "لوحة التحكم الرئيسية" : "Console Command Station"}
            </h2>
          </div>

          {/* System Health Widgets */}
          {currentUser.role !== "admin" && (
            <div className="flex flex-wrap items-center gap-2 shrink-0"></div>
          )}
        </div>
      </div>

      {/* 2. Main Console layout with Left Sidebar */}
      <div className="flex flex-col md:flex-row gap-4 items-stretch w-full min-h-[450px]">
        {/* Left Sidebar */}
        <div className="w-full md:w-56 shrink-0 bg-white dark:bg-[#1C1C1E] border border-neutral-200/40 dark:border-white/[0.10] rounded-lg p-3 shadow-elevation-0 space-y-3">
          <div className="space-y-3">
            <div className="text-xs font-mono font-semibold uppercase text-neutral-500 dark:text-[#EBEBF599] px-2">
              {isRtl ? "مركز التنقل باللوحة" : "Console Navigation"}
            </div>

            <div className="space-y-1">
              {/* Category: Users */}
              {currentUser.role !== "admin" && (
                <>
                  <div className="font-display font-semibold text-caption text-neutral-500 dark:text-[#EBEBF599] px-2 py-1 flex items-center justify-between uppercase font-mono mt-1">
                    <span>{isRtl ? "المستخدمين" : "Users"}</span>
                  </div>

                  <NavButton
                    id="live-study-hall"
                    label={isRtl ? "قاعة الدراسة الحية" : "Live Study Hall"}
                    isPulse={true}
                    isActive={activeSubTab === "live-study-hall"}
                    onClick={setActiveSubTab}
                    isRtl={isRtl}
                  />

                  {currentUser.role === "owner" && (
                    <NavButton
                      id="user-role-management"
                      label={isRtl ? "إدارة صلاحيات الرتب" : "User Role Management"}
                      Icon={ShieldCheck}
                      iconColorClass="text-med-gold"
                      isActive={activeSubTab === "user-role-management"}
                      onClick={setActiveSubTab}
                      isRtl={isRtl}
                      extraClassName="mt-1"
                    />
                  )}
                </>
              )}

              {/* Category: Calendar */}
              {currentUser.role !== "admin" && (
                <>
                  <div className="font-display font-semibold text-caption text-neutral-500 dark:text-[#EBEBF599] px-2 py-1 flex items-center justify-between uppercase font-mono mt-4">
                    <span>{isRtl ? "التقويم" : "Calendar"}</span>
                  </div>

                  <NavButton
                    id="calendar"
                    label={isRtl ? "جدول الفعاليات والتقويم" : "Calendar Schedule"}
                    Icon={Calendar}
                    iconColorClass="text-rose-500"
                    isActive={activeSubTab === "calendar"}
                    onClick={setActiveSubTab}
                    isRtl={isRtl}
                  />
                </>
              )}

              {/* Category: Lecture */}
              <div
                className={`font-display font-semibold text-caption text-neutral-500 dark:text-[#EBEBF599] px-2 py-1 flex items-center justify-between uppercase font-mono ${
                  currentUser.role === "admin" ? "mt-1" : "mt-4"
                }`}
              >
                <span>{isRtl ? "المحاضرة" : "Lecture"}</span>
              </div>

              <NavButton
                id="lecture"
                label={isRtl ? "إدارة المحاضرات" : "Manage Lectures"}
                Icon={FolderPlus}
                iconColorClass="text-rose-500"
                isActive={activeSubTab === "lecture"}
                onClick={setActiveSubTab}
                isRtl={isRtl}
              />

              <NavButton
                id="pdf"
                label={isRtl ? "رفع ملفات PDF" : "PDFs"}
                Icon={FileText}
                iconColorClass="text-emerald-500"
                isActive={activeSubTab === "pdf"}
                onClick={setActiveSubTab}
                isRtl={isRtl}
              />

              <NavButton
                id="note"
                label={isRtl ? "رفع ملخصات Notes" : "Notes"}
                Icon={FileText}
                iconColorClass="text-teal-500"
                isActive={activeSubTab === "note"}
                onClick={setActiveSubTab}
                isRtl={isRtl}
              />

              <NavButton
                id="video"
                label={isRtl ? "ربط فيديو مرئي Video" : "Videos"}
                Icon={Video}
                iconColorClass="text-med-blue"
                isActive={activeSubTab === "video"}
                onClick={setActiveSubTab}
                isRtl={isRtl}
              />

              <NavButton
                id="mcq"
                label={isRtl ? "صياغة MCQ" : "MCQ"}
                Icon={HelpCircle}
                iconColorClass="text-purple-500"
                isActive={activeSubTab === "mcq"}
                onClick={setActiveSubTab}
                isRtl={isRtl}
              />

              <NavButton
                id="anki"
                label={isRtl ? "بطاقات تذكر (Anki)" : "Anki"}
                Icon={Layers}
                iconColorClass="text-indigo-500"
                isActive={activeSubTab === "anki"}
                onClick={setActiveSubTab}
                isRtl={isRtl}
              />

              {/* Category: Notifications */}
              {currentUser.role !== "admin" && (
                <>
                  <div className="font-display font-semibold text-caption text-neutral-500 dark:text-[#EBEBF599] px-2 py-1 flex items-center justify-between uppercase font-mono mt-4">
                    <span>{isRtl ? "الإشعارات" : "Notifications"}</span>
                  </div>

                  <NavButton
                    id="notifications"
                    label={isRtl ? "الرسائل وبث الإشعارات" : "Send Announcements"}
                    Icon={BellRing}
                    iconColorClass="text-rose-500"
                    isActive={activeSubTab === "notifications"}
                    onClick={setActiveSubTab}
                    isRtl={isRtl}
                  />
                </>
              )}

              {/* Category: Daily Motto */}
              {currentUser.role === "owner" && (
                <>
                  <div className="font-display font-semibold text-caption text-neutral-500 dark:text-[#EBEBF599] px-2 py-1 flex items-center justify-between uppercase font-mono mt-4">
                    <span>{isRtl ? "شعار اليوم" : "Daily Motto"}</span>
                  </div>

                  <NavButton
                    id="daily-motto"
                    label={isRtl ? "إدارة الشعار اليومي" : "Manage Daily Motto"}
                    Icon={Quote}
                    iconColorClass="text-indigo-500"
                    isActive={activeSubTab === "daily-motto"}
                    onClick={setActiveSubTab}
                    isRtl={isRtl}
                  />
                </>
              )}

              {/* Category: Moderation — owner only */}
              {currentUser.role === "owner" && (
                <>
                  <div className="font-display font-semibold text-caption text-neutral-500 dark:text-[#EBEBF599] px-2 py-1 flex items-center justify-between uppercase font-mono mt-4">
                    <span>{isRtl ? "الإشراف" : "Moderation"}</span>
                  </div>
                  <NavButton
                    id="moderation"
                    label={isRtl ? "المحتوى المُبلَّغ عنه" : "Reported Content"}
                    Icon={Flag}
                    iconColorClass="text-rose-500"
                    isActive={activeSubTab === "moderation"}
                    onClick={setActiveSubTab}
                    isRtl={isRtl}
                  />
                  <NavButton
                    id="muted-users"
                    label="Muted Users"
                    Icon={MicOff}
                    iconColorClass="text-amber-500"
                    isActive={activeSubTab === "muted-users"}
                    onClick={setActiveSubTab}
                    isRtl={isRtl}
                  />
                  <NavButton
                    id="banned-users"
                    label="Banned Users"
                    Icon={ShieldOff}
                    iconColorClass="text-neutral-500"
                    isActive={activeSubTab === "banned-users"}
                    onClick={setActiveSubTab}
                    isRtl={isRtl}
                  />
                  <NavButton
                    id="moderation-history"
                    label="Moderation History"
                    Icon={ClipboardList}
                    iconColorClass="text-violet-500"
                    isActive={activeSubTab === "moderation-history"}
                    onClick={setActiveSubTab}
                    isRtl={isRtl}
                  />
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right Main Content Panel */}
        <div className="flex-1 min-w-0 overflow-auto bg-white dark:bg-[#1C1C1E] border border-neutral-200/40 dark:border-white/[0.10] rounded-md p-4 shadow-elevation-0 min-h-[300px]">
          <Suspense fallback={<div className="animate-pulse h-32 rounded-lg bg-neutral-100 dark:bg-white/[0.05]" />}>
          {activeSubTab === "calendar" && (
            <div className="animate-fadeIn">
              <ManageCalendar
                language={language === "ar" ? "ar" : "en"}
                onEventCreated={handleRefreshSubjects}
                events={calendarEventsDb}
                onDeleteEvent={onDeleteEvent}
                onEditEvent={onEditEvent}
              />
            </div>
          )}

          {activeSubTab === "live-study-hall" && (
            <div className="space-y-4 animate-fadeIn">
              <div className="border-b border-neutral-100 dark:border-white/[0.12] pb-3 flex items-center gap-2 group relative">
                <h3 className="text-headline font-display font-semibold text-neutral-800 dark:text-white text-right md:text-left">
                  {isRtl
                    ? "قاعة الدراسة الحية عبر القنوات الحقيقية"
                    : "Live Study Hall Real-time Presence"}
                </h3>
                <HelpCircle className="w-icon-sm h-icon-sm text-neutral-500 dark:text-[#EBEBF599] cursor-help" />
                <div className="absolute top-full left-0 mt-2 w-64 p-2 bg-neutral-800/95 dark:bg-neutral-700/95 backdrop-blur-sm text-white text-xs rounded-lg shadow-elevation-3 opacity-0 pointer-events-none group-hover:opacity-80 transition-opacity z-50">
                  {isRtl
                    ? "قائمة بالطلبة والزملاء المتواجدين حالياً في المنصة بشكل مباشر."
                    : "Real-time list of current cohort representatives and students active on the portal."}
                </div>
              </div>
              <UserPresenceWidget
                isOwner={currentUser.role === "owner"}
                currentUserId={currentUser.id}
              />
            </div>
          )}

          {activeSubTab === "lecture" && (
            <div className="animate-fadeIn">
              <CreateLecture
                onLectureCreated={handleRefreshSubjects}
                language={language === "ar" ? "ar" : "en"}
              />
            </div>
          )}

          {activeSubTab === "pdf" && (
            <div className="animate-fadeIn">
              <UploadMaterial
                initialType="PDF"
                language={language === "ar" ? "ar" : "en"}
                onSuccess={handleRefreshSubjects}
              />
            </div>
          )}

          {activeSubTab === "note" && (
            <div className="animate-fadeIn">
              <UploadMaterial
                initialType="NOTE"
                language={language === "ar" ? "ar" : "en"}
                onSuccess={handleRefreshSubjects}
              />
            </div>
          )}

          {activeSubTab === "video" && (
            <div className="animate-fadeIn">
              <UploadMaterial
                initialType="VIDEO"
                language={language === "ar" ? "ar" : "en"}
                onSuccess={handleRefreshSubjects}
              />
            </div>
          )}

          {activeSubTab === "mcq" && (
            <div className="animate-fadeIn">
              <CreateMCQ
                language={language === "ar" ? "ar" : "en"}
                onSuccess={handleRefreshSubjects}
              />
            </div>
          )}

          {activeSubTab === "anki" && (
            <div className="animate-fadeIn">
              <CreateAnki
                language={language === "ar" ? "ar" : "en"}
              />
            </div>
          )}

          {activeSubTab === "notifications" && (
            <div className="animate-fadeIn">
              <SendNotification language={language === "ar" ? "ar" : "en"} />
            </div>
          )}

          {activeSubTab === "daily-motto" && currentUser.role === "owner" && (
            <div className="animate-fadeIn">
              <ManageDailyMotto language={language === "ar" ? "ar" : "en"} />
            </div>
          )}

          {activeSubTab === "user-role-management" &&
            currentUser.role === "owner" && (
              <div className="animate-fadeIn">
                <UserRoleManagement
                  currentUser={currentUser}
                  language={language === "ar" ? "ar" : "en"}
                />
              </div>
            )}

          {activeSubTab === "moderation" && currentUser.role === "owner" && (
            <div className="animate-fadeIn">
              <ModerationView language={language === "ar" ? "ar" : "en"} />
            </div>
          )}

          {activeSubTab === "muted-users" && currentUser.role === "owner" && (
            <div className="animate-fadeIn">
              <MutedUsersView />
            </div>
          )}

          {activeSubTab === "banned-users" && currentUser.role === "owner" && (
            <div className="animate-fadeIn">
              <BannedUsersView />
            </div>
          )}

          {activeSubTab === "moderation-history" && currentUser.role === "owner" && (
            <div className="animate-fadeIn">
              <ModerationHistoryView />
            </div>
          )}
          </Suspense>
        </div>
      </div>
    </div>
  );
};

export default memo(ControlCenterView);
