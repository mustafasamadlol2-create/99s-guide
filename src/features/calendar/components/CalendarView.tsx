/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import { CalendarEvent, Subject } from "../../../core/types";
import { useTranslation, Language } from "../../../core/i18n/translations";
import { AnimatePresence, motion } from "motion/react";
import { HapticFeedback } from "../../../core/device/haptic";
import { getBaghdadDateParts } from "../../../core/utils/timezone";
import {
 ChevronLeft,
 ChevronRight,
 ChevronDown,
 Users,
 Filter,
 Settings,
 Clock,
 CalendarDays,
 BookOpen,
 AlertTriangle,
 HelpCircle,
 FileText,
 X,
 Plus,
 Calendar as CalIcon,
 Book,
 FileCheck,
} from "lucide-react";

import { useCalendar } from "../hooks/useCalendar";
import { CalendarHeader } from "./CalendarHeader";
import { CalendarMonthView } from "./CalendarMonthView";
import { CalendarWeekView } from "./CalendarWeekView";
import { CalendarDayView } from "./CalendarDayView";
import { getEventIconInfo, PRIORITY, getEventPriority } from "../../../features/calendar/components/EventIcon";

import { parseLocalDate, formatLocalDate, to12HourFormatStr } from "../../../core/utils/dateUtils";

const agendaListVariants = {
  hidden: { opacity: 1 },
 show: {
 opacity: 1,
 transition: {
 staggerChildren: 0.035,
 delayChildren: 0.02,
 },
 },
};

const agendaItemVariants = {
  hidden: { opacity: 1, y: 12, scale: 0.98 },
 show: {
 opacity: 1,
 y: 0,
 scale: 1,
 transition: {
 type: "spring" as const,
 stiffness: 400,
 damping: 40,
 mass: 1,
 },
 },
};

const ribbonContainerVariants = {
  hidden: { opacity: 1 },
 show: {
 opacity: 1,
 transition: {
 staggerChildren: 0.015,
 delayChildren: 0.01,
 },
 },
};

const ribbonItemVariants = {
  hidden: { opacity: 1, scale: 0.9, y: 4 },
 show: {
 opacity: 1,
 scale: 1,
 y: 0,
 transition: {
 type: "spring" as const,
 stiffness: 400,
 damping: 40,
 mass: 1,
 },
 },
};

interface MobileAgendaItemProps {
  isActive?: boolean;
 ev: CalendarEvent;
 isRtl: boolean;
}

const MobileAgendaItem = memo(function MobileAgendaItem({ ev, isRtl }: MobileAgendaItemProps) {
 const evType = (ev.eventType || ev.type || "").toUpperCase();
 const isEvExam = evType === "EXAM" || evType === "IMPORTANT EXAM" || ev.type === "exam";
 const { Icon, colorClass, accentColor } = getEventIconInfo(ev);

 const containerClass = isEvExam
 ? `ios-staggered-card macos-interactive relative group flex flex-col justify-between w-full p-4 sm:p-5 bg-red-100 dark:bg-[#2C2C2E] rounded-xl cursor-pointer select-none overflow-hidden shadow-elevation-1 ring-1 ring-red-300 dark:ring-red-500/40 transition duration-normal ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-[2px] hover:shadow-elevation-3 z-10`
 : `ios-staggered-card macos-interactive relative group flex flex-col justify-between w-full p-4 sm:p-5 bg-white dark:bg-[#1C1C1E] rounded-xl cursor-pointer select-none overflow-hidden shadow-elevation-1 ring-1 ring-black/[0.03] dark:ring-white/10 transition duration-normal ease-[cubic-bezier(0.22,1,0.36,1)] hover:shadow-elevation-3 dark:hover:shadow-elevation-3 hover:ring-black/[0.08] dark:hover:ring-white/[0.1]`;

 const titleSize = isEvExam ? "text-base sm:text-lg font-semibold" : "text-caption sm:text-body font-semibold";
 const borderClass = isEvExam ? "w-2" : "w-1";

 return (
 <motion.div
 variants={agendaItemVariants}
 whileTap={{ scale: 0.97 }}
 className={containerClass}
 >
 <div
 className="absolute -top-24 -right-24 w-48 h-48 rounded-full blur-3xl opacity-0 group-hover:opacity-80 transition-opacity duration-slow pointer-events-none"
 style={{ backgroundColor: accentColor, willChange: "opacity" }}
 />
 
 <div className="flex items-start gap-card-padding relative z-10 w-full text-left">
 <div
 className={`absolute inset-y-0 -left-5 ${borderClass}`}
 style={{ backgroundColor: accentColor }}
 />

 <div className={`w-10 h-10 rounded-md ${isEvExam ? 'bg-red-50/50 dark:bg-red-900/30' : 'bg-neutral-50 dark:bg-[#2C2C2E]'} shadow-elevation-1 flex items-center justify-center shrink-0`}>
 <Icon className={`w-icon-md h-icon-md ${colorClass}`} />
 </div>

 <div className="space-y-1 select-none flex-1">
 <div className="flex items-center justify-between gap-1 w-full">
 <h4
 className={`${titleSize} ${colorClass} line-clamp-1`}
 >
 {ev.title}
 </h4>
 {getEventPriority(ev) === PRIORITY.HOLIDAY ? (
 null
 ) : ev.time && (
 <span className="text-caption font-mono text-neutral-500 dark:text-[#EBEBF599] dark:text-[var(--text-muted)] font-semibold shrink-0">
 {to12HourFormatStr(ev.time)}
 </span>
 )}
 </div>
 <p className="text-caption text-neutral-500 dark:text-[var(--text-secondary)] line-clamp-2">
 {ev.description ||
 (isRtl
 ? "لا يوجد وصف مضاف لهذه الفعالية."
 : "No description provided.")}
 </p>
 </div>
 </div>
 </motion.div>
 );
});

interface CalendarViewProps {
  isActive?: boolean;
 events: CalendarEvent[];
 subjects: Subject[];
 onAddEvent: (newEvent: CalendarEvent) => void;
 onDeleteEvent?: (eventId: string) => void;
 onUpdateEvents?: (updatedEvents: CalendarEvent[]) => void;
 language: Language;
}

const CalendarView = memo(function CalendarView({
 events,
 subjects,
 onAddEvent,
 onDeleteEvent,
 onUpdateEvents,
 language,
}: CalendarViewProps) {
 const { t } = useTranslation(language);
 const isRtl = language === "ar";

 const isMountedRef = useRef(true);
 useEffect(() => {
 isMountedRef.current = true;
 return () => {
 isMountedRef.current = false;
 };
 }, []);

 // Load student group from localStorage, defaulting to 'A'
 const [studentGroup, setStudentGroup] = useState<string>(() => {
 return localStorage.getItem("my_academic_group") || "A";
 });

 const [showMiniCalendar, setShowMiniCalendar] = useState(false);
 const miniCalendarRef = useRef<HTMLDivElement>(null);

 useEffect(() => {
 const handleClickOutside = (event: MouseEvent) => {
 if (
 miniCalendarRef.current &&
 !miniCalendarRef.current.contains(event.target as Node)
 ) {
 setShowMiniCalendar(false);
 }
 };
 if (showMiniCalendar) {
 document.addEventListener("mousedown", handleClickOutside);
 }
 return () => {
 document.removeEventListener("mousedown", handleClickOutside);
 };
 }, [showMiniCalendar]);

 const [toast, setToast] = useState<{
 message: string;
 type: "success" | "info";
 } | null>(null);

 const showToast = (message: string, type: "success" | "info" = "success") => {
 if (!isMountedRef.current) return;
 setToast({ message, type });
 setTimeout(() => {
 if (isMountedRef.current) {
 setToast(null);
 }
 }, 2500);
 };

 // Load selected filter groups, which default to show studentGroup and 'ALL'
 const [selectedFilterGroups, setSelectedFilterGroups] = useState<string[]>(
 () => {
 const defaultGroup = localStorage.getItem("my_academic_group") || "A";
 return ["ALL", defaultGroup];
 },
 );

 // Synchronize filters if student changes their academic group
 const handleStudentGroupChange = (newGroup: string) => {
 setStudentGroup(newGroup);
 localStorage.setItem("my_academic_group", newGroup);
 setSelectedFilterGroups(["ALL", newGroup]);
 };

 
 // Map and filter events on-the-fly for clean subcomponent compliance
 const processedEvents = useMemo(() => {
 return events
 .map((event) => {
 if (event.startDateTime) {
 const { year, month, day, hh, mm } = getBaghdadDateParts(
 event.startDateTime,
 );

 let convertedType: any = "other";
 if (event.eventType === "LECTURE") {
 convertedType = "lecture";
 } else if (event.eventType === "QUIZ") {
 convertedType = "quiz";
 } else if (event.eventType === "EXAM") {
 convertedType = "exam";
 }

 return {
 ...event,
 date: `${year}-${month}-${day}`,
 time: `${hh}:${mm}`,
 type: convertedType,
 isPublic: true,
 description: event.description || "",
 };
 }
 return event;
 })
 .filter((event) => {
 const targets = event.targetGroups || ["ALL"];

 // Cohort Restriction Check
 const matchesStudentCohort =
 studentGroup === "ALL" ||
 targets.includes("ALL") ||
 targets.includes(studentGroup);
 if (!matchesStudentCohort) return false;

 // Group Filters Check
 const matchesFilter =
 selectedFilterGroups.includes("ALL") ||
 targets.includes("ALL") ||
 targets.some((tg) => selectedFilterGroups.includes(tg));
 return matchesFilter;
 });
 }, [events, studentGroup, selectedFilterGroups]);

 // Create eventsByDate map for fast lookups
 const eventsByDate = useMemo(() => {
 const map = new Map<string, typeof processedEvents>();
 for (const ev of processedEvents) {
 if (!map.has(ev.date)) {
 map.set(ev.date, []);
 }
 const list = map.get(ev.date); if (list) list.push(ev);
 }
 return map;
 }, [processedEvents]);

 const {
 activeView,
 setActiveView,
 selectedDate,
 setSelectedDate,
 currentYear,
 currentMonth,
 monthNames,
 shareSuccess,
 handlePrint,
 handleShare,
 selectedDateEvents,
 emptyPaddings,
 calendarDays,
 getFormattedDate,
 activeWeekDays,
 eventDurations,
 dayTransition,
 hoursArray,
 HOUR_HEIGHT,
 timelineRef,
 setNewTaskTime,
 setIsAddingTask,
 handleSwipeStart,
 handleSwipeMove,
 handleSwipeEnd,
 swipeStartX,
 setSwipeStartX,
 swipeTranslateX,
 parseTimeToMinutes,
 formatMinutesToTime,
 handlePrevMonth,
 handleNextMonth,
 handleGoToToday,
 handlePrevWeek,
 handleNextWeek,
 handlePrevDay,
 handleNextDay,
 } = useCalendar({
 events: processedEvents,
 subjects,
 onAddEvent,
 onUpdateEvents,
 language,
 });

 useEffect(() => {
 const handleKeyDown = (e: KeyboardEvent) => {
 if (
 e.target instanceof HTMLInputElement ||
 e.target instanceof HTMLTextAreaElement
 )
 return;

 if (e.key === "ArrowLeft") {
 if (isRtl) {
 if (activeView === "month") handleNextMonth();
 else if (activeView === "week") handleNextWeek();
 else handleNextDay();
 } else {
 if (activeView === "month") handlePrevMonth();
 else if (activeView === "week") handlePrevWeek();
 else handlePrevDay();
 }
 } else if (e.key === "ArrowRight") {
 if (isRtl) {
 if (activeView === "month") handlePrevMonth();
 else if (activeView === "week") handlePrevWeek();
 else handlePrevDay();
 } else {
 if (activeView === "month") handleNextMonth();
 else if (activeView === "week") handleNextWeek();
 else handleNextDay();
 }
 } else if (e.key === "t" || e.key === "T") {
 handleGoToToday();
 }
 };

 window.addEventListener("keydown", handleKeyDown);
 return () => window.removeEventListener("keydown", handleKeyDown);
 }, [
 isRtl,
 activeView,
 handleNextMonth,
 handlePrevMonth,
 handleNextWeek,
 handlePrevWeek,
 handleNextDay,
 handlePrevDay,
 handleGoToToday,
 ]);

 
 
 const handleCopyTitle = (event: CalendarEvent) => {
 if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(event.title);
  showToast(
  isRtl ? "تم نسخ عنوان الحدث" : "Copied event title to clipboard",
 );
 };

 const handleChangeGroup = (event: CalendarEvent, newGroup: string) => {
 if (onUpdateEvents) {
 const updated = events.map((e) => {
 if (e.id === event.id) {
 return {
 ...e,
 targetGroups: newGroup === "ALL" ? ["ALL"] : [newGroup],
 };
 }
 return e;
 });
 onUpdateEvents(updated);
  showToast(
  isRtl
  ? `تم تغيير المجموعة المستهدفة إلى ${newGroup}`
  : `Target cohort set to Group ${newGroup}`,
 );
 }
 };

 const renderMiniCalendar = () => (
 <AnimatePresence>
 {showMiniCalendar && (
 <motion.div
 ref={miniCalendarRef}
 initial={{ opacity: 0, y: -10, scale: 0.95 }}
 animate={{ opacity: 1, y: 0, scale: 1 }}
 exit={{ opacity: 0, y: -10, scale: 0.95 }}
 transition={{ type: "spring" as const, stiffness: 400, damping: 40, mass: 1 }}
 className="absolute top-full left-0 mt-2 p-3 bg-white dark:bg-[#2C2C2E] rounded-lg shadow-elevation-1 dark:shadow-[0_2px_10px_rgba(0,0,0,0.4)] border border-black/5 dark:border-white/[0.12] z-50 w-[260px] cursor-default"
 onClick={(e) => e.stopPropagation()}
 >
 <div className="flex items-center justify-between mb-3 px-1">
 <span className="font-semibold text-body text-neutral-900 dark:text-[var(--text-primary)]">
 {monthNames[currentMonth]} {currentYear}
 </span>
 <div className="flex items-center gap-1">
 <button
 aria-label={isRtl ? "الشهر التالي" : "Previous Month"}
 onClick={(e) => {
 e.stopPropagation();
 isRtl ? handleNextMonth() : handlePrevMonth();
 }}
 className="w-8 h-8 flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-white/[0.12] rounded-full text-neutral-600 dark:text-[var(--text-secondary)] transition-colors"
 >
 {isRtl ? (
 <ChevronRight className="w-icon-sm h-icon-sm" />
 ) : (
 <ChevronLeft className="w-icon-sm h-icon-sm" />
 )}
 </button>
 <button
 aria-label={isRtl ? "الشهر السابق" : "Next Month"}
 onClick={(e) => {
 e.stopPropagation();
 isRtl ? handlePrevMonth() : handleNextMonth();
 }}
 className="w-8 h-8 flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-white/[0.12] rounded-full text-neutral-600 dark:text-[var(--text-secondary)] transition-colors"
 >
 {isRtl ? (
 <ChevronLeft className="w-icon-sm h-icon-sm" />
 ) : (
 <ChevronRight className="w-icon-sm h-icon-sm" />
 )}
 </button>
 </div>
 </div>
 <div className="grid grid-cols-7 mb-2">
 {(isRtl
 ? ["ح", "ن", "ث", "ر", "خ", "ج", "س"]
 : ["S", "M", "T", "W", "T", "F", "S"]
 ).map((d, i) => (
 <div
 key={i}
 className="text-center text-caption font-medium text-neutral-500 dark:text-[#EBEBF599] dark:text-[var(--text-muted)]"
 >
 {d}
 </div>
 ))}
 </div>
 <div className="grid grid-cols-7 gap-y-1">
 {emptyPaddings.map((_, i) => (
 <div key={`empty-${i}`} className="h-8" />
 ))}
 {calendarDays.map((dayNum) => {
 const dateStr = getFormattedDate(dayNum);
 const isSelected = selectedDate === dateStr;
 const isToday = dateStr === formatLocalDate(new Date());

 return (
 <button
 key={dayNum}
 onClick={(e) => {
 e.stopPropagation();
 setSelectedDate(dateStr);
 setShowMiniCalendar(false);
 }}
 className={`h-8 w-8 mx-auto flex items-center justify-center rounded-full text-secondary-label transition-colors ${
 isSelected
 ? "bg-rose-500 dark:bg-[#FF453A] text-white font-semibold shadow-elevation-1"
 : isToday
 ? "text-rose-500 dark:text-[#FF453A] font-semibold"
 : "text-neutral-700 dark:text-[var(--text-secondary)] hover:bg-neutral-100 dark:hover:bg-white/[0.12]"
 }`}
 >
 {dayNum}
 </button>
 );
 })}
 </div>
 </motion.div>
 )}
 </AnimatePresence>
 );

 const pLocalDate = parseLocalDate(selectedDate);

 return (
 <div
 id="calendar_viewport"
 className="space-y-section animate-fadeIn pb-12 select-none"
 style={{
 direction: isRtl ? "rtl" : "ltr",
 fontFamily:
 '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif',
 }}
 >
 <CalendarHeader t={t} isRtl={isRtl} activeView={activeView} setActiveView={setActiveView} handlePrint={handlePrint} handleShare={handleShare} shareSuccess={shareSuccess} currentMonth={currentMonth} currentYear={currentYear} monthNames={monthNames} selectedDate={selectedDate} events={processedEvents} studentGroup={studentGroup} setStudentGroup={handleStudentGroupChange} activeWeekDays={activeWeekDays} />

 {/* MOBILE ARCHITECTURE (iPhone Streamlined Perspective) */}
 <div className="block md:hidden space-y-section mt-4">
 {/* Quick prev/next week jump arrows with Today button */}
 <div className="flex items-center justify-between mb-3 px-1 relative">
 <div className="relative z-50">
 <span
 role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }} onClick={(e) => {
 e.stopPropagation();
 setShowMiniCalendar(!showMiniCalendar);
 }}
 className="text-headline font-semibold text-neutral-900 dark:text-[var(--text-primary)] cursor-pointer hover:opacity-80 transition-opacity flex items-center gap-1"
 >
 {monthNames[currentMonth]} {currentYear}
 <ChevronDown className="w-icon-md h-icon-md text-neutral-500 dark:text-[#EBEBF599]" />
 </span>
 {renderMiniCalendar()}
 </div>
 <div className="flex items-center gap-3">
 <motion.button
 type="button"
 initial={{ opacity: 0, scale: 0.8 }}
 animate={{ opacity: 1, scale: 1 }}
 transition={{ type: "spring" as const, stiffness: 400, damping: 40, mass: 1 }}
 whileHover={{ scale: 1.02 }}
 whileTap={{ scale: 0.94 }}
 onClick={handleGoToToday}
 className="relative px-4 py-2 bg-white dark:bg-[#2C2C2E] hover:bg-neutral-50 dark:hover:bg-white/[0.18] text-rose-600 dark:text-[#FF453A] text-secondary-label font-semibold rounded-lg cursor-pointer transition-colors shadow-elevation-1 border border-black/5 dark:border-white/[0.12] flex items-center shrink-0"
 >
 <span>{isRtl ? "اليوم" : "Today"}</span>
 {selectedDate !== formatLocalDate(new Date()) && (
 <motion.span 
 animate={{ scale: [1, 1.2, 1], opacity: [0.8, 1, 0.8] }}
 transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
 className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-rose-600 dark:bg-[#FF453A] ring-2 ring-white dark:ring-neutral-900" 
 />
 )}
 </motion.button>

 <div className="flex items-center gap-1">
 <button
 type="button"
 onClick={handlePrevWeek}
 className="w-icon-xl h-icon-xl flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-white/[0.12] text-neutral-600 dark:text-[var(--text-secondary)] rounded-full cursor-pointer transition-colors"
 >
 {isRtl ? (
 <ChevronRight className="w-icon-md h-icon-md" />
 ) : (
 <ChevronLeft className="w-icon-md h-icon-md" />
 )}
 </button>
 <button
 type="button"
 onClick={handleNextWeek}
 className="w-icon-xl h-icon-xl flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-white/[0.12] text-neutral-600 dark:text-[var(--text-secondary)] rounded-full cursor-pointer transition-colors"
 >
 {isRtl ? (
 <ChevronLeft className="w-icon-md h-icon-md" />
 ) : (
 <ChevronRight className="w-icon-md h-icon-md" />
 )}
 </button>
 </div>
 </div>
 </div>

 {activeView === "week" && <motion.div
 key={`mobile-week-${currentYear}-${currentMonth}-${activeWeekDays[0]?.getDate()}`}
  initial={{ opacity: 1, x: isRtl ? 10 : -10 }}
 animate={{ opacity: 1, x: 0 }}
 exit={{ opacity: 0, x: isRtl ? -10 : 10 }}
 transition={{ duration: 0.2 }}
 className="touch-pan-y"
 drag="x"
 dragConstraints={{ left: 0, right: 0 }}
 dragElastic={0.2}
 onDragEnd={(e, info) => {
 if (info.offset.x > 80) {
 isRtl ? handleNextWeek() : handlePrevWeek();
 } else if (info.offset.x < -80) {
 isRtl ? handlePrevWeek() : handleNextWeek();
 }
 }}
 >
 {/* Horizontal Scrolling Weekly Date Strip */}
 <div className="w-full bg-white dark:bg-[#1C1C1E] border border-neutral-100 dark:border-white/[0.12] p-3 rounded-lg shadow-elevation-1">
 <motion.div
 variants={ribbonContainerVariants}
 initial="hidden"
 animate="show"
 className="grid grid-cols-7 gap-1 text-center"
 >
 {activeWeekDays.map((dateObj, idx) => {
 const dateStr = formatLocalDate(dateObj);
 const isSel = dateStr === selectedDate;
 const hasToday =
 dateObj.toDateString() === new Date().toDateString();

 // Check events for indicator dots
 const evs = eventsByDate.get(dateStr) || [];
 const hasLecture = evs.some((e) => e.type === "lecture");
 const hasQuiz = evs.some((e) => e.type === "quiz" || e.type === "holiday" || e.eventType === "QUIZ");
 const hasExam = evs.some((e) => e.type === "exam");

 return (
 <motion.button
 key={`scroll-day-${idx}`}
 variants={ribbonItemVariants}
 whileTap={{ scale: 0.94 }}
 onClick={() => setSelectedDate(dateStr)}
 className="relative py-3 rounded-md flex flex-col items-center justify-between gap-1 overflow-hidden cursor-pointer"
 >
 {/* Selected Day Indicator (amber gradient box) */}
 {isSel && (
 <div className="absolute inset-[3px] bg-gradient-to-br from-amber-50 to-amber-100/40 dark:from-amber-950/20 dark:to-amber-900/10 rounded-md -z-10 shadow-elevation-1 border border-amber-500/20 dark:border-amber-500/40 transition duration-100" />
 )}

 {/* Weekday tag */}
 <span
 className={`text-caption font-semibold uppercase ${
 isSel
 ? "text-med-gold dark:text-amber-400 font-semibold"
 : "text-neutral-500 dark:text-[#EBEBF599] dark:text-[var(--text-muted)]"
 }`}
 >
 {dateObj.toLocaleDateString(undefined, {
 weekday: "narrow",
 })}
 </span>

 {/* Day number */}
 <span
 className={`relative text-body font-semibold w-icon-lg h-icon-lg flex items-center justify-center rounded-full ${
 isSel
 ? "text-amber-700 dark:text-amber-300 font-semibold"
 : hasToday
 ? "text-[#F05252] dark:text-[#F87171] font-semibold"
 : "text-neutral-700 dark:text-[var(--text-secondary)]"
 }`}
 >
 {dateObj.getDate()}
 </span>

 {/* Multi Event marker dots */}
 <div className="flex justify-center items-center gap-1 h-1 pointer-events-none select-none">
 {hasExam && (
 <span className="w-1 h-1 rounded-full bg-[#EC5E5E] shadow-elevation-0" />
 )}
 {hasQuiz && (
 <span className="w-1 h-1 rounded-full bg-[#FAB005] shadow-elevation-0" />
 )}
 {hasLecture && (
 <span className="w-1 h-1 rounded-full bg-[#4C6EF5] shadow-elevation-0" />
 )}
 </div>
 </motion.button>
 );
 })}
 </motion.div>}

 {activeView === "month" && (
 <div className="w-full touch-pan-y">
   <CalendarMonthView isRtl={isRtl} emptyPaddings={emptyPaddings} calendarDays={calendarDays} getFormattedDate={getFormattedDate} selectedDate={selectedDate} setSelectedDate={setSelectedDate} events={processedEvents} />
 </div>
 )}
 {activeView === "day" && (
 <div className="w-full">
   <CalendarDayView selectedDate={selectedDate} selectedDateEvents={selectedDateEvents} setSelectedDate={setSelectedDate} events={processedEvents} dayTransition={dayTransition} hoursArray={hoursArray} eventDurations={eventDurations} HOUR_HEIGHT={HOUR_HEIGHT} timelineRef={timelineRef} setNewTaskTime={setNewTaskTime} setIsAddingTask={setIsAddingTask} handleSwipeStart={handleSwipeStart} handleSwipeMove={handleSwipeMove} handleSwipeEnd={handleSwipeEnd} setSwipeStartX={setSwipeStartX} swipeTranslateX={swipeTranslateX} parseTimeToMinutes={parseTimeToMinutes} />
 </div>
 )}

 {/* Vertical iOS-Style Agenda section */}
 <div className={activeView === "week" ? "space-y-4" : "hidden"}>
 <div className="flex items-center justify-between px-1">
 <h3 className="text-body font-semibold text-neutral-850 dark:text-[var(--text-primary)]">
 {isRtl ? "أجندة اليوم" : "Agenda"}
 </h3>
 <span className="text-caption font-semibold text-neutral-500 dark:text-[#EBEBF599] dark:text-[var(--text-muted)]">
 {selectedDateEvents.length}{" "}
 {selectedDateEvents.length === 1 ? "event" : "events"}
 </span>
 </div>

 <motion.div
 variants={agendaListVariants}
 initial="hidden"
 animate="show"
 className="space-y-3"
 >
 {selectedDateEvents.length > 0 ? (
 selectedDateEvents.map((ev) => (
 <MobileAgendaItem key={ev.id} ev={ev} isRtl={isRtl} />
 ))
 ) : (
 // Empty State Agenda card
 <motion.div
 variants={agendaItemVariants}
 className="ios-staggered-card p-12 text-center bg-white dark:bg-[#1C1C1E] rounded-xl shadow-elevation-1 ring-1 ring-black/[0.03] dark:ring-white/10 flex flex-col items-center justify-center w-full antialiased transition duration-normal"
 >
 <div className="relative mb-6">
 
 <div className="relative w-20 h-20 rounded-full bg-white dark:bg-[#1C1C1E] flex items-center justify-center ring-1 ring-black/[0.04] dark:ring-white/[0.06] shadow-elevation-1 dark:shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
 <FileCheck className="w-10 h-10 text-neutral-500 dark:text-[#EBEBF599] dark:text-[var(--text-muted)]" />
 </div>
 </div>
 <div>
 <p className="font-display font-semibold text-xl text-neutral-900 dark:text-[var(--text-primary)] mb-2">
 {isRtl ? "لا توجد فعاليات مبرمجة" : "No schedules today"}
 </p>
 <p className="text-base font-medium text-neutral-500 dark:text-[var(--text-secondary)] max-w-[280px] mx-auto mt-1 text-balance">
 {isRtl
 ? "لا توجد محاضرات، امتحانات أو كويزات مسجلة لهذا اليوم. استمتع بيومك الدراسي الاستثنائي!"
 : "Your list is empty. Take this study block to review lectures or rest for upcoming subjects."}
 </p>
 </div>
 </motion.div>
 )}
 </motion.div>
 </div>
 </motion.div>
 </div>

 {/* TABLET / DESKTOP ARCHITECTURE (iPad/Mac Grid Perspective) */}
 <div className="hidden md:block space-y-section">
 {/* 1. Header Toolbar Actions */}
 {/* Unified Header has been moved to the top */}

 {/* 2. Calendar Board */}
 <div
 id="left_middle_deck"
 className="w-full bg-white dark:bg-[#1C1C1E] border border-neutral-150 dark:border-white/[0.10] p-card-padding rounded-lg shadow-elevation-1 space-y-section transition duration-normal"
 >
 {/* NAVIGATION BAR - MONTHS */}
 <div
 id="month_banner_nav"
 className="flex flex-col sm:flex-row justify-between items-center px-1 py-1 gap-3 select-none"
 >
 <div className="flex items-center gap-2 relative z-50">
 <span
 role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }} onClick={(e) => {
 e.stopPropagation();
 setShowMiniCalendar(!showMiniCalendar);
 }}
 className="text-neutral-900 dark:text-[var(--text-primary)] text-title font-semibold font-sans select-none flex items-center pr-4 cursor-pointer hover:opacity-80 transition-opacity"
 >
 {activeView === "month" &&
 `${monthNames[currentMonth]} ${currentYear}`}
 {activeView === "week" &&
 `${isRtl ? "الأسبوع المختار" : "Week of"} ${pLocalDate.toLocaleDateString(language === "ar" ? "ar-EG" : "en-US", { month: "long", day: "numeric" })}, ${currentYear}`}
 {activeView === "day" &&
 `${isRtl ? "اليوم المختار" : "Timeline for"} ${pLocalDate.toLocaleDateString(language === "ar" ? "ar-EG" : "en-US", { month: "long", day: "numeric" })}, ${currentYear}`}
 <ChevronDown className="w-icon-md h-icon-md ml-2 text-neutral-500 dark:text-[#EBEBF599]" />
 </span>
 {renderMiniCalendar()}
 </div>

 <div className="flex items-center gap-4">
 <motion.button
 id="month_nav_today_btn"
 initial={{ opacity: 0, scale: 0.8 }}
 animate={{ opacity: 1, scale: 1 }}
 transition={{ type: "spring" as const, stiffness: 400, damping: 40, mass: 1 }}
 whileHover={{ scale: 1.02 }}
 whileTap={{ scale: 0.94 }}
 onClick={handleGoToToday}
 className="relative px-4 py-2 bg-white dark:bg-[#2C2C2E] hover:bg-neutral-50 dark:hover:bg-white/[0.18] text-rose-600 dark:text-[#FF453A] text-secondary-label font-semibold rounded-lg cursor-pointer transition-colors shadow-elevation-1 border border-black/5 dark:border-white/[0.12] flex items-center gap-2 shrink-0"
 >
 <span>{isRtl ? "اليوم" : "Today"}</span>
 {selectedDate !== formatLocalDate(new Date()) && (
 <motion.span 
 animate={{ scale: [1, 1.2, 1], opacity: [0.8, 1, 0.8] }}
 transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
 className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-rose-600 dark:bg-[#FF453A] ring-2 ring-white dark:ring-neutral-900" 
 />
 )}
 </motion.button>

 <div className="flex items-center gap-1">
 <motion.button
 id="month_nav_prev_btn"
 whileHover={{ scale: 1.05 }}
 whileTap={{ scale: 0.95 }}
 onClick={() => {
 if (activeView === "month") handlePrevMonth();
 else if (activeView === "week") handlePrevWeek();
 else handlePrevDay();
 }}
 className="w-icon-xl h-icon-xl hover:bg-neutral-100 dark:hover:bg-white/[0.12] text-neutral-600 dark:text-[var(--text-secondary)] rounded-full cursor-pointer flex items-center justify-center shrink-0 transition"
 >
 {isRtl ? (
 <ChevronRight className="w-icon-md h-icon-md" />
 ) : (
 <ChevronLeft className="w-icon-md h-icon-md" />
 )}
 </motion.button>
 <motion.button
 id="month_nav_next_btn"
 whileHover={{ scale: 1.05 }}
 whileTap={{ scale: 0.95 }}
 onClick={() => {
 if (activeView === "month") handleNextMonth();
 else if (activeView === "week") handleNextWeek();
 else handleNextDay();
 }}
 className="w-icon-xl h-icon-xl hover:bg-neutral-100 dark:hover:bg-white/[0.12] text-neutral-600 dark:text-[var(--text-secondary)] rounded-full cursor-pointer flex items-center justify-center shrink-0 transition"
 >
 {isRtl ? (
 <ChevronLeft className="w-icon-md h-icon-md" />
 ) : (
 <ChevronRight className="w-icon-md h-icon-md" />
 )}
 </motion.button>
 </div>
 </div>
 </div>

 {/* View Switcher Container */}
 <div
 className="w-full pt-1 grid"
 style={{
 fontFamily:
 '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
 }}
 >
 <AnimatePresence>
 {activeView === "month" && (
 <motion.div
 key="month-view"
 style={{ gridArea: "1 / 1" }}
  initial={{ opacity: 1, x: -20 }}
 animate={{ opacity: 1, x: 0,  }}
 exit={{ opacity: 0, x: 20 }}
 transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
 className="w-full touch-pan-y"
 onTouchStart={(e) => setSwipeStartX(e.targetTouches[0].clientX)}
 onTouchEnd={(e) => {
 if (swipeStartX === null) return;
 const diff = e.changedTouches[0].clientX - swipeStartX;
 // Lower sensitivity for month view
 if (diff > 100) {
 isRtl ? handleNextMonth() : handlePrevMonth();
 } else if (diff < -100) {
 isRtl ? handlePrevMonth() : handleNextMonth();
 }
 setSwipeStartX(null);
 }}
 >
 <CalendarMonthView isRtl={isRtl} emptyPaddings={emptyPaddings} calendarDays={calendarDays} getFormattedDate={getFormattedDate} selectedDate={selectedDate} setSelectedDate={setSelectedDate} events={processedEvents} />
 </motion.div>
 )}
 {activeView === "week" && (
 <motion.div
 key="week-view"
 style={{ gridArea: "1 / 1" }}
  initial={{ opacity: 1, x: -20 }}
 animate={{ opacity: 1, x: 0,  }}
 exit={{ opacity: 0, x: 20 }}
 transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
 className="w-full touch-pan-y"
 onTouchStart={(e) => setSwipeStartX(e.targetTouches[0].clientX)}
 onTouchEnd={(e) => {
 if (swipeStartX === null) return;
 const diff = e.changedTouches[0].clientX - swipeStartX;
 if (diff > 50) {
 isRtl ? handleNextWeek() : handlePrevWeek();
 } else if (diff < -50) {
 isRtl ? handlePrevWeek() : handleNextWeek();
 }
 setSwipeStartX(null);
 }}
 >
 <CalendarWeekView isRtl={isRtl} activeWeekDays={activeWeekDays} selectedDate={selectedDate} setSelectedDate={setSelectedDate} events={processedEvents} />
 </motion.div>
 )}
 {activeView === "day" && (
 <motion.div
 key="day-view"
 style={{ gridArea: "1 / 1" }}
  initial={{ opacity: 1, x: -20 }}
 animate={{ opacity: 1, x: 0,  }}
 exit={{ opacity: 0, x: 20 }}
 transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
 className="w-full"
 >
 <CalendarDayView selectedDate={selectedDate} selectedDateEvents={selectedDateEvents} setSelectedDate={setSelectedDate} events={processedEvents} dayTransition={dayTransition} hoursArray={hoursArray} eventDurations={eventDurations} HOUR_HEIGHT={HOUR_HEIGHT} timelineRef={timelineRef} setNewTaskTime={setNewTaskTime} setIsAddingTask={setIsAddingTask} handleSwipeStart={handleSwipeStart} handleSwipeMove={handleSwipeMove} handleSwipeEnd={handleSwipeEnd} setSwipeStartX={setSwipeStartX} swipeTranslateX={swipeTranslateX} parseTimeToMinutes={parseTimeToMinutes} />
 </motion.div>
 )}
 </AnimatePresence>
 </div>
 </div>
 </div>

 {/* Floating Apple-Style Context Menu */}
 <AnimatePresence>
 {toast && (
 <motion.div
 initial={{ opacity: 0, y: -45, scale: 0.92, x: "-50%" }}
 animate={{ opacity: 1, y: 0, scale: 1, x: "-50%" }}
 exit={{ opacity: 0, y: -45, scale: 0.92, x: "-50%" }}
 transition={{ type: "spring" as const, stiffness: 400, damping: 40, mass: 1 }}
 className="fixed top-6 left-1/2 z-[100] bg-neutral-900/95 dark:bg-white/95 text-white dark:text-neutral-900 backdrop-blur-sm px-5 py-3 rounded-full border border-neutral-800/10 dark:border-neutral-200/50 shadow-elevation-1 flex items-center gap-3 text-caption font-semibold"
 style={{ direction: isRtl ? "rtl" : "ltr" }}
 >
 <span className="w-2 h-2 rounded-full bg-[#007AFF] dark:bg-[#0BE5FF] animate-pulse shrink-0" />
 <span className="truncate max-w-[280px]">{toast.message}</span>
 </motion.div>
 )}
 </AnimatePresence>
 </div>
 );
});


export default memo(CalendarView);
