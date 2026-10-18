CREATE TABLE "VideoWatchProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "verifiedMilliseconds" INTEGER NOT NULL DEFAULT 0,
    "lastPositionSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastPlayerState" TEXT NOT NULL DEFAULT 'UNSTARTED',
    "lastPlaybackRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoWatchProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VideoWatchProgress_userId_materialId_key"
ON "VideoWatchProgress"("userId", "materialId");

CREATE INDEX "VideoWatchProgress_materialId_completedAt_idx"
ON "VideoWatchProgress"("materialId", "completedAt");

CREATE INDEX "VideoWatchProgress_userId_completedAt_idx"
ON "VideoWatchProgress"("userId", "completedAt");

CREATE INDEX "VideoWatchProgress_userId_lastHeartbeatAt_idx"
ON "VideoWatchProgress"("userId", "lastHeartbeatAt");

ALTER TABLE "VideoWatchProgress"
ADD CONSTRAINT "VideoWatchProgress_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VideoWatchProgress"
ADD CONSTRAINT "VideoWatchProgress_materialId_fkey"
FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;
