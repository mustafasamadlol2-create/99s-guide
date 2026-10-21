import React, { useMemo } from "react";
import { CalendarDays, Flame, Sparkles } from "lucide-react";
import type { Language } from "../../core/i18n/translations";
import type { StudyStreakSummary } from "./types";

interface StudyStreakCardProps {
  data: StudyStreakSummary;
  language: Language;
}

function dateLabel(date: string, language: Language): string {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  return new Intl.DateTimeFormat(language === "ar" ? "ar-IQ" : "en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

export function StudyStreakCard({ data, language }: StudyStreakCardProps) {
  const isAr = language === "ar";
  const number = useMemo(
    () => new Intl.NumberFormat(isAr ? "ar-IQ" : "en"),
    [isAr],
  );
  const leading = useMemo(() => {
    const first = data.days[0]?.date;
    if (!first) return 0;
    return new Date(`${first}T12:00:00.000Z`).getUTCDay();
  }, [data.days]);
  const cells = useMemo(
    () => [...Array.from({ length: leading }, () => null), ...data.days],
    [data.days, leading],
  );

  return (
    <section className="g-card g-streak-card" aria-labelledby="g-study-streak-title">
      <div className="g-streak-head">
        <div className="g-streak-title-wrap">
          <span className="g-streak-icon" aria-hidden="true"><Flame size={22} /></span>
          <div>
            <h2 id="g-study-streak-title">{isAr ? "سلسلة الدراسة" : "Study streak"}</h2>
            <p>{isAr
              ? "تُحسب من نشاط دراسي موثّق، وليس من فتح التطبيق فقط."
              : "Based on verified study activity — opening the app alone never counts."}</p>
          </div>
        </div>
        <div className={`g-streak-today ${data.activeToday ? "is-active" : ""}`}>
          <Sparkles size={14} aria-hidden="true" />
          <span>{data.activeToday
            ? (isAr ? "اليوم محسوب" : "Today is active")
            : (isAr ? "ابدأ نشاطًا دراسيًا اليوم" : "No study activity yet today")}</span>
        </div>
      </div>

      <div className="g-streak-stats">
        <div className="g-streak-primary">
          <span className="g-streak-number">{number.format(data.currentStreakDays)}{data.streakCappedByHistory ? "+" : ""}</span>
          <span className="g-streak-unit">{isAr ? "يوم متتالي" : "day streak"}</span>
        </div>
        <div className="g-streak-stat"><span>{isAr ? "آخر 7 أيام" : "Last 7 days"}</span><strong>{number.format(data.activeDaysLast7)}</strong></div>
        <div className="g-streak-stat"><span>{isAr ? "آخر 30 يومًا" : "Last 30 days"}</span><strong>{number.format(data.activeDaysLast30)}</strong></div>
        <div className="g-streak-stat"><span>{isAr ? "أطول سلسلة" : "Longest streak"}</span><strong>{number.format(data.longestStreakDays)}</strong></div>
      </div>

      <div className="g-heatmap-shell">
        <div className="g-heatmap-label-row">
          <div>
            <CalendarDays size={16} aria-hidden="true" />
            <strong>{isAr ? "نشاط آخر سنة" : "Last year activity"}</strong>
          </div>
          <span>{number.format(data.activeDaysInRange)} {isAr ? "يوم دراسة" : "study days"}</span>
        </div>
        <div className="g-heatmap-scroll" tabIndex={0} aria-label={isAr ? "خريطة النشاط الدراسي" : "Study activity heatmap"}>
          <div className="g-heatmap-grid">
            {cells.map((day, index) => day ? (
              <span
                key={day.date}
                className={`g-heatmap-cell intensity-${day.intensity}`}
                title={`${dateLabel(day.date, language)} · ${day.active ? (isAr ? "نشط" : "active") : (isAr ? "بدون نشاط" : "no activity")}`}
                aria-label={`${dateLabel(day.date, language)}: ${day.active ? (isAr ? "يوم دراسة" : "study day") : (isAr ? "لا نشاط" : "no study activity")}`}
                role="img"
              />
            ) : <span key={`blank-${index}`} className="g-heatmap-cell is-empty" aria-hidden="true" />)}
          </div>
        </div>
        <div className="g-heatmap-foot">
          <span>{isAr ? "أقل" : "Less"}</span>
          {[0, 1, 2, 3, 4].map((level) => <span key={level} className={`g-heatmap-cell intensity-${level}`} aria-hidden="true" />)}
          <span>{isAr ? "أكثر" : "More"}</span>
        </div>
      </div>

      <p className="g-streak-note">
        {isAr
          ? "تفويت يوم لا يخصم نقاطًا ولا يفرض عقوبة. السلسلة وصف للاستمرارية فقط، واليوم يُحسب بتوقيت بغداد."
          : "Missing a day never removes points or creates a penalty. The streak is descriptive only, and study days follow Baghdad time."}
      </p>
    </section>
  );
}
