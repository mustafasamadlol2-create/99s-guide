import { safeJsonParse } from "../../../core/utils/safeJson";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { CalendarEvent, Subject, SubjectId } from "../../../core/types";
import { Language } from "../../../core/i18n/translations";

interface UseCalendarProps {
 events: CalendarEvent[];
 subjects: Subject[];
 onAddEvent: (newEvent: CalendarEvent) => void;
 onUpdateEvents?: (updatedEvents: CalendarEvent[]) => void;
 language: Language;
}

import { parseLocalDate, formatLocalDate } from "../../../core/utils/dateUtils";

export function useCalendar({
 events,
 subjects,
 onAddEvent,
 onUpdateEvents,
 language,
}: UseCalendarProps) {
 const isRtl = language === "ar";

 const isMountedRef = useRef(true);
 useEffect(() => {
 isMountedRef.current = true;
 return () => {
 isMountedRef.current = false;
 };
 }, []);

 const [activeView, setActiveView] = useState<"month" | "week" | "day">(() => {
 try {
 const saved = localStorage.getItem("uob_active_view");
 return (saved as "month" | "week" | "day") || "week";
 } catch {
 return "week";
 }
 });

 // Custom navigation parameters
 const [selectedDate, setSelectedDate] = useState<string>(() => {
 return formatLocalDate(new Date());
 });
 const [currentYear, setCurrentYear] = useState<number>(() => {
 return new Date().getFullYear();
 });
 const [currentMonth, setCurrentMonth] = useState<number>(() => {
 return new Date().getMonth();
 });

 // Persist calendar perspective states when changed
 useEffect(() => {
 try {
 localStorage.setItem("uob_active_view", activeView);
 } catch {}
 }, [activeView]);

 useEffect(() => {
 try {
 localStorage.setItem("uob_selected_date", selectedDate);
 } catch {}
 }, [selectedDate]);

 useEffect(() => {
 try {
 localStorage.setItem("uob_current_year", String(currentYear));
 } catch {}
 }, [currentYear]);

 useEffect(() => {
 try {
 localStorage.setItem("uob_current_month", String(currentMonth));
 } catch {}
 }, [currentMonth]);

 // --- Smart Day View Interactive States ---
 const [eventDurations, setEventDurations] = useState<{
 [eventId: string]: number;
 }>(() => {
 try {
 const saved = localStorage.getItem("app_event_durations_v1");
 if (saved) return safeJsonParse(saved, null);
 } catch (e) {}
 return {};
 });

 // Swipe gesture for navigating calendar days (left/right)
 const [swipeStartX, setSwipeStartX] = useState<number | null>(null);
 const [dayTransition, setDayTransition] = useState<"left" | "right" | null>(
 null,
 );

 // Sync event durations to localStorage on change
 useEffect(() => {
 localStorage.setItem(
 "app_event_durations_v1",
 JSON.stringify(eventDurations),
 );
 }, [eventDurations]);

 const [isAddingTask, setIsAddingTask] = useState(false);

 // New task form fields
 const [newTaskTitle, setNewTaskTitle] = useState("");
 const [newTaskTime, setNewTaskTime] = useState("09:00");
 const [newTaskDesc, setNewTaskDesc] = useState("");
 const [newTaskSubjectId, setNewTaskSubjectId] = useState<SubjectId>(
 subjects[0]?.id || ("ID" as SubjectId),
 );
 const [shareSuccess, setShareSuccess] = useState(false);

 // ---- Click Comment Personal Overlays ----
 // Update default task subject identifier dynamically to first loaded subject
 useEffect(() => {
 if (
 subjects.length > 0 &&
 (newTaskSubjectId === "ID" ||
 !subjects.some((s) => s.id === newTaskSubjectId))
 ) {
 setNewTaskSubjectId(subjects[0].id);
 }
 }, [subjects, newTaskSubjectId]);

 // Flat array of lectures to link tasks to
 const flatLectures: { id: string; title: string; subjectId: SubjectId }[] =
 [];
 subjects.forEach((s) => {
 s.modules.forEach((m) => {
 m.lectures.forEach((l) => {
 flatLectures.push({ id: l.id, title: l.title, subjectId: s.id });
 });
 });
 });

 const [linkedLectureId, setLinkedLectureId] = useState<string>(
 flatLectures[0]?.id || "",
 );

 // Month labels dictionary
 const monthNamesEn = [
 "January",
 "February",
 "March",
 "April",
 "May",
 "June",
 "July",
 "August",
 "September",
 "October",
 "November",
 "December",
 ];

 const monthNamesAr = [
 "كانون الثاني (1)",
 "شباط (2)",
 "آذار (3)",
 "نيسان (4)",
 "أيار (5)",
 "حزيران (6)",
 "تموز (7)",
 "آب (8)",
 "أيلول (9)",
 "تشرين الأول (10)",
 "تشرين الثاني (11)",
 "كانون الأول (12)",
 ];

 const monthNames = isRtl ? monthNamesAr : monthNamesEn;

 // Sync selected date when paging months to first date of that month
 const syncNavToMonth = useCallback(
 (yr: number, mo: number) => {
 const moStr = mo + 1 < 10 ? `0${mo + 1}` : `${mo + 1}`;
 setSelectedDate(`${yr}-${moStr}-01`);
 },
 [setSelectedDate],
 );

 // ---- Dynamic Month pagination ----
 const handlePrevMonth = useCallback(() => {
 let nextMonth = currentMonth - 1;
 let nextYear = currentYear;
 if (nextMonth < 0) {
 nextMonth = 11;
 nextYear = currentYear - 1;
 }
 // Limit range to 2025-2027
 if (nextYear >= 2025) {
 setCurrentMonth(nextMonth);
 setCurrentYear(nextYear);
 syncNavToMonth(nextYear, nextMonth);
 }
 }, [currentMonth, currentYear, syncNavToMonth]);

 const handleNextMonth = useCallback(() => {
 let nextMonth = currentMonth + 1;
 let nextYear = currentYear;
 if (nextMonth > 11) {
 nextMonth = 0;
 nextYear = currentYear + 1;
 }
 // Limit range to 2027-12
 if (nextYear <= 2027) {
 setCurrentMonth(nextMonth);
 setCurrentYear(nextYear);
 syncNavToMonth(nextYear, nextMonth);
 }
 }, [currentMonth, currentYear, syncNavToMonth]);

 const handleGoToToday = useCallback(() => {
 const today = new Date();
 setSelectedDate(formatLocalDate(today));
 setCurrentMonth(today.getMonth());
 setCurrentYear(today.getFullYear());
 }, [setSelectedDate, formatLocalDate]);

 // Math dynamics to build any calendar grid on fly
 const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
 const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay(); // Sunday=0, Monday=1...

 // Custom days list
 const calendarDays = useMemo(
 () => Array.from({ length: daysInMonth }, (_, i) => i + 1),
 [daysInMonth],
 );
 const emptyPaddings = useMemo(
 () => Array.from({ length: firstDayIndex }, (_, i) => i),
 [firstDayIndex],
 );

 // Formatted date generator
 const getFormattedDate = useCallback(
 (dayNum: number) => {
 const moStr =
 currentMonth + 1 < 10 ? `0${currentMonth + 1}` : `${currentMonth + 1}`;
 const dayStr = dayNum < 10 ? `0${dayNum}` : `${dayNum}`;
 return `${currentYear}-${moStr}-${dayStr}`;
 },
 [currentMonth, currentYear],
 );

 // Synchronize currentMonth and currentYear of Month View to always match selectedDate
 useEffect(() => {
 if (selectedDate) {
 const parts = selectedDate.split("-");
 if (parts.length === 3) {
 const yr = parseInt(parts[0], 10);
 const mo = parseInt(parts[1], 10) - 1; // 0-indexed
 if (!isNaN(yr) && !isNaN(mo)) {
 if (currentYear !== yr) {
 setCurrentYear(yr);
 }
 if (currentMonth !== mo) {
 setCurrentMonth(mo);
 }
 }
 }
 }
 }, [selectedDate]);

 // Week View Calculations: Determine standard Sunday to Saturday days matching selectedDate
 const getActiveWeekDays = useCallback((baseDateStr: string) => {
 const d = parseLocalDate(baseDateStr);
 const dayOfWeek = d.getDay(); // 0 is Sunday, 1 is Monday...
 const days: Date[] = [];
 for (let i = 0; i < 5; i++) {
 const copy = new Date(d);
 copy.setDate(d.getDate() - dayOfWeek + i);
 days.push(copy);
 }
 return days;
 }, []);

 const activeWeekDays = useMemo(
 () => getActiveWeekDays(selectedDate),
 [selectedDate, getActiveWeekDays],
 );

 // Week navigations (Moves by 7 days)
 const handlePrevWeek = useCallback(() => {
 const d = parseLocalDate(selectedDate);
 d.setDate(d.getDate() - 7);
 setSelectedDate(formatLocalDate(d));
 // Sync month headers
 setCurrentMonth(d.getMonth());
 setCurrentYear(d.getFullYear());
 }, [selectedDate, setSelectedDate, formatLocalDate]);

 const handleNextWeek = useCallback(() => {
 const d = parseLocalDate(selectedDate);
 d.setDate(d.getDate() + 7);
 setSelectedDate(formatLocalDate(d));
 // Sync month headers
 setCurrentMonth(d.getMonth());
 setCurrentYear(d.getFullYear());
 }, [selectedDate, setSelectedDate, formatLocalDate]);

 // Day navigation increment/decrement by 1 with gorgeous physics transition timers
 const handlePrevDay = useCallback(() => {
 setDayTransition("left");
 const d = parseLocalDate(selectedDate);
 d.setDate(d.getDate() - 1);
 setSelectedDate(formatLocalDate(d));
 setCurrentMonth(d.getMonth());
 setCurrentYear(d.getFullYear());
 setTimeout(() => {
 if (isMountedRef.current) {
 setDayTransition(null);
 }
 }, 300);
 }, [selectedDate, setSelectedDate, formatLocalDate]);

 const handleNextDay = useCallback(() => {
 setDayTransition("right");
 const d = parseLocalDate(selectedDate);
 d.setDate(d.getDate() + 1);
 setSelectedDate(formatLocalDate(d));
 setCurrentMonth(d.getMonth());
 setCurrentYear(d.getFullYear());
 setTimeout(() => {
 if (isMountedRef.current) {
 setDayTransition(null);
 }
 }, 300);
 }, [selectedDate, setSelectedDate, formatLocalDate]);

 // Submit personal study task
 const handleCreateTaskSubmit = (e: React.FormEvent) => {
 e.preventDefault();
 if (!newTaskTitle.trim()) return;

 const newEvent: CalendarEvent = {
 id: `task_${Date.now()}`,
 title: newTaskTitle,
 type: "other",
 date: selectedDate,
 time: newTaskTime,
 description: `${newTaskDesc} (Linked lecture: ${flatLectures.find((l) => l.id === linkedLectureId)?.title || "None"})`,
 isPublic: false,
 subjectId: newTaskSubjectId,
 lectureId: linkedLectureId,
 };

 onAddEvent(newEvent);

 // Clear
 setNewTaskTitle("");
 setNewTaskDesc("");
 setIsAddingTask(false);
 };

 const handlePrint = () => {
 window.print();
 };

 const handleShare = () => {
 try {
  const shareText = `Calendar Export [Selected: ${selectedDate}]`;
 if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(shareText);
 } catch (err) {
 
 }
 setShareSuccess(true);
 setTimeout(() => {
 if (isMountedRef.current) {
 setShareSuccess(false);
 }
 }, 2500);
 };

 // --- iOS/Flutter Inspired Physics Day View Renders ---
 const HOUR_HEIGHT = 80; // 80px height for each hour row
 const timelineRef = useRef<HTMLDivElement>(null);

 // Soft haptic vibrator helper to make snaps and actions feel rewarding
 const triggerHaptic = (pattern: number | number[]) => {
 if (
 typeof window !== "undefined" &&
 window.navigator &&
 window.navigator.vibrate
 ) {
 try {
 window.navigator.vibrate(pattern);
 } catch (e) {}
 }
 };

 // Time conversion helper helpers
 const parseTimeToMinutes = useCallback((timeStr: string) => {
 const [h, m] = timeStr.split(":").map(Number);
 return h * 60 + (m || 0);
 }, []);

 const formatMinutesToTime = useCallback((totalMinutes: number) => {
 const h = Math.floor(totalMinutes / 60);
 const m = totalMinutes % 60;
 return `${h < 10 ? "0" : ""}${h}:${m < 10 ? "0" : ""}${m}`;
 }, []);

 // Day swipe gestures (extremely smooth iOS translation feel with elastic real-time preview)
 const [swipeTranslateX, setSwipeTranslateX] = useState<number>(0);
 const swipeStartYRef = useRef<number | null>(null);

 const handleSwipeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
 const target = e.target as HTMLElement;
 if (target.closest(".interactive-node") || target.closest("button")) return;

 try {
 e.currentTarget.setPointerCapture(e.pointerId);
 } catch (err) {}

 setSwipeStartX(e.clientX);
 swipeStartYRef.current = e.clientY;
 setSwipeTranslateX(0);
 }, [setSwipeStartX]);

 const handleSwipeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
 if (swipeStartX === null) return;
 const diffX = e.clientX - swipeStartX;

 // Permit scrolling if swipe is primarily vertical
 if (swipeStartYRef.current !== null) {
 const diffY = e.clientY - swipeStartYRef.current;
 if (Math.abs(diffY) > Math.abs(diffX) * 1.6 && Math.abs(diffX) < 15) {
 setSwipeStartX(null);
 swipeStartYRef.current = null;
 setSwipeTranslateX(0);
 return;
 }
 }

 setSwipeTranslateX(diffX);
 }, [swipeStartX, setSwipeStartX]);

 const handleSwipeEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
 if (swipeStartX === null) return;
 try {
 e.currentTarget.releasePointerCapture(e.pointerId);
 } catch (err) {}

 const diffX = e.clientX - swipeStartX;
 setSwipeStartX(null);
 swipeStartYRef.current = null;

 // Filter minimum drag thresholds
 if (Math.abs(diffX) > 85) {
 triggerHaptic(18); // iOS level page swipe confirmation click
 if (diffX > 0) {
 isRtl ? handleNextDay() : handlePrevDay();
 } else {
 isRtl ? handlePrevDay() : handleNextDay();
 }
 }

 // Fluidly spring back to rest position
 setSwipeTranslateX(0);
 }, [swipeStartX, setSwipeStartX, isRtl, handleNextDay, handlePrevDay]);

 // Filter events of selected date
 const selectedDateEvents = useMemo(() => {
 return events.filter((e) => e.date === selectedDate);
 }, [events, selectedDate]);

 // 24 Hours list (0 to 23)
 const hoursArray = useMemo(
 () => Array.from({ length: 24 }, (_, i) => i),
 [],
 );

 return {
 isRtl,
 activeView,
 setActiveView,
 selectedDate,
 setSelectedDate,
 currentYear,
 currentMonth,
 monthNames,
 handlePrevMonth,
 handleNextMonth,
 handleGoToToday,
 handlePrevWeek,
 handleNextWeek,
 handlePrevDay,
 handleNextDay,
 calendarDays,
 emptyPaddings,
 getFormattedDate,
 activeWeekDays,
 eventDurations,
 setEventDurations,
 swipeStartX,
 setSwipeStartX,
 swipeTranslateX,
 dayTransition,
 isAddingTask,
 setIsAddingTask,
 newTaskTitle,
 setNewTaskTitle,
 newTaskTime,
 setNewTaskTime,
 newTaskDesc,
 setNewTaskDesc,
 newTaskSubjectId,
 setNewTaskSubjectId,
 shareSuccess,
 flatLectures,
 linkedLectureId,
 setLinkedLectureId,
 handleCreateTaskSubmit,
 handlePrint,
 handleShare,
 HOUR_HEIGHT,
 timelineRef,
 parseTimeToMinutes,
 formatMinutesToTime,
 handleSwipeStart,
 handleSwipeMove,
 handleSwipeEnd,
 selectedDateEvents,
 hoursArray,
 };
}
