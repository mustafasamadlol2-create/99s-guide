import { useCallback, useEffect, useMemo, useRef } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import type {
  FocusBreakSnapshot,
  FocusSessionDto,
} from "../../../../server/features/focus/types";
import type { DatabaseLecture } from "../../../core/types";
import type { Language } from "../../../core/i18n/translations";
import { focusApi } from "../api/focusApi";
import {
  FOCUS_SOCKET_RECONNECTED_EVENT,
  FOCUS_STATE_INVALIDATED_EVENT,
  FOCUS_VIEW_RECONCILE_EVENT,
  isFocusResourceAffected,
} from "../api/focusSync";
import type { FocusRuntimeController } from "../runtime/controller";
import type { FocusRuntimeState } from "../runtime/types";
import {
  endAllFocusLiveActivities,
  endFocusLiveActivity,
  isNativeIOSFocusLiveActivityPlatform,
  syncFocusLiveActivity,
  type FocusLiveActivityPhase,
} from "./focusLiveActivityClient";

interface UseFocusLiveActivitySyncOptions {
  accountId: string | null;
  runtimeController: FocusRuntimeController;
  runtimeState: FocusRuntimeState;
  lectures: DatabaseLecture[];
  language: Language;
}

const TERMINAL = new Set<FocusSessionDto["status"]>([
  "COMPLETED",
  "ABANDONED",
  "EXPIRED",
]);

function endAtFromCanonical(session: FocusSessionDto): string | null {
  if (session.status !== "ACTIVE" || session.remainingSeconds === null) return null;
  const serverNow = Date.parse(session.serverNow);
  if (!Number.isFinite(serverNow)) return null;
  return new Date(serverNow + Math.max(0, session.remainingSeconds) * 1_000).toISOString();
}

function focusPhase(session: FocusSessionDto): FocusLiveActivityPhase {
  return session.status === "ACTIVE" ? "FOCUSING" : "PAUSED";
}

export function useFocusLiveActivitySync({
  accountId,
  runtimeController,
  runtimeState,
  lectures,
  language,
}: UseFocusLiveActivitySyncOptions): void {
  const lastBreakRef = useRef<FocusBreakSnapshot | null>(null);
  const lectureTitles = useMemo(
    () => new Map(lectures.map((lecture) => [lecture.id, lecture.name])),
    [lectures],
  );

  const syncCanonical = useCallback(async (force = false) => {
    if (!isNativeIOSFocusLiveActivityPlatform()) return;

    const state = runtimeController.getState();
    if (state.sessionAuthority !== "CANONICAL") return;
    const session = state.session;

    if (!accountId || !session) {
      lastBreakRef.current = null;
      await endAllFocusLiveActivities();
      return;
    }
    if (TERMINAL.has(session.status)) {
      lastBreakRef.current = null;
      await endFocusLiveActivity(session.id);
      return;
    }

    let breakSnapshot = lastBreakRef.current?.session.id === session.id
      ? lastBreakRef.current
      : null;
    try {
      const canonicalBreak = await focusApi.getFocusBreak(session.id);
      const stillCurrent = runtimeController.getState().session?.id === session.id;
      if (!stillCurrent) return;
      breakSnapshot = canonicalBreak;
      lastBreakRef.current = canonicalBreak;
    } catch {
      // A transient break read must not destroy a correct existing Live Activity.
      // Fall back to the last canonical break snapshot for this session, then to
      // the canonical Focus session itself.
    }

    const activeBreak = breakSnapshot?.breakSession?.endedAt === null
      ? breakSnapshot.breakSession
      : null;
    const lectureTitle = lectureTitles.get(session.lectureId) ?? "Focus Session";

    if (activeBreak) {
      await syncFocusLiveActivity({
        sessionId: session.id,
        lectureTitle,
        phase: activeBreak.isPaused ? "BREAK_PAUSED" : "BREAK",
        remainingSeconds: activeBreak.remainingSeconds,
        endAt: activeBreak.isPaused ? null : activeBreak.endsAt,
        sessionNumber: session.sessionNumber,
        plannedSessionCount: session.plannedSessionCount,
        locale: language === "ar" ? "ar" : "en",
      }, { force });
      return;
    }

    await syncFocusLiveActivity({
      sessionId: session.id,
      lectureTitle,
      phase: focusPhase(session),
      remainingSeconds: session.remainingSeconds ?? 0,
      endAt: endAtFromCanonical(session),
      sessionNumber: session.sessionNumber,
      plannedSessionCount: session.plannedSessionCount,
      locale: language === "ar" ? "ar" : "en",
    }, { force });
  }, [accountId, language, lectureTitles, runtimeController]);

  // Deliberately excludes displayRemainingSeconds: ActivityKit owns the visible
  // countdown from endAt, so the web runtime does not issue one native update
  // per second.
  const canonicalSyncKey = [
    runtimeState.sessionAuthority,
    runtimeState.session?.id ?? "none",
    runtimeState.session?.status ?? "none",
    runtimeState.session?.serverNow ?? "none",
    runtimeState.session?.remainingSeconds ?? "none",
    runtimeState.session?.sessionNumber ?? "none",
    runtimeState.session?.plannedSessionCount ?? "none",
    runtimeState.lastSyncedAt ?? "none",
    language,
    runtimeState.session
      ? lectureTitles.get(runtimeState.session.lectureId) ?? "Focus Session"
      : "none",
  ].join("|");

  useEffect(() => {
    void canonicalSyncKey;
    void syncCanonical(false).catch(() => {});
  }, [canonicalSyncKey, syncCanonical]);

  useEffect(() => {
    if (!isNativeIOSFocusLiveActivityPlatform()) return;
    return () => {
      // FocusHub remains mounted while the authenticated app is alive. Its
      // unmount therefore marks an account/session boundary (for example
      // logout), where leaving private study data on the Lock Screen would be
      // incorrect.
      void endAllFocusLiveActivities().catch(() => {});
    };
  }, [accountId]);

  useEffect(() => {
    if (!isNativeIOSFocusLiveActivityPlatform()) return;

    let disposed = false;
    let nativeListener: PluginListenerHandle | null = null;

    const reconcileAndSync = async () => {
      try {
        await runtimeController.reconcile();
      } catch {
        // Keep the currently displayed native state when the canonical read is
        // temporarily unavailable. A later foreground/invalidation retries it.
      }
      if (!disposed) await syncCanonical(true).catch(() => {});
    };

    const onInvalidation = (event: Event) => {
      const sessionId = runtimeController.getState().session?.id;
      if (
        !sessionId ||
        isFocusResourceAffected(event, "current-session", sessionId) ||
        isFocusResourceAffected(event, "break", sessionId)
      ) {
        void reconcileAndSync();
      }
    };
    const onReconnect = () => { void reconcileAndSync(); };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void reconcileAndSync();
    };
    const onWindowFocus = () => { void reconcileAndSync(); };

    window.addEventListener(FOCUS_STATE_INVALIDATED_EVENT, onInvalidation);
    window.addEventListener(FOCUS_VIEW_RECONCILE_EVENT, onInvalidation);
    window.addEventListener(FOCUS_SOCKET_RECONNECTED_EVENT, onReconnect);
    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibility);

    void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive && !disposed) void reconcileAndSync();
    }).then((handle) => {
      if (disposed) void handle.remove();
      else nativeListener = handle;
    }).catch(() => {});

    return () => {
      disposed = true;
      window.removeEventListener(FOCUS_STATE_INVALIDATED_EVENT, onInvalidation);
      window.removeEventListener(FOCUS_VIEW_RECONCILE_EVENT, onInvalidation);
      window.removeEventListener(FOCUS_SOCKET_RECONNECTED_EVENT, onReconnect);
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      void nativeListener?.remove();
    };
  }, [runtimeController, syncCanonical]);
}
