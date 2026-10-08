import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./focus-hub-approved.css";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  BookOpen,
  CalendarDays,
  Clock3,
  Coffee,
  List,
  Minus,
  Plus,
  Play,
  ShieldCheck,
  Target,
  Trash2,
} from "lucide-react";
import type { DatabaseLecture, Subject } from "../../../core/types";
import { useTranslation, type Language } from "../../../core/i18n/translations";
import { FOCUS_AUDIO_ENABLED } from "../../../config/featureFlags";
import {
  FocusApiError,
  focusApi,
  isRetryableFocusReadError,
} from "../api/focusApi";
import { FocusRuntimeController } from "../runtime/controller";
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
} from "../focusHubModel";
import { FocusAudioPlanningCard } from "./FocusAudioPlanningCard";
import { FocusLecturePicker } from "./FocusLecturePicker";
import {
  FocusTimerScene,
} from "./FocusVisuals";
import { ActiveFocusScreen } from "./ActiveFocusScreen";
import { useStudyFeatureFlags } from "../../study-core/StudyFeatureFlagsProvider";
import {
  FocusHistoryScreen,
  FocusSessionSummaryScreen,
} from "./FocusHistoryScreens";

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
  accountId: string | null;
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
  accountId,
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
  const { FOCUS_RESOURCE_HANDOFF_ENABLED } = useStudyFeatureFlags();
  const isRtl = language === "ar";
  const { t } = useTranslation(language);
  const refreshLecturesRef = useRef(onRefreshLectures);
  refreshLecturesRef.current = onRefreshLectures;
  const lectureRetryAttemptRef = useRef(0);
  const controllerLifecycleRef = useRef(
    new WeakMap<FocusRuntimeController, number>(),
  );
  const runtimeController = useMemo(
    () => new FocusRuntimeController({ accountId }),
    [accountId],
  );
  const [runtimeState, setRuntimeState] = useState(() => runtimeController.getState());
  const [canonicalPlan, setCanonicalPlan] = useState<FocusPlanRecord | null>(null);
  const canonicalPlanRef = useRef<FocusPlanRecord | null>(null);
  const [currentSession, setCurrentSession] = useState<FocusSessionRecord | null>(null);
  const currentSessionRef = useRef<FocusSessionRecord | null>(null);
  const [draft, setDraft] = useState<FocusPlanDraft>(createEmptyFocusPlanDraft);
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
  const [highlightedLectureId, setHighlightedLectureId] = useState<string | null>(null);
  const [sessionCountPulse, setSessionCountPulse] = useState<{
    lectureId: string;
    sequence: number;
  } | null>(null);
  const summaryStartLockRef = useRef(false);
  const startLockRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const loadRetryTimerRef = useRef<number | null>(null);
  const loadRetryAttemptRef = useRef(0);
  const loadCanonicalRef = useRef<
    (options?: { applyDraft?: boolean; silent?: boolean; canonical?: boolean }) => Promise<unknown>
  >(() => Promise.resolve());
  const mountedRef = useRef(true);
  const sessionCountPulseTimerRef = useRef<number | null>(null);

  const setCanonical = useCallback((plan: FocusPlanRecord | null) => {
    canonicalPlanRef.current = plan;
    setCanonicalPlan(plan);
  }, []);

  const setSession = useCallback((session: FocusSessionRecord | null) => {
    currentSessionRef.current = session;
    setCurrentSession(session);
  }, []);

  const loadCanonical = useCallback(
    async (options: {
      applyDraft?: boolean;
      silent?: boolean;
      canonical?: boolean;
    } = {}) => {
      const generation = ++requestGenerationRef.current;
      const applyDraft = options.applyDraft !== false;
      if (!options.silent) setLoadState("loading");
      if (loadRetryTimerRef.current !== null) {
        window.clearTimeout(loadRetryTimerRef.current);
        loadRetryTimerRef.current = null;
      }
      try {
        const [currentState, plans] = await Promise.all([
          runtimeController.reconcile(),
          focusApi.listFocusPlans(1, {
            status: "ACTIVE",
            canonical: options.canonical,
          }),
        ]);
        const session = currentState.session;
        let plan = session
          ? plans.find((candidate) => candidate.id === session.planId) ?? null
          : currentOpenPlan(plans);
        if (session && !plan) {
          plan = await focusApi.getFocusPlan(session.planId, {
            canonical: options.canonical,
          });
        }

        if (!mountedRef.current || generation !== requestGenerationRef.current) {
          return { plan, session };
        }

        const previousPlan = canonicalPlanRef.current;
        if (previousPlan &&
            plan?.id === previousPlan.id &&
            plan.planVersion < previousPlan.planVersion) {
          plan = await focusApi.getFocusPlan(plan.id, { canonical: true });
        }
        if (!mountedRef.current || generation !== requestGenerationRef.current) {
          return { plan, session };
        }

        setSession(session);
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
        if (currentState.sessionAuthority === "CANONICAL") {
          loadRetryAttemptRef.current = 0;
          setLoadState("ready");
        } else {
          setLoadState(plan ? "ready" : "error");
          if (isRetryableFocusReadError(currentState.error)) {
            const delay = Math.min(
              30_000,
              750 * (2 ** Math.min(loadRetryAttemptRef.current, 6)),
            );
            loadRetryAttemptRef.current += 1;
            loadRetryTimerRef.current = window.setTimeout(() => {
              loadRetryTimerRef.current = null;
              void loadCanonicalRef.current({
                applyDraft: false,
                silent: true,
                canonical: options.canonical,
              }).catch(() => {});
            }, delay);
          }
        }
        return { plan, session };
      } catch (error) {
        if (mountedRef.current && generation === requestGenerationRef.current) {
          setLoadState("error");
          if (isRetryableFocusReadError(error) &&
              loadRetryTimerRef.current === null &&
              (typeof navigator === "undefined" || navigator.onLine)) {
            const delay = Math.min(
              30_000,
              750 * (2 ** Math.min(loadRetryAttemptRef.current, 6)),
            );
            loadRetryAttemptRef.current += 1;
            loadRetryTimerRef.current = window.setTimeout(() => {
              loadRetryTimerRef.current = null;
              void loadCanonicalRef.current({
                applyDraft: false,
                silent: true,
                canonical: options.canonical,
              }).catch(() => {});
            }, delay);
          }
        }
        throw error;
      }
    },
    [runtimeController, setCanonical, setSession],
  );
  loadCanonicalRef.current = loadCanonical;

  useEffect(() => {
    const lifecycle = controllerLifecycleRef.current;
    lifecycle.set(runtimeController, (lifecycle.get(runtimeController) ?? 0) + 1);
    const unsubscribe = runtimeController.subscribe((next) => {
      setRuntimeState(next);
      if (next.sessionAuthority !== null || next.runtimeStatus === "ERROR") {
        setSession(next.session);
      }
    });
    void runtimeController.initialize().catch(() => {});
    return () => {
      unsubscribe();
      const generation = (lifecycle.get(runtimeController) ?? 0) + 1;
      lifecycle.set(runtimeController, generation);
      queueMicrotask(() => {
        if (lifecycle.get(runtimeController) === generation) {
          runtimeController.dispose();
        }
      });
    };
  }, [runtimeController, setSession]);

  useEffect(() => {
    if (catalogStatus === "ready") {
      lectureRetryAttemptRef.current = 0;
      return;
    }
    if (catalogStatus !== "error") return;
    let active = true;
    let timer: number | null = null;
    const schedule = () => {
      if (!active || timer !== null ||
          (typeof navigator !== "undefined" && !navigator.onLine)) return;
      const delay = Math.min(
        30_000,
        750 * (2 ** Math.min(lectureRetryAttemptRef.current, 6)),
      );
      lectureRetryAttemptRef.current += 1;
      timer = window.setTimeout(async () => {
        timer = null;
        try {
          await refreshLecturesRef.current();
        } catch {
          // The catalog status will keep the Focus picker in its recoverable error state.
        }
        schedule();
      }, delay);
    };
    const onOnline = () => schedule();
    schedule();
    window.addEventListener("online", onOnline);
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [catalogStatus]);

  useEffect(() => {
    mountedRef.current = true;
    if (!sessionRouteId && !summaryRouteId && !historyOpen) {
      void loadCanonical().catch(() => {});
    }
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      if (loadRetryTimerRef.current !== null) {
        window.clearTimeout(loadRetryTimerRef.current);
        loadRetryTimerRef.current = null;
      }
    };
  }, [historyOpen, loadCanonical, sessionRouteId, summaryRouteId]);

  useEffect(() => {
    const refreshCanonical = () => {
      if (sessionRouteId || historyOpen || summaryRouteId) return;
      void loadCanonicalRef.current({
        applyDraft: false,
        silent: true,
        canonical: true,
      }).catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshCanonical();
    };
    window.addEventListener("focus-state-invalidated", refreshCanonical);
    window.addEventListener("online", refreshCanonical);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus-state-invalidated", refreshCanonical);
      window.removeEventListener("online", refreshCanonical);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [historyOpen, sessionRouteId, summaryRouteId]);

  useEffect(
    () => () => {
      if (sessionCountPulseTimerRef.current !== null) {
        window.clearTimeout(sessionCountPulseTimerRef.current);
      }
    },
    [],
  );

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
    runtimeState.sessionAuthority === "CANONICAL" &&
    !currentSession &&
    !serverConflict &&
    !saving &&
    !starting;
  const canStart =
    isValid &&
    loadState === "ready" &&
    runtimeState.sessionAuthority === "CANONICAL" &&
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

  const pulseSessionCountValue = (lectureId: string) => {
    setSessionCountPulse((previous) => ({
      lectureId,
      sequence: (previous?.sequence ?? 0) + 1,
    }));
    if (sessionCountPulseTimerRef.current !== null) {
      window.clearTimeout(sessionCountPulseTimerRef.current);
    }
    sessionCountPulseTimerRef.current = window.setTimeout(() => {
      setSessionCountPulse(null);
      sessionCountPulseTimerRef.current = null;
    }, 220);
  };

  const changeSessionCount = (lectureId: string, delta: number) => {
    pulseSessionCountValue(lectureId);
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
        const latest = await focusApi.getFocusPlan(currentPlan.id, { canonical: true });
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

      const latestOpenPlan = currentOpenPlan(await focusApi.listFocusPlans(1, {
        status: "ACTIVE",
        canonical: true,
      }));
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

      const firstPlanItem = [...plan.items].sort(
        (left, right) => left.sequence - right.sequence,
      )[0];
      if (!firstPlanItem) {
        showNotice("focusHubAddAtLeastOne", "error");
        return;
      }

      const result = await runtimeController.start({
        planId: plan.id,
        planItemId: firstPlanItem.id,
      });
      setSession(result.session);
      onOpenSession(result.session.id);
    } catch (error) {
      if (isConflictStatus(error) || getApiErrorCode(error) === "ACTIVE_SESSION_EXISTS") {
        try {
          const result = await loadCanonical({
            applyDraft: false,
            silent: true,
            canonical: true,
          });
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
      let current = runtimeController.getState();
      if (current.sessionAuthority !== "CANONICAL") {
        current = await runtimeController.reconcile();
      }
      if (current.sessionAuthority === "CANONICAL" && current.session) {
        setSession(current.session);
        onOpenSession(current.session.id);
        return;
      }
      const result = await runtimeController.start({
        planId,
        planItemId,
      });
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
        runtimeController={runtimeController}
        initialPlan={canonicalPlan}
        lectures={lectures}
        language={language}
        catalogStatus={catalogStatus}
        resourceHandoffEnabled={FOCUS_RESOURCE_HANDOFF_ENABLED}
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
      className="focus-hub-page focus-hub-current-root mx-auto flex w-full max-w-6xl flex-col px-4 pb-10 pt-2 sm:px-6 lg:px-8"
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

      {canonicalPlan && runtimeState.sessionAuthority !== "CANONICAL" && (
        <div
          role="status"
          className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950 dark:border-amber-300/15 dark:bg-amber-200/[0.06] dark:text-amber-100"
        >
          {t("focusHubReadOnlyStale")}
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
            </div>
          </div>
          {currentSession && (
            <section
              aria-labelledby="focus-current-session-title"
              className="focus-hub-current-session flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-emerald-200/80 bg-emerald-50/75 px-2 py-1.5 shadow-sm dark:border-emerald-300/15 dark:bg-emerald-300/[0.07] sm:max-w-[390px] sm:gap-2.5 sm:px-2.5"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white dark:bg-emerald-300 dark:text-emerald-950">
                <ShieldCheck className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="focus-current-session-title" className="truncate text-[11px] font-semibold leading-4 text-emerald-900 dark:text-emerald-100">
                  {t("focusHubCurrentSession")}
                </h2>
                <p className="truncate text-xs font-medium leading-4 text-slate-800 dark:text-slate-100" dir="auto">
                  {currentLectureTitle || t("focusHubCurrentSession")}
                </p>
                <p className="truncate text-[10px] leading-3 text-slate-600 dark:text-slate-300">
                  {t("focusHubSessionNumber")}{" "}
                  <bdi dir="ltr">{currentSession.sessionNumber}/{currentSession.plannedSessionCount}</bdi>
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
              </div>
              <button
                type="button"
                onClick={() => onOpenSession(currentSession.id)}
                className="flex min-h-10 shrink-0 items-center justify-center rounded-xl bg-emerald-700 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 dark:bg-emerald-300 dark:text-emerald-950 dark:hover:bg-emerald-200"
              >
                {t("focusHubResume")}
              </button>
            </section>
          )}
        </header>

        <div
          className="focus-hub-cycle focus-hub-presets order-2 flex min-w-0 items-center gap-2 overflow-x-auto rounded-full border p-1.5"
          role="group"
          aria-label={t("focusHubPresets")}
          style={{
            "--fh-preset-index": FOCUS_PRESETS.findIndex(
              (preset) => preset.id === draft.presetId,
            ),
          } as CSSProperties}
        >
          <span className="focus-hub-preset-indicator" aria-hidden="true" />
          {FOCUS_PRESETS.map((preset) => {
            const isSelected = draft.presetId === preset.id;
            const label = preset.id === "CUSTOM"
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
                className={`flex min-h-11 shrink-0 items-center justify-center rounded-full border px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-55 ${
                  isSelected
                    ? "border-[#3e7b98] bg-[#3e7b98] text-white shadow-sm shadow-sky-900/15 dark:border-sky-300 dark:bg-sky-300 dark:text-slate-950"
                    : "border-slate-200/80 bg-white/75 text-slate-700 hover:border-sky-300 hover:bg-sky-50/70 dark:border-white/10 dark:bg-white/[0.025] dark:text-slate-200 dark:hover:bg-white/[0.06]"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <section
          aria-label={t("focusHubTimerSessionLabel")}
          className="focus-hub-timer order-3 min-w-0 md:col-start-1 md:row-start-3"
        >
          <FocusTimerScene variant="planner" progress={1}>
            <time
              className="focus-timer-value"
              dir="ltr"
              aria-label={`${t("focusHubTimerSessionLabel")}: ${draft.studyMinutes}:00`}
            >
              <bdi>{String(Math.max(0, draft.studyMinutes)).padStart(2, "0")}:00</bdi>
            </time>
            <span className="focus-timer-caption">
              {t("focusHubTimerSessionLabel")}
            </span>
          </FocusTimerScene>
        </section>

        <div className="contents">
          <section
            aria-labelledby="focus-setup-title"
          className={`focus-hub-setup order-7 min-w-0 rounded-[24px] border border-sky-100 bg-white/95 p-5 shadow-[0_10px_30px_rgba(46,104,158,0.06)] dark:border-white/10 dark:bg-[#17191f] sm:p-6 md:col-start-1 md:row-start-6 ${
            draft.presetId === "CUSTOM" ? "" : "hidden"
          }`}
          >
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#e7f2f5] text-[#285a73] dark:bg-sky-300/10 dark:text-sky-200">
                <Clock3 className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 id="focus-setup-title" className="font-semibold text-slate-950 dark:text-white">
                  {t("focusHubSetup")}
                </h2>
              </div>
            </div>

            {draft.presetId === "CUSTOM" && (
              <div className="mt-1 grid gap-3 rounded-2xl bg-slate-50/80 p-4 dark:bg-white/[0.035] sm:grid-cols-2">
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
              <ol
                className="focus-hub-queue-list space-y-2"
              >
                {draft.items.map((item, index) => {
                  const lecture = lectureMap.get(item.lectureId);
                  const itemEstimate = estimate.items[index];
                  const isHighlighted = highlightedLectureId === item.lectureId;
                  const sessionCountPulseClass =
                    sessionCountPulse?.lectureId === item.lectureId
                      ? `focus-hub-session-count-value-pulse-${sessionCountPulse.sequence % 2 === 0 ? "b" : "a"}`
                      : "";
                  return (
                    <li
                      key={item.lectureId}
                      id={`focus-queue-item-${item.lectureId}`}
                      className={`focus-hub-queue-item rounded-2xl border p-3 transition-colors ${
                        isHighlighted
                          ? "border-sky-400 bg-sky-50/80 dark:border-sky-300/40 dark:bg-sky-300/[0.07]"
                          : "border-slate-200/90 bg-white dark:border-white/10 dark:bg-white/[0.02]"
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
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

                      <div className="focus-hub-session-count mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 dark:border-white/[0.07]">
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          {t("focusHubSessionCount")}
                        </span>
                        <div className="flex min-h-11 shrink-0 items-center gap-1.5">
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
                              pulseSessionCountValue(item.lectureId);
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
                            className={`focus-hub-session-count-value h-11 w-[68px] min-w-[68px] shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-1 text-center text-sm font-semibold tabular-nums text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-500/15 disabled:opacity-55 dark:border-white/10 dark:bg-white/[0.04] dark:text-white ${sessionCountPulseClass}`}
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
          <div className="focus-hub-action-row">
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
            <button
              type="button"
              onClick={onOpenHistory}
              aria-label={t("focusHubHistory")}
              className="focus-hub-history-button inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-sky-200 dark:hover:bg-white/[0.06]"
            >
              <svg
                className="focus-hub-history-icon size-4 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M8 5a8.1 8.1 0 1 1-4 5" />
                <path d="M4 5.5V10h4.5" />
                <circle cx="12" cy="12" r="2.3" />
                <circle cx="12" cy="12" r="0.65" fill="currentColor" stroke="none" />
              </svg>
              <span className="focus-hub-history-label">{t("focusHubHistory")}</span>
            </button>
          </div>
          {!currentSession && !draft.items.length && (
            <p className="focus-hub-no-queue-hint mt-2 text-center text-xs text-slate-500 dark:text-slate-400">
              {t("focusHubAddAtLeastOne")}
            </p>
          )}
        </section>
        </div>

        <aside className="contents">
          <section
            aria-labelledby="focus-plan-summary-title"
            className="focus-hub-summary order-4 min-w-0 rounded-[24px] border border-sky-100 bg-white/95 p-5 shadow-[0_12px_36px_rgba(46,104,158,0.08)] dark:border-white/10 dark:bg-[#17191f] sm:p-6 md:col-start-1 md:row-start-4"
          >
            <div className="focus-hub-summary-header flex items-center gap-2.5">
              <span className="focus-hub-summary-heading-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
                <BarChart3 className="h-[18px] w-[18px]" aria-hidden="true" />
              </span>
              <h2 id="focus-plan-summary-title" className="text-base font-semibold tracking-tight text-slate-950 dark:text-white">
                {t("focusHubTodayPlan")}
              </h2>
            </div>

            <div className="focus-plan-metrics mt-5 grid grid-cols-2 gap-2 lg:grid-cols-5">
              <SummaryMetric
                label={t("focusHubLectureCount")}
                value={estimate.lectureCount}
                language={language}
                icon={<BookOpen className="h-[17px] w-[17px]" />}
                iconToneClass="focus-plan-metric-icon-blue"
              />
              <SummaryMetric
                label={t("focusHubSessionCount")}
                value={estimate.sessionCount}
                language={language}
                icon={<List className="h-[17px] w-[17px]" />}
                iconToneClass="focus-plan-metric-icon-indigo"
              />
              <SummaryMetric
                label={t("focusHubStudyTotal")}
                value={formatMinutes(estimate.studyMinutes)}
                icon={<Clock3 className="h-[17px] w-[17px]" />}
                iconToneClass="focus-plan-metric-icon-cyan"
              />
              <SummaryMetric
                label={t("focusHubBreakTotal")}
                value={formatMinutes(estimate.breakMinutes)}
                icon={<Coffee className="h-[17px] w-[17px]" />}
                iconToneClass="focus-plan-metric-icon-slate"
              />
              <SummaryMetric
                label={t("focusHubTotalTime")}
                value={formatMinutes(estimate.totalMinutes)}
                icon={<CalendarDays className="h-[17px] w-[17px]" />}
                iconToneClass="focus-plan-metric-icon-violet"
                description={t("focusHubNoFinalBreak")}
                metricClassName="focus-plan-metric-total col-span-2 lg:col-span-1"
              />
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

        </aside>
        <aside className="focus-hub-supporting">
          <div className="focus-hub-support-grid">
          {FOCUS_AUDIO_ENABLED && (
            <div className="focus-hub-audio order-8 min-w-0 md:col-start-2 md:row-start-4">
              <FocusAudioPlanningCard language={language} plannerPresentation />
            </div>
          )}
          </div>
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
      />
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  language,
  icon,
  iconToneClass,
  description,
  metricClassName = "",
}: {
  label: string;
  value: ReactNode;
  language?: Language;
  icon: ReactNode;
  iconToneClass: string;
  description?: string;
  metricClassName?: string;
}) {
  return (
    <div
      dir={language === "ar" ? "rtl" : "ltr"}
      className={`focus-plan-metric min-h-[64px] min-w-0 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-3 dark:border-white/[0.07] dark:bg-white/[0.025] ${metricClassName}`}
    >
      <div className="focus-plan-metric-copy min-w-0">
        <p className="focus-plan-metric-label text-[11px] font-medium leading-4 text-slate-500 dark:text-slate-400">
          {label}
        </p>
        <p
          className="focus-plan-metric-value mt-1 text-sm font-semibold tabular-nums text-slate-900 dark:text-white"
          aria-describedby={description ? "focus-plan-no-final-break" : undefined}
        >
          {typeof value === "number" ? <bdi dir="ltr">{new Intl.NumberFormat(language).format(value)}</bdi> : value}
        </p>
        {description && (
          <span id="focus-plan-no-final-break" className="sr-only">
            {description}
          </span>
        )}
      </div>
      <span className={`focus-plan-metric-icon shrink-0 ${iconToneClass}`} aria-hidden="true">
        {icon}
      </span>
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
      <div className="focus-hub-duration-control mt-2 flex items-center gap-2">
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