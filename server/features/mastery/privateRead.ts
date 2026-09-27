import { getPrisma } from "../../services/prismaClient.js";
import { LectureMasteryError } from "./errors.js";
import { refreshLectureRetention } from "./retentionRefresh.js";

export async function getMyLectureMasteryWithRetention(input: {
  userId: string;
  lectureId: string;
}): Promise<{
  lectureId: string;
  state: string;
  evidenceState: string;
  effectiveState: string;
  reviewState: string;
  reviewUrgency: string;
  nextReviewAt: string | null;
  ruleVersion: string;
  retentionRuleVersion: string;
  lastEvaluatedAt: string;
  retentionLastEvaluatedAt: string;
  evidence: {
    objectiveAttempts: number;
    objectiveCorrect: number;
    objectiveAccuracyPercent: number | null;
    flashcardReviews: number;
    meaningfulFocusSeconds: number;
    recallObjectiveAttempts: number;
  };
}> {
  const database = getPrisma();
  const lecture = await database.lecture.findUnique({
    where: { id: input.lectureId },
    select: { id: true },
  });
  if (!lecture) {
    throw new LectureMasteryError("LECTURE_NOT_FOUND", "Lecture not found.");
  }

  const retention = await refreshLectureRetention(input);
  const mastery = retention.mastery;
  return {
    lectureId: mastery.row.lectureId,
    state: mastery.row.state,
    evidenceState: mastery.row.state,
    effectiveState: retention.row.effectiveMasteryState,
    reviewState: retention.row.reviewState,
    reviewUrgency: retention.row.reviewState,
    nextReviewAt: retention.row.nextReviewAt?.toISOString() ?? null,
    ruleVersion: mastery.row.ruleVersion,
    retentionRuleVersion: retention.row.ruleVersion,
    lastEvaluatedAt: mastery.row.lastEvaluatedAt.toISOString(),
    retentionLastEvaluatedAt: retention.row.lastEvaluatedAt.toISOString(),
    evidence: {
      objectiveAttempts: mastery.row.objectiveAttemptCount,
      objectiveCorrect: mastery.row.objectiveCorrectCount,
      objectiveAccuracyPercent: mastery.evaluation.objectiveAccuracyPercent,
      flashcardReviews: mastery.row.flashcardReviewCount,
      meaningfulFocusSeconds: mastery.row.meaningfulFocusSeconds,
      recallObjectiveAttempts: mastery.row.recallObjectiveAttemptCount,
    },
  };
}