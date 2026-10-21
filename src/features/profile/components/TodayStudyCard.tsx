import { memo } from "react";
import { motion } from "motion/react";
import {
  BookOpenCheck,
  Brain,
  Clock3,
  Layers3,
  Sparkles,
  Video,
} from "lucide-react";
import type { TodayStudySummary } from "../todayStudyCache";

interface TodayStudyCardProps {
  language: "en" | "ar";
  summary: TodayStudySummary | null;
}

function formatFocusTime(seconds: number, language: "en" | "ar"): string {
  const safe = Math.max(0, Math.trunc(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const formatter = new Intl.NumberFormat(language === "ar" ? "ar-IQ" : "en");
  if (hours > 0) {
    return language === "ar"
      ? `${formatter.format(hours)}س ${formatter.format(minutes)}د`
      : `${formatter.format(hours)}h ${formatter.format(minutes)}m`;
  }
  return language === "ar"
    ? `${formatter.format(minutes)}د`
    : `${formatter.format(minutes)}m`;
}

export const TodayStudyCard = memo(function TodayStudyCard({ language, summary }: TodayStudyCardProps) {
  const isRtl = language === "ar";
  const tr = (en: string, ar: string) => isRtl ? ar : en;
  const number = (value: number) => new Intl.NumberFormat(isRtl ? "ar-IQ" : "en").format(Math.max(0, Math.trunc(value)));

  const items = summary ? [
    { key: "focus", Icon: Clock3, label: tr("Focus", "التركيز"), value: formatFocusTime(summary.focusSeconds, language), tone: "blue" },
    { key: "lectures", Icon: BookOpenCheck, label: tr("Lectures", "المحاضرات"), value: number(summary.lecturesCompleted), tone: "emerald" },
    { key: "mcq", Icon: Brain, label: "MCQs", value: number(summary.mcqAttempts), tone: "violet" },
    { key: "flashcards", Icon: Layers3, label: tr("Flashcards", "البطاقات"), value: number(summary.flashcardReviews), tone: "amber" },
    { key: "videos", Icon: Video, label: tr("Videos", "الفيديوهات"), value: number(summary.videosCompleted), tone: "rose" },
    { key: "points", Icon: Sparkles, label: tr("Points", "النقاط"), value: number(summary.pointsEarned), tone: "gold" },
  ] : [];

  return (
    <section
      dir={isRtl ? "rtl" : "ltr"}
      className="mb-8 overflow-hidden rounded-[28px] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.88),rgba(245,249,255,0.78))] p-4 shadow-[0_18px_48px_rgba(55,84,124,0.08),inset_0_1px_0_rgba(255,255,255,0.92)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-[linear-gradient(145deg,rgba(31,31,34,0.82),rgba(24,27,35,0.82))] dark:shadow-[0_20px_52px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-5"
      aria-label={tr("Today's study", "دراسة اليوم")}
    >
      <div className="mb-4 flex items-center justify-between gap-3 px-1">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight text-neutral-900 dark:text-white">
            {tr("Today", "اليوم")}
          </h2>
          <p className="mt-0.5 text-[12px] text-neutral-500 dark:text-neutral-400">
            {tr("Your study so far", "دراستك حتى الآن")}
          </p>
        </div>
        <span className="flex size-9 items-center justify-center rounded-2xl border border-blue-100/80 bg-blue-50/80 text-blue-600 shadow-sm dark:border-blue-300/10 dark:bg-blue-400/[0.09] dark:text-blue-300">
          <Sparkles className="size-4" aria-hidden="true" />
        </span>
      </div>

      {summary ? (
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {items.map(({ key, Icon, label, value, tone }, index) => (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 520, damping: 34, delay: index * 0.025 }}
              className="min-w-0 rounded-[20px] border border-neutral-200/55 bg-white/72 px-2.5 py-3 text-center shadow-[0_6px_18px_rgba(47,67,96,0.045),inset_0_1px_0_rgba(255,255,255,0.86)] dark:border-white/[0.06] dark:bg-white/[0.035]"
            >
              <span className={`mx-auto mb-2 flex size-8 items-center justify-center rounded-xl today-study-tone-${tone}`}>
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <div className="truncate text-[16px] font-bold tabular-nums tracking-[-0.025em] text-neutral-900 dark:text-white" dir="ltr">
                {value}
              </div>
              <div className="mt-0.5 truncate text-[10px] font-medium text-neutral-500 dark:text-neutral-400">
                {label}
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:gap-3" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-[86px] animate-pulse rounded-[20px] bg-neutral-100/80 dark:bg-white/[0.04] motion-reduce:animate-none" />
          ))}
        </div>
      )}

      <style>{`
        .today-study-tone-blue{background:rgba(59,130,246,.10);color:rgb(37,99,235)}
        .today-study-tone-emerald{background:rgba(16,185,129,.11);color:rgb(5,150,105)}
        .today-study-tone-violet{background:rgba(139,92,246,.10);color:rgb(124,58,237)}
        .today-study-tone-amber{background:rgba(245,158,11,.12);color:rgb(217,119,6)}
        .today-study-tone-rose{background:rgba(244,63,94,.10);color:rgb(225,29,72)}
        .today-study-tone-gold{background:linear-gradient(145deg,rgba(251,191,36,.16),rgba(249,115,22,.10));color:rgb(202,108,0)}
        .dark .today-study-tone-blue{background:rgba(96,165,250,.12);color:rgb(147,197,253)}
        .dark .today-study-tone-emerald{background:rgba(52,211,153,.11);color:rgb(110,231,183)}
        .dark .today-study-tone-violet{background:rgba(167,139,250,.11);color:rgb(196,181,253)}
        .dark .today-study-tone-amber{background:rgba(251,191,36,.11);color:rgb(252,211,77)}
        .dark .today-study-tone-rose{background:rgba(251,113,133,.10);color:rgb(253,164,175)}
        .dark .today-study-tone-gold{background:rgba(251,191,36,.10);color:rgb(253,224,71)}
      `}</style>
    </section>
  );
});
