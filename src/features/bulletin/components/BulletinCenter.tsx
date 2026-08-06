/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef, useCallback, useLayoutEffect, Suspense, memo, lazy } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
 BellRing,
 PartyPopper,
 Search,
 BookOpenText,
 ClipboardCheck,
 FileText,
 BellDot,
 GraduationCap,


 Trash2,
 Check,
 Pin,
 Share2,
 Archive,
 ChevronRight,
 X,
 Inbox,
 RotateCcw,
 Sparkles,
} from "lucide-react";
import { AppNotification } from "../../../App";
import { Subject, Lecture } from "../../../core/types";
import { nativeAlert } from "../../../core/device/alert";

interface BulletinCenterProps {
  isActive?: boolean;
 notifications: AppNotification[];
 onMarkRead: (id: string) => void;
 onMarkUnread: (id: string) => void;
 onMarkAllRead: () => void;
 onClearAll: () => void;
 onDeleteNotification: (id: string) => void;
 language: "en" | "ar";
 subjects: Subject[];
 onNavigateToLecture: (lecture: Lecture) => void;
 onNavigateToTab: (tab: string) => void;
}

export const BulletinCenter = function BulletinCenter({
 notifications,
 onMarkRead,
 onMarkUnread,
 onMarkAllRead,
 onClearAll,
 onDeleteNotification,
 language,
 subjects,
 onNavigateToLecture,
 onNavigateToTab,
}: BulletinCenterProps) {
 const isRtl = language === "ar";

 // States
 const [activeSegment, setActiveSegment] = useState<"all" | "unread">("all");
 const [selectedCategory, setSelectedCategory] = useState<
 "all" | "lecture" | "quiz" | "exam" | "announcement"
 >("all");

 // Find matching lecture from notification for deep-linking
 const findMatchingLecture = (notif: AppNotification): Lecture | null => {
 for (const sub of subjects) {
 for (const mod of sub.modules) {
 for (const lect of mod.lectures) {
 if (
 notif.title.toLowerCase().includes(lect.title.toLowerCase()) ||
 notif.desc.toLowerCase().includes(lect.title.toLowerCase()) ||
 (notif.titleAr && notif.titleAr.includes(lect.title))
 ) {
 return lect;
 }
 }
 }
 }
 return null;
 };

 // Helper date formatter
 const getRelativeTime = (dateStr: string) => {
 try {
 const date = new Date(dateStr);
 const now = new Date();
 const diffMs = now.getTime() - date.getTime();
 const diffSec = Math.floor(diffMs / 1000);
 const diffMin = Math.floor(diffSec / 60);
 const diffHour = Math.floor(diffMin / 60);
 const diffDay = Math.floor(diffHour / 24);

 if (diffSec < 60) {
 return isRtl ? "الآن" : "Just now";
 }
 if (diffMin < 60) {
 return isRtl ? `قبل ${diffMin} د` : `${diffMin}m ago`;
 }
 if (diffHour < 24) {
 return isRtl ? `قبل ${diffHour} ساعة` : `${diffHour}h ago`;
 }
 if (diffDay === 1) {
 return isRtl ? "بالأمس" : "Yesterday";
 }
 if (diffDay < 7) {
 return isRtl ? `قبل ${diffDay} أيام` : `${diffDay}d ago`;
 }
 return date.toLocaleDateString(isRtl ? "ar-EG" : "en-US", {
 month: "short",
 day: "numeric",
 });
 } catch (e) {
 return "";
 }
 };

 // Filter and Search Logic
 const filteredNotifications = useMemo(() => {
 return notifications.filter((notif) => {
 // 1. Segment filter
 if (activeSegment === "unread" && notif.read) return false;

 // 2. Category filter
 let effectiveType = notif.type;
 if (effectiveType === "system") effectiveType = "announcement";
 if (effectiveType === "achievement") effectiveType = "exam";
 if (effectiveType === "discussion") effectiveType = "announcement";

 if (selectedCategory !== "all" && effectiveType !== selectedCategory)
 return false;

 return true;
 });
 }, [notifications, activeSegment, selectedCategory]);

 const unreadCount = useMemo(() => {
 return notifications.filter((n) => !n.read).length;
 }, [notifications]);

 // Handlers
 const handleMarkItemReadState = (
 id: string,
 read: boolean,
 e?: React.MouseEvent,
 ) => {
 if (e) e.stopPropagation();
 if (read) {
 onMarkRead(id);
 } else {
 onMarkUnread(id);
 }
 };

 const handleDeleteItem = (id: string, e?: React.MouseEvent) => {
 if (e) e.stopPropagation();
 onDeleteNotification(id);
 };

 const handleShare = (notif: AppNotification) => {
 if (navigator.share) {
 navigator
 .share({
 title: isRtl ? notif.titleAr || notif.title : notif.title,
 text: isRtl ? notif.descAr || notif.desc : notif.desc,
 })
 .catch((err) => {});
 } else {
 nativeAlert(
 isRtl ? "تم النسخ" : "Copied",
 isRtl
 ? "تم نسخ رابط الإشعار إلى الحافظة"
 : "Notification details copied to clipboard!",
 );
 }
 };

 // Helper for Category icons and colors
 const getCategoryTheme = (notif: AppNotification) => {
  let type = notif.type;
  if (type === "system" || type === "announcement") {
    const textToSearch = (notif.title + " " + notif.desc).toLowerCase();
    if (textToSearch.includes("lecture") || textToSearch.includes("محاضرة")) type = "lecture";
    else if (textToSearch.includes("quiz") || textToSearch.includes("اختبار")) type = "quiz";
    else if (textToSearch.includes("exam") || textToSearch.includes("امتحان")) type = "exam";
    else if (textToSearch.includes("event") || textToSearch.includes("holiday") || textToSearch.includes("عطلة") || textToSearch.includes("جدولة")) type = "holiday";
  }
  switch (type) {
 case "lecture":
        return {
          icon: BookOpenText,
          color: "text-blue-600 dark:text-blue-500",
          bg: "bg-blue-600/10 dark:bg-blue-500/15 border border-blue-600/10 dark:border-blue-500/20",
          badgeAr: "محاضرة",
          badgeEn: "Lecture",
        };
 case "quiz":
        return {
          icon: ClipboardCheck,
          color: "text-amber-500 dark:text-amber-400",
          bg: "bg-amber-500/10 dark:bg-amber-400/15 border border-amber-500/10 dark:border-amber-400/20",
          badgeAr: "اختبار قصير",
          badgeEn: "Quiz",
        };
 case "exam":
        return {
          icon: FileText,
          color: "text-red-500 dark:text-red-400",
          bg: "bg-red-500/10 dark:bg-red-500/15 border border-red-500/10 dark:border-red-500/20",
          badgeAr: "امتحان",
          badgeEn: "Exam",
        };
 case "announcement":
 case "system":
 return {
   icon: BellDot,
   color: "text-orange-500 dark:text-orange-400",
   bg: "bg-orange-500/10 dark:bg-orange-400/15 border border-orange-500/10 dark:border-orange-400/20",
   badgeAr: "هام!",
   badgeEn: "Important!",
 };
 case "holiday":
 return {
 icon: PartyPopper,
 color: "text-emerald-500 dark:text-emerald-400",
 bg: "bg-emerald-500/10 dark:bg-emerald-500/15 border border-emerald-500/10 dark:border-emerald-500/20",
 badgeAr: "عطلة",
 badgeEn: "Holiday",
 };
 case "event":
 return {
 icon: BellRing,
 color: "text-neutral-500 dark:text-neutral-400",
 bg: "bg-neutral-500/10 dark:bg-neutral-400/15 border border-neutral-500/10 dark:border-neutral-400/20",
 badgeAr: "حدث",
 badgeEn: "Event",
 };
 default:
 return {
 icon: BellRing,


 color: "text-neutral-500 dark:text-neutral-400",
 bg: "bg-neutral-500/10 dark:bg-neutral-400/15 border border-neutral-500/10 dark:border-neutral-400/20",
 badgeAr: "دليل 99",
 badgeEn: "99's Guide",
 };
 }
 };

 return (
 <div
 className="w-full flex flex-col relative"
 style={{
 direction: isRtl ? "rtl" : "ltr",
 paddingBottom: "110px",
 }}
 >
 {/* ENHANCED iOS HEADER */}
        <header className="px-4 md:px-6 pt-5 pb-4 flex flex-col gap-4 shrink-0 safe-top">
          <div className="flex items-center justify-between gap-4">
            {/* SEGMENTED CONTROL - iOS Style */}
            <div className="flex-1 p-[3px] bg-neutral-200/80 dark:bg-white/[0.08] rounded-[10px] flex relative items-center h-[34px]">
              {(["all", "unread"] as const).map((segment) => (
                <button
                  key={segment}
                  onClick={() => setActiveSegment(segment)}
                  className={`relative flex-1 h-full flex items-center justify-center text-[14px] rounded-[8px] z-10 transition-colors duration-150 ${
                    activeSegment === segment
                      ? "text-neutral-900 dark:text-white font-semibold"
                      : "text-neutral-500 dark:text-[#EBEBF599] font-medium hover:text-neutral-700 dark:hover:text-[#EBEBF5CC]"
                  }`}
                >
                  {activeSegment === segment && (
                    <motion.div
                      layoutId="segment-indicator"
                      className="absolute inset-0 bg-white dark:bg-[#3A3A3C] rounded-[8px] shadow-[0_1px_3px_rgba(0,0,0,0.1),0_1px_2px_rgba(0,0,0,0.06)] dark:shadow-none dark:ring-1 dark:ring-white/[0.08] z-[-1]"
                      transition={{
                        type: "spring",
                        bounce: 0,
                        duration: 0.18,
                      }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-1.5">
                    {segment === "all" ? isRtl ? "الكل" : "All" : isRtl ? "غير مقروء" : "Unread"}
                  </span>
                </button>
              ))}
            </div>

            {/* NOTIFICATION CONTROLS */}
            <div className="flex items-center gap-2 shrink-0">
              {unreadCount > 0 && (
                <div className="px-2 flex items-center justify-center bg-blue-500 text-white text-[12px] font-bold rounded-full min-w-[22px] h-[22px] shadow-sm tracking-tight">
                  {unreadCount}
                </div>
              )}
              {notifications.length > 0 && (
                <div className="flex items-center gap-1 ml-1">
                  <button
                    onClick={onMarkAllRead}
                    className="w-8 h-8 flex items-center justify-center rounded-full text-neutral-500 dark:text-[#EBEBF599] hover:bg-neutral-100 dark:hover:bg-white/[0.08] hover:text-neutral-900 dark:hover:text-white active:scale-95 transition-all duration-200"
                    title={isRtl ? "تعليم الكل كمقروء" : "Mark all read"}
                  >
                    <Check className="w-[18px] h-[18px]" strokeWidth={2.5} />
                  </button>
                  <button
                    onClick={onClearAll}
                    className="w-8 h-8 flex items-center justify-center rounded-full text-neutral-500 dark:text-[#EBEBF599] hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 active:scale-95 transition-all duration-200"
                    title={isRtl ? "مسح الكل" : "Clear all"}
                  >
                    <Trash2 className="w-[18px] h-[18px]" strokeWidth={2} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* CATEGORY FILTER CHIPS */}
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none scroll-smooth overscroll-x-contain pb-1 -mb-1">
            {(
              ["all", "lecture", "quiz", "exam", "announcement"] as const
            ).map((cat) => {
              const label = cat === "all" ? isRtl ? "الكل" : "All" : cat === "lecture" ? isRtl ? "محاضرات" : "Lectures" : cat === "quiz" ? isRtl ? "اختبارات" : "Quizzes" : cat === "exam" ? isRtl ? "امتحانات" : "Exams" : isRtl ? "هام" : "Important";
              const isSelected = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => {
                    setSelectedCategory(cat);
                  }}
                  className={`px-4 h-[32px] flex items-center justify-center text-[13px] font-semibold rounded-full border whitespace-nowrap cursor-pointer transition-all duration-200 ${
                    isSelected
                      ? "bg-med-blue border-blue-500 text-white shadow-elevation-1 dark:bg-[#2C2C2E] dark:border-white/20 dark:text-white"
                      : "bg-white dark:bg-[#1C1C1E] border-neutral-200 dark:border-white/[0.08] text-neutral-500 dark:text-[var(--text-secondary)] hover:bg-neutral-50 dark:hover:bg-white/[0.12]"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </header>

 {/* NOTIFICATIONS LIST SECTION */}
 <main className="flex-1 px-2 md:px-4 pt-2 pb-6">
 {filteredNotifications.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-24 px-6 text-center w-full antialiased">
 <div className="relative mb-6">
 
 <div className="relative w-20 h-20 rounded-full bg-white dark:bg-[#1C1C1E] flex items-center justify-center ring-1 ring-black/[0.04] dark:ring-white/[0.04] shadow-elevation-1 dark:shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
 <Inbox className="w-10 h-10 text-neutral-500 dark:text-[#EBEBF599] dark:text-[var(--text-muted)]" />
 </div>
 </div>
 <h3 className="font-display text-xl font-semibold text-neutral-900 dark:text-[var(--text-primary)] mb-2">
 {isRtl ? "لا توجد منشورات أو تنبيهات" : "Your slate is clean"}
 </h3>
 <p className="text-base font-medium text-neutral-500 dark:text-[var(--text-secondary)] max-w-[280px] text-balance">
 {isRtl
 ? "لا توجد مستندات أو تنبيهات سريرية مطابقة للفلاتر النشطة."
 : "No academic alerts or study milestones are currently flagged."}
 </p>
 </div>
 ) : (
             <div className="space-y-4">
              {/* NOTIFICATIONS LIST */}
              <div className="space-y-3.5">
                <AnimatePresence mode="popLayout">
                  {filteredNotifications.map((notif) =>
                    renderNotificationCard(notif, false),
                  )}
                </AnimatePresence>
              </div>
            </div>
 )}
 </main>
 </div>
 );

 // NOTIFICATION RENDER CARD
 function renderNotificationCard(notif: AppNotification, isPinned: boolean) {
 const theme = getCategoryTheme(notif);
 const Icon = theme.icon;

 const getFormattedSubtitle = (notif: AppNotification, isRtl: boolean) => {
   let rawTitle = isRtl ? notif.titleAr || notif.title : notif.title;
   rawTitle = rawTitle.replace(/^(Event Scheduled|New Event|New Holiday|New Lecture|New Quiz|New Exam):\s*/i, "").replace(/^تم جدولة حدث:\s*/, "");
   
   // Resolve the actual scheduled event date (not the notification creation time).
   // Priority: pre-extracted eventDate field → regex in desc → creation timestamp fallback.
   const eventDateStr: string | undefined =
     notif.eventDate ||
     (notif.desc ? (notif.desc.match(/for (\d{4}-\d{2}-\d{2})/) ?? [])[1] : undefined);

   // Parse as local noon to avoid UTC-midnight off-by-one-day in local timezones.
   const dateObj = eventDateStr
     ? new Date(`${eventDateStr}T12:00:00`)
     : new Date(notif.date);

   let monthDay = "";
   try {
     monthDay = dateObj.toLocaleDateString(isRtl ? "ar-EG" : "en-US", { month: "long", day: "numeric" });
   } catch (e) {
     monthDay = eventDateStr ?? notif.date;
   }

   let type = notif.type;
  if (type === "system" || type === "announcement") {
    const textToSearch = (notif.title + " " + notif.desc).toLowerCase();
    if (textToSearch.includes("lecture") || textToSearch.includes("محاضرة")) type = "lecture";
    else if (textToSearch.includes("quiz") || textToSearch.includes("اختبار")) type = "quiz";
    else if (textToSearch.includes("exam") || textToSearch.includes("امتحان")) type = "exam";
    else if (textToSearch.includes("event") || textToSearch.includes("holiday") || textToSearch.includes("عطلة") || textToSearch.includes("جدولة")) type = "holiday";
  }

  if (type === "announcement" || type === "system") {
    return isRtl ? (notif.descAr || notif.desc) : notif.desc;
  }

  return isRtl ? `"${rawTitle}" في ${monthDay}` : `"${rawTitle}" on ${monthDay}`;
 };
 
 const getDisplayTitle = (notif: AppNotification, isRtl: boolean) => {
   const rawTitle = isRtl ? notif.titleAr || notif.title : notif.title;
   const cleanTitle = rawTitle.replace(/^(Event Scheduled|New Event|New Holiday|New Lecture|New Quiz|New Exam):\s*/i, "").replace(/^تم جدولة حدث:\s*/, "");
   
   let type = notif.type;
    if (type === "system" || type === "announcement") {
      const textToSearch = (notif.title + " " + notif.desc).toLowerCase();
      if (textToSearch.includes("lecture") || textToSearch.includes("محاضرة")) type = "lecture";
      else if (textToSearch.includes("quiz") || textToSearch.includes("اختبار")) type = "quiz";
      else if (textToSearch.includes("exam") || textToSearch.includes("امتحان")) type = "exam";
      else if (textToSearch.includes("event") || textToSearch.includes("holiday") || textToSearch.includes("عطلة") || textToSearch.includes("جدولة")) type = "holiday";
    }

    if (type === "lecture") {
     return isRtl ? `محاضرة جديدة` : `New Lecture`;
   } else if (type === "quiz") {
     return isRtl ? `اختبار قصير جديد` : `New Quiz`;
   } else if (type === "exam") {
     return isRtl ? `امتحان جديد` : `New Exam`;
   } else if (type === "holiday") {
     return isRtl ? `عطلة جديدة` : `New Holiday`;
   } else if (type === "event") {
     return isRtl ? `حدث جديد` : `New Event`;
   }
   return cleanTitle;
 };

 return (
 <motion.div
 initial={{ opacity: 0, scale: 0.95, y: 10 }}
 animate={{ opacity: 1, scale: 1, y: 0 }}
 exit={{ opacity: 0, scale: 0.95, y: -10 }}
 transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
 style={{ willChange: "transform, opacity" }}
 key={notif.id}
 className="ios-list-item-virtualized relative overflow-hidden rounded-xl shadow-sm hover:shadow-md dark:shadow-[0_2px_12px_rgba(0,0,0,0.5)] transition-shadow duration-normal"
 >
 <div
 className={`relative z-10 p-4 bg-white dark:bg-[#1C1C1E] border transition cursor-default select-none rounded-xl ${
 notif.read
 ? "border-neutral-100 dark:border-white/[0.08] opacity-75"
 : "border-blue-250 dark:border-white/[0.15] shadow-sm ring-1 ring-blue-500/5 dark:ring-white/10 dark:shadow-[0_4px_24px_rgba(0,0,0,0.6)]"
 }`}
 >
 <div className="flex gap-3.5">
 {/* SF Symbol Icon inside colored circular plate */}
 <div
 className={`p-2.5 rounded-full shrink-0 h-fit flex items-center justify-center ${theme.bg}`}
 >
 <Icon className={`w-icon-md h-icon-md ${theme.color}`} />
 </div>

 {/* Notification content body */}
 {/* Notification content body */}
 <div className="flex-1 min-w-0 space-y-1">
 <div className="flex items-center justify-between gap-2">
 <div className="flex items-center gap-2">
 {!notif.read && (
 <span className="w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400 dark:shadow-[0_0_8px_rgba(96,165,250,0.6)] shrink-0" />
 )}
 <span
 className={`text-[13px] font-semibold tracking-tight ${notif.type === 'announcement' ? theme.color : 'text-neutral-500 dark:text-neutral-400'}`}
 >
 {isRtl ? theme.badgeAr : theme.badgeEn}
 </span>
 </div>
 <span className="text-[12px] font-medium text-neutral-500 dark:text-neutral-500 whitespace-nowrap">
 {(() => {
 // For calendar events (lecture/quiz/exam/holiday), display the event date
 // itself (e.g. "July 20") rather than when the notification was sent ("3d ago").
 // The event date is embedded in the description as "for YYYY-MM-DD".
 let resolvedType = notif.type;
 if (resolvedType === "system" || resolvedType === "announcement") {
 const txt = (notif.title + " " + notif.desc).toLowerCase();
 if (txt.includes("lecture") || txt.includes("محاضرة")) resolvedType = "lecture";
 else if (txt.includes("quiz") || txt.includes("اختبار")) resolvedType = "quiz";
 else if (txt.includes("exam") || txt.includes("امتحان")) resolvedType = "exam";
 else if (txt.includes("holiday") || txt.includes("عطلة")) resolvedType = "holiday";
 }
 const isCalendarEvent = ["lecture","quiz","exam","holiday","event"].includes(resolvedType);
 if (isCalendarEvent && notif.desc) {
 const m = notif.desc.match(/for (\d{4}-\d{2}-\d{2})/);
 if (m && m[1]) {
 try {
 const evDate = new Date(m[1] + "T12:00:00");
 return evDate.toLocaleDateString(isRtl ? "ar-EG" : "en-US", { month: "long", day: "numeric" });
 } catch { /* fall through */ }
 }
 }
 return getRelativeTime(notif.date);
 })()}
 </span>
 </div>
 
 <div className="mt-1">
 {/* Headline */}
 <h4 className="text-[16px] leading-snug font-semibold text-neutral-900 dark:text-white">
 {getDisplayTitle(notif, isRtl)}
 </h4>
 {/* Subtitle */}
 <p className="text-[14px] leading-snug text-neutral-500 dark:text-[#EBEBF599] mt-0.5 whitespace-pre-wrap">
 {getFormattedSubtitle(notif, isRtl)}
 </p>
 </div>
              {/* Actions */}
              <div className="flex items-center gap-1 mt-2.5 pt-2.5 border-t border-neutral-100 dark:border-white/[0.08]">
                <button
                  onClick={(e) => handleMarkItemReadState(notif.id, !notif.read, e)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium rounded-md text-neutral-500 dark:text-[#EBEBF599] bg-transparent hover:bg-neutral-100 dark:hover:bg-white/[0.08] hover:text-neutral-900 dark:hover:text-white active:scale-95 transition-all duration-200"
                >
                  <Check className="w-3.5 h-3.5" />
                  {isRtl ? (notif.read ? "تعليم كغير مقروء" : "تعليم كمقروء") : (notif.read ? "Mark unread" : "Mark read")}
                </button>
                <button
                  onClick={(e) => handleDeleteItem(notif.id, e)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium rounded-md text-neutral-500 dark:text-[#EBEBF599] bg-transparent hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 active:scale-95 transition-all duration-200"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {isRtl ? "حذف" : "Delete"}
                </button>
              </div>
 </div>
 </div>
 </div>
 </motion.div>
 );
 }
};
export default memo(BulletinCenter);
