import { z } from "zod";
import type { StudyEventType } from "../study-core/events.js";

const boundedText = (max = 200) => z.string().trim().min(1).max(max);
const emptyPayload = z.object({}).strict();

export const MAX_PAYLOAD_BYTES = 32 * 1024;
export const MAX_ACTIVE_SECONDS = 24 * 60 * 60;
export const MAX_PAUSE_SECONDS = 7 * 24 * 60 * 60;

const focusCompletion = z.object({
  activeSeconds: z.number().int().min(0).max(MAX_ACTIVE_SECONDS),
  pauseSeconds: z.number().int().min(0).max(MAX_PAUSE_SECONDS).optional(),
  completionReason: boundedText(100).optional(),
}).strict();

const interruption = z.object({
  reason: boundedText(160).optional(),
  durationSeconds: z.number().int().min(0).max(MAX_PAUSE_SECONDS).optional(),
}).strict();

const mcqAttempt = z.object({ correct: z.boolean() }).strict();

const flashcardReview = z.object({
  quality: z.enum(["AGAIN", "HARD", "GOOD", "EASY"]).optional(),
  responseMs: z.number().int().min(0).max(10 * 60 * 1000).optional(),
}).strict();

const recallAnswer = z.object({
  response: z.enum(["CORRECT", "INCORRECT"]),
}).strict();

const recallSkip = z.object({
  reason: boundedText(120).optional(),
}).strict();

const lectureProgress = z.object({
  progressPercent: z.number().int().min(0).max(100),
}).strict();

const resourceLaunch = z.object({
  resourceType: boundedText(60),
  resourceId: boundedText(200).optional(),
}).strict();

const handoff = z.object({
  resourceType: boundedText(60),
  resourceId: boundedText(200).optional(),
  status: z.enum(["STARTED", "RETURNED", "TIMEOUT", "UNKNOWN"]),
}).strict();

export const STUDY_EVENT_PAYLOAD_SCHEMAS: Readonly<
  Record<StudyEventType, z.ZodTypeAny>
> = {
  focus_session_started: emptyPayload,
  focus_session_paused: emptyPayload,
  focus_session_resumed: emptyPayload,
  focus_session_completed: focusCompletion,
  focus_session_abandoned: z.object({ reason: boundedText(120).optional() }).strict(),
  focus_interruption_recorded: interruption,
  focus_resource_handoff_started: handoff,
  focus_resource_handoff_returned: handoff,
  lecture_resource_launched: resourceLaunch,
  lecture_progress_recorded: lectureProgress,
  lecture_completion_confirmed: emptyPayload,
  mcq_attempted: mcqAttempt,
  mcq_reviewed: emptyPayload,
  flashcard_reviewed: flashcardReview,
  flashcard_progress_updated: emptyPayload,
  spaced_recall_presented: emptyPayload,
  spaced_recall_answered: recallAnswer,
  spaced_recall_skipped: recallSkip,
  group_focus_joined: emptyPayload,
  group_focus_round_completed: emptyPayload,
  group_focus_left: emptyPayload,
  group_focus_summary_completed: emptyPayload,
  study_event_rejected: z.object({ reason: boundedText(160) }).strict(),
  study_event_flagged: z.object({ reason: boundedText(160) }).strict(),
  study_event_reconciled: z.object({ reason: boundedText(160) }).strict(),
};

export function parseStudyEventPayload(eventType: StudyEventType, payload: unknown): unknown {
  const parsed = STUDY_EVENT_PAYLOAD_SCHEMAS[eventType].safeParse(payload);
  if (!parsed.success) throw new Error("Payload does not match the event schema.");
  const bytes = Buffer.byteLength(JSON.stringify(parsed.data), "utf8");
  if (bytes > MAX_PAYLOAD_BYTES) throw new Error("Payload exceeds the bounded size limit.");
  return parsed.data;
}