/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useMemo, memo } from 'react';
import { motion, AnimatePresence } from "motion/react";
import { CalendarEvent } from "../../../core/types";
import { getEventIconInfo, PRIORITY, getEventPriority, getEventCardStyles } from "./EventIcon";

import { to12HourFormatStr } from "../../../core/utils/dateUtils";

interface MonthDayCellProps {
 day: number;
 dayDate: string;
 isSelected: boolean;
 todayYear: number;
 todayMonth: number;
 todayDay: number;
 dayEvents: CalendarEvent[];
 setSelectedDate: (date: string) => void;
 isRtl: boolean;
 isPhone: boolean;
}

const MonthDayCell = memo(function MonthDayCell({
 day,
 dayDate,
 isSelected,
 todayYear,
 todayMonth,
 todayDay,
 dayEvents,
 setSelectedDate,
  isRtl,
  isPhone,
}: MonthDayCellProps) {
 let isToday = false;
 const dateParts = dayDate.split("-");
 if (dateParts.length === 3) {
 const y = parseInt(dateParts[0], 10);
 const m = parseInt(dateParts[1], 10) - 1;
 const d = parseInt(dateParts[2], 10);
 isToday = y === todayYear && m === todayMonth && d === todayDay;
 }

 const chronologicalEvents = useMemo(() => {
 return [...dayEvents].sort((a, b) => {
 const timeA = a.time ? parseInt(a.time.replace(":", ""), 10) : Number.MAX_SAFE_INTEGER;
 const timeB = b.time ? parseInt(b.time.replace(":", ""), 10) : Number.MAX_SAFE_INTEGER;
 return timeA - timeB;
 });
 }, [dayEvents]);

 const priorityEvents = useMemo(() => {
 return [...dayEvents].sort((a, b) => getEventPriority(a) - getEventPriority(b));
 }, [dayEvents]);

 const visibleEvents = chronologicalEvents.slice(0, 3);
 const hiddenCount = Math.max(0, chronologicalEvents.length - 3);
 const [showPopover, setShowPopover] = useState(false);

 let cellBgClass = isPhone
   ? "bg-neutral-50/55 dark:bg-[#1C1C1E]/45"
   : "bg-neutral-50/40 dark:bg-[#1C1C1E]/30 hover:bg-neutral-100/60 dark:hover:bg-white/[0.12]/60";
 let cellBorderClass = "border border-neutral-200/40 dark:border-white/[0.04]";
 let badgeClass = "text-neutral-500 dark:text-[#EBEBF599] font-semibold text-sm font-sans";
 let ringClass = isSelected
   ? "ring-2 ring-neutral-900/10 dark:ring-white/10 z-10 shadow-elevation-1"
   : isPhone
     ? "shadow-elevation-1"
     : "shadow-elevation-1 hover:shadow-elevation-1";

 if (priorityEvents.length > 0) {
 const topPriority = getEventPriority(priorityEvents[0]);
 if (topPriority === PRIORITY.EXAM) {
 cellBgClass = isPhone ? "bg-red-50/70 dark:bg-red-950/25" : "bg-red-50/60 dark:bg-red-950/20 hover:bg-red-50/90 dark:hover:bg-red-900/30";
 cellBorderClass = "border border-red-200/80 dark:border-red-900/50";
 
 } else if (topPriority === PRIORITY.QUIZ) {
 cellBgClass = isPhone ? "bg-orange-50/65 dark:bg-orange-950/25" : "bg-orange-50/50 dark:bg-orange-950/20 hover:bg-orange-50/80 dark:hover:bg-orange-900/30";
 cellBorderClass = "border border-orange-200/60 dark:border-orange-900/40";
 
 } else if (topPriority === PRIORITY.LECTURE || topPriority === PRIORITY.ASSIGNMENT) {
 cellBgClass = isPhone ? "bg-blue-50/55 dark:bg-blue-950/25" : "bg-blue-50/40 dark:bg-blue-950/20 hover:bg-blue-50/60 dark:hover:bg-blue-900/30";
 cellBorderClass = "border border-blue-200/50 dark:border-blue-900/30";
 
 } else if (topPriority === PRIORITY.HOLIDAY) {
 cellBgClass = isPhone ? "bg-emerald-50/45 dark:bg-emerald-950/25" : "bg-emerald-50/30 dark:bg-emerald-950/20 hover:bg-emerald-50/50 dark:hover:bg-emerald-900/30";
 cellBorderClass = "border border-emerald-200/40 dark:border-emerald-800/30";
 
 }
 }

 const hasCompletedLecture = dayEvents.some(ev => ev.isCompleted && (ev.type === "lecture" || ev.eventType === "LECTURE" || ev.title.toLowerCase().includes("lecture")));

  if (isToday) {
 badgeClass = "text-[#ff3b30] font-bold";
    cellBorderClass = "border border-[#ff3b30]/60 dark:border-[#ff3b30]/50";
 ringClass = isPhone
   ? "shadow-[0_0_15px_rgba(255,59,48,0.15)] dark:shadow-[0_0_15px_rgba(255,59,48,0.1)] z-10"
   : "shadow-[0_0_15px_rgba(255,59,48,0.15)] dark:shadow-[0_0_15px_rgba(255,59,48,0.1)] z-10 hover:shadow-[0_0_20px_rgba(255,59,48,0.2)]";
    if (isSelected) ringClass += " ring-2 ring-[#ff3b30]/40";
 } else if (isSelected && priorityEvents.length === 0) {
 ringClass += " ring-2 ring-neutral-900/10 dark:ring-white/10 z-10 shadow-elevation-1";
 } else if (isSelected) {
 ringClass += " ring-2 ring-neutral-900/10 dark:ring-white/10 z-10 shadow-elevation-1";
 }

 const handleDayClick = useCallback(() => {
 setSelectedDate(dayDate);
 if (showPopover) setShowPopover(false);
 }, [dayDate, setSelectedDate,
      isRtl, showPopover]);

 return (
 <div
 key={`day-${day}`}
  className={`group relative ${isPhone ? "calendar-month-phone-cell rounded-[11px]" : "min-h-[86px] aspect-square rounded-lg"} w-full flex flex-col justify-start items-stretch text-left transition duration-200 select-none ${showPopover ? "z-50" : "z-0"}
 ${cellBgClass} ${cellBorderClass} ${ringClass}
 `}
 >
 <button
 onClick={handleDayClick}
 className={`absolute inset-0 w-full h-full cursor-pointer ${isPhone ? "rounded-[11px]" : "rounded-lg"}`}
 aria-label={`Select date ${dayDate}`}
 />
 <div className={`relative pointer-events-none ${isPhone ? "px-1.5 py-1.5" : "px-1 py-1"} flex flex-col justify-start items-stretch w-full h-full overflow-hidden`}>
 {/* Day Header with numbers and indicator dots */}
        <div className={`flex items-start w-full shrink-0 ${isPhone ? "justify-center mb-0 px-0 pt-0" : "justify-between mb-0.5 px-1 pt-1"}`}>
          <span
            className={`calendar-month-day-number relative flex items-center justify-center ${isPhone ? "w-7 h-7 text-[14px]" : "w-7 h-7 text-sm"} rounded-full leading-none transition-colors ${badgeClass}`}
          >
            {day}
          </span>
           {!isPhone && dayEvents.length > 0 && (
             <span className="calendar-event-count text-[9px] font-medium px-1.5 text-neutral-500 dark:text-[#EBEBF599] bg-black/5 dark:bg-white/[0.12] py-0.5 rounded-full mt-0.5 whitespace-nowrap">
               <span>{dayEvents.length}</span>{" "}
               <span className="calendar-event-count-label">{isRtl ? (dayEvents.length === 1 ? "حدث" : "أحداث") : (dayEvents.length === 1 ? "Event" : "Events")}</span>
             </span>
           )}
        </div>


 {/* Event Rows inside cell */}
 {isPhone ? (
   <div className="calendar-month-dots flex flex-1 w-full items-end justify-center pb-1.5">
     {visibleEvents.length > 0 ? (
       <div className="flex items-center justify-center gap-[3px] max-w-full">
         {visibleEvents.slice(0, 3).map((ev) => {
           const { accentColor } = getEventIconInfo(ev);
           return (
             <span
               key={`mobile-dot-${ev.id}`}
               className="w-[5px] h-[5px] rounded-full shrink-0 shadow-[0_0_0_0.5px_rgba(0,0,0,0.08)] dark:shadow-none"
               style={{ backgroundColor: accentColor }}
             />
           );
         })}
       </div>
     ) : (
       <span className="w-1 h-1" />
     )}
   </div>
 ) : (
   <div className="flex-1 w-full flex flex-col justify-start gap-[2px] pb-1">
     {visibleEvents.map((ev) => {
       const { textColorClass, cardClass } = getEventCardStyles(ev);
       return (
         <div
           key={ev.id}
           className={`flex items-center gap-1 min-h-[22px] py-1 px-2 rounded-md overflow-hidden shrink-0 w-full ${cardClass} hover:opacity-80`}
         >
           {getEventPriority(ev) === PRIORITY.HOLIDAY ? null : ev.time && (
             <span className={`text-[10px] font-normal shrink-0 ${textColorClass}`}>
               {to12HourFormatStr(ev.time)}
             </span>
           )}
           <span className={`text-[10px] font-bold truncate flex-1 text-left ${textColorClass}`}>
             {ev.title}
           </span>
         </div>
       );
     })}
   </div>
 )}
 </div>
 
 {hiddenCount > 0 && (
 <div className={`${isPhone ? "hidden" : "flex"} absolute bottom-1 left-2 right-2 z-10`}>
 <button 
 onClick={(e) => {
 e.stopPropagation();
 setShowPopover((prev) => !prev);
 }}
 className="text-[11px] text-neutral-500 hover:text-neutral-700 dark:text-[#EBEBF599] dark:hover:text-neutral-200 font-medium px-1 shrink-0 text-left transition-colors"
 >
 +{hiddenCount} more
 </button>
 </div>
 )}

 <AnimatePresence>
 {showPopover && (
 <>
 <motion.div 
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 className="fixed inset-0 z-40" 
 onClick={(e) => { e.stopPropagation(); setShowPopover(false); }} 
 />
 <motion.div
 initial={{ opacity: 0, y: 5, scale: 0.95 }}
 animate={{ opacity: 1, y: 0, scale: 1 }}
 exit={{ opacity: 0, y: 5, scale: 0.95 }}
 transition={{ duration: 0.15 }}
 className="absolute top-[80%] left-1/2 -translate-x-1/2 mt-2 w-56 max-h-64 overflow-y-auto no-scrollbar bg-white dark:bg-[#1C1C1E] border border-neutral-200 dark:border-white/[0.12] rounded-lg shadow-elevation-3 z-50 p-2 flex flex-col gap-1 overscroll-y-contain"
 >
                {chronologicalEvents.map((ev) => {
                  const { textColorClass, titleWeight, cardClass } = getEventCardStyles(ev);
                  return (
                    <div
                      key={`popover-${ev.id}`}
                      className={`flex items-center gap-1 min-h-[24px] py-1 px-2 rounded-md shrink-0 w-full ${cardClass} md:hover:opacity-80`}
                    >
                        {getEventPriority(ev) === PRIORITY.HOLIDAY ? (
 null
 ) : ev.time && (
                          <span className={`text-[11px] font-normal shrink-0 ${textColorClass}`}>
                            {to12HourFormatStr(ev.time)}
                          </span>
                        )}
                        <span className={`text-[11px] font-bold truncate flex-1 text-left ${textColorClass}`}>
                          {ev.title}
                        </span>
                    </div>
                  );
                })}
 </motion.div>
 </>
 )}
        </AnimatePresence>
        {hasCompletedLecture && (
          <div className="absolute bottom-1.5 right-1.5 w-3.5 h-3.5 bg-emerald-500 rounded-full flex items-center justify-center shadow-sm z-10">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-2 h-2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        )}
      </div>

 );
});

interface CalendarMonthViewProps {
 isRtl: boolean;
 emptyPaddings: number[];
 calendarDays: number[];
 getFormattedDate: (dayNum: number) => string;
 selectedDate: string;
 setSelectedDate: (date: string) => void;
 events: CalendarEvent[];
 isPhone: boolean;
}

const EMPTY_EVENTS: CalendarEvent[] = [];

export const CalendarMonthView = memo(function CalendarMonthView({
  isRtl,
  emptyPaddings,
  calendarDays,
  getFormattedDate,
  selectedDate,
  setSelectedDate,
  events,
  isPhone,
}: CalendarMonthViewProps) {

 // Group events by date to prevent filtering n times
 const eventsByDate = useMemo(() => {
 const map = new Map<string, CalendarEvent[]>();
 for (const ev of events) {
 if (ev.date) {
 if (!map.has(ev.date)) {
 map.set(ev.date, []);
 }
 const list = map.get(ev.date); if (list) list.push(ev);
 }
 }
 return map;
 }, [events]);

 // Get today's local date parameters
 const today = new Date();
 const todayYear = today.getFullYear();
 const todayMonth = today.getMonth(); // 0-indexed
 const todayDay = today.getDate();

 return (
 <div id="calendar_month_grid_deck" tabIndex={0} role="application" aria-label="Interactive monthly calendar" className={`${isPhone ? "calendar-month-phone px-0 py-0.5" : "p-1"} font-sans select-none`}>
 {/* Week Day Labels (iOS Minimalist Header style) */}
  <div className={`grid grid-cols-7 ${isPhone ? "gap-1 mb-2.5 text-[10px] tracking-[0.04em]" : "gap-3 mb-4 text-xs tracking-[0.08em]"} text-center font-semibold text-neutral-500 dark:text-[#EBEBF599] uppercase`}>
  {[
    ["أحد", "الأحد", "Sun"],
    ["اثن", "الاثنين", "Mon"],
    ["ثلا", "الثلاثاء", "Tue"],
    ["أرب", "الأربعاء", "Wed"],
    ["خمي", "الخميس", "Thu"],
    ["جمع", "الجمعة", "Fri"],
    ["سبت", "السبت", "Sat"],
  ].map(([shortAr, fullAr, en]) => (
    <div key={en} className="min-w-0 truncate">
      {isRtl ? (isPhone ? shortAr : fullAr) : en}
    </div>
  ))}
 </div>

 {/* Grid Canvas - Distinct Floating Cards */}
 <div
 id="monthly_grid"
  className={`grid grid-cols-7 ${isPhone ? "gap-[3px]" : "gap-3"}`}
 >
 {/* Empty padding slots matching start day of month */}
 {emptyPaddings.map((idx) => (
 <div
 key={`pad-${idx}`}
 className={`${isPhone ? "calendar-month-phone-cell rounded-[11px]" : "aspect-square rounded-lg"} bg-neutral-50/20 dark:bg-[#2C2C2E]/10 border border-neutral-200/20 dark:border-white/[0.12]/20 pointer-events-none`}
 />
 ))}

 {/* Days of month dynamic */}
 {calendarDays.map((day) => {
 const dayDate = getFormattedDate(day);
 const isSelected = dayDate === selectedDate;
 return (
 <MonthDayCell key={`day-${dayDate}`} day={day} dayDate={dayDate} isSelected={isSelected} todayYear={todayYear} todayMonth={todayMonth} todayDay={todayDay} dayEvents={eventsByDate.get(dayDate) || EMPTY_EVENTS} setSelectedDate={setSelectedDate} isRtl={isRtl} isPhone={isPhone} />
 );
 })}
 </div>
 </div>
 );
});
