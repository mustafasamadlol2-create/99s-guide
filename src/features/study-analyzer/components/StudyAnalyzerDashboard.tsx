import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  Check,
  Clock3,
  Flame,
  Layers3,
  LoaderCircle,
  MessageCircleQuestion,
  RefreshCw,
  RotateCcw,
  Target,
  Timer,
} from "lucide-react";
import type { Lecture, Subject } from "../../../core/types";
import type { Language } from "../../../core/i18n/translations";
import type {
  StudyAnalyzerDto,
  StudyAnalyzerWindowName,
  StudyPositiveSignal,
  StudyWeaknessSignal,
} from "../../../../server/features/study-analyzer/types";
import type { StudyInsightResponse } from "../../../../server/features/study-insights/types";
import { STUDY_INSIGHTS_FRONTEND_ENABLED } from "../../../config/featureFlags";
import { getStudyAnalyzer, getStudyInsight } from "../api";
import {
  ANALYZER_WINDOW_LABELS,
  durationBucketLabel,
  formatBaghdadDate,
  formatDuration,
  formatNumber,
  formatRateBps,
  localized,
  masteryStateLabel,
  positiveLabel,
  severityLabel,
  timeBucketLabel,
  trendLabel,
  weaknessLabel,
} from "../format";
import { AiInsightCard } from "./AiInsightCard";
import { AskMyStudyDataPanel } from "./AskMyStudyDataPanel";
import {
  copy,
  DataQualityNote,
  getSignalEvidence,
  MetricCard,
  MiniBarChart,
  Panel,
  sourceQualityMessage,
  StatRow,
  TrendBadge,
  valueOrUnknown,
} from "./StudyAnalyzerUi";

const WINDOW_STORAGE_KEY = "study-analyzer-window";
const WINDOW_NAMES: StudyAnalyzerWindowName[] = ["last7Days", "last30Days", "currentSemester"];
const MASTERY_ORDER = ["NOT_STARTED", "STARTED", "LEARNING", "NEEDS_REVIEW", "GOOD", "MASTERED"];

interface StudyAnalyzerDashboardProps {
  language: Language;
  subjects: Subject[];
  dbLectures?: unknown[];
  onBack: () => void;
  onOpenMastery: () => void;
  onSelectLecture: (lecture: Lecture, tab?: "mcqs" | "flashcards") => void;
}

function safeStoredWindow(): StudyAnalyzerWindowName {
  try {
    const stored = window.localStorage.getItem(WINDOW_STORAGE_KEY);
    return stored && WINDOW_NAMES.includes(stored as StudyAnalyzerWindowName)
      ? stored as StudyAnalyzerWindowName
      : "last30Days";
  } catch {
    return "last30Days";
  }
}

export function StudyAnalyzerDashboard({
  language,
  subjects,
  dbLectures = [],
  onBack,
  onOpenMastery,
  onSelectLecture,
}: StudyAnalyzerDashboardProps) {
  const rtl = language === "ar";
  const [windowName, setWindowName] = useState<StudyAnalyzerWindowName>(safeStoredWindow);
  const [dto, setDto] = useState<StudyAnalyzerDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [analyzerFailed, setAnalyzerFailed] = useState(false);
  const [showAskPanel, setShowAskPanel] = useState(false);
  const [insight, setInsight] = useState<StudyInsightResponse | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightFailed, setInsightFailed] = useState(false);
  const analyzerSequence = useRef(0);
  const insightSequence = useRef(0);
  const BackIcon = rtl ? ArrowRight : ArrowLeft;

  const loadAnalyzer = useCallback(async (manual = false) => {
    const sequence = ++analyzerSequence.current;
    manual ? setRefreshing(true) : setLoading(true);
    try {
      const result = await getStudyAnalyzer();
      if (sequence === analyzerSequence.current) {
        setDto(result);
        setAnalyzerFailed(false);
      }
    } catch {
      if (sequence === analyzerSequence.current) setAnalyzerFailed(true);
    } finally {
      if (sequence === analyzerSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void loadAnalyzer();
    });
    return () => {
      active = false;
      analyzerSequence.current += 1;
    };
  }, [loadAnalyzer]);

  const loadInsight = useCallback(async () => {
    const sequence = ++insightSequence.current;
    setInsightLoading(true);
    try {
      const result = await getStudyInsight(language);
      if (sequence === insightSequence.current) {
        setInsight(result);
        setInsightFailed(false);
      }
    } catch {
      if (sequence === insightSequence.current) setInsightFailed(true);
    } finally {
      if (sequence === insightSequence.current) setInsightLoading(false);
    }
  }, [language]);

  useEffect(() => {
    if (!STUDY_INSIGHTS_FRONTEND_ENABLED) return undefined;
    let active = true;
    Promise.resolve().then(() => {
      if (active) void loadInsight();
    });
    return () => {
      active = false;
      insightSequence.current += 1;
    };
  }, [loadInsight]);

  useEffect(() => {
    try {
      window.localStorage.setItem(WINDOW_STORAGE_KEY, windowName);
    } catch {
      // The selected window remains available for this view if storage is blocked.
    }
    setShowAskPanel(false);
  }, [windowName]);

  const currentWindow = dto?.windows[windowName];
  const windowAvailable = currentWindow?.status !== "UNAVAILABLE";
  const activeDays = dto && windowAvailable ? dto.activity.activeStudyDays[windowName] : null;
  const verifiedFocusSeconds = dto && windowAvailable ? dto.focus.verifiedFocusSeconds[windowName] : null;
  const normalMcq = dto && windowAvailable ? dto.objectivePractice.normalMcq[windowName] : null;
  const dueReviews = dto?.retention.due ?? null;
  const accuracyDetail = normalMcq?.attempts !== null && normalMcq?.attempts !== undefined &&
    normalMcq?.correct !== null && normalMcq?.correct !== undefined
    ? `${formatNumber(normalMcq.correct, language)} / ${formatNumber(normalMcq.attempts, language)}`
    : copy(language, "Not enough data yet", "لا توجد بيانات كافية بعد");

  const getSubjectName = useCallback((subjectId: string | null | undefined) => {
    if (!subjectId) return copy(language, "Study subject", "مادة دراسية");
    const match = (subjects as unknown as Array<{ id?: unknown; name?: unknown }>).find(
      (subject) => String(subject.id) === subjectId,
    );
    return typeof match?.name === "string" && match.name.trim()
      ? match.name
      : copy(language, "Study subject", "مادة دراسية");
  }, [language, subjects]);

  const getLecture = useCallback((lectureId: string): { lecture: Lecture | null; label: string } => {
    const raw = dbLectures.find((item) => {
      const candidate = item as { id?: unknown } | null;
      return candidate && String(candidate.id) === lectureId;
    });
    if (!raw) return { lecture: null, label: copy(language, "Lecture", "محاضرة") };
    const record = raw as { title?: unknown; name?: unknown };
    const label = typeof record.title === "string"
      ? record.title
      : typeof record.name === "string"
        ? record.name
        : copy(language, "Lecture", "محاضرة");
    return { lecture: raw as Lecture, label };
  }, [dbLectures, language]);

  const windowRange = useMemo(() => {
    if (!currentWindow || currentWindow.status === "UNAVAILABLE") return null;
    const start = formatBaghdadDate(currentWindow.from, language);
    const end = formatBaghdadDate(currentWindow.to, language);
    return currentWindow.from
      ? `${start} – ${end}`
      : copy(language, "Current semester", "الفصل الدراسي الحالي");
  }, [currentWindow, language]);

  const sourceHint = (source: keyof StudyAnalyzerDto["dataQuality"]["sources"]) => {
    if (!dto) return null;
    return sourceQualityMessage(dto.dataQuality.sources[source], language);
  };

  const chooseWindow = (next: StudyAnalyzerWindowName) => {
    if (dto?.windows[next].status === "UNAVAILABLE") return;
    setWindowName(next);
  };

  function renderSignal(signal: StudyWeaknessSignal | StudyPositiveSignal, positive: boolean, index: number) {
    const evidenceValue = getSignalEvidence(signal, language);
    const severity = "severity" in signal ? signal.severity : null;
    let scopeLabel = copy(language, "Across your study data", "ضمن بيانات دراستك");
    if (signal.scope === "SUBJECT" && "subjectId" in signal) {
      scopeLabel = getSubjectName(signal.subjectId);
    } else if (signal.scope === "LECTURE" && "lectureId" in signal && signal.lectureId) {
      scopeLabel = getLecture(signal.lectureId).label;
    } else if (signal.scope === "ITEM") {
      scopeLabel = copy(language, "Practice item", "عنصر تدريبي");
    }
    return (
      <li
        key={`${signal.id}-${signal.scope}-${index}`}
        className={`min-w-0 rounded-2xl border p-3 ${positive
          ? "border-emerald-200/80 bg-emerald-50/70 dark:border-emerald-200/10 dark:bg-emerald-300/[0.06]"
          : "border-amber-200/80 bg-amber-50/70 dark:border-amber-200/10 dark:bg-amber-300/[0.06]"}`}
      >
        <div className="flex min-w-0 items-start justify-between gap-2">
          <p className="min-w-0 break-words text-sm font-semibold leading-6 text-slate-900 dark:text-white">
            {positive
              ? positiveLabel(signal as StudyPositiveSignal, language)
              : weaknessLabel(signal as StudyWeaknessSignal, language)}
          </p>
          {severity && (
            <span className="shrink-0 rounded-full bg-white/80 px-2 py-1 text-[10px] font-semibold text-slate-600 dark:bg-slate-950/60 dark:text-slate-300">
              {severityLabel(severity, language)}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
          <span className="break-words">{scopeLabel}</span>
          {evidenceValue && <span className="font-semibold" dir="auto">{evidenceValue}</span>}
        </div>
      </li>
    );
  }

  const windowUnavailable = Boolean(dto && currentWindow?.status === "UNAVAILABLE");
  const incompleteSelectedWindow = dto?.dataQuality.incompleteWindows.includes(windowName) ?? false;

  return (
    <main dir={rtl ? "rtl" : "ltr"} className="mx-auto w-full max-w-[1440px] px-4 pb-10 pt-5 sm:px-6 sm:pt-7">
      <header className="mb-5 rounded-[28px] border border-violet-200/80 bg-gradient-to-br from-violet-50 via-white to-sky-50 p-4 shadow-sm dark:border-violet-300/15 dark:from-violet-300/[0.08] dark:via-slate-950/80 dark:to-sky-300/[0.05] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <button
              type="button"
              onClick={onBack}
              aria-label={copy(language, "Back to home", "العودة إلى الرئيسية")}
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white/90 text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-700 dark:border-white/10 dark:bg-slate-950/70 dark:text-slate-100 dark:hover:bg-white/[0.06]"
            >
              <BackIcon className="h-5 w-5" aria-hidden="true" />
            </button>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-700 dark:text-violet-200">
                {copy(language, "Private study dashboard", "لوحة دراسة خاصة")}
              </p>
              <h1 className="mt-1 break-words text-2xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-3xl">
                {copy(language, "Study Analyzer", "تحليل الدراسة")}
              </h1>
              <p className="mt-2 max-w-2xl break-words text-sm leading-6 text-slate-600 dark:text-slate-300">
                {copy(language, "Data determines the facts. AI can only explain those facts.", "البيانات تحدد الحقائق، والذكاء الاصطناعي يشرحها فقط.")}
              </p>
              {dto && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {copy(language, "Updated", "آخر تحديث")}{" "}
                  <bdi dir="auto">{formatBaghdadDate(dto.asOf, language, true)}</bdi>
                  {" · "}
                  {copy(language, "Baghdad time", "بتوقيت بغداد")}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadAnalyzer(true)}
            disabled={loading || refreshing}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-violet-200 bg-white/90 px-3 py-2 text-sm font-semibold text-violet-950 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-700 disabled:cursor-wait disabled:opacity-60 dark:border-violet-200/15 dark:bg-slate-950/65 dark:text-violet-100 dark:hover:bg-violet-300/10"
          >
            {refreshing || loading
              ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            {refreshing || loading
              ? copy(language, "Refreshing…", "جارٍ التحديث…")
              : copy(language, "Refresh facts", "تحديث الحقائق")}
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2" role="group" aria-label={copy(language, "Study period", "الفترة الدراسية")}>
          {WINDOW_NAMES.map((name) => {
            const unavailable = dto?.windows[name].status === "UNAVAILABLE";
            return (
              <button
                key={name}
                type="button"
                aria-pressed={windowName === name}
                disabled={Boolean(unavailable)}
                onClick={() => chooseWindow(name)}
                className={`min-h-11 rounded-full border px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-700 disabled:cursor-not-allowed disabled:opacity-50 ${
                  windowName === name
                    ? "border-violet-700 bg-violet-700 text-white dark:border-violet-300 dark:bg-violet-300 dark:text-slate-950"
                    : "border-slate-200 bg-white/80 text-slate-700 hover:border-violet-300 hover:bg-white dark:border-white/10 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:border-violet-200/40"
                }`}
              >
                {localized(ANALYZER_WINDOW_LABELS[name], language)}
                {unavailable && <span className="sr-only"> · {copy(language, "not available", "غير متاحة")}</span>}
              </button>
            );
          })}
          {windowRange && (
            <span className="ms-1 text-xs text-slate-500 dark:text-slate-400" dir="auto">{windowRange}</span>
          )}
        </div>
      </header>

      {analyzerFailed && (
        <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-300/15 dark:bg-rose-300/[0.07] dark:text-rose-100">
          <span>{copy(language, "Study facts could not be loaded. Try again.", "تعذّر تحميل حقائق الدراسة. حاول مرة أخرى.")}</span>
          {!dto && (
            <button type="button" onClick={() => void loadAnalyzer()} className="min-h-11 rounded-xl px-3 font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-700">
              {copy(language, "Retry", "إعادة المحاولة")}
            </button>
          )}
        </div>
      )}
      {incompleteSelectedWindow && (
        <DataQualityNote>
          {copy(language, "Some source data is incomplete for this period. Available facts are shown without filling missing values.", "بعض مصادر البيانات غير مكتملة لهذه الفترة. تُعرض الحقائق المتاحة دون تعويض القيم المفقودة.")}
        </DataQualityNote>
      )}
      {windowUnavailable && (
        <DataQualityNote>
          {copy(language, "This period is not configured in your study data. Other available sections are not presented as semester totals.", "هذه الفترة غير مهيأة في بيانات دراستك. لن تُعرض أقسام الفترات الأخرى على أنها إجماليات للفصل الدراسي.")}
        </DataQualityNote>
      )}

      {loading && !dto ? (
        <div role="status" className="flex min-h-52 items-center justify-center gap-3 rounded-3xl border border-slate-200 bg-white/80 text-sm text-slate-600 dark:border-white/10 dark:bg-slate-950/60 dark:text-slate-300">
          <LoaderCircle className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {copy(language, "Loading your private study facts…", "جارٍ تحميل حقائق دراستك الخاصة…")}
        </div>
      ) : !dto ? (
        <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 text-center dark:border-white/10 dark:bg-slate-950/65">
          <p className="text-sm text-slate-600 dark:text-slate-300">{copy(language, "Your dashboard will appear when study facts are available.", "ستظهر لوحة المعلومات عند توفر حقائق الدراسة.")}</p>
        </div>
      ) : (
        <>
          <section aria-labelledby="analyzer-overview-title">
            <h2 id="analyzer-overview-title" className="sr-only">{copy(language, "Overview", "نظرة عامة")}</h2>
            <div className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-4">
              <MetricCard
                label={copy(language, "Active study days", "أيام الدراسة النشطة")}
                value={valueOrUnknown(activeDays, language, "—")}
                detail={windowName === "last30Days"
                  ? copy(language, "In the selected 30-day period", "ضمن فترة الثلاثين يومًا المحددة")
                  : windowName === "last7Days"
                    ? copy(language, "In the selected 7-day period", "ضمن فترة الأيام السبعة المحددة")
                    : copy(language, "In the current semester", "ضمن الفصل الدراسي الحالي")}
                icon={<Activity className="h-4 w-4" aria-hidden="true" />}
                tone="violet"
              />
              <MetricCard
                label={copy(language, "Verified Focus time", "وقت التركيز المُتحقَّق منه")}
                value={windowAvailable ? formatDuration(verifiedFocusSeconds, language) : "—"}
                detail={copy(language, "From recorded Focus sessions", "من جلسات التركيز المسجّلة")}
                icon={<Timer className="h-4 w-4" aria-hidden="true" />}
                tone="blue"
              />
              <MetricCard
                label={copy(language, "Objective MCQ practice", "تدريب أسئلة الاختيار من متعدد")}
                value={windowAvailable ? valueOrUnknown(normalMcq?.attempts, language, "—") : "—"}
                detail={normalMcq?.accuracyRateBps === null || normalMcq?.accuracyRateBps === undefined
                  ? copy(language, "Accuracy not available yet", "الدقة غير متاحة بعد")
                  : `${formatRateBps(normalMcq.accuracyRateBps, language)} · ${accuracyDetail}`}
                icon={<Target className="h-4 w-4" aria-hidden="true" />}
                tone="teal"
              />
              <MetricCard
                label={copy(language, "Due reviews", "مراجعات مستحقة")}
                value={valueOrUnknown(dueReviews, language, "—")}
                detail={copy(language, "Current Retention summary", "ملخص الاستبقاء الحالي")}
                icon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
                tone="amber"
              />
            </div>
          </section>

          <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)] xl:mt-5 xl:gap-5">
            <div className="grid min-w-0 content-start gap-4 xl:gap-5">
              <Panel
                title={copy(language, "Activity and Focus", "النشاط والتركيز")}
                subtitle={copy(language, "Focus time is verified session time, not total time spent studying.", "وقت التركيز هو وقت الجلسات المُتحقَّق منه، وليس إجمالي وقت الدراسة.")}
                icon={<Clock3 className="h-4 w-4" aria-hidden="true" />}
              >
                <div className="grid grid-cols-2 gap-x-4">
                  <StatRow
                    label={copy(language, "Meaningful completed sessions", "جلسات مكتملة ذات معنى")}
                    value={windowAvailable ? valueOrUnknown(dto.focus.meaningfulCompletedSessions[windowName], language, "—") : "—"}
                  />
                  <StatRow
                    label={copy(language, "Average meaningful session", "متوسط مدة الجلسة ذات المعنى")}
                    value={windowAvailable ? formatDuration(dto.focus.averageMeaningfulSessionSeconds[windowName], language) : "—"}
                  />
                  <StatRow
                    label={copy(language, "Completed sessions", "جلسات مكتملة")}
                    value={windowAvailable ? valueOrUnknown(dto.focus.completion[windowName].completedSessions, language, "—") : "—"}
                  />
                  <StatRow
                    label={copy(language, "Completion rate", "معدل الإكمال")}
                    value={windowAvailable ? formatRateBps(dto.focus.completion[windowName].completionRateBps, language) : "—"}
                  />
                  <StatRow
                    label={copy(language, "Uncompleted sessions", "جلسات غير مكتملة")}
                    value={windowAvailable ? valueOrUnknown(dto.focus.uncompletedSessionCount[windowName], language, "—") : "—"}
                  />
                </div>
                {sourceHint("focus") && <DataQualityNote>{sourceHint("focus")}</DataQualityNote>}
                {!sourceHint("focus") && sourceHint("groupFocus") && <DataQualityNote>{sourceHint("groupFocus")}</DataQualityNote>}
                <DataQualityNote>
                  {copy(language, "Opening a PDF or video by itself is not counted as study time or learning progress.", "فتح ملف PDF أو مقطع فيديو وحده لا يُحتسب وقتًا للدراسة أو تقدمًا في التعلّم.")}
                </DataQualityNote>
                {dto.focus.durationDistributionLast30Days.length > 0 && (
                  <MiniBarChart
                    title={copy(language, "Session duration distribution · last 30 days", "توزيع مدد الجلسات · آخر ٣٠ يومًا")}
                    language={language}
                    items={dto.focus.durationDistributionLast30Days.map((bucket) => ({
                      label: durationBucketLabel(bucket.bucket, language),
                      value: bucket.meaningfulSessions,
                    }))}
                  />
                )}
              </Panel>

              <Panel
                title={copy(language, "Objective practice", "التدريب الموضوعي")}
                subtitle={copy(language, "MCQ results are separate from Flashcard self-assessments.", "نتائج أسئلة الاختيار من متعدد منفصلة عن التقييم الذاتي للبطاقات التعليمية.")}
                icon={<Target className="h-4 w-4" aria-hidden="true" />}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3 dark:bg-white/[0.04]">
                  <div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{copy(language, "Objective MCQ trend", "اتجاه نتائج أسئلة الاختيار من متعدد")}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {trendLabel(dto.objectivePractice.trend.state, language)}
                    </p>
                  </div>
                  <TrendBadge state={dto.objectivePractice.trend.state} language={language} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-4">
                  <StatRow label={copy(language, "Attempts", "المحاولات")} value={windowAvailable ? valueOrUnknown(normalMcq?.attempts, language, "—") : "—"} />
                  <StatRow label={copy(language, "Correct", "إجابات صحيحة")} value={windowAvailable ? valueOrUnknown(normalMcq?.correct, language, "—") : "—"} />
                  <StatRow label={copy(language, "Incorrect", "إجابات غير صحيحة")} value={windowAvailable ? valueOrUnknown(normalMcq?.incorrect, language, "—") : "—"} />
                  <StatRow label={copy(language, "Objective accuracy", "الدقة الموضوعية")} value={windowAvailable ? formatRateBps(normalMcq?.accuracyRateBps, language) : "—"} />
                </div>
                <MiniBarChart
                  title={copy(language, "Correct and incorrect outcomes in this period", "الإجابات الصحيحة وغير الصحيحة في هذه الفترة")}
                  language={language}
                  items={windowAvailable && normalMcq ? [
                    { label: copy(language, "Correct", "صحيحة"), value: normalMcq.correct },
                    { label: copy(language, "Incorrect", "غير صحيحة"), value: normalMcq.incorrect },
                  ] : []}
                />
                {sourceHint("mcq") && <DataQualityNote>{sourceHint("mcq")}</DataQualityNote>}
                {dto.objectivePractice.repeatedErrors.length > 0 && (
                  <div className="mt-4 border-t border-slate-100 pt-4 dark:border-white/[0.07]">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      {copy(language, "Repeated incorrect outcomes", "إجابات غير صحيحة متكررة")}
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                      {copy(language, "A bounded list of recent practice signals. Full question text is not shown.", "قائمة محدودة من إشارات التدريب الحديثة. لا يُعرض نص السؤال كاملًا.")}
                    </p>
                    <ul className="mt-2 space-y-2">
                      {dto.objectivePractice.repeatedErrors.map((item, index) => {
                        const { lecture, label } = getLecture(item.lectureId);
                        return (
                          <li key={`${item.lectureId}-${index}`} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-100 px-3 py-2.5 dark:border-white/[0.07]">
                            <div className="min-w-0">
                              <p className="break-words text-sm font-medium text-slate-800 dark:text-slate-100">{label}</p>
                              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                {copy(language, "Recent incorrect outcomes", "إجابات غير صحيحة مؤخرًا")}:{" "}
                                {formatNumber(item.recentIncorrectCount, language)}
                              </p>
                            </div>
                            {lecture && (
                              <button
                                type="button"
                                onClick={() => onSelectLecture(lecture, "mcqs")}
                                className="min-h-11 rounded-xl px-3 py-2 text-xs font-semibold text-violet-800 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-700 dark:text-violet-200 dark:hover:bg-violet-300/10"
                              >
                                {copy(language, "Practice MCQs", "تدرّب على الأسئلة")}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </Panel>

              <Panel
                title={copy(language, "Flashcards and Recall", "البطاقات التعليمية والاسترجاع")}
                subtitle={copy(language, "Remembered and needs-review counts are self-reported, not objective correctness.", "أعداد ما تم تذكّره وما يحتاج إلى مراجعة هي تقييم ذاتي وليست قياسًا موضوعيًا للصواب.")}
                icon={<Layers3 className="h-4 w-4" aria-hidden="true" />}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{copy(language, "Self-reviewed cards", "البطاقات التي قيّمتها ذاتيًا")}</h3>
                    <StatRow label={copy(language, "Meaningful reviews", "مراجعات ذات معنى")} value={windowAvailable ? valueOrUnknown(dto.flashcards.reviews[windowName].meaningfulReviews, language, "—") : "—"} />
                    <StatRow label={copy(language, "Remembered", "تم تذكّرها")} value={windowAvailable ? valueOrUnknown(dto.flashcards.reviews[windowName].selfReportedRemembered, language, "—") : "—"} />
                    <StatRow label={copy(language, "Needs review", "تحتاج إلى مراجعة")} value={windowAvailable ? valueOrUnknown(dto.flashcards.reviews[windowName].selfReportedNotRemembered, language, "—") : "—"} />
                    <StatRow label={copy(language, "Neutral", "محايد")} value={windowAvailable ? valueOrUnknown(dto.flashcards.reviews[windowName].selfReportedNeutral, language, "—") : "—"} />
                    {sourceHint("flashcards") && <DataQualityNote>{sourceHint("flashcards")}</DataQualityNote>}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{copy(language, "Recall activity", "نشاط الاسترجاع")}</h3>
                    <StatRow label={copy(language, "Presented", "عُرضت")} value={windowAvailable ? valueOrUnknown(dto.recall.periodicActivity[windowName].presented, language, "—") : "—"} />
                    <StatRow label={copy(language, "Answered", "تمت الإجابة")} value={windowAvailable ? valueOrUnknown(dto.recall.periodicActivity[windowName].answered, language, "—") : "—"} />
                    <StatRow label={copy(language, "Skipped", "تم تخطيها")} value={windowAvailable ? valueOrUnknown(dto.recall.periodicActivity[windowName].skipped, language, "—") : "—"} detail={copy(language, "A skip is not counted as incorrect.", "التخطي لا يُحسب إجابة غير صحيحة.")} />
                    <StatRow label={copy(language, "Expired", "انتهت")} value={windowAvailable ? valueOrUnknown(dto.recall.periodicActivity[windowName].expired, language, "—") : "—"} detail={copy(language, "Expiry is not a knowledge failure.", "انتهاء الوقت لا يعني ضعف المعرفة.")} />
                    <div className="mt-3 border-t border-slate-100 pt-3 dark:border-white/[0.07]">
                      <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-300">{copy(language, "Answered outcomes", "نتائج الإجابات")}</h4>
                      <StatRow label={copy(language, "Objective correct", "إجابات موضوعية صحيحة")} value={windowAvailable ? valueOrUnknown(dto.recall.answeredOutcomes[windowName].objectiveCorrect, language, "—") : "—"} />
                      <StatRow label={copy(language, "Objective incorrect", "إجابات موضوعية غير صحيحة")} value={windowAvailable ? valueOrUnknown(dto.recall.answeredOutcomes[windowName].objectiveIncorrect, language, "—") : "—"} />
                      <StatRow label={copy(language, "Flashcards remembered", "بطاقات تم تذكّرها")} value={windowAvailable ? valueOrUnknown(dto.recall.answeredOutcomes[windowName].flashcardRemembered, language, "—") : "—"} />
                      <StatRow label={copy(language, "Flashcards not remembered", "بطاقات لم يتم تذكّرها")} value={windowAvailable ? valueOrUnknown(dto.recall.answeredOutcomes[windowName].flashcardNotRemembered, language, "—") : "—"} />
                      <StatRow label={copy(language, "Flashcards neutral", "بطاقات محايدة")} value={windowAvailable ? valueOrUnknown(dto.recall.answeredOutcomes[windowName].flashcardNeutral, language, "—") : "—"} />
                    </div>
                    {sourceHint("recall") && <DataQualityNote>{sourceHint("recall")}</DataQualityNote>}
                  </div>
                </div>
              </Panel>

              <Panel
                title={copy(language, "Subject activity", "النشاط حسب المادة")}
                subtitle={copy(language, "Recorded subject activity for the last 30 days. Subjects are shown in the server-provided order.", "النشاط المسجّل حسب المادة خلال آخر ٣٠ يومًا، وبالترتيب الذي يحدده الخادم.")}
                icon={<BookOpen className="h-4 w-4" aria-hidden="true" />}
              >
                {dto.subjects.length === 0 ? (
                  <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">{copy(language, "Subject activity is not available yet.", "نشاط المواد غير متاح بعد.")}</p>
                ) : (
                  <ul className="space-y-2">
                    {dto.subjects.map((subject, index) => (
                      <li key={`${subject.subjectId}-${index}`} className="min-w-0 rounded-2xl border border-slate-100 p-3 dark:border-white/[0.07]">
                        <h3 className="break-words text-sm font-semibold text-slate-900 dark:text-white">{getSubjectName(subject.subjectId)}</h3>
                        <div className="mt-2 grid grid-cols-2 gap-x-4">
                          <StatRow label={copy(language, "Active days", "أيام نشطة")} value={valueOrUnknown(subject.activeStudyDaysLast30Days, language, "—")} />
                          <StatRow label={copy(language, "Verified Focus time", "وقت التركيز المُتحقَّق منه")} value={formatDuration(subject.meaningfulFocusSecondsLast30Days, language)} />
                          <StatRow label={copy(language, "Objective attempts", "محاولات موضوعية")} value={valueOrUnknown(subject.objectiveAttemptsLast30Days, language, "—")} />
                          <StatRow label={copy(language, "Objective accuracy", "الدقة الموضوعية")} value={formatRateBps(subject.objectiveAccuracyRateBpsLast30Days, language)} />
                          <StatRow label={copy(language, "Flashcard reviews", "مراجعات البطاقات")} value={valueOrUnknown(subject.flashcardReviewsLast30Days, language, "—")} />
                          <StatRow label={copy(language, "Recall answered", "إجابات الاسترجاع")} value={valueOrUnknown(subject.recallAnsweredLast30Days, language, "—")} />
                          <StatRow label={copy(language, "Due reviews", "مراجعات مستحقة")} value={valueOrUnknown(subject.dueReviewCount, language, "—")} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {dto.dataQuality.subjectFactsTruncated && (
                  <DataQualityNote>{copy(language, "Some subject facts were omitted to keep this summary bounded.", "تم استبعاد بعض حقائق المواد للحفاظ على ملخص محدود.")}</DataQualityNote>
                )}
                {sourceHint("lectureSubjects") && <DataQualityNote>{sourceHint("lectureSubjects")}</DataQualityNote>}
              </Panel>
            </div>

            <div className="grid min-w-0 content-start gap-4 xl:gap-5">
              <Panel
                title={copy(language, "Consistency", "الانتظام")}
                subtitle={copy(language, "Active study days use the Analyzer’s canonical definition.", "تُحتسب أيام الدراسة النشطة وفق تعريف المحلل المعتمد.")}
                icon={<Flame className="h-4 w-4" aria-hidden="true" />}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <StatRow label={copy(language, "Active days in this period", "الأيام النشطة في هذه الفترة")} value={windowAvailable ? valueOrUnknown(dto.consistency.activeStudyDays[windowName], language, "—") : "—"} />
                  <TrendBadge state={dto.consistency.trend.state} language={language} />
                </div>
                <StatRow label={copy(language, "Active-day rate · last 30 days", "معدل الأيام النشطة · آخر ٣٠ يومًا")} value={formatRateBps(dto.consistency.activeStudyDayRateBpsLast30Days, language)} />
                <StatRow label={copy(language, "Current consistency streak", "سلسلة الانتظام الحالية")} value={valueOrUnknown(dto.consistency.currentConsistencyStreakDays, language, "—")} />
                <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                  {copy(language, "A streak is descriptive only; missing days are not a failure.", "السلسلة وصفية فقط، والأيام غير النشطة لا تعني إخفاقًا.")}
                </p>
                <MiniBarChart
                  title={copy(language, "Active study days in completed weeks", "أيام الدراسة النشطة في الأسابيع المكتملة")}
                  language={language}
                  items={dto.consistency.completedWeeks.map((week, index) => ({
                    label: `${copy(language, "Week", "الأسبوع")} ${formatNumber(index + 1, language)}`,
                    value: week.activeDays,
                    detail: week.activeDayRateBps === null
                      ? copy(language, "Rate not available", "المعدل غير متاح")
                      : `${formatRateBps(week.activeDayRateBps, language)} ${copy(language, "of possible active days", "من أيام النشاط الممكنة")}`,
                  }))}
                />
              </Panel>

              <Panel
                title={copy(language, "Mastery and review", "الإتقان والمراجعة")}
                subtitle={copy(language, "Canonical Mastery and Retention summaries; no client-side recalculation.", "ملخصا الإتقان والاستبقاء المعتمدان، دون إعادة احتساب في الواجهة.")}
                icon={<Check className="h-4 w-4" aria-hidden="true" />}
                action={(
                  <button
                    type="button"
                    onClick={onOpenMastery}
                    className="min-h-11 shrink-0 rounded-xl px-3 py-2 text-xs font-semibold text-violet-800 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-700 dark:text-violet-200 dark:hover:bg-violet-300/10"
                  >
                    {copy(language, "View Mastery", "عرض الإتقان")}
                  </button>
                )}
              >
                <StatRow label={copy(language, "Tracked lectures", "محاضرات متتبعة")} value={valueOrUnknown(dto.mastery.trackedLectureCount, language, "—")} />
                {sourceHint("mastery") && <DataQualityNote>{sourceHint("mastery")}</DataQualityNote>}
                <div className="mt-3">
                  <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300">{copy(language, "Fresh effective distribution", "توزيع حالات الإتقان الحديثة")}</h3>
                  {dto.mastery.effectiveMasteryDistributionFreshOnly ? (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {MASTERY_ORDER.filter((state) => state in (dto.mastery.effectiveMasteryDistributionFreshOnly ?? {})).map((state) => (
                        <div key={state} className="flex min-w-0 items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-white/[0.04]">
                          <span className="min-w-0 break-words text-xs text-slate-600 dark:text-slate-300">{masteryStateLabel(state, language)}</span>
                          <span className="shrink-0 text-sm font-semibold text-slate-900 dark:text-white">{formatNumber(dto.mastery.effectiveMasteryDistributionFreshOnly?.[state], language)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{copy(language, "Not enough current data yet.", "لا توجد بيانات حديثة كافية بعد.")}</p>
                  )}
                </div>
                <div className="mt-4 border-t border-slate-100 pt-3 dark:border-white/[0.07]">
                  <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300">{copy(language, "Retention summary", "ملخص الاستبقاء")}</h3>
                  <div className="mt-1 grid grid-cols-2 gap-x-4">
                    <StatRow label={copy(language, "Due", "مستحقة")} value={valueOrUnknown(dto.retention.due, language, "—")} />
                    <StatRow label={copy(language, "Overdue", "متأخرة")} value={valueOrUnknown(dto.retention.overdue, language, "—")} />
                    <StatRow label={copy(language, "Needs review", "تحتاج إلى مراجعة")} value={valueOrUnknown(dto.retention.needsReview, language, "—")} />
                    <StatRow label={copy(language, "Stale", "قديمة")} value={valueOrUnknown(dto.retention.staleRows, language, "—")} />
                    <StatRow label={copy(language, "Missing", "مفقودة")} value={valueOrUnknown(dto.retention.missingRows, language, "—")} />
                  </div>
                  {(dto.retention.staleRows ?? 0) > 0 && (
                    <DataQualityNote>{copy(language, "Stale Retention rows are not presented as current review status.", "لا تُعرض سجلات الاستبقاء القديمة على أنها حالة مراجعة حالية.")}</DataQualityNote>
                  )}
                  {sourceHint("retention") && <DataQualityNote>{sourceHint("retention")}</DataQualityNote>}
                </div>
              </Panel>

              <Panel
                title={copy(language, "Study-time patterns", "أنماط أوقات الدراسة")}
                subtitle={copy(language, "Observed associations, not causes or prescriptions.", "ارتباطات ملحوظة وليست أسبابًا أو تعليمات.")}
                icon={<Clock3 className="h-4 w-4" aria-hidden="true" />}
              >
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{copy(language, "Most-used study time", "وقت الدراسة الأكثر استخدامًا")}</p>
                    {dto.patterns.timeOfDay.mostUsedTimeOfDay.status === "SUPPORTED_PATTERN" ? (
                      <p className="mt-1 break-words text-sm font-semibold text-slate-900 dark:text-white">
                        {timeBucketLabel(dto.patterns.timeOfDay.mostUsedTimeOfDay.bucket, language)}
                        {dto.patterns.timeOfDay.mostUsedTimeOfDay.meaningfulSessions !== undefined && (
                          <span className="ms-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                            {formatNumber(dto.patterns.timeOfDay.mostUsedTimeOfDay.meaningfulSessions, language)} {copy(language, "sessions", "جلسات")}
                          </span>
                        )}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{copy(language, "Not enough data yet", "لا توجد بيانات كافية بعد")}</p>
                    )}
                  </div>
                  <div className="border-t border-slate-100 pt-3 dark:border-white/[0.07]">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{copy(language, "Best-supported outcome time pattern", "الفترة الزمنية ذات النتائج المدعومة بأفضل قدر من البيانات")}</p>
                    {dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.status === "SUPPORTED_PATTERN" ? (
                      <>
                        <p className="mt-1 break-words text-sm font-semibold text-slate-900 dark:text-white">
                          {copy(language, "Higher objective outcomes were observed in", "لوحظت نتائج موضوعية أعلى في")}{" "}
                          {timeBucketLabel(dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.bucket, language)}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                          {formatNumber(dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.linkedSessions, language)}{" "}
                          {copy(language, "linked sessions", "جلسات مرتبطة")} ·{" "}
                          {formatRateBps(dto.patterns.timeOfDay.bestSupportedOutcomeTimeBucket.objectiveCorrectRateBps, language)}
                        </p>
                      </>
                    ) : (
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{copy(language, "Not enough data yet", "لا توجد بيانات كافية بعد")}</p>
                    )}
                  </div>
                  <div className="border-t border-slate-100 pt-3 dark:border-white/[0.07]">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{copy(language, "Supported session-length pattern", "نمط مدة الجلسات المدعوم")}</p>
                    {dto.patterns.sessionLength.status === "SUPPORTED_PATTERN" ? (
                      <>
                        <p className="mt-1 break-words text-sm font-semibold text-slate-900 dark:text-white">
                          {copy(language, "Stronger observed outcomes were associated with sessions in this range:", "ارتبطت النتائج الملحوظة الأفضل بجلسات ضمن هذه المدة:")}{" "}
                          {durationBucketLabel(dto.patterns.sessionLength.bucket, language)}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                          {formatNumber(dto.patterns.sessionLength.linkedSessions, language)}{" "}
                          {copy(language, "linked sessions", "جلسات مرتبطة")}
                        </p>
                      </>
                    ) : (
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{copy(language, "Not enough data yet", "لا توجد بيانات كافية بعد")}</p>
                    )}
                  </div>
                </div>
              </Panel>

              <Panel
                title={copy(language, "Deterministic signals", "إشارات محددة من البيانات")}
                subtitle={copy(language, "Signals come from the Analyzer’s bounded registry; they are not generated by AI.", "تأتي الإشارات من قائمة المحلل المحدودة ولا ينشئها الذكاء الاصطناعي.")}
                icon={<BarChart3 className="h-4 w-4" aria-hidden="true" />}
              >
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                    {copy(language, "Areas to review", "نقاط تستحق المراجعة")}
                  </h3>
                  {dto.weaknesses.length > 0 ? (
                    <ul className="mt-2 space-y-2">{dto.weaknesses.map((signal, index) => renderSignal(signal, false, index))}</ul>
                  ) : (
                    <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{copy(language, "No review signals are available for this period.", "لا توجد إشارات مراجعة متاحة لهذه الفترة.")}</p>
                  )}
                </div>
                <div className="mt-4 border-t border-slate-100 pt-4 dark:border-white/[0.07]">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                    {copy(language, "Positive signals", "إشارات إيجابية")}
                  </h3>
                  {dto.positives.length > 0 ? (
                    <ul className="mt-2 space-y-2">{dto.positives.map((signal, index) => renderSignal(signal, true, index))}</ul>
                  ) : (
                    <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{copy(language, "No positive signals are available for this period.", "لا توجد إشارات إيجابية متاحة لهذه الفترة.")}</p>
                  )}
                </div>
              </Panel>

              {STUDY_INSIGHTS_FRONTEND_ENABLED && (
                <AiInsightCard
                  language={language}
                  insight={insight}
                  loading={insightLoading}
                  failed={insightFailed}
                  onRefresh={() => void loadInsight()}
                />
              )}

              <Panel
                title={copy(language, "Ask My Study Data", "اسأل عن بيانات دراستي")}
                subtitle={copy(language, "Ask a single question about your own recorded study data.", "اسأل سؤالًا واحدًا عن بيانات دراستك المسجّلة.")}
                icon={<MessageCircleQuestion className="h-4 w-4" aria-hidden="true" />}
                action={(
                  <button
                    type="button"
                    aria-expanded={showAskPanel}
                    onClick={() => setShowAskPanel((value) => !value)}
                    className="min-h-11 shrink-0 rounded-xl bg-sky-700 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:ring-offset-2 dark:bg-sky-600 dark:hover:bg-sky-500"
                  >
                    {showAskPanel ? copy(language, "Close", "إغلاق") : copy(language, "Ask a question", "اطرح سؤالًا")}
                  </button>
                )}
              >
                {showAskPanel ? (
                  <AskMyStudyDataPanel language={language} />
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAskPanel(true)}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-sky-200 px-3 py-2 text-sm font-semibold text-sky-900 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-700 dark:border-sky-200/15 dark:text-sky-100 dark:hover:bg-sky-300/10"
                  >
                    {copy(language, "Ask about my study data", "اسأل عن بيانات دراستي")}
                    <ArrowRight className={`h-4 w-4 ${rtl ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                )}
              </Panel>
            </div>
          </div>
        </>
      )}
    </main>
  );
}