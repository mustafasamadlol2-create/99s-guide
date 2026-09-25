CREATE TABLE "GamificationRuleSet" (
    "id" TEXT NOT NULL,
    "version" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "schemaVersion" INTEGER NOT NULL,
    "definitionChecksum" CHAR(64) NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GamificationRuleSet_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GamificationRuleSet_status_check"
      CHECK ("status" IN ('DRAFT', 'ACTIVE', 'RETIRED'))
);

CREATE UNIQUE INDEX "GamificationRuleSet_version_key"
    ON "GamificationRuleSet"("version");

CREATE INDEX "GamificationRuleSet_status_idx"
    ON "GamificationRuleSet"("status");

CREATE INDEX "GamificationRuleSet_status_effectiveFrom_idx"
    ON "GamificationRuleSet"("status", "effectiveFrom");