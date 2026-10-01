import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  Clock3,
  Coffee,
  Copy,
  ListChecks,
  NotebookPen,
  Minus,
  Plus,
  Play,
  ShieldCheck,
  Target,
  Trash2,
} from "lucide-react";
import type { DatabaseLecture, Subject } from "./types";
import { useTranslation, type Language } from "./translations";
import { FOCUS_AUDIO_ENABLED } from "./featureFlags";
import {
  FocusApiError,
  focusApi,
  createFocusIdempotencyKey,
  getFocusClientSource,
} from "./mockApi";
import {
  FOCUS_PLAN_LIMITS,
  FOCUS_PRESETS,
  areFocusPlanDraftsEqual,
  createEmptyFocusPlanDraft,
  estimateFocusPlan,
  focusPlanItemsFromDraft,
  focusPlanToDraft,
  isValidFocusBreakMinutes,
  isValidFocusPlanDraft,
  isValidFocusSessionCount,
  isValidFocusStudyMinutes,
  type FocusPlanDraft,
  type FocusPlanDraftItem,
  type FocusPlanRecord,
  type FocusSessionRecord,
} from "./FocusHubModel";
import { FocusAudioPlanningCard } from "./FocusAudioPlanningCard";
import { FocusLecturePicker } from "./FocusLecturePicker";
import {
  FocusCycleStrip,
  FocusTimerScene,
  type FocusDisplayPhase,
} from "./FocusVisuals";
import {
  ActiveFocusScreen,
  FocusHistoryScreen,
  FocusSessionSummaryScreen,
} from "./RouteScreens";

type LectureCatalogStatus = "loading" | "ready" | "error";
type FocusHubNoticeKey =
  | "focusHubAlreadyQueued"
  | "focusHubTooManyItems"
  | "focusHubSaved"
  | "focusHubSaveError"
  | "focusHubSessionConflict"
  | "focusHubAddAtLeastOne"
  | "focusHubStartError";

interface FocusHubProps {
  lectures: DatabaseLecture[];
  subjects: Subject[];
  language: Language;
  catalogStatus: LectureCatalogStatus;
  sessionRouteId: string | null;
  summaryRouteId: string | null;
  historyOpen: boolean;
  historyDetailId: string | null;
  onRefreshLectures: () => Promise<void>;
  onBackToHome: () => void;
  onReturnToPlanner: () => void;
  onOpenSession: (sessionId: string) => void;
  onOpenSummary: (sessionId: string) => void;
  onOpenHistory: () => void;
  onOpenHistoryDetail: (sessionId: string) => void;
  onReturnToHistory: () => void;
}

interface StartAttempt {
  planId: string;
  planItemId: string;
  idempotencyKey: string;
}

function sortPlansByRecent(plans: FocusPlanRecord[]): FocusPlanRecord[] {
  return [...plans].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

function currentOpenPlan(plans: FocusPlanRecord[]): FocusPlanRecord | null {
  return sortPlansByRecent(plans).find((plan) => plan.status === "ACTIVE") ?? null;
}

function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function getApiErrorCode(error: unknown): string | undefined {
  return error instanceof FocusApiError ? error.code : undefined;
}

function isConflictStatus(error: unknown): boolean {
  return error instanceof FocusApiError && error.status === 409;
}

function isNotFoundStatus(error: unknown): boolean {
  return error instanceof FocusApiError && error.status === 404;
}

function isAccessibleLectureId(lectureId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    lectureId,
  );
}

export function FocusHub({
  lectures,
  subjects,
  language,
  catalogStatus,
  sessionRouteId,
  summaryRouteId,
  historyOpen,
  historyDetailId,
  onRefreshLectures,
  onReturnToPlanner,
  onOpenSession,
  onOpenSummary,
  onOpenHistory,
  onOpenHistoryDetail,
  onReturnToHistory,
}: FocusHubProps) {
  const isRtl = language === "ar";
  const { t } = useTranslation(language);
  const [canonicalPlan, setCanonicalPlan] = useState<FocusPlanRecord | null>(null);
  const canonicalPlanRef = useRef<FocusPlanRecord | null>(null);
  const [currentSession, setCurrentSession] = useState<FocusSessionRecord | null>(null);
  const currentSessionRef = useRef<FocusSessionRecord | null>(null);
  const [draft, setDraft] = useState<FocusPlanDraft>(createEmptyFocusPlanDraft);
  const [plannerView, setPlannerView] = useState<FocusDisplayPhase>("focus");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [summaryStarting, setSummaryStarting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [serverConflict, setServerConflict] = useState<FocusPlanRecord | null>(null);
  const [notice, setNotice] = useState<{
    key: FocusHubNoticeKey;
    tone: "success" | "error" | "info";
  } | null>(null);
  const [quickNoteDraft, setQuickNoteDraft] = useState("");
  const [quickNoteFeedback, setQuickNoteFeedback] = useState<"copied" | "error" | null>(null);
  const [highlightedLectureId, setHighlightedLectureId] = useState<string | null>(null);
  const startAttemptRef = useRef<StartAttempt | null>(null);
  const summaryStartAttemptRef = useRef<StartAttempt | null>(null);
  const summaryStartLockRef = useRef(false);
  const startLockRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  const setCanonical = useCallback((plan: FocusPlanRecord | null) => {
    canonicalPlanRef.current = plan;
    setCanonicalPlan(plan);
  }, []);

  const setSession = useCallback((session: FocusSessionRecord | null) => {
    currentSessionRef.current = session;
    setCurrentSession(session);
  }, []);

  const loadCanonical = useCallback(
    async (options: { applyDraft?: boolean; silent?: boolean } = {}) => {
      const generation = ++requestGenerationRef.current;
      const applyDraft = options.applyDraft !== false;
      if (!options.silent) setLoadState("loading");
      try {
        const [currentResult, plans] = await Promise.all([
          focusApi.getCurrentFocusSession(),
          focusApi.listFocusPlans(100),
        ]);
        let plan = currentResult.session
          ? plans.find((candidate) => candidate.id === currentResult.session?.planId) ?? null
          : currentOpenPlan(plans);
        if (currentResult.session && !plan) {
          plan = await focusApi.getFocusPlan(currentResult.session.planId);
        }

        if (!mountedRef.current || generation !== requestGenerationRef.current) {
          return { plan, session: currentResult.session };
        }

        const previousPlan = canonicalPlanRef.current;
        setSession(currentResult.session);
        setCanonical(plan);
        if (applyDraft) {
          setDraft(plan ? focusPlanToDraft(plan) : createEmptyFocusPlanDraft());
          setServerConflict(null);
        } else if (
          plan &&
          (!previousPlan ||
            plan.id !== previousPlan.id ||
            plan.planVersion !== previousPlan.planVersion)
        ) {
          setServerConflict(plan);
        }
        setLoadState("ready");
        return { plan, session: currentResult.session };
      } catch (error) {
        if (mountedRef.current && generation === requestGenerationRef.current) {
          if (!options.silent) setLoadState("error");
        }
        throw error;
      }
    },
    [setCanonical, setSession],
  );

  useEffect(() => {
    mountedRef.current = true;
    if (!sessionRouteId && !summaryRouteId && !historyOpen) {
      void loadCanonical().catch(() => {});
    }
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
    };
  }, [historyOpen, loadCanonical, sessionRouteId, summaryRouteId]);

  const orderedLectures = useMemo(
    () => lectures.filter((lecture) => isAccessibleLectureId(lecture.id)),
    [lectures],
  );
  const lectureMap = useMemo(
    () => new Map(orderedLectures.map((lecture) => [lecture.id, lecture])),
    [orderedLectures],
  );
  const subjectMap = useMemo(
    () => new Map(subjects.map((subject) => [subject.id, subject])),
    [subjects],
  );

  const canonicalDraft = useMemo(
    () => (canonicalPlan ? focusPlanToDraft(canonicalPlan) : createEmptyFocusPlanDraft()),
    [canonicalPlan],
  );
  const isDirty = !areFocusPlanDraftsEqual(draft, canonicalDraft);
  const estimate = useMemo(() => estimateFocusPlan(draft), [draft]);
  const hasInvalidLecture = draft.items.some(
    (item) => !lectureMap.has(item.lectureId),
  );
  const validDurations =
    isValidFocusStudyMinutes(draft.studyMinutes) &&
    isValidFocusBreakMinutes(draft.breakMinutes);
  const validSessionCounts = draft.items.every((item) =>
    isValidFocusSessionCount(item.sessionCount),
  );
  const isValid =
    isValidFocusPlanDraft(draft) &&
    !hasInvalidLecture &&
    draft.items.length <= FOCUS_PLAN_LIMITS.maxItems;
  const canEdit =
    loadState === "ready" &&
    !currentSession &&
    !serverConflict &&
    !saving &&
    !starting;
  const canSave =
    isValid &&
    isDirty &&
    canEdit;
  const canStart =
    isValid &&
    loadState === "ready" &&
    !currentSession &&
    !serverConflict &&
    !saving &&
    !starting;

  const getSubjectName = useCallback(
    (id: string) => {
      const subject = subjectMap.get(id as Subject["id"]);
      if (!subject) return id;
      return isRtl ? subject.nameAr || subject.name : subject.name;
    },
    [isRtl, subjectMap],
  );

  const showNotice = useCallback(
    (key: FocusHubNoticeKey, tone: "success" | "error" | "info" = "info") => {
      setNotice({ key, tone });
    },
    [],
  );

  const copyQuickNote = async () => {
    if (!quickNoteDraft.trim()) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(quickNoteDraft);
      setQuickNoteFeedback("copied");
    } catch {
      setQuickNoteFeedback("error");
    }
  };

  const applyPreset = (presetId: (typeof FOCUS_PRESETS)[number]["id"]) => {
    setNotice(null);
    setDraft((previous) => {
      const selected = FOCUS_PRESETS.find((preset) => preset.id === presetId);
      if (!selected) return previous;
      if (selected.id === "CUSTOM") {
        return { ...previous, presetId: "CUSTOM" };
      }
      return {
        ...previous,
        presetId: selected.id,
        studyMinutes: selected.studyMinutes,
        breakMinutes: selected.breakMinutes,
        items: previous.items.map((item) => ({
          ...item,
          focusDurationSeconds: selected.studyMinutes * 60,
          breakDurationSeconds: selected.breakMinutes * 60,
        })),
      };
    });
  };

  const updateDuration = (key: "studyMinutes" | "breakMinutes", value: number) => {
    setNotice(null);
    setDraft((previous) => ({
      ...previous,
      presetId: "CUSTOM",
      [key]: value,
      items: previous.items.map((item) => ({
        ...item,
        ...(key === "studyMinutes"
          ? { focusDurationSeconds: value * 60 }
          : { breakDurationSeconds: value * 60 }),
      })),
    }));
  };

  const closePicker = useCallback(() => setPickerOpen(false), []);

  const addLecture = useCallback(
    (lecture: DatabaseLecture) => {
      const existing = draft.items.find((item) => item.lectureId === lecture.id);
      if (existing) {
        setHighlightedLectureId(existing.lectureId);
        showNotice("focusHubAlreadyQueued", "info");
        setPickerOpen(false);
        return;
      }
      if (draft.items.length >= FOCUS_PLAN_LIMITS.maxItems) {
        showNotice("focusHubTooManyItems", "error");
        return;
      }
      setNotice(null);
      setDraft((previous) => ({
        ...previous,
        items: [
          ...previous.items,
          {
            lectureId: lecture.id,
            sessionCount: 1,
            focusDurationSeconds: draft.studyMinutes * 60,
            breakDurationSeconds: draft.breakMinutes * 60,
            includeMcq: false,
            includeFlashcards: false,
            includeVideo: false,
          },
        ],
      }));
      setPickerOpen(false);
      setHighlightedLectureId(lecture.id);
    },
    [draft.items, draft.studyMinutes, draft.breakMinutes, showNotice],
  );

  useEffect(() => {
    if (!highlightedLectureId) return;
    const row = document.getElementById(`focus-queue-item-${highlightedLectureId}`);
    if (row) {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      row.scrollIntoView({
        block: "nearest",
        behavior: reduceMotion ? "auto" : "smooth",
      });
    }
    const timer = window.setTimeout(() => setHighlightedLectureId(null), 1_400);
    return () => window.clearTimeout(timer);
  }, [highlightedLectureId]);

  const changeSessionCount = (lectureId: string, delta: number) => {
    setNotice(null);
    setDraft((previous) => ({
      ...previous,
      items: previous.items.map((item) =>
        item.lectureId === lectureId
          ? {
              ...item,
              sessionCount: Math.min(
                FOCUS_PLAN_LIMITS.maxSessionsPerItem,
                Math.max(1, item.sessionCount + delta),
              ),
            }
          : item,
      ),
    }));
  };

  const reorderLecture = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draft.items.length) return;
    setNotice(null);
    setDraft((previous) => {
      const items = [...previous.items];
      [items[index], items[nextIndex]] = [items[nextIndex], items[index]];
      return { ...previous, items };
    });
  };

  const removeLecture = (lectureId: string) => {
    setNotice(null);
    setDraft((previous) => ({
      ...previous,
      items: previous.items.filter((item) => item.lectureId !== lectureId),
    }));
  };

  const loadSavedPlan = () => {
    if (serverConflict?.status === "ACTIVE") {
      setCanonical(serverConflict);
      setDraft(focusPlanToDraft(serverConflict));
    } else {
      setCanonical(null);
      setDraft(createEmptyFocusPlanDraft());
    }
    setServerConflict(null);
    setNotice(null);
  };

  const saveDraft = useCallback(async (): Promise<FocusPlanRecord | null> => {
    if (!isValidFocusPlanDraft(draft) || hasInvalidLecture || currentSessionRef.current) {
      return null;
    }
    setSaving(true);
    setNotice(null);
    try {
      const currentPlan = canonicalPlanRef.current;
      if (currentPlan) {
        const latest = await focusApi.getFocusPlan(currentPlan.id);
        if (
          latest.status !== "ACTIVE" ||
          latest.planVersion !== currentPlan.planVersion
        ) {
          setCanonical(latest);
          setServerConflict(latest);
          return null;
        }
        if (!areFocusPlanDraftsEqual(draft, focusPlanToDraft(latest))) {
          const updated = await focusApi.updateFocusPlan(latest.id, {
            title: latest.title,
            timezone: latest.timezone,
            items: focusPlanItemsFromDraft(draft, true),
          });
          setCanonical(updated);
          setDraft(focusPlanToDraft(updated));
          setServerConflict(null);
          showNotice("focusHubSaved", "success");
          return updated;
        }
        setCanonical(latest);
        return latest;
      }

      const latestOpenPlan = currentOpenPlan(await focusApi.listFocusPlans(100));
      if (latestOpenPlan) {
        setCanonical(latestOpenPlan);
        setServerConflict(latestOpenPlan);
        return null;
      }

      const created = await focusApi.createFocusPlan({
        title: t("focusHubTitle"),
        timezone: getBrowserTimezone(),
        items: focusPlanItemsFromDraft(draft, false),
      });
      setCanonical(created);
      setDraft(focusPlanToDraft(created));
      setServerConflict(null);
      showNotice("focusHubSaved", "success");
      return created;
    } catch (error) {
      const errorCode = getApiErrorCode(error);
      if (errorCode === "LECTURE_NOT_FOUND") {
        try {
          await onRefreshLectures();
        } catch {
          // Keep the draft; the next render will still allow a safe retry.
        }
      }
      if (
        isConflictStatus(error) ||
        isNotFoundStatus(error) ||
        errorCode === "LECTURE_NOT_FOUND"
      ) {
        try {
          await loadCanonical({ applyDraft: false, silent: true });
        } catch {
          // Keep the editable draft visible; the error notice below remains.
        }
      }
      showNotice("focusHubSaveError", "error");
      return null;
    } finally {
      setSaving(false);
    }
  }, [
    draft,
    hasInvalidLecture,
    loadCanonical,
    onRefreshLectures,
    setCanonical,
    showNotice,
    t,
  ]);

  const savePlan = () => {
    if (!canSave) return;
    void saveDraft();
  };

  const startFocus = async () => {
    if (!canStart || startLockRef.current) return;
    startLockRef.current = true;
    setStarting(true);
    setNotice(null);
    try {
      const plan = isDirty ? await saveDraft() : canonicalPlanRef.current;
      if (!plan) {
        if (!serverConflict) showNotice("focusHubSaveError", "error");
        return;
      }

      const latestSession = await focusApi.getCurrentFocusSession();
      if (latestSession.session) {
        setSession(latestSession.session);
        showNotice("focusHubSessionConflict", "info");
        return;
      }

      const firstPlanItem = [...plan.items].sort(
        (left, right) => left.sequence - right.sequence,
      )[0];
      if (!firstPlanItem) {
        showNotice("focusHubAddAtLeastOne", "error");
        return;
      }

      const existingAttempt = startAttemptRef.current;
      const attempt =
        existingAttempt?.planId === plan.id &&
        existingAttempt.planItemId === firstPlanItem.id
          ? existingAttempt
          : {
              planId: plan.id,
              planItemId: firstPlanItem.id,
              idempotencyKey: createFocusIdempotencyKey(),
            };
      startAttemptRef.current = attempt;

      const result = await focusApi.startFocusSession({
        planId: attempt.planId,
        planItemId: attempt.planItemId,
        idempotencyKey: attempt.idempotencyKey,
        source: getFocusClientSource(),
      });
      startAttemptRef.current = null;
      setSession(result.session);
      onOpenSession(result.session.id);
    } catch (error) {
      if (isConflictStatus(error) || getApiErrorCode(error) === "ACTIVE_SESSION_EXISTS") {
        try {
          const result = await loadCanonical({ applyDraft: false, silent: true });
          if (result.session) {
            showNotice("focusHubSessionConflict", "info");
            return;
          }
        } catch {
          // The existing draft remains available and no local active state is fabricated.
        }
      }
      showNotice("focusHubStartError", "error");
    } finally {
      startLockRef.current = false;
      setStarting(false);
    }
  };

  const startFromSummary = async (planId: string, planItemId: string) => {
    if (summaryStartLockRef.current) return;
    summaryStartLockRef.current = true;
    setSummaryStarting(true);
    try {
      const current = await focusApi.getCurrentFocusSession();
      if (current.session) {
        setSession(current.session);
        onOpenSession(current.session.id);
        return;
      }
      const previous = summaryStartAttemptRef.current;
      const attempt =
        previous?.planId === planId && previous.planItemId === planItemId
          ? previous
          : { planId, planItemId, idempotencyKey: createFocusIdempotencyKey() };
      summaryStartAttemptRef.current = attempt;
      const result = await focusApi.startFocusSession({
        planId: attempt.planId,
        planItemId: attempt.planItemId,
        idempotencyKey: attempt.idempotencyKey,
        source: getFocusClientSource(),
      });
      summaryStartAttemptRef.current = null;
      setSession(result.session);
      onOpenSession(result.session.id);
    } finally {
      summaryStartLockRef.current = false;
      setSummaryStarting(false);
    }
  };

  const summarySessionId = historyOpen && historyDetailId
    ? historyDetailId
    : summaryRouteId;

  if (historyOpen && !historyDetailId) {
    return (
      <FocusHistoryScreen
        language={language}
        lectures={lectures}
        subjects={subjects}
        onBack={onReturnToPlanner}
        onOpenSession={onOpenSession}
        onOpenSummary={onOpenHistoryDetail}
      />
    );
  }

  if (summarySessionId) {
    return (
      <FocusSessionSummaryScreen
        key={summarySessionId}
        sessionId={summarySessionId}
        language={language}
        starting={summaryStarting}
        onStartNext={startFromSummary}
        onBack={historyOpen ? onReturnToHistory : onReturnToPlanner}
      />
    );
  }

  const useSessionRoute = Boolean(sessionRouteId);
  const sessionPlan = currentSession
    ? canonicalPlan?.id === currentSession.planId
      ? canonicalPlan
      : null
    : null;
  const planItemIndex = sessionPlan?.items
    .slice()
    .sort((left, right) => left.sequence - right.sequence)
    .findIndex((item) => item.id === currentSession?.planItemId);
  const currentLectureTitle = currentSession
    ? lectureMap.get(currentSession.lectureId)?.name
    : undefined;

  if (useSessionRoute && sessionRouteId) {
    return (
      <ActiveFocusScreen
        key={sessionRouteId}
        sessionRouteId={sessionRouteId}
        lectures={lectures}
        language={language}
        catalogStatus={catalogStatus}
        onRefreshLectures={onRefreshLectures}
        onReturnToPlanner={onReturnToPlanner}
        onOpenSession={onOpenSession}
          onOpenSummary={onOpenSummary}
      />
    );
  }

  if (loadState === "loading") {
    return <FocusHubSkeleton language={language} />;
  }

  if (loadState === "error") {
    return (
      <div
        dir={isRtl ? "rtl" : "ltr"}
        className="mx-auto flex min-h-[65dvh] w-full max-w-3xl flex-col items-center justify-center px-5 py-12 text-center"
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-200">
          <ShieldCheck className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold text-slate-950 dark:text-white">
          {t("focusHubTitle")}
        </h1>
        <p role="alert" className="mt-2 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">
          {t("focusHubLoadError")}
        </p>
        <button
          type="button"
          onClick={() => void loadCanonical().catch(() => {})}
          className="mt-6 inline-flex min-h-12 items-center justify-center rounded-2xl bg-sky-700 px-5 text-sm font-semibold text-white transition hover:bg-sky-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:bg-sky-300 dark:text-slate-950 dark:hover:bg-sky-200"
        >
          {t("focusHubRetry")}
        </button>
      </div>
    );
  }

  const formatMinutes = (minutes: number) => (
    <span className="whitespace-nowrap tabular-nums">
      <bdi dir="ltr">
        {new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(minutes)}
      </bdi>
      {" "}
      {t("focusHubMinShort")}
    </span>
  );

  const messageToneClass =
    notice?.tone === "error"
      ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-300/15 dark:bg-rose-200/[0.06] dark:text-rose-200"
      : notice?.tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-300/15 dark:bg-emerald-200/[0.06] dark:text-emerald-200"
        : "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-300/15 dark:bg-sky-200/[0.06] dark:text-sky-200";

  return (
    <div
      dir={isRtl ? "rtl" : "ltr"}
      className="focus-hub-page mx-auto flex w-full max-w-6xl flex-col px-4 pb-10 pt-2 sm:px-6 lg:px-8"
    >
      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`mt-5 rounded-2xl border px-4 py-3 text-sm leading-6 ${messageToneClass}`}
        >
          {t(notice.key)}
        </div>
      )}

      {serverConflict && (
        <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-300/15 dark:bg-amber-200/[0.06] dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6">{t("focusHubPlanConflict")}</p>
          <button
            type="button"
            onClick={loadSavedPlan}
            className="flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-amber-300/70 bg-white/70 px-4 text-sm font-semibold transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 dark:border-amber-200/20 dark:bg-white/[0.04] dark:hover:bg-white/10"
          >
            {t("focusHubUseSavedPlan")}
          </button>
        </div>
      )}

      {currentSession && (
        <section
          aria-labelledby="focus-current-session-title"
          className="focus-hub-current-session mt-5 rounded-[24px] border border-emerald-200/80 bg-gradient-to-r from-emerald-50 to-white p-5 shadow-sm dark:border-emerald-300/15 dark:from-emerald-300/[0.09] dark:to-white/[0.025] sm:flex sm:items-center sm:justify-between sm:gap-5 sm:px-6"
        >
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id="focus-current-session-title" className="font-semibold text-slate-950 dark:text-white">
                {t("focusHubCurrentSession")}
              </h2>
              <p className="mt-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100" dir="auto">
                {currentLectureTitle || t("focusHubCurrentSession")}
              </p>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                {t("focusHubSessionNumber")}{" "}
                <bdi dir="ltr">{currentSession.sessionNumber}</bdi>
                {" "}
                {t("focusHubOf")}
                {" "}
                <bdi dir="ltr">{currentSession.plannedSessionCount}</bdi>
                {" · "}
                <bdi dir="ltr">{currentSession.status}</bdi>
                {planItemIndex !== undefined && planItemIndex >= 0 && sessionPlan && (
                  <>
                    {" · "}
                    {t("focusHubPlanProgress")}{" "}
                    <bdi dir="ltr">{planItemIndex + 1}/{sessionPlan.items.length}</bdi>
                  </>
                )}
              </p>
              <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-200 md:hidden">
                {t("focusHubActiveSessionHelp")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenSession(currentSession.id)}
            className="mt-4 flex min-h-12 w-full shrink-0 items-center justify-center rounded-2xl bg-emerald-700 px-5 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 sm:mt-0 sm:w-auto"
          >
            {t("focusHubResume")}
          </button>
        </section>
      )}

      <div className={`focus-hub-grid mt-5 grid grid-cols-1 items-start gap-4 md:grid-cols-[minmax(0,1.03fr)_minmax(250px,0.97fr)] md:gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(310px,0.95fr)] lg:gap-5 ${FOCUS_AUDIO_ENABLED ? "focus-hub-grid-audio" : ""}`}>
        <header className="focus-hub-header order-1 flex min-w-0 items-center justify-between gap-3 md:col-start-1 md:row-start-1">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-sky-200/80 bg-white text-blue-600 shadow-[0_7px_18px_rgba(58,116,173,0.12)] dark:border-white/10 dark:bg-white/[0.06] dark:text-sky-200">
              <Target className="size-6" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-[28px]">
                {t("focusHubNav")}
              </h1>
              <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400 sm:text-[15px]">
                {t("focusHubSubtitle")}
              </p>
            </div>
          </div>
        </header>

        <FocusCycleStrip
          language={language}
          focusMinutes={draft.studyMinutes}
          breakMinutes={draft.breakMinutes}
          plannedSessions={estimate.sessionCount}
          activePhase={plannerView}
          onPhaseChange={setPlannerView}
          tabPanelId="focus-planner-mode-panel"
          idPrefix="focus-planner-mode"
        />

        <section
          id="focus-planner-mode-panel"
          role="tabpanel"
          aria-labelledby={`focus-planner-mode-tab-${plannerView}`}
          aria-label={
            plannerView === "plan"
              ? t("focusHubTodayPlan")
              : plannerView === "break"
                ? t("focusHubShortBreak")
                : t("focusHubTimerSessionLabel")
          }
          tabIndex={0}
          className="focus-hub-timer order-3 min-w-0 md:col-start-1 md:row-start-3"
        >
          <FocusTimerScene progress={0} className="focus-hub-timer-scene min-h-[320px] sm:min-h-[360px]">
            {plannerView === "plan" ? (
              <>
                <span className="focus-hub-timer-icon mb-2 flex size-11 items-center justify-center rounded-full border border-sky-200 bg-white/90 text-blue-600 shadow-[0_5px_15px_rgba(60,130,200,0.18)] dark:border-white/10 dark:bg-white/[0.07] dark:text-sky-200">
                  <ListChecks className="size-6" aria-hidden="true" />
                </span>
                <span className="focus-hub-timer-caption text-sm font-medium text-slate-500 dark:text-slate-300">
                  {t("focusHubCyclePlan")}
                </span>
                <strong className="focus-hub-timer-value mt-1 font-mono text-5xl font-bold tracking-[-0.06em] text-slate-950 tabular-nums sm:text-6xl md:text-[68px] dark:text-white">
                  <bdi>{new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(estimate.sessionCount)}</bdi>
                </strong>
                <span className="focus-hub-timer-caption text-sm font-medium text-slate-500 dark:text-slate-300">
                  {t("focusHubSessionCount")}
                </span>
                <span className="mt-2 rounded-full border border-sky-200 bg-white/70 px-3 py-1 text-xs font-semibold text-sky-900 dark:border-white/10 dark:bg-white/[0.06] dark:text-sky-100">
                  {t("focusHubTotalTime")}: {formatMinutes(estimate.totalMinutes)}
                </span>
              </>
            ) : (
              <>
                <span className="focus-hub-timer-icon mb-2 flex size-11 items-center justify-center rounded-full border border-sky-200 bg-white/90 text-blue-600 shadow-[0_5px_15px_rgba(60,130,200,0.18)] dark:border-white/10 dark:bg-white/[0.07] dark:text-sky-200">
                  {plannerView === "break" ? (
                    <Coffee className="size-6" aria-hidden="true" />
                  ) : (
                    <Target className="size-6" aria-hidden="true" />
                  )}
                </span>
                <time
                  className="focus-hub-timer-value font-mono text-5xl font-bold tracking-[-0.06em] text-slate-950 tabular-nums sm:text-6xl md:text-[68px] dark:text-white"
                  dir="ltr"
                  aria-label={`${plannerView === "break" ? t("focusHubShortBreak") : t("focusHubTimerSessionLabel")}: ${plannerView === "break" ? draft.breakMinutes : draft.studyMinutes}:00`}
                >
                  <bdi>
                    {String(Math.max(0, plannerView === "break" ? draft.breakMinutes : draft.studyMinutes)).padStart(2, "0")}:00
                  </bdi>
                </time>
                <span className="focus-hub-timer-caption mt-1 text-sm font-medium text-slate-500 dark:text-slate-300">
                  {plannerView === "break" ? t("focusHubShortBreak") : t("focusHubTimerSessionLabel")}
                </span>
              </>
            )}
          </FocusTimerScene>
        </section>

        <div className="contents">
          <section
            aria-labelledby="focus-setup-title"
            className="focus-hub-setup order-7 min-w-0 rounded-[24px] border border-sky-100 bg-white/95 p-5 shadow-[0_10px_30px_rgba(46,104,158,0.06)] dark:border-white/10 dark:bg-[#17191f] sm:p-6 md:col-start-1 md:row-start-6"
          >
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#e7f2f5] text-[#285a73] dark:bg-sky-300/10 dark:text-sky-200">
                <Clock3 className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 id="focus-setup-title" className="font-semibold text-slate-950 dark:text-white">
                  {t("focusHubSetup")}
                </h2>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                  {t("focusHubPresets")}
                </p>
              </div>
            </div>

            <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-2" role="group" aria-label={t("focusHubPresets")}>
              {FOCUS_PRESETS.map((preset) => {
                const isSelected = draft.presetId === preset.id;
                const label =
                  preset.id === "CUSTOM"
                    ? t("focusHubCustom")
                    : `${preset.studyMinutes}/${preset.breakMinutes}`;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={
                      preset.id === "CUSTOM"
                        ? t("focusHubCustom")
                        : `${preset.studyMinutes} ${t("focusHubMinutes")}, ${preset.breakMinutes} ${t("focusHubBreakDuration")}`
                    }
                    onClick={() => applyPreset(preset.id)}
                    disabled={!canEdit}
                    className={`flex min-h-12 shrink-0 snap-start items-center justify-center rounded-2xl border px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-55 ${
                      isSelected
                        ? "border-[#3e7b98] bg-[#3e7b98] text-white shadow-sm shadow-sky-900/15 dark:border-sky-300 dark:bg-sky-300 dark:text-slate-950"
                        : "border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50/60 dark:border-white/10 dark:bg-white/[0.025] dark:text-slate-200 dark:hover:bg-white/[0.06]"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {draft.presetId === "CUSTOM" && (
              <div className="mt-4 grid gap-4 rounded-2xl bg-slate-50/80 p-4 dark:bg-white/[0.035] sm:grid-cols-2">
                <DurationStepper
                  label={t("focusHubStudyDuration")}
                  value={draft.studyMinutes}
                  min={1}
                  max={360}
                  disabled={!canEdit}
                  isRtl={isRtl}
                  onChange={(value) => updateDuration("studyMinutes", value)}
                />
                <DurationStepper
                  label={t("focusHubBreakDuration")}
                  value={draft.breakMinutes}
                  min={0}
                  max={180}
                  disabled={!canEdit}
                  isRtl={isRtl}
                  onChange={(value) => updateDuration("breakMinutes", value)}
                />
              </div>
            )}

            {!validDurations && (
              <div className="mt-3 space-y-1 text-sm text-rose-700 dark:text-rose-300">
                {!isValidFocusStudyMinutes(draft.studyMinutes) && (
                  <p role="alert">{t("focusHubInvalidStudy")}</p>
                )}
                {!isValidFocusBreakMinutes(draft.breakMinutes) && (
                  <p role="alert">{t("focusHubInvalidBreak")}</p>
                )}
              </div>
            )}
          </section>

          <section
            aria-labelledby="focus-queue-title"
            className="focus-hub-queue order-5 min-w-0 rounded-[24px] border border-sky-100 bg-white/95 p-5 shadow-[0_10px_30px_rgba(46,104,158,0.06)] dark:border-white/10 dark:bg-[#17191f] sm:p-6 md:col-start-2 md:row-start-1 md:row-span-3"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#e8f3f6] text-[#3e7b98] dark:bg-sky-300/10 dark:text-sky-100">
                  <BookOpen className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 id="focus-queue-title" className="font-semibold text-slate-950 dark:text-white">
                    {t("focusHubQueue")}
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                    <bdi dir="ltr">{draft.items.length}</bdi> / <bdi dir="ltr">{FOCUS_PLAN_LIMITS.maxItems}</bdi>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                disabled={!canEdit || draft.items.length >= FOCUS_PLAN_LIMITS.maxItems}
                className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-[#315f75] px-3 text-sm font-semibold text-white transition hover:bg-[#264f64] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-sky-300 dark:text-slate-950 dark:hover:bg-sky-200 sm:px-4"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>{t("focusHubAddLecture")}</span>
              </button>
            </div>

            {draft.items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/65 px-5 py-8 text-center dark:border-white/15 dark:bg-white/[0.02]">
                <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm dark:bg-white/[0.06] dark:text-slate-300">
                  <BookOpen className="h-5 w-5" aria-hidden="true" />
                </span>
                <p className="mt-3 font-medium text-slate-900 dark:text-white">{t("focusHubQueueEmpty")}</p>
                <p className="mt-1 text-sm leading-5 text-slate-500 dark:text-slate-400">
                  {t("focusHubQueueEmptyHint")}
                </p>
                <p className="mt-2 text-xs font-medium text-sky-800 dark:text-sky-200">
                  {t("focusHubAddAtLeastOne")}
                </p>
              </div>
            ) : (
              <ol className="focus-hub-queue-list space-y-3">
                {draft.items.map((item, index) => {
                  const lecture = lectureMap.get(item.lectureId);
                  const itemEstimate = estimate.items[index];
                  const isHighlighted = highlightedLectureId === item.lectureId;
                  return (
                    <li
                      key={item.lectureId}
                      id={`focus-queue-item-${item.lectureId}`}
                      className={`focus-hub-queue-item rounded-2xl border p-4 transition-colors ${
                        isHighlighted
                          ? "border-sky-400 bg-sky-50/80 dark:border-sky-300/40 dark:bg-sky-300/[0.07]"
                          : "border-slate-200/90 bg-white dark:border-white/10 dark:bg-white/[0.02]"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs font-bold tabular-nums text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
                          <bdi dir="ltr">{index + 1}</bdi>
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-slate-950 dark:text-white" dir="auto">
                            {lecture?.name ?? t("focusHubLectureUnavailable")}
                          </p>
                          {lecture && (
                            <p className="focus-hub-queue-subject mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                              {getSubjectName(lecture.mainSubject)}
                              {lecture.subSubject ? ` · ${lecture.subSubject}` : ""}
                            </p>
                          )}
                          {lecture && (
                            <p className="focus-hub-queue-compact-meta hidden truncate text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                              {getSubjectName(lecture.mainSubject)}
                              {" · "}
                              {t("focusHubEstimated")}{" "}
                              {formatMinutes(itemEstimate?.totalMinutes ?? 0)}
                            </p>
                          )}
                          <p className="focus-hub-queue-durations mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {formatMinutes(
                              (item.focusDurationSeconds ?? draft.studyMinutes * 60) / 60,
                            )}
                            {" · "}
                            {formatMinutes(
                              (item.breakDurationSeconds ?? draft.breakMinutes * 60) / 60,
                            )}{" "}
                            {t("focusHubBreakDuration").toLocaleLowerCase(language)}
                          </p>
                          <p className="focus-hub-queue-estimate mt-2 text-xs text-slate-500 dark:text-slate-400">
                            {t("focusHubEstimated")}{" "}
                            {formatMinutes(itemEstimate?.totalMinutes ?? 0)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => reorderLecture(index, -1)}
                            disabled={!canEdit || index === 0}
                            aria-label={`${t("focusHubMoveUp")}: ${lecture?.name ?? ""}`}
                            className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-white/10"
                          >
                            <ArrowUp className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => reorderLecture(index, 1)}
                            disabled={!canEdit || index === draft.items.length - 1}
                            aria-label={`${t("focusHubMoveDown")}: ${lecture?.name ?? ""}`}
                            className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-white/10"
                          >
                            <ArrowDown className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeLecture(item.lectureId)}
                            disabled={!canEdit}
                            aria-label={`${t("focusHubRemove")}: ${lecture?.name ?? ""}`}
                            className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-rose-400/10 dark:hover:text-rose-200"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>

                      <div className="focus-hub-session-count mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-white/[0.07]">
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          {t("focusHubSessionCount")}
                        </span>
                        <div className="flex min-h-11 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => changeSessionCount(item.lectureId, -1)}
                            disabled={!canEdit || item.sessionCount <= 1}
                            aria-label={t("focusHubDecreaseSessions")}
                            className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-35 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
                          >
                            <Minus className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={FOCUS_PLAN_LIMITS.maxSessionsPerItem}
                            step={1}
                            value={item.sessionCount}
                            onChange={(event) => {
                              const value = event.target.value === "" ? 0 : Number(event.target.value);
                              setDraft((previous) => ({
                                ...previous,
                                items: previous.items.map((candidate) =>
                                  candidate.lectureId === item.lectureId
                                    ? { ...candidate, sessionCount: value }
                                    : candidate,
                                ),
                              }));
                              setNotice(null);
                            }}
                            disabled={!canEdit}
                            aria-label={`${t("focusHubSessionCount")}: ${lecture?.name ?? ""}`}
                            aria-invalid={!isValidFocusSessionCount(item.sessionCount)}
                            className="h-11 w-16 rounded-xl border border-slate-200 bg-slate-50 text-center text-sm font-semibold tabular-nums text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-500/15 disabled:opacity-55 dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
                          />
                          <button
                            type="button"
                            onClick={() => changeSessionCount(item.lectureId, 1)}
                            disabled={!canEdit || item.sessionCount >= FOCUS_PLAN_LIMITS.maxSessionsPerItem}
                            aria-label={t("focusHubIncreaseSessions")}
                            className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-35 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
                          >
                            <Plus className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                      {!isValidFocusSessionCount(item.sessionCount) && (
                        <p role="alert" className="mt-2 text-sm text-rose-700 dark:text-rose-300">
                          {t("focusHubInvalidSessionCount")}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}

            {draft.items.length > 0 && hasInvalidLecture && (
              <p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-300">
                {t("focusHubLectureUnavailableHelp")}
              </p>
            )}
            {draft.items.length > FOCUS_PLAN_LIMITS.maxItems && (
              <p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-300">
                {t("focusHubTooManyItems")}
              </p>
            )}
            {!validSessionCounts && draft.items.length === 0 && (
              <p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-300">
                {t("focusHubInvalidSessionCount")}
              </p>
            )}
          </section>

        <section
          aria-label={t("focusHubStart")}
          className="focus-hub-actions order-6 min-w-0 rounded-[24px] border border-sky-100 bg-white/90 p-4 shadow-[0_10px_30px_rgba(46,104,158,0.06)] dark:border-white/10 dark:bg-[#17191f] sm:p-5 md:col-start-1 md:row-start-5"
        >
          <button
            type="button"
            onClick={() => {
              if (currentSession) onOpenSession(currentSession.id);
              else void startFocus();
            }}
            disabled={currentSession ? false : !canStart}
            className="focus-hub-start-button flex min-h-[58px] w-full items-center justify-center gap-3 rounded-full bg-gradient-to-r from-[#438fe9] via-[#4778e8] to-[#594fe5] px-6 text-base font-semibold text-white shadow-[0_10px_24px_rgba(59,111,223,0.24)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 dark:focus-visible:ring-offset-slate-950"
          >
            <Play className="size-5 fill-current" aria-hidden="true" />
            {currentSession
              ? t("focusHubResume")
              : starting
                ? <span aria-live="polite">{t("focusHubStarting")}</span>
                : t("focusHubStart")}
          </button>
          {!currentSession && !draft.items.length && (
            <p className="focus-hub-no-queue-hint mt-2 text-center text-xs text-slate-500 dark:text-slate-400">
              {t("focusHubAddAtLeastOne")}
            </p>
          )}
          <div className="focus-hub-action-links mt-3 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={savePlan}
              disabled={!canSave}
              className="inline-flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-semibold text-slate-600 transition hover:bg-sky-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-45 dark:text-slate-300 dark:hover:bg-white/[0.06]"
            >
              {saving ? t("focusHubSaving") : t("focusHubSavePlan")}
            </button>
            <button
              type="button"
              onClick={onOpenHistory}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-sky-200 dark:hover:bg-white/[0.06]"
            >
              <Clock3 className="size-4" aria-hidden="true" />
              {t("focusHubHistory")}
            </button>
          </div>
        </section>
        </div>

        <aside className="contents">
          <section
            aria-labelledby="focus-plan-summary-title"
            className="focus-hub-summary order-4 min-w-0 rounded-[24px] border border-sky-100 bg-white/95 p-5 shadow-[0_12px_36px_rgba(46,104,158,0.08)] dark:border-white/10 dark:bg-[#17191f] sm:p-6 md:col-start-1 md:row-start-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sky-800 dark:text-sky-200">
                  {t("focusHubPlannedSessions")}
                </p>
                <h2 id="focus-plan-summary-title" className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">
                  {t("focusHubTodayPlan")}
                </h2>
              </div>
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-50 text-blue-600 dark:bg-sky-300/10 dark:text-sky-100">
                <Check className="h-5 w-5" aria-hidden="true" />
              </span>
            </div>

            <div className="focus-plan-metrics mt-5 grid grid-cols-2 gap-2 md:grid-cols-5">
              <SummaryMetric label={t("focusHubLectureCount")} value={estimate.lectureCount} language={language} />
              <SummaryMetric label={t("focusHubSessionCount")} value={estimate.sessionCount} language={language} />
              <SummaryMetric label={t("focusHubStudyTotal")} value={formatMinutes(estimate.studyMinutes)} />
              <SummaryMetric label={t("focusHubBreakTotal")} value={formatMinutes(estimate.breakMinutes)} />
              <div
                className="focus-hub-total-compact hidden min-w-0 flex-col justify-center rounded-2xl border border-blue-200 bg-blue-50 px-2 py-1.5 text-blue-900 dark:border-sky-300/15 dark:bg-sky-300/[0.08] dark:text-sky-100"
                title={t("focusHubNoFinalBreak")}
              >
                <span className="truncate text-[10px] font-medium">{t("focusHubTotalTime")}</span>
                <span className="truncate text-sm font-semibold">{formatMinutes(estimate.totalMinutes)}</span>
                <span className="sr-only">{t("focusHubNoFinalBreak")}</span>
              </div>
            </div>

            <div className="focus-hub-summary-total-full mt-3 rounded-2xl border border-blue-500/70 bg-gradient-to-r from-[#438fe9] via-[#4778e8] to-[#594fe5] px-4 py-4 text-white shadow-[0_10px_24px_rgba(59,111,223,0.18)]">
              <p className="text-xs font-medium text-sky-100/90">
                {t("focusHubTotalTime")}
              </p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">
                {formatMinutes(estimate.totalMinutes)}
              </p>
              <p className="mt-2 text-xs leading-5 text-sky-100/80">
                {t("focusHubNoFinalBreak")}
              </p>
            </div>

            {!draft.items.length && (
              <p className="focus-hub-summary-hint mt-3 text-sm text-slate-500 dark:text-slate-400">
                {t("focusHubAddAtLeastOne")}
              </p>
            )}
            {hasInvalidLecture && (
              <p className="focus-hub-summary-hint mt-3 text-sm text-rose-700 dark:text-rose-300">
                {t("focusHubLectureUnavailableHelp")}
              </p>
            )}
            {currentSession && (
              <p className="focus-hub-summary-hint mt-3 text-sm text-emerald-800 dark:text-emerald-200">
                {t("focusHubActiveSessionHelp")}
              </p>
            )}

          </section>

          {FOCUS_AUDIO_ENABLED && (
            <div className="focus-hub-audio order-8 min-w-0 md:col-start-2 md:row-start-4">
              <FocusAudioPlanningCard language={language} />
            </div>
          )}

          <section
            aria-labelledby="focus-quick-notes-title"
            className="focus-hub-notes order-9 min-w-0 rounded-[24px] border border-sky-100 bg-white/95 p-4 shadow-[0_10px_30px_rgba(46,104,158,0.06)] dark:border-white/10 dark:bg-[#17191f] sm:p-5 md:col-start-2 md:row-start-5"
          >
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-blue-600 dark:bg-sky-300/10 dark:text-sky-200">
                <NotebookPen className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 id="focus-quick-notes-title" className="font-semibold text-slate-950 dark:text-white">
                  {t("focusHubQuickNotesTitle")}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {t("focusHubQuickNotes")}
                </p>
              </div>
            </div>
            <label className="sr-only" htmlFor="focus-planner-quick-note">
              {t("focusHubQuickNotesTitle")}
            </label>
            <div className="focus-hub-note-editor-row mt-4">
              <textarea
                id="focus-planner-quick-note"
                value={quickNoteDraft}
                onChange={(event) => {
                  setQuickNoteDraft(event.target.value);
                  setQuickNoteFeedback(null);
                }}
                placeholder={t("focusHubQuickNotePlaceholder")}
                className="focus-hub-note-editor min-h-[150px] w-full resize-y rounded-2xl border border-slate-200 bg-white/90 p-4 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-100/70 dark:border-white/10 dark:bg-white/[0.03] dark:text-white dark:placeholder:text-slate-500 dark:focus:border-sky-400 dark:focus:ring-sky-400/10"
              />
              <div className="focus-hub-note-actions mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setQuickNoteDraft("");
                  setQuickNoteFeedback(null);
                }}
                disabled={!quickNoteDraft}
                aria-label={t("focusHubQuickNoteClear")}
                title={t("focusHubQuickNoteClear")}
                className="flex size-11 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-white/10"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => void copyQuickNote()}
                disabled={!quickNoteDraft.trim()}
                aria-label={t("focusHubQuickNoteCopy")}
                title={t("focusHubQuickNoteCopy")}
                className="flex size-11 items-center justify-center rounded-xl bg-sky-50 text-blue-700 transition hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-sky-300/10 dark:text-sky-200 dark:hover:bg-sky-300/20"
              >
                <Copy className="size-4" aria-hidden="true" />
              </button>
              </div>
            </div>
            {quickNoteFeedback && (
              <p
                role={quickNoteFeedback === "error" ? "alert" : "status"}
                className={`mt-1 text-xs ${quickNoteFeedback === "error" ? "text-rose-700 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-300"}`}
              >
                {quickNoteFeedback === "copied"
                  ? t("focusHubQuickNoteCopied")
                  : t("focusHubQuickNoteCopyUnavailable")}
              </p>
            )}
          </section>
        </aside>
      </div>

      <FocusLecturePicker
        isOpen={pickerOpen}
        lectures={lectures}
        subjects={subjects}
        queuedItems={draft.items}
        language={language}
        catalogStatus={catalogStatus}
        onClose={closePicker}
        onSelect={addLecture}
        onRefresh={onRefreshLectures}
      />
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  language,
}: {
  label: string;
  value: ReactNode;
  language?: Language;
}) {
  return (
    <div
      dir={language === "ar" ? "rtl" : "ltr"}
      className="min-h-[76px] rounded-2xl border border-slate-200/70 bg-slate-50/80 p-3 dark:border-white/[0.07] dark:bg-white/[0.025]"
    >
      <p className="text-[11px] font-medium leading-4 text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-base font-semibold tabular-nums text-slate-900 dark:text-white">
        {typeof value === "number" ? <bdi dir="ltr">{new Intl.NumberFormat(language).format(value)}</bdi> : value}
      </p>
    </div>
  );
}

function DurationStepper({
  label,
  value,
  min,
  max,
  disabled,
  isRtl,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  isRtl: boolean;
  onChange: (value: number) => void;
}) {
  const { t } = useTranslation(isRtl ? "ar" : "en");
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </label>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={disabled || value <= min}
          aria-label={t("focusHubDecreaseDuration")}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-35 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/10"
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(event) => onChange(event.target.value === "" ? 0 : Number(event.target.value))}
          disabled={disabled}
          aria-label={label}
          className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-center text-base font-semibold tabular-nums text-slate-950 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-500/15 disabled:opacity-55 dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
        />
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={disabled || value >= max}
          aria-label={t("focusHubIncreaseDuration")}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-35 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/10"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function FocusHubSkeleton({ language }: { language: Language }) {
  const { t } = useTranslation(language);
  return (
    <div
      dir={language === "ar" ? "rtl" : "ltr"}
      className="mx-auto w-full max-w-6xl px-4 pb-10 pt-2 sm:px-6 lg:px-8"
      aria-busy="true"
      aria-label={t("focusHubLoading")}
    >
      <div className="h-36 animate-pulse rounded-[28px] bg-gradient-to-br from-slate-200 to-sky-100 dark:from-white/[0.08] dark:to-sky-300/[0.05]" />
      <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(270px,340px)]">
        <div className="space-y-5">
          <div className="h-48 animate-pulse rounded-[24px] bg-slate-100 dark:bg-white/[0.05]" />
          <div className="h-64 animate-pulse rounded-[24px] bg-slate-100 dark:bg-white/[0.05]" />
        </div>
        <div className="h-96 animate-pulse rounded-[24px] bg-slate-100 dark:bg-white/[0.05]" />
      </div>
      <p className="sr-only">{t("focusHubLoading")}</p>
    </div>
  );
}