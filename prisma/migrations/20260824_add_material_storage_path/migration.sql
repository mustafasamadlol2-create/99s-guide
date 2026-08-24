ALTER TABLE "Material" ADD COLUMN "storagePath" TEXT;
CREATE INDEX "Material_storagePath_idx" ON "Material"("storagePath");
