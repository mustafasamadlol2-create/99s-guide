-- Keep a fresh migration replay aligned with the existing Prisma User model.
-- IF NOT EXISTS also tolerates development databases where this field was
-- previously created outside migration history.
ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "signature" TEXT DEFAULT '';