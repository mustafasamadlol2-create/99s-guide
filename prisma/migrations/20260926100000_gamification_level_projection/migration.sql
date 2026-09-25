CREATE TABLE "UserGamificationLevel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ruleSetVersion" VARCHAR(64) NOT NULL,
    "definitionChecksum" CHAR(64) NOT NULL,
    "level" INTEGER NOT NULL,
    "lifetimePoints" BIGINT NOT NULL,
    "maxLevelReached" BOOLEAN NOT NULL DEFAULT false,
    "lastEvaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserGamificationLevel_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ugl_level_points_check" CHECK (
        "level" >= 1 AND "lifetimePoints" >= 0
    ),
    CONSTRAINT "UserGamificationLevel_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserGamificationLevel_ruleSetVersion_fkey"
        FOREIGN KEY ("ruleSetVersion") REFERENCES "GamificationRuleSet"("version") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UserGamificationLevel_userId_key"
    ON "UserGamificationLevel"("userId");
CREATE INDEX "ugl_ruleset_version_idx"
    ON "UserGamificationLevel"("ruleSetVersion");