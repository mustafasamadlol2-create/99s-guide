CREATE TABLE "UserAchievementProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "achievementId" VARCHAR(128) NOT NULL,
    "ruleSetVersion" VARCHAR(64) NOT NULL,
    "metricId" VARCHAR(128) NOT NULL,
    "valueType" VARCHAR(16) NOT NULL,
    "currentValue" BIGINT NOT NULL,
    "targetValue" BIGINT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "lastEvaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAchievementProgress_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ua_progress_value_check" CHECK (
        ("valueType" = 'INTEGER' AND "currentValue" >= 0 AND "targetValue" >= 1
          AND "completed" = ("currentValue" >= "targetValue"))
        OR
        ("valueType" = 'BOOLEAN' AND "currentValue" IN (0, 1) AND "targetValue" = 1
          AND "completed" = ("currentValue" = 1))
    ),
    CONSTRAINT "UserAchievementProgress_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserAchievementProgress_ruleSetVersion_fkey"
        FOREIGN KEY ("ruleSetVersion") REFERENCES "GamificationRuleSet"("version") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ua_progress_user_achievement_version_key"
    ON "UserAchievementProgress"("userId", "achievementId", "ruleSetVersion");
CREATE INDEX "ua_progress_user_version_idx"
    ON "UserAchievementProgress"("userId", "ruleSetVersion");
CREATE INDEX "ua_progress_metric_completed_idx"
    ON "UserAchievementProgress"("metricId", "completed");

CREATE TABLE "UserAchievement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "achievementId" VARCHAR(128) NOT NULL,
    "unlockedUnderRuleSetVersion" VARCHAR(64) NOT NULL,
    "metricId" VARCHAR(128) NOT NULL,
    "valueType" VARCHAR(16) NOT NULL,
    "metricValueAtUnlock" BIGINT NOT NULL,
    "targetValueAtUnlock" BIGINT NOT NULL,
    "definitionChecksumAtUnlock" CHAR(64) NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ua_unlock_value_check" CHECK (
        ("valueType" = 'INTEGER' AND "metricValueAtUnlock" >= "targetValueAtUnlock"
          AND "targetValueAtUnlock" >= 1)
        OR
        ("valueType" = 'BOOLEAN' AND "metricValueAtUnlock" = 1
          AND "targetValueAtUnlock" = 1)
    ),
    CONSTRAINT "UserAchievement_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserAchievement_ruleSetVersion_fkey"
        FOREIGN KEY ("unlockedUnderRuleSetVersion") REFERENCES "GamificationRuleSet"("version") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ua_unlock_user_achievement_key"
    ON "UserAchievement"("userId", "achievementId");
CREATE INDEX "ua_unlock_user_unlocked_idx"
    ON "UserAchievement"("userId", "unlockedAt");
CREATE INDEX "ua_unlock_achievement_unlocked_idx"
    ON "UserAchievement"("achievementId", "unlockedAt");