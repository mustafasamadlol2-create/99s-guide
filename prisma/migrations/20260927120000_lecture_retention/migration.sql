CREATE TYPE "LectureRetentionReviewState" AS ENUM (
  'INSUFFICIENT_EVIDENCE',
  'FRESH',
  'DUE_SOON',
  'DUE',
  'OVERDUE'
);

CREATE TYPE "LectureRetentionForgettingEvidenceKind" AS ENUM (
  'NONE',
  'OBJECTIVE',
  'SELF_REPORTED',
  'MIXED'
);

CREATE TABLE "LectureRetention" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "lectureId" TEXT NOT NULL,
  "sourceMasteryRevision" INTEGER NOT NULL,
  "sourceMasteryRuleVersion" TEXT NOT NULL,
  "effectiveMasteryState" "LectureMasteryState" NOT NULL DEFAULT 'NOT_STARTED',
  "retentionScore" INTEGER,
  "reviewState" "LectureRetentionReviewState" NOT NULL DEFAULT 'INSUFFICIENT_EVIDENCE',
  "reviewUrgencyScore" INTEGER NOT NULL DEFAULT 0,
  "retentionAnchorAt" TIMESTAMP(3),
  "nextReviewAt" TIMESTAMP(3),
  "nextEvaluationAt" TIMESTAMP(3),
  "lastPositiveMemoryEvidenceAt" TIMESTAMP(3),
  "lastNegativeMemoryEvidenceAt" TIMESTAMP(3),
  "lastForgettingEvidenceAt" TIMESTAMP(3),
  "objectiveForgettingItemCount" INTEGER NOT NULL DEFAULT 0,
  "selfReportedForgettingItemCount" INTEGER NOT NULL DEFAULT 0,
  "forgettingEvidenceKind" "LectureRetentionForgettingEvidenceKind" NOT NULL DEFAULT 'NONE',
  "ruleVersion" TEXT NOT NULL DEFAULT 'retention-v1',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "lastEvaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LectureRetention_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lecture_retention_score_range"
    CHECK ("retentionScore" IS NULL OR ("retentionScore" >= 0 AND "retentionScore" <= 100)),
  CONSTRAINT "lecture_retention_urgency_range"
    CHECK ("reviewUrgencyScore" >= 0 AND "reviewUrgencyScore" <= 100),
  CONSTRAINT "lecture_retention_counts_nonnegative"
    CHECK (
      "sourceMasteryRevision" >= 0
      AND "objectiveForgettingItemCount" >= 0
      AND "selfReportedForgettingItemCount" >= 0
      AND "revision" >= 0
    ),
  CONSTRAINT "lecture_retention_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lecture_retention_lectureId_fkey"
    FOREIGN KEY ("lectureId") REFERENCES "Lecture"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "lecture_retention_user_lecture_key"
  ON "LectureRetention"("userId", "lectureId");
CREATE INDEX "lecture_retention_user_review_due_idx"
  ON "LectureRetention"("userId", "reviewState", "nextReviewAt");
CREATE INDEX "lecture_retention_user_effective_state_idx"
  ON "LectureRetention"("userId", "effectiveMasteryState");
CREATE INDEX "lecture_retention_user_next_evaluation_idx"
  ON "LectureRetention"("userId", "nextEvaluationAt");