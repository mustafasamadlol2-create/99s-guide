import type { StudyEventSource, StudyEventType } from "../study-core/events.js";
import type { EvidenceClass } from "../study-core/evidence.js";
import { isServerOwnedEvidence } from "./evidence.js";
import { createIntegrityActionEnvelope } from "./envelope.js";
import { INTEGRITY_ACTION_TYPES } from "./constants.js";
import type {
  IntegrityActionEnvelope,
  IntegrityResource,
  IntegrityStructuredValue,
} from "./types.js";

const STUDY_EVENT_ACTIONS: Partial<Record<StudyEventType, string>> = {
  focus_session_started: INTEGRITY_ACTION_TYPES.FOCUS_SESSION_START,
  focus_session_completed: INTEGRITY_ACTION_TYPES.FOCUS_SESSION_COMPLETE,
  focus_interruption_recorded: INTEGRITY_ACTION_TYPES.FOCUS_INTERRUPTION_RECORD,
  focus_resource_handoff_started:
    INTEGRITY_ACTION_TYPES.FOCUS_RESOURCE_HANDOFF_START,
  focus_resource_handoff_returned:
    INTEGRITY_ACTION_TYPES.FOCUS_RESOURCE_HANDOFF_RETURN,
  lecture_resource_launched: INTEGRITY_ACTION_TYPES.STUDY_RESOURCE_OPEN,
  group_focus_joined: INTEGRITY_ACTION_TYPES.GROUP_FOCUS_ROOM_JOIN,
  group_focus_left: INTEGRITY_ACTION_TYPES.GROUP_FOCUS_ROOM_LEAVE,
  group_focus_round_completed:
    INTEGRITY_ACTION_TYPES.GROUP_FOCUS_ROUND_COMPLETE,
  group_focus_summary_completed:
    INTEGRITY_ACTION_TYPES.GROUP_FOCUS_SUMMARY_COMPLETE,
  mcq_attempted: INTEGRITY_ACTION_TYPES.MCQ_ANSWER,
  flashcard_reviewed: INTEGRITY_ACTION_TYPES.FLASHCARD_REVIEW,
  spaced_recall_answered: INTEGRITY_ACTION_TYPES.RECALL_ANSWER,
};

export type StudyEventIntegrityInput = {
  eventType: StudyEventType;
  userId: string;
  source: StudyEventSource;
  evidenceClass: EvidenceClass;
  occurredAt: Date | string;
  receivedAt: Date | string;
  idempotencyKey?: string;
  clientInstanceId?: string;
  focusSessionId?: string;
  groupFocusRoomId?: string;
  lectureId?: string;
  materialId?: string;
  mcqId?: string;
  flashcardId?: string;
  payload?: IntegrityStructuredValue;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

function resourceForEvent(
  event: StudyEventIntegrityInput,
): IntegrityResource | undefined {
  if (event.focusSessionId) {
    return { kind: "focus_session", id: event.focusSessionId };
  }
  if (event.groupFocusRoomId) {
    return { kind: "group_focus_room", id: event.groupFocusRoomId };
  }
  if (event.lectureId) return { kind: "lecture", id: event.lectureId };
  if (event.materialId) return { kind: "material", id: event.materialId };
  if (event.mcqId) return { kind: "mcq", id: event.mcqId };
  if (event.flashcardId) return { kind: "flashcard", id: event.flashcardId };
  return undefined;
}

function durationForEvent(
  payload: IntegrityStructuredValue | undefined,
): number | undefined {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return undefined;
  }
  for (const key of ["activeSeconds", "durationSeconds", "observedAwaySeconds"]) {
    const value = payload[key];
    if (typeof value === "number") return value;
  }
  return undefined;
}

/**
 * Converts a validated Study Event semantic input without writing or creating
 * a Study Event. Unmapped event types get a namespaced action and fail closed
 * until an explicit Integrity policy is registered.
 */
export function adaptStudyEventToIntegrityAction(
  event: StudyEventIntegrityInput,
): IntegrityActionEnvelope {
  const actionType =
    STUDY_EVENT_ACTIONS[event.eventType] ?? `study_event.${event.eventType}`;
  const serverOwned = isServerOwnedEvidence(event.evidenceClass);
  const upstreamIsCanonicalServer =
    event.source === "backend" ||
    event.source === "offline_replay" ||
    event.source === "durable_object";
  const source =
    serverOwned && upstreamIsCanonicalServer ? "backend" : event.source;

  const metadata: Record<string, IntegrityStructuredValue> = {
    studyEventType: event.eventType,
  };
  if (source !== event.source) metadata.upstreamSource = event.source;

  // Do not copy the raw Study Event payload into integrity metadata. Only the
  // recognized, non-content duration values are projected into the envelope.
  return createIntegrityActionEnvelope({
    actionType,
    userId: event.userId,
    source,
    evidenceClass: event.evidenceClass,
    occurredAt: toDate(event.occurredAt),
    receivedAt: toDate(event.receivedAt),
    ...(event.idempotencyKey ? { idempotencyKey: event.idempotencyKey } : {}),
    ...(event.clientInstanceId ? { clientInstanceId: event.clientInstanceId } : {}),
    ...(resourceForEvent(event) ? { resource: resourceForEvent(event) } : {}),
    ...(durationForEvent(event.payload) !== undefined
      ? { durationSeconds: durationForEvent(event.payload) }
      : {}),
    metadata,
  });
}