import type {
  RecallLectureStudyFact,
  RecallMemoryEvidence,
  RecallMemoryOutcome,
  RecallStudiedLectureEvidence,
  RecallStudiedLectureSource,
} from "./candidateTypes.js";
import type { RecallItemType } from "./constants.js";
import { RECALL_CANDIDATE_LIMITS } from "./candidateWeights.js";

const STUDY_EVENT_SOURCE_BY_TYPE: Readonly<Record<string, RecallStudiedLectureSource>> =
  Object.freeze({
    mcq_attempted: "MCQ",
    mcq_reviewed: "MCQ",
    flashcard_reviewed: "FLASHCARD",
    lecture_completion_confirmed: "SERVER_STUDY_PROGRESS",
  });

export function recallStudySourceForEventType(
  eventType: string,
): RecallStudiedLectureSource | null {
  return STUDY_EVENT_SOURCE_BY_TYPE[eventType] ?? null;
}

export interface FocusStudyEvidenceFact {
  userId: string;
  lectureId: string;
  status: string;
  activeSeconds: number;
  completedAt: Date | null;
}

export interface GroupFocusStudyEvidenceFact {
  userId: string;
  lectureId: string;
  verifiedFocusSeconds: number;
  completedAt: Date;
}

export interface StudyEventLectureEvidenceFact {
  userId: string;
  lectureId: string | null;
  eventType: string;
  source: string;
  occurredAt: Date;
  evidenceClass: string;
  privacyClass: string;
}

export function isQualifyingFocusStudyEvidence(
  fact: FocusStudyEvidenceFact,
  userId: string,
  asOf: Date,
): boolean {
  return (
    fact.userId === userId &&
    fact.status === "COMPLETED" &&
    fact.activeSeconds >= RECALL_CANDIDATE_LIMITS.meaningfulFocusSeconds &&
    Boolean(fact.lectureId) &&
    fact.completedAt instanceof Date &&
    Number.isFinite(fact.completedAt.getTime()) &&
    fact.completedAt.getTime() <= asOf.getTime()
  );
}

export function isQualifyingGroupFocusStudyEvidence(
  fact: GroupFocusStudyEvidenceFact,
  userId: string,
  asOf: Date,
): boolean {
  return (
    fact.userId === userId &&
    fact.verifiedFocusSeconds > 0 &&
    Boolean(fact.lectureId) &&
    fact.completedAt instanceof Date &&
    Number.isFinite(fact.completedAt.getTime()) &&
    fact.completedAt.getTime() <= asOf.getTime()
  );
}

export function normalizeStudyEventLectureEvidence(
  fact: StudyEventLectureEvidenceFact,
  userId: string,
  asOf: Date,
): RecallLectureStudyFact | null {
  const evidenceSource = STUDY_EVENT_SOURCE_BY_TYPE[fact.eventType];
  if (
    fact.userId !== userId ||
    !fact.lectureId ||
    !evidenceSource ||
    (fact.source !== "backend" && fact.source !== "offline_replay") ||
    fact.evidenceClass !== "SERVER_VALIDATED" ||
    fact.privacyClass !== "PRIVATE_STUDY" ||
    !(fact.occurredAt instanceof Date) ||
    !Number.isFinite(fact.occurredAt.getTime()) ||
    fact.occurredAt.getTime() > asOf.getTime()
  ) {
    return null;
  }

  return {
    lectureId: fact.lectureId,
    studiedAt: fact.occurredAt,
    evidenceSource,
  };
}

export function mergeRecallLectureStudyFacts(
  facts: readonly RecallLectureStudyFact[],
): RecallStudiedLectureEvidence[] {
  const merged = new Map<
    string,
    {
      firstStudiedAt: Date;
      lastStudiedAt: Date;
      evidenceSources: Set<RecallStudiedLectureSource>;
    }
  >();

  for (const fact of facts) {
    if (!fact.lectureId || !Number.isFinite(fact.studiedAt.getTime())) continue;
    const current = merged.get(fact.lectureId);
    if (!current) {
      merged.set(fact.lectureId, {
        firstStudiedAt: fact.studiedAt,
        lastStudiedAt: fact.studiedAt,
        evidenceSources: new Set([fact.evidenceSource]),
      });
      continue;
    }
    if (fact.studiedAt.getTime() < current.firstStudiedAt.getTime()) {
      current.firstStudiedAt = fact.studiedAt;
    }
    if (fact.studiedAt.getTime() > current.lastStudiedAt.getTime()) {
      current.lastStudiedAt = fact.studiedAt;
    }
    current.evidenceSources.add(fact.evidenceSource);
  }

  return [...merged.entries()]
    .map(([lectureId, evidence]) => ({
      lectureId,
      firstStudiedAt: evidence.firstStudiedAt,
      lastStudiedAt: evidence.lastStudiedAt,
      evidenceSources: [...evidence.evidenceSources].sort(compareText),
    }))
    .sort(
      (left, right) =>
        right.lastStudiedAt.getTime() - left.lastStudiedAt.getTime() ||
        compareText(left.lectureId, right.lectureId),
    );
}

export function normalizeRecallMemoryOutcome(
  itemType: RecallItemType,
  outcome: string,
): RecallMemoryOutcome | null {
  if (itemType === "MCQ") {
    if (outcome === "CORRECT") return "OBJECTIVE_CORRECT";
    if (outcome === "INCORRECT") return "OBJECTIVE_INCORRECT";
    return null;
  }

  if (outcome === "SELF_REPORTED_HARD") {
    return "SELF_REPORTED_NOT_REMEMBERED";
  }
  if (outcome === "SELF_REPORTED_MEDIUM") {
    return "SELF_REPORTED_NEUTRAL";
  }
  if (outcome === "SELF_REPORTED_EASY") {
    return "SELF_REPORTED_REMEMBERED";
  }
  return null;
}

export function normalizeStudyEventMemoryOutcome(
  itemType: RecallItemType,
  rawValue: string | null,
): RecallMemoryOutcome | null {
  if (itemType === "MCQ") {
    if (rawValue === "true") return "OBJECTIVE_CORRECT";
    if (rawValue === "false") return "OBJECTIVE_INCORRECT";
    return null;
  }
  if (rawValue === "AGAIN") return "SELF_REPORTED_NOT_REMEMBERED";
  if (rawValue === "HARD" || rawValue === "GOOD" || rawValue === "EASY") {
    return "SELF_REPORTED_REMEMBERED";
  }
  return null;
}

export function isPositiveRecallMemoryOutcome(
  itemType: RecallItemType,
  outcome: RecallMemoryOutcome,
): boolean {
  return itemType === "MCQ"
    ? outcome === "OBJECTIVE_CORRECT"
    : outcome === "SELF_REPORTED_REMEMBERED";
}

export function isWeaknessRecallMemoryOutcome(
  outcome: RecallMemoryOutcome,
): boolean {
  return (
    outcome === "OBJECTIVE_INCORRECT" ||
    outcome === "SELF_REPORTED_NOT_REMEMBERED"
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}