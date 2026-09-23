import type { EvidenceClass } from "./evidence.js";
import type { PrivacyClass } from "./privacy.js";

export const STUDY_EVENT_TYPES = [
  "focus_session_started",
  "focus_session_paused",
  "focus_session_resumed",
  "focus_session_completed",
  "focus_session_abandoned",
  "focus_interruption_recorded",
  "focus_resource_handoff_started",
  "focus_resource_handoff_returned",
  "lecture_resource_launched",
  "lecture_progress_recorded",
  "lecture_completion_confirmed",
  "mcq_attempted",
  "mcq_reviewed",
  "flashcard_reviewed",
  "flashcard_progress_updated",
  "spaced_recall_presented",
  "spaced_recall_answered",
  "spaced_recall_skipped",
  "group_focus_joined",
  "group_focus_round_completed",
  "group_focus_left",
  "group_focus_summary_completed",
  "study_event_rejected",
  "study_event_flagged",
  "study_event_reconciled",
] as const;

export type StudyEventType = (typeof STUDY_EVENT_TYPES)[number];

export const STUDY_EVENT_SOURCES = [
  "web",
  "pwa",
  "ios",
  "android",
  "backend",
  "durable_object",
  "offline_replay",
] as const;

/**
 * Source identifies where an event was classified as originating. It is
 * metadata only; authorization never comes from this client-provided value.
 */
export type StudyEventSource = (typeof STUDY_EVENT_SOURCES)[number];

export type StudyEventEnvelope<TPayload = unknown> = {
  id: string;
  schemaVersion: number;
  eventType: StudyEventType;
  userId: string;
  occurredAt: string;
  receivedAt: string;
  source: StudyEventSource;
  idempotencyKey: string;
  lectureId?: string;
  materialId?: string;
  mcqId?: string;
  flashcardId?: string;
  focusSessionId?: string;
  groupFocusRoomId?: string;
  evidenceClass: EvidenceClass;
  privacyClass: PrivacyClass;
  payload: TPayload;
};