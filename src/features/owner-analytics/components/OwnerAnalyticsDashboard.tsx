import {
  Activity,
  AlertCircle,
  ArrowDown,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Database,
  RefreshCw,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  getOwnerAcademicAnalytics,
  getOwnerAnalyticsLectures,
  OwnerAnalyticsRequestError,
  type OwnerAcademicAnalyticsResponse,
  type OwnerAnalyticsLectureListResponse,
} from "../api";
import type { OwnerAnalyticsWindowPreset } from "../../../../server/features/owner-analytics/windows";
import type {
  OwnerSafeLecture,
  OwnerSafeScope,
  OwnerSafeSubject,
} from "../../../../server/features/owner-analytics/privacy";
import type { Language } from "../../../core/i18n/translations";
import type { Subject } from "../../../core/types";

type Props = {
  language: Language;
  subjects: Subject[];
};

type CopyKey =
  | "title" | "eyebrow" | "privacy" | "period" | "refresh" | "overview"
  | "adoption" | "activity" | "subjects" | "mastery" | "operations"
  | "quality" | "eligible" | "active" | "activeRate" | "scopeStatus"
  | "noComparisons" | "notProvided" | "participation" | "focusParticipation"
  | "mcqParticipation" | "flashcardParticipation" | "recallParticipation"
  | "activityMetrics" | "focus" | "meaningfulSessions" | "verifiedStudyTime"
  | "groupFocus" | "completedRuns" | "participantSessions" | "groupFocusTime"
  | "mcq" | "attempts" | "correct" | "incorrect" | "distinctItems" | "accuracy"
  | "flashcards" | "reviews" | "remembered" | "notRemembered" | "distinctCards" | "rememberedRate"
  | "recall" | "presented" | "answered" | "skipped" | "expired"
  | "resources" | "handoffs" | "pdfHandoffs" | "videoHandoffs" | "resourceLaunches"
  | "objectiveRecall" | "flashcardRecall"
  | "subject" | "lectureCount" | "analyticsScope" | "selectSubject"
  | "viewLectures" | "selectedSubject" | "lectureAggregates" | "loadMore"
  | "noSubjects" | "noLectures" | "masteryDistribution" | "baseMastery"
  | "effectiveMastery" | "freshness" | "reviewDistribution"
  | "forgettingEvidence" | "trackedPairs" | "notStarted" | "started"
  | "learning" | "needsReview" | "good" | "mastered" | "insufficient"
  | "fresh" | "dueSoon" | "due" | "overdue" | "objective" | "selfReported"
  | "mixed" | "none" | "productAvailability" | "metricAvailability"
  | "policyVersion" | "analyticsVersion" | "status" | "metric" | "value"
  | "visible" | "noData" | "suppressed" | "unavailable" | "partial"
  | "lowSample" | "lowPopulation" | "noRecordedData" | "withheld"
  | "notAvailable" | "visibleValue" | "loading" | "retry" | "requestFailed"
  | "semesterUnavailable" | "loadError" | "last7" | "last30" | "semester"
  | "lectureAggregate" | "privacyNote" | "aggregateOnly" | "windowNote"
  | "sourceStatus" | "stale" | "missing" | "averageSession"
  | "windowRange" | "asOf" | "globalEligibleCohort"
  | "globalEligibilityNote" | "lectureDetailUnavailable";

const TEXT: Record<CopyKey, [string, string]> = {
  title: ["Owner analytics", "تحليلات مالك المنصة"],
  eyebrow: ["CONTROL CENTER  /  ACADEMIC ANALYTICS", "مركز التحكم  /  التحليلات الأكاديمية"],
  privacy: ["Private · aggregate-only view", "عرض خاص · بيانات إجمالية فقط"],
  period: ["Reporting window", "الفترة الزمنية"],
  refresh: ["Refresh data", "تحديث البيانات"],
  overview: ["Overview", "نظرة عامة"],
  adoption: ["Feature adoption", "استخدام الميزات"],
  activity: ["Study activity", "نشاط الدراسة"],
  subjects: ["Subjects", "المواد"],
  mastery: ["Mastery & review", "الإتقان والمراجعة"],
  operations: ["Operations", "التشغيل"],
  quality: ["Data quality", "جودة البيانات"],
  eligible: ["Eligible students", "الطلاب المؤهلون"],
  active: ["Active study users", "مستخدمو الدراسة النشطون"],
  activeRate: ["Active study rate", "معدل نشاط الدراسة"],
  scopeStatus: ["Cohort scope", "نطاق المجموعة"],
  noComparisons: ["No time series or comparison", "لا تتوفر سلسلة زمنية أو مقارنة"],
  notProvided: ["Time-series and previous-period comparisons are not provided by this data source.", "مصدر البيانات هذا لا يوفر سلسلة زمنية أو مقارنات مع فترات سابقة."],
  participation: ["Participation rates", "معدلات المشاركة"],
  focusParticipation: ["Meaningful focus", "جلسات التركيز الفعلية"],
  mcqParticipation: ["Normal MCQ", "أسئلة الاختيار من متعدد"],
  flashcardParticipation: ["Flashcards", "البطاقات التعليمية"],
  recallParticipation: ["Periodic recall", "الاسترجاع الدوري"],
  activityMetrics: ["Recorded activity", "النشاط المسجل"],
  focus: ["Focus", "التركيز"],
  meaningfulSessions: ["Meaningful sessions", "جلسات فعلية"],
  verifiedStudyTime: ["Verified study time", "وقت الدراسة الموثق"],
  groupFocus: ["Group focus", "التركيز الجماعي"],
  completedRuns: ["Completed runs", "الجلسات المكتملة"],
  participantSessions: ["Verified participant sessions", "جلسات المشاركين الموثقة"],
  groupFocusTime: ["Verified focus time", "وقت التركيز الموثق"],
  mcq: ["MCQ", "اختيار من متعدد"],
  attempts: ["Objective attempts", "المحاولات الموضوعية"],
  correct: ["Correct", "إجابات صحيحة"],
  incorrect: ["Incorrect", "إجابات غير صحيحة"],
  distinctItems: ["Distinct items attempted", "عناصر مختلفة تمت محاولتها"],
  accuracy: ["Objective MCQ accuracy", "دقة أسئلة الاختيار من متعدد"],
  flashcards: ["Flashcards", "البطاقات التعليمية"],
  reviews: ["Meaningful reviews", "مراجعات فعلية"],
  remembered: ["Self-reported remembered", "أفادوا بالتذكر"],
  notRemembered: ["Self-reported not remembered", "أفادوا بعدم التذكر"],
  distinctCards: ["Distinct cards reviewed", "بطاقات مختلفة تمت مراجعتها"],
  rememberedRate: ["Self-reported remembered rate", "معدل التذكر وفق الإفادة الذاتية"],
  recall: ["Periodic recall", "الاسترجاع الدوري"],
  presented: ["Presented", "عُرضت"],
  answered: ["Answered", "تمت الإجابة"],
  skipped: ["Skipped", "تم تخطيها"],
  expired: ["Expired", "انتهى وقتها"],
  resources: ["Resource handoffs", "الإحالات إلى المصادر"],
  handoffs: ["Total handoffs", "إجمالي الإحالات"],
  pdfHandoffs: ["PDF handoffs", "إحالات PDF"],
  videoHandoffs: ["Video handoffs", "إحالات الفيديو"],
  resourceLaunches: ["Resource launches", "مرات فتح المصادر"],
  objectiveRecall: ["Objective recall", "الاسترجاع الموضوعي"],
  flashcardRecall: ["Flashcard recall", "استرجاع البطاقات"],
  subject: ["Subject", "المادة"],
  lectureCount: ["Lectures", "المحاضرات"],
  analyticsScope: ["Data scope", "نطاق البيانات"],
  selectSubject: ["Choose a subject to request its lecture aggregates.", "اختر مادة لطلب بيانات محاضراتها الإجمالية."],
  viewLectures: ["View lecture aggregates", "عرض بيانات المحاضرات الإجمالية"],
  selectedSubject: ["Selected subject", "المادة المحددة"],
  lectureAggregates: ["Lecture aggregates", "بيانات المحاضرات الإجمالية"],
  loadMore: ["Load next page", "تحميل الصفحة التالية"],
  noSubjects: ["No subject aggregates are available for this window.", "لا تتوفر بيانات إجمالية للمواد في هذه الفترة."],
  noLectures: ["No lecture aggregates are available for this subject and window.", "لا تتوفر بيانات إجمالية للمحاضرات لهذه المادة والفترة."],
  masteryDistribution: ["Mastery distributions", "توزيعات الإتقان"],
  baseMastery: ["Base mastery", "الإتقان الأساسي"],
  effectiveMastery: ["Freshness-adjusted mastery", "الإتقان المعدل حسب حداثة البيانات"],
  freshness: ["Freshness distribution", "توزيع حداثة البيانات"],
  reviewDistribution: ["Review schedule distribution", "توزيع مواعيد المراجعة"],
  forgettingEvidence: ["Forgetting evidence", "أدلة النسيان"],
  trackedPairs: ["Tracked user–lecture pairs", "أزواج المستخدم والمحاضرة المتتبعة"],
  notStarted: ["Not started", "لم يبدأ"],
  started: ["Started", "بدأ"],
  learning: ["Learning", "قيد التعلم"],
  needsReview: ["Needs review", "تحتاج إلى مراجعة"],
  good: ["Good", "جيد"],
  mastered: ["Mastered", "متقن"],
  insufficient: ["Insufficient evidence", "أدلة غير كافية"],
  fresh: ["Fresh", "حديث"],
  dueSoon: ["Due soon", "موعدها قريب"],
  due: ["Due", "مستحقة"],
  overdue: ["Overdue", "متأخرة"],
  objective: ["Objective", "موضوعي"],
  selfReported: ["Self-reported", "إفادة ذاتية"],
  mixed: ["Mixed", "مختلط"],
  none: ["None", "لا يوجد"],
  productAvailability: ["Product data availability", "توفر بيانات المنتج"],
  metricAvailability: ["Metric disclosure", "إفصاح المقاييس"],
  policyVersion: ["Privacy policy", "سياسة الخصوصية"],
  analyticsVersion: ["Analytics version", "إصدار التحليلات"],
  status: ["Status", "الحالة"],
  metric: ["Metric", "المقياس"],
  value: ["Value", "القيمة"],
  visible: ["Visible", "ظاهر"],
  noData: ["No recorded data", "لا توجد بيانات مسجلة"],
  suppressed: ["Suppressed", "محجوب"],
  unavailable: ["Unavailable", "غير متاح"],
  partial: ["Partially suppressed", "محجوب جزئيًا"],
  lowSample: ["Low sample", "عينة محدودة"],
  lowPopulation: ["Low population", "مجموعة صغيرة"],
  noRecordedData: ["No recorded data", "لا توجد بيانات مسجلة"],
  withheld: ["Withheld for privacy", "محجوب حفاظًا على الخصوصية"],
  notAvailable: ["Unavailable", "غير متاح"],
  visibleValue: ["Available aggregate", "بيانات إجمالية متاحة"],
  loading: ["Loading privacy-safe aggregates", "جارٍ تحميل البيانات الإجمالية الآمنة"],
  retry: ["Try again", "إعادة المحاولة"],
  requestFailed: ["The analytics request could not be completed.", "تعذر إكمال طلب التحليلات."],
  semesterUnavailable: ["The current semester window is unavailable (server response 503). No other window was loaded.", "فترة الفصل الدراسي الحالي غير متاحة (استجابة الخادم 503). لم يتم تحميل فترة أخرى."],
  loadError: ["Unable to load owner analytics.", "تعذر تحميل تحليلات المالك."],
  last7: ["Last 7 days", "آخر 7 أيام"],
  last30: ["Last 30 days", "آخر 30 يومًا"],
  semester: ["Current semester", "الفصل الدراسي الحالي"],
  lectureAggregate: ["Lecture aggregate", "بيانات محاضرة إجمالية"],
  privacyNote: ["Only server-verified, privacy-safe cohort aggregates are shown. No student-level records are included.", "تُعرض البيانات الإجمالية الآمنة للمجموعة والمتحقق منها من الخادم فقط. لا تتضمن الشاشة سجلات فردية للطلاب."],
  aggregateOnly: ["Aggregate only", "بيانات إجمالية فقط"],
  windowNote: ["Window is determined by the server.", "يحدد الخادم الفترة الزمنية."],
  windowRange: ["Reporting window (Baghdad time)", "فترة التقرير (توقيت بغداد)"],
  asOf: ["Data as of", "البيانات حتى"],
  globalEligibleCohort: ["Eligible cohort (global)", "المجموعة المؤهلة (إجمالي)"],
  globalEligibilityNote: [
    "Privacy thresholds use the global eligible-student population; subject-specific enrollment is not available.",
    "تعتمد عتبات الخصوصية على إجمالي الطلاب المؤهلين؛ بيانات التسجيل حسب المادة غير متاحة.",
  ],
  lectureDetailUnavailable: ["Lecture aggregates are withheld for this subject's population.", "بيانات المحاضرات محجوبة بسبب عدد أفراد هذه المجموعة."],
  sourceStatus: ["Cohort disclosure status", "حالة الإفصاح للمجموعة"],
  stale: ["Stale", "قديم"],
  missing: ["Missing", "مفقود"],
  averageSession: ["Average meaningful session", "متوسط الجلسة الفعلية"],
};

function t(language: Language, key: CopyKey): string {
  return TEXT[key][language === "ar" ? 1 : 0];
}

function numberText(value: number, language: Language): string {
  return new Intl.NumberFormat(language === "ar" ? "ar-IQ" : "en-US", { maximumFractionDigits: 0 }).format(value);
}

function rateText(rate: { rateBps: number | null }, language: Language): string {
  return rate.rateBps === null
    ? "—"
    : new Intl.NumberFormat(language === "ar" ? "ar-IQ" : "en-US", { maximumFractionDigits: 2 }).format(rate.rateBps / 100) + "%";
}

function dateText(value: string, language: Language): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(language === "ar" ? "ar-IQ" : "en-US", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function disclosureText<T>(
  item: { status: string; value: T | null },
  language: Language,
  formatter: (value: T) => string,
): string {
  if (item.status === "NO_DATA") return t(language, "noRecordedData");
  if (item.status === "SUPPRESSED") return t(language, "withheld");
  if (item.status === "UNAVAILABLE") return t(language, "notAvailable");
  if (item.status === "VISIBLE") return item.value === null ? "—" : formatter(item.value);
  return t(language, "notAvailable");
}

function statusText(status: string, language: Language): string {
  const map: Record<string, CopyKey> = {
    VISIBLE: "visible",
    NO_DATA: "noData",
    SUPPRESSED: "withheld",
    UNAVAILABLE: "unavailable",
    PARTIALLY_SUPPRESSED: "partial",
    LOW_SAMPLE: "lowSample",
    LOW_POPULATION: "lowPopulation",
  };
  return t(language, map[status] ?? "unavailable");
}

function Panel({
  title,
  description,
  icon,
  children,
  id,
  className = "",
}: {
  title: string;
  description?: string;
  icon: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-heading` : undefined}
      className={`min-w-0 scroll-mt-5 rounded-2xl border border-slate-200/80 bg-[#fbfcfa] p-4 shadow-[0_2px_10px_rgba(24,48,47,0.035)] dark:border-white/[0.09] dark:bg-[#131b1d] sm:p-5 ${className}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#e4efec] text-[#286b62] dark:bg-[#1e3835] dark:text-[#9bd2c4]" aria-hidden="true">{icon}</span>
        <div className="min-w-0">
          <h2 id={id ? `${id}-heading` : undefined} className="text-base font-semibold tracking-[-0.02em] text-slate-900 dark:text-slate-100">{title}</h2>
          {description && <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p>}
        </div>
      </div>
      <div className="mt-4 min-w-0">{children}</div>
    </section>
  );
}

function MetricValue({
  label,
  value,
  detail,
  emphasized = false,
}: {
  label: string;
  value: string;
  detail?: string;
  emphasized?: boolean;
}) {
  return (
    <div className={`min-w-0 border-s border-slate-200/80 ps-3 first:border-0 first:ps-0 dark:border-white/10 ${emphasized ? "py-0.5" : ""}`}>
      <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 break-words font-semibold tracking-tight text-slate-900 dark:text-slate-100 ${emphasized ? "text-2xl" : "text-lg"}`} dir="auto">{value}</p>
      {detail && <p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">{detail}</p>}
    </div>
  );
}

function DisclosureRow<T>({
  label,
  item,
  language,
  format = (value: T) => String(value),
}: {
  label: string;
  item: { status: string; value: T | null };
  language: Language;
  format?: (value: T) => string;
}) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-4 border-b border-slate-100 py-2.5 last:border-0 last:pb-0 dark:border-white/[0.07]">
      <span className="min-w-0 text-sm leading-5 text-slate-600 dark:text-slate-300">{label}</span>
      <span className="max-w-[58%] shrink-0 text-end text-sm font-semibold text-slate-800 dark:text-slate-100" dir="auto">
        {disclosureText(item, language, format)}
      </span>
    </div>
  );
}

function DataTable({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-white/10">
      <table className="w-full min-w-[560px] border-collapse text-start text-sm">
        <caption className="sr-only">{label}</caption>
        {children}
      </table>
    </div>
  );
}

function scopeItems(scope: OwnerSafeScope): Array<[CopyKey, string]> {
  const activity = scope.activityWindowMetrics;
  return [
    ["active", scope.activeStudyUsers.status],
    ["activeRate", scope.activeStudyRate.status],
    ["focus", activity.focus.status],
    ["groupFocus", activity.groupFocus.status],
    ["mcq", activity.mcq.status],
    ["flashcards", activity.flashcards.status],
    ["recall", activity.recall.periodicPresented.status],
    ["resources", activity.resources.handoffs.status],
    ["resourceLaunches", activity.resources.launches.status],
    ["mastery", scope.currentStateMetrics.status],
  ];
}

function useLocaleDirection(language: Language): "rtl" | "ltr" {
  return language === "ar" ? "rtl" : "ltr";
}

export default function OwnerAnalyticsDashboard({ language, subjects }: Props) {
  const rtl = useLocaleDirection(language) === "rtl";
  const [windowPreset, setWindowPreset] = useState<OwnerAnalyticsWindowPreset>("LAST_30_DAYS");
  const [data, setData] = useState<OwnerAcademicAnalyticsResponse | null>(null);
  const [error, setError] = useState<OwnerAnalyticsRequestError | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [lecturePage, setLecturePage] = useState<OwnerAnalyticsLectureListResponse | null>(null);
  const [lectureItems, setLectureItems] = useState<OwnerSafeLecture[]>([]);
  const [lectureLoading, setLectureLoading] = useState(false);
  const [lectureError, setLectureError] = useState<OwnerAnalyticsRequestError | null>(null);
  const requestSequence = useRef(0);
  const lectureSequence = useRef(0);

  const dictionary = useMemo(() => new Map(subjects.map((subject) => [subject.id, subject])), [subjects]);
  const lectureTitlesById = useMemo(() => new Map(
    subjects.flatMap((subject) =>
      subject.modules.flatMap((module) =>
        module.lectures.map((lecture) => [lecture.id, lecture.title] as const),
      ),
    ),
  ), [subjects]);
  const selectedSubject = useMemo(
    () => selectedSubjectId ? dictionary.get(selectedSubjectId as Subject["id"]) ?? null : null,
    [dictionary, selectedSubjectId],
  );
  const selectedSubjectAggregate = useMemo(
    () => selectedSubjectId
      ? data?.subjects.find((subject) => subject.subjectId === selectedSubjectId) ?? null
      : null,
    [data, selectedSubjectId],
  );
  const getSubjectName = useCallback((subject: OwnerSafeSubject) => {
    const known = dictionary.get(subject.subjectId as Subject["id"]);
    return known ? (language === "ar" ? known.nameAr : known.name) : (language === "ar" ? "مادة أخرى" : "Other subject");
  }, [dictionary, language]);
  const selectedSubjectLabel = selectedSubject
    ? language === "ar" ? selectedSubject.nameAr : selectedSubject.name
    : selectedSubjectAggregate
      ? getSubjectName(selectedSubjectAggregate)
      : "";

  const loadAnalytics = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const response = await getOwnerAcademicAnalytics(windowPreset);
      if (requestSequence.current !== sequence) return;
      setData(response);
    } catch (caught) {
      if (requestSequence.current !== sequence) return;
      setError(caught instanceof OwnerAnalyticsRequestError ? caught : new OwnerAnalyticsRequestError(0));
      setData(null);
    } finally {
      if (requestSequence.current === sequence) setLoading(false);
    }
  }, [windowPreset]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics, refreshToken]);

  const loadLecturePage = useCallback(async (cursor?: string, append = false) => {
    if (
      !selectedSubjectId
      || !selectedSubjectAggregate
      || selectedSubjectAggregate.analyticsStatus === "LOW_SAMPLE"
      || selectedSubjectAggregate.analyticsStatus === "LOW_POPULATION"
    ) return;
    const sequence = ++lectureSequence.current;
    setLectureLoading(true);
    setLectureError(null);
    try {
      const response = await getOwnerAnalyticsLectures(windowPreset, {
        subjectId: selectedSubjectId,
        ...(cursor ? { cursor } : {}),
      });
      if (lectureSequence.current !== sequence) return;
      setLecturePage(response);
      setLectureItems((previous) => append ? [...previous, ...response.lectures] : response.lectures);
    } catch (caught) {
      if (lectureSequence.current !== sequence) return;
      setLectureError(caught instanceof OwnerAnalyticsRequestError ? caught : new OwnerAnalyticsRequestError(0));
      if (!append) {
        setLecturePage(null);
        setLectureItems([]);
      }
    } finally {
      if (lectureSequence.current === sequence) setLectureLoading(false);
    }
  }, [selectedSubjectAggregate, selectedSubjectId, windowPreset]);

  useEffect(() => {
    lectureSequence.current += 1;
    setLecturePage(null);
    setLectureItems([]);
    setLectureError(null);
    setLectureLoading(false);
    if (
      selectedSubjectId
      && selectedSubjectAggregate
      && selectedSubjectAggregate.analyticsStatus !== "LOW_SAMPLE"
      && selectedSubjectAggregate.analyticsStatus !== "LOW_POPULATION"
    ) {
      void loadLecturePage();
    }
  }, [selectedSubjectAggregate, selectedSubjectId, windowPreset, loadLecturePage]);

  const chooseWindow = (next: OwnerAnalyticsWindowPreset) => {
    setWindowPreset(next);
    setSelectedSubjectId(null);
  };

  const refresh = () => {
    setRefreshToken((value) => value + 1);
  };

  const cohort = data;
  const anchorLinks: Array<[CopyKey, string]> = [
    ["overview", "owner-analytics-overview"],
    ["adoption", "owner-analytics-adoption"],
    ["activity", "owner-analytics-activity"],
    ["subjects", "owner-analytics-subjects"],
    ["mastery", "owner-analytics-mastery"],
    ["operations", "owner-analytics-operations"],
    ["quality", "owner-analytics-quality"],
  ];

  const renderDisclosureList = (
    values: Array<{ label: CopyKey; item: { status: string; value: any }; format?: (value: any) => string }>,
  ) => (
    <div>{values.map(({ label, item, format }, index) => (
      <DisclosureRow key={`${label}-${index}`} label={t(language, label)} item={item} language={language}
        format={format ?? ((value) => numberText(value, language))} />
    ))}</div>
  );

  const renderStateDistribution = (
    label: CopyKey,
    item: OwnerSafeScope["currentStateMetrics"],
    getValues: (value: NonNullable<OwnerSafeScope["currentStateMetrics"]["value"]>) => Array<[CopyKey, number]>,
  ) => {
    if (item.status !== "VISIBLE" || !item.value) {
      return <DisclosureRow label={t(language, label)} item={item} language={language} format={() => t(language, "visibleValue")} />;
    }
    return (
      <div className="border-b border-slate-100 py-3 last:border-0 dark:border-white/[0.07]">
        <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">{t(language, label)}</h3>
        <div className="grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-3">
          {getValues(item.value).map(([key, value]) => (
            <div key={key} className="flex justify-between gap-3 text-xs">
              <span className="text-slate-500 dark:text-slate-400">{t(language, key)}</span>
              <bdi className="font-semibold text-slate-800 dark:text-slate-100">{numberText(value, language)}</bdi>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderLectureScope = (lecture: OwnerSafeLecture) => {
    const scopeStatus = lecture.analyticsStatus;
    const canIdentifyLecture = scopeStatus === "VISIBLE" || scopeStatus === "NO_DATA";
    const lectureTitle = canIdentifyLecture
      ? lectureTitlesById.get(lecture.lectureId) ?? t(language, "lectureAggregate")
      : t(language, "withheld");
    return (
      <article className="rounded-xl border border-slate-200/70 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[0.025]">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-medium text-slate-800 dark:text-slate-100">{lectureTitle}</h4>
          <span className="rounded-full bg-[#e8efed] px-2.5 py-1 text-[11px] font-medium text-[#42625e] dark:bg-[#203330] dark:text-[#bbd7d0]">{statusText(scopeStatus, language)}</span>
        </div>
        <div className="mt-2 grid gap-x-5 sm:grid-cols-2">
          <DisclosureRow label={t(language, "active")} item={lecture.activeStudyUsers} language={language} format={(value) => numberText(value, language)} />
          <DisclosureRow label={t(language, "activeRate")} item={lecture.activeStudyRate} language={language} format={(value) => rateText(value, language)} />
          <DisclosureRow label={t(language, "focus")} item={lecture.activityWindowMetrics.focus} language={language} format={(value) => numberText(value.meaningfulSessionCount, language)} />
          <DisclosureRow label={t(language, "mcq")} item={lecture.activityWindowMetrics.mcq} language={language} format={(value) => numberText(value.objectiveAttempts, language)} />
        </div>
      </article>
    );
  };

  const statusRows: Array<[CopyKey, string]> = cohort ? [
    ...scopeItems(cohort),
    ["focusParticipation", cohort.participationRates.meaningfulFocusUsers.status],
    ["mcqParticipation", cohort.participationRates.normalMcqUsers.status],
    ["flashcardParticipation", cohort.participationRates.flashcardUsers.status],
    ["recallParticipation", cohort.participationRates.periodicRecallUsers.status],
    ["meaningfulSessions", cohort.activityWindowMetrics.focusAverageMeaningfulSessionSeconds.status],
    ["presented", cohort.activityWindowMetrics.recall.periodicPresented.status],
    ["answered", cohort.activityWindowMetrics.recall.periodicAnswered.status],
    ["skipped", cohort.activityWindowMetrics.recall.periodicSkipped.status],
    ["expired", cohort.activityWindowMetrics.recall.periodicExpired.status],
    ["objectiveRecall", cohort.activityWindowMetrics.recall.objectiveMcq.status],
    ["remembered", cohort.activityWindowMetrics.recall.flashcardRemembered.status],
    ["notRemembered", cohort.activityWindowMetrics.recall.flashcardNotRemembered.status],
  ] : [];

  return (
    <div dir={rtl ? "rtl" : "ltr"} className="min-h-[100dvh] min-w-0 text-slate-800 dark:text-slate-100">
      <div className="mx-auto w-full max-w-[1440px] space-y-4 px-3 py-4 sm:px-5 sm:py-5 lg:px-6">
        <header className="relative overflow-hidden rounded-2xl border border-[#d8e5e1] bg-[#edf4f1] p-4 dark:border-[#28403b] dark:bg-[#152421] sm:p-5">
          <div className="pointer-events-none absolute -end-16 -top-24 h-56 w-56 rounded-full border border-[#c8ded7]/70 dark:border-[#33544d]/60" />
          <div className="pointer-events-none absolute -end-3 -top-11 h-32 w-32 rounded-full border border-[#c8ded7]/70 dark:border-[#33544d]/60" />
          <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-bold tracking-[0.15em] text-[#52716a] dark:text-[#9bc6ba]">{t(language, "eyebrow")}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="text-2xl font-semibold tracking-[-0.04em] text-[#17332f] dark:text-[#e4f3ed] sm:text-3xl">{t(language, "title")}</h1>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#c6d9d3] bg-[#f8fbf9] px-2.5 py-1 text-[11px] font-medium text-[#3d665e] dark:border-[#35564e] dark:bg-[#1b302c] dark:text-[#b9ddd1]">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />{t(language, "privacy")}
                </span>
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#58716b] dark:text-[#adc2bc]">{t(language, "privacyNote")}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-[#506861] dark:text-[#bbd0ca]">
                {t(language, "period")}
                <span className="relative">
                  <select
                    aria-label={t(language, "period")}
                    value={windowPreset}
                    onChange={(event) => chooseWindow(event.target.value as OwnerAnalyticsWindowPreset)}
                    className="min-h-11 w-full appearance-none rounded-xl border border-[#c9d9d4] bg-[#fbfdfc] py-2 ps-3 pe-10 text-sm font-semibold text-slate-800 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#29776b] focus-visible:ring-offset-2 focus-visible:ring-offset-[#edf4f1] dark:border-[#35544d] dark:bg-[#1b2c29] dark:text-slate-100 dark:focus-visible:ring-[#90d0bd] dark:focus-visible:ring-offset-[#152421] sm:min-w-48"
                  >
                    <option value="LAST_7_DAYS">{t(language, "last7")}</option>
                    <option value="LAST_30_DAYS">{t(language, "last30")}</option>
                    <option value="CURRENT_SEMESTER">{t(language, "semester")}</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                </span>
              </label>
              <button type="button" onClick={refresh} disabled={loading || lectureLoading}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#c9d9d4] bg-[#fbfdfc] px-3.5 text-sm font-semibold text-[#345e56] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#29776b] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 dark:border-[#35544d] dark:bg-[#1b2c29] dark:text-[#c8e4dc] dark:hover:bg-[#233b36] dark:focus-visible:ring-[#90d0bd] dark:focus-visible:ring-offset-[#152421]">
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />{t(language, "refresh")}
              </button>
            </div>
          </div>
          <div className="relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[#d7e4df] pt-3 text-[11px] text-[#617870] dark:border-[#2c4740] dark:text-[#a8beb7]">
            <span className="inline-flex items-center gap-1.5"><Database className="h-3.5 w-3.5" aria-hidden="true" />{t(language, "aggregateOnly")}</span>
            {data?.window ? (
              <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{t(language, "windowRange")}:</span>
                <bdi dir="ltr">{dateText(data.window.from, language)} — {dateText(data.window.to, language)}</bdi>
                <span aria-hidden="true">·</span>
                <span>{t(language, "asOf")}:</span>
                <bdi dir="ltr">{dateText(data.window.asOf, language)}</bdi>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{t(language, "windowNote")}</span>
            )}
            <span className="inline-flex items-center gap-1.5"><CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />{t(language, "noComparisons")}</span>
          </div>
        </header>

        <nav aria-label={language === "ar" ? "أقسام التحليلات" : "Analytics sections"}
          className="sticky top-0 z-20 -mx-3 overflow-x-auto border-y border-slate-200/70 bg-[#f5f7f4]/95 px-3 py-2 backdrop-blur-sm dark:border-white/[0.08] dark:bg-[#101719]/95 sm:-mx-5 sm:px-5 lg:-mx-6 lg:px-6">
          <ul className="flex min-w-max items-center gap-1.5">
            {anchorLinks.map(([label, id], index) => (
              <li key={id}>
                <a href={`#${id}`} className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#287a6d] dark:focus-visible:ring-[#9bd2c4] ${index === 0 ? "bg-[#dceae5] text-[#285e54] dark:bg-[#203934] dark:text-[#cae8dd]" : "text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-white/[0.06]"}`}>
                  {index === 0 && <Activity className="h-3.5 w-3.5" aria-hidden="true" />}
                  {t(language, label)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {error && (
          <div role="alert" className="flex flex-col gap-3 rounded-xl border border-[#e3c7a2] bg-[#fff8ec] p-4 text-sm text-[#684e2c] dark:border-[#685035] dark:bg-[#2b2115] dark:text-[#f0d4a9] sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">{error.status === 503 && windowPreset === "CURRENT_SEMESTER" ? t(language, "semesterUnavailable") : t(language, "loadError")}</p>
                {!(error.status === 503 && windowPreset === "CURRENT_SEMESTER") && <p className="mt-1 text-xs">{t(language, "requestFailed")}{error.status ? ` (${numberText(error.status, language)})` : ""}</p>}
              </div>
            </div>
            <button type="button" onClick={() => setRefreshToken((value) => value + 1)} className="min-h-10 rounded-lg border border-current/20 px-3 text-xs font-semibold hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9a6b2f] dark:hover:bg-white/[0.06]">{t(language, "retry")}</button>
          </div>
        )}

        {loading && !data ? (
          <div aria-label={t(language, "loading")} aria-busy="true" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl border border-slate-200/70 bg-slate-100/80 motion-reduce:animate-none dark:border-white/[0.07] dark:bg-white/[0.035]" />)}
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {[0, 1].map((item) => <div key={item} className="h-64 animate-pulse rounded-2xl border border-slate-200/70 bg-slate-100/80 motion-reduce:animate-none dark:border-white/[0.07] dark:bg-white/[0.035]" />)}
            </div>
          </div>
        ) : cohort ? (
          <>
            <section id="owner-analytics-overview" aria-labelledby="owner-analytics-overview-heading" className="scroll-mt-28">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold tracking-[0.13em] text-[#5d7b73] dark:text-[#93b9ad]">{t(language, "overview").toUpperCase()}</p>
                  <h2 id="owner-analytics-overview-heading" className="mt-1 text-lg font-semibold tracking-[-0.025em] text-slate-900 dark:text-slate-100">{t(language, "scopeStatus")}</h2>
                </div>
                <span className="rounded-full border border-slate-200 bg-[#f9faf8] px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300">{statusText(cohort.analyticsStatus, language)}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-[#c9dbd5] bg-[#eaf2ef] p-4 dark:border-[#2e4c45] dark:bg-[#1a2c28]">
                  <div className="flex items-center justify-between gap-3">
                    <MetricValue emphasized label={t(language, "eligible")} value={numberText(cohort.eligibleStudents, language)} detail={t(language, "aggregateOnly")} />
                    <UsersRound className="h-5 w-5 text-[#4b796f]" aria-hidden="true" />
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200/80 bg-[#fbfcfa] p-4 dark:border-white/[0.09] dark:bg-[#131b1d]">
                  <DisclosureRow label={t(language, "active")} item={cohort.activeStudyUsers} language={language} format={(value) => numberText(value, language)} />
                  <div className="mt-1"><DisclosureRow label={t(language, "activeRate")} item={cohort.activeStudyRate} language={language} format={(value) => rateText(value, language)} /></div>
                </div>
                <div className="rounded-2xl border border-slate-200/80 bg-[#fbfcfa] p-4 dark:border-white/[0.09] dark:bg-[#131b1d]">
                  <div className="flex items-start gap-2.5">
                    <Activity className="mt-0.5 h-4 w-4 shrink-0 text-[#b1813b]" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t(language, "noComparisons")}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{t(language, "notProvided")}</p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <div className="grid min-w-0 gap-4 xl:grid-cols-2">
              <Panel id="owner-analytics-adoption" title={t(language, "adoption")} description={t(language, "participation")} icon={<UsersRound className="h-4 w-4" />}>
                <div className="grid gap-x-7 sm:grid-cols-2">
                  <DisclosureRow label={t(language, "focusParticipation")} item={cohort.participationRates.meaningfulFocusUsers} language={language} format={(value) => rateText(value, language)} />
                  <DisclosureRow label={t(language, "mcqParticipation")} item={cohort.participationRates.normalMcqUsers} language={language} format={(value) => rateText(value, language)} />
                  <DisclosureRow label={t(language, "flashcardParticipation")} item={cohort.participationRates.flashcardUsers} language={language} format={(value) => rateText(value, language)} />
                  <DisclosureRow label={t(language, "recallParticipation")} item={cohort.participationRates.periodicRecallUsers} language={language} format={(value) => rateText(value, language)} />
                </div>
              </Panel>

              <Panel id="owner-analytics-activity" title={t(language, "activity")} description={t(language, "activityMetrics")} icon={<Activity className="h-4 w-4" />}>
                <div className="grid gap-x-7 lg:grid-cols-2">
                  <div>
                    <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.08em] text-[#51746b] dark:text-[#a3c8bd]">{t(language, "focus")}</h3>
                    {renderDisclosureList([
                      { label: "meaningfulSessions", item: cohort.activityWindowMetrics.focus, format: (value) => numberText(value.meaningfulSessionCount, language) },
                      { label: "verifiedStudyTime", item: cohort.activityWindowMetrics.focus, format: (value) => `${numberText(Math.round(value.verifiedStudySeconds / 60), language)} ${language === "ar" ? "دقيقة" : "min"}` },
                    ])}
                    <DisclosureRow label={t(language, "averageSession")} item={cohort.activityWindowMetrics.focusAverageMeaningfulSessionSeconds} language={language}
                      format={(value) => value === null ? "—" : `${numberText(value, language)} ${language === "ar" ? "ثانية" : "sec"}`} />
                    <div className="mt-2">
                      {renderDisclosureList([
                        { label: "completedRuns", item: cohort.activityWindowMetrics.groupFocus, format: (value) => numberText(value.completedRuns, language) },
                        { label: "participantSessions", item: cohort.activityWindowMetrics.groupFocus, format: (value) => numberText(value.verifiedParticipantSessions, language) },
                        { label: "groupFocusTime", item: cohort.activityWindowMetrics.groupFocus, format: (value) => `${numberText(Math.round(value.verifiedFocusSeconds / 60), language)} ${language === "ar" ? "دقيقة" : "min"}` },
                      ])}
                    </div>
                  </div>
                  <div className="mt-4 lg:mt-0">
                    <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.08em] text-[#51746b] dark:text-[#a3c8bd]">{t(language, "mcq")}</h3>
                    {renderDisclosureList([
                      { label: "attempts", item: cohort.activityWindowMetrics.mcq, format: (value) => numberText(value.objectiveAttempts, language) },
                      { label: "correct", item: cohort.activityWindowMetrics.mcq, format: (value) => numberText(value.objectiveCorrect, language) },
                      { label: "incorrect", item: cohort.activityWindowMetrics.mcq, format: (value) => numberText(value.objectiveIncorrect, language) },
                      { label: "distinctItems", item: cohort.activityWindowMetrics.mcq, format: (value) => numberText(value.distinctItemsAttempted, language) },
                      { label: "accuracy", item: cohort.activityWindowMetrics.mcq, format: (value) => rateText(value.accuracyRate, language) },
                    ])}
                    <h3 className="mb-1 mt-4 text-xs font-bold uppercase tracking-[0.08em] text-[#51746b] dark:text-[#a3c8bd]">{t(language, "flashcards")}</h3>
                    {renderDisclosureList([
                      { label: "reviews", item: cohort.activityWindowMetrics.flashcards, format: (value) => numberText(value.meaningfulReviews, language) },
                      { label: "remembered", item: cohort.activityWindowMetrics.flashcards, format: (value) => numberText(value.selfReportedRemembered, language) },
                      { label: "notRemembered", item: cohort.activityWindowMetrics.flashcards, format: (value) => numberText(value.selfReportedNotRemembered, language) },
                      { label: "distinctCards", item: cohort.activityWindowMetrics.flashcards, format: (value) => numberText(value.distinctCardsReviewed, language) },
                      { label: "rememberedRate", item: cohort.activityWindowMetrics.flashcards, format: (value) => rateText(value.selfReportedRememberedRate, language) },
                    ])}
                  </div>
                </div>
                <div className="mt-4 grid gap-x-7 border-t border-slate-100 pt-3 dark:border-white/[0.07] sm:grid-cols-2">
                  <div>
                    <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.08em] text-[#51746b] dark:text-[#a3c8bd]">{t(language, "recall")}</h3>
                    {renderDisclosureList([
                      { label: "presented", item: cohort.activityWindowMetrics.recall.periodicPresented },
                      { label: "answered", item: cohort.activityWindowMetrics.recall.periodicAnswered },
                      { label: "skipped", item: cohort.activityWindowMetrics.recall.periodicSkipped },
                      { label: "expired", item: cohort.activityWindowMetrics.recall.periodicExpired },
                    ])}
                    <h4 className="mb-1 mt-4 text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 dark:text-slate-400">{t(language, "objectiveRecall")}</h4>
                    {renderDisclosureList([
                      { label: "answered", item: cohort.activityWindowMetrics.recall.objectiveMcq, format: (value) => numberText(value.objectiveMcqAnswered, language) },
                      { label: "correct", item: cohort.activityWindowMetrics.recall.objectiveMcq, format: (value) => numberText(value.objectiveMcqCorrect, language) },
                      { label: "incorrect", item: cohort.activityWindowMetrics.recall.objectiveMcq, format: (value) => numberText(value.objectiveMcqIncorrect, language) },
                      { label: "accuracy", item: cohort.activityWindowMetrics.recall.objectiveMcq, format: (value) => rateText(value.objectiveMcqAccuracyRate, language) },
                    ])}
                    <h4 className="mb-1 mt-4 text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 dark:text-slate-400">{t(language, "flashcardRecall")}</h4>
                    <DisclosureRow label={t(language, "remembered")} item={cohort.activityWindowMetrics.recall.flashcardRemembered} language={language} format={(value) => numberText(value, language)} />
                    <DisclosureRow label={t(language, "notRemembered")} item={cohort.activityWindowMetrics.recall.flashcardNotRemembered} language={language} format={(value) => numberText(value, language)} />
                  </div>
                  <div className="mt-4 sm:mt-0">
                    <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.08em] text-[#51746b] dark:text-[#a3c8bd]">{t(language, "resources")}</h3>
                    <DisclosureRow label={t(language, "handoffs")} item={cohort.activityWindowMetrics.resources.handoffs} language={language} format={(value) => numberText(value.resourceHandoffs, language)} />
                    <DisclosureRow label={t(language, "pdfHandoffs")} item={cohort.activityWindowMetrics.resources.handoffs} language={language} format={(value) => numberText(value.handoffsByType.PDF, language)} />
                    <DisclosureRow label={t(language, "videoHandoffs")} item={cohort.activityWindowMetrics.resources.handoffs} language={language} format={(value) => numberText(value.handoffsByType.VIDEO, language)} />
                    <DisclosureRow label={t(language, "resourceLaunches")} item={cohort.activityWindowMetrics.resources.launches} language={language} format={() => t(language, "notAvailable")} />
                  </div>
                </div>
              </Panel>

              <Panel id="owner-analytics-subjects" title={t(language, "subjects")} description={t(language, "selectSubject")} icon={<BookOpen className="h-4 w-4" />} className="xl:col-span-2">
                {cohort.subjects.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-white/15 dark:text-slate-400">{t(language, "noSubjects")}</div>
                ) : (
                  <>
                    <div className="space-y-2.5 md:hidden">
                      {cohort.subjects.map((subject) => {
                        const label = getSubjectName(subject);
                        const selected = selectedSubjectId === subject.subjectId;
                        const canViewLectureAggregates =
                          subject.analyticsStatus !== "LOW_SAMPLE"
                          && subject.analyticsStatus !== "LOW_POPULATION";
                        return (
                          <article key={subject.subjectId}
                            className={`rounded-xl border p-3.5 ${selected ? "border-[#9bbdb2] bg-[#edf5f1] dark:border-[#42685c] dark:bg-[#1b302b]" : "border-slate-200/80 bg-white/70 dark:border-white/10 dark:bg-white/[0.025]"}`}>
                            <div className="flex items-start justify-between gap-3">
                              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</h3>
                              <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-white/[0.07] dark:text-slate-300">{statusText(subject.analyticsStatus, language)}</span>
                            </div>
                            <div className="mt-2">
                              <DisclosureRow label={t(language, "active")} item={subject.activeStudyUsers} language={language} format={(value) => numberText(value, language)} />
                              <DisclosureRow label={t(language, "activeRate")} item={subject.activeStudyRate} language={language} format={(value) => rateText(value, language)} />
                              <DisclosureRow label={t(language, "meaningfulSessions")} item={subject.activityWindowMetrics.focus} language={language} format={(value) => numberText(value.meaningfulSessionCount, language)} />
                              <DisclosureRow label={t(language, "attempts")} item={subject.activityWindowMetrics.mcq} language={language} format={(value) => numberText(value.objectiveAttempts, language)} />
                            </div>
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs text-slate-500 dark:text-slate-400">{t(language, "lectureCount")}: {numberText(subject.lectureCount, language)}</span>
                              {canViewLectureAggregates ? (
                                <button type="button" aria-pressed={selected} aria-label={`${t(language, "viewLectures")}: ${label}`}
                                  onClick={() => setSelectedSubjectId(subject.subjectId)}
                                  className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-[#32695f] hover:bg-[#e4efea] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#287a6d] dark:text-[#a9d7ca] dark:hover:bg-[#203a34] dark:focus-visible:ring-[#9bd2c4]">
                                  {t(language, "viewLectures")}<ChevronRight className={`h-3.5 w-3.5 ${rtl ? "rotate-180" : ""}`} aria-hidden="true" />
                                </button>
                              ) : (
                                <span className="text-xs text-slate-500 dark:text-slate-400">{t(language, "lectureDetailUnavailable")}</span>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                    <div className="hidden md:block">
                    <DataTable label={t(language, "subjects")}>
                      <thead className="bg-[#f0f4f2] text-xs font-semibold text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
                        <tr>
                          <th scope="col" className="px-3 py-3 text-start">{t(language, "subject")}</th>
                          <th scope="col" className="px-3 py-3 text-start">{t(language, "active")}</th>
                          <th scope="col" className="px-3 py-3 text-start">{t(language, "activeRate")}</th>
                          <th scope="col" className="px-3 py-3 text-start">{t(language, "meaningfulSessions")}</th>
                          <th scope="col" className="px-3 py-3 text-start">{t(language, "attempts")}</th>
                          <th scope="col" className="px-3 py-3 text-start">{t(language, "lectureCount")}</th>
                          <th scope="col" className="px-3 py-3 text-start">{t(language, "analyticsScope")}</th>
                          <th scope="col" className="px-3 py-3 text-start"><span className="sr-only">{t(language, "viewLectures")}</span></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-white/[0.07]">
                        {cohort.subjects.map((subject) => {
                          const label = getSubjectName(subject);
                          const selected = selectedSubjectId === subject.subjectId;
                          const canViewLectureAggregates =
                            subject.analyticsStatus !== "LOW_SAMPLE"
                            && subject.analyticsStatus !== "LOW_POPULATION";
                          return (
                            <tr key={subject.subjectId} className={selected ? "bg-[#edf5f1] dark:bg-[#1b302b]" : ""}>
                              <th scope="row" className="px-3 py-3 text-start font-semibold text-slate-800 dark:text-slate-100">{label}</th>
                              <td className="px-3 py-3 text-slate-600 dark:text-slate-300" dir="auto">{disclosureText(subject.activeStudyUsers, language, (value) => numberText(value, language))}</td>
                              <td className="px-3 py-3 text-slate-600 dark:text-slate-300" dir="auto">{disclosureText(subject.activeStudyRate, language, (value) => rateText(value, language))}</td>
                              <td className="px-3 py-3 text-slate-600 dark:text-slate-300" dir="auto">{disclosureText(subject.activityWindowMetrics.focus, language, (value) => numberText(value.meaningfulSessionCount, language))}</td>
                              <td className="px-3 py-3 text-slate-600 dark:text-slate-300" dir="auto">{disclosureText(subject.activityWindowMetrics.mcq, language, (value) => numberText(value.objectiveAttempts, language))}</td>
                              <td className="px-3 py-3 text-slate-600 dark:text-slate-300" dir="auto">{numberText(subject.lectureCount, language)}</td>
                              <td className="px-3 py-3"><span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-white/[0.07] dark:text-slate-300">{statusText(subject.analyticsStatus, language)}</span></td>
                              <td className="px-3 py-3 text-end">
                                {canViewLectureAggregates ? (
                                  <button type="button" aria-pressed={selected} aria-label={`${t(language, "viewLectures")}: ${label}`}
                                    onClick={() => setSelectedSubjectId(subject.subjectId)}
                                    className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-[#32695f] hover:bg-[#e4efea] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#287a6d] dark:text-[#a9d7ca] dark:hover:bg-[#203a34] dark:focus-visible:ring-[#9bd2c4]">
                                    {t(language, "viewLectures")}<ChevronRight className={`h-3.5 w-3.5 ${rtl ? "rotate-180" : ""}`} aria-hidden="true" />
                                  </button>
                                ) : (
                                  <span className="text-xs text-slate-500 dark:text-slate-400">{t(language, "lectureDetailUnavailable")}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </DataTable>
                    </div>
                    <p className="mt-3 rounded-xl bg-[#f1f4f2] px-3.5 py-3 text-xs leading-5 text-slate-600 dark:bg-white/[0.035] dark:text-slate-300">
                      <span className="font-semibold">{t(language, "globalEligibleCohort")}: {numberText(cohort.eligibleStudents, language)}.</span>{" "}
                      {t(language, "globalEligibilityNote")}
                    </p>
                    {selectedSubjectId && selectedSubjectAggregate && (
                      <div className="mt-4 rounded-xl border border-[#d5e3de] bg-[#f2f7f4] p-3.5 dark:border-[#2c4941] dark:bg-[#182824]">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#dce7e2] pb-3 dark:border-[#2b433d]">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#648078] dark:text-[#a1c4b9]">{t(language, "selectedSubject")}</p>
                            <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{selectedSubjectLabel}</h3>
                          </div>
                          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t(language, "lectureAggregates")}</h3>
                        </div>
                        <div className="mt-3 space-y-2.5" aria-live="polite" aria-busy={lectureLoading}>
                          {lectureLoading && lectureItems.length === 0 ? (
                            <div aria-busy="true" className="space-y-2"><div className="h-16 animate-pulse rounded-lg bg-slate-200/70 motion-reduce:animate-none dark:bg-white/[0.05]" /><div className="h-16 animate-pulse rounded-lg bg-slate-200/70 motion-reduce:animate-none dark:bg-white/[0.05]" /></div>
                          ) : lectureError ? (
                            <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-[#e3c7a2] bg-[#fff8ec] p-3 text-xs text-[#684e2c] dark:border-[#685035] dark:bg-[#2b2115] dark:text-[#f0d4a9]">
                              <span>
                                {lectureError.status === 503 && windowPreset === "CURRENT_SEMESTER"
                                  ? t(language, "semesterUnavailable")
                                  : `${t(language, "requestFailed")}${lectureError.status ? ` (${numberText(lectureError.status, language)})` : ""}`}
                              </span>
                              <button type="button" onClick={() => void loadLecturePage()} className="min-h-9 rounded-lg border border-current/25 px-3 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9a6b2f]">{t(language, "retry")}</button>
                            </div>
                          ) : lectureItems.length === 0 ? (
                            <p className="rounded-lg border border-dashed border-[#cadbd4] p-4 text-center text-xs text-slate-500 dark:border-[#35534b] dark:text-slate-400">{t(language, "noLectures")}</p>
                          ) : lectureItems.map((lecture) => <div key={lecture.lectureId}>{renderLectureScope(lecture)}</div>)}
                          {lecturePage?.pageInfo.nextCursor && (
                            <button type="button" disabled={lectureLoading}
                              onClick={() => void loadLecturePage(lecturePage.pageInfo.nextCursor ?? undefined, true)}
                              className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#c9d9d4] bg-[#fbfdfc] px-3 text-xs font-semibold text-[#345e56] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#287a6d] disabled:opacity-50 dark:border-[#35544d] dark:bg-[#1b2c29] dark:text-[#c8e4dc] dark:hover:bg-[#233b36] dark:focus-visible:ring-[#90d0bd]">
                              {lectureLoading ? t(language, "loading") : t(language, "loadMore")}
                              <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </Panel>

              <Panel id="owner-analytics-mastery" title={t(language, "mastery")} description={t(language, "masteryDistribution")} icon={<Check className="h-4 w-4" />}>
                <DisclosureRow label={t(language, "trackedPairs")} item={cohort.currentStateMetrics} language={language}
                  format={(value) => numberText(value.mastery.trackedUserLecturePairs, language)} />
                {renderStateDistribution("baseMastery", cohort.currentStateMetrics, (value) =>
                  ([
                    ["notStarted", value.mastery.baseDistribution.NOT_STARTED],
                    ["started", value.mastery.baseDistribution.STARTED],
                    ["learning", value.mastery.baseDistribution.LEARNING],
                    ["needsReview", value.mastery.baseDistribution.NEEDS_REVIEW],
                    ["good", value.mastery.baseDistribution.GOOD],
                    ["mastered", value.mastery.baseDistribution.MASTERED],
                  ]))}
                {cohort.currentStateMetrics.status === "VISIBLE" && cohort.currentStateMetrics.value && renderStateDistribution("effectiveMastery", cohort.currentStateMetrics, (value) =>
                  ([
                    ["notStarted", value.mastery.freshEffectiveDistribution.NOT_STARTED],
                    ["started", value.mastery.freshEffectiveDistribution.STARTED],
                    ["learning", value.mastery.freshEffectiveDistribution.LEARNING],
                    ["needsReview", value.mastery.freshEffectiveDistribution.NEEDS_REVIEW],
                    ["good", value.mastery.freshEffectiveDistribution.GOOD],
                    ["mastered", value.mastery.freshEffectiveDistribution.MASTERED],
                  ]))}
                {renderStateDistribution("freshness", cohort.currentStateMetrics, (value) => ([
                  ["fresh", value.retention.freshnessDistribution.freshRows],
                  ["stale", value.retention.freshnessDistribution.staleRows],
                  ["missing", value.retention.freshnessDistribution.missingRows],
                ]))}
                {renderStateDistribution("reviewDistribution", cohort.currentStateMetrics, (value) => ([
                  ["insufficient", value.retention.reviewDistribution.INSUFFICIENT_EVIDENCE],
                  ["fresh", value.retention.reviewDistribution.FRESH],
                  ["dueSoon", value.retention.reviewDistribution.DUE_SOON],
                  ["due", value.retention.reviewDistribution.DUE],
                  ["overdue", value.retention.reviewDistribution.OVERDUE],
                ]))}
                {renderStateDistribution("forgettingEvidence", cohort.currentStateMetrics, (value) => ([
                  ["objective", value.retention.forgettingEvidenceDistribution.OBJECTIVE],
                  ["selfReported", value.retention.forgettingEvidenceDistribution.SELF_REPORTED],
                  ["mixed", value.retention.forgettingEvidenceDistribution.MIXED],
                  ["none", value.retention.forgettingEvidenceDistribution.NONE],
                ]))}
              </Panel>

              <Panel id="owner-analytics-operations" title={t(language, "operations")} description={t(language, "productAvailability")} icon={<Database className="h-4 w-4" />}>
                <p className="mb-3 text-xs leading-5 text-slate-500 dark:text-slate-400">{t(language, "sourceStatus")}: {statusText(cohort.analyticsStatus, language)}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200/70 bg-white/60 p-3 dark:border-white/[0.07] dark:bg-white/[0.025]">
                    <p className="text-xs text-slate-500 dark:text-slate-400">{t(language, "analyticsVersion")}</p>
                    <p className="mt-1 break-all font-mono text-xs font-semibold text-slate-700 dark:text-slate-200" dir="ltr">{cohort.analyticsVersion}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200/70 bg-white/60 p-3 dark:border-white/[0.07] dark:bg-white/[0.025]">
                    <p className="text-xs text-slate-500 dark:text-slate-400">{t(language, "policyVersion")}</p>
                    <p className="mt-1 break-all font-mono text-xs font-semibold text-slate-700 dark:text-slate-200" dir="ltr">{cohort.privacy.policyVersion}</p>
                  </div>
                </div>
              </Panel>

              <Panel id="owner-analytics-quality" title={t(language, "quality")} description={t(language, "metricAvailability")} icon={<CircleHelp className="h-4 w-4" />} className="xl:col-span-2">
                <div className="grid gap-2 sm:hidden">
                  {statusRows.map(([label, status], index) => (
                    <div key={`${label}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200/70 bg-white/60 px-3 py-2.5 dark:border-white/[0.07] dark:bg-white/[0.025]">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{t(language, label)}</span>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-white/[0.07] dark:text-slate-300">{statusText(status, language)}</span>
                    </div>
                  ))}
                </div>
                <div className="hidden sm:block">
                <DataTable label={t(language, "metricAvailability")}>
                  <thead className="bg-[#f0f4f2] text-xs font-semibold text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
                    <tr>
                      <th scope="col" className="px-3 py-3 text-start">{t(language, "metric")}</th>
                      <th scope="col" className="px-3 py-3 text-start">{t(language, "status")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/[0.07]">
                    {statusRows.map(([label, status], index) => (
                      <tr key={`${label}-${index}`}>
                        <th scope="row" className="px-3 py-2.5 text-start font-medium text-slate-700 dark:text-slate-200">{t(language, label)}</th>
                        <td className="px-3 py-2.5"><span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-white/[0.07] dark:text-slate-300">{statusText(status, language)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
                </div>
              </Panel>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}