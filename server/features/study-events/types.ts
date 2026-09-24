import type { EvidenceClass } from "../study-core/evidence.js";
import type { PrivacyClass } from "../study-core/privacy.js";
import type { StudyEventSource, StudyEventType } from "../study-core/events.js";

export type IngestStudyEventInput<TPayload = unknown> = {
  eventType: StudyEventType;
  userId: string;
  occurredAt: Date | string;
  source: StudyEventSource;
  idempotencyKey: string;
  lectureId?: string;
  materialId?: string;
  mcqId?: string;
  flashcardId?: string;
  focusSessionId?: string;
  groupFocusRoomId?: string;
  evidenceClass: EvidenceClass;
  /** Optional compatibility input; event policy owns persisted privacy. */
  privacyClass?: PrivacyClass;
  payload: TPayload;
};

export type StudyEventRecord = {
  id: string;
  schemaVersion: number;
  eventType: StudyEventType;
  userId: string;
  occurredAt: Date;
  receivedAt: Date;
  source: StudyEventSource;
  idempotencyKey: string;
  lectureId: string | null;
  materialId: string | null;
  mcqId: string | null;
  flashcardId: string | null;
  focusSessionId: string | null;
  groupFocusRoomId: string | null;
  evidenceClass: EvidenceClass;
  privacyClass: PrivacyClass;
  payload: unknown;
};

export type MetricDelta = {
  focusSeconds?: number;
  sessionsCompleted?: number;
  mcqAttempts?: number;
  mcqCorrect?: number;
  flashcardReviews?: number;
  recallAttempts?: number;
  recallCorrect?: number;
  lectureCompletions?: number;
  interruptionCount?: number;
};

export type StudyEventIngestResult =
  | {
      status: "FEATURE_DISABLED";
      event: null;
      idempotency: null;
      metricUpdated: false;
      metricDate?: undefined;
    }
  | {
      status: "INGESTED";
      event: StudyEventRecord;
      idempotency: "FIRST_SEEN" | "REPLAY_SAME_PAYLOAD";
      metricUpdated: boolean;
      metricDate?: string;
    };

export type StudyEventTransaction = {
  studyEvent: {
    findUnique(args: {
      where: { userId_idempotencyKey: { userId: string; idempotencyKey: string } };
    }): Promise<unknown>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  studyDailyMetric: {
    upsert(args: {
      where: { userId_metricDate: { userId: string; metricDate: Date } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
  };
  lecture: { findUnique(args: Record<string, unknown>): Promise<unknown> };
  material: { findUnique(args: Record<string, unknown>): Promise<unknown> };
  mcq: { findUnique(args: Record<string, unknown>): Promise<unknown> };
  flashcard: { findUnique(args: Record<string, unknown>): Promise<unknown> };
  focusSession: { findUnique(args: Record<string, unknown>): Promise<unknown> };
  $queryRawUnsafe<T = unknown>(query: string, ...args: unknown[]): Promise<T>;
};

export type StudyEventRepository = {
  transaction<T>(callback: (tx: StudyEventTransaction) => Promise<T>): Promise<T>;
  findByIdempotency(userId: string, idempotencyKey: string): Promise<unknown>;
  validateReference(
    tx: StudyEventTransaction,
    reference: { field: string; id: string; userId: string; lectureId?: string | null },
  ): Promise<void>;
};