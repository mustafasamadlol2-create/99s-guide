CREATE TABLE "StudyPointsLedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "category" VARCHAR(16) NOT NULL,
    "reasonCode" VARCHAR(96) NOT NULL,
    "sourceType" VARCHAR(32) NOT NULL,
    "sourceId" VARCHAR(128),
    "ruleVersion" VARCHAR(128) NOT NULL,
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversalOfEntryId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "StudyPointsLedgerEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StudyPointsLedgerEntry_amount_check"
        CHECK ("amount" <> 0 AND "amount" BETWEEN -100000 AND 100000),
    CONSTRAINT "StudyPointsLedgerEntry_category_check"
        CHECK ("category" IN ('FOCUS', 'MASTERY', 'PROGRESS', 'CONSISTENCY')),
    CONSTRAINT "StudyPointsLedgerEntry_reasonCode_check"
        CHECK ("reasonCode" ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'),
    CONSTRAINT "StudyPointsLedgerEntry_sourceType_check"
        CHECK ("sourceType" IN (
            'FOCUS_SESSION',
            'GROUP_FOCUS_RUN',
            'MCQ_ATTEMPT',
            'FLASHCARD_REVIEW',
            'RECALL_ATTEMPT',
            'DAILY_CONSISTENCY',
            'ADMIN_ADJUSTMENT',
            'LEGACY_POINTS_LOG',
            'REVERSAL'
        )),
    CONSTRAINT "StudyPointsLedgerEntry_ruleVersion_check"
        CHECK (length("ruleVersion") > 0),
    CONSTRAINT "StudyPointsLedgerEntry_idempotencyKey_check"
        CHECK (length("idempotencyKey") > 0),
    CONSTRAINT "StudyPointsLedgerEntry_reversalType_check"
        CHECK (("sourceType" = 'REVERSAL') = ("reversalOfEntryId" IS NOT NULL)),
    CONSTRAINT "StudyPointsLedgerEntry_reversalSource_check"
        CHECK (
            "reversalOfEntryId" IS NULL
            OR (
                "sourceId" IS NOT NULL
                AND "sourceId" = "reversalOfEntryId"
                AND "reversalOfEntryId" <> "id"
            )
        ),
    CONSTRAINT "StudyPointsLedgerEntry_metadata_size_check"
        CHECK ("metadata" IS NULL OR octet_length("metadata"::text) <= 8192)
);

CREATE UNIQUE INDEX "StudyPointsLedgerEntry_userId_idempotencyKey_key"
    ON "StudyPointsLedgerEntry"("userId", "idempotencyKey");
CREATE UNIQUE INDEX "StudyPointsLedgerEntry_reversalOfEntryId_key"
    ON "StudyPointsLedgerEntry"("reversalOfEntryId");
CREATE INDEX "StudyPointsLedgerEntry_userId_effectiveAt_id_idx"
    ON "StudyPointsLedgerEntry"("userId", "effectiveAt", "id");
CREATE INDEX "StudyPointsLedgerEntry_userId_category_effectiveAt_idx"
    ON "StudyPointsLedgerEntry"("userId", "category", "effectiveAt");
CREATE INDEX "StudyPointsLedgerEntry_sourceType_sourceId_idx"
    ON "StudyPointsLedgerEntry"("sourceType", "sourceId");

ALTER TABLE "StudyPointsLedgerEntry"
    ADD CONSTRAINT "StudyPointsLedgerEntry_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudyPointsLedgerEntry"
    ADD CONSTRAINT "StudyPointsLedgerEntry_reversalOfEntryId_fkey"
    FOREIGN KEY ("reversalOfEntryId") REFERENCES "StudyPointsLedgerEntry"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;