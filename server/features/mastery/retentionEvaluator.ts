import type {
  LectureMasteryState,
  LectureRetentionReviewState,
} from "@prisma/client";
import {
  RETENTION_DECAY_POINTS_PER_MISSED_INTERVAL,
  RETENTION_INTERVAL_MS,
  RETENTION_RULE_VERSION,
  RETENTION_SCORE_BANDS,
  RETENTION_URGENCY_BY_REVIEW_STATE,
} from "./retentionConstants.js";
import { detectLectureForgetting } from "./forgettingDetection.js";
import type {
  LectureRetentionEvaluation,
  LectureRetentionMemoryEvidence,
  RetentionMasterySource,
} from "./retentionTypes.js";

export function evaluateLectureRetention(input: {
  mastery: RetentionMasterySource & { userId?: string; lectureId?: string };
  memoryEvidence: LectureRetentionMemoryEvidence;
  asOf: Date;
}): LectureRetentionEvaluation {
  const { mastery, memoryEvidence, asOf } = input;
  if (!Number.isFinite(asOf.getTime())) {
    throw new TypeError("Lecture Retention requires a valid asOf timestamp.");
  }
  if (
    memoryEvidence.userId.length === 0 ||
    memoryEvidence.lectureId.length === 0 ||
    (mastery.userId && mastery.userId !== memoryEvidence.userId) ||
    (mastery.lectureId && mastery.lectureId !== memoryEvidence.lectureId)
  ) {
    throw new TypeError("Retention source identity does not match its evidence.");
  }

  const summary = detectLectureForgetting(memoryEvidence, asOf);
  const base = {
    userId: memoryEvidence.userId,
    lectureId: memoryEvidence.lectureId,
    sourceMasteryRevision: mastery.revision,
    sourceMasteryRuleVersion: mastery.ruleVersion,
    lastPositiveMemoryEvidenceAt: summary.lastPositiveMemoryEvidenceAt,
    lastNegativeMemoryEvidenceAt: summary.lastNegativeMemoryEvidenceAt,
    lastForgettingEvidenceAt: summary.lastForgettingEvidenceAt,
    objectiveForgettingItemCount: summary.objectiveForgettingItemCount,
    selfReportedForgettingItemCount: summary.selfReportedForgettingItemCount,
    forgettingEvidenceKind: summary.forgettingEvidenceKind,
    ruleVersion: RETENTION_RULE_VERSION,
  } satisfies Omit<
    LectureRetentionEvaluation,
    | "effectiveMasteryState"
    | "retentionScore"
    | "reviewState"
    | "reviewUrgencyScore"
    | "retentionAnchorAt"
    | "nextReviewAt"
    | "nextEvaluationAt"
  >;

  if (!summary.retentionAnchorAt) {
    return {
      ...base,
      effectiveMasteryState: mastery.state,
      retentionScore: null,
      reviewState: "INSUFFICIENT_EVIDENCE",
      reviewUrgencyScore: 0,
      retentionAnchorAt: null,
      nextReviewAt: null,
      nextEvaluationAt: null,
    };
  }

  const state = mastery.state;
  const retentionAnchorAt =
    state === "NEEDS_REVIEW"
      ? summary.lastNegativeMemoryEvidenceAt ?? summary.retentionAnchorAt
      : summary.retentionAnchorAt;
  const baseScore = clampToStateBand(state, mastery.evidenceScore);
  const interval = RETENTION_INTERVAL_MS[state];
  const activeForgetting = summary.lastForgettingEvidenceAt !== null;

  if (state === "NOT_STARTED") {
    return {
      ...base,
      effectiveMasteryState: "NOT_STARTED",
      retentionScore: 0,
      reviewState: "INSUFFICIENT_EVIDENCE",
      reviewUrgencyScore: 0,
      retentionAnchorAt,
      nextReviewAt: null,
      nextEvaluationAt: null,
    };
  }

  if (state === "NEEDS_REVIEW" || interval === null) {
    return {
      ...base,
      effectiveMasteryState: state,
      retentionScore: baseScore,
      reviewState: "DUE",
      reviewUrgencyScore: activeForgetting
        ? 100
        : RETENTION_URGENCY_BY_REVIEW_STATE.DUE,
      retentionAnchorAt,
      nextReviewAt:
        summary.lastForgettingEvidenceAt ??
        summary.lastNegativeMemoryEvidenceAt ??
        retentionAnchorAt,
      nextEvaluationAt: null,
    };
  }

  const elapsedMs = asOf.getTime() - retentionAnchorAt.getTime();
  const decaySteps = calculateDecaySteps(retentionAnchorAt, interval, asOf);
  const retentionScore = Math.max(
    0,
    baseScore - decaySteps * RETENTION_DECAY_POINTS_PER_MISSED_INTERVAL,
  );

  let reviewState: LectureRetentionReviewState =
    elapsedMs < interval / 2
      ? "FRESH"
      : elapsedMs < interval
        ? "DUE_SOON"
        : elapsedMs < interval * 2
          ? "DUE"
          : "OVERDUE";
  let nextReviewAt = new Date(retentionAnchorAt.getTime() + interval);
  let reviewUrgencyScore =
    RETENTION_URGENCY_BY_REVIEW_STATE[reviewState];

  if (activeForgetting) {
    reviewState = "DUE";
    nextReviewAt = new Date(summary.lastForgettingEvidenceAt!.getTime());
    reviewUrgencyScore = 100;
  }

  return {
    ...base,
    effectiveMasteryState: effectiveStateForScore(state, retentionScore),
    retentionScore,
    reviewState,
    reviewUrgencyScore,
    retentionAnchorAt,
    nextReviewAt,
    nextEvaluationAt: nextEvaluationBoundary(retentionAnchorAt, interval, asOf),
  };
}

export function clampToStateBand(
  state: LectureMasteryState,
  evidenceScore: number,
): number {
  const band = RETENTION_SCORE_BANDS[state];
  const safeScore = Number.isFinite(evidenceScore)
    ? Math.trunc(evidenceScore)
    : band.min;
  return Math.min(band.max, Math.max(band.min, safeScore));
}

export function effectiveStateForScore(
  baseState: LectureMasteryState,
  retentionScore: number,
): LectureMasteryState {
  switch (baseState) {
    case "NOT_STARTED":
    case "STARTED":
    case "NEEDS_REVIEW":
      return baseState;
    case "LEARNING":
      return retentionScore >= 40 ? "LEARNING" : "NEEDS_REVIEW";
    case "GOOD":
      if (retentionScore >= 65) return "GOOD";
      return retentionScore >= 40 ? "LEARNING" : "NEEDS_REVIEW";
    case "MASTERED":
      if (retentionScore >= 85) return "MASTERED";
      if (retentionScore >= 65) return "GOOD";
      return retentionScore >= 40 ? "LEARNING" : "NEEDS_REVIEW";
  }
}

export function calculateDecaySteps(
  retentionAnchorAt: Date,
  intervalMs: number,
  asOf: Date,
): number {
  if (
    !Number.isFinite(retentionAnchorAt.getTime()) ||
    !Number.isFinite(asOf.getTime()) ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs <= 0
  ) {
    throw new TypeError("Retention decay requires valid time values.");
  }
  return Math.max(
    0,
    Math.floor((asOf.getTime() - retentionAnchorAt.getTime()) / intervalMs) - 1,
  );
}

function nextEvaluationBoundary(
  anchor: Date,
  interval: number,
  asOf: Date,
): Date {
  const elapsed = asOf.getTime() - anchor.getTime();
  const boundaries = [
    anchor.getTime() + interval / 2,
    anchor.getTime() + interval,
    anchor.getTime() + interval * 2,
  ];
  const nextDecayInterval = Math.max(2, Math.floor(elapsed / interval) + 1);
  boundaries.push(anchor.getTime() + nextDecayInterval * interval);
  const future = boundaries.filter((boundary) => boundary > asOf.getTime());
  const next = future.length > 0
    ? Math.min(...future)
    : anchor.getTime() + Math.max(2, Math.floor(elapsed / interval) + 1) * interval;
  return new Date(next);
}
