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
  readCachedPersonalization,
  writeCachedPersonalization,
  type PersonalizationCacheInvalidReason,
  type PersonalizationCacheReadResult,
  type PersonalizationKeyValueStorage,
  type PersonalizationCacheWriteResult,
} from "./personalizationStorage";
import type { PersonalizationConfigV1 } from "../../../shared/personalization";

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
      config: PersonalizationConfigV1;
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
  committed: PersonalizationConfigV1;
  draft: PersonalizationConfigV1;
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
  config: PersonalizationConfigV1;
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
      config: PersonalizationConfigV1;
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

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!userId) {
      stateOwnerUserIdRef.current = null;
      setState(createPersonalizationState());
      setHydration({ phase: "signed-out" });
      setApplyStatus({ phase: "idle" });
      return;
    }

    let active = true;
    stateOwnerUserIdRef.current = userId;
    setState(createPersonalizationState());
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
      setState(createPersonalizationState(resolution.config));
      setHydration(resolution.status);
    });

    return () => {
      active = false;
    };
  }, [storage, userId]);

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
    setApplyStatus({ phase: "saving", userId: activeUserId });

    const writeResult = await writeCachedPersonalization(
      activeUserId,
      stateResult.config,
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

    setState(commit.state);
    setApplyStatus({
      phase: "saved",
      userId: activeUserId,
      savedAt: commit.savedAt,
    });
    return {
      ok: true,
      config: commit.config,
      persistence: "saved",
    };
  }, [storage]);

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