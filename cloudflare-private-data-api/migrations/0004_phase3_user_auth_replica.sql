-- Phase 3: dedicated non-sensitive user/auth read replica.
-- Password hashes, reset tokens and verification tokens are intentionally excluded.
CREATE TABLE IF NOT EXISTS "UserAuthReplica" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "email" TEXT NOT NULL,
  "profileEmail" TEXT,
  "role" TEXT NOT NULL,
  "sessionVersion" INTEGER NOT NULL DEFAULT 0,
  "name" TEXT,
  "avatar" TEXT,
  "avatarUrl" TEXT,
  "signature" TEXT,
  "totalPoints" INTEGER NOT NULL DEFAULT 0,
  "level" TEXT,
  "levelBadge" TEXT,
  "streakDays" INTEGER NOT NULL DEFAULT 0,
  "totalTimeSpent" INTEGER NOT NULL DEFAULT 0,
  "lastActive" TEXT,
  "lastSeen" TEXT,
  "createdAt" TEXT,
  "updatedAt" TEXT,
  "accountStatus" TEXT,
  "isOnline" INTEGER NOT NULL DEFAULT 0,
  "studentGroup" TEXT,
  "isPrimaryOwner" INTEGER NOT NULL DEFAULT 0,
  "emailVerified" INTEGER NOT NULL DEFAULT 1,
  "hasAppleIdentity" INTEGER NOT NULL DEFAULT 0,
  "preferences" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserAuthReplica_email_ci_key"
  ON "UserAuthReplica" (lower("email"));
CREATE INDEX IF NOT EXISTS "UserAuthReplica_roster_idx"
  ON "UserAuthReplica" ("isOnline", "name", "id");
CREATE INDEX IF NOT EXISTS "UserAuthReplica_group_idx"
  ON "UserAuthReplica" ("studentGroup", "id");
CREATE INDEX IF NOT EXISTS "UserAuthReplica_status_idx"
  ON "UserAuthReplica" ("accountStatus", "id");

CREATE TABLE IF NOT EXISTS "UserBan" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL,
  "reason" TEXT,
  "startTime" TEXT,
  "endTime" TEXT,
  "isPermanent" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT,
  "createdAt" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserBan_userId_key" ON "UserBan" ("userId");
CREATE INDEX IF NOT EXISTS "UserBan_endTime_idx" ON "UserBan" ("endTime");
