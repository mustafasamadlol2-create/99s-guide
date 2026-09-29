import type {
  FocusDurationBucketId,
  StudyAnalyzerWindowName,
  StudyPositiveSignal,
  StudyTimeBucketId,
  StudyWeaknessSignal,
} from "../../../server/features/study-analyzer/types";
import type { Language } from "../../core/i18n/translations";

type Copy = readonly [english: string, arabic: string];

export const ANALYZER_WINDOW_LABELS: Record<StudyAnalyzerWindowName, Copy> = {
  last7Days: ["Last 7 days", "آخر ٧ أيام"],
  last30Days: ["Last 30 days", "آخر ٣٠ يومًا"],
  currentSemester: ["Current semester", "الفصل الدراسي الحالي"],
};

const TREND_LABELS: Record<
  "IMPROVED" | "STABLE" | "DECLINED" | "INSUFFICIENT_DATA",
  Copy
> = {
  IMPROVED: ["Improving", "تحسّن"],
  STABLE: ["Stable", "مستقر"],
  DECLINED: ["Declining", "انخفاض"],
  INSUFFICIENT_DATA: ["Not enough data", "لا توجد بيانات كافية"],
};

const TIME_BUCKET_LABELS: Record<StudyTimeBucketId, Copy> = {
  MORNING: ["Morning", "الصباح"],
  AFTERNOON: ["Afternoon", "بعد الظهر"],
  EVENING: ["Evening", "المساء"],
  NIGHT: ["Night", "الليل"],
};

const DURATION_BUCKET_LABELS: Record<FocusDurationBucketId, Copy> = {
  "10_24_MIN": ["10–24 min", "١٠–٢٤ دقيقة"],
  "25_44_MIN": ["25–44 min", "٢٥–٤٤ دقيقة"],
  "45_59_MIN": ["45–59 min", "٤٥–٥٩ دقيقة"],
  "60_89_MIN": ["60–89 min", "٦٠–٨٩ دقيقة"],
  "90_PLUS_MIN": ["90+ min", "٩٠ دقيقة فأكثر"],
};

const MASTERY_STATE_LABELS: Record<string, Copy> = {
  NOT_STARTED: ["Not started", "لم يبدأ"],
  STARTED: ["Started", "بدأ"],
  LEARNING: ["Learning", "قيد التعلّم"],
  NEEDS_REVIEW: ["Needs review", "تحتاج إلى مراجعة"],
  GOOD: ["Good", "جيد"],
  MASTERED: ["Mastered", "متقن"],
};

const WEAKNESS_LABELS: Record<StudyWeaknessSignal["id"], Copy> = {
  REPEATED_OBJECTIVE_ERRORS: [
    "Repeated incorrect practice outcomes",
    "تكررت الإجابات غير الصحيحة في التدريب",
  ],
  LOW_RECENT_OBJECTIVE_ACCURACY: [
    "Recent objective practice accuracy is lower",
    "دقة التدريب الموضوعي مؤخرًا أقل",
  ],
  MASTERY_NEEDS_REVIEW: [
    "Some lectures need review",
    "بعض المحاضرات تحتاج إلى مراجعة",
  ],
  RETENTION_DUE: ["Reviews are due", "حان موعد بعض المراجعات"],
  RETENTION_OVERDUE: ["Some reviews are overdue", "تجاوز موعد بعض المراجعات"],
  FLASHCARD_NOT_REMEMBERED_PATTERN: [
    "Some flashcards were self-reported as needing review",
    "أفاد تقييمك الذاتي بأن بعض البطاقات تحتاج إلى مراجعة",
  ],
  FOCUS_FREQUENTLY_UNCOMPLETED: [
    "Some Focus sessions ended without completion",
    "انتهت بعض جلسات التركيز دون إكمالها",
  ],
  LOW_RECENT_STUDY_CONSISTENCY: [
    "Fewer active study days were recorded recently",
    "سُجّلت أيام دراسة نشطة أقل مؤخرًا",
  ],
};

const POSITIVE_LABELS: Record<StudyPositiveSignal["id"], Copy> = {
  OBJECTIVE_ACCURACY_IMPROVED: [
    "Objective practice accuracy improved",
    "تحسّنت دقة التدريب الموضوعي",
  ],
  CONSISTENCY_IMPROVED: [
    "Study-day consistency improved",
    "تحسّن الانتظام في أيام الدراسة",
  ],
  HIGH_FOCUS_COMPLETION: [
    "Focus completion was high",
    "كان معدل إكمال جلسات التركيز مرتفعًا",
  ],
};

const SEVERITY_LABELS: Record<"LOW" | "MODERATE" | "HIGH", Copy> = {
  LOW: ["Low", "منخفض"],
  MODERATE: ["Moderate", "متوسط"],
  HIGH: ["High", "مرتفع"],
};

export function localized(copy: Copy, language: Language): string {
  return language === "ar" ? copy[1] : copy[0];
}

export function formatNumber(value: number | null | undefined, language: Language): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(language === "ar" ? "ar-IQ-u-nu-latn" : "en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatRateBps(value: number | null | undefined, language: Language): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${formatNumber(Math.round(value / 100), language)}%`;
}

export function formatDuration(seconds: number | null | undefined, language: Language): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const totalMinutes = Math.floor(Math.max(0, seconds) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (language === "ar") {
    if (hours === 0) return `${formatNumber(minutes, language)} د`;
    return minutes === 0
      ? `${formatNumber(hours, language)} س`
      : `${formatNumber(hours, language)} س ${formatNumber(minutes, language)} د`;
  }
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

export function formatBaghdadDate(
  value: string | null | undefined,
  language: Language,
  includeTime = false,
): string {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(language === "ar" ? "ar-IQ-u-nu-latn" : "en-GB", {
    timeZone: "Asia/Baghdad",
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
  }).format(date);
}

export function trendLabel(
  state: keyof typeof TREND_LABELS | null | undefined,
  language: Language,
): string {
  return state ? localized(TREND_LABELS[state], language) : localized(TREND_LABELS.INSUFFICIENT_DATA, language);
}

export function timeBucketLabel(
  bucket: StudyTimeBucketId | null | undefined,
  language: Language,
): string {
  return bucket ? localized(TIME_BUCKET_LABELS[bucket], language) : "—";
}

export function durationBucketLabel(
  bucket: FocusDurationBucketId | null | undefined,
  language: Language,
): string {
  return bucket ? localized(DURATION_BUCKET_LABELS[bucket], language) : "—";
}

export function masteryStateLabel(state: string, language: Language): string {
  return MASTERY_STATE_LABELS[state]
    ? localized(MASTERY_STATE_LABELS[state], language)
    : localized(["Other", "أخرى"], language);
}

export function weaknessLabel(signal: StudyWeaknessSignal, language: Language): string {
  return localized(WEAKNESS_LABELS[signal.id], language);
}

export function positiveLabel(signal: StudyPositiveSignal, language: Language): string {
  return localized(POSITIVE_LABELS[signal.id], language);
}

export function severityLabel(
  severity: "LOW" | "MODERATE" | "HIGH",
  language: Language,
): string {
  return localized(SEVERITY_LABELS[severity], language);
}