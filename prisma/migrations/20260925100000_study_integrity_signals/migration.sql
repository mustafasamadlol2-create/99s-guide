CREATE TABLE "IntegritySignal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionType" VARCHAR(96) NOT NULL,
    "observationCode" VARCHAR(96) NOT NULL,
    "category" VARCHAR(32) NOT NULL,
    "severity" VARCHAR(16) NOT NULL,
    "ruleId" VARCHAR(128) NOT NULL,
    "ruleVersion" VARCHAR(128) NOT NULL,
    "evidenceClass" VARCHAR(48) NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "privacyClass" VARCHAR(32) NOT NULL DEFAULT 'ADMIN_SECURITY',
    "signalFingerprint" CHAR(64) NOT NULL,
    "dedupBucket" INTEGER NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "resourceKind" VARCHAR(48),
    "resourceId" VARCHAR(128),
    "firstOccurredAt" TIMESTAMP(3) NOT NULL,
    "lastOccurredAt" TIMESTAMP(3) NOT NULL,
    "lastReceivedAt" TIMESTAMP(3) NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    "reviewVersion" INTEGER NOT NULL DEFAULT 0,
    "latestSafeDetails" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "IntegritySignal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "IntegritySignal_severity_check"
        CHECK ("severity" IN ('INFO', 'REVIEW', 'BLOCK')),
    CONSTRAINT "IntegritySignal_category_check"
        CHECK ("category" IN ('IDEMPOTENCY', 'RATE', 'TIMING', 'STATE', 'SOURCE', 'EVIDENCE', 'PAYLOAD', 'REPLAY', 'OWNERSHIP')),
    CONSTRAINT "IntegritySignal_privacyClass_check"
        CHECK ("privacyClass" IN ('ADMIN_SECURITY', 'SYSTEM_INTERNAL')),
    CONSTRAINT "IntegritySignal_status_check"
        CHECK ("status" IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED')),
    CONSTRAINT "IntegritySignal_occurrenceCount_check"
        CHECK ("occurrenceCount" > 0),
    CONSTRAINT "IntegritySignal_reviewVersion_check"
        CHECK ("reviewVersion" >= 0),
    CONSTRAINT "IntegritySignal_generation_check"
        CHECK ("generation" >= 0),
    CONSTRAINT "IntegritySignal_dedupBucket_check"
        CHECK ("dedupBucket" >= 0),
    CONSTRAINT "IntegritySignal_fingerprint_check"
        CHECK ("signalFingerprint" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "IntegritySignal_safeDetails_size_check"
        CHECK ("latestSafeDetails" IS NULL OR octet_length("latestSafeDetails"::text) <= 8192)
);

CREATE TABLE "IntegrityReviewAction" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "reviewerUserId" TEXT,
    "fromStatus" VARCHAR(16) NOT NULL,
    "toStatus" VARCHAR(16) NOT NULL,
    "actionType" VARCHAR(16) NOT NULL,
    "note" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrityReviewAction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "IntegrityReviewAction_fromStatus_check"
        CHECK ("fromStatus" IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED')),
    CONSTRAINT "IntegrityReviewAction_toStatus_check"
        CHECK ("toStatus" IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED')),
    CONSTRAINT "IntegrityReviewAction_actionType_check"
        CHECK ("actionType" IN ('ACKNOWLEDGE', 'RESOLVE', 'DISMISS', 'REOPEN', 'ADD_NOTE'))
);

CREATE UNIQUE INDEX "IntegritySignal_userId_signalFingerprint_dedupBucket_generation_key"
    ON "IntegritySignal"("userId", "signalFingerprint", "dedupBucket", "generation");
CREATE INDEX "IntegritySignal_status_severity_lastOccurredAt_idx"
    ON "IntegritySignal"("status", "severity", "lastOccurredAt");
CREATE INDEX "IntegritySignal_userId_status_lastOccurredAt_idx"
    ON "IntegritySignal"("userId", "status", "lastOccurredAt");
CREATE INDEX "IntegritySignal_actionType_status_lastOccurredAt_idx"
    ON "IntegritySignal"("actionType", "status", "lastOccurredAt");
CREATE INDEX "IntegritySignal_category_lastOccurredAt_idx"
    ON "IntegritySignal"("category", "lastOccurredAt");
CREATE INDEX "IntegritySignal_observationCode_lastOccurredAt_idx"
    ON "IntegritySignal"("observationCode", "lastOccurredAt");
CREATE INDEX "IntegritySignal_ruleId_lastOccurredAt_idx"
    ON "IntegritySignal"("ruleId", "lastOccurredAt");
CREATE INDEX "IntegrityReviewAction_signalId_createdAt_idx"
    ON "IntegrityReviewAction"("signalId", "createdAt");
CREATE INDEX "IntegrityReviewAction_reviewerUserId_createdAt_idx"
    ON "IntegrityReviewAction"("reviewerUserId", "createdAt");

ALTER TABLE "IntegritySignal"
    ADD CONSTRAINT "IntegritySignal_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IntegrityReviewAction"
    ADD CONSTRAINT "IntegrityReviewAction_signalId_fkey"
    FOREIGN KEY ("signalId") REFERENCES "IntegritySignal"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IntegrityReviewAction"
    ADD CONSTRAINT "IntegrityReviewAction_reviewerUserId_fkey"
    FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;