import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Clock3, History, Play, RotateCcw } from "lucide-react";
import type { DatabaseLecture, Subject } from "../../../core/types";
import { useTranslation, type Language } from "../../../core/i18n/translations";
import type {
  FocusHistoryPageDto,
  FocusHistoryRowDto,
  FocusSessionSummaryDto,
} from "../../../../server/features/focus/types";
import { focusApi } from "../api/focusApi";
import { FocusQuickNotesPanel } from "./FocusQuickNotesPanel";

const TERMINAL_STATUSES = new Set(["COMPLETED", "ABANDONED", "EXPIRED"]);
const HISTORY_STATUSES = [
  ["COMPLETED", "focusHistoryCompleted"],
  ["ABANDONED", "focusHistoryAbandoned"],
  ["EXPIRED", "focusHistoryExpired"],
  ["ACTIVE", "focusHistoryActive"],
  ["PAUSED", "focusHistoryPaused"],
  ["RESOURCE_HANDOFF", "focusHistoryResourceHandoff"],
  ["RECONCILIATION_REQUIRED", "focusHistoryReconciliation"],
  ["CREATED", "focusHistoryCreated"],
] as const;

function formatDuration(seconds: number, language: Language, minuteLabel: string, hourLabel: string): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const number = (value: number) => new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(value);
  if (hours > 0 && rest > 0) return `${number(hours)} ${hourLabel} ${number(rest)} ${minuteLabel}`;
  if (hours > 0) return `${number(hours)} ${hourLabel}`;
  return `${number(minutes)} ${minuteLabel}`;
}

function statusTranslationKey(status: string): (typeof HISTORY_STATUSES)[number][1] {
  return HISTORY_STATUSES.find(([value]) => value === status)?.[1] ?? "focusHistoryCreated";
}

function dateLabel(value: string | null, language: Language): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(language === "ar" ? "ar" : "en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function PageBackButton({
  language,
  label,
  onClick,
}: {
  language: Language;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300 dark:hover:bg-white/10"
    >
      {language === "ar" ? (
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      ) : (
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      )}
      {label}
    </button>
  );
}

export function FocusSessionSummaryScreen({
  sessionId,
  language,
  onBack,
  onStartNext,
  starting,
}: {
  sessionId: string;
  language: Language;
  onBack: () => void;
  onStartNext: (planId: string, planItemId: string) => Promise<void>;
  starting: boolean;
}) {
  const rtl = language === "ar";
  const { t } = useTranslation(language);
  const [summary, setSummary] = useState<FocusSessionSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [nextError, setNextError] = useState(false);
  const [manualPromptDismissed, setManualPromptDismissed] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine,
  );

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setFailed(false);
    setSummary(null);
    setNextError(false);
    setManualPromptDismissed(false);
    focusApi.getSessionSummary(sessionId).then((result) => {
      if (current) setSummary(result);
    }).catch(() => {
      if (current) setFailed(true);
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [retry, sessionId]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [sessionId]);

  const heading = summary?.status === "COMPLETED"
    ? t("focusSummaryCompleted")
    : summary?.status === "ABANDONED"
      ? t("focusSummaryAbandoned")
      : summary?.status === "EXPIRED"
        ? t("focusSummaryExpired")
        : t("focusSummaryTitle");
  const startNext = async () => {
    if (!summary?.nextAction.planItemId) return;
    setNextError(false);
    try {
      await onStartNext(summary.plan.id, summary.nextAction.planItemId);
    } catch {
      setNextError(true);
    }
  };
  const otherNotes = summary?.quickNotes.filter((note) => note.status !== "ACTIVE") ?? [];

  return (
    <section
      dir={rtl ? "rtl" : "ltr"}
      aria-labelledby="focus-session-summary-title"
      className="mx-auto w-full max-w-6xl px-4 pb-10 pt-4 sm:px-6 lg:px-8"
    >
      <PageBackButton language={language} label={t("focusSummaryBack")} onClick={onBack} />
      <section className="mt-4 overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_20px_60px_rgba(25,35,70,0.08)] dark:border-white/10 dark:bg-[#17191f]">
        <header className="bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 px-5 py-7 text-white sm:px-8 sm:py-9">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-white/10">
              <Clock3 className="h-5 w-5 text-indigo-100" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-200">
                {t("focusSummaryTitle")}
              </p>
              <h1 ref={headingRef} tabIndex={-1} id="focus-session-summary-title" className="mt-1 text-2xl font-semibold tracking-tight focus:outline-none sm:text-3xl">
                {loading ? t("focusHistoryLoading") : heading}
              </h1>
            </div>
          </div>
        </header>

        <div className="p-5 sm:p-8">
          {loading ? (
              <div aria-busy="true" role="status" className="space-y-4">
              <div className="h-6 w-2/3 motion-safe:animate-pulse rounded bg-slate-100 dark:bg-white/[0.06]" />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="h-28 motion-safe:animate-pulse rounded-2xl bg-slate-100 dark:bg-white/[0.06]" />
                <div className="h-28 motion-safe:animate-pulse rounded-2xl bg-slate-100 dark:bg-white/[0.06]" />
              </div>
            </div>
          ) : failed || !summary ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-900 dark:border-rose-300/15 dark:bg-rose-200/[0.06] dark:text-rose-100">
              <p role="alert" className="text-sm">{t("focusSummaryError")}</p>
              <button
                type="button"
                onClick={() => setRetry((value) => value + 1)}
                className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-300 bg-white px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 dark:border-rose-200/20 dark:bg-white/[0.04]"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                {t("focusSummaryRetry")}
              </button>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <FactCard label={t("focusSummaryLecture")} value={summary.lecture.title} />
                <FactCard label={t("focusSummaryPlan")} value={summary.plan.title} />
                <FactCard
                  label={t("focusSummaryProgress")}
                  value={`${summary.progress.sessionNumber} / ${summary.progress.plannedSessionCount}`}
                  numeric
                />
                <FactCard
                  label={t("focusSummaryStartedAt")}
                  value={dateLabel(summary.timing.startedAt, language) ?? "—"}
                />
                <FactCard
                  label={t("focusSummaryEndedAt")}
                  value={dateLabel(summary.timing.terminalAt, language) ?? "—"}
                />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <FactCard
                  label={t("focusSummaryPlanned")}
                  value={formatDuration(summary.timing.plannedFocusSeconds, language, t("focusHubMinShort"), language === "ar" ? "س" : "h")}
                  numeric
                />
                <FactCard
                  label={t("focusSummaryVerified")}
                  value={summary.timing.verifiedFocusSeconds === null
                    ? t("focusSummaryNotVerified")
                    : formatDuration(summary.timing.verifiedFocusSeconds, language, t("focusHubMinShort"), language === "ar" ? "س" : "h")}
                  numeric={summary.timing.verifiedFocusSeconds !== null}
                />
                <FactCard
                  label={t("focusSummaryBreak")}
                  value={formatDuration(summary.timing.plannedBreakSeconds, language, t("focusHubMinShort"), language === "ar" ? "س" : "h")}
                  numeric
                />
                <FactCard
                  label={t("focusSummaryPoints")}
                  value={summary.points
                    ? new Intl.NumberFormat(language).format(summary.points.amount)
                    : t("focusSummaryNoPoints")}
                  numeric={Boolean(summary.points)}
                />
                <FactCard
                  label={t("focusSummaryPlanProgress")}
                  value={`${summary.progress.completedSessions} / ${summary.progress.totalPlannedSessions}`}
                  numeric
                />
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
                {t("focusSummaryBreakExcluded")}
              </p>

              <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.72fr)]">
                <section aria-labelledby="focus-summary-resources" className="rounded-2xl border border-slate-200 p-4 dark:border-white/10 sm:p-5">
                  <h2 id="focus-summary-resources" className="font-semibold text-slate-950 dark:text-white">
                    {t("focusSummaryResources")}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {t("focusHistoryResourceLaunches")}: <bdi dir="ltr">{summary.resources.launchCount}</bdi>
                    {" · "}
                    {t("focusHistoryUniqueResources")}: <bdi dir="ltr">{summary.resources.uniqueResourceCount}</bdi>
                  </p>
                  {summary.resources.items.length ? (
                    <ul className="mt-4 space-y-2">
                      {summary.resources.items.map((resource) => (
                        <li key={resource.resourceId} className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 dark:bg-white/[0.035]">
                          <span className="flex min-w-0 items-center gap-2">
                            <BookOpen className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden="true" />
                            <span className="min-w-0 truncate text-sm font-medium text-slate-800 dark:text-slate-100" dir="auto">
                              {resource.title ?? t("focusSummaryResourceUnavailable")}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                            {resource.resourceType === "PDF" ? t("focusSummaryPdf") : t("focusSummaryVideo")}
                            {" · "}
                            <bdi dir="ltr">{resource.launchCount}</bdi>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{t("focusSummaryNoResources")}</p>
                  )}
                </section>

                <section aria-labelledby="focus-summary-next" className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 dark:border-indigo-300/15 dark:bg-indigo-200/[0.05] sm:p-5">
                  <h2 id="focus-summary-next" className="font-semibold text-slate-950 dark:text-white">
                    {t("focusSummaryNextSession")}
                  </h2>
                  {summary.nextAction.kind === "PLAN_FINISHED" ? (
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t("focusSummaryPlanFinished")}</p>
                  ) : summary.nextAction.kind === "UNAVAILABLE" ? (
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t("focusSummaryNextUnavailable")}</p>
                  ) : (
                    <>
                      <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200" dir="auto">
                        {summary.nextAction.lectureTitle}
                      </p>
                      <button
                        type="button"
                        disabled={starting || !online}
                        onClick={() => void startNext()}
                        className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-700 px-4 text-sm font-semibold text-white transition hover:bg-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Play className="h-4 w-4" aria-hidden="true" />
                        {starting
                          ? t("focusSummaryStarting")
                          : summary.nextAction.kind === "NEXT_LECTURE"
                            ? t("focusSummaryNextLecture")
                            : t("focusSummaryNextSession")}
                      </button>
                    </>
                  )}
                  {nextError && <p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-200">{t("focusSummaryNextError")}</p>}
                </section>
              </div>

              {summary.progress.isLastPlannedSession && summary.status === "COMPLETED" && !manualPromptDismissed && (
                <section aria-labelledby="focus-summary-manual-title" className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-300/15 dark:bg-amber-200/[0.06] sm:flex sm:items-center sm:justify-between sm:gap-5 sm:p-5">
                  <div>
                    <h2 id="focus-summary-manual-title" className="font-semibold text-amber-950 dark:text-amber-100">
                      {t("focusSummaryManualTitle")}
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-amber-900/80 dark:text-amber-100/80">
                      {t("focusSummaryManualBody")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setManualPromptDismissed(true)}
                    className="mt-3 min-h-11 shrink-0 rounded-xl border border-amber-300 bg-white px-4 text-sm font-semibold text-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 sm:mt-0 dark:border-amber-200/20 dark:bg-white/[0.04] dark:text-amber-100"
                  >
                    {t("focusSummaryNotNow")}
                  </button>
                </section>
              )}

              {otherNotes.length > 0 && (
                <section aria-labelledby="focus-summary-other-notes" className="mt-6 rounded-2xl border border-slate-200 p-4 dark:border-white/10 sm:p-5">
                  <h2 id="focus-summary-other-notes" className="font-semibold text-slate-950 dark:text-white">
                    {t("focusSummaryOtherNotes")}
                  </h2>
                  <ul className="mt-3 space-y-3">
                    {otherNotes.map((note) => (
                      <li key={note.id} className="rounded-xl bg-slate-50 p-3 dark:bg-white/[0.035]">
                        <span className="inline-flex rounded-full border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 dark:border-white/10 dark:text-slate-300">
                          {note.status === "ARCHIVED" ? t("focusSummaryNoteArchived") : t("focusSummaryNoteConverted")}
                        </span>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800 dark:text-slate-100" dir="auto">
                          {note.content}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <div className="mt-6">
                <FocusQuickNotesPanel sessionId={summary.sessionId} language={language} online={online} />
              </div>
            </>
          )}
        </div>
      </section>
    </section>
  );
}

function FactCard({
  label,
  value,
  numeric = false,
}: {
  label: string;
  value: string;
  numeric?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/[0.035]">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1.5 break-words text-sm font-semibold text-slate-950 dark:text-white ${numeric ? "tabular-nums" : ""}`} dir={numeric ? "ltr" : "auto"}>
        {value}
      </p>
    </div>
  );
}

export function FocusHistoryScreen({
  language,
  lectures,
  subjects,
  onBack,
  onOpenSession,
  onOpenSummary,
}: {
  language: Language;
  lectures: DatabaseLecture[];
  subjects: Subject[];
  onBack: () => void;
  onOpenSession: (sessionId: string) => void;
  onOpenSummary: (sessionId: string) => void;
}) {
  const rtl = language === "ar";
  const { t } = useTranslation(language);
  const [rows, setRows] = useState<FocusHistoryRowDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [subject, setSubject] = useState("");
  const [lectureId, setLectureId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const subjectOptions = useMemo(() => {
    const codes = new Set(lectures.map((lecture) => lecture.mainSubject).filter(Boolean));
    return subjects
      .filter((item) => codes.has(item.id))
      .map((item) => ({ id: item.id, name: item.name }))
      .sort((left, right) => left.name.localeCompare(right.name, language));
  }, [lectures, language, subjects]);
  const lectureOptions = useMemo(
    () => lectures
      .filter((lecture) => !subject || lecture.mainSubject === subject)
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name, language)),
    [lectures, language, subject],
  );

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(false);
    setCursor(null);
    setRows([]);
    focusApi.listHistory({
      limit: 20,
      ...(status ? { status: status as NonNullable<Parameters<typeof focusApi.listHistory>[0]>["status"] } : {}),
      ...(subject ? { subject } : {}),
      ...(lectureId ? { lectureId } : {}),
    }).then((page) => {
      if (!current) return;
      setRows(page.items);
      setCursor(page.nextCursor);
    }).catch(() => {
      if (current) setError(true);
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [lectureId, retry, status, subject]);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError(false);
    try {
      const page: FocusHistoryPageDto = await focusApi.listHistory({
        limit: 20,
        cursor,
        ...(status ? { status: status as NonNullable<Parameters<typeof focusApi.listHistory>[0]>["status"] } : {}),
        ...(subject ? { subject } : {}),
        ...(lectureId ? { lectureId } : {}),
      });
      setRows((previous) => [...previous, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      setError(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const statusLabel = (value: string) => t(statusTranslationKey(value));
  const minute = t("focusHubMinShort");
  const hour = language === "ar" ? "س" : "h";

  return (
    <section dir={rtl ? "rtl" : "ltr"} aria-labelledby="focus-history-title" className="mx-auto w-full max-w-6xl px-4 pb-10 pt-4 sm:px-6 lg:px-8">
      <PageBackButton language={language} label={t("focusSummaryBack")} onClick={onBack} />
      <header className="mt-4 rounded-[28px] bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 px-5 py-7 text-white shadow-[0_22px_60px_rgba(28,37,75,0.18)] sm:px-8 sm:py-9">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-white/10">
            <History className="h-5 w-5 text-indigo-100" aria-hidden="true" />
          </span>
          <div>
            <h1 ref={headingRef} tabIndex={-1} id="focus-history-title" className="text-2xl font-semibold tracking-tight focus:outline-none sm:text-3xl">{t("focusHistoryTitle")}</h1>
            <p className="mt-1 text-sm text-slate-300">{t("focusHistorySubtitle")}</p>
          </div>
        </div>
      </header>

      <section aria-label={t("focusHistoryTitle")} className="mt-5 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#17191f] sm:p-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("focusHistoryStatus")}
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-white/15 dark:bg-[#20232b] dark:text-white"
            >
              <option value="">{t("focusHistoryAll")}</option>
              {HISTORY_STATUSES.map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("focusHistorySubject")}
            <select
              value={subject}
              onChange={(event) => {
                setSubject(event.target.value);
                setLectureId("");
              }}
              className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-white/15 dark:bg-[#20232b] dark:text-white"
            >
              <option value="">{t("focusHistoryAll")}</option>
              {subjectOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("focusHistoryLecture")}
            <select
              value={lectureId}
              onChange={(event) => setLectureId(event.target.value)}
              className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-white/15 dark:bg-[#20232b] dark:text-white"
            >
              <option value="">{t("focusHistoryAll")}</option>
              {lectureOptions.map((lecture) => <option key={lecture.id} value={lecture.id}>{lecture.name}</option>)}
            </select>
          </label>
        </div>

        {loading ? (
          <div role="status" aria-busy="true" className="mt-5 space-y-3">
            <div className="h-24 motion-safe:animate-pulse rounded-2xl bg-slate-100 dark:bg-white/[0.06]" />
            <div className="h-24 motion-safe:animate-pulse rounded-2xl bg-slate-100 dark:bg-white/[0.06]" />
          </div>
        ) : error && rows.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-900 dark:border-rose-300/15 dark:bg-rose-200/[0.06] dark:text-rose-100">
            <p role="alert" className="text-sm">{t("focusHistoryError")}</p>
            <button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-3 min-h-11 rounded-xl border border-rose-300 bg-white px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 dark:border-rose-200/20 dark:bg-white/[0.04]">
              {t("focusHistoryRetry")}
            </button>
          </div>
        ) : rows.length === 0 ? (
          <p role="status" className="mt-5 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600 dark:border-white/15 dark:text-slate-300">
            {t("focusHistoryEmpty")}
          </p>
        ) : (
          <ol className="mt-5 space-y-3">
            {rows.map((row) => (
              <li key={row.sessionId}>
                <HistoryRow
                  row={row}
                  language={language}
                  subjectLabel={subjects.find((item) => item.id === row.subject)?.name ?? row.subject}
                  statusLabel={statusLabel(row.status)}
                  formatPlanned={formatDuration(row.plannedFocusSeconds, language, minute, hour)}
                  onClick={() => TERMINAL_STATUSES.has(row.status)
                    ? onOpenSummary(row.sessionId)
                    : onOpenSession(row.sessionId)}
                />
              </li>
            ))}
          </ol>
        )}

        {error && rows.length > 0 && (
          <p role="alert" className="mt-4 text-sm text-rose-700 dark:text-rose-200">{t("focusHistoryError")}</p>
        )}
        {cursor && !loading && (
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60 dark:border-white/15 dark:bg-white/[0.03] dark:text-white dark:hover:bg-white/[0.07]"
          >
            {loadingMore && <span className="size-4 motion-safe:animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />}
            {loadingMore ? t("focusHistoryLoadingMore") : t("focusHistoryLoadMore")}
          </button>
        )}
      </section>
    </section>
  );
}

function HistoryRow({
  row,
  language,
  subjectLabel,
  statusLabel,
  formatPlanned,
  onClick,
}: {
  row: FocusHistoryRowDto;
  language: Language;
  subjectLabel: string;
  statusLabel: string;
  formatPlanned: string;
  onClick: () => void;
}) {
  const { t } = useTranslation(language);
  const verified = row.verifiedFocusSeconds === null
    ? null
    : formatDuration(row.verifiedFocusSeconds, language, t("focusHubMinShort"), language === "ar" ? "س" : "h");
  const stamp = dateLabel(row.startedAt, language);
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-[92px] w-full items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-start transition hover:border-indigo-300 hover:bg-indigo-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-white/10 dark:bg-white/[0.02] dark:hover:border-indigo-300/30 dark:hover:bg-indigo-200/[0.04] sm:items-center sm:p-5"
    >
      <span className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 dark:bg-indigo-300/10 dark:text-indigo-200">
          <BookOpen className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-semibold text-slate-950 dark:text-white" dir="auto">{row.lectureTitle}</span>
          <span className="mt-1 block truncate text-sm text-slate-600 dark:text-slate-300" dir="auto">{row.planTitle} · {subjectLabel}</span>
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span>{statusLabel}</span>
            {stamp && <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" aria-hidden="true" />{stamp}</span>}
            <span>{t("focusSummaryPlanned")}: <bdi dir="ltr">{formatPlanned}</bdi></span>
            {verified !== null && <span>{t("focusSummaryVerified")}: <bdi dir="ltr">{verified}</bdi></span>}
            {row.points !== null && <span>{t("focusSummaryPoints")}: <bdi dir="ltr">{row.points}</bdi></span>}
            {row.resourceLaunchCount > 0 && (
              <span>{t("focusHistoryResourceLaunches")}: <bdi dir="ltr">{row.resourceLaunchCount}</bdi></span>
            )}
          </span>
        </span>
      </span>
      <span className="mt-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-indigo-700 transition group-hover:bg-indigo-100 dark:text-indigo-200 dark:group-hover:bg-white/10 sm:mt-0">
        {language === "ar"
          ? <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
      </span>
    </button>
  );
}