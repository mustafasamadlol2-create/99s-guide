import type { RecallAttempt } from "@prisma/client";
import type { RecallTransaction } from "./types.js";
import type { RecallItemType } from "./constants.js";

export type RecallStudiedLectureSource =
  | "FOCUS"
  | "GROUP_FOCUS"
  | "MCQ"
  | "FLASHCARD"
  | "SERVER_STUDY_PROGRESS";

export interface RecallStudiedLectureEvidence {
  lectureId: string;
  firstStudiedAt: Date;
  lastStudiedAt: Date;
  evidenceSources: RecallStudiedLectureSource[];
}

export type RecallMemoryOutcome =
  | "OBJECTIVE_CORRECT"
  | "OBJECTIVE_INCORRECT"
  | "SELF_REPORTED_REMEMBERED"
  | "SELF_REPORTED_NOT_REMEMBERED"
  | "SELF_REPORTED_NEUTRAL";

export type RecallMemorySource = "PROMPT28_RECALL" | "STUDY_EVENT";

export interface RecallMemoryEvidence {
  itemType: RecallItemType;
  itemId: string;
  occurredAt: Date;
  outcome: RecallMemoryOutcome;
  evidenceClass: string;
  source: RecallMemorySource;
  sourceId: string;
}

export interface RecallCandidateItem {
  itemType: RecallItemType;
  itemId: string;
  lectureId: string;
}

export interface RecallCandidateItemState {
  itemType: RecallItemType;
  itemId: string;
  lastPresentedAt: Date | null;
  lastAnsweredAt: Date | null;
  lastOutcome: string | null;
}

export interface RecallCandidate {
  itemType: RecallItemType;
  itemId: string;
  lectureId: string;
  weaknessScore: number;
  forgettingUrgencyScore: number;
  recencyPreferenceScore: number;
  candidateScore: number;
  candidateVersion: typeof import("./candidateWeights.js").RECALL_CANDIDATE_VERSION;
  lastPresentedAt?: Date;
  lastPositiveMemoryEvidenceAt?: Date;
}

export interface RecallCandidateSelectionInput {
  userId: string;
  asOf: Date;
  tx?: RecallTransaction;
}

export interface RecallCandidatePreviewInput extends RecallCandidateSelectionInput {
  limit?: number;
}

export interface SelectAndIssueRecallCandidateInput {
  userId: string;
  asOf: Date;
  issuanceIdempotencyKey: string;
  selectionContextId?: string;
  expiresAt?: Date | null;
  tx?: RecallTransaction;
}

export interface RecallCandidateService {
  selectRecallCandidate(
    input: RecallCandidateSelectionInput,
  ): Promise<RecallCandidate>;
  previewRecallCandidates(
    input: RecallCandidatePreviewInput,
  ): Promise<RecallCandidate[]>;
  selectAndIssueRecallCandidate(
    input: SelectAndIssueRecallCandidateInput,
  ): Promise<RecallAttempt>;
}

export interface RecallLectureStudyFact {
  lectureId: string;
  studiedAt: Date;
  evidenceSource: RecallStudiedLectureSource;
}