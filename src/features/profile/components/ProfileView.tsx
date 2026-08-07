import { getLectureProgressStats } from "../../../core/utils/progressUtils";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, memo } from "react";
import { User, PointsLog, Subject, UserProgress } from "../../../core/types";
import { motion, AnimatePresence } from "motion/react";
import InteractiveAvatar from "./InteractiveAvatar";
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
} from "lucide-react";

interface ProfileViewProps {
  isActive?: boolean;
 user: User;
 pointsLog: PointsLog[];
 subjects: Subject[];
 progress: UserProgress[];
 onUpdateProfile: (name: string, email: string, avatar: string, studentGroup?: string) => void;
 onSignOut: () => void;
 dbLectures?: any[];
}

const SettingsGroup = memo(({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) => (
  <div className="mb-8 animate-fadeIn">
    {title && (
      <h2 className="text-[13px] uppercase tracking-wider font-semibold text-neutral-500 dark:text-[rgba(235,235,245,0.3)] pl-4 mb-3 select-none">
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
}) => {
  const innerContent = (
    <div
      className={`flex items-center p-4 relative transition duration-300 hover:bg-neutral-50/80 dark:hover:bg-white/[0.04] z-0 hover:z-10 ${
        onClick ? "cursor-pointer" : ""
      } after:content-[''] after:absolute after:bottom-0 after:left-14 after:right-4 after:h-[1px] after:bg-neutral-100 dark:after:bg-neutral-800/50 last:after:hidden`}
      role="button" tabIndex={0} onKeyDown={handleSettingsItemKeyDown} onClick={onClick}
    >
      <div
        className={`w-[32px] h-[32px] rounded-[10px] flex items-center justify-center shrink-0 mr-4 text-white ${
          iconBg || "bg-blue-500"
        } shadow-sm`}
      >
        <Icon className="w-[18px] h-[18px]" />
      </div>
      <div className="flex-1 flex flex-col justify-center min-w-0 py-0.5">
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
        <div className="ml-3 shrink-0 flex items-center">{customRight}</div>
      ) : (
        value && (
          <div
            className={`text-[15px] font-medium mr-1 shrink-0 truncate max-w-[120px] sm:max-w-[200px] text-neutral-500 dark:text-[rgba(235,235,245,0.3)]`}
          >
            {value}
          </div>
        )
      )}
      {showChevron && onClick && (
        <ChevronRight className="w-4 h-4 ml-1 text-neutral-500 dark:text-[rgba(235,235,245,0.3)] shrink-0" />
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
}: ProfileViewProps) {
 // Sub-view navigation
 const [subView, setSubView] = useState<"blocked-users" | "my-reports" | null>(null);

 // Edit fields profile
 const [isEditing, setIsEditing] = useState(false);
 const [editName, setEditName] = useState(user.name);
 const [editEmail, setEditEmail] = useState(user.email);
 const [editAvatar, setEditAvatar] = useState(user.avatar);
  const [editGroup, setEditGroup] = useState(user.studentGroup || "A");

 // Synchronize local edit states
 useEffect(() => {
   if (!isEditing) {
     setEditName(user.name);
     setEditEmail(user.email);
     setEditAvatar(user.avatar);
     setEditGroup(user.studentGroup || "A");
   }
 }, [isEditing, user.avatar, user.name, user.email, user.studentGroup]);

 const handleSaveProfile = useCallback(() => {
   onUpdateProfile(editName, editEmail, editAvatar, editGroup);
   setIsEditing(false);
 }, [onUpdateProfile, editName, editEmail, editAvatar, editGroup]);

 const startEditing = useCallback(() => setIsEditing(true), []);
 const cancelEditing = useCallback(() => setIsEditing(false), []);

 const handleAvatarChange = useCallback((base64: string) => {
   if (isEditing) setEditAvatar(base64);
   else onUpdateProfile(user.name, user.email, base64);
 }, [isEditing, onUpdateProfile, user.name, user.email]);

 const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => setEditName(e.target.value), []);
 const handleGroupChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => setEditGroup(e.target.value), []);

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

  // Render sub-views
  if (subView === "blocked-users") {
    return <BlockedUsersView onBack={() => setSubView(null)} />;
  }
  if (subView === "my-reports") {
    return <MyReportsView onBack={() => setSubView(null)} />;
  }

  return (
    <div className="w-full max-w-2xl mx-auto pb-24 pt-6 px-4 sm:px-6 animate-fadeIn">
      {/* Large Profile Header (Apple ID Style) */}
      <div className="flex flex-col items-center mb-10 relative">
        <InteractiveAvatar
          avatarUrl={isEditing ? editAvatar : user.avatar}
          name={isEditing ? editName : user.name}
          onAvatarChange={handleAvatarChange}
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
              <p className="text-[15px] text-neutral-500 dark:text-[#EBEBF599] mt-1 font-medium">
                Medical Student
              </p>
              <p className="text-[14px] text-neutral-500 dark:text-[rgba(235,235,245,0.3)] mt-0.5 font-mono">
                {user.email}
              </p>

              <button
                onClick={startEditing}
                 className="mt-6 min-h-11 flex items-center gap-1.5 text-[14px] text-blue-500 dark:text-blue-400 font-medium bg-blue-500/10 hover:bg-blue-500/20 px-5 py-2.5 rounded-full transition duration-300"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>Edit Profile</span>
              </button>
            </motion.div>
          </AnimatePresence>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-[320px] mt-8 space-y-4"
          >
            <div className="space-y-1.5 text-left">
              <label className="text-[13px] ml-1 font-semibold text-neutral-500 dark:text-[#EBEBF599] uppercase tracking-wider">
                Full Name
              </label>
              <input aria-label="Input field"
                value={editName}
                onChange={handleNameChange}
                className="w-full bg-white/60 dark:bg-[#1C1C1E]/40 backdrop-blur-sm border border-neutral-200/50 dark:border-white/[0.06] rounded-2xl px-4 py-3.5 text-[15px] font-medium text-neutral-900 dark:text-white outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950 focus:border-blue-500/50 transition shadow-sm"
              />
            </div>
            <div className="space-y-1.5 text-left">
              <label className="text-[13px] ml-1 font-semibold text-neutral-500 dark:text-[#EBEBF599] uppercase tracking-wider">
                Academic Group
              </label>
              <select
                value={editGroup}
                onChange={handleGroupChange}
                className="w-full bg-white/60 dark:bg-[#1C1C1E]/40 backdrop-blur-sm border border-neutral-200/50 dark:border-white/[0.06] rounded-2xl px-4 py-3.5 text-[15px] font-medium text-neutral-900 dark:text-white outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950 focus:border-blue-500/50 transition shadow-sm appearance-none cursor-pointer"
              >
                <option value="A">Group A</option>
                <option value="B">Group B</option>
                <option value="C">Group C</option>
                <option value="D">Group D</option>
              </select>
            </div>
            <div className="flex gap-3 pt-3">
              <button
                onClick={cancelEditing}
                className="flex-1 py-3.5 rounded-2xl border border-neutral-200/50 dark:border-white/[0.06] bg-white/60 dark:bg-[#1C1C1E]/40 backdrop-blur-sm text-neutral-700 dark:text-[#EBEBF599] font-medium text-[15px] hover:bg-neutral-50 dark:hover:bg-white/[0.06] transition-colors shadow-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveProfile}
                className="flex-1 py-3.5 rounded-2xl bg-blue-500 text-white font-medium text-[15px] flex items-center justify-center gap-2 shadow-md hover:bg-blue-600 hover:shadow-lg hover:-translate-y-0.5 transition"
              >
                <Save className="w-4 h-4" /> Save
              </button>
            </div>
          </motion.div>
        )}
      </div>

 {!isEditing && (
 <>
 {/* Academic Information */}
 <SettingsGroup title="Academic Information">
 <SettingsItem Icon={GraduationCap}
 iconBg="bg-indigo-500"
 title="Institution"
 value="Medical University"
 />
 <SettingsItem Icon={Book}
 iconBg="bg-med-blue"
 title="College"
 value="College of Medicine"
 />
 <SettingsItem Icon={Award}
 iconBg="bg-med-gold"
 title="Batch"
 value="Medical Student"
 />
 <SettingsItem Icon={UserIcon}
 iconBg="bg-blue-500"
 title="Academic Group"
 value={`Group ${user.studentGroup || "A"}`}
 />
 </SettingsGroup>

 {/* Academic Progress */}
 <SettingsGroup title="Academic Progress">
          <SettingsItem Icon={BarChart3}
            iconBg="bg-emerald-500"
            title="Overall Progress"
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
          />
          <SettingsItem Icon={CircleCheck}
            iconBg="bg-teal-500"
            title="Lectures Completed"
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
          />
 </SettingsGroup>

        {/* Privacy & Safety */}
        <SettingsGroup title="Privacy & Safety">
          <SettingsItem
            Icon={UserX}
            iconBg="bg-orange-500"
            title="Blocked Users"
            showChevron
            onClick={() => setSubView("blocked-users")}
          />
          <SettingsItem
            Icon={Flag}
            iconBg="bg-rose-500"
            title="My Reports"
            showChevron
            onClick={() => setSubView("my-reports")}
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
              Sign Out
            </span>
          </div>
          <ChevronRight className="w-4 h-4 text-red-300 dark:text-red-500/50 group-hover:text-red-500 dark:group-hover:text-red-400 transition-colors duration-300" />
        </motion.button>

        <div className="flex justify-center items-center mt-12 mb-8">
          <p className="text-[10px] font-mono tracking-widest uppercase text-neutral-500/40 dark:text-[rgba(235,235,245,0.3)]/30 select-none">
            99's Guide • Version 1.0.0
          </p>
        </div>
 </>
 )}
 </div>
 );
};

export default memo(ProfileView);
