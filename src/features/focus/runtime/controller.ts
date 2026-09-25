import { canTransitionFocusSession } from "../../../../server/features/study-core/focus";
import type {
  AbandonFocusSessionInput,
  CompleteFocusSessionInput,
  FocusSessionTransitionInput,
  StartFocusSessionInput,
} from "../../../../server/features/focus/schemas";
import type {
  FocusSessionDto,
  FocusSessionMutationResult,
} from "../../../../server/features/focus/types";
import {
  FocusApiError,
  focusApi,
  type FocusApi,
} from "../api/focusApi";
import {
  createFocusRuntimeCache,
  NON_AUTHORITATIVE,
  type FocusRuntimeCache,
  type FocusRuntimeCacheEntry,
} from "./cache";
import { createFocusClock, type FocusClock } from "./clock";
import {
  createFocusIdempotencyKey,
} from "./idempotency";
import {
  createFocusLifecycle,
  type FocusLifecycle,
} from "./lifecycle";
import { getFocusClientSource } from "./source";
import {
  createFocusTimerBaseline,
  estimateFocusDisplay,
  FocusTimerSnapshotError,
  type FocusTimerBaseline,
} from "./timer";
import type {
  FocusClientSource,
  FocusPendingOperationSummary,
  FocusRuntimeErrorInfo,
  FocusRuntimeOperation,
  FocusRuntimeState,
  FocusRuntimeStatus,
  FocusSemanticResult,
} from "./types";

export interface StartFocusSessionRequest {
  planId: string;
  planItemId: string;
}

export interface FocusRuntimeControllerOptions {
  api?: FocusApi;
  clock?: FocusClock;
  accountId?: string | null;
  cache?: FocusRuntimeCache | null;
  lifecycle?: FocusLifecycle | null;
  source?: () => FocusClientSource;
  idempotencyKeyFactory?: () => string;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  renderTickMs?: number;
}

interface PendingMutation {
  operation: FocusRuntimeOperation;
  sessionId: string | null;
  idempotencyKey: string;
  startedAtClientMonotonic: number;
  fingerprint: string;
}

interface MutationFlight {
  key: string;
  fingerprint: string;
  promise: Promise<FocusSessionMutationResult>;
}

interface ReconcileFlight {
  generation: number;
  promise: Promise<FocusRuntimeState>;
}

type StateListener = (state: FocusRuntimeState) => void;

const TERMINAL_STATES = new Set<FocusSessionDto["status"]>([
  "COMPLETED",
  "ABANDONED",
  "EXPIRED",
]);

function initialState(): FocusRuntimeState {
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
  };
}

function runtimeStatusForSession(session: FocusSessionDto): FocusRuntimeStatus {
  if (session.status === "RECONCILIATION_REQUIRED" || session.reconciliationRequired) {
    return "RECONCILIATION_REQUIRED";
  }
  return "READY";
}

function sessionStatusAfterTerminalResult(session: FocusSessionDto): boolean {
  return TERMINAL_STATES.has(session.status);
}

function errorInfo(error: unknown): FocusRuntimeErrorInfo {
  if (error instanceof FocusApiError) {
    return {
      kind: error.kind,
      code: error.code ?? (error.kind === "transport" ? "TRANSPORT_ERROR" : "FOCUS_REQUEST_FAILED"),
      message: error.message,
      ...(error.status === undefined ? {} : { status: error.status }),
    };
  }
  if (error instanceof FocusRuntimeOperationError) {
    return {
      kind: "runtime",
      code: error.code,
      message: error.message,
    };
  }
  return {
    kind: "runtime",
    code: "FOCUS_RUNTIME_ERROR",
    message: "The Focus operation could not be completed.",
  };
}

export class FocusRuntimeOperationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "FocusRuntimeOperationError";
  }
}

export class FocusRuntimeController {
  private readonly api: FocusApi;
  private readonly clock: FocusClock;
  private readonly cache: FocusRuntimeCache | null;
  private readonly lifecycle: FocusLifecycle | null;
  private readonly source: () => FocusClientSource;
  private readonly idempotencyKeyFactory: () => string;
  private readonly setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  private readonly renderTickMs: number;

  private currentState = initialState();
  private timerBaseline: FocusTimerBaseline | null = null;
  private listeners = new Set<StateListener>();
  private lifecycleUnsubscribe: (() => void) | null = null;
  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingMutation: PendingMutation | null = null;
  private mutationFlight: MutationFlight | null = null;
  private reconcileFlight: ReconcileFlight | null = null;
  private requestGeneration = 0;
  private initialized = false;
  private disposed = false;

  constructor(options: FocusRuntimeControllerOptions = {}) {
    this.api = options.api ?? focusApi;
    this.clock = options.clock ?? createFocusClock();
    this.cache = options.cache === undefined
      ? createFocusRuntimeCache(options.accountId)
      : options.cache;
    this.lifecycle = options.lifecycle === undefined
      ? createFocusLifecycle()
      : options.lifecycle;
    this.source = options.source ?? getFocusClientSource;
    this.idempotencyKeyFactory = options.idempotencyKeyFactory ?? createFocusIdempotencyKey;
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
    this.renderTickMs = Math.max(100, options.renderTickMs ?? 1_000);
  }

  getState(): FocusRuntimeState {
    return structuredClone(this.currentState);
  }

  subscribe(listener: StateListener): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    try {
      listener(this.getState());
    } catch {
      // A consumer callback must not interrupt runtime state delivery.
    }
    this.ensureRenderTick();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopRenderTick();
    };
  }

  async initialize(): Promise<FocusRuntimeState> {
    this.assertNotDisposed();
    if (!this.lifecycleUnsubscribe && this.lifecycle) {
      this.lifecycleUnsubscribe = this.lifecycle.subscribe(() => {
        void this.reconcile().catch(() => {});
      });
    }
    this.initialized = true;
    return this.reconcile();
  }

  /**
   * Fetch the canonical current session. Concurrent triggers share one request.
   */
  reconcile(): Promise<FocusRuntimeState> {
    this.assertNotDisposed();
    const existing = this.reconcileFlight;
    if (existing && existing.generation === this.requestGeneration) {
      return existing.promise;
    }

    const generation = this.requestGeneration;
    const promise = Promise.resolve().then(() => this.fetchCanonicalCurrent(generation));
    const trackedPromise = promise.finally(() => {
      if (this.reconcileFlight?.promise === trackedPromise) {
        this.reconcileFlight = null;
      }
    });
    this.reconcileFlight = { generation, promise: trackedPromise };
    this.setState({
      runtimeStatus: this.currentState.sessionAuthority === null ? "LOADING" : "RECONCILING",
      error: null,
    });
    return trackedPromise;
  }

  async start(input: StartFocusSessionRequest): Promise<FocusSessionMutationResult> {
    this.assertCanonicalMutationAllowed();
    if (!input.planId || !input.planItemId) {
      throw new FocusRuntimeOperationError("INVALID_REQUEST", "A Focus Plan and Plan item are required.");
    }
    const fingerprint = JSON.stringify([input.planId, input.planItemId]);
    return this.runMutation("start", null, fingerprint, (idempotencyKey) => {
      const request: StartFocusSessionInput = {
        planId: input.planId,
        planItemId: input.planItemId,
        idempotencyKey,
        source: this.source(),
      };
      return this.api.startFocusSession(request);
    });
  }

  async pause(): Promise<FocusSessionMutationResult> {
    const session = this.requireCurrentSession();
    if (!canTransitionFocusSession(session.status, "PAUSED")) {
      throw new FocusRuntimeOperationError(
        "INVALID_SESSION_STATE",
        "This Focus Session cannot be paused in its current state.",
      );
    }
    return this.runTransition("pause", session, (input) =>
      this.api.pauseFocusSession(session.id, input),
    );
  }

  async resume(): Promise<FocusSessionMutationResult> {
    const session = this.requireCurrentSession();
    if (!canTransitionFocusSession(session.status, "ACTIVE")) {
      throw new FocusRuntimeOperationError(
        "INVALID_SESSION_STATE",
        "This Focus Session cannot be resumed in its current state.",
      );
    }
    return this.runTransition("resume", session, (input) =>
      this.api.resumeFocusSession(session.id, input),
    );
  }

  async complete(): Promise<FocusSessionMutationResult> {
    const session = this.requireCurrentSession();
    if (session.status === "PAUSED" ||
        !canTransitionFocusSession(session.status, "COMPLETED")) {
      throw new FocusRuntimeOperationError(
        "INVALID_SESSION_STATE",
        "A paused or non-active Focus Session cannot be completed.",
      );
    }
    return this.runMutation(
      "complete",
      session.id,
      JSON.stringify([session.id]),
      (idempotencyKey) => {
        const request: CompleteFocusSessionInput = { idempotencyKey };
        return this.api.completeFocusSession(session.id, request);
      },
    );
  }

  async abandon(reason?: string): Promise<FocusSessionMutationResult> {
    const session = this.requireCurrentSession();
    if (!canTransitionFocusSession(session.status, "ABANDONED")) {
      throw new FocusRuntimeOperationError(
        "INVALID_SESSION_STATE",
        "This Focus Session cannot be abandoned in its current state.",
      );
    }

    const cleanReason = reason?.trim();
    if (cleanReason && cleanReason.length > 120) {
      throw new FocusRuntimeOperationError(
        "INVALID_REQUEST",
        "The Focus abandonment reason must be 120 characters or fewer.",
      );
    }
    const fingerprint = JSON.stringify([session.id, cleanReason || null]);
    return this.runMutation("abandon", session.id, fingerprint, (idempotencyKey) => {
      const request: AbandonFocusSessionInput = {
        idempotencyKey,
        ...(cleanReason ? { reason: cleanReason } : {}),
      };
      return this.api.abandonFocusSession(session.id, request);
    });
  }

  /** Recompute the local display estimate without reading, writing, or mutating. */
  refreshDisplay(): FocusRuntimeState {
    this.recomputeDisplay();
    return this.getState();
  }

  clearSemanticResult(): void {
    this.setState({ semanticResult: null });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.requestGeneration += 1;
    this.lifecycleUnsubscribe?.();
    this.lifecycleUnsubscribe = null;
    this.stopRenderTick();
    this.pendingMutation = null;
    this.mutationFlight = null;
    this.reconcileFlight = null;
    this.timerBaseline = null;
    this.listeners.clear();
  }

  private async fetchCanonicalCurrent(generation: number): Promise<FocusRuntimeState> {
    try {
      const result = await this.api.getCurrentFocusSession();
      if (this.disposed || generation !== this.requestGeneration) {
        return this.getState();
      }
      const syncedAt = result.serverNow;
      this.timerBaseline = null;
      const currentSession = result.session && !TERMINAL_STATES.has(result.session.status)
        ? result.session
        : null;
      const resolvedPending = this.pendingMutation !== null &&
        this.isPendingMutationResolved(result.session);
      if (resolvedPending) this.pendingMutation = null;

      if (currentSession) {
        this.timerBaseline = createFocusTimerBaseline(
          currentSession,
          result.serverNow,
          this.clock.monotonicNow(),
        );
        const display = estimateFocusDisplay(
          currentSession,
          this.timerBaseline,
          this.clock.monotonicNow(),
        );
        this.setState({
          runtimeStatus: runtimeStatusForSession(currentSession),
          session: currentSession,
          sessionAuthority: "CANONICAL",
          displayRemainingSeconds: display.displayRemainingSeconds,
          displayMayBeComplete: display.displayMayBeComplete,
          estimatedServerNow: display.estimatedServerNow,
          completionEligible: currentSession.completionEligible,
          error: null,
          lastSyncedAt: syncedAt,
          ...(resolvedPending ? { pendingOperation: null } : {}),
        });
      } else {
        this.setState({
          runtimeStatus: "IDLE",
          session: null,
          sessionAuthority: "CANONICAL",
          displayRemainingSeconds: null,
          displayMayBeComplete: false,
          estimatedServerNow: result.serverNow,
          completionEligible: null,
          error: null,
          lastSyncedAt: syncedAt,
          ...(resolvedPending ? { pendingOperation: null } : {}),
        });
      }

      this.writeCache(currentSession, result.serverNow);
      return this.getState();
    } catch (error) {
      if (this.disposed || generation !== this.requestGeneration) {
        return this.getState();
      }
      const normalized = errorInfo(error);
      if (normalized.kind === "transport") {
        const cached = this.cache?.read() ?? null;
        if (cached) {
          this.applyStaleCache(cached);
          return this.getState();
        }
        if (this.currentState.sessionAuthority === "CANONICAL") {
          this.setState({
            runtimeStatus: "OFFLINE_STALE",
            sessionAuthority: NON_AUTHORITATIVE,
            displayMayBeComplete: false,
            completionEligible: null,
            error: {
              kind: "transport",
              code: "OFFLINE_STALE",
              message: "The last synchronized Focus state cannot be confirmed offline.",
            },
          });
          return this.getState();
        }
        this.setState({
          runtimeStatus: "ERROR",
          error: {
            kind: "transport",
            code: "OFFLINE_UNAVAILABLE",
            message: "Focus is unavailable until the server can be reached.",
          },
        });
        return this.getState();
      }
      if (normalized.status === 401) {
        this.cache?.clear();
        this.timerBaseline = null;
        this.setState({
          runtimeStatus: "ERROR",
          session: null,
          sessionAuthority: null,
          displayRemainingSeconds: null,
          displayMayBeComplete: false,
          estimatedServerNow: null,
          completionEligible: null,
          pendingOperation: null,
          error: normalized,
        });
        return this.getState();
      }
      this.setState({
        runtimeStatus: "ERROR",
        sessionAuthority: this.currentState.sessionAuthority === "CANONICAL"
          ? NON_AUTHORITATIVE
          : this.currentState.sessionAuthority,
        displayMayBeComplete: false,
        completionEligible: null,
        error: normalized,
      });
      return this.getState();
    }
  }

  private applyStaleCache(entry: FocusRuntimeCacheEntry): void {
    this.timerBaseline = null;
    if (entry.session) {
      this.timerBaseline = createFocusTimerBaseline(
        entry.session,
        entry.serverNow,
        this.clock.monotonicNow(),
      );
      const display = estimateFocusDisplay(
        entry.session,
        this.timerBaseline,
        this.clock.monotonicNow(),
      );
      this.setState({
        runtimeStatus: "OFFLINE_STALE",
        session: entry.session,
        sessionAuthority: NON_AUTHORITATIVE,
        displayRemainingSeconds: display.displayRemainingSeconds,
        displayMayBeComplete: false,
        estimatedServerNow: display.estimatedServerNow,
        completionEligible: null,
        error: {
          kind: "transport",
          code: "OFFLINE_STALE",
          message: "Showing a non-authoritative cached Focus snapshot while offline.",
        },
        lastSyncedAt: entry.serverNow,
      });
      return;
    }

    this.setState({
      runtimeStatus: "OFFLINE_STALE",
      session: null,
      sessionAuthority: NON_AUTHORITATIVE,
      displayRemainingSeconds: null,
      displayMayBeComplete: false,
      estimatedServerNow: entry.serverNow,
      completionEligible: null,
      error: {
        kind: "transport",
        code: "OFFLINE_STALE",
        message: "The last known Focus state is stale and cannot be confirmed offline.",
      },
      lastSyncedAt: entry.serverNow,
    });
  }

  private runTransition(
    operation: "pause" | "resume",
    session: FocusSessionDto,
    action: (input: FocusSessionTransitionInput) => Promise<FocusSessionMutationResult>,
  ): Promise<FocusSessionMutationResult> {
    return this.runMutation(
      operation,
      session.id,
      JSON.stringify([session.id]),
      (idempotencyKey) => action({ idempotencyKey, source: this.source() }),
    );
  }

  private runMutation(
    operation: FocusRuntimeOperation,
    sessionId: string | null,
    fingerprint: string,
    action: (idempotencyKey: string) => Promise<FocusSessionMutationResult>,
  ): Promise<FocusSessionMutationResult> {
    this.assertCanonicalMutationAllowed();
    const key = `${operation}:${sessionId ?? "new"}`;

    if (this.mutationFlight) {
      if (this.mutationFlight.key === key &&
          this.mutationFlight.fingerprint === fingerprint) {
        return this.mutationFlight.promise;
      }
      throw new FocusRuntimeOperationError(
        "MUTATION_IN_PROGRESS",
        "Another Focus mutation is already in progress.",
      );
    }

    if (this.pendingMutation) {
      if (this.pendingMutation.operation !== operation ||
          this.pendingMutation.sessionId !== sessionId ||
          this.pendingMutation.fingerprint !== fingerprint) {
        throw new FocusRuntimeOperationError(
          "PENDING_MUTATION_UNCERTAIN",
          "Retry or reconcile the previous Focus operation before starting another.",
        );
      }
    } else {
      this.pendingMutation = {
        operation,
        sessionId,
        idempotencyKey: this.idempotencyKeyFactory(),
        startedAtClientMonotonic: this.clock.monotonicNow(),
        fingerprint,
      };
    }

    const pending = this.pendingMutation;
    if (!pending) {
      throw new FocusRuntimeOperationError("MUTATION_SETUP_FAILED", "Focus operation could not be prepared.");
    }

    this.requestGeneration += 1;
    let resolveMutation!: (result: FocusSessionMutationResult) => void;
    let rejectMutation!: (error: unknown) => void;
    const basePromise = new Promise<FocusSessionMutationResult>((resolve, reject) => {
      resolveMutation = resolve;
      rejectMutation = reject;
    });
    const promise = basePromise.finally(() => {
      if (this.mutationFlight?.promise === promise) this.mutationFlight = null;
    });
    this.mutationFlight = { key, fingerprint, promise };
    this.setState({
      runtimeStatus: "MUTATING",
      error: null,
      semanticResult: null,
      pendingOperation: this.pendingSummary(pending, false),
    });
    if (this.disposed) {
      rejectMutation(new FocusRuntimeOperationError(
        "RUNTIME_DISPOSED",
        "Focus runtime has been disposed.",
      ));
      return promise;
    }
    void this.performMutation(operation, pending, action).then(
      resolveMutation,
      rejectMutation,
    );
    void promise.catch(() => {});
    return promise;
  }

  private async performMutation(
    operation: FocusRuntimeOperation,
    pending: PendingMutation,
    action: (idempotencyKey: string) => Promise<FocusSessionMutationResult>,
  ): Promise<FocusSessionMutationResult> {
    try {
      const result = await action(pending.idempotencyKey);
      this.requestGeneration += 1;
      if (this.disposed) return result;

      this.pendingMutation = null;
      const session = result.session;
      const isTerminal = sessionStatusAfterTerminalResult(session);
      if (isTerminal) {
        this.timerBaseline = null;
        this.setState({
          runtimeStatus: "IDLE",
          session: null,
          sessionAuthority: "CANONICAL",
          lastMutationResult: result,
          displayRemainingSeconds: null,
          displayMayBeComplete: false,
          estimatedServerNow: session.serverNow,
          completionEligible: null,
          pendingOperation: null,
          semanticResult: null,
          error: null,
          lastSyncedAt: session.serverNow,
        });
        this.writeCache(null, session.serverNow);
      } else {
        this.timerBaseline = createFocusTimerBaseline(
          session,
          session.serverNow,
          this.clock.monotonicNow(),
        );
        const display = estimateFocusDisplay(
          session,
          this.timerBaseline,
          this.clock.monotonicNow(),
        );
        this.setState({
          runtimeStatus: runtimeStatusForSession(session),
          session,
          sessionAuthority: "CANONICAL",
          lastMutationResult: result,
          displayRemainingSeconds: display.displayRemainingSeconds,
      displayMayBeComplete: this.currentState.sessionAuthority === "CANONICAL" &&
        display.displayMayBeComplete,
          estimatedServerNow: display.estimatedServerNow,
          completionEligible: session.completionEligible,
          pendingOperation: null,
          semanticResult: null,
          error: null,
          lastSyncedAt: session.serverNow,
        });
        this.writeCache(session, session.serverNow);
      }
      return result;
    } catch (error) {
      if (this.disposed) throw error;
      const normalized = errorInfo(error);
      const ambiguous = normalized.kind !== "http" || (normalized.status ?? 0) >= 500;
      if (!ambiguous) this.pendingMutation = null;

      const semanticResult: FocusSemanticResult | null = ambiguous
        ? null
        : { operation, code: normalized.code, message: normalized.message };
      this.setState({
        runtimeStatus: this.currentState.sessionAuthority === "CANONICAL" && this.currentState.session
          ? runtimeStatusForSession(this.currentState.session)
          : "ERROR",
        pendingOperation: ambiguous && this.pendingMutation
          ? this.pendingSummary(this.pendingMutation, true)
          : null,
        semanticResult,
        error: normalized,
      });

      if (operation === "pause" &&
          normalized.kind === "http" &&
          normalized.code === "SESSION_READY_TO_COMPLETE") {
        try {
          await this.reconcile();
        } catch {
          // Keep the semantic result visible even if the follow-up GET fails.
        }
        this.setState({ semanticResult, error: normalized });
      }
      throw error;
    }
  }

  private pendingSummary(
    pending: PendingMutation,
    retryAvailable: boolean,
  ): FocusPendingOperationSummary {
    return {
      operation: pending.operation,
      sessionId: pending.sessionId,
      startedAtClientMonotonic: pending.startedAtClientMonotonic,
      retryAvailable,
    };
  }

  private isPendingMutationResolved(session: FocusSessionDto | null): boolean {
    const pending = this.pendingMutation;
    if (!pending) return false;
    if (session &&
        pending.sessionId === session.id &&
        TERMINAL_STATES.has(session.status)) {
      return true;
    }
    if ((pending.operation === "complete" || pending.operation === "abandon") && !session) {
      return true;
    }
    if (!session) return false;
    switch (pending.operation) {
      case "start": {
        try {
          const [planId, planItemId] = JSON.parse(pending.fingerprint) as [string, string];
          return session.status === "ACTIVE" &&
            session.planId === planId &&
            session.planItemId === planItemId;
        } catch {
          return false;
        }
      }
      case "pause":
        return session.id === pending.sessionId && session.status === "PAUSED";
      case "resume":
        return session.id === pending.sessionId && session.status === "ACTIVE";
      case "complete":
      case "abandon":
        return false;
    }
  }

  private requireCurrentSession(): FocusSessionDto {
    this.assertCanonicalMutationAllowed();
    const session = this.currentState.session;
    if (!session || this.currentState.sessionAuthority !== "CANONICAL") {
      throw new FocusRuntimeOperationError(
        "NO_CANONICAL_SESSION",
        "There is no confirmed current Focus Session.",
      );
    }
    return session;
  }

  private assertCanonicalMutationAllowed(): void {
    this.assertNotDisposed();
    if (!this.initialized || this.currentState.sessionAuthority === null) {
      throw new FocusRuntimeOperationError(
        "RECONCILIATION_REQUIRED",
        "Focus must be synchronized with the server before a mutation.",
      );
    }
    if (this.currentState.runtimeStatus === "OFFLINE_STALE" ||
        this.currentState.sessionAuthority === NON_AUTHORITATIVE) {
      throw new FocusRuntimeOperationError(
        this.currentState.runtimeStatus === "OFFLINE_STALE"
          ? "OFFLINE_MUTATION_UNAVAILABLE"
          : "RECONCILIATION_REQUIRED",
        "Focus changes require a fresh canonical server session.",
      );
    }
  }

  private writeCache(session: FocusSessionDto | null, serverNow: string): void {
    const entry: FocusRuntimeCacheEntry = {
      version: 1,
      authority: NON_AUTHORITATIVE,
      serverNow,
      savedAt: serverNow,
      session,
    };
    this.cache?.write(entry);
  }

  private recomputeDisplay(): void {
    const session = this.currentState.session;
    const baseline = this.timerBaseline;
    if (!session || !baseline ||
        this.currentState.sessionAuthority === null) {
      return;
    }
    try {
      const display = estimateFocusDisplay(session, baseline, this.clock.monotonicNow());
      this.setState({
        displayRemainingSeconds: display.displayRemainingSeconds,
        displayMayBeComplete: this.currentState.sessionAuthority === "CANONICAL" &&
          display.displayMayBeComplete,
        estimatedServerNow: display.estimatedServerNow,
      });
    } catch (error) {
      const normalized: FocusRuntimeErrorInfo = {
        kind: "protocol",
        code: "INVALID_TIMER_BASELINE",
        message: error instanceof FocusTimerSnapshotError
          ? error.message
          : "Focus timer state is invalid and must be synchronized again.",
      };
      this.timerBaseline = null;
      this.setState({
        runtimeStatus: "ERROR",
        displayRemainingSeconds: null,
        displayMayBeComplete: false,
        estimatedServerNow: null,
        error: normalized,
      });
    }
  }

  private ensureRenderTick(): void {
    if (
      this.disposed ||
      this.renderTimer !== null ||
      this.listeners.size === 0 ||
      this.currentState.runtimeStatus !== "READY" ||
      this.currentState.sessionAuthority !== "CANONICAL" ||
      this.currentState.session?.status !== "ACTIVE"
    ) {
      return;
    }
    this.renderTimer = this.setTimer(() => {
      this.renderTimer = null;
      if (this.disposed || this.listeners.size === 0) return;
      this.recomputeDisplay();
      this.ensureRenderTick();
    }, this.renderTickMs);
  }

  private stopRenderTick(): void {
    if (this.renderTimer === null) return;
    this.clearTimer(this.renderTimer);
    this.renderTimer = null;
  }

  private setState(patch: Partial<FocusRuntimeState>): void {
    if (this.disposed) return;
    this.currentState = { ...this.currentState, ...patch };
    this.listeners.forEach((listener) => {
      try {
        listener(this.getState());
      } catch {
        // Keep one consumer from preventing delivery to other subscribers.
      }
    });
    if (this.currentState.runtimeStatus !== "READY" ||
        this.currentState.session?.status !== "ACTIVE") {
      this.stopRenderTick();
    } else {
      this.ensureRenderTick();
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new FocusRuntimeOperationError("RUNTIME_DISPOSED", "Focus runtime has been disposed.");
    }
  }
}

export function createFocusRuntimeController(
  options: FocusRuntimeControllerOptions = {},
): FocusRuntimeController {
  return new FocusRuntimeController(options);
}