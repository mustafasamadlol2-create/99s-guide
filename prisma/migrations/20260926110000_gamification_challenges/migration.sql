ALTER TABLE "GamificationRuleSet"
    ADD COLUMN "challengeDefinitionChecksum" CHAR(64);

UPDATE "GamificationRuleSet"
SET "challengeDefinitionChecksum" = '18fb5e8859a5e17706115a0a65e1406c3edc51289786099ca7e4539bac095838'
WHERE "version" = 'gamification-v1';

CREATE TABLE "ChallengeInstance" (
    "id" TEXT NOT NULL,
    "challengeDefinitionId" VARCHAR(128) NOT NULL,
    "ruleSetVersion" VARCHAR(64) NOT NULL,
    "logicalPeriodKey" VARCHAR(10) NOT NULL,
    "metricId" VARCHAR(128) NOT NULL,
    "targetValue" BIGINT NOT NULL,
    "enrollmentPolicy" VARCHAR(16) NOT NULL,
    "windowPolicy" VARCHAR(16) NOT NULL,
    "titleKey" VARCHAR(160) NOT NULL,
    "descriptionKey" VARCHAR(160) NOT NULL,
    "visibility" VARCHAR(32) NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'UPCOMING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChallengeInstance_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cci_period_window_check" CHECK ("startsAt" < "endsAt"),
    CONSTRAINT "cci_period_key_check" CHECK ("logicalPeriodKey" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
    CONSTRAINT "cci_target_value_check" CHECK ("targetValue" > 0),
    CONSTRAINT "cci_sort_order_check" CHECK ("sortOrder" >= 0),
    CONSTRAINT "cci_enrollment_policy_check" CHECK ("enrollmentPolicy" IN ('AUTO', 'MANUAL')),
    CONSTRAINT "cci_window_policy_check" CHECK ("windowPolicy" = 'WEEKLY'),
    CONSTRAINT "cci_visibility_check" CHECK ("visibility" = 'PRIVATE_STUDY'),
    CONSTRAINT "cci_status_check" CHECK ("status" IN ('UPCOMING', 'ACTIVE', 'ENDED', 'CANCELLED')),
    CONSTRAINT "ChallengeInstance_ruleSetVersion_fkey"
        FOREIGN KEY ("ruleSetVersion") REFERENCES "GamificationRuleSet"("version")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "cci_definition_version_period_key"
    ON "ChallengeInstance"("challengeDefinitionId", "ruleSetVersion", "logicalPeriodKey");
CREATE UNIQUE INDEX "cci_definition_period_key"
    ON "ChallengeInstance"("challengeDefinitionId", "logicalPeriodKey");
CREATE INDEX "cci_status_period_idx"
    ON "ChallengeInstance"("status", "startsAt", "endsAt");

CREATE TABLE "UserChallengeProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "challengeInstanceId" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "metricId" VARCHAR(128) NOT NULL,
    "baselineValue" BIGINT NOT NULL DEFAULT 0,
    "currentValue" BIGINT NOT NULL DEFAULT 0,
    "targetValue" BIGINT NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEvaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserChallengeProgress_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ucp_status_check" CHECK ("status" IN ('ACTIVE', 'COMPLETED', 'EXPIRED', 'LEFT')),
    CONSTRAINT "ucp_values_check" CHECK (
        "baselineValue" >= 0 AND "currentValue" >= 0 AND "targetValue" > 0
    ),
    CONSTRAINT "ucp_completed_at_check" CHECK (
        ("status" = 'COMPLETED') = ("completedAt" IS NOT NULL)
    ),
    CONSTRAINT "ucp_expired_at_check" CHECK (
        ("status" = 'EXPIRED') = ("expiredAt" IS NOT NULL)
    ),
    CONSTRAINT "ucp_terminal_time_check" CHECK (
        "completedAt" IS NULL OR "expiredAt" IS NULL
    ),
    CONSTRAINT "UserChallengeProgress_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserChallengeProgress_challengeInstanceId_fkey"
        FOREIGN KEY ("challengeInstanceId") REFERENCES "ChallengeInstance"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ucp_user_instance_key"
    ON "UserChallengeProgress"("userId", "challengeInstanceId");
CREATE INDEX "ucp_user_status_updated_idx"
    ON "UserChallengeProgress"("userId", "status", "updatedAt");
CREATE INDEX "ucp_instance_status_idx"
    ON "UserChallengeProgress"("challengeInstanceId", "status");