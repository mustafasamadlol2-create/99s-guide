-- Durable session invalidation and one-vote-per-user enforcement.
ALTER TABLE "User"
ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "QaVote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QaVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QaVote_userId_targetType_targetId_key"
ON "QaVote"("userId", "targetType", "targetId");

CREATE INDEX "QaVote_targetType_targetId_idx"
ON "QaVote"("targetType", "targetId");

ALTER TABLE "QaVote"
ADD CONSTRAINT "QaVote_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
