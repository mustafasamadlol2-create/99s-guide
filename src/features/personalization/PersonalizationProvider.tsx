import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  applyPersonalizationDraft,
  cancelPersonalizationDraft,
  createPersonalizationState,
  reducePersonalizationState,
  resetPersonalizationDraft,
  type PersonalizationApplyResult as StateApplyResult,
  type PersonalizationDraftAction,
  type PersonalizationState,
} from "./personalizationState";
import {
  acknowledgePersonalizationCloudRecord,
  createPersonalizationEnvelope,
  getPersonalizationCloud,
  persistSyncState,
  putPersonalizationCloud,
  reconcilePersonalization,
  writePendingPersonalization,
  writePersonalizationEnvelope,
} from "./personalizationCloudSync";
import {
  readCachedPersonalization,
  type PersonalizationCacheInvalidReason,
  type PersonalizationCacheReadResult,
  type PersonalizationKeyValueStorage,
  type PersonalizationCacheWriteResult,
  type PersonalizationCacheEnvelope,
} from "./personalizationStorage";
import type {
  PersonalizationCloudRecord,
  PersonalizationConfigV2,
} from "../../../shared/personalization";
import { personalizationConfigsEqual } from "./personalizationState";
import { initializeAppIconPresentation } from "./appIcon/appIconClient";

const PERSONALIZATION_DISCOVERY_INTERVAL_MS = 15 * 60_000;
const PERSONALIZATION_CONFIRMATION_MIN_MS = 40_000;
const PERSONALIZATION_CONFIRMATION_MAX_MS = 50_000;

export function getPersonalizationConfirmationDelayMs(
  random = Math.random,
): number {
  const boundedRandom = Math.min(0.999999999, Math.max(0, random()));
  return PERSONALIZATION_CONFIRMATION_MIN_MS +
    Math.floor(
      boundedRandom *
        (PERSONALIZATION_CONFIRMATION_MAX_MS - PERSONALIZATION_CONFIRMATION_MIN_MS + 1),
    );
}

type CloudSyncTrigger = "initial" | "lifecycle";
type PendingPutResult =
  | { ok: true }
  | { ok: false; retryable: boolean; retryAfterMs?: number };

type PersonalizationCacheWriteError = Extract<
  PersonalizationCacheWriteResult,
  { ok: false }
>["error"];

export type PersonalizationHydrationStatus =
  | { phase: "signed-out" }
  | { phase: "loading"; userId: string }
  | { phase: "ready"; userId: string; source: "cache" | "default"; savedAt?: string }
  | { phase: "fallback"; userId: string; reason: PersonalizationCacheInvalidReason };

export type PersonalizationApplyStatus =
  | { phase: "idle" }
  | { phase: "saving"; userId: string }
  | { phase: "saved"; userId: string; savedAt: string }
  | {
      phase: "error";
      userId: string;
      error: "persistence-failed";
      reason: PersonalizationCacheWriteError;
    }
  | {
      phase: "error";
      userId: string | null;
      error: "invalid-draft" | "not-authenticated" | "not-hydrated";
    };

export type PersonalizationRuntimeApplyResult =
  | {
      ok: true;
      config: PersonalizationConfigV2;
      persistence: "saved";
    }
  | {
      ok: false;
      error: "invalid-draft" | "not-authenticated" | "not-hydrated";
    }
  | {
      ok: false;
      error: "persistence-failed";
      reason: PersonalizationCacheWriteError;
    };

export interface PersonalizationRuntimeValue {
  userId: string | null;
  committed: PersonalizationConfigV2;
  draft: PersonalizationConfigV2;
  isDirty: boolean;
  hydration: PersonalizationHydrationStatus;
  applyStatus: PersonalizationApplyStatus;
  updateDraft(action: PersonalizationDraftAction): void;
  cancelDraft(): void;
  resetDraft(): void;
  applyDraft(): Promise<PersonalizationRuntimeApplyResult>;
}

export interface PersonalizationProviderProps {
  userId: string | null;
  storage?: PersonalizationKeyValueStorage;
  children?: React.ReactNode;
}

const PersonalizationContext =
  createContext<PersonalizationRuntimeValue | null>(null);

export interface PersonalizationHydrationResolution {
  config: PersonalizationConfigV2;
  status: PersonalizationHydrationStatus;
}

export function resolvePersonalizationHydration(
  userId: string,
  result: PersonalizationCacheReadResult,
): PersonalizationHydrationResolution {
  if (result.status === "found") {
    return {
      config: result.config,
      status: {
        phase: "ready",
        userId,
        source: "cache",
        savedAt: result.savedAt,
      },
    };
  }

  if (result.status === "missing") {
    return {
      config: result.config,
      status: {
        phase: "ready",
        userId,
        source: "default",
      },
    };
  }

  return {
    config: result.config,
    status: {
      phase: "fallback",
      userId,
      reason: result.reason,
    },
  };
}

export function isCurrentPersonalizationHydration(
  requestId: number,
  activeRequestId: number,
  userId: string,
  activeUserId: string | null,
): boolean {
  return requestId === activeRequestId && userId === activeUserId;
}

export type PersonalizationCommitDecision =
  | { commit: false; error: "invalid-draft" }
  | {
      commit: false;
      error: "persistence-failed";
      reason: PersonalizationCacheWriteError;
    }
  | {
      commit: true;
      state: PersonalizationState;
      config: PersonalizationConfigV2;
      savedAt: string;
    };

export function resolvePersonalizationCommit(
  stateResult: StateApplyResult,
  writeResult: PersonalizationCacheWriteResult,
): PersonalizationCommitDecision {
  if (!stateResult.ok) {
    return { commit: false, error: "invalid-draft" };
  }

  if (writeResult.ok === false) {
    return {
      commit: false,
      error: "persistence-failed",
      reason: writeResult.error,
    };
  }

  return {
    commit: true,
    state: stateResult.state,
    config: stateResult.config,
    savedAt: writeResult.savedAt,
  };
}

export function PersonalizationProvider({
  userId,
  storage,
  children,
}: PersonalizationProviderProps) {
  useEffect(() => {
    initializeAppIconPresentation();
  }, []);

  const [state, setState] = useState<PersonalizationState>(() =>
    createPersonalizationState(),
  );
  const [hydration, setHydration] = useState<PersonalizationHydrationStatus>(() =>
    userId ? { phase: "loading", userId } : { phase: "signed-out" },
  );
  const [applyStatus, setApplyStatus] = useState<PersonalizationApplyStatus>({
    phase: "idle",
  });
  const requestIdRef = useRef(0);
  const stateRef = useRef(state);
  const userIdRef = useRef(userId);
  const stateOwnerUserIdRef = useRef<string | null>(userId);
  const hydrationRef = useRef(hydration);
  const envelopeRef = useRef<PersonalizationCacheEnvelope | null>(null);
  const pendingPutOperationsRef = useRef(new Map<string, Promise<PendingPutResult>>());
  const confirmationRef = useRef<{
    userId: string;
    candidate: PersonalizationConfigV2;
    record: PersonalizationCloudRecord | null;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const syncInFlightRef = useRef<number | null>(null);
  const lifecycleProbeAtRef = useRef(new Map<number, number>());
  const unsupportedSessionRef = useRef<number | null>(null);
  const disabledSessionRef = useRef<number | null>(null);
  const pendingRetryRef = useRef<{
    userId: string;
    requestId: number;
    intentId: string;
    attempt: number;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  stateRef.current = state;
  userIdRef.current = userId;
  hydrationRef.current = hydration;

  const hasCurrentUserState = stateOwnerUserIdRef.current === userId;
  const visibleState = hasCurrentUserState ? state : createPersonalizationState();
  const visibleHydration =
    userId &&
    hasCurrentUserState &&
    hydration.phase !== "signed-out" &&
    hydration.userId === userId
      ? hydration
      : userId
        ? { phase: "loading" as const, userId }
        : { phase: "signed-out" as const };
  const visibleApplyStatus =
    userId &&
    hasCurrentUserState &&
    (applyStatus.phase === "idle" || applyStatus.userId === userId)
      ? applyStatus
      : { phase: "idle" as const };

  const clearConfirmation = useCallback(() => {
    if (confirmationRef.current) clearTimeout(confirmationRef.current.timer);
    confirmationRef.current = null;
  }, []);

  const clearPendingRetry = useCallback(() => {
    if (pendingRetryRef.current) clearTimeout(pendingRetryRef.current.timer);
    pendingRetryRef.current = null;
  }, []);

  const attemptPendingPut = useCallback(async (
    activeUserId: string,
    requestId: number,
  ): Promise<PendingPutResult> => {
    const local = await readCachedPersonalization(activeUserId, storage);
    if (local.status !== "found" || !local.envelope.sync.pending) return { ok: true };
    const pending = local.envelope.sync.pending;
    const operationKey = `${activeUserId}:${pending.intentId}`;
    const existing = pendingPutOperationsRef.current.get(operationKey);
    if (existing) return existing;

    const operation: Promise<PendingPutResult> = (async () => {
      try {
        const record = await putPersonalizationCloud(
          pending,
          local.envelope.sync.knownCloudRevision,
        );
        if (
          !record ||
          record.lastIntentId !== pending.intentId ||
          requestId !== requestIdRef.current ||
          userIdRef.current !== activeUserId
        ) {
          return { ok: false, retryable: false };
        }
        const latest = await readCachedPersonalization(activeUserId, storage);
        if (
          latest.status !== "found" ||
          latest.envelope.sync.pending?.intentId !== pending.intentId ||
          requestId !== requestIdRef.current ||
          userIdRef.current !== activeUserId
        ) {
          return { ok: false, retryable: false };
        }
        const acknowledged = await acknowledgePersonalizationCloudRecord(
          activeUserId,
          record,
          latest.envelope,
          storage,
        );
        if (!acknowledged.ok) return { ok: false, retryable: false };
        if (requestId !== requestIdRef.current || userIdRef.current !== activeUserId) {
          return { ok: false, retryable: false };
        }
        envelopeRef.current = acknowledged.envelope;
        setState(createPersonalizationState(record.config));
        setHydration({
          phase: "ready",
          userId: activeUserId,
          source: "cache",
          savedAt: acknowledged.savedAt,
        });
        return { ok: true };
      } catch (error) {
        const status = (error as { status?: number }).status;
        const rawRetryAfter = Number((error as { retryAfter?: string }).retryAfter);
        return {
          ok: false,
          retryable: status === 429 || (typeof status === "number" && status >= 500),
          retryAfterMs: Number.isFinite(rawRetryAfter) && rawRetryAfter > 0
            ? rawRetryAfter * 1_000
            : undefined,
        };
      }
    })();
    pendingPutOperationsRef.current.set(operationKey, operation);
    try {
      return await operation;
    } finally {
      if (pendingPutOperationsRef.current.get(operationKey) === operation) {
        pendingPutOperationsRef.current.delete(operationKey);
      }
    }
  }, [storage]);

  const schedulePendingRetry = useCallback((
    activeUserId: string,
    requestId: number,
    intentId: string,
    result: PendingPutResult,
  ) => {
    if (result.ok) return;
    if (!("retryable" in result) || !result.retryable) return;
    const existing = pendingRetryRef.current;
    const attempt = existing?.userId === activeUserId &&
      existing.requestId === requestId &&
      existing.intentId === intentId
      ? existing.attempt + 1
      : 1;
    if (attempt > 3) return;
    clearPendingRetry();
    const delay = result.retryAfterMs ?? Math.min(15_000, 1_000 * 2 ** (attempt - 1));
    const timer = setTimeout(() => {
      pendingRetryRef.current = null;
      if (requestId !== requestIdRef.current || userIdRef.current !== activeUserId) return;
      void attemptPendingPut(activeUserId, requestId).then((next) => {
        if (!next.ok) {
          void readCachedPersonalization(activeUserId, storage).then((current) => {
            const currentIntentId =
              current.status === "found"
                ? current.envelope.sync.pending?.intentId
                : undefined;
            if (currentIntentId) {
              schedulePendingRetry(activeUserId, requestId, currentIntentId, next);
            }
          });
        }
      });
    }, delay);
    pendingRetryRef.current = { userId: activeUserId, requestId, intentId, attempt, timer };
  }, [attemptPendingPut, clearPendingRetry, storage]);

  const scheduleConfirmation = useCallback((
    activeUserId: string,
       candidate: PersonalizationConfigV2,
    record: PersonalizationCloudRecord | null,
    requestId: number,
  ) => {
    clearConfirmation();
    const timer = setTimeout(() => {
      void (async () => {
        if (requestId !== requestIdRef.current || userIdRef.current !== activeUserId) return;
        const local = await readCachedPersonalization(activeUserId, storage);
        if (
          local.status !== "found" ||
          local.envelope.sync.pending ||
          stateRef.current.isDirty
        ) return;
        const remote = await getPersonalizationCloud().catch(() => null);
        if (stateRef.current.isDirty) return;
        const sameCandidate = personalizationConfigsEqual(local.config, candidate);
        const sameRemote =
          (remote?.status === "empty" && record === null) ||
          (remote?.status === "ok" && record?.revision === remote.record.revision);
        if (!sameCandidate || !sameRemote) return;

        if (remote?.status === "empty") {
          const pendingWrite = await writePendingPersonalization(
            activeUserId,
            local.config,
            local.envelope,
            storage,
          );
          if (pendingWrite.ok) {
            envelopeRef.current = pendingWrite.envelope;
            const result = await attemptPendingPut(activeUserId, requestId);
            schedulePendingRetry(activeUserId, requestId, pendingWrite.envelope.sync.pending!.intentId, result);
          }
          return;
        }

        if (remote?.status === "ok") {
          const acknowledged = await acknowledgePersonalizationCloudRecord(
            activeUserId,
            remote.record,
            local.envelope,
            storage,
          );
          if (acknowledged.ok) {
            envelopeRef.current = acknowledged.envelope;
            if (!stateRef.current.isDirty) {
              setState(createPersonalizationState(remote.record.config));
            }
          }
        }
      })();
    }, getPersonalizationConfirmationDelayMs());
    confirmationRef.current = { userId: activeUserId, candidate, record, timer };
  }, [attemptPendingPut, clearConfirmation, schedulePendingRetry, storage]);

  const runCloudSync = useCallback(async (
    activeUserId: string,
    requestId: number,
    trigger: CloudSyncTrigger = "initial",
  ) => {
    if (syncInFlightRef.current === requestId || requestId !== requestIdRef.current) return;
    let local: PersonalizationCacheReadResult | null = null;
    if (trigger === "lifecycle") {
      if (
        unsupportedSessionRef.current === requestId ||
        disabledSessionRef.current === requestId
      ) return;
      local = await readCachedPersonalization(activeUserId, storage);
      if (local.status === "found") {
        if (local.envelope.sync.pending) {
          await attemptPendingPut(activeUserId, requestId);
          return;
        }
        if (local.envelope.sync.lastSyncState === "disabled") return;
        const lastSuccessfulGetAt = local.envelope.sync.lastSuccessfulGetAt;
        const lastGetAt = lastSuccessfulGetAt ? Date.parse(lastSuccessfulGetAt) : NaN;
        const now = Date.now();
        const lastAttemptAt = lifecycleProbeAtRef.current.get(requestId) ?? 0;
        if (
          (Number.isFinite(lastGetAt) && now - lastGetAt < PERSONALIZATION_DISCOVERY_INTERVAL_MS) ||
          (lastAttemptAt > 0 && now - lastAttemptAt < PERSONALIZATION_DISCOVERY_INTERVAL_MS)
        ) {
          return;
        }
      }
      lifecycleProbeAtRef.current.set(requestId, Date.now());
    }

    syncInFlightRef.current = requestId;
    try {
      local ??= await readCachedPersonalization(activeUserId, storage);
      if (local.status === "found" && local.envelope) envelopeRef.current = local.envelope;
      if (local.status === "found" && local.envelope.sync.pending) {
        const result = await attemptPendingPut(activeUserId, requestId);
        if (!result.ok && requestId === requestIdRef.current && userIdRef.current === activeUserId) {
          await persistSyncState(activeUserId, local.envelope, "retryable-failure", storage);
          schedulePendingRetry(
            activeUserId,
            requestId,
            local.envelope.sync.pending.intentId,
            result,
          );
        }
        return;
      }
      const remote = await getPersonalizationCloud();
      if (requestId !== requestIdRef.current || userIdRef.current !== activeUserId) return;
      if (remote.status === "disabled") {
        disabledSessionRef.current = requestId;
        if (local.status === "found") {
          await persistSyncState(activeUserId, local.envelope, "disabled", storage);
        }
        return;
      }
      let localForReconciliation = local;
      if (local.status === "found") {
        const stampedEnvelope = {
          ...local.envelope,
          savedAt: new Date().toISOString(),
          sync: {
            ...local.envelope.sync,
            lastSuccessfulGetAt: new Date().toISOString(),
          },
        };
        const stamped = await writePersonalizationEnvelope(
          activeUserId,
          stampedEnvelope,
          storage,
        );
        if (stamped.ok) {
          envelopeRef.current = stamped.envelope;
          localForReconciliation = {
            ...local,
            envelope: stamped.envelope,
            savedAt: stamped.savedAt,
          };
        }
      }
      const decision = reconcilePersonalization(localForReconciliation, remote);
      if (decision.action === "upload-pending") {
        await attemptPendingPut(activeUserId, requestId);
      } else if (decision.action === "adopt") {
        const base = local.status === "found"
          ? local.envelope
          : createPersonalizationEnvelope(decision.record.config, {
            lastSuccessfulGetAt: new Date().toISOString(),
          });
        const acknowledged = await acknowledgePersonalizationCloudRecord(
          activeUserId,
          decision.record,
          base,
          storage,
        );
        if (acknowledged.ok && requestId === requestIdRef.current && userIdRef.current === activeUserId) {
          envelopeRef.current = acknowledged.envelope;
          if (!stateRef.current.isDirty) {
            setState(createPersonalizationState(decision.record.config));
          }
          setHydration({
            phase: "ready",
            userId: activeUserId,
            source: "cache",
            savedAt: acknowledged.savedAt,
          });
        }
      } else if (decision.action === "confirm" && localForReconciliation.status === "found") {
        scheduleConfirmation(activeUserId, decision.candidate, decision.record, requestId);
      } else if (
        decision.action === "none" &&
        localForReconciliation.status === "found" &&
        localForReconciliation.envelope &&
        decision.state
      ) {
        await persistSyncState(activeUserId, localForReconciliation.envelope, decision.state, storage);
      }
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 404) unsupportedSessionRef.current = requestId;
      if (
        local?.status === "found" &&
        requestId === requestIdRef.current &&
        userIdRef.current === activeUserId
      ) {
        const nextState = status === 404 ? "unsupported" : "retryable-failure";
        await persistSyncState(activeUserId, local.envelope, nextState, storage);
      }
      // Cloud failure never blocks local hydration or Apply.
    } finally {
      if (syncInFlightRef.current === requestId) syncInFlightRef.current = null;
    }
  }, [attemptPendingPut, schedulePendingRetry, scheduleConfirmation, storage]);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!userId) {
      clearConfirmation();
      clearPendingRetry();
      pendingPutOperationsRef.current.clear();
      envelopeRef.current = null;
      stateOwnerUserIdRef.current = null;
      setState(createPersonalizationState());
      setHydration({ phase: "signed-out" });
      setApplyStatus({ phase: "idle" });
      return;
    }

    let active = true;
    const isSameAccount = stateOwnerUserIdRef.current === userId;
    stateOwnerUserIdRef.current = userId;
    clearConfirmation();
    clearPendingRetry();
    unsupportedSessionRef.current = null;
    disabledSessionRef.current = null;
    lifecycleProbeAtRef.current.clear();
    envelopeRef.current = null;
    if (!isSameAccount) setState(createPersonalizationState());
    setHydration({ phase: "loading", userId });
    setApplyStatus({ phase: "idle" });

    void readCachedPersonalization(userId, storage).then((result) => {
      if (
        !active ||
        !isCurrentPersonalizationHydration(
          requestId,
          requestIdRef.current,
          userId,
          userIdRef.current,
        )
      ) {
        return;
      }

      const resolution = resolvePersonalizationHydration(userId, result);
      if (result.status === "found" && result.envelope) envelopeRef.current = result.envelope;
      setState(createPersonalizationState(resolution.config));
      setHydration(resolution.status);
      void runCloudSync(userId, requestId, "initial");
    });

    return () => {
      active = false;
      clearConfirmation();
    };
  }, [clearConfirmation, clearPendingRetry, runCloudSync, storage, userId]);

  useEffect(() => {
    if (!userId) return;
    const requestId = requestIdRef.current;
    const run = () => void runCloudSync(userId, requestId, "lifecycle");
    const onlineHandler = () => run();
    const visibilityHandler = () => {
      if (document.visibilityState === "visible") run();
    };
    window.addEventListener("online", onlineHandler);
    document.addEventListener("visibilitychange", visibilityHandler);
    return () => {
      window.removeEventListener("online", onlineHandler);
      document.removeEventListener("visibilitychange", visibilityHandler);
    };
  }, [runCloudSync, userId]);

  const updateDraft = useCallback((action: PersonalizationDraftAction) => {
    if (stateOwnerUserIdRef.current !== userIdRef.current) return;
    setState((current) => {
      if (stateOwnerUserIdRef.current !== userIdRef.current) return current;
      return reducePersonalizationState(current, action);
    });
  }, []);

  const cancelDraft = useCallback(() => {
    if (stateOwnerUserIdRef.current !== userIdRef.current) return;
    setState((current) => {
      if (stateOwnerUserIdRef.current !== userIdRef.current) return current;
      return cancelPersonalizationDraft(current);
    });
  }, []);

  const resetDraft = useCallback(() => {
    if (stateOwnerUserIdRef.current !== userIdRef.current) return;
    setState((current) => {
      if (stateOwnerUserIdRef.current !== userIdRef.current) return current;
      return resetPersonalizationDraft(current);
    });
  }, []);

  const applyDraft = useCallback(async (): Promise<PersonalizationRuntimeApplyResult> => {
    const activeUserId = userIdRef.current;
    if (!activeUserId) {
      setApplyStatus({
        phase: "error",
        userId: null,
        error: "not-authenticated",
      });
      return { ok: false, error: "not-authenticated" };
    }

    if (
      stateOwnerUserIdRef.current !== activeUserId ||
      hydrationRef.current.phase === "loading" ||
      hydrationRef.current.phase === "signed-out" ||
      hydrationRef.current.userId !== activeUserId
    ) {
      setApplyStatus({
        phase: "error",
        userId: activeUserId,
        error: "not-hydrated",
      });
      return { ok: false, error: "not-hydrated" };
    }

    const stateResult: StateApplyResult = applyPersonalizationDraft(
      stateRef.current,
    );
    if (!stateResult.ok) {
      setApplyStatus({
        phase: "error",
        userId: activeUserId,
        error: "invalid-draft",
      });
      return { ok: false, error: "invalid-draft" };
    }

    const requestId = requestIdRef.current;
    clearConfirmation();
    setApplyStatus({ phase: "saving", userId: activeUserId });

    let currentCache = envelopeRef.current;
    if (!currentCache) {
      const currentRead = await readCachedPersonalization(activeUserId, storage);
      currentCache = currentRead.status === "found" ? currentRead.envelope ?? null : null;
    }
    const writeResult = await writePendingPersonalization(
      activeUserId,
      stateResult.config,
      currentCache,
      storage,
    );

    const stillCurrent =
      requestId === requestIdRef.current &&
      activeUserId === userIdRef.current;
    if (!stillCurrent) {
      if (writeResult.ok) {
        return {
          ok: true,
          config: stateResult.config,
          persistence: "saved",
        };
      }

      const failedWrite = writeResult as Extract<
        PersonalizationCacheWriteResult,
        { ok: false }
      >;
      return {
        ok: false,
        error: "persistence-failed",
        reason: failedWrite.error,
      };
    }

    const commit = resolvePersonalizationCommit(stateResult, writeResult);
    if (commit.commit === false) {
      if (commit.error === "invalid-draft") {
        setApplyStatus({
          phase: "error",
          userId: activeUserId,
          error: "invalid-draft",
        });
        return { ok: false, error: "invalid-draft" };
      }

      if (commit.error !== "persistence-failed") {
        return { ok: false, error: "invalid-draft" };
      }

      setApplyStatus({
        phase: "error",
        userId: activeUserId,
        error: "persistence-failed",
        reason: commit.reason,
      });
      return {
        ok: false,
        error: "persistence-failed",
        reason: commit.reason,
      };
    }

    if (writeResult.ok) envelopeRef.current = writeResult.envelope;
    setState(commit.state);
    setApplyStatus({
      phase: "saved",
      userId: activeUserId,
      savedAt: commit.savedAt,
    });
    // The durable pending intent is the only source for the network PUT.
    void attemptPendingPut(activeUserId, requestId).then((result) => {
      if (!result.ok && writeResult.ok && writeResult.envelope.sync.pending) {
        schedulePendingRetry(
          activeUserId,
          requestId,
          writeResult.envelope.sync.pending.intentId,
          result,
        );
      }
    });
    return {
      ok: true,
      config: commit.config,
      persistence: "saved",
    };
  }, [attemptPendingPut, clearConfirmation, schedulePendingRetry, storage]);

  const value = useMemo<PersonalizationRuntimeValue>(
    () => ({
      userId,
      committed: visibleState.committed,
      draft: visibleState.draft,
      isDirty: visibleState.isDirty,
      hydration: visibleHydration,
      applyStatus: visibleApplyStatus,
      updateDraft,
      cancelDraft,
      resetDraft,
      applyDraft,
    }),
    [
      applyDraft,
      cancelDraft,
      resetDraft,
      visibleHydration,
      visibleState.committed,
      visibleState.draft,
      visibleState.isDirty,
      visibleApplyStatus,
      updateDraft,
      userId,
    ],
  );

  return (
    <PersonalizationContext.Provider value={value}>
      {children}
    </PersonalizationContext.Provider>
  );
}

export function usePersonalization(): PersonalizationRuntimeValue {
  const value = useContext(PersonalizationContext);
  if (!value) {
    throw new Error(
      "usePersonalization must be used within PersonalizationProvider.",
    );
  }
  return value;
}