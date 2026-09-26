import type { Prisma, RecallAttempt, RecallItemState } from "@prisma/client";
import type { EvidenceClass } from "../study-core/evidence.js";
import type { PrivacyClass } from "../study-core/privacy.js";
import type {
  RecallAnswerKind,
  RecallAnswerOutcome,
  RecallAttemptStatus,
  RecallFlashcardRating,
  RecallItemType,
  RecallMcqOption,
  RecallTerminalOutcome,
} from "./constants.js";

export type RecallTransaction = Prisma.TransactionClient;

export type RecallAttemptAnswer =
  | { kind: "MCQ_OPTION"; value: RecallMcqOption }
  | { kind: "FLASHCARD_RECALL_RATING"; value: RecallFlashcardRating };

export interface IssueRecallAttemptInput {
  userId: string;
  itemType: RecallItemType;
  itemId: string;
  /** Internal callers may supply context, but it must match canonical content. */
  lectureId?: string;
  issuanceIdempotencyKey: string;
  /** Server-owned timestamp supplied by an internal caller, never by a route. */
  presentedAt?: Date;
  expiresAt?: Date | null;
  tx?: RecallTransaction;
}

export interface RecallAttemptFact {
  id: string;
  userId: string;
  itemType: RecallItemType;
  itemId: string;
  lectureId: string;
  status: RecallAttemptStatus;
  presentedAt: Date;
  expiresAt: Date | null;
  answeredAt: Date | null;
  skippedAt: Date | null;
  expiredAt: Date | null;
  answerKind: RecallAnswerKind | null;
  answerValue: string | null;
  outcome: RecallAnswerOutcome | null;
  evidenceClass: EvidenceClass;
  privacyClass: PrivacyClass;
  createdAt: Date;
}

export interface DerivedRecallItemState {
  lectureId: string;
  presentationCount: number;
  answerCount: number;
  skipCount: number;
  objectiveCorrectCount: number;
  objectiveIncorrectCount: number;
  selfReportedHardCount: number;
  selfReportedMediumCount: number;
  selfReportedEasyCount: number;
  lastPresentedAt: Date | null;
  lastAnsweredAt: Date | null;
  lastSkippedAt: Date | null;
  lastOutcome: RecallTerminalOutcome | null;
  revision: number;
}

export type RecallAttemptRow = RecallAttempt;
export type RecallItemStateRow = RecallItemState;

export interface PublicRecallTransition {
  attemptId: string;
  status: RecallAttemptStatus;
  outcome: RecallTerminalOutcome | null;
  evidenceClass: EvidenceClass;
  replayed: boolean;
}

export interface RecallAttemptService {
  issue(input: IssueRecallAttemptInput): Promise<RecallAttemptRow>;
  answer(
    userId: string,
    attemptId: string,
    answer: RecallAttemptAnswer,
  ): Promise<PublicRecallTransition>;
  skip(userId: string, attemptId: string): Promise<PublicRecallTransition>;
  expire(userId: string, attemptId: string): Promise<PublicRecallTransition>;
}