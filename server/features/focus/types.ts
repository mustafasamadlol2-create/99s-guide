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
  CreateFocusQuickNoteInput,
  UpdateFocusQuickNoteInput,
  FocusQuickNoteListQuery,
  ConvertFocusQuickNoteInput,
  FocusMetricsPeriod,
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

export interface FocusInterruptionResult {
  idempotency: "FIRST_SEEN" | "REPLAY_SAME_PAYLOAD";
  metricUpdated: boolean;
}

export interface FocusQuickNoteDto {
  id: string;
  focusSessionId: string;
  lectureId: string;
  content: string;
  status: "ACTIVE" | "ARCHIVED" | "CONVERTED";
  convertedToPlanItemId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  convertedAt: string | null;
}

export interface FocusQuickNoteCreateResult {
  note: FocusQuickNoteDto;
  idempotency: "CREATED" | "REPLAY_SAME_PAYLOAD";
}

export interface FocusQuickNoteConversionResult {
  note: FocusQuickNoteDto;
  planItem: FocusPlanItemDto & { planId: string };
  idempotency: "CONVERTED" | "REPLAY_SAME_PAYLOAD";
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
  listPlans(userId: string, limit?: number): Promise<FocusPlanDto[]>;
  getPlan(userId: string, planId: string): Promise<FocusPlanDto>;
  updatePlan(userId: string, planId: string, input: UpdateFocusPlanInput): Promise<FocusPlanDto>;
  archivePlan(userId: string, planId: string): Promise<FocusPlanDto>;
  startSession(userId: string, input: StartFocusSessionInput): Promise<FocusSessionMutationResult>;
  pauseSession(userId: string, sessionId: string, input: FocusSessionTransitionInput): Promise<FocusSessionMutationResult>;
  resumeSession(userId: string, sessionId: string, input: FocusSessionTransitionInput): Promise<FocusSessionMutationResult>;
  currentSession(userId: string): Promise<FocusCurrentSessionResult>;
  completeSession(userId: string, sessionId: string, input: CompleteFocusSessionInput): Promise<FocusSessionMutationResult>;
  abandonSession(userId: string, sessionId: string, input: AbandonFocusSessionInput): Promise<FocusSessionMutationResult>;
  startResourceHandoff(userId: string, sessionId: string, input: ResourceHandoffStartInput): Promise<FocusSessionMutationResult>;
  returnFromResourceHandoff(userId: string, sessionId: string, input: ResourceHandoffReturnInput): Promise<FocusSessionMutationResult>;
  recordInterruption(userId: string, sessionId: string, input: InterruptionRecordInput): Promise<FocusInterruptionResult>;
  createQuickNote(userId: string, input: CreateFocusQuickNoteInput): Promise<FocusQuickNoteCreateResult>;
  listQuickNotes(userId: string, query?: FocusQuickNoteListQuery): Promise<FocusQuickNoteDto[]>;
  getQuickNote(userId: string, noteId: string): Promise<FocusQuickNoteDto>;
  updateQuickNote(userId: string, noteId: string, input: UpdateFocusQuickNoteInput): Promise<FocusQuickNoteDto>;
  archiveQuickNote(userId: string, noteId: string): Promise<FocusQuickNoteDto>;
  convertQuickNote(userId: string, noteId: string, input: ConvertFocusQuickNoteInput): Promise<FocusQuickNoteConversionResult>;
  getMetrics(userId: string, period: FocusMetricsPeriod): Promise<FocusMetricsDto>;
  getPostFocusActionContext(userId: string, sessionId: string): Promise<PostFocusActionContext>;
}