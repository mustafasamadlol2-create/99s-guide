/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import {
 Calendar,
 BookOpen,
 CircleAlert,
 ClipboardCheck,
 CircleCheck,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { HapticFeedback } from "../../../core/device/haptic";
import { CalendarEvent } from "../../../core/types";
import { formatLocalDate } from "../../../core/utils/dateUtils";

interface CalendarHeaderProps {
 t: (key: string) => string;
 isRtl: boolean;
 activeView: "month" | "week" | "day";
 setActiveView: (view: "month" | "week" | "day") => void;
 handlePrint: () => void;
 handleShare: () => void;
 shareSuccess: boolean;
 currentMonth: number;
 currentYear: number;
 monthNames: string[];
 selectedDate: string;
 events: CalendarEvent[];
 studentGroup: string;
 setStudentGroup: (group: string) => void;
 activeWeekDays: Date[];
}

export function CalendarHeader({
 t,
 isRtl,
 activeView,
 setActiveView,
 handlePrint,
 handleShare,
 shareSuccess,
 currentMonth,
 currentYear,
 monthNames,
 selectedDate,
 events,
 studentGroup,
 setStudentGroup,
 activeWeekDays,
}: CalendarHeaderProps) {
 // Map segments with native translations as fallback option
 const segments = [
 { id: "week" as const, label: isRtl ? t("viewWeek") : "Week" },
 { id: "day" as const, label: isRtl ? t("viewDay") : "Day" },
 { id: "month" as const, label: isRtl ? t("viewMonth") : "Month" },
 ];

 // Safely parse local day number timezone-proof
 const getDayNumber = () => {
 try {
 const parts = selectedDate.split("-");
 if (parts.length === 3) {
 const day = parseInt(parts[2], 10);
 if (!isNaN(day)) return day;
 }
 return new Date().getDate();
 } catch {
 return new Date().getDate();
 }
 };

 const getDayOfWeekName = () => {
 try {
 const parts = selectedDate.split("-");
 if (parts.length === 3) {
 const dateObj = new Date(
 parseInt(parts[0]),
 parseInt(parts[1]) - 1,
 parseInt(parts[2]),
 );
 return dateObj.toLocaleDateString(isRtl ? "ar-IQ" : "en-US", {
 weekday: "long",
 });
 }
 return new Date().toLocaleDateString(isRtl ? "ar-IQ" : "en-US", {
 weekday: "long",
 });
 } catch {
 return "";
 }
 };

 const { thisWeekLectures, thisWeekExams, thisWeekQuizzes, todayLectures } =
 useMemo(() => {
 let weekLecs = 0;
 let monthExams = 0;
 let weekQuizzes = 0;
 let todayLecs = 0;

 const now = new Date();
 const actualTodayStr = formatLocalDate(now);
 const actualMonthStr = actualTodayStr.substring(0, 7);
 
 const currentDay = now.getDay();
 const actualWeekDateStrings: string[] = [];
 for (let i = 0; i < 7; i++) {
 const d = new Date(now);
 d.setDate(now.getDate() - currentDay + i);
 actualWeekDateStrings.push(formatLocalDate(d));
 }

 events.forEach((e) => {
 // It's processed inside CalendarView to have `date` and `type`
 const evt: any = e;

 if (actualWeekDateStrings.includes(evt.date)) {
 if (evt.type === "lecture") weekLecs++;
 const isQuiz = evt.type === "quiz" || evt.eventType === "QUIZ" || evt.title?.toLowerCase().includes("quiz") || evt.title?.toLowerCase().includes("daily exam") || evt.title?.toLowerCase().includes("كويز") || evt.title?.toLowerCase().includes("امتحان يومي");
 if (isQuiz) weekQuizzes++;
 }

 if (evt.date && evt.date.startsWith(actualMonthStr)) {
 if (evt.type === "exam" || evt.eventType === "EXAM") monthExams++;
 }

 if (evt.date === actualTodayStr) {
 if (evt.type === "lecture" || evt.eventType === "LECTURE") todayLecs++;
 }
 });

 return {
 thisWeekLectures: weekLecs,
 thisWeekExams: monthExams,
 thisWeekQuizzes: weekQuizzes,
 todayLectures: todayLecs,
 };
 }, [events]);

 return (
 <motion.div
  initial={{ opacity: 0, y: -10 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
 id="calendar_header_bar"
  className="w-full flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5 pb-2 pt-2 select-none"
 >
 {/* Left section: Typography and Meta */}
  <div className="flex flex-col gap-4 w-full lg:w-auto min-w-0">
  <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
 <div className="flex items-center gap-3">
 {/* iOS Native Style Calendar App Icon - Larger in redesign */}
 <div className="w-16 h-16 rounded-xl bg-white dark:bg-[#2C2C2E] border border-neutral-200/80 dark:border-white/[0.15]/85 flex flex-col items-center overflow-hidden shadow-elevation-2 shrink-0 font-sans">
 <div className="w-full bg-med-error py-1.5 text-center leading-none">
 <span className="text-[11px] leading-tight font-bold uppercase tracking-wider text-white">
 {monthNames[currentMonth]?.substring(0, 3)}
 </span>
 </div>
 <div className="flex-1 flex items-center justify-center leading-none bg-white dark:bg-[var(--bg-surface-1)] pb-1">
 <span className="text-3xl font-semibold tracking-tight text-neutral-900 dark:text-white leading-none -mt-0.5">
 {getDayNumber()}
 </span>
 </div>
 </div>

  <div className="flex flex-col justify-center relative min-w-0">
  <h1 className="flex text-title sm:text-large-title font-display font-semibold text-neutral-900 dark:text-white leading-none items-center gap-3">
 {isRtl ? "الجدول الدراسي" : "Schedule"}
 </h1>

                {/* Academic Cohort Pill Row */}
                 <div className="flex flex-row flex-wrap gap-1.5 mt-3 max-w-full" role="group" aria-label={isRtl ? "المجموعات" : "Groups"}>
                  {["A", "B", "C", "D", "ALL"].map((group) => {
                    const isActive = studentGroup === group;
                    return (
                      <button
                        key={group}
                        type="button"
                        onClick={() => setStudentGroup(group)}
                         className={`rounded-full px-3 py-1.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                          isActive
                            ? "bg-med-blue dark:bg-blue-600 text-white shadow-elevation-1"
                            : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-white/[0.18]"
                        }`}
                      >
                        {isRtl && group === "ALL"
                          ? "الكل"
                          : group === "ALL"
                          ? "ALL"
                          : `Group ${group}`}
                      </button>
                    );
                  })}
                </div>

  <p className="text-body font-medium text-neutral-500 dark:text-[#EBEBF599] mt-2 flex items-center gap-2 min-w-0">
 <Calendar className="w-icon-sm h-icon-sm opacity-70" />
  <span className="truncate">
 {getDayOfWeekName()}, {monthNames[currentMonth]} {currentYear}
 </span>
 </p>
 </div>
 </div>
 </div>

 {/* Apple Style Stats Row - Scrollable horizontally on small screens */}
  <div className="grid grid-cols-2 sm:flex sm:flex-wrap lg:flex-nowrap items-stretch gap-2 w-full lg:w-auto">
  <div className="flex items-center gap-2 bg-white dark:bg-[var(--bg-surface-1)] border border-neutral-200/60 dark:border-white/[0.08] px-2.5 py-2 rounded-lg shadow-elevation-1 min-w-0">
 <BookOpen className="w-icon-sm h-icon-sm text-med-blue" />
  <span className="text-caption font-medium text-neutral-600 dark:text-[#EBEBF599] truncate">
 {thisWeekLectures}{" "}
 {isRtl ? "محاضرات الأسبوع" : "Lectures this week"}
 </span>
 </div>

  <div className="flex items-center gap-2 bg-white dark:bg-[var(--bg-surface-1)] border border-neutral-200/60 dark:border-white/[0.08] px-2.5 py-2 rounded-lg shadow-elevation-1 min-w-0">
 <CircleAlert className="w-icon-sm h-icon-sm text-med-error" />
  <span className="text-caption font-medium text-neutral-600 dark:text-[#EBEBF599] truncate">
 {thisWeekExams} {isRtl ? "امتحانات الشهر" : "Exams this month"}
 </span>
 </div>

  <div className="flex items-center gap-2 bg-white dark:bg-[var(--bg-surface-1)] border border-neutral-200/60 dark:border-white/[0.08] px-2.5 py-2 rounded-lg shadow-elevation-1 min-w-0">
 <ClipboardCheck className="w-icon-sm h-icon-sm text-orange-500" />
  <span className="text-caption font-medium text-neutral-600 dark:text-[#EBEBF599] truncate">
 {thisWeekQuizzes} {isRtl ? "كويزات الأسبوع" : "Quizzes this week"}
 </span>
 </div>

  <div className="flex items-center gap-2 bg-white dark:bg-[var(--bg-surface-1)] border border-neutral-200/60 dark:border-white/[0.08] px-2.5 py-2 rounded-lg shadow-elevation-1 min-w-0">
 <CircleCheck className="w-icon-sm h-icon-sm text-emerald-500" />
  <span className="text-caption font-medium text-neutral-600 dark:text-[#EBEBF599] truncate">
 {todayLectures} {isRtl ? "محاضرات اليوم" : "Today's lectures"}
 </span>
 </div>
 </div>
 </div>

 {/* Right section: Control panel */}
 <div className="flex items-center justify-end w-full lg:w-auto shrink-0">
 <div
 role="tablist"
 aria-label="Calendar view options"
  className="cal-segment calendar-segment relative bg-[#767680]/[0.12] dark:bg-[#767680]/[0.24] p-1 rounded-lg flex items-center w-full sm:w-auto h-8 sm:h-8 select-none"
 >
 {segments.map((segment, index) => {
 const isActive = activeView === segment.id;
 const showDivider =
 index < segments.length - 1 &&
 activeView !== segments[index].id &&
 activeView !== segments[index + 1].id;

 return (
 <div
 key={segment.id}
 className="relative flex-1 sm:flex-initial flex items-center h-full"
 >
 <button
 role="tab"
 aria-selected={isActive}
 aria-controls={`${segment.id}-panel`}
 id={`${segment.id}-tab`}
 onClick={() => {
 setActiveView(segment.id);
 HapticFeedback.selection();
 }}
 className={`
 relative px-4 sm:px-6 h-full rounded-lg text-secondary-label sm:text-secondary-label font-medium transition-colors z-10 flex items-center justify-center/50 cursor-pointer w-full
 ${
 isActive
 ? "text-black dark:text-white font-semibold"
 : "text-neutral-700 dark:text-white hover:bg-[#767680]/[0.05] dark:hover:bg-[#767680]/[0.15] "
 }
 `}
 >
 {isActive && (
 <motion.div
 layoutId="activeCalendarSegmentApple"
 className="absolute inset-0 bg-white dark:bg-[#636366] rounded-lg shadow-elevation-1 dark:shadow-[0_2px_10px_rgba(0,0,0,0.4)] border-[0.5px] border-black/5 dark:border-black/20 -z-10"
 transition={{
 type: "spring",
 stiffness: 400,
 damping: 40,
 mass: 1,
 }}
 />
 )}
 <span className="relative text-center whitespace-nowrap z-20">
 {segment.label}
 </span>
 </button>

 {showDivider && (
 <div className="absolute right-0 top-1/2 -translate-y-1/2 h-4 w-0 bg-[#8E8E93]/[0.3] z-0 transition-opacity" />
 )}
 </div>
 );
 })}
 </div>
 </div>
 </motion.div>
 );
}
