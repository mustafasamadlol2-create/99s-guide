import type {
  AbandonFocusSessionInput,
  CompleteFocusSessionInput,
  CreateFocusPlanInput,
  FocusSessionTransitionInput,
  StartFocusSessionInput,
  UpdateFocusPlanInput,
  ResourceHandoffStartInput,
  ResourceHandoffReturnInput,
  InterruptionRecordInput,
  FocusMetricsPeriod,
  FocusHistoryQuery,
} from "./schemas.js";
import type { FocusSessionState } from "../study-core/focus.js";

export interface FocusPlanItemDto {
  id: string;
  lectureId: string;
  sequence: number;
  sessionCount: number;
  focusDurationSeconds: number;
  breakDurationSeconds: number;
  includeMcq: boolean;
  includeFlashcards: boolean;
  includeVideo: boolean;
}

export interface FocusPlanDto {
  id: string;
  title: string;
  status: string;
  timezone: string;
  planVersion: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  items: FocusPlanItemDto[];
}

export interface FocusSessionDto {
  id: string;
  planId: string;
  planItemId: string;
  lectureId: string;
  status: FocusSessionState;
  startedAt: string | null;
  plannedEndAt: string | null;
  actualEndedAt: string | null;
  lastCheckpointAt: string | null;
  activeSeconds: number | null;
  pauseSeconds: number | null;
  serverNow: string;
  elapsedActiveSeconds: number | null;
  remainingSeconds: number | null;
  completionEligible: boolean;
  sessionNumber: number;
  plannedSessionCount: number;
  isLastPlannedSession: boolean;
  reconciliationRequired: boolean;
  completionReason: string | null;
}

export interface FocusSessionMutationResult {
  session: FocusSessionDto;
  nextSession?: FocusSessionDto;
  idempotency: "CREATED" | "FIRST_SEEN" | "REPLAY_SAME_PAYLOAD";
  manualLectureCompletionRequired?: boolean;
  followUpPreferences?: {
    includeMcq: boolean;
    includeFlashcards: boolean;
    includeVideo: boolean;
  };
}

export interface FocusCurrentSessionResult {
  session: FocusSessionDto | null;
  serverNow: string;
}

export interface FocusBreakDto {
  id: string;
  focusSessionId: string;
  durationSeconds: number;
  startedAt: string;
  endsAt: string;
  endedAt: string | null;
  resumeStudyOnReturn: boolean;
  isPaused: boolean;
  remainingSeconds: number;
}

export interface FocusBreakSnapshot {
  session: FocusSessionDto;
  breakSession: FocusBreakDto | null;
  serverNow: string;
}

export interface FocusBreakMutationResult extends FocusBreakSnapshot {
  breakSession: FocusBreakDto;
  idempotency: "FIRST_SEEN" | "REPLAY_SAME_PAYLOAD" | "ALREADY_ACTIVE" | "ALREADY_ENDED";
}

export interface FocusInterruptionResult {
  idempotency: "FIRST_SEEN" | "REPLAY_SAME_PAYLOAD";
  metricUpdated: boolean;
}

export interface FocusMetricCounters {
  focusSeconds: number;
  sessionsCompleted: number;
  interruptionCount: number;
}

export interface FocusMetricsDaily extends FocusMetricCounters {
  date: string;
}

export interface FocusMetricsDto {
  period: FocusMetricsPeriod;
  timezone: "Asia/Baghdad";
  startDate: string;
  endDate: string;
  totals: FocusMetricCounters;
  daily: FocusMetricsDaily[];
}

export interface FocusHistoryResourceDto {
  resourceId: string;
  resourceType: "PDF" | "VIDEO";
  title: string | null;
  launchCount: number;
}

export interface FocusSessionSummaryDto {
  sessionId: string;
  status: FocusSessionState;
  plan: {
    id: string;
    title: string;
    status: string;
  };
  lecture: {
    id: string;
    title: string;
    subject: string;
  };
  progress: {
    sessionNumber: number;
    plannedSessionCount: number;
    isLastPlannedSession: boolean;
    completedSessions: number;
    totalPlannedSessions: number;
  };
  timing: {
    plannedFocusSeconds: number;
    verifiedFocusSeconds: number | null;
    plannedBreakSeconds: number;
    startedAt: string | null;
    terminalAt: string | null;
  };
  points: {
    amount: number;
    reasonCode: string;
  } | null;
  resources: {
    launchCount: number;
    uniqueResourceCount: number;
    items: FocusHistoryResourceDto[];
  };
  nextAction: {
    kind: "NEXT_SESSION" | "NEXT_LECTURE" | "PLAN_FINISHED" | "UNAVAILABLE";
    planItemId: string | null;
    lectureId: string | null;
    lectureTitle: string | null;
  };
}

export interface FocusHistoryRowDto {
  sessionId: string;
  status: FocusSessionState;
  planId: string;
  planTitle: string;
  planStatus: string;
  planItemId: string;
  lectureId: string;
  lectureTitle: string;
  subject: string;
  plannedFocusSeconds: number;
  verifiedFocusSeconds: number | null;
  startedAt: string | null;
  terminalAt: string | null;
  points: number | null;
  resourceLaunchCount: number;
  uniqueResourceCount: number;
}

export interface FocusHistoryPageDto {
  items: FocusHistoryRowDto[];
  nextCursor: string | null;
  limit: number;
}

export interface PostFocusActionContext {
  sessionId: string;
  lectureId: string;
  planId: string;
  planItemId: string;
  sessionNumber: number;
  plannedSessionCount: number;
  isLastPlannedSession: boolean;
  manualLectureCompletionRequired: boolean;
  configured: {
    mcq: boolean;
    flashcards: boolean;
    video: boolean;
  };
  available: {
    mcq: boolean;
    flashcards: boolean;
    video: boolean;
  };
}

export interface FocusBackendService {
  createPlan(userId: string, input: CreateFocusPlanInput): Promise<FocusPlanDto>;
  listPlans(
    userId: string,
    limit?: number,
    options?: { status?: "ACTIVE" | "ARCHIVED"; canonical?: boolean },
  ): Promise<FocusPlanDto[]>;
  getPlan(userId: string, planId: string, options?: { canonical?: boolean }): Promise<FocusPlanDto>;
  updatePlan(userId: string, planId: string, input: UpdateFocusPlanInput): Promise<FocusPlanDto>;
  archivePlan(userId: string, planId: string): Promise<FocusPlanDto>;
  startSession(userId: string, input: StartFocusSessionInput): Promise<FocusSessionMutationResult>;
  pauseSession(userId: string, sessionId: string, input: FocusSessionTransitionInput): Promise<FocusSessionMutationResult>;
  resumeSession(userId: string, sessionId: string, input: FocusSessionTransitionInput): Promise<FocusSessionMutationResult>;
  currentSession(userId: string): Promise<FocusCurrentSessionResult>;
  getBreak(userId: string, sessionId: string): Promise<FocusBreakSnapshot>;
  startBreak(
    userId: string,
    sessionId: string,
    input: FocusSessionTransitionInput,
  ): Promise<FocusBreakMutationResult>;
  pauseBreak(
    userId: string,
    sessionId: string,
    input: FocusSessionTransitionInput,
  ): Promise<FocusBreakMutationResult>;
  resumeBreak(
    userId: string,
    sessionId: string,
    input: FocusSessionTransitionInput,
  ): Promise<FocusBreakMutationResult>;
  returnFromBreak(
    userId: string,
    sessionId: string,
    input: FocusSessionTransitionInput,
  ): Promise<FocusBreakMutationResult>;
  completeSession(userId: string, sessionId: string, input: CompleteFocusSessionInput): Promise<FocusSessionMutationResult>;
  abandonSession(userId: string, sessionId: string, input: AbandonFocusSessionInput): Promise<FocusSessionMutationResult>;
  startResourceHandoff(userId: string, sessionId: string, input: ResourceHandoffStartInput): Promise<FocusSessionMutationResult>;
  returnFromResourceHandoff(userId: string, sessionId: string, input: ResourceHandoffReturnInput): Promise<FocusSessionMutationResult>;
  recordInterruption(userId: string, sessionId: string, input: InterruptionRecordInput): Promise<FocusInterruptionResult>;
  getMetrics(userId: string, period: FocusMetricsPeriod): Promise<FocusMetricsDto>;
  getPostFocusActionContext(userId: string, sessionId: string): Promise<PostFocusActionContext>;
  getSessionSummary(userId: string, sessionId: string): Promise<FocusSessionSummaryDto>;
  listHistory(userId: string, query: FocusHistoryQuery): Promise<FocusHistoryPageDto>;
}