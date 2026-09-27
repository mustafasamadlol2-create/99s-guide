import type {
  LectureMastery as PrismaLectureMastery,
  LectureMasteryState,
  LectureRetention as PrismaLectureRetention,
  LectureRetentionForgettingEvidenceKind,
  LectureRetentionReviewState,
} from "@prisma/client";
import type {
  FlashcardOutcome,
  LectureMasteryEvaluation,
  ObjectiveOutcome,
} from "./types.js";

export type RetentionMasterySource = Pick<
  PrismaLectureMastery,
  "state" | "evidenceScore" | "revision" | "ruleVersion"
>;

export type LectureRetentionMemoryEvidence = {
  userId: string;
  lectureId: string;
  asOf: Date;
  objectiveOutcomes: ObjectiveOutcome[];
  flashcardOutcomes: FlashcardOutcome[];
};

export type LectureRetentionEvaluation = {
  userId: string;
  lectureId: string;
  sourceMasteryRevision: number;
  sourceMasteryRuleVersion: string;
  effectiveMasteryState: LectureMasteryState;
  retentionScore: number | null;
  reviewState: LectureRetentionReviewState;
  reviewUrgencyScore: number;
  retentionAnchorAt: Date | null;
  nextReviewAt: Date | null;
  nextEvaluationAt: Date | null;
  lastPositiveMemoryEvidenceAt: Date | null;
  lastNegativeMemoryEvidenceAt: Date | null;
  lastForgettingEvidenceAt: Date | null;
  objectiveForgettingItemCount: number;
  selfReportedForgettingItemCount: number;
  forgettingEvidenceKind: LectureRetentionForgettingEvidenceKind;
  ruleVersion: "retention-v1";
};

export type LectureRetentionProjection = PrismaLectureRetention;

export type LectureRetentionForgettingSummary = {
  retentionAnchorAt: Date | null;
  lastPositiveMemoryEvidenceAt: Date | null;
  lastNegativeMemoryEvidenceAt: Date | null;
  lastForgettingEvidenceAt: Date | null;
  objectiveForgettingItemCount: number;
  selfReportedForgettingItemCount: number;
  forgettingEvidenceKind: LectureRetentionForgettingEvidenceKind;
};

export type LectureRetentionSourceEvaluation = LectureMasteryEvaluation;