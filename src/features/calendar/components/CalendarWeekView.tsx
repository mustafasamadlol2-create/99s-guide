/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { CalendarEvent } from "../../../core/types";
import { getEventIconInfo, PRIORITY, getEventPriority, getEventCardStyles } from "./EventIcon";

import { to12HourFormatStr } from "../../../core/utils/dateUtils";

interface WeekDayCellProps {
 idx: number;
 dateObj: Date;
 dateStr: string;
 isDaySelected: boolean;
 dayEvents: CalendarEvent[];
 todayYear: number;
 todayMonth: number;
 todayDay: number;
 
 isRtl: boolean;
 setSelectedDate: (date: string) => void;
}

const WeekDayCell = memo(function WeekDayCell({
  idx,
  dateObj,
  dateStr,
  isDaySelected,
  dayEvents,
  todayYear,
  todayMonth,
  todayDay,
  
  isRtl,
  setSelectedDate,
}: WeekDayCellProps) {
  const isToday =
    dateObj.getFullYear() === todayYear &&
    dateObj.getMonth() === todayMonth &&
    dateObj.getDate() === todayDay;

  const sortedElements = useMemo(() => {
    const elements: Array<{
      type: "event";
      time: number;
      data?: any;
    }> = [];
    dayEvents.forEach((ev) => {
      let timeVal = 0;
      if (ev.time) {
        const parts = ev.time.split(":");
        if (parts.length >= 2) {
          timeVal = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
        }
      }
      elements.push({ type: "event", time: timeVal, data: ev });
    });

    elements.sort((a, b) => a.time - b.time);
    return elements;
  }, [dayEvents]);

  let cellBgClass = "bg-white/90 dark:bg-[#1C1C1E]/80 backdrop-blur-sm";
  let cellBorderClass = "border-neutral-200/50 dark:border-white/[0.05]";
  const badgeBgClass = "bg-transparent";
  let badgeClass = "text-neutral-500 dark:text-[#EBEBF599] font-sans font-semibold";
  let dayNameClass = "text-neutral-500 dark:text-[#EBEBF599] font-sans";
  
  let ringClass = isDaySelected ? "ring-2 ring-neutral-400/30 dark:ring-white/10 z-10 shadow-sm bg-white dark:bg-[#2C2C2E]" : "hover:bg-white dark:hover:bg-white/[0.12]/90 hover:shadow-sm";

  if (dayEvents.length > 0) {
    const sortedEvents = [...dayEvents].sort((a, b) => getEventPriority(a) - getEventPriority(b));
    const topPriority = getEventPriority(sortedEvents[0]);
    
    if (topPriority === PRIORITY.EXAM) {
      cellBgClass = "bg-red-50/60 dark:bg-red-950/20";
      cellBorderClass = "border-red-200/70 dark:border-red-800/40";
      dayNameClass = "text-red-700/90 dark:text-red-400/90 font-semibold";
      ringClass = isDaySelected ? "ring-2 ring-red-400/50 dark:ring-red-500/30 z-10 shadow-sm bg-red-50 dark:bg-red-900/30" : "hover:bg-white dark:hover:bg-white/[0.12]/90 hover:shadow-sm";
    } else if (topPriority === PRIORITY.QUIZ) {
      cellBgClass = "bg-orange-50/50 dark:bg-orange-950/20";
      cellBorderClass = "border-orange-200/60 dark:border-orange-800/30";
      dayNameClass = "text-orange-700/90 dark:text-orange-400/90 font-semibold";
      ringClass = isDaySelected ? "ring-2 ring-orange-400/50 dark:ring-orange-500/30 z-10 shadow-sm bg-orange-50 dark:bg-orange-900/30" : "hover:bg-white dark:hover:bg-white/[0.12]/90 hover:shadow-sm";
    } else if (topPriority === PRIORITY.ANNOUNCEMENT) {
      cellBgClass = "bg-green-50/50 dark:bg-green-950/20";
      cellBorderClass = "border-green-200/60 dark:border-green-800/30";
      dayNameClass = "text-green-700/90 dark:text-green-400/90 font-semibold";
      ringClass = isDaySelected ? "ring-2 ring-green-400/50 dark:ring-green-500/30 z-10 shadow-sm bg-green-50 dark:bg-green-900/30" : "hover:bg-white dark:hover:bg-white/[0.12]/90 hover:shadow-sm";
    } else if (topPriority === PRIORITY.LECTURE || topPriority === PRIORITY.ASSIGNMENT) {
      cellBgClass = "bg-blue-50/50 dark:bg-blue-950/20";
      cellBorderClass = "border-blue-200/60 dark:border-blue-800/30";
      dayNameClass = "text-blue-700/90 dark:text-blue-400/90 font-semibold";
      ringClass = isDaySelected ? "ring-2 ring-blue-400/50 dark:ring-blue-500/30 z-10 shadow-sm bg-blue-50 dark:bg-blue-900/30" : "hover:bg-white dark:hover:bg-white/[0.12]/90 hover:shadow-sm";
    } else if (topPriority === PRIORITY.HOLIDAY) {
      cellBgClass = "bg-emerald-50/40 dark:bg-emerald-950/15";
      cellBorderClass = "border-emerald-200/50 dark:border-emerald-800/20";
      dayNameClass = "text-emerald-600/90 dark:text-emerald-400/90 font-medium";
      ringClass = isDaySelected ? "ring-2 ring-emerald-400/50 dark:ring-emerald-500/30 z-10 shadow-sm bg-emerald-50 dark:bg-emerald-900/20" : "hover:bg-white dark:hover:bg-white/[0.12]/90 hover:shadow-sm";
    }
  }

  if (isToday) {
    badgeClass = "text-[#ff3b30] font-semibold font-sans transition duration-300 ease-[var(--ease-apple)] transform group-hover:scale-105";
    dayNameClass = "text-[#ff3b30] font-semibold";
    if (isDaySelected) ringClass = "ring-2 ring-[#ff3b30]/40 z-10 shadow-sm bg-[#ff3b30]/[0.08] dark:bg-[#ff3b30]/[0.15]";
    else if (dayEvents.length === 0) {
      cellBgClass = "bg-[#ff3b30]/[0.04] dark:bg-[#ff3b30]/[0.06]";
      ringClass = "hover:shadow-sm hover:bg-[#ff3b30]/[0.08] dark:hover:bg-[#ff3b30]/[0.1]";
    }
  } else if (isDaySelected && dayEvents.length === 0) {
    badgeClass = "text-neutral-900 dark:text-white font-semibold font-sans";
    dayNameClass = "text-neutral-900 dark:text-white font-semibold";
  }

  const handleDayClick = useCallback(() => {
    setSelectedDate(dateStr);
  }, [dateStr, setSelectedDate]);

  return (
    <button
      key={`week-day-${idx}`}
      onClick={handleDayClick}
      className={`group relative py-3 px-1 min-h-[500px] rounded-xl text-left flex flex-col justify-start cursor-pointer transition duration-200 select-none z-0 
      border ${cellBgClass} ${cellBorderClass} ${ringClass}
      `}
    >
      <div className="flex flex-col items-center justify-center w-full mb-3 shrink-0 border-b border-black/[0.06] dark:border-white/[0.06] pb-3 relative z-10">
        <span
          className={`block text-[11px] tracking-[0.05em] uppercase font-semibold mb-1 ${dayNameClass}`}
        >
          {dateObj.toLocaleDateString(undefined, { weekday: "short" })}
        </span>
        <span
          className={`relative flex items-center justify-center w-7 h-7 rounded-full text-[15px] font-semibold mb-2 transition-colors ${badgeClass} ${badgeBgClass}`}
        >
          {dateObj.getDate()}
        </span>
        <div className="h-4 flex items-center justify-center">
          {dayEvents.length > 0 ? (
            <span className="text-[0.5625rem] font-semibold uppercase px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/[0.12] text-neutral-500 dark:text-[#EBEBF599]">
              {dayEvents.length} {dayEvents.length === 1 ? (isRtl ? "محاضرة" : "ev") : (isRtl ? "محاضرات" : "evs")}
            </span>
          ) : null}
        </div>
      </div>

      {/* Chronological events list with Apple Calendar timeline styling */}
      <div 
        className="space-y-4 w-full flex-1 overflow-y-auto no-scrollbar pb-6 px-1.5 overscroll-y-contain relative z-0"
        style={{
          backgroundImage: `linear-gradient(to bottom, rgba(150, 150, 150, 0.15) 1px, transparent 1px)`,
          backgroundSize: `100% 48px`,
          backgroundAttachment: `local`
        }}
      >
        {sortedElements.map((el, i) => {
          const ev = el.data;
          const { cardClass, textColorClass, titleWeight } = getEventCardStyles(ev);

          return (
            <div
              key={ev.id}
              className={`flex flex-col justify-center px-2.5 py-2 rounded-lg cursor-pointer relative overflow-hidden backdrop-blur-sm shadow-sm border border-black/[0.04] dark:border-white/[0.04] hover:-translate-y-[2px] hover:shadow-md hover:z-50 transition-all duration-200 ${cardClass}`}
            >
              {ev.isPinned && (
                <div className="absolute right-1.5 top-1.5 w-1.5 h-1.5 rounded-full bg-yellow-400 ring-2 ring-white/50 dark:ring-neutral-900/50 shadow-sm" />
              )}
              <div className="flex flex-col gap-0.5">
                {getEventPriority(ev) === PRIORITY.HOLIDAY ? (
 null
 ) : ev.time && (
                  <span className={`text-[10px] uppercase font-normal tracking-wider opacity-80 ${textColorClass}`}>
                    {to12HourFormatStr(ev.time)}
                  </span>
                )}
                <span className={`text-xs sm:text-[13px] leading-tight font-bold flex-1 ${textColorClass}`}>
                  {ev.title}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </button>
  );
});

interface CalendarWeekViewProps {
 isRtl: boolean;
 activeWeekDays: Date[];
 selectedDate: string;
 setSelectedDate: (date: string) => void;
 events: CalendarEvent[];
}

const EMPTY_EVENTS: CalendarEvent[] = [];

export const CalendarWeekView = memo(function CalendarWeekView({
 isRtl,
 activeWeekDays,
 selectedDate,
 setSelectedDate,
 events,
}: CalendarWeekViewProps) {
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

 return (
 <div id="calendar_week_grid_deck" tabIndex={0} role="application" aria-label="Interactive weekly timeline" className="space-y-4">
 <div
 id="week_columns_container"
 className="grid grid-cols-7 gap-2"
 >
 {activeWeekDays.map((dateObj, idx) => {
 const year = dateObj.getFullYear();
 const month = String(dateObj.getMonth() + 1).padStart(2, "0");
 const day = String(dateObj.getDate()).padStart(2, "0");
 const dateStr = `${year}-${month}-${day}`;
 const isDaySelected = dateStr === selectedDate;
 const dayEvents = eventsByDate.get(dateStr) || EMPTY_EVENTS;

 return (
 <WeekDayCell key={`week-day-${idx}`} idx={idx} dateObj={dateObj} dateStr={dateStr} isDaySelected={isDaySelected} dayEvents={dayEvents} todayYear={todayYear} todayMonth={todayMonth} todayDay={todayDay}  isRtl={isRtl} setSelectedDate={setSelectedDate} />
 );
 })}
 </div>
 </div>
 );
});
