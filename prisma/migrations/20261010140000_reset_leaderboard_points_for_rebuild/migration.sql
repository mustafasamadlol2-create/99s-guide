-- Reset only competition/Study Points data for the explicitly approved
-- leaderboard rebuild. Student accounts, Focus sessions, study events,
-- learning progress, achievements, and challenge history are preserved.
BEGIN;

DELETE FROM "LeaderboardD1SyncOutbox";
DELETE FROM "LeaderboardSnapshotEntry";
UPDATE "LeaderboardSnapshot" SET "supersedesSnapshotId" = NULL
WHERE "supersedesSnapshotId" IS NOT NULL;
DELETE FROM "LeaderboardSnapshot";

DELETE FROM "StudyPointsLedgerEntry";
DELETE FROM "StudyPointsBalanceProjection";
DELETE FROM "StudyPointsLegacyCutover";
DELETE FROM "PointsLog";
DELETE FROM "UserGamificationLevel";
UPDATE "User"
SET "totalPoints" = 0,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "totalPoints" <> 0;

COMMIT;
