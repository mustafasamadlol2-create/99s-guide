import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect, Suspense, memo, lazy } from "react";
import { motion } from "motion/react";
import { Calendar, ChevronRight, CircleCheck, Clock, BarChart, FileText, PenTool, PlayCircle, HelpCircle, Layers, Star } from "lucide-react";
import { CalendarEvent } from "../../../core/types";
import { HapticFeedback } from "../../../core/device/haptic";

interface LectureListItemProps {
 lecture: any;
 activeTrack: "Theory" | "Practical";
 activeSubSubject: string;
 activeDepartment: string | null;
 isRtl: boolean;
 isTouchDevice: boolean;
 calendarEvents: CalendarEvent[];
 legProgress: {
 pdf: boolean;
 notes: boolean;
 quiz: boolean;
 video: boolean;
 flash: boolean;
 };
 complPct: number;
 onSelectLecture: (lecture: any, tab?: "pdf" | "notes" | "mcqs" | "flashcards" | "videos" | "qa") => void;
 showHapticToast: (title: string, description: string) => void;
 subjectName: string;
}

// Highly optimized card contents component positioned inside ContextMenu rendered tree
 const LectureListItemContent = memo(function LectureListItemContent({
 lecture,
 isRtl,
 isTouchDevice,
 dateBadge,
 legProgress,
 complPct,
 onSelectLecture,
 }: {
 lecture: any;
 isRtl: boolean;
 isTouchDevice: boolean;
 dateBadge: { date: string; time: string } | null;
 legProgress: {
 pdf: boolean;
 notes: boolean;
 quiz: boolean;
 video: boolean;
 flash: boolean;
 };
 complPct: number;
 onSelectLecture: (lecture: any, tab?: "pdf" | "notes" | "mcqs" | "flashcards" | "videos" | "qa") => void;
 }) {
 return (
 <div
 id={`lecture-row-${lecture.id}`}
 onClick={() => {
 HapticFeedback.impact("light");
 onSelectLecture(lecture);
 }}
 className={`
 relative flex flex-col justify-between gap-3 p-4 sm:p-5
 rounded-none cursor-pointer select-none overflow-hidden
 transition-colors duration-200
 active:bg-neutral-100 dark:active:bg-[#2C2C2E]
 w-full
 `}
 style={
 {
 WebkitTapHighlightColor: "transparent",
 touchAction: "manipulation",
 } as any
 }
 >
 <div className="flex items-start justify-between gap-4 relative z-10">
 <div className="flex-1 min-w-0">
 <div className="flex flex-wrap items-center gap-2 mb-2">
 <span className="text-xs font-semibold uppercase text-neutral-500 dark:text-[#EBEBF599]">
 {isRtl ? `المحاضرة ${lecture.orderNumber}` : `Lecture ${lecture.orderNumber}`}
 </span>
 {dateBadge && (
 <>
 <span className="w-1 h-1 rounded-full bg-neutral-300 dark:bg-neutral-700 hidden sm:block" />
 <span className="text-xs font-semibold text-rose-500 flex items-center gap-1">
 <Calendar className="w-3 h-3" />
 {dateBadge.date}
 </span>
 </>
 )}
 </div>
 <h4 className="text-base font-semibold text-neutral-900 dark:text-white transition-colors">
 {lecture.title}
 </h4>
 </div>
 </div>

 <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-4 mt-1 relative z-10">
 <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-1 -mb-1 scrollbar-hide overscroll-x-contain">
 <motion.button 
  type="button"
  whileTap={{ scale: 0.94 }}
  transition={{ type: "spring", stiffness: 400, damping: 25 }}
  disabled={false}
  onClick={(e) => { e.stopPropagation(); HapticFeedback.impact("light"); onSelectLecture(lecture, "pdf"); }}
  className={`disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 px-3 py-1 rounded-md text-xs font-medium shrink-0 
  focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-900 
  hover:opacity-80 transition-colors 
  ${legProgress.pdf ? 'bg-blue-50 text-blue-700 dark:bg-[rgba(191,219,254,0.15)] dark:text-[rgba(191,219,254,1)]' : 'bg-neutral-100 text-neutral-500 dark:bg-[#2C2C2E] dark:text-[#EBEBF599] hover:bg-neutral-200 dark:hover:bg-neutral-800'}`}>
 <FileText className="w-icon-sm h-icon-sm" /> PDF
 </motion.button>
 <motion.button 
  type="button"
  whileTap={{ scale: 0.94 }}
  transition={{ type: "spring", stiffness: 400, damping: 25 }}
  disabled={false}
  onClick={(e) => { e.stopPropagation(); HapticFeedback.impact("light"); onSelectLecture(lecture, "notes"); }}
  className={`disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 px-3 py-1 rounded-md text-xs font-medium shrink-0 
  focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-900 
  hover:opacity-80 transition-colors 
  ${legProgress.notes ? 'bg-purple-50 text-purple-700 dark:bg-[rgba(196,181,253,0.15)] dark:text-[rgba(196,181,253,1)]' : 'bg-neutral-100 text-neutral-500 dark:bg-[#2C2C2E] dark:text-[#EBEBF599] hover:bg-neutral-200 dark:hover:bg-neutral-800'}`}>
 <PenTool className="w-icon-sm h-icon-sm" /> Notes
 </motion.button>
 <motion.button 
  type="button"
  whileTap={{ scale: 0.94 }}
  transition={{ type: "spring", stiffness: 400, damping: 25 }}
  disabled={false}
  onClick={(e) => { e.stopPropagation(); HapticFeedback.impact("light"); onSelectLecture(lecture, "videos"); }}
  className={`disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 px-3 py-1 rounded-md text-xs font-medium shrink-0 
  focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-900 
  hover:opacity-80 transition-colors 
  ${legProgress.video ? 'bg-cyan-50 text-cyan-700 dark:bg-[rgba(165,243,252,0.15)] dark:text-[rgba(165,243,252,1)]' : 'bg-neutral-100 text-neutral-500 dark:bg-[#2C2C2E] dark:text-[#EBEBF599] hover:bg-neutral-200 dark:hover:bg-neutral-800'}`}>
 <PlayCircle className="w-icon-sm h-icon-sm" /> Video
 </motion.button>
 <motion.button 
  type="button"
  whileTap={{ scale: 0.94 }}
  transition={{ type: "spring", stiffness: 400, damping: 25 }}
  disabled={false}
  onClick={(e) => { e.stopPropagation(); HapticFeedback.impact("light"); onSelectLecture(lecture, "mcqs"); }}
  className={`disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 px-3 py-1 rounded-md text-xs font-medium shrink-0 
  focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-900 
  hover:opacity-80 transition-colors 
  ${legProgress.quiz ? 'bg-amber-50 text-amber-700 dark:bg-[rgba(253,230,138,0.15)] dark:text-[rgba(253,230,138,1)]' : 'bg-neutral-100 text-neutral-500 dark:bg-[#2C2C2E] dark:text-[#EBEBF599] hover:bg-neutral-200 dark:hover:bg-neutral-800'}`}>
 <HelpCircle className="w-icon-sm h-icon-sm" /> MCQ
 </motion.button>
 <motion.button 
  type="button"
  whileTap={{ scale: 0.94 }}
  transition={{ type: "spring", stiffness: 400, damping: 25 }}
  disabled={false}
  onClick={(e) => { e.stopPropagation(); HapticFeedback.impact("light"); onSelectLecture(lecture, "flashcards"); }}
  className={`disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 px-3 py-1 rounded-md text-xs font-medium shrink-0 
  focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-900 
  hover:opacity-80 transition-colors 
  ${legProgress.flash ? 'bg-orange-50 text-orange-700 dark:bg-[rgba(253,186,116,0.15)] dark:text-[rgba(253,186,116,1)]' : 'bg-neutral-100 text-neutral-500 dark:bg-[#2C2C2E] dark:text-[#EBEBF599] hover:bg-neutral-200 dark:hover:bg-neutral-800'}`}>
 <Layers className="w-icon-sm h-icon-sm" /> Anki
 </motion.button>
 </div>
 <div className="flex items-center gap-3 shrink-0">
 <span className="text-xs font-medium text-neutral-500 dark:text-[#EBEBF599] hidden sm:block">{isRtl ? "شوهدت مؤخراً" : "Progress"}</span>
 <div className="relative w-9 h-9 flex items-center justify-center bg-neutral-50 dark:bg-[#2C2C2E] rounded-full ring-1 ring-black/[0.04] dark:ring-white/[0.06] shadow-sm">
 <svg
 className="w-full h-full -rotate-90 transform drop-shadow-sm"
 viewBox="0 0 36 36"
 >
 <circle
 cx="18"
 cy="18"
 r="15.5"
 fill="none"
 className="stroke-neutral-200 dark:stroke-white/[0.08]"
 strokeWidth="3"
 />
 <circle
 cx="18"
 cy="18"
 r="15.5"
 fill="none"
 className={`transition-all duration-1000 ease-out ${
 complPct === 100
 ? "stroke-emerald-500 dark:stroke-emerald-400"
 : complPct > 0
 ? "stroke-blue-500 dark:stroke-blue-400"
 : "stroke-transparent"
 }`}
 strokeWidth="3"
 strokeDasharray="97.4"
 style={{ strokeDashoffset: 97.4 - (97.4 * complPct) / 100 }}
 strokeLinecap="round"
 />
 </svg>
 <div className="absolute inset-0 flex items-center justify-center">
 {complPct === 100 ? (
 <CircleCheck className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
 ) : (
 <span className="text-[10px] font-bold text-neutral-700 dark:text-white tracking-tighter">
 {complPct}%
 </span>
 )}
 </div>
 </div>
 </div>
 </div>
 </div>
 );
});

// Memoized Lecture List Item wrapper with accessibility configurations
export const LectureListItem = memo(
 function LectureListItem({
 lecture,
 activeTrack,
 activeSubSubject,
 activeDepartment,
 isRtl,
 isTouchDevice,
 calendarEvents,
 legProgress,
 complPct,
 onSelectLecture,
 }: LectureListItemProps) {
 const matchedEvent = useMemo(() => {
 return calendarEvents?.find((evt) => {
 const isLecType = evt.eventType === "LECTURE" || evt.type === "lecture";
 if (!isLecType) return false;
 if (evt.lectureId && evt.lectureId === lecture.id) return true;
 const evtTitle = (evt.title || "").trim().toLowerCase();
 const lecTitle = (lecture.title || lecture.name || "")
 .trim()
 .toLowerCase();
 return (
 evtTitle === lecTitle ||
 evtTitle.includes(lecTitle) ||
 lecTitle.includes(evtTitle)
 );
 });
 }, [calendarEvents, lecture.id, lecture.title, lecture.name]);

 const dateBadge = useMemo(() => {
 if (!matchedEvent) return null;
 return {
 date: matchedEvent.date,
 time: matchedEvent.time,
 };
 }, [matchedEvent]);

 // Natural Language screen-reader dynamic label for pristine VoiceOver accessibility (Apple guidelines)
 const ariaLabel = useMemo(() => {
 const trackStr = isRtl
 ? activeTrack === "Theory"
 ? "مسار نظري"
 : "مسار عملي"
 : `${activeTrack} Track`;
 const progressStr = isRtl
 ? `نسبة الإنجاز ${complPct} بالمئة`
 : `${complPct}% completed`;
 const scheduleStr = dateBadge
 ? isRtl
 ? `مجدولة بتاريخ ${dateBadge.date} في الساعة ${dateBadge.time}`
 : `Scheduled on ${dateBadge.date} at ${dateBadge.time}`
 : "";

 if (isRtl) {
 return `المحاضرة ${lecture.orderNumber}: ${lecture.title}. ${trackStr}. قسم: ${activeSubSubject}. ${progressStr}. ${scheduleStr}.`;
 }
 return `Lecture ${lecture.orderNumber}: ${lecture.title}. ${trackStr}. Sub-subject: ${activeSubSubject}. ${progressStr}. ${scheduleStr}.`;
 }, [
 lecture.orderNumber,
 lecture.title,
 activeTrack,
 activeSubSubject,
 complPct,
 dateBadge,
 isRtl,
 ]);

 return (
 <div aria-label={ariaLabel}>
 <LectureListItemContent lecture={lecture} isRtl={isRtl} isTouchDevice={isTouchDevice} dateBadge={dateBadge} legProgress={legProgress} complPct={complPct} onSelectLecture={onSelectLecture} />
 </div>
 );
 },
 (prevProps, nextProps) => {
 return (
 prevProps.lecture.id === nextProps.lecture.id &&
 prevProps.lecture.title === nextProps.lecture.title &&
 prevProps.activeTrack === nextProps.activeTrack &&
 prevProps.activeSubSubject === nextProps.activeSubSubject &&
 prevProps.activeDepartment === nextProps.activeDepartment &&
 prevProps.isRtl === nextProps.isRtl &&
 prevProps.isTouchDevice === nextProps.isTouchDevice &&
 prevProps.complPct === nextProps.complPct &&
 prevProps.legProgress.pdf === nextProps.legProgress.pdf &&
 prevProps.legProgress.notes === nextProps.legProgress.notes &&
 prevProps.legProgress.quiz === nextProps.legProgress.quiz &&
 prevProps.legProgress.video === nextProps.legProgress.video &&
 prevProps.legProgress.flash === nextProps.legProgress.flash &&
 prevProps.calendarEvents === nextProps.calendarEvents
 );
 },
);
