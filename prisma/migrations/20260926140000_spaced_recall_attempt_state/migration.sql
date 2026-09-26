CREATE TABLE "RecallAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemType" VARCHAR(16) NOT NULL,
    "itemId" TEXT NOT NULL,
    "lectureId" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PRESENTED',
    "presentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "answerKind" VARCHAR(32),
    "answerValue" VARCHAR(32),
    "outcome" VARCHAR(48),
    "evidenceClass" VARCHAR(32) NOT NULL DEFAULT 'SERVER_VALIDATED',
    "privacyClass" VARCHAR(32) NOT NULL DEFAULT 'PRIVATE_STUDY',
    "issuanceIdempotencyKey" VARCHAR(200) NOT NULL,
    "issuanceFingerprint" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecallAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RecallAttempt_item_type_check"
      CHECK ("itemType" IN ('MCQ', 'FLASHCARD')),
    CONSTRAINT "RecallAttempt_status_check"
      CHECK ("status" IN ('PRESENTED', 'ANSWERED', 'SKIPPED', 'EXPIRED')),
    CONSTRAINT "RecallAttempt_evidence_class_check"
      CHECK ("evidenceClass" IN ('CLIENT_OBSERVED', 'SERVER_VALIDATED', 'SERVER_DERIVED')),
    CONSTRAINT "RecallAttempt_private_study_check"
      CHECK ("privacyClass" = 'PRIVATE_STUDY'),
    CONSTRAINT "RecallAttempt_lifecycle_check"
      CHECK (
        (
          "status" = 'PRESENTED'
          AND "answeredAt" IS NULL
          AND "skippedAt" IS NULL
          AND "expiredAt" IS NULL
          AND "answerKind" IS NULL
          AND "answerValue" IS NULL
          AND "outcome" IS NULL
        )
        OR (
          "status" = 'ANSWERED'
          AND "answeredAt" IS NOT NULL
          AND "skippedAt" IS NULL
          AND "expiredAt" IS NULL
          AND (
            (
              "itemType" = 'MCQ'
              AND "answerKind" = 'MCQ_OPTION'
              AND "answerValue" IN ('A', 'B', 'C', 'D')
              AND "outcome" IN ('CORRECT', 'INCORRECT')
              AND "evidenceClass" = 'SERVER_DERIVED'
            )
            OR (
              "itemType" = 'FLASHCARD'
              AND "answerKind" = 'FLASHCARD_RECALL_RATING'
              AND "answerValue" IN ('hard', 'medium', 'easy')
              AND "outcome" IN (
                'SELF_REPORTED_HARD',
                'SELF_REPORTED_MEDIUM',
                'SELF_REPORTED_EASY'
              )
              AND "evidenceClass" = 'CLIENT_OBSERVED'
            )
          )
        )
        OR (
          "status" = 'SKIPPED'
          AND "answeredAt" IS NULL
          AND "skippedAt" IS NOT NULL
          AND "expiredAt" IS NULL
          AND "answerKind" IS NULL
          AND "answerValue" IS NULL
          AND "outcome" IS NULL
          AND "evidenceClass" = 'SERVER_VALIDATED'
        )
        OR (
          "status" = 'EXPIRED'
          AND "answeredAt" IS NULL
          AND "skippedAt" IS NULL
          AND "expiredAt" IS NOT NULL
          AND "answerKind" IS NULL
          AND "answerValue" IS NULL
          AND "outcome" IS NULL
          AND "evidenceClass" = 'SERVER_VALIDATED'
        )
      ),
    CONSTRAINT "RecallAttempt_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "recall_attempt_user_issuance_key"
  ON "RecallAttempt"("userId", "issuanceIdempotencyKey");
CREATE INDEX "recall_attempt_user_status_presented_idx"
  ON "RecallAttempt"("userId", "status", "presentedAt");
CREATE INDEX "recall_attempt_user_item_presented_idx"
  ON "RecallAttempt"("userId", "itemType", "itemId", "presentedAt");
CREATE INDEX "recall_attempt_item_presented_idx"
  ON "RecallAttempt"("itemType", "itemId", "presentedAt");

CREATE TABLE "RecallItemState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemType" VARCHAR(16) NOT NULL,
    "itemId" TEXT NOT NULL,
    "lectureId" TEXT NOT NULL,
    "presentationCount" INTEGER NOT NULL DEFAULT 0,
    "answerCount" INTEGER NOT NULL DEFAULT 0,
    "skipCount" INTEGER NOT NULL DEFAULT 0,
    "objectiveCorrectCount" INTEGER NOT NULL DEFAULT 0,
    "objectiveIncorrectCount" INTEGER NOT NULL DEFAULT 0,
    "selfReportedHardCount" INTEGER NOT NULL DEFAULT 0,
    "selfReportedMediumCount" INTEGER NOT NULL DEFAULT 0,
    "selfReportedEasyCount" INTEGER NOT NULL DEFAULT 0,
    "lastPresentedAt" TIMESTAMP(3),
    "lastAnsweredAt" TIMESTAMP(3),
    "lastSkippedAt" TIMESTAMP(3),
    "lastOutcome" VARCHAR(48),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecallItemState_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RecallItemState_item_type_check"
      CHECK ("itemType" IN ('MCQ', 'FLASHCARD')),
    CONSTRAINT "RecallItemState_counter_check"
      CHECK (
        "presentationCount" >= 0
        AND "answerCount" >= 0
        AND "skipCount" >= 0
        AND "objectiveCorrectCount" >= 0
        AND "objectiveIncorrectCount" >= 0
        AND "selfReportedHardCount" >= 0
        AND "selfReportedMediumCount" >= 0
        AND "selfReportedEasyCount" >= 0
        AND "revision" >= 0
      ),
    CONSTRAINT "RecallItemState_last_outcome_check"
      CHECK (
        "lastOutcome" IS NULL
        OR "lastOutcome" IN (
          'CORRECT',
          'INCORRECT',
          'SELF_REPORTED_HARD',
          'SELF_REPORTED_MEDIUM',
          'SELF_REPORTED_EASY',
          'SKIPPED',
          'EXPIRED'
        )
      ),
    CONSTRAINT "RecallItemState_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "recall_item_state_user_item_key"
  ON "RecallItemState"("userId", "itemType", "itemId");
CREATE INDEX "recall_item_state_user_presented_idx"
  ON "RecallItemState"("userId", "lastPresentedAt");
CREATE INDEX "recall_item_state_user_lecture_presented_idx"
  ON "RecallItemState"("userId", "lectureId", "lastPresentedAt");