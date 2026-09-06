-- AlterTable
ALTER TABLE "User" ADD COLUMN "profileEmail" TEXT;

-- CreateIndex
CREATE INDEX "User_profileEmail_idx" ON "User"("profileEmail");
