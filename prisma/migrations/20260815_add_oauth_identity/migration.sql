-- CreateTable
CREATE TABLE IF NOT EXISTS "OAuthIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OAuthIdentity_provider_providerSubject_key" ON "OAuthIdentity"("provider", "providerSubject");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OAuthIdentity_userId_key" ON "OAuthIdentity"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OAuthIdentity_provider_idx" ON "OAuthIdentity"("provider");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OAuthIdentity_providerSubject_idx" ON "OAuthIdentity"("providerSubject");

-- AddForeignKey
ALTER TABLE "OAuthIdentity" ADD CONSTRAINT "OAuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
