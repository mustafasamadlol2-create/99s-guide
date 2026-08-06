/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { CalendarEvent } from "../../../core/types";
import { getEventIconInfo, PRIORITY, getEventPriority } from "./EventIcon";

import { parseLocalDate, formatMinutesTo12HourStr, to12HourFormatStr } from "../../../core/utils/dateUtils";


// Memoized EventCard for high rendering performance
interface EventCardProps {
 eventItem: {
 event: CalendarEvent;
 startMin: number;
 endMin: number;
 duration: number;
 };
 isMulti?: boolean;
}

const EventCard = memo(function EventCard({
 eventItem,
 isMulti
}: EventCardProps) {
 const { event, endMin } = eventItem;

 // Reuse the same icon/color system as the Holiday card
 const { Icon, colorClass } = getEventIconInfo(event);

 // Background + text colour derived from event type (mirrors holiday's green palette)
 const priority = (event.eventType || event.type || "").toUpperCase();
 let bgCard = "bg-blue-100/80 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300";
 const iconBg  = "bg-white dark:bg-black/20";
 if (priority === "EXAM" || priority === "IMPORTANT EXAM") {
   bgCard = "bg-red-100/80 dark:bg-red-900/40 text-red-800 dark:text-red-300";
 } else if (priority === "QUIZ" || priority === "DAILY EXAM") {
   bgCard = "bg-orange-100/80 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300";
 } else if (priority === "ANNOUNCEMENT" || priority === "BULLETIN") {
   bgCard = "bg-green-100/80 dark:bg-green-900/40 text-green-800 dark:text-green-300";
 } else if (priority === "ASSIGNMENT" || priority === "HOMEWORK") {
   bgCard = "bg-purple-100/80 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300";
 } else if (priority === "HOLIDAY") {
   bgCard = "bg-emerald-100/80 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300";
 }
 if (event.isCompleted) bgCard += " opacity-60 grayscale-[0.5]";

 const timeLabel =
   `${to12HourFormatStr(event.time).replace(" AM","AM").replace(" PM","PM")} – ${formatMinutesTo12HourStr(endMin).replace(" AM","AM").replace(" PM","PM")}`;

 return (
   <div
     className={`relative flex-1 min-w-[140px] select-none rounded-lg border border-black/5 dark:border-white/[0.12] shadow-sm cursor-pointer transition duration-200 hover:shadow-md flex items-center gap-3 p-3 ${bgCard}`}
   >
     {event.isPinned && (
       <div className="absolute right-2.5 top-2.5 w-1.5 h-1.5 rounded-full bg-yellow-400 shadow-sm" />
     )}

     {/* Icon badge — same structure as Holiday card */}
     <div className={`shrink-0 p-2 rounded-md ${iconBg} shadow-sm border border-black/5 dark:border-white/10`}>
       <Icon className={`w-5 h-5 ${colorClass}`} />
     </div>

     {/* Content */}
     <div className="flex-1 min-w-0">
       <h4 className="text-sm font-semibold leading-snug truncate">{event.title}</h4>

       {/* Time + optional room/doctor as compact subtitle */}
       <p className="text-xs opacity-75 uppercase tracking-wider font-semibold mt-0.5 truncate">
         {timeLabel}
         {event.room ? ` · ${event.room}` : ""}
         {event.doctor ? ` · ${event.doctor}` : ""}
       </p>
     </div>
   </div>
 );
});

interface DayStripItemProps {
 dayDate: Date;
 idx: number;
 selectedDate: string;
 setSelectedDate: (date: string) => void;
 dayEvents: CalendarEvent[];
 todayYear: number;
 todayMonth: number;
 todayDay: number;
}

const DayStripItem = memo(function DayStripItem({
 dayDate,
 idx,
 selectedDate,
 setSelectedDate,
 dayEvents,
 todayYear,
 todayMonth,
 todayDay,
}: DayStripItemProps) {
 const y = dayDate.getFullYear();
 const m = String(dayDate.getMonth() + 1).padStart(2, "0");
 const dStr = String(dayDate.getDate()).padStart(2, "0");
 const currentFormatted = `${y}-${m}-${dStr}`;
 const isDaySelected = currentFormatted === selectedDate;
 const isToday =
 y === todayYear &&
 dayDate.getMonth() === todayMonth &&
 dayDate.getDate() === todayDay;

 const sortedEvents = useMemo(() => {
 return [...dayEvents].sort((a, b) => getEventPriority(a) - getEventPriority(b));
 }, [dayEvents]);
 const topPriority = sortedEvents.length > 0 ? getEventPriority(sortedEvents[0]) : null;

 let cellBgClass = "hover:bg-neutral-100 dark:hover:bg-white/[0.06] bg-neutral-50/40 dark:bg-[#1C1C1E]/20 border border-neutral-200/40 dark:border-white/[0.04]";
 let dayNameClass = "text-neutral-500 dark:text-[#EBEBF599] font-semibold";
 const dateBgClass = "bg-transparent";
  let dateTextClass = "text-neutral-700 dark:text-[#EBEBF599] font-medium";

 if (topPriority === PRIORITY.EXAM) {
 cellBgClass = "bg-red-50/40 dark:bg-red-950/15 border border-red-200/70 dark:border-red-800/40";
 dayNameClass = "text-red-700/90 dark:text-red-400/90 font-semibold";
 } else if (topPriority === PRIORITY.QUIZ) {
 cellBgClass = "bg-orange-50/30 dark:bg-orange-950/15 border border-orange-200/50 dark:border-orange-800/30";
 dayNameClass = "text-orange-700/90 dark:text-orange-400/90 font-semibold";
 } else if (topPriority === PRIORITY.ANNOUNCEMENT) {
 cellBgClass = "bg-green-50/30 dark:bg-green-950/15 border border-green-200/50 dark:border-green-800/30";
 dayNameClass = "text-green-700/90 dark:text-green-400/90 font-semibold";
 } else if (topPriority === PRIORITY.LECTURE || topPriority === PRIORITY.ASSIGNMENT) {
 cellBgClass = "bg-blue-50/30 dark:bg-blue-950/15 border border-blue-200/50 dark:border-blue-800/30";
 dayNameClass = "text-blue-700/90 dark:text-blue-400/90 font-semibold";
 } else if (topPriority === PRIORITY.HOLIDAY) {
 cellBgClass = "bg-emerald-50/30 dark:bg-emerald-950/15 border border-emerald-200/50 dark:border-emerald-800/30";
 dayNameClass = "text-emerald-600/90 dark:text-emerald-400/90 font-medium";
 }

 if (isToday) {
 dayNameClass = "text-[#ff3b30] font-semibold";
 dateTextClass = "text-[#ff3b30] font-semibold";
 if (!topPriority) {
 cellBgClass = isDaySelected ? "bg-[#ff3b30]/[0.05] dark:bg-[#ff3b30]/[0.1] shadow-elevation-1 border border-[#ff3b30]/30 dark:border-[#ff3b30]/40" : "bg-[#ff3b30]/[0.02] dark:bg-[#ff3b30]/[0.04] border border-[#ff3b30]/[0.1] dark:border-[#ff3b30]/[0.15] hover:bg-[#ff3b30]/[0.06] dark:hover:bg-[#ff3b30]/[0.1]";
 }
 } else if (isDaySelected && !topPriority) {
 cellBgClass = "bg-neutral-100 dark:bg-[#2C2C2E]/80 shadow-elevation-1 border border-neutral-300/50 dark:border-white/[0.12]";
 dayNameClass = "text-neutral-900 dark:text-white";
 dateTextClass = "text-neutral-900 dark:text-white font-semibold";
 }

 const ringClass = (isDaySelected && isToday) ? "ring-2 ring-[#ff3b30]/40" : isDaySelected ? "ring-2 ring-neutral-900/10 dark:ring-white/10" : "";

 const hasExam = topPriority === PRIORITY.EXAM;
 const hasQuiz = topPriority === PRIORITY.QUIZ;
 const hasLecture = topPriority === PRIORITY.LECTURE;

 const handleClick = useCallback(() => {
 setSelectedDate(currentFormatted);
 }, [currentFormatted, setSelectedDate]);

 return (
 <button
 type="button"
 onClick={handleClick}
 className={`flex flex-col items-center justify-between py-2 rounded-lg cursor-pointer group transition duration-normal hover:scale-105
 ${cellBgClass} ${ringClass}
 `}
 >
 <span
 className={`text-caption uppercase ${dayNameClass} transition-colors`}
 >
 {dayDate.toLocaleDateString(undefined, { weekday: "narrow" })}
 </span>

 <div
 className={`mt-2 w-8 h-8 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-body sm:text-body transition duration-fast ${dateBgClass} ${dateTextClass}`}
 >
 {dayDate.getDate()}
 </div>

    </button>
  );
});

interface CalendarDayViewProps {
  selectedDate: string;
  selectedDateEvents: CalendarEvent[];
  setSelectedDate: (date: string) => void;
  events: CalendarEvent[];
  dayTransition: "left" | "right" | null;
 hoursArray: number[];
 eventDurations: { [eventId: string]: number };
 HOUR_HEIGHT: number;
 timelineRef: React.RefObject<HTMLDivElement | null>;
 setNewTaskTime: (time: string) => void;
 setIsAddingTask: (val: boolean) => void;
 handleSwipeStart: (e: React.PointerEvent<HTMLDivElement>) => void;
 handleSwipeMove: (e: React.PointerEvent<HTMLDivElement>) => void;
 handleSwipeEnd: (e: React.PointerEvent<HTMLDivElement>) => void;
 setSwipeStartX: (val: number | null) => void;
 swipeTranslateX: number;
 parseTimeToMinutes: (timeStr: string) => number;
}

const EMPTY_EVENTS: CalendarEvent[] = [];

export const CalendarDayView = memo(function CalendarDayView({
 selectedDate,
 selectedDateEvents,
 setSelectedDate,
 events,
 dayTransition,
 hoursArray,
 eventDurations,
 HOUR_HEIGHT,
 timelineRef,
 setNewTaskTime,
 setIsAddingTask,
 handleSwipeStart,
 handleSwipeMove,
 handleSwipeEnd,
 setSwipeStartX,
 swipeTranslateX,
 parseTimeToMinutes,
}: CalendarDayViewProps) {
 const [todayStr, setTodayStr] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const d = new Date();
      const current = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      setTodayStr(prev => prev !== current ? current : prev);
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  const [todayYear, todayMonth, todayDay] = useMemo(() => {
    const parts = todayStr.split("-").map(Number);
    return [parts[0], parts[1], parts[2]];
  }, [todayStr]);

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

 // Generate days for the week of the selected date to display as a top iOS style strip
 const weekDays = useMemo(() => {
 const d = parseLocalDate(selectedDate);
 const dayOfWeek = d.getDay(); // 0 is Sunday, 1 is Monday...
 const days: Date[] = [];
 for (let i = 0; i < 7; i++) {
 const copy = new Date(d);
 copy.setDate(d.getDate() - dayOfWeek + i);
 days.push(copy);
 }
 return days;
 }, [selectedDate]);

 // Compute chronologically sorted event clusters
 const holidayEvents = useMemo(() => {
    return selectedDateEvents.filter((ev) => ev.eventType === "HOLIDAY" || ev.type === "holiday");
  }, [selectedDateEvents]);
  
  const timedEvents = useMemo(() => {
    return selectedDateEvents.filter((ev) => ev.eventType !== "HOLIDAY" && ev.type !== "holiday");
  }, [selectedDateEvents]);

 const eventClusters = useMemo(() => {
  const mapped = timedEvents.map((event) => {
 const startMin = parseTimeToMinutes(event.time);
 const duration = eventDurations[event.id] || 60;
 const endMin = startMin + duration;
 return { event, startMin, endMin, duration };
 });

 mapped.sort((a, b) => a.startMin - b.startMin);

 const clusters: { startMin: number; endMin: number; items: typeof mapped }[] = [];
 
 for (const item of mapped) {
 if (clusters.length === 0) {
 clusters.push({ startMin: item.startMin, endMin: item.endMin, items: [item] });
 } else {
 const currentCluster = clusters[clusters.length - 1];
 if (item.startMin < currentCluster.endMin) {
 // Overlaps with current cluster
 currentCluster.items.push(item);
 currentCluster.endMin = Math.max(currentCluster.endMin, item.endMin);
 } else {
 // Start a new cluster
 clusters.push({ startMin: item.startMin, endMin: item.endMin, items: [item] });
 }
 }
 }

 return clusters;
 }, [timedEvents, eventDurations, parseTimeToMinutes]);

 

 const isSelectedDateToday = useMemo(() => {
 const selDateObj = parseLocalDate(selectedDate);
 return (
 selDateObj.getFullYear() === todayYear &&
 selDateObj.getMonth() === todayMonth &&
 selDateObj.getDate() === todayDay
 );
 }, [selectedDate, todayYear, todayMonth, todayDay]);

 return (
 <div className="space-y-4 relative">
 {/* iOS Style Floating Weekly Date Ribbon */}
 <div className="bg-white/50 dark:bg-[#000000]/20 p-3 rounded-lg flex flex-col items-center gap-2 border border-black/5 dark:border-white/[0.12] shadow-elevation-1">
 <div
 className="grid grid-cols-7 w-full gap-1 sm:gap-2"
 >
 {weekDays.map((dayDate, idx) => {
 const y = dayDate.getFullYear();
 const m = String(dayDate.getMonth() + 1).padStart(2, "0");
 const dStr = String(dayDate.getDate()).padStart(2, "0");
 const currentFormatted = `${y}-${m}-${dStr}`;
 const dayEvents = eventsByDate.get(currentFormatted) || EMPTY_EVENTS;

 return (
 <DayStripItem key={`ios-strip-${idx}`} dayDate={dayDate} idx={idx} selectedDate={selectedDate} setSelectedDate={setSelectedDate} dayEvents={dayEvents} todayYear={todayYear} todayMonth={todayMonth} todayDay={todayDay} />
 );
 })}
 </div>
 </div>

 {/* Day View Chronological Schedule */}
 <div
 id="calendar_day_grid_deck" tabIndex={0} role="application" aria-label="Interactive daily timeline"
 ref={timelineRef}
 onPointerDown={handleSwipeStart}
 onPointerMove={handleSwipeMove}
 onPointerUp={handleSwipeEnd}
 onPointerLeave={() => {
 setSwipeStartX(null);
 }}
 className="relative md:h-[600px] min-h-[400px] max-h-[70vh] overflow-y-auto overflow-x-clip border border-neutral-200 dark:border-white/[0.15] rounded-lg bg-neutral-50/50 dark:bg-[#000000] select-none touch-pan-y transition-colors shadow-elevation-1 p-4 overscroll-y-contain"
 style={{ contentVisibility: "auto" }}
 >
 <div
 className={`relative w-full min-h-full flex flex-col gap-4 origin-center ${
 dayTransition === "left"
 ? "-translate-x-12 opacity-5 rotate-1 scale-[0.98]"
 : dayTransition === "right"
 ? "translate-x-12 opacity-5 -rotate-1 scale-[0.98]"
 : ""
 }`}
 style={{
 transform:
 swipeTranslateX !== 0
 ? `translateX(${swipeTranslateX}px) rotate(${swipeTranslateX * 0.015}deg) scale(${1 - Math.min(0.04, Math.abs(swipeTranslateX) / 2000)})`
 : undefined,
 transition:
 swipeTranslateX === 0 && !dayTransition
 ? "transform 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease-spring"
 : dayTransition
 ? "transform 0.3s ease-spring, opacity 0.3s ease-spring"
 : "none",
 opacity:
 swipeTranslateX !== 0
 ? Math.max(0.65, 1 - Math.abs(swipeTranslateX) / 500)
 : undefined,
 }}
 >
 {holidayEvents.length > 0 && (
            <div className="flex flex-col gap-2 mb-4">
              {holidayEvents.map((ev) => {
                const { Icon, colorClass, bgClass } = getEventIconInfo(ev);
                return (
                  <div key={ev.id} className={`flex items-center gap-3 p-3 rounded-lg border border-black/5 dark:border-white/[0.12] shadow-sm bg-green-100/80 dark:bg-green-900/40 text-green-800 dark:text-green-300`}>
                    <div className="shrink-0 p-2 rounded-md bg-white dark:bg-black/20 shadow-sm border border-black/5 dark:border-white/10">
                      <Icon className="w-5 h-5 text-green-600 dark:text-green-400" />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-sm font-semibold">{ev.title}</h4>
                      <p className="text-xs opacity-80 uppercase tracking-wider font-semibold">Entire Day</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          
          {eventClusters.length === 0 && holidayEvents.length === 0 ? (
 <div className="flex flex-col items-center justify-center h-full opacity-50 py-12">
 <div className="w-16 h-16 bg-black/5 dark:bg-white/[0.08] rounded-full flex items-center justify-center mb-4">
 <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
 </div>
 <p className="text-sm font-medium">No events scheduled for this day</p>
 </div>
 ) : (
 eventClusters.map((cluster, i) => (
 <div key={`cluster-${i}`} className="flex items-stretch gap-3 relative">
 {/* Event Cards side-by-side */}
 <div className="flex-1 flex gap-2 overflow-x-auto snap-x hide-scrollbar overscroll-x-contain">
 {cluster.items.map((eventItem, j) => (
 <EventCard key={eventItem.event.id + '-' + j} eventItem={eventItem} isMulti={cluster.items.length > 1}
 />
 ))}
 </div>
 </div>
 ))
 )}
 </div>
 </div>
 </div>
 );
});
