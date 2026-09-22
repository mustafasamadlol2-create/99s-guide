-- CreateTable
CREATE TABLE "ResourceMultipartUpload" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lectureId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "sanitizedFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "declaredSizeBytes" BIGINT NOT NULL,
    "lastModifiedMs" BIGINT,
    "storagePath" TEXT NOT NULL,
    "multipartUploadId" TEXT NOT NULL,
    "partSizeBytes" INTEGER NOT NULL,
    "expectedPartCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceMultipartUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResourceMultipartUpload_storagePath_key"
  ON "ResourceMultipartUpload"("storagePath");

-- CreateIndex
CREATE INDEX "ResourceMultipartUpload_userId_status_expiresAt_idx"
  ON "ResourceMultipartUpload"("userId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "ResourceMultipartUpload_lectureId_status_idx"
  ON "ResourceMultipartUpload"("lectureId", "status");

-- AddForeignKey
ALTER TABLE "ResourceMultipartUpload"
  ADD CONSTRAINT "ResourceMultipartUpload_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceMultipartUpload"
  ADD CONSTRAINT "ResourceMultipartUpload_lectureId_fkey"
  FOREIGN KEY ("lectureId") REFERENCES "Lecture"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;