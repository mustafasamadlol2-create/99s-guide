import React, { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { Language } from "../../../core/i18n/translations";
import { masteryApi, type MasteryLectureDetail } from "../api";

export interface LectureMasteryCardProps {
  lectureId: string;
  lectureTitle: string;
  language?: Language;
  onReview?: () => void;
}

const stateLabels: Record<string, [string, string]> = {
  NOT_STARTED: ["Not started", "لم تبدأ"],
  STARTED: ["Started", "بدأت"],
  LEARNING: ["Learning", "قيد التعلم"],
  NEEDS_REVIEW: ["Needs review", "تحتاج إلى مراجعة"],
  GOOD: ["Good", "جيدة"],
  MASTERED: ["Strong evidence so far", "أدلة قوية حتى الآن"],
};
const reviewLabels: Record<string, [string, string]> = {
  INSUFFICIENT_EVIDENCE: ["Not enough evidence", "أدلة غير كافية"],
  FRESH: ["Up to date", "محدّثة"],
  DUE_SOON: ["Due soon", "تستحق المراجعة قريبًا"],
  DUE: ["Due", "حان وقت المراجعة"],
  OVERDUE: ["Overdue", "متأخرة"],
};

function label(value: string | undefined, language: Language, table: Record<string, [string, string]>) {
  return table[value ?? ""]?.[language === "ar" ? 1 : 0] ?? value ?? (language === "ar" ? "غير متاح" : "Unavailable");
}

function formatDate(value: string | null | undefined, language: Language): string {
  if (!value) return language === "ar" ? "لا يوجد موعد محدد" : "No date set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return language === "ar" ? "لا يوجد موعد محدد" : "No date set";
  return date.toLocaleDateString(language === "ar" ? "ar-IQ-u-nu-latn" : "en-US", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export function LectureMasteryCard({
  lectureId, lectureTitle, language = "en", onReview,
}: LectureMasteryCardProps) {
  const isRtl = language === "ar";
  const [detail, setDetail] = useState<MasteryLectureDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError(false);
    try {
      const next = await masteryApi.lecture(lectureId);
      if (generation.current === request) setDetail(next);
    } catch {
      if (generation.current === request) setError(true);
    } finally {
      if (generation.current === request) setLoading(false);
    }
  }, [lectureId]);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener("study:mastery-updated", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      generation.current += 1;
      window.removeEventListener("study:mastery-updated", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  return (
    <section dir={isRtl ? "rtl" : "ltr"} aria-labelledby={`mastery-${lectureId}`}
      className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {isRtl ? "الإتقان الحالي" : "Current Mastery"}
          </p>
          <h2 id={`mastery-${lectureId}`} dir="auto" className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-white">
            {lectureTitle}
          </h2>
        </div>
        <button type="button" onClick={() => void load()} aria-label={isRtl ? "تحديث الإتقان" : "Refresh mastery"}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10">
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </div>
      {loading ? <p className="mt-4 text-sm text-slate-500">{isRtl ? "جارٍ التحديث…" : "Updating…"}</p> : error ? (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-rose-600">
          <span>{isRtl ? "تعذر تحميل الإتقان." : "Mastery could not be loaded."}</span>
          <button type="button" onClick={() => void load()} className="font-semibold underline">{isRtl ? "إعادة المحاولة" : "Retry"}</button>
        </div>
      ) : detail ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div><p className="text-xs text-slate-500">{isRtl ? "حالة الإتقان" : "Mastery state"}</p><p className="mt-1 text-sm font-semibold">{label(detail.state, language, stateLabels)}</p></div>
          <div><p className="text-xs text-slate-500">{isRtl ? "المراجعة" : "Review"}</p><p className="mt-1 text-sm font-semibold">{label(detail.reviewState, language, reviewLabels)}</p></div>
          <div><p className="text-xs text-slate-500">{isRtl ? "المراجعة التالية" : "Next review"}</p><p className="mt-1 text-sm font-semibold">{formatDate(detail.nextReviewAt, language)}</p></div>
        </div>
      ) : null}
      {detail && onReview ? (
        <button type="button" onClick={onReview}
          className="mt-4 min-h-11 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900">
          {isRtl ? "مراجعة" : "Review"}
        </button>
      ) : null}
    </section>
  );
}