-- Read-only check. Expected: dedupeKey | YES
SELECT table_schema, table_name, column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'PrivateD1SyncOutbox'
  AND column_name = 'dedupeKey';
