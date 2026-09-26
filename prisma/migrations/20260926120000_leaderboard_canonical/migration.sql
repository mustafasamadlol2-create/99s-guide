CREATE TABLE "LeaderboardSeason" (
    "id" TEXT NOT NULL,
    "scope" VARCHAR(16) NOT NULL,
    "seasonKey" VARCHAR(64) NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "status" VARCHAR(16) NOT NULL DEFAULT 'UPCOMING',
    "gamificationRuleSetVersion" VARCHAR(64),
    "pointsRuleVersionSetHash" CHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "LeaderboardSeason_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeaderboardSnapshot" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "snapshotType" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'READY',
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "scoreThrough" TIMESTAMP(3) NOT NULL,
    "sourceFingerprint" CHAR(64) NOT NULL,
    "entryCount" INTEGER NOT NULL,
    "rankingSemanticsVersion" VARCHAR(64) NOT NULL,
    "pointsRuleVersionSetHash" CHAR(64),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "supersedesSnapshotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaderboardSnapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LeaderboardSnapshot_entryCount_check" CHECK ("entryCount" >= 0),
    CONSTRAINT "LeaderboardSnapshot_revision_check" CHECK ("revision" > 0)
);

CREATE TABLE "LeaderboardSnapshotEntry" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "userId" TEXT,
    "score" BIGINT NOT NULL,
    "rank" INTEGER NOT NULL,
    "tieSize" INTEGER NOT NULL,
    "levelSnapshot" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaderboardSnapshotEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LeaderboardSnapshotEntry_rank_check" CHECK ("rank" > 0),
    CONSTRAINT "LeaderboardSnapshotEntry_tieSize_check" CHECK ("tieSize" > 0)
);

CREATE UNIQUE INDEX "leaderboard_season_scope_key"
    ON "LeaderboardSeason"("scope", "seasonKey");
CREATE INDEX "leaderboard_season_status_window_idx"
    ON "LeaderboardSeason"("status", "scope", "startsAt", "endsAt");

CREATE UNIQUE INDEX "leaderboard_snapshot_revision_key"
    ON "LeaderboardSnapshot"("seasonId", "snapshotType", "revision");
CREATE UNIQUE INDEX "LeaderboardSnapshot_supersedesSnapshotId_key"
    ON "LeaderboardSnapshot"("supersedesSnapshotId");
CREATE INDEX "leaderboard_snapshot_revision_idx"
    ON "LeaderboardSnapshot"("seasonId", "snapshotType", "revision");
CREATE INDEX "leaderboard_snapshot_generated_idx"
    ON "LeaderboardSnapshot"("seasonId", "snapshotType", "generatedAt");

CREATE UNIQUE INDEX "leaderboard_entry_snapshot_user_key"
    ON "LeaderboardSnapshotEntry"("snapshotId", "userId");
CREATE INDEX "leaderboard_entry_page_idx"
    ON "LeaderboardSnapshotEntry"("snapshotId", "rank", "score", "userId");

ALTER TABLE "LeaderboardSnapshot"
    ADD CONSTRAINT "LeaderboardSnapshot_seasonId_fkey"
    FOREIGN KEY ("seasonId") REFERENCES "LeaderboardSeason"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LeaderboardSnapshot"
    ADD CONSTRAINT "LeaderboardSnapshot_supersedesSnapshotId_fkey"
    FOREIGN KEY ("supersedesSnapshotId") REFERENCES "LeaderboardSnapshot"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LeaderboardSnapshotEntry"
    ADD CONSTRAINT "LeaderboardSnapshotEntry_snapshotId_fkey"
    FOREIGN KEY ("snapshotId") REFERENCES "LeaderboardSnapshot"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeaderboardSnapshotEntry"
    ADD CONSTRAINT "LeaderboardSnapshotEntry_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;