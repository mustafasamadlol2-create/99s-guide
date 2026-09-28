import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  FileText,
  Pause,
  Play,
  RefreshCw,
  Video,
  WifiOff,
} from "lucide-react";
import type {
  FocusPlanDto,
  PostFocusActionContext,
  FocusSessionDto,
  FocusSessionMutationResult,
} from "../../../../server/features/focus/types";
import type { DatabaseLecture, Material } from "../../../core/types";
import { getApiBaseUrl } from "../../../core/api/api";
import { apiClient } from "../../../core/api/apiClient";
import { NativeBridge } from "../../../core/device/capacitor/nativeBridge";
import { useTranslation, type Language } from "../../../core/i18n/translations";
import { FOCUS_AUDIO_ENABLED } from "../../../config/featureFlags";
import { FocusAudioPlanningCard } from "./FocusAudioPlanningCard";
import { FocusQuickNotesPanel, type FocusQuickNotesPanelHandle } from "./FocusQuickNotesPanel";
import { FocusRuntimeController } from "../runtime/controller";
import type { FocusRuntimeState } from "../runtime/types";
import { focusApi } from "../api/focusApi";
import { deriveFocusProgression, formatFocusClock } from "../focusActiveModel";
import { useFocusAudio } from "../../focus-audio/hooks";
import type { FocusAudioContextValue } from "../../focus-audio/provider";

const ACTIVE_FOCUS_COPY_KEYS = [
  "focusActiveAbandonedBody",
  "focusActiveAbandonedTitle",
  "focusActiveActionError",
  "focusActiveAudioTitle",
  "focusActiveBreakBody",
  "focusActiveBreakPhase",
  "focusActiveBreakTitle",
  "focusActiveCatalogError",
  "focusActiveCancel",
  "focusActiveChecking",
  "focusActiveCheckReady",
  "focusActiveComplete",
  "focusActiveCompletedBody",
  "focusActiveCompletedTitle",
  "focusActiveCurrentLecture",
  "focusActiveEnd",
  "focusActiveEndBody",
  "focusActiveEndConfirm",
  "focusActiveEndTitle",
  "focusActiveExit",
  "focusActiveExitBody",
  "focusActiveExitTitle",
  "focusActiveExpiredBody",
  "focusActiveExpiredTitle",
  "focusActiveInterruptionBody",
  "focusActiveInterruptionDismiss",
  "focusActiveInterruptionError",
  "focusActiveInterruptionRecord",
  "focusActiveInterruptionTitle",
  "focusActiveLeave",
  "focusActiveLoading",
  "focusActiveManualLecture",
  "focusActiveNoResources",
  "focusActiveNotesError",
  "focusActiveNextReady",
  "focusActiveNotCurrentBody",
  "focusActiveNotCurrentTitle",
  "focusActiveOffline",
  "focusActiveOpenCurrent",
  "focusActiveOpeningResource",
  "focusActiveOpenPdf",
  "focusActiveOpenVideo",
  "focusActivePause",
  "focusActivePlanPosition",
  "focusActivePlanUnavailable",
  "focusActiveQueue",
  "focusActiveReconciliationBody",
  "focusActiveReconciliationTitle",
  "focusActiveResourceError",
  "focusActiveResourceTitle",
  "focusActiveResume",
  "focusActiveRetry",
  "focusActiveReturn",
  "focusActiveReturnToFocus",
  "focusActiveRound",
  "focusActiveSessionOutOfDate",
  "focusActiveStartNext",
  "focusActiveStatusActive",
  "focusActiveStatusLabel",
  "focusActiveStatusOffline",
  "focusActiveStatusPaused",
  "focusActiveStatusReconciliation",
  "focusActiveStatusResource",
  "focusActiveStay",
  "focusActiveStudyPhase",
  "focusActiveSubtitle",
  "focusActiveTimerLabel",
  "focusActiveTitle",
  "focusActiveUpcoming",
] as const;

type ActiveFocusCopyKey = (typeof ACTIVE_FOCUS_COPY_KEYS)[number];

function useActiveFocusCopy(language: Language) {
  const { t: translate } = useTranslation(language);
  return useMemo(
    () => Object.fromEntries(
      ACTIVE_FOCUS_COPY_KEYS.map((key) => [key, translate(key)]),
    ) as Record<ActiveFocusCopyKey, string>,
    [translate],
  );
}

type ActiveFocusCopy = ReturnType<typeof useActiveFocusCopy>;

interface ActiveFocusScreenProps {
  sessionRouteId: string;
  lectures: DatabaseLecture[];
  language: Language;
  catalogStatus: "loading" | "ready" | "error";
  onRefreshLectures: () => Promise<void>;
  onReturnToPlanner: () => void;
  onOpenSession: (sessionId: string) => void;
}

type FocusPlanLoad =
  | { status: "idle" | "loading" }
  | { status: "ready"; plan: FocusPlanDto }
  | { status: "error" };

interface LocalBreak {
  nextItemId: string;
  endsAtMonotonic: number;
}

function initialRuntimeState(): FocusRuntimeState {
  return {
    runtimeStatus: "IDLE",
    session: null,
    sessionAuthority: null,
    lastMutationResult: null,
    displayRemainingSeconds: null,
    displayMayBeComplete: false,
    estimatedServerNow: null,
    completionEligible: null,
    pendingOperation: null,
    semanticResult: null,
    error: null,
    lastSyncedAt: null,
    potentialInterruption: null,
  };
}

function sameActiveScreenState(previous: FocusRuntimeState, next: FocusRuntimeState): boolean {
  return previous.runtimeStatus === next.runtimeStatus &&
    JSON.stringify(previous.session) === JSON.stringify(next.session) &&
    previous.sessionAuthority === next.sessionAuthority &&
    JSON.stringify(previous.lastMutationResult) === JSON.stringify(next.lastMutationResult) &&
    previous.displayMayBeComplete === next.displayMayBeComplete &&
    previous.completionEligible === next.completionEligible &&
    JSON.stringify(previous.pendingOperation) === JSON.stringify(next.pendingOperation) &&
    JSON.stringify(previous.semanticResult) === JSON.stringify(next.semanticResult) &&
    JSON.stringify(previous.error) === JSON.stringify(next.error) &&
    JSON.stringify(previous.potentialInterruption) === JSON.stringify(next.potentialInterruption);
}

function materialKind(material: Material): "PDF" | "VIDEO" | null {
  const normalized = material.type.trim().toUpperCase();
  return normalized === "PDF" || normalized === "VIDEO" ? normalized : null;
}

function isTrustedExternalUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.origin !== window.location.origin) return null;
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url;
  } catch {
    return null;
  }
}

function notifyAudioSafely(notify: (() => unknown) | undefined) {
  if (!notify) return;
  try {
    const result = notify();
    if (result && typeof (result as PromiseLike<unknown>).then === "function") {
      void Promise.resolve(result).catch(() => {});
    }
  } catch {
    // Local audio failures must never alter canonical Focus actions.
  }
}

function ActiveFocusScreenWithAudio(props: ActiveFocusScreenProps) {
  const audio = useFocusAudio();
  return <ActiveFocusScreenCore {...props} audio={audio} />;
}

export function ActiveFocusScreen(props: ActiveFocusScreenProps) {
  return FOCUS_AUDIO_ENABLED
    ? <ActiveFocusScreenWithAudio {...props} />
    : <ActiveFocusScreenCore {...props} audio={null} />;
}

function ActiveFocusScreenCore({
  sessionRouteId,
  lectures,
  language,
  catalogStatus,
  onRefreshLectures,
  onReturnToPlanner,
  onOpenSession,
  audio,
}: ActiveFocusScreenProps & { audio: FocusAudioContextValue | null }) {
  const t = useActiveFocusCopy(language);
  const [controller, setController] = useState<FocusRuntimeController | null>(null);
  const [runtime, setRuntime] = useState<FocusRuntimeState>(initialRuntimeState);
  const [planLoad, setPlanLoad] = useState<FocusPlanLoad>({ status: "idle" });
  const [completedRoute, setCompletedRoute] = useState<
    | { status: "idle" | "loading" | "unavailable" }
    | { status: "completed"; context: PostFocusActionContext }
  >({ status: "idle" });
  const [terminalResult, setTerminalResult] = useState<FocusSessionMutationResult | null>(null);
  const [progression, setProgression] = useState<ReturnType<typeof deriveFocusProgression> | null>(null);
  const [localBreak, setLocalBreak] = useState<LocalBreak | null>(null);
  const [breakFinished, setBreakFinished] = useState(false);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resourceError, setResourceError] = useState(false);
  const [openingResourceId, setOpeningResourceId] = useState<string | null>(null);
  const [confirmType, setConfirmType] = useState<"end" | "exit" | null>(null);
  const [dismissedInterruption, setDismissedInterruption] = useState<string | null>(null);
  const [interruptionPending, setInterruptionPending] = useState(false);
  const notesRef = useRef<FocusQuickNotesPanelHandle>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const dialogCancelRef = useRef<HTMLButtonElement>(null);
  const dialogTriggerRef = useRef<HTMLElement | null>(null);
  const completionSyncSessionRef = useRef<string | null>(null);
  const audioStartedSessionRef = useRef<string | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const runtimeController = new FocusRuntimeController();
    setController(runtimeController);
    const unsubscribe = runtimeController.subscribe((next) => {
      setRuntime((previous) =>
        sameActiveScreenState(previous, next) ? previous : next);
    });
    void runtimeController.initialize().catch(() => {});

    return () => {
      unsubscribe();
      runtimeController.dispose();
    };
  }, []);

  useEffect(() => {
    if (!controller || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("focus-session-state");
    channelRef.current = channel;
    channel.onmessage = () => {
      void controller.reconcile().catch(() => {});
    };
    return () => {
      channel.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [controller]);

  useEffect(() => {
    if (
      runtime.sessionAuthority !== "CANONICAL" ||
      runtime.session?.id ||
      terminalResult?.session.id === sessionRouteId
    ) return;

    let active = true;
    setCompletedRoute({ status: "loading" });
    void focusApi.getPostFocusActionContext(sessionRouteId)
      .then((context) => {
        if (active) setCompletedRoute({ status: "completed", context });
      })
      .catch(() => {
        if (active) setCompletedRoute({ status: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, [
    runtime.session?.id,
    runtime.sessionAuthority,
    sessionRouteId,
    terminalResult?.session.id,
  ]);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  const canonicalSession = runtime.session;
  const canonicalRouteMatch = Boolean(
    canonicalSession &&
    canonicalSession.id === sessionRouteId &&
    runtime.sessionAuthority === "CANONICAL",
  );

  useEffect(() => {
    if (
      !audio ||
      !canonicalRouteMatch ||
      !canonicalSession ||
      canonicalSession.status !== "ACTIVE" ||
      audioStartedSessionRef.current === canonicalSession.id
    ) return;
    audioStartedSessionRef.current = canonicalSession.id;
    notifyAudioSafely(() => audio.onFocusStarted());
  }, [audio, canonicalRouteMatch, canonicalSession?.id, canonicalSession?.status]);
  const currentPlan = planLoad.status === "ready" ? planLoad.plan : null;
  const lecture = useMemo(
    () => canonicalSession
      ? lectures.find((item) => item.id === canonicalSession.lectureId) ?? null
      : null,
    [canonicalSession, lectures],
  );
  const planItems = currentPlan?.items ?? [];
  const currentPlanItemId = canonicalSession?.planItemId ??
    terminalResult?.session.planItemId ??
    null;
  const currentPlanIndex = planItems.findIndex((item) => item.id === currentPlanItemId);
  const isRuntimeBusy = runtime.runtimeStatus === "MUTATING" ||
    runtime.runtimeStatus === "RECONCILING" ||
    runtime.runtimeStatus === "LOADING" ||
    actionPending;
  const mayChangeSession = Boolean(
    controller &&
    canonicalRouteMatch &&
    online &&
    runtime.runtimeStatus !== "OFFLINE_STALE" &&
    runtime.runtimeStatus !== "RECONCILIATION_REQUIRED" &&
    runtime.session?.status !== "RECONCILIATION_REQUIRED" &&
    !isRuntimeBusy,
  );
  useEffect(() => {
    if (!canonicalSession) return;
    setPlanLoad({ status: "loading" });
    let active = true;
    void focusApi.getFocusPlan(canonicalSession.planId).then((plan) => {
      if (active) setPlanLoad({ status: "ready", plan });
    }).catch(() => {
      if (active) setPlanLoad({ status: "error" });
    });
    return () => {
      active = false;
    };
  }, [canonicalSession?.id, canonicalSession?.planId]);

  useEffect(() => {
    if (
      !controller ||
      !canonicalSession ||
      !canonicalRouteMatch ||
      !runtime.displayMayBeComplete ||
      completionSyncSessionRef.current === canonicalSession.id
    ) return;
    completionSyncSessionRef.current = canonicalSession.id;
    void controller.reconcile().catch(() => {});
  }, [
    canonicalRouteMatch,
    canonicalSession,
    controller,
    runtime.displayMayBeComplete,
  ]);

  useEffect(() => {
    if (!localBreak) return;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      if (timeout !== null) {
        clearTimeout(timeout);
        timeout = null;
      }
      const remainingMs = localBreak.endsAtMonotonic - performance.now();
      if (remainingMs <= 0) {
        setBreakFinished(true);
        return;
      }
      timeout = setTimeout(check, remainingMs);
    };
    check();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("pageshow", check);
    return () => {
      if (timeout !== null) clearTimeout(timeout);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("pageshow", check);
    };
  }, [localBreak]);

  const breakTimerFinished = useCallback(() => {
    setBreakFinished(true);
  }, []);

  const breakTimer = localBreak
    ? (
      <FocusBreakTimer
        endsAtMonotonic={localBreak.endsAtMonotonic}
        label={t.focusActiveBreakPhase}
        onFinished={breakTimerFinished}
      />
    )
    : null;

  useEffect(() => {
    if (!confirmType) return;
    dialogTriggerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    dialogCancelRef.current?.focus();

    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setConfirmType(null);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const buttons = Array.from(
        dialogRef.current.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
      );
      if (buttons.length === 0) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeys);
    return () => {
      document.removeEventListener("keydown", handleKeys);
      dialogTriggerRef.current?.focus();
    };
  }, [confirmType]);

  const notifyOtherTabs = () => {
    channelRef.current?.postMessage({ type: "focus-state-changed" });
  };

  const perform = async (
    action: () => Promise<unknown>,
    onSuccess?: (result: unknown) => void | Promise<void>,
  ) => {
    setActionError(null);
    setActionPending(true);
    try {
      const result = await action();
      await onSuccess?.(result);
      notifyOtherTabs();
    } catch {
      setActionError(t.focusActiveActionError);
    } finally {
      setActionPending(false);
    }
  };

  const handlePause = () => {
    if (!controller || !mayChangeSession) return;
    void perform(
      () => controller.pause(),
      () => notifyAudioSafely(() => audio?.onFocusPaused()),
    );
  };

  const handleResume = () => {
    if (!controller || !mayChangeSession) return;
    void perform(
      () => controller.resume(),
      () => notifyAudioSafely(() => audio?.onFocusResumed()),
    );
  };

  const handleComplete = () => {
    if (!controller || !mayChangeSession || runtime.completionEligible !== true) return;
    void perform(
      async () => {
        await notesRef.current?.flush();
        return controller.complete();
      },
      async (value) => {
        const result = value as FocusSessionMutationResult;
        setTerminalResult(result);
        const progressionResult = currentPlan
          ? deriveFocusProgression(currentPlan.items, result.session)
          : { kind: "unavailable" as const };
        setProgression(progressionResult);
        setBreakFinished(false);
        if (progressionResult.kind === "next") {
          setLocalBreak({
            nextItemId: progressionResult.nextItem.id,
            endsAtMonotonic: performance.now() +
              progressionResult.breakDurationSeconds * 1_000,
          });
        } else {
          setLocalBreak(null);
        }
        notifyAudioSafely(() => audio?.onFocusCompleted());
      },
    );
  };

  const handleAbandon = () => {
    if (!controller || !mayChangeSession) return;
    setConfirmType(null);
    void perform(
      async () => {
        await notesRef.current?.flush();
        return controller.abandon();
      },
      async (value) => {
        setTerminalResult(value as FocusSessionMutationResult);
        setProgression(null);
        setLocalBreak(null);
        notifyAudioSafely(() => audio?.onFocusAbandoned());
      },
    );
  };

  const handleStartNext = () => {
    if (!controller || !terminalResult || progression?.kind !== "next" || !online || isRuntimeBusy) return;
    const nextItem = progression.nextItem;
    void perform(
      async () => {
        await notesRef.current?.flush();
        return controller.start({
          planId: terminalResult.session.planId,
          planItemId: nextItem.id,
        });
      },
      async (value) => {
        const result = value as FocusSessionMutationResult;
        setTerminalResult(null);
        setProgression(null);
        setLocalBreak(null);
        setBreakFinished(false);
        notifyAudioSafely(() => audio?.onFocusStarted());
        onOpenSession(result.session.id);
      },
    );
  };

  const handleRecordInterruption = () => {
    if (
      !controller ||
      !online ||
      interruptionPending ||
      !mayChangeSession ||
      canonicalSession?.status !== "ACTIVE"
    ) return;
    setInterruptionPending(true);
    void controller.recordInterruption().then(() => {
      setActionError(null);
      notifyOtherTabs();
    }).catch(() => {
      setActionError(t.focusActiveInterruptionError);
    }).finally(() => {
      setInterruptionPending(false);
    });
  };

  const leaveForPlanner = async () => {
    await notesRef.current?.flush();
    setConfirmType(null);
    onReturnToPlanner();
  };

  const openPdf = async (material: Material) => {
    if (!controller || !mayChangeSession) return;
    await notesRef.current?.flush();
    const popup = NativeBridge.isNativePlatform()
      ? null
      : window.open("about:blank", "_blank");
    if (!NativeBridge.isNativePlatform() && !popup) {
      setResourceError(true);
      return;
    }
    setOpeningResourceId(material.id);
    setResourceError(false);
    try {
      await controller.openResourceWithHandoff(
        { resourceType: "PDF", resourceId: material.id },
        async () => {
          const response = await apiClient(
            `/api/materials/pdf/${encodeURIComponent(material.id)}/external-url`,
            {
              silent: true,
              retries: 1,
              retryDelayMs: 250,
              timeoutMs: 8_000,
              requestKey: `focus-pdf:${sessionRouteId}:${material.id}`,
            },
          );
          if (!response.ok) throw new Error("PDF resolver request failed.");
          const data = await response.json() as { url?: unknown };
          if (typeof data.url !== "string" || !data.url) {
            throw new Error("PDF resolver returned no URL.");
          }
          const resolvedUrl = data.url.startsWith("/")
            ? `${getApiBaseUrl() || window.location.origin}${data.url}`
            : data.url;
          const parsedUrl = new URL(resolvedUrl);
          if (
            (parsedUrl.protocol !== "https:" && parsedUrl.origin !== window.location.origin) ||
            (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:")
          ) {
            throw new Error("PDF resolver returned an unsafe URL.");
          }
          await NativeBridge.openPdfUrl(parsedUrl.toString(), popup ?? undefined);
        },
      );
      notifyOtherTabs();
    } catch {
      popup?.close();
      setResourceError(true);
      await controller.reconcile().catch(() => {});
    } finally {
      setOpeningResourceId(null);
    }
  };

  const openVideo = async (material: Material) => {
    if (!controller || !mayChangeSession) return;
    await notesRef.current?.flush();
    const parsed = isTrustedExternalUrl(material.fileUrlOrLink);
    if (!parsed) {
      setResourceError(true);
      return;
    }
    const popup = NativeBridge.isNativePlatform()
      ? null
      : window.open("about:blank", "_blank");
    if (!NativeBridge.isNativePlatform() && !popup) {
      setResourceError(true);
      return;
    }
    setOpeningResourceId(material.id);
    setResourceError(false);
    try {
      await controller.openResourceWithHandoff(
        { resourceType: "VIDEO", resourceId: material.id },
        async () => {
          const host = parsed.hostname.toLowerCase();
          const isYouTube = host === "youtube.com" ||
            host === "www.youtube.com" ||
            host === "m.youtube.com" ||
            host === "youtu.be";
          if (NativeBridge.isNativePlatform() && isYouTube) {
            await NativeBridge.openYouTubeUrl(parsed.toString());
          } else if (NativeBridge.isNativePlatform()) {
            await NativeBridge.openUrl(parsed.toString());
          } else if (popup) {
            popup.opener = null;
            popup.location.replace(parsed.toString());
          }
        },
      );
      notifyOtherTabs();
    } catch {
      popup?.close();
      setResourceError(true);
      await controller.reconcile().catch(() => {});
    } finally {
      setOpeningResourceId(null);
    }
  };

  const materials = useMemo(
    () => lecture?.materials?.filter((material) => materialKind(material) !== null) ?? [],
    [lecture],
  );
  const interruption = runtime.potentialInterruption;
  const showInterruption = Boolean(
    interruption &&
    interruption.sessionId === canonicalSession?.id &&
    dismissedInterruption !== interruption.detectedAt,
  );
  const phase = localBreak ? "BREAK" : "STUDY";

  if (!controller || runtime.runtimeStatus === "LOADING" && !runtime.sessionAuthority) {
    return (
      <div dir={language === "ar" ? "rtl" : "ltr"} className="mx-auto min-h-[70vh] max-w-6xl p-4 sm:p-6">
        <div className="mb-5 h-10 w-40 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" aria-hidden="true" />
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(280px,0.75fr)]">
          <div className="h-[330px] animate-pulse rounded-3xl bg-muted motion-reduce:animate-none" aria-hidden="true" />
          <div className="space-y-4">
            <div className="h-36 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" aria-hidden="true" />
            <div className="h-44 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" aria-hidden="true" />
          </div>
        </div>
        <p className="sr-only" role="status">{t.focusActiveLoading}</p>
      </div>
    );
  }

  const localTerminalResult = terminalResult ??
    (runtime.lastMutationResult?.session.id === sessionRouteId
      ? runtime.lastMutationResult
      : null);

  if (
    runtime.runtimeStatus === "ERROR" &&
    runtime.sessionAuthority === null
  ) {
    const forbiddenOrMissing = runtime.error?.status === 403 || runtime.error?.status === 404;
    return (
      <div dir={language === "ar" ? "rtl" : "ltr"} className="mx-auto flex min-h-[70vh] max-w-3xl items-center px-4 py-10">
        <section className="w-full rounded-3xl border border-border bg-card p-6 text-center shadow-sm sm:p-10">
          <CircleAlert className="mx-auto size-10 text-muted-foreground" aria-hidden="true" />
          <h1 className="mt-4 text-xl font-semibold text-foreground">
            {forbiddenOrMissing ? t.focusActiveNotCurrentTitle : t.focusActiveTitle}
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            {forbiddenOrMissing ? t.focusActiveNotCurrentBody : t.focusActiveActionError}
          </p>
          {!forbiddenOrMissing && (
            <button
              type="button"
              onClick={() => void controller.reconcile()}
              className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              {t.focusActiveRetry}
            </button>
          )}
          <button
            type="button"
            onClick={() => void leaveForPlanner()}
            className="mt-6 min-h-11 rounded-xl border border-border px-4 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t.focusActiveReturn}
          </button>
        </section>
      </div>
    );
  }

  if (
    canonicalSession &&
    canonicalSession.id !== sessionRouteId &&
    runtime.sessionAuthority === "CANONICAL"
  ) {
    return (
      <div dir={language === "ar" ? "rtl" : "ltr"} className="mx-auto flex min-h-[70vh] max-w-3xl items-center px-4 py-10">
        <section className="w-full rounded-3xl border border-border bg-card p-6 text-center shadow-sm sm:p-10">
          <CircleAlert className="mx-auto size-10 text-amber-500" aria-hidden="true" />
          <h1 className="mt-4 text-xl font-semibold text-foreground">{t.focusActiveNotCurrentTitle}</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">{t.focusActiveSessionOutOfDate}</p>
          <button
            type="button"
            onClick={() => onOpenSession(canonicalSession.id)}
            className="mt-6 min-h-11 rounded-xl bg-primary px-4 font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t.focusActiveOpenCurrent}
          </button>
        </section>
      </div>
    );
  }

  if (localBreak && localTerminalResult?.session.status === "COMPLETED") {
    const nextItem = planItems.find((item) => item.id === localBreak.nextItemId);
    const isBreakFinished = breakFinished;
    return (
      <div dir={language === "ar" ? "rtl" : "ltr"} className="mx-auto min-h-screen max-w-6xl px-4 pb-8 pt-4 sm:px-6 sm:pt-6">
        <header className="mb-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setConfirmType("exit")}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            {t.focusActiveExit}
          </button>
          <span className="text-sm font-semibold text-muted-foreground">{t.focusActiveTitle}</span>
        </header>

        <main className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
          <section className="flex min-h-[390px] flex-col items-center justify-center rounded-3xl border border-emerald-500/20 bg-emerald-50 p-6 text-center dark:bg-emerald-950/20 sm:min-h-[460px]">
            <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
              {t.focusActiveBreakPhase}
            </span>
            <h1 className="mt-5 text-2xl font-bold text-foreground">{t.focusActiveBreakTitle}</h1>
            <p className="mt-2 max-w-lg text-sm text-muted-foreground">
              {isBreakFinished ? t.focusActiveNextReady : t.focusActiveBreakBody}
            </p>
            <div className="my-7 text-emerald-800 dark:text-emerald-200">{breakTimer}</div>
            <button
              type="button"
              disabled={!isBreakFinished || !online || isRuntimeBusy || !nextItem}
              onClick={handleStartNext}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground shadow-sm transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play className="size-4" aria-hidden="true" />
              {isRuntimeBusy ? t.focusActiveChecking : t.focusActiveStartNext}
            </button>
            {nextItem && (
              <p className="mt-4 text-sm text-muted-foreground">
                {t.focusActiveUpcoming}:{" "}
                {lectures.find((item) => item.id === nextItem.lectureId)?.name ?? t.focusActiveCurrentLecture}
              </p>
            )}
            {localTerminalResult.manualLectureCompletionRequired && (
              <p className="mt-4 max-w-lg text-xs text-muted-foreground">
                {t.focusActiveManualLecture}
              </p>
            )}
            {actionError && <p className="mt-3 text-sm text-destructive" role="alert">{actionError}</p>}
            {!online && <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">{t.focusActiveOffline}</p>}
          </section>

          <div className="space-y-4">
            <SessionSummary
              session={localTerminalResult.session}
              lecture={lectures.find((item) => item.id === localTerminalResult.session.lectureId) ?? null}
              itemPosition={currentPlanIndex >= 0 ? currentPlanIndex + 1 : null}
              itemCount={planItems.length}
              t={t}
            />
            {currentPlan && (
              <QueuePreview
                items={planItems}
                currentItemId={localBreak.nextItemId}
                lectures={lectures}
                t={t}
              />
            )}
            <FocusQuickNotesPanel
              ref={notesRef}
              sessionId={localTerminalResult.session.id}
              language={language}
              online={online}
            />
          </div>
        </main>
        {confirmType && (
          <ConfirmationDialog
            type={confirmType}
            t={t}
            dialogRef={dialogRef}
            cancelRef={dialogCancelRef}
            onCancel={() => setConfirmType(null)}
            onConfirm={() => void leaveForPlanner()}
          />
        )}
      </div>
    );
  }

  if (localTerminalResult?.session.status === "COMPLETED" && !localBreak) {
    return (
      <TerminalHandoff
        language={language}
        title={t.focusActiveCompletedTitle}
        body={t.focusActiveCompletedBody}
        manualLectureCompletionRequired={localTerminalResult.manualLectureCompletionRequired}
        onReturn={() => void leaveForPlanner()}
      >
        <FocusQuickNotesPanel
          ref={notesRef}
          sessionId={localTerminalResult.session.id}
          language={language}
          online={online}
        />
      </TerminalHandoff>
    );
  }

  if (localTerminalResult?.session.status === "ABANDONED") {
    return (
      <TerminalHandoff
        language={language}
        title={t.focusActiveAbandonedTitle}
        body={t.focusActiveAbandonedBody}
        onReturn={() => void leaveForPlanner()}
      >
        <FocusQuickNotesPanel
          ref={notesRef}
          sessionId={localTerminalResult.session.id}
          language={language}
          online={online}
        />
      </TerminalHandoff>
    );
  }

  if (!canonicalSession || canonicalSession.id !== sessionRouteId) {
    if (completedRoute.status === "loading" || completedRoute.status === "idle") {
      return (
        <div dir={language === "ar" ? "rtl" : "ltr"} className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center px-4 py-10">
          <p className="text-sm text-muted-foreground" role="status">{t.focusActiveChecking}</p>
        </div>
      );
    }
    if (completedRoute.status === "completed") {
      return (
        <TerminalHandoff
          language={language}
          title={t.focusActiveCompletedTitle}
          body={t.focusActiveCompletedBody}
          manualLectureCompletionRequired={completedRoute.context.manualLectureCompletionRequired}
          onReturn={() => void leaveForPlanner()}
        >
          <FocusQuickNotesPanel
            ref={notesRef}
            sessionId={completedRoute.context.sessionId}
            language={language}
            online={online}
          />
        </TerminalHandoff>
      );
    }
    return (
      <TerminalHandoff
        language={language}
        title={t.focusActiveNotCurrentTitle}
        body={t.focusActiveNotCurrentBody}
        onReturn={() => void leaveForPlanner()}
      />
    );
  }

  const isReconciliationRequired =
    runtime.runtimeStatus === "RECONCILIATION_REQUIRED" ||
    canonicalSession.status === "RECONCILIATION_REQUIRED" ||
    canonicalSession.reconciliationRequired;
  const isResourceHandoff = canonicalSession.status === "RESOURCE_HANDOFF";
  const isPaused = canonicalSession.status === "PAUSED";
  const isActive = canonicalSession.status === "ACTIVE";
  const isStale = runtime.sessionAuthority !== "CANONICAL" ||
    runtime.runtimeStatus === "OFFLINE_STALE";
  const showCheckCompletion = isActive &&
    runtime.displayMayBeComplete &&
    runtime.completionEligible !== true;
  const mayComplete = isActive && runtime.completionEligible === true;
  const canOpenResources = isActive && mayChangeSession && materials.length > 0;
  const runtimeStatusLabel = isReconciliationRequired
    ? t.focusActiveStatusReconciliation
    : isResourceHandoff
      ? t.focusActiveStatusResource
      : isPaused
        ? t.focusActiveStatusPaused
        : isActive
          ? t.focusActiveStatusActive
          : t.focusActiveChecking;
  const timerPhaseLabel = isPaused
    ? t.focusActiveStatusPaused
    : isResourceHandoff
      ? t.focusActiveStatusResource
      : isActive
        ? t.focusActiveStudyPhase
        : t.focusActiveChecking;

  const retryPlan = () => {
    if (!canonicalSession) return;
    setPlanLoad({ status: "loading" });
    void focusApi.getFocusPlan(canonicalSession.planId)
      .then((plan) => setPlanLoad({ status: "ready", plan }))
      .catch(() => setPlanLoad({ status: "error" }));
  };

  const openResource = (material: Material) => {
    if (materialKind(material) === "PDF") void openPdf(material);
    else if (materialKind(material) === "VIDEO") void openVideo(material);
  };

  return (
    <div dir={language === "ar" ? "rtl" : "ltr"} className="mx-auto min-h-screen max-w-7xl px-4 pb-8 pt-4 sm:px-6 sm:pt-6 lg:px-8">
      <header className="mb-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setConfirmType("exit")}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground shadow-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t.focusActiveExit}
        </button>
        <div className="text-end">
          <h1 className="text-base font-semibold text-foreground">{t.focusActiveTitle}</h1>
          <p className="hidden text-xs text-muted-foreground sm:block">{t.focusActiveSubtitle}</p>
        </div>
      </header>

      {!online && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100" role="status">
          <WifiOff className="size-4 shrink-0" aria-hidden="true" />
          <span>{t.focusActiveOffline}</span>
        </div>
      )}
      {isStale && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100" role="status">
          <span>{t.focusActiveStatusOffline}</span>
          <button
            type="button"
            onClick={() => void controller.reconcile()}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-current px-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            {t.focusActiveRetry}
          </button>
        </div>
      )}
      {isReconciliationRequired && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" role="alert">
          <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <h2 className="font-semibold">{t.focusActiveReconciliationTitle}</h2>
            <p className="mt-1 text-sm">{t.focusActiveReconciliationBody}</p>
          </div>
        </div>
      )}
      {isResourceHandoff && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-500/30 bg-sky-50 p-4 text-sky-950 dark:bg-sky-950/30 dark:text-sky-100" role="status">
          <div>
            <h2 className="font-semibold">{t.focusActiveStatusResource}</h2>
            <p className="mt-1 text-sm">{t.focusActiveSubtitle}</p>
          </div>
          <button
            type="button"
            disabled={!mayChangeSession}
            onClick={() => void perform(() => controller.returnFromResourceHandoff())}
            className="min-h-11 rounded-xl bg-primary px-4 font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {t.focusActiveReturnToFocus}
          </button>
        </div>
      )}
      {showInterruption && interruption && (
        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between" role="status">
          <div className="flex items-start gap-3">
            <Clock3 className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              <h2 className="font-semibold text-foreground">{t.focusActiveInterruptionTitle}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t.focusActiveInterruptionBody}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={
                !online ||
                interruptionPending ||
                !mayChangeSession ||
                canonicalSession.status !== "ACTIVE"
              }
              onClick={handleRecordInterruption}
              className="min-h-11 rounded-xl border border-border px-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {t.focusActiveInterruptionRecord}
            </button>
            <button
              type="button"
              onClick={() => setDismissedInterruption(interruption.detectedAt)}
              className="min-h-11 rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t.focusActiveInterruptionDismiss}
            </button>
          </div>
        </div>
      )}

      <main className="grid items-start gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)] lg:gap-6">
        <div className="min-w-0 space-y-4">
          <section className={`rounded-3xl border p-5 shadow-sm sm:p-8 ${
            isPaused
              ? "border-amber-500/20 bg-amber-50 dark:bg-amber-950/20"
              : "border-primary/15 bg-card"
          }`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="inline-flex min-h-8 items-center gap-2 rounded-full bg-background/80 px-3 text-sm font-semibold text-foreground">
                <span className={`size-2 rounded-full ${
                  isPaused ? "bg-amber-500" : isResourceHandoff ? "bg-sky-500" : "bg-primary"
                }`} aria-hidden="true" />
                {runtimeStatusLabel}
              </span>
              <span className="rounded-full border border-border bg-background/70 px-3 py-1 text-xs font-semibold text-muted-foreground">
                {timerPhaseLabel}
              </span>
            </div>

            <div className="mt-5 text-center">
              <p className="text-sm font-medium text-muted-foreground">{t.focusActiveTimerLabel}</p>
              <FocusTimer controller={controller} label={t.focusActiveTimerLabel} />
              {runtime.displayMayBeComplete && runtime.completionEligible !== true && (
                <p className="mt-2 text-sm text-muted-foreground" role="status">
                  {t.focusActiveChecking}
                </p>
              )}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              {isActive && (
                <button
                  type="button"
                  disabled={!mayChangeSession}
                  onClick={handlePause}
                  className="inline-flex min-h-12 min-w-32 items-center justify-center gap-2 rounded-xl border border-border bg-background px-5 font-semibold text-foreground shadow-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Pause className="size-4" aria-hidden="true" />
                  {t.focusActivePause}
                </button>
              )}
              {isPaused && (
                <button
                  type="button"
                  disabled={!mayChangeSession}
                  onClick={handleResume}
                  className="inline-flex min-h-12 min-w-32 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground shadow-sm transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Play className="size-4" aria-hidden="true" />
                  {t.focusActiveResume}
                </button>
              )}
              {mayComplete && (
                <button
                  type="button"
                  disabled={!mayChangeSession}
                  onClick={handleComplete}
                  className="inline-flex min-h-12 min-w-44 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground shadow-sm transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Check className="size-4" aria-hidden="true" />
                  {t.focusActiveComplete}
                </button>
              )}
              {showCheckCompletion && (
                <button
                  type="button"
                  disabled={!online || isRuntimeBusy}
                  onClick={() => void controller.reconcile()}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                  {t.focusActiveCheckReady}
                </button>
              )}
              {(isActive || isPaused) && (
                <button
                  type="button"
                  disabled={!mayChangeSession}
                  onClick={() => setConfirmType("end")}
                  className="min-h-12 rounded-xl px-4 font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  {t.focusActiveEnd}
                </button>
              )}
              <button
                type="button"
                disabled={!online || isRuntimeBusy}
                onClick={() => void controller.reconcile()}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                {isRuntimeBusy ? t.focusActiveChecking : t.focusActiveRetry}
              </button>
            </div>

          </section>

          {actionError && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{actionError}</span>
            </div>
          )}
          {resourceError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
              {t.focusActiveResourceError}
            </div>
          )}
          {runtime.error && runtime.runtimeStatus !== "OFFLINE_STALE" && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
              {t.focusActiveActionError}
            </div>
          )}
        </div>

        <aside className="min-w-0 space-y-4">
          <SessionSummary
            session={canonicalSession}
            lecture={lecture}
            itemPosition={currentPlanIndex >= 0 ? currentPlanIndex + 1 : null}
            itemCount={planItems.length}
            t={t}
          />

          <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-semibold text-foreground">{t.focusActiveResourceTitle}</h2>
              {catalogStatus === "error" && (
                <button
                  type="button"
                  onClick={() => void onRefreshLectures()}
                  className="min-h-10 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t.focusActiveRetry}
                </button>
              )}
            </div>
            {catalogStatus === "error" && materials.length === 0 ? (
              <p className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
                {t.focusActiveCatalogError}
              </p>
            ) : catalogStatus === "loading" && materials.length === 0 ? (
              <div className="h-12 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" aria-hidden="true" />
            ) : materials.length === 0 ? (
              <p className="rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">
                {t.focusActiveNoResources}
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-1 xl:grid-cols-2">
                {materials.map((material) => {
                  const kind = materialKind(material);
                  const resourceLabel = material.title ||
                    (kind === "PDF" ? t.focusActiveOpenPdf : t.focusActiveOpenVideo);
                  const isOpening = openingResourceId === material.id;
                  return (
                    <button
                      key={material.id}
                      type="button"
                      aria-label={`${kind === "PDF" ? t.focusActiveOpenPdf : t.focusActiveOpenVideo}: ${resourceLabel}`}
                      disabled={!canOpenResources || isOpening}
                      onClick={() => openResource(material)}
                      className="flex min-h-12 min-w-0 items-center gap-2 rounded-xl border border-border bg-background px-3 text-start text-sm font-medium text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {kind === "PDF"
                        ? <FileText className="size-4 shrink-0" aria-hidden="true" />
                        : <Video className="size-4 shrink-0" aria-hidden="true" />}
                      <span className="min-w-0 flex-1 truncate">
                        {resourceLabel}
                      </span>
                      {isOpening
                        ? <RefreshCw className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        : <ExternalLink className="size-4 shrink-0" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            )}
            {openingResourceId && (
              <p className="mt-2 text-xs text-muted-foreground" role="status">
                {t.focusActiveOpeningResource}
              </p>
            )}
          </section>

          {currentPlan ? (
            <QueuePreview
              items={planItems}
              currentItemId={canonicalSession.planItemId}
              lectures={lectures}
              t={t}
            />
          ) : (
            <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold text-foreground">{t.focusActiveQueue}</h2>
                {planLoad.status === "error" && (
                  <button
                    type="button"
                    onClick={retryPlan}
                    className="min-h-10 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t.focusActiveRetry}
                  </button>
                )}
              </div>
              {planLoad.status === "loading" ? (
                <div className="mt-3 h-20 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">{t.focusActivePlanUnavailable}</p>
              )}
            </section>
          )}

          <FocusQuickNotesPanel
            ref={notesRef}
            sessionId={canonicalSession.id}
            language={language}
            online={online}
          />

          {FOCUS_AUDIO_ENABLED && (
            <section className="rounded-2xl border border-border bg-card p-3 shadow-sm sm:p-4">
              <h2 className="mb-2 px-1 font-semibold text-foreground">{t.focusActiveAudioTitle}</h2>
              <FocusAudioPlanningCard language={language} />
            </section>
          )}
        </aside>
      </main>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {isPaused
          ? t.focusActiveStatusPaused
          : isResourceHandoff
            ? t.focusActiveStatusResource
            : isReconciliationRequired
              ? t.focusActiveStatusReconciliation
              : phase === "BREAK"
                ? t.focusActiveBreakPhase
                : ""}
      </div>

      {confirmType && (
        <ConfirmationDialog
          type={confirmType}
          t={t}
          dialogRef={dialogRef}
          cancelRef={dialogCancelRef}
          onCancel={() => setConfirmType(null)}
          onConfirm={() => {
            if (confirmType === "end") handleAbandon();
            else void leaveForPlanner();
          }}
        />
      )}
    </div>
  );
}

function FocusTimer({
  controller,
  label,
}: {
  controller: FocusRuntimeController;
  label: string;
}) {
  const [remainingSeconds, setRemainingSeconds] = useState(
    () => controller.getState().displayRemainingSeconds,
  );

  useEffect(() => controller.subscribe((state) => {
    setRemainingSeconds((current) =>
      current === state.displayRemainingSeconds ? current : state.displayRemainingSeconds);
  }), [controller]);

  const clockText = remainingSeconds === null
    ? "--:--"
    : formatFocusClock(remainingSeconds);
  return (
    <time
      className="mt-2 block font-mono text-6xl font-semibold tracking-tight text-foreground tabular-nums sm:text-7xl lg:text-8xl"
      dir="ltr"
      aria-label={`${label}: ${clockText}`}
      aria-live="off"
    >
      {clockText}
    </time>
  );
}

function FocusBreakTimer({
  endsAtMonotonic,
  label,
  onFinished,
}: {
  endsAtMonotonic: number;
  label: string;
  onFinished: () => void;
}) {
  const readRemaining = () =>
    Math.max(0, Math.ceil((endsAtMonotonic - performance.now()) / 1_000));
  const [remainingSeconds, setRemainingSeconds] = useState(readRemaining);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      if (timeout !== null) {
        clearTimeout(timeout);
        timeout = null;
      }
      const remaining = readRemaining();
      setRemainingSeconds((current) => current === remaining ? current : remaining);
      if (remaining === 0) {
        onFinished();
        return;
      }
      timeout = setTimeout(update, Math.min(1_000, endsAtMonotonic - performance.now()));
    };
    const onForeground = () => {
      if (document.visibilityState === "visible") update();
    };
    update();
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("pageshow", update);
    return () => {
      if (timeout !== null) clearTimeout(timeout);
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("pageshow", update);
    };
  }, [endsAtMonotonic, onFinished]);

  const clockText = formatFocusClock(remainingSeconds);
  return (
    <time
      className="block font-mono text-6xl font-semibold tracking-tight tabular-nums sm:text-7xl"
      dir="ltr"
      aria-label={`${label}: ${clockText}`}
      aria-live="off"
    >
      {clockText}
    </time>
  );
}

function SessionSummary({
  session,
  lecture,
  itemPosition,
  itemCount,
  t,
}: {
  session: FocusSessionDto;
  lecture: DatabaseLecture | null;
  itemPosition: number | null;
  itemCount: number;
  t: ActiveFocusCopy;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <BookOpen className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{t.focusActiveCurrentLecture}</p>
          <h2 className="mt-1 truncate font-semibold text-foreground">
            {lecture?.name ?? t.focusActiveCurrentLecture}
          </h2>
          {lecture?.mainSubject && (
            <p className="mt-1 truncate text-sm text-muted-foreground">{lecture.mainSubject}</p>
          )}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-muted/60 p-3">
          <p className="text-xs text-muted-foreground">{t.focusActiveRound}</p>
          <p className="mt-1 font-semibold tabular-nums text-foreground">
            <bdi dir="ltr">{session.sessionNumber} / {session.plannedSessionCount}</bdi>
          </p>
        </div>
        <div className="rounded-xl bg-muted/60 p-3">
          <p className="text-xs text-muted-foreground">{t.focusActivePlanPosition}</p>
          <p className="mt-1 font-semibold tabular-nums text-foreground">
            <bdi dir="ltr">{itemPosition && itemCount ? `${itemPosition} / ${itemCount}` : "—"}</bdi>
          </p>
        </div>
      </div>
    </section>
  );
}

function QueuePreview({
  items,
  currentItemId,
  lectures,
  t,
}: {
  items: FocusPlanDto["items"];
  currentItemId: string;
  lectures: DatabaseLecture[];
  t: ActiveFocusCopy;
}) {
  const orderedItems = [...items].sort((a, b) => a.sequence - b.sequence);
  const startAt = Math.max(0, orderedItems.findIndex((item) => item.id === currentItemId));
  const visibleItems = orderedItems.slice(startAt, startAt + 4);

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <h2 className="font-semibold text-foreground">{t.focusActiveQueue}</h2>
      <ol className="mt-3 space-y-2">
        {visibleItems.map((item, index) => {
          const lecture = lectures.find((candidate) => candidate.id === item.lectureId);
          const isCurrent = item.id === currentItemId;
          return (
            <li
              key={item.id}
              className={`flex items-center gap-3 rounded-xl p-3 ${
                isCurrent ? "bg-primary/10 text-foreground" : "bg-muted/50 text-muted-foreground"
              }`}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-xs font-semibold tabular-nums">
                {startAt + index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {lecture?.name ?? t.focusActiveCurrentLecture}
                </span>
                <span className="mt-0.5 block text-xs">
                  {item.sessionCount} {t.focusActiveRound.toLowerCase()}
                </span>
              </span>
              {isCurrent
                ? <span className="rounded-full bg-primary px-2 py-1 text-[10px] font-semibold text-primary-foreground">{t.focusActiveStudyPhase}</span>
                : <ChevronRight className="size-4 shrink-0" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
      {visibleItems.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">{t.focusActivePlanUnavailable}</p>
      )}
    </section>
  );
}

function TerminalHandoff({
  language,
  title,
  body,
  manualLectureCompletionRequired,
  onReturn,
  children,
}: {
  language: Language;
  title: string;
  body: string;
  manualLectureCompletionRequired?: boolean;
  onReturn: () => void;
  children?: React.ReactNode;
}) {
  const t = useActiveFocusCopy(language);
  return (
    <div
      dir={language === "ar" ? "rtl" : "ltr"}
      className={`mx-auto px-4 py-10 ${children ? "max-w-6xl" : "flex min-h-[70vh] max-w-3xl items-center"}`}
    >
      <div className={children ? "grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_minmax(300px,0.85fr)]" : "w-full"}>
        <section className="w-full rounded-3xl border border-border bg-card p-6 text-center shadow-sm sm:p-10">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Check className="size-7" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-2xl font-bold text-foreground">{title}</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">{body}</p>
        {manualLectureCompletionRequired && (
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">{t.focusActiveManualLecture}</p>
        )}
        <button
          type="button"
          onClick={onReturn}
          className="mt-7 inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t.focusActiveReturn}
        </button>
        </section>
        {children && <div className="min-w-0">{children}</div>}
      </div>
    </div>
  );
}

function ConfirmationDialog({
  type,
  t,
  dialogRef,
  cancelRef,
  onCancel,
  onConfirm,
}: {
  type: "end" | "exit";
  t: ActiveFocusCopy;
  dialogRef: React.RefObject<HTMLDivElement | null>;
  cancelRef: React.RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const title = type === "end" ? t.focusActiveEndTitle : t.focusActiveExitTitle;
  const body = type === "end" ? t.focusActiveEndBody : t.focusActiveExitBody;
  const confirmText = type === "end" ? t.focusActiveEndConfirm : t.focusActiveLeave;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="focus-active-dialog-title"
        aria-describedby="focus-active-dialog-description"
        className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl sm:p-6"
      >
        <h2 id="focus-active-dialog-title" className="text-lg font-semibold text-foreground">{title}</h2>
        <p id="focus-active-dialog-description" className="mt-2 text-sm text-muted-foreground">{body}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-xl border border-border px-4 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {type === "end" ? t.focusActiveCancel : t.focusActiveStay}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`min-h-11 rounded-xl px-4 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              type === "end"
                ? "bg-destructive text-destructive-foreground"
                : "bg-primary text-primary-foreground"
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}