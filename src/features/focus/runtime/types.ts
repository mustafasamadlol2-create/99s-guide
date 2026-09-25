import type {
  FocusSessionDto,
  FocusSessionMutationResult,
} from "../../../../server/features/focus/types";

export const FOCUS_RUNTIME_STATUSES = [
  "IDLE",
  "LOADING",
  "READY",
  "MUTATING",
  "RECONCILING",
  "OFFLINE_STALE",
  "RECONCILIATION_REQUIRED",
  "ERROR",
] as const;

export type FocusRuntimeStatus = (typeof FOCUS_RUNTIME_STATUSES)[number];
export type FocusSnapshotAuthority = "CANONICAL" | "NON_AUTHORITATIVE" | null;
export type FocusClientSource = "web" | "pwa" | "ios" | "android";
export type FocusRuntimeOperation =
  | "start"
  | "pause"
  | "resume"
  | "complete"
  | "abandon";

export interface FocusRuntimeErrorInfo {
  kind: "transport" | "http" | "protocol" | "runtime";
  code: string;
  message: string;
  status?: number;
}

export interface FocusPendingOperationSummary {
  operation: FocusRuntimeOperation;
  sessionId: string | null;
  startedAtClientMonotonic: number;
  retryAvailable: boolean;
}

export interface FocusSemanticResult {
  operation: FocusRuntimeOperation;
  code: string;
  message: string;
}

export interface FocusRuntimeState {
  runtimeStatus: FocusRuntimeStatus;
  session: FocusSessionDto | null;
  sessionAuthority: FocusSnapshotAuthority;
  lastMutationResult: FocusSessionMutationResult | null;
  displayRemainingSeconds: number | null;
  displayMayBeComplete: boolean;
  estimatedServerNow: string | null;
  completionEligible: boolean | null;
  pendingOperation: FocusPendingOperationSummary | null;
  semanticResult: FocusSemanticResult | null;
  error: FocusRuntimeErrorInfo | null;
  lastSyncedAt: string | null;
}