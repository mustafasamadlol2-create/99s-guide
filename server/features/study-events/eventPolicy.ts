import type { ZodTypeAny } from "zod";
import {
  STUDY_EVENT_TYPES,
  type StudyEventSource,
  type StudyEventType,
} from "../study-core/events.js";
import type { EvidenceClass } from "../study-core/evidence.js";
import { getEvidenceRank } from "../study-core/evidence.js";
import type { PrivacyClass } from "../study-core/privacy.js";
import type { MetricDelta } from "./types.js";
import { MAX_ACTIVE_SECONDS, STUDY_EVENT_PAYLOAD_SCHEMAS } from "./schemas.js";

export type StudyEventPolicy = {
  minimumEvidence: EvidenceClass;
  allowedSources: readonly StudyEventSource[];
  privacyClass: PrivacyClass;
  payloadSchema: ZodTypeAny;
  requiredReferences: readonly string[];
  metricEffect: "NONE" | "DELTA" | "DEFERRED";
  intendedProducer: string;
};

const clientSources = ["web", "pwa", "ios", "android", "offline_replay"] as const;
const serverSources = ["backend", "offline_replay"] as const;
const realtimeSources = ["backend", "durable_object"] as const;

const noMetric = (
  minimumEvidence: EvidenceClass,
  allowedSources: readonly StudyEventSource[],
  intendedProducer: string,
  requiredReferences: readonly string[] = [],
): StudyEventPolicy => ({
  minimumEvidence,
  allowedSources,
  privacyClass: "PRIVATE_STUDY",
  payloadSchema: STUDY_EVENT_PAYLOAD_SCHEMAS.focus_session_started,
  requiredReferences,
  metricEffect: "NONE",
  intendedProducer,
});

const policy = (values: Partial<StudyEventPolicy> & Pick<StudyEventPolicy, "minimumEvidence" | "allowedSources" | "intendedProducer">): StudyEventPolicy => ({
  privacyClass: "PRIVATE_STUDY",
  payloadSchema: STUDY_EVENT_PAYLOAD_SCHEMAS.focus_session_started,
  requiredReferences: [],
  metricEffect: "NONE",
  ...values,
});

const registry: Record<StudyEventType, StudyEventPolicy> = {
  focus_session_started: noMetric("CLIENT_OBSERVED", clientSources, "Focus Service"),
  focus_session_paused: noMetric("CLIENT_OBSERVED", clientSources, "Focus Service"),
  focus_session_resumed: noMetric("CLIENT_OBSERVED", clientSources, "Focus Service"),
  focus_session_completed: policy({
    minimumEvidence: "SERVER_VALIDATED",
    allowedSources: serverSources,
    requiredReferences: ["focusSessionId"],
    metricEffect: "DELTA",
    intendedProducer: "Focus Service",
  }),
  focus_session_abandoned: noMetric("SERVER_VALIDATED", serverSources, "Focus Service", ["focusSessionId"]),
  focus_interruption_recorded: policy({
    minimumEvidence: "SERVER_VALIDATED",
    allowedSources: serverSources,
    requiredReferences: ["focusSessionId"],
    metricEffect: "DELTA",
    intendedProducer: "Focus Service",
  }),
  focus_resource_handoff_started: noMetric("CLIENT_OBSERVED", clientSources, "Focus Service"),
  focus_resource_handoff_returned: noMetric("CLIENT_OBSERVED", clientSources, "Focus Service"),
  lecture_resource_launched: noMetric("CLIENT_OBSERVED", clientSources, "Lecture Service", ["lectureId"]),
  lecture_progress_recorded: noMetric("SERVER_VALIDATED", serverSources, "Lecture Progress Service", ["lectureId"]),
  lecture_completion_confirmed: policy({
    minimumEvidence: "SERVER_VALIDATED",
    allowedSources: serverSources,
    requiredReferences: ["lectureId"],
    metricEffect: "DELTA",
    intendedProducer: "Lecture Progress Service",
  }),
  mcq_attempted: policy({
    minimumEvidence: "SERVER_VALIDATED",
    allowedSources: serverSources,
    requiredReferences: ["mcqId"],
    metricEffect: "DELTA",
    intendedProducer: "MCQ Grading Service",
  }),
  mcq_reviewed: noMetric("SERVER_VALIDATED", serverSources, "MCQ Grading Service", ["mcqId"]),
  flashcard_reviewed: policy({
    minimumEvidence: "SERVER_VALIDATED",
    allowedSources: serverSources,
    requiredReferences: ["flashcardId"],
    metricEffect: "DELTA",
    intendedProducer: "Flashcard Review Service",
  }),
  flashcard_progress_updated: noMetric("SERVER_VALIDATED", serverSources, "Flashcard Review Service", ["flashcardId"]),
  spaced_recall_presented: noMetric("SERVER_VALIDATED", serverSources, "Recall Service"),
  spaced_recall_answered: policy({
    minimumEvidence: "SERVER_VALIDATED",
    allowedSources: serverSources,
    metricEffect: "DELTA",
    intendedProducer: "Recall Service",
  }),
  spaced_recall_skipped: noMetric("SERVER_VALIDATED", serverSources, "Recall Service"),
  group_focus_joined: noMetric("CLIENT_OBSERVED", clientSources, "Group Focus Verification"),
  group_focus_round_completed: {
    ...noMetric("REALTIME_VERIFIED", realtimeSources, "Group Focus Verification"),
    metricEffect: "DEFERRED",
  },
  group_focus_left: noMetric("CLIENT_OBSERVED", clientSources, "Group Focus Verification"),
  group_focus_summary_completed: {
    ...noMetric("REALTIME_VERIFIED", realtimeSources, "Group Focus Verification"),
    metricEffect: "DEFERRED",
  },
  study_event_rejected: {
    ...noMetric("ADMIN_VERIFIED", ["backend"], "Integrity Service"),
    privacyClass: "ADMIN_SECURITY",
  },
  study_event_flagged: {
    ...noMetric("ADMIN_VERIFIED", ["backend"], "Integrity Service"),
    privacyClass: "ADMIN_SECURITY",
  },
  study_event_reconciled: {
    ...noMetric("ADMIN_VERIFIED", ["backend"], "Integrity Service"),
    privacyClass: "SYSTEM_INTERNAL",
  },
};

export const STUDY_EVENT_POLICY_REGISTRY: Readonly<Record<StudyEventType, StudyEventPolicy>> =
  Object.fromEntries(
    STUDY_EVENT_TYPES.map((eventType) => [
      eventType,
      { ...registry[eventType], payloadSchema: STUDY_EVENT_PAYLOAD_SCHEMAS[eventType] },
    ]),
  ) as Record<StudyEventType, StudyEventPolicy>;

export function getStudyEventPolicy(eventType: StudyEventType): StudyEventPolicy {
  return STUDY_EVENT_POLICY_REGISTRY[eventType];
}

export function evidenceMeetsPolicy(
  evidenceClass: EvidenceClass,
  minimumEvidence: EvidenceClass,
): boolean {
  return getEvidenceRank(evidenceClass) >= getEvidenceRank(minimumEvidence);
}

export function getMetricDelta(eventType: StudyEventType, payload: unknown): MetricDelta | null {
  const validation = STUDY_EVENT_PAYLOAD_SCHEMAS[eventType].safeParse(payload);
  if (!validation.success) return null;
  const data = validation.data as Record<string, unknown>;
  switch (eventType) {
    case "focus_session_completed":
      if (
        !Number.isInteger(data.activeSeconds) ||
        Number(data.activeSeconds) < 0 ||
        Number(data.activeSeconds) > MAX_ACTIVE_SECONDS
      ) return null;
      return { focusSeconds: Number(data.activeSeconds), sessionsCompleted: 1 };
    case "focus_interruption_recorded":
      return { interruptionCount: 1 };
    case "mcq_attempted":
      return { mcqAttempts: 1, mcqCorrect: data.correct === true ? 1 : 0 };
    case "flashcard_reviewed":
      return { flashcardReviews: 1 };
    case "spaced_recall_answered":
      return { recallAttempts: 1, recallCorrect: data.response === "CORRECT" ? 1 : 0 };
    case "lecture_completion_confirmed":
      return { lectureCompletions: 1 };
    default:
      return null;
  }
}