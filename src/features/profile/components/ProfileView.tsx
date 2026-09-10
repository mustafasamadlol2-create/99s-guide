import { getLectureProgressStats } from "../../../core/utils/progressUtils";
import { useSwipeBack } from "../../../core/hooks/useSwipeBack";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, memo } from "react";
import { createPortal } from "react-dom";
import { User, PointsLog, Subject, UserProgress } from "../../../core/types";
import { motion, AnimatePresence } from "motion/react";
import InteractiveAvatar from "./InteractiveAvatar";
import { SignaturePad } from "../../../components/ui/SignaturePad";
import { BlockedUsersView } from "../../moderation/components/BlockedUsersView";
import { MyReportsView } from "../../moderation/components/MyReportsView";
import {
 Award,
 LogOut,
 ShieldCheck,
 GraduationCap,
 Book,
 BarChart3,
 CircleCheck,
 ChevronRight,
 Save, Pencil,
 Crown,
  User as UserIcon,
  UserX,
  Flag,
  Settings,
} from "lucide-react";

interface ProfileViewProps {
  isActive?: boolean;
 user: User;
 pointsLog: PointsLog[];
 subjects: Subject[];
 progress: UserProgress[];
 onUpdateProfile: (name: string, email: string, avatar: string, studentGroup?: string, signature?: string) => void;
  onSignOut: () => void;
  dbLectures?: any[];
  showSettingsButton?: boolean;
  onOpenSettings?: () => void;
  language?: "en" | "ar";
  onSubViewChange?: (isOpen: boolean) => void;
}

const SettingsGroup = memo(({
  children,
  title,
  isRtl = false,
}: {
  children: React.ReactNode;
  title?: string;
  isRtl?: boolean;
}) => (
  <div className="mb-8 animate-fadeIn" dir={isRtl ? "rtl" : "ltr"}>
    {title && (
      <h2
        className={`text-[13px] uppercase tracking-wider font-semibold text-neutral-500 dark:text-[rgba(235,235,245,0.3)] mb-3 select-none ${
          isRtl ? "pr-4 text-right" : "pl-4 text-left"
        }`}
      >
        {title}
      </h2>
    )}
    <div className="bg-white/60 dark:bg-[#1C1C1E]/40 backdrop-blur-sm rounded-2xl overflow-hidden border border-neutral-200/50 dark:border-white/[0.06] shadow-sm">
      {children}
    </div>
  </div>
));
SettingsGroup.displayName = "SettingsGroup";

const handleSettingsItemKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    e.currentTarget.click();
  }
};

const SettingsItem = memo(({
  Icon,
  iconBg,
  title,
  value,
  subtitle,
  onClick,
  showChevron = false,
  isDestructive = false,
  customRight,
  isRtl = false,
}: {
  Icon: React.ElementType;
  iconBg?: string;
  title: string;
  value?: React.ReactNode;
  subtitle?: string;
  onClick?: () => void;
  showChevron?: boolean;
  isDestructive?: boolean;
  customRight?: React.ReactNode;
  isRtl?: boolean;
}) => {
  const innerContent = (
    <div
      dir={isRtl ? "rtl" : "ltr"}
      className={`flex items-center gap-4 p-4 relative transition duration-300 hover:bg-neutral-50/80 dark:hover:bg-white/[0.04] z-0 hover:z-10 ${
        onClick ? "cursor-pointer" : ""
      } ${
        isRtl
          ? "after:content-[''] after:absolute after:bottom-0 after:right-14 after:left-4 after:h-[1px] after:bg-neutral-100 dark:after:bg-neutral-800/50 last:after:hidden"
          : "after:content-[''] after:absolute after:bottom-0 after:left-14 after:right-4 after:h-[1px] after:bg-neutral-100 dark:after:bg-neutral-800/50 last:after:hidden"
      }`}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? handleSettingsItemKeyDown : undefined}
      onClick={onClick}
    >
      <div
        className={`w-[32px] h-[32px] rounded-[10px] flex items-center justify-center shrink-0 text-white ${
          iconBg || "bg-blue-500"
        } shadow-sm`}
      >
        <Icon className="w-[18px] h-[18px]" />
      </div>
      <div className={`flex-1 flex flex-col justify-center min-w-0 py-0.5 ${isRtl ? "text-right" : "text-left"}`}>
        <span
          className={`text-[15px] font-medium tracking-tight truncate ${
            isDestructive ? "text-red-500" : "text-neutral-800 dark:text-white"
          }`}
        >
          {title}
        </span>
        {subtitle && (
          <span className="text-[13px] text-neutral-500 dark:text-[#EBEBF599] truncate mt-0.5">
            {subtitle}
          </span>
        )}
      </div>
      {customRight ? (
        <div className="shrink-0 flex items-center" dir="ltr">{customRight}</div>
      ) : (
        value && (
          <div
            className="text-[15px] font-medium shrink-0 truncate max-w-[120px] sm:max-w-[200px] text-neutral-500 dark:text-[rgba(235,235,245,0.3)]"
          >
            {value}
          </div>
        )
      )}
      {showChevron && onClick && (
        <ChevronRight
          className="w-4 h-4 text-neutral-500 dark:text-[rgba(235,235,245,0.3)] shrink-0"
          style={{ transform: isRtl ? "rotate(180deg)" : "none" }}
        />
      )}
    </div>
  );

  if (onClick) {
    return (
      <motion.div
        whileTap={{ scale: 0.99, backgroundColor: "rgba(0,0,0,0.02)" }}
        whileHover={{ backgroundColor: "rgba(0,0,0,0.01)" }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        {innerContent}
      </motion.div>
    );
  }

  return innerContent;
});
SettingsItem.displayName = "SettingsItem";

export const ProfileView = function ProfileView({
 user,
 pointsLog,
 subjects,
 progress,
 onUpdateProfile,
 onSignOut,
 dbLectures,
 showSettingsButton = false,
 onOpenSettings,
 isActive = false,
 language = "en",
 onSubViewChange,
}: ProfileViewProps) {
 const isRtl = language === "ar";
 const tr = useCallback((english: string, arabic: string) => (isRtl ? arabic : english), [isRtl]);

 // Profile sub-pages are true viewport overlays. The Profile page underneath
 // never changes position, never leaves normal document flow, and — most
 // importantly — the shared main scroll canvas is never reset to 0. This is
 // the native-stack invariant that removes the post-Back vertical jump: the
 // page revealed during the swipe is literally the same already-painted page
 // that remains after the swipe completes.
 const [subView, setSubView] = useState<"blocked-users" | "my-reports" | null>(null);

 const openProfileSubView = useCallback((next: "blocked-users" | "my-reports") => {
   onSubViewChange?.(true);
   setSubView(next);
 }, [onSubViewChange]);

 const closeProfileSubView = useCallback(() => {
   setSubView(null);
   onSubViewChange?.(false);
 }, [onSubViewChange]);

 const profileBackGesture = useSwipeBack({
   isEnabled: Boolean(isActive && subView),
   direction: language === "ar" ? "rtl" : "ltr",
   surfaceSelector: '[data-profile-subview-swipe-surface="true"]',
   allowedStartSelector: '[data-profile-subview-swipe-surface="true"]',
   onSwipeBack: closeProfileSubView,
 });

 useEffect(() => () => {
   onSubViewChange?.(false);
 }, [onSubViewChange]);

 // Edit fields profile
 const [isEditing, setIsEditing] = useState(false);
 const [editName, setEditName] = useState(user.name);
 const [editEmail, setEditEmail] = useState((user as any).profileEmail || user.email);
 const [editAvatar, setEditAvatar] = useState(user.avatar);
 const [editGroup, setEditGroup] = useState(user.studentGroup || "A");
 const [editSignature, setEditSignature] = useState(user.signature || "");
 const [isSigning, setIsSigning] = useState(false);

 // Keep the compact profile label tied to the user's Academic Group (A-E),
 // not the fixed Batch value. Normalize defensively in case persisted data
 // ever contains a prefixed value such as "Group D".
 const academicGroupLabel = useMemo(() => {
   const rawGroup = String(user.studentGroup || "A").trim();
   return rawGroup.replace(/^Group\s+/i, "").toUpperCase() || "A";
 }, [user.studentGroup]);


 // Synchronize local edit states
 useEffect(() => {
   if (!isEditing) {
     setEditName(user.name);
     setEditEmail((user as any).profileEmail || user.email);
     setEditAvatar(user.avatar);
     setEditGroup(user.studentGroup || "A");
     setEditSignature(user.signature || "");
   }
 }, [isEditing, user.avatar, user.name, user.email, (user as any).profileEmail, user.studentGroup, user.signature]);

 const handleSaveProfile = useCallback(() => {
   onUpdateProfile(editName, editEmail, editAvatar, editGroup, editSignature);
   setIsEditing(false);
 }, [onUpdateProfile, editName, editEmail, editAvatar, editGroup, editSignature]);

 const startEditing = useCallback(() => setIsEditing(true), []);
 const cancelEditing = useCallback(() => setIsEditing(false), []);

 const handleAvatarChange = useCallback((base64: string) => {
   if (isEditing) setEditAvatar(base64);
   else onUpdateProfile(user.name, user.email, base64);
 }, [isEditing, onUpdateProfile, user.name, user.email]);

 const handleAvatarRemove = useCallback(() => {
   if (isEditing) {
     setEditAvatar("");
     return;
   }
   onUpdateProfile(user.name, user.email, "");
 }, [isEditing, onUpdateProfile, user.name, user.email]);

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => setEditName(e.target.value), []);
  const handleGroupChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => setEditGroup(e.target.value), []);

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveProfile();
      e.currentTarget.blur();
    }
  }, [handleSaveProfile]);

 const { totalLecturesCount, completedLecturesCount, overallCompletionPercentage } = useMemo(() => {
  if (dbLectures && dbLectures.length > 0) {
    return getLectureProgressStats(dbLectures, progress);
  }
  // Fallback if dbLectures is not provided
  let total = 0;
  let completed = 0;
  const progressMap = new Map<string, UserProgress>();
  for (let i = 0; i < progress.length; i++) {
    progressMap.set(progress[i].lectureId, progress[i]);
  }
  
  for (let i = 0; i < subjects.length; i++) {
    const subj = subjects[i];
    for (let j = 0; j < subj.modules.length; j++) {
      const m = subj.modules[j];
      total += m.lectures.length;
      for (let k = 0; k < m.lectures.length; k++) {
        const p = progressMap.get(m.lectures[k].id);
        if (p !== undefined && p.pdfCompleted && p.quizCompleted) {
          completed++;
        }
      }
    }
  }
  
  return {
    totalLecturesCount: total,
    completedLecturesCount: completed,
    overallCompletionPercentage: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
 }, [subjects, progress, dbLectures]);

  const profileRoot = (
    <div
      className="profile-view-root w-full max-w-2xl mx-auto pb-24 pt-6 px-4 sm:px-6 animate-fadeIn"
      dir={isRtl ? "rtl" : "ltr"}
    >
      {/* Large Profile Header (Apple ID Style) */}
      <div className="flex flex-col items-center mb-10 relative">
        <InteractiveAvatar
          avatarUrl={isEditing ? editAvatar : user.avatar}
          name={isEditing ? editName : user.name}
          onAvatarChange={handleAvatarChange}
          onAvatarRemove={handleAvatarRemove}
          isEditable={true}
        />

        {!isEditing ? (
          <AnimatePresence>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center mt-5"
            >
              <h1 className="text-[24px] tracking-tight font-semibold text-neutral-900 dark:text-white flex items-center justify-center gap-2">
                {user.name}
                {user.role === 'owner' ? (
                  <Crown className="w-5 h-5 text-amber-500 drop-shadow-sm" />
                ) : user.role === 'admin' ? (
                  <ShieldCheck className="w-5 h-5 text-blue-500 drop-shadow-sm" />
                ) : (
                  <UserIcon className="w-5 h-5 text-neutral-500 drop-shadow-sm" />
                )}
              </h1>
              <p
                className="text-[15px] text-neutral-500 dark:text-[#EBEBF599] mt-1 font-medium"
                aria-label={tr(`Academic Group ${academicGroupLabel}`, `المجموعة الدراسية ${academicGroupLabel}`)}
              >
                {academicGroupLabel}
              </p>
              <p className="text-[14px] text-neutral-500 dark:text-[rgba(235,235,245,0.3)] mt-0.5 font-mono">
                {(user as any).profileEmail || user.email}
              </p>

              <button
                onClick={startEditing}
                 className="mt-6 min-h-11 flex items-center gap-1.5 text-[14px] text-blue-500 dark:text-blue-400 font-medium bg-blue-500/10 hover:bg-blue-500/20 px-5 py-2.5 rounded-full transition duration-300"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>{tr("Edit Profile", "تعديل الملف الشخصي")}</span>
              </button>
            </motion.div>
          </AnimatePresence>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-[320px] mt-8 space-y-4"
          >
            <div className={`space-y-1.5 ${isRtl ? "text-right" : "text-left"}`}>
              <label className={`text-[13px] font-semibold text-neutral-500 dark:text-[#EBEBF599] uppercase tracking-wider ${isRtl ? "mr-1" : "ml-1"}`}>
                {tr("Full Name", "الاسم الكامل")}
              </label>
              <input aria-label="Input field"
                value={editName}
                onChange={handleNameChange}
                onKeyDown={handleNameKeyDown}
                autoCapitalize="words"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
                className="w-full bg-white/60 dark:bg-[#1C1C1E]/40 backdrop-blur-sm border border-neutral-200/50 dark:border-white/[0.06] rounded-2xl px-4 py-3.5 text-[15px] font-medium text-neutral-900 dark:text-white outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950 focus:border-blue-500/50 transition shadow-sm"
              />
            </div>
            <div className={`space-y-1.5 ${isRtl ? "text-right" : "text-left"}`}>
              <label className={`text-[13px] font-semibold text-neutral-500 dark:text-[#EBEBF599] uppercase tracking-wider ${isRtl ? "mr-1" : "ml-1"}`}>
                {tr("Academic Group", "المجموعة الدراسية")}
              </label>
              <select
                value={editGroup}
                onChange={handleGroupChange}
                className="w-full bg-white/60 dark:bg-[#1C1C1E]/40 backdrop-blur-sm border border-neutral-200/50 dark:border-white/[0.06] rounded-2xl px-4 py-3.5 text-[15px] font-medium text-neutral-900 dark:text-white outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950 focus:border-blue-500/50 transition shadow-sm appearance-none cursor-pointer"
              >
                <option value="A">{tr("Group A", "المجموعة A")}</option>
                <option value="B">{tr("Group B", "المجموعة B")}</option>
                <option value="C">{tr("Group C", "المجموعة C")}</option>
                <option value="D">{tr("Group D", "المجموعة D")}</option>
                <option value="E">{tr("Group E", "المجموعة E")}</option>
              </select>
            </div>
            
            <div className="space-y-1.5 text-left">
              <label
                className="text-[13px] ml-1 font-semibold text-neutral-500 dark:text-[#EBEBF599] uppercase tracking-wider flex justify-between items-center text-left"
                dir="ltr"
              >
                {/* Explicit product requirement: in Arabic the Signature label
                    remains on the LEFT, even though the rest of Profile is RTL. */}
                <span dir={isRtl ? "rtl" : "ltr"}>{tr("Signature", "التوقيع")}</span>
                {editSignature && !isSigning && (
                  <button onClick={() => setIsSigning(true)} className="text-blue-500 text-xs normal-case" dir={isRtl ? "rtl" : "ltr"}>
                    {tr("Redraw", "إعادة الرسم")}
                  </button>
                )}
              </label>
              
              {isSigning || !editSignature ? (
                <SignaturePad 
                  initialSignature={editSignature}
                  onSave={(dataUrl) => {
                    setEditSignature(dataUrl);
                    setIsSigning(false);
                  }}
                  onCancel={() => setIsSigning(false)}
                />
              ) : (
                <div 
                  className="w-full h-24 sm:h-32 border border-neutral-200/50 dark:border-white/[0.06] rounded-2xl bg-white/60 dark:bg-[#1C1C1E]/40 backdrop-blur-sm flex items-center justify-center p-2 cursor-pointer hover:bg-neutral-50 dark:hover:bg-white/[0.06] transition"
                  onClick={() => setIsSigning(true)}
                >
                  <img src={editSignature} alt={tr("Signature", "التوقيع")} className="max-h-full max-w-full object-contain dark:invert" />
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-3">
              <button
                onClick={cancelEditing}
                className="flex-1 py-3.5 rounded-2xl border border-neutral-200/50 dark:border-white/[0.06] bg-white/60 dark:bg-[#1C1C1E]/40 backdrop-blur-sm text-neutral-700 dark:text-[#EBEBF599] font-medium text-[15px] hover:bg-neutral-50 dark:hover:bg-white/[0.06] transition-colors shadow-sm"
              >
                {tr("Cancel", "إلغاء")}
              </button>
              <button
                onClick={handleSaveProfile}
                className="flex-1 py-3.5 rounded-2xl bg-blue-500 text-white font-medium text-[15px] flex items-center justify-center gap-2 shadow-md hover:bg-blue-600 hover:shadow-lg hover:-translate-y-0.5 transition"
              >
                <Save className="w-4 h-4" /> {tr("Save", "حفظ")}
              </button>
            </div>
          </motion.div>
        )}
      </div>

 {!isEditing && (
 <>
 {/* Academic Information */}
 <SettingsGroup title={tr("Academic Information", "المعلومات الأكاديمية")} isRtl={isRtl}>
 <SettingsItem Icon={GraduationCap}
 iconBg="bg-indigo-500"
 title={tr("Institution", "الجامعة")}
 value={tr("Baghdad University", "جامعة بغداد")}
 
 isRtl={isRtl}
 />
 <SettingsItem Icon={Book}
 iconBg="bg-med-blue"
 title={tr("College", "الكلية")}
 value={tr("College of Medicine", "كلية الطب")}
 
 isRtl={isRtl}
 />
 <SettingsItem Icon={Award}
 iconBg="bg-med-gold"
 title={tr("Batch", "الدفعة")}
 value="99"
 
 isRtl={isRtl}
 />
 <SettingsItem Icon={UserIcon}
 iconBg="bg-blue-500"
 title={tr("Academic Group", "المجموعة الدراسية")}
 value={tr(`Group ${academicGroupLabel}`, `المجموعة ${academicGroupLabel}`)}
 
 isRtl={isRtl}
 />
  </SettingsGroup>

  {showSettingsButton && (
    <SettingsGroup title={tr("General", "عام")} isRtl={isRtl}>
      <SettingsItem
        Icon={Settings}
        iconBg="bg-slate-500"
        title={tr("Settings", "الإعدادات")}
        showChevron
        onClick={onOpenSettings}
      
 isRtl={isRtl}
 />
    </SettingsGroup>
  )}

  {/* Academic Progress */}
 <SettingsGroup title={tr("Academic Progress", "التقدم الأكاديمي")} isRtl={isRtl}>
          <SettingsItem Icon={BarChart3}
            iconBg="bg-emerald-500"
            title={tr("Overall Progress", "التقدم العام")}
            customRight={
              <div className="flex items-center gap-3">
                <span className="text-[15px] font-medium text-neutral-500 font-mono">
                  {overallCompletionPercentage}%
                </span>
                <div className="relative w-[32px] h-[32px] flex items-center justify-center group">
                  <svg
                    className="w-full h-full -rotate-90 transform"
                    viewBox="0 0 36 36"
                  >
                    <defs>
                      <linearGradient id="overall-progress-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" className="stop-color-emerald-400 dark:stop-color-emerald-300" style={{stopColor: 'rgb(52, 211, 153)'}} />
                        <stop offset="100%" className="stop-color-emerald-600 dark:stop-color-emerald-500" style={{stopColor: 'rgb(5, 150, 105)'}} />
                      </linearGradient>
                    </defs>
                    <circle
                      cx="18"
                      cy="18"
                      r="14"
                      fill="none"
                      className="stroke-neutral-200/80 dark:stroke-neutral-800/80 transition-colors group-hover:stroke-neutral-300 dark:group-hover:stroke-neutral-700"
                      strokeWidth="4"
                    />
                    <motion.circle
                      cx="18"
                      cy="18"
                      r="14"
                      fill="none"
                      stroke="url(#overall-progress-gradient)"
                      className="drop-shadow-[0_0_2px_rgba(52,211,153,0.3)] dark:drop-shadow-[0_0_3px_rgba(52,211,153,0.4)]"
                      strokeWidth="4"
                      strokeDasharray="88"
                      initial={{ strokeDashoffset: 88 }}
                      animate={{ strokeDashoffset: 88 - (88 * overallCompletionPercentage) / 100 }}
                      transition={{ duration: 1.2, ease: [0.25, 0.1, 0.25, 1] }}
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
              </div>
            }
            isRtl={isRtl}
          />
          <SettingsItem Icon={CircleCheck}
            iconBg="bg-teal-500"
            title={tr("Lectures Completed", "المحاضرات المكتملة")}
            customRight={
              <div className="flex items-center gap-3">
                <span className="text-[15px] font-medium text-neutral-500 font-mono">
                  {completedLecturesCount} <span className="text-neutral-500 dark:text-neutral-600">/</span> {totalLecturesCount}
                </span>
                <div className="relative w-[32px] h-[32px] flex items-center justify-center group">
                  <svg
                    className="w-full h-full -rotate-90 transform"
                    viewBox="0 0 36 36"
                  >
                    <defs>
                      <linearGradient id="completed-progress-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style={{stopColor: 'rgb(45, 212, 191)'}} />
                        <stop offset="100%" style={{stopColor: 'rgb(13, 148, 136)'}} />
                      </linearGradient>
                    </defs>
                    <circle
                      cx="18"
                      cy="18"
                      r="14"
                      fill="none"
                      className="stroke-neutral-200/80 dark:stroke-neutral-800/80 transition-colors group-hover:stroke-neutral-300 dark:group-hover:stroke-neutral-700"
                      strokeWidth="4"
                    />
                    <motion.circle
                      cx="18"
                      cy="18"
                      r="14"
                      fill="none"
                      stroke="url(#completed-progress-gradient)"
                      className="drop-shadow-[0_0_2px_rgba(45,212,191,0.3)] dark:drop-shadow-[0_0_3px_rgba(45,212,191,0.4)]"
                      strokeWidth="4"
                      strokeDasharray="88"
                      initial={{ strokeDashoffset: 88 }}
                      animate={{ strokeDashoffset: totalLecturesCount > 0 ? 88 - (88 * completedLecturesCount) / totalLecturesCount : 88 }}
                      transition={{ duration: 1.2, ease: [0.25, 0.1, 0.25, 1], delay: 0.1 }}
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
              </div>
            }
            isRtl={isRtl}
          />
 </SettingsGroup>

        {/* Privacy & Safety */}
        <SettingsGroup title={tr("Privacy & Safety", "الخصوصية والأمان")} isRtl={isRtl}>
          <SettingsItem
            Icon={UserX}
            iconBg="bg-orange-500"
            title={tr("Blocked Users", "المستخدمون المحظورون")}
            showChevron
            onClick={() => openProfileSubView("blocked-users")}
          
 isRtl={isRtl}
 />
          <SettingsItem
            Icon={Flag}
            iconBg="bg-rose-500"
            title={tr("My Reports", "بلاغاتي")}
            showChevron
            onClick={() => openProfileSubView("my-reports")}
          
 isRtl={isRtl}
 />
        </SettingsGroup>

        {/* Actions */}
        <motion.button
          onClick={onSignOut}
          whileTap={{ scale: 0.98 }}
          className="w-full flex items-center justify-between p-4 mb-8 bg-white/60 dark:bg-[#1C1C1E]/40 backdrop-blur-sm border border-red-100/50 dark:border-red-900/20 rounded-2xl shadow-sm hover:shadow-md hover:bg-red-50/50 dark:hover:bg-red-900/10 transition duration-300 group"
        >
          <div className="flex items-center gap-4">
            <div className="w-[32px] h-[32px] rounded-[10px] bg-red-100 dark:bg-red-500/20 text-red-500 flex items-center justify-center group-hover:scale-105 group-hover:bg-red-500 group-hover:text-white transition duration-300 shadow-sm">
              <LogOut className="w-[16px] h-[16px] ml-0.5" />
            </div>
            <span className="text-[15px] font-semibold tracking-tight text-red-500">
              {tr("Sign Out", "تسجيل الخروج")}
            </span>
          </div>
          <ChevronRight
            className="w-4 h-4 text-red-300 dark:text-red-500/50 group-hover:text-red-500 dark:group-hover:text-red-400 transition-colors duration-300"
            style={{ transform: isRtl ? "rotate(180deg)" : "none" }}
          />
        </motion.button>

        <div className="flex justify-center items-center mt-12 mb-8">
          <p className="text-[10px] font-mono tracking-widest uppercase text-neutral-500/40 dark:text-[rgba(235,235,245,0.3)]/30 select-none">
            {tr("99's Guide • Version 1.0.0", "دليل 99 • الإصدار 1.0.0")}
          </p>
        </div>
 </>
 )}
 </div>
 );

 return (
   <div
     className="relative w-full min-h-full overflow-x-hidden bg-neutral-50 dark:bg-[#000000]"
     dir={isRtl ? "rtl" : "ltr"}
   >
     <div
       aria-hidden={subView !== null || undefined}
       className="relative z-0 w-full min-h-full bg-neutral-50 dark:bg-[#000000]"
       style={{ pointerEvents: subView !== null ? "none" : "auto" }}
     >
       {profileRoot}
     </div>

     {subView !== null && typeof document !== "undefined" && createPortal(
       <motion.div
         key={`profile-subview-${subView}`}
         data-profile-subview-swipe-surface="true"
         data-swipe-back-surface="true"
         className="fixed inset-0 z-40 w-full overflow-y-auto overflow-x-hidden overscroll-y-contain ios-scrollable isolate bg-neutral-50 dark:bg-[#000000]"
         dir={isRtl ? "rtl" : "ltr"}
         style={{
           x: profileBackGesture.x,
           paddingTop: "env(safe-area-inset-top, 0px)",
           paddingBottom: "calc(82px + env(safe-area-inset-bottom, 0px))",
           boxShadow: profileBackGesture.isInteracting
             ? (language === "ar"
                 ? "18px 0 30px -18px rgba(0,0,0,0.48)"
                 : "-18px 0 30px -18px rgba(0,0,0,0.48)")
             : "none",
           // The pushed page owns a single compositor layer for its complete
           // lifetime; the Profile underneath is never transformed or rebuilt.
           willChange: "transform",
           WebkitBackfaceVisibility: "hidden",
           backfaceVisibility: "hidden",
           touchAction: "pan-y",
         }}
       >
         {subView === "blocked-users" ? (
           <BlockedUsersView onBack={profileBackGesture.triggerBack} />
         ) : (
           <MyReportsView onBack={profileBackGesture.triggerBack} />
         )}
       </motion.div>,
       document.body,
     )}
   </div>
 );
};

export default memo(ProfileView);
