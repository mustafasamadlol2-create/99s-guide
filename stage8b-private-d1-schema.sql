-- 99's Guide — Stage 8B Private D1 Runtime Schema
-- GENERATED READ-ONLY from the current Supabase/PostgreSQL schema.
-- This file creates NEW D1 mirror tables only.
-- Existing shared D1 tables are not dropped or recreated.
-- No application reads are switched in Stage 8B.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "EmailVerificationToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TEXT NOT NULL,
  "usedAt" TEXT,
  "createdAt" TEXT NOT NULL,
  CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "EmailVerificationToken_expiresAt_idx" ON "EmailVerificationToken" ("expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken" ("tokenHash");
CREATE INDEX IF NOT EXISTS "EmailVerificationToken_userId_idx" ON "EmailVerificationToken" ("userId");

CREATE TABLE IF NOT EXISTS "FlashcardProgress" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "flashcardId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  CONSTRAINT "FlashcardProgress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FlashcardProgress_flashcardId_fkey" FOREIGN KEY ("flashcardId") REFERENCES "Flashcard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FlashcardProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "FlashcardProgress_userId_flashcardId_key" ON "FlashcardProgress" ("userId", "flashcardId");
CREATE INDEX IF NOT EXISTS "FlashcardProgress_userId_idx" ON "FlashcardProgress" ("userId");

CREATE TABLE IF NOT EXISTS "LectureProgress" (
  "userId" TEXT NOT NULL,
  "lectureId" TEXT NOT NULL,
  "pdfCompleted" INTEGER NOT NULL CHECK ("pdfCompleted" IN (0, 1)),
  "notesCompleted" INTEGER NOT NULL CHECK ("notesCompleted" IN (0, 1)),
  "videoCompleted" INTEGER NOT NULL CHECK ("videoCompleted" IN (0, 1)),
  "flashcardsCompleted" INTEGER NOT NULL CHECK ("flashcardsCompleted" IN (0, 1)),
  "quizCompleted" INTEGER NOT NULL CHECK ("quizCompleted" IN (0, 1)),
  "quizScore" INTEGER,
  "lastAccessed" TEXT NOT NULL,
  CONSTRAINT "LectureProgress_pkey" PRIMARY KEY ("userId", "lectureId"),
  CONSTRAINT "LectureProgress_lectureId_fkey" FOREIGN KEY ("lectureId") REFERENCES "Lecture" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LectureProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "LectureProgress_lectureId_idx" ON "LectureProgress" ("lectureId");

CREATE TABLE IF NOT EXISTS "ModerationHistory" (
  "id" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "adminId" TEXT,
  "targetUserId" TEXT,
  "commentId" TEXT,
  "questionId" TEXT,
  "answerId" TEXT,
  "replyId" TEXT,
  "lectureId" TEXT,
  "reportId" TEXT,
  "reason" TEXT,
  "notes" TEXT,
  "oldStatus" TEXT,
  "newStatus" TEXT,
  "duration" INTEGER,
  "isPermanent" INTEGER NOT NULL CHECK ("isPermanent" IN (0, 1)),
  "isSystemAction" INTEGER NOT NULL CHECK ("isSystemAction" IN (0, 1)),
  "createdAt" TEXT NOT NULL,
  "expiresAt" TEXT,
  "revokedAt" TEXT,
  "revokedBy" TEXT,
  "metadata" TEXT,
  CONSTRAINT "ModerationHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ModerationHistory_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ModerationHistory_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ModerationHistory_actionType_idx" ON "ModerationHistory" ("actionType");
CREATE INDEX IF NOT EXISTS "ModerationHistory_adminId_idx" ON "ModerationHistory" ("adminId");
CREATE INDEX IF NOT EXISTS "ModerationHistory_answerId_idx" ON "ModerationHistory" ("answerId");
CREATE INDEX IF NOT EXISTS "ModerationHistory_createdAt_idx" ON "ModerationHistory" ("createdAt");
CREATE INDEX IF NOT EXISTS "ModerationHistory_expiresAt_idx" ON "ModerationHistory" ("expiresAt");
CREATE INDEX IF NOT EXISTS "ModerationHistory_isSystemAction_idx" ON "ModerationHistory" ("isSystemAction");
CREATE INDEX IF NOT EXISTS "ModerationHistory_lectureId_idx" ON "ModerationHistory" ("lectureId");
CREATE INDEX IF NOT EXISTS "ModerationHistory_questionId_idx" ON "ModerationHistory" ("questionId");
CREATE INDEX IF NOT EXISTS "ModerationHistory_reportId_idx" ON "ModerationHistory" ("reportId");
CREATE INDEX IF NOT EXISTS "ModerationHistory_revokedAt_idx" ON "ModerationHistory" ("revokedAt");
CREATE INDEX IF NOT EXISTS "ModerationHistory_targetUserId_idx" ON "ModerationHistory" ("targetUserId");

CREATE TABLE IF NOT EXISTS "Notification" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "isSystem" INTEGER NOT NULL CHECK ("isSystem" IN (0, 1)),
  "targetUserId" TEXT,
  "createdAt" TEXT NOT NULL,
  "targetGroup" TEXT,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Notification_createdAt_idx" ON "Notification" ("createdAt");
CREATE INDEX IF NOT EXISTS "Notification_targetGroup_idx" ON "Notification" ("targetGroup");
CREATE INDEX IF NOT EXISTS "Notification_targetUserId_idx" ON "Notification" ("targetUserId");

CREATE TABLE IF NOT EXISTS "OAuthIdentity" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerSubject" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  CONSTRAINT "OAuthIdentity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OAuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "OAuthIdentity_providerSubject_idx" ON "OAuthIdentity" ("providerSubject");
CREATE INDEX IF NOT EXISTS "OAuthIdentity_provider_idx" ON "OAuthIdentity" ("provider");
CREATE UNIQUE INDEX IF NOT EXISTS "OAuthIdentity_provider_providerSubject_key" ON "OAuthIdentity" ("provider", "providerSubject");
CREATE UNIQUE INDEX IF NOT EXISTS "OAuthIdentity_userId_key" ON "OAuthIdentity" ("userId");

CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TEXT NOT NULL,
  "usedAt" TEXT,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PasswordResetToken_tokenHash_idx" ON "PasswordResetToken" ("tokenHash");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_idx" ON "PasswordResetToken" ("userId");

CREATE TABLE IF NOT EXISTS "PointsLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "points" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  CONSTRAINT "PointsLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PointsLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PointsLog_createdAt_idx" ON "PointsLog" ("createdAt");
CREATE INDEX IF NOT EXISTS "PointsLog_userId_idx" ON "PointsLog" ("userId");

CREATE TABLE IF NOT EXISTS "QaAnswer" (
  "id" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "upvotes" INTEGER NOT NULL,
  "isBest" INTEGER NOT NULL CHECK ("isBest" IN (0, 1)),
  "isDeleted" INTEGER NOT NULL CHECK ("isDeleted" IN (0, 1)),
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  CONSTRAINT "QaAnswer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QaAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QaQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "QaAnswer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "QaAnswer_questionId_idx" ON "QaAnswer" ("questionId");
CREATE INDEX IF NOT EXISTS "QaAnswer_userId_idx" ON "QaAnswer" ("userId");

CREATE TABLE IF NOT EXISTS "QaQuestion" (
  "id" TEXT NOT NULL,
  "lectureId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "upvotes" INTEGER NOT NULL,
  "isDeleted" INTEGER NOT NULL CHECK ("isDeleted" IN (0, 1)),
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  CONSTRAINT "QaQuestion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QaQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "QaQuestion_lectureId_idx" ON "QaQuestion" ("lectureId");
CREATE INDEX IF NOT EXISTS "QaQuestion_userId_idx" ON "QaQuestion" ("userId");

CREATE TABLE IF NOT EXISTS "QaVote" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "value" INTEGER NOT NULL,
  "createdAt" TEXT NOT NULL,
  CONSTRAINT "QaVote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QaVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "QaVote_targetType_targetId_idx" ON "QaVote" ("targetType", "targetId");
CREATE UNIQUE INDEX IF NOT EXISTS "QaVote_userId_targetType_targetId_key" ON "QaVote" ("userId", "targetType", "targetId");

CREATE TABLE IF NOT EXISTS "Report" (
  "id" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "reportedUserId" TEXT NOT NULL,
  "lectureId" TEXT,
  "commentId" TEXT NOT NULL,
  "commentType" TEXT NOT NULL,
  "commentContent" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  CONSTRAINT "Report_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Report_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Report_commentId_idx" ON "Report" ("commentId");
CREATE INDEX IF NOT EXISTS "Report_createdAt_idx" ON "Report" ("createdAt");
CREATE INDEX IF NOT EXISTS "Report_reportedUserId_idx" ON "Report" ("reportedUserId");
CREATE UNIQUE INDEX IF NOT EXISTS "Report_reporterId_commentId_key" ON "Report" ("reporterId", "commentId");
CREATE INDEX IF NOT EXISTS "Report_reporterId_idx" ON "Report" ("reporterId");
CREATE INDEX IF NOT EXISTS "Report_status_idx" ON "Report" ("status");

CREATE TABLE IF NOT EXISTS "SmartNotification" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "sentAt" TEXT NOT NULL,
  "read" INTEGER NOT NULL CHECK ("read" IN (0, 1)),
  CONSTRAINT "SmartNotification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SmartNotification_read_sentAt_idx" ON "SmartNotification" ("read", "sentAt");
CREATE INDEX IF NOT EXISTS "SmartNotification_type_idx" ON "SmartNotification" ("type");

CREATE TABLE IF NOT EXISTS "SystemSetting" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT,
  "name" TEXT,
  "avatar" TEXT,
  "avatarUrl" TEXT,
  "role" TEXT NOT NULL,
  "isOnline" INTEGER NOT NULL CHECK ("isOnline" IN (0, 1)),
  "lastActive" TEXT NOT NULL,
  "lastSeen" TEXT NOT NULL,
  "socketId" TEXT,
  "deviceToken" TEXT,
  "accountStatus" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "studentGroup" TEXT NOT NULL,
  "totalPoints" INTEGER NOT NULL,
  "level" TEXT NOT NULL,
  "levelBadge" TEXT NOT NULL,
  "streakDays" INTEGER NOT NULL,
  "totalTimeSpent" INTEGER NOT NULL,
  "preferences" TEXT,
  "sessionVersion" INTEGER NOT NULL,
  "isPrimaryOwner" INTEGER NOT NULL CHECK ("isPrimaryOwner" IN (0, 1)),
  "emailVerified" INTEGER NOT NULL CHECK ("emailVerified" IN (0, 1)),
  "profileEmail" TEXT,
  "signature" TEXT,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "User_accountStatus_idx" ON "User" ("accountStatus");
CREATE INDEX IF NOT EXISTS "User_createdAt_idx" ON "User" ("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User" ("email");
CREATE INDEX IF NOT EXISTS "User_isOnline_lastActive_idx" ON "User" ("isOnline", "lastActive");
CREATE INDEX IF NOT EXISTS "User_isPrimaryOwner_idx" ON "User" ("isPrimaryOwner");
CREATE INDEX IF NOT EXISTS "User_name_idx" ON "User" ("name");
CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User" ("role");
CREATE INDEX IF NOT EXISTS "User_studentGroup_idx" ON "User" ("studentGroup");

CREATE TABLE IF NOT EXISTS "UserBan" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT,
  "isPermanent" INTEGER NOT NULL CHECK ("isPermanent" IN (0, 1)),
  "createdBy" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  CONSTRAINT "UserBan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserBan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "UserBan_endTime_idx" ON "UserBan" ("endTime");
CREATE UNIQUE INDEX IF NOT EXISTS "UserBan_userId_key" ON "UserBan" ("userId");

CREATE TABLE IF NOT EXISTS "UserBlock" (
  "id" TEXT NOT NULL,
  "blockerId" TEXT NOT NULL,
  "blockedId" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserBlock_blockerId_blockedId_key" ON "UserBlock" ("blockerId", "blockedId");
CREATE INDEX IF NOT EXISTS "UserBlock_blockerId_idx" ON "UserBlock" ("blockerId");

CREATE TABLE IF NOT EXISTS "UserMute" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT,
  "isPermanent" INTEGER NOT NULL CHECK ("isPermanent" IN (0, 1)),
  "createdBy" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  CONSTRAINT "UserMute_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserMute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "UserMute_endTime_idx" ON "UserMute" ("endTime");
CREATE UNIQUE INDEX IF NOT EXISTS "UserMute_userId_key" ON "UserMute" ("userId");

CREATE TABLE IF NOT EXISTS "UserProgress" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "materialId" TEXT NOT NULL,
  "hasViewed" INTEGER NOT NULL CHECK ("hasViewed" IN (0, 1)),
  "isCompleted" INTEGER NOT NULL CHECK ("isCompleted" IN (0, 1)),
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  CONSTRAINT "UserProgress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserProgress_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "UserProgress_materialId_idx" ON "UserProgress" ("materialId");
CREATE UNIQUE INDEX IF NOT EXISTS "UserProgress_userId_materialId_key" ON "UserProgress" ("userId", "materialId");
