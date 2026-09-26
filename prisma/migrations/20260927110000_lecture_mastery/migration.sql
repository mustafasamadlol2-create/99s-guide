CREATE TYPE "LectureMasteryState" AS ENUM (
  'NOT_STARTED',
  'STARTED',
  'LEARNING',
  'NEEDS_REVIEW',
  'GOOD',
  'MASTERED'
);

CREATE TABLE "LectureMastery" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "lectureId" TEXT NOT NULL,
  "state" "LectureMasteryState" NOT NULL DEFAULT 'NOT_STARTED',
  "evidenceScore" INTEGER NOT NULL DEFAULT 0,
  "evidenceCount" INTEGER NOT NULL DEFAULT 0,
  "objectiveAttemptCount" INTEGER NOT NULL DEFAULT 0,
  "objectiveCorrectCount" INTEGER NOT NULL DEFAULT 0,
  "objectiveIncorrectCount" INTEGER NOT NULL DEFAULT 0,
  "flashcardReviewCount" INTEGER NOT NULL DEFAULT 0,
  "flashcardRememberedCount" INTEGER NOT NULL DEFAULT 0,
  "flashcardNotRememberedCount" INTEGER NOT NULL DEFAULT 0,
  "recallObjectiveAttemptCount" INTEGER NOT NULL DEFAULT 0,
  "recallObjectiveCorrectCount" INTEGER NOT NULL DEFAULT 0,
  "recallObjectiveIncorrectCount" INTEGER NOT NULL DEFAULT 0,
  "meaningfulFocusSessionCount" INTEGER NOT NULL DEFAULT 0,
  "meaningfulFocusSeconds" INTEGER NOT NULL DEFAULT 0,
  "lastStudyEvidenceAt" TIMESTAMP(3),
  "lastObjectiveEvidenceAt" TIMESTAMP(3),
  "lastRecallEvidenceAt" TIMESTAMP(3),
  "ruleVersion" TEXT NOT NULL DEFAULT 'mastery-v1',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "lastEvaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LectureMastery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lecture_mastery_evidence_score_range"
    CHECK ("evidenceScore" >= 0 AND "evidenceScore" <= 100),
  CONSTRAINT "lecture_mastery_counts_nonnegative"
    CHECK (
      "evidenceCount" >= 0
      AND "objectiveAttemptCount" >= 0
      AND "objectiveCorrectCount" >= 0
      AND "objectiveIncorrectCount" >= 0
      AND "flashcardReviewCount" >= 0
      AND "flashcardRememberedCount" >= 0
      AND "flashcardNotRememberedCount" >= 0
      AND "recallObjectiveAttemptCount" >= 0
      AND "recallObjectiveCorrectCount" >= 0
      AND "recallObjectiveIncorrectCount" >= 0
      AND "meaningfulFocusSessionCount" >= 0
      AND "meaningfulFocusSeconds" >= 0
      AND "revision" >= 0
    ),
  CONSTRAINT "lecture_mastery_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lecture_mastery_lectureId_fkey"
    FOREIGN KEY ("lectureId") REFERENCES "Lecture"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "lecture_mastery_user_lecture_key"
  ON "LectureMastery"("userId", "lectureId");
CREATE INDEX "lecture_mastery_user_state_idx"
  ON "LectureMastery"("userId", "state");
CREATE INDEX "lecture_mastery_user_evaluated_idx"
  ON "LectureMastery"("userId", "lastEvaluatedAt");
CREATE INDEX "lecture_mastery_lecture_state_idx"
  ON "LectureMastery"("lectureId", "state");