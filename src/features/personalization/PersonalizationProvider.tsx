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
      phase: "memory-only";
      userId: string;
      error: PersonalizationCacheWriteError;
    }
  | {
      phase: "error";
      userId: string | null;
      error: "invalid-draft" | "not-authenticated";
    };

export type PersonalizationRuntimeApplyResult =
  | {
      ok: true;
      config: PersonalizationConfigV1;
      persistence: "saved" | "memory-only";
      error?: PersonalizationCacheInvalidReason;
    }
  | {
      ok: false;
      error: "invalid-draft" | "not-authenticated";
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

  stateRef.current = state;
  userIdRef.current = userId;

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!userId) {
      setState(createPersonalizationState());
      setHydration({ phase: "signed-out" });
      setApplyStatus({ phase: "idle" });
      return;
    }

    let active = true;
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
    setState((current) => reducePersonalizationState(current, action));
  }, []);

  const cancelDraft = useCallback(() => {
    setState((current) => cancelPersonalizationDraft(current));
  }, []);

  const resetDraft = useCallback(() => {
    setState((current) => resetPersonalizationDraft(current));
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
    setState(stateResult.state);
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
      return writeResult.ok
        ? {
            ok: true,
            config: stateResult.config,
            persistence: "saved" as const,
            ...(writeResult.savedAt ? { savedAt: writeResult.savedAt } : {}),
          }
        : {
            ok: true,
            config: stateResult.config,
            persistence: "memory-only" as const,
            error: writeResult.error,
          };
    }

    if (writeResult.ok) {
      setApplyStatus({
        phase: "saved",
        userId: activeUserId,
        savedAt: writeResult.savedAt,
      });
      return {
        ok: true,
        config: stateResult.config,
        persistence: "saved",
      };
    }

    setApplyStatus({
      phase: "memory-only",
      userId: activeUserId,
      error: writeResult.error,
    });
    return {
      ok: true,
      config: stateResult.config,
      persistence: "memory-only",
      error: writeResult.error,
    };
  }, [storage]);

  const value = useMemo<PersonalizationRuntimeValue>(
    () => ({
      userId,
      committed: state.committed,
      draft: state.draft,
      isDirty: state.isDirty,
      hydration,
      applyStatus,
      updateDraft,
      cancelDraft,
      resetDraft,
      applyDraft,
    }),
    [
      applyDraft,
      applyStatus,
      cancelDraft,
      hydration,
      resetDraft,
      state.committed,
      state.draft,
      state.isDirty,
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