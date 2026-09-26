-- Prompt 27: disposable PostgreSQL leaderboard snapshot projection.
-- PostgreSQL remains canonical. This migration is additive and local-only until reviewed.
CREATE TABLE IF NOT EXISTS "leaderboard_cache_snapshots" (
  "snapshot_id" TEXT PRIMARY KEY NOT NULL,
  "season_id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "season_key" TEXT NOT NULL,
  "snapshot_type" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "season_status" TEXT NOT NULL,
  "starts_at" TEXT,
  "ends_at" TEXT,
  "generated_at" TEXT NOT NULL,
  "score_through" TEXT NOT NULL,
  "entry_count" INTEGER NOT NULL,
  "source_fingerprint" TEXT NOT NULL,
  "projection_checksum" TEXT NOT NULL,
  "chunk_count" INTEGER NOT NULL,
  "state" TEXT NOT NULL,
  "projected_at" TEXT,
  "ranking_version" TEXT NOT NULL,
  "cache_schema_version" INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "leaderboard_cache_snapshots_revision_key"
  ON "leaderboard_cache_snapshots" ("season_id", "snapshot_type", "revision");
CREATE INDEX IF NOT EXISTS "leaderboard_cache_snapshots_season_idx"
  ON "leaderboard_cache_snapshots" ("scope", "season_key", "state");

CREATE TABLE IF NOT EXISTS "leaderboard_cache_entries" (
  "snapshot_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  "tie_size" INTEGER NOT NULL,
  "score" INTEGER NOT NULL,
  "level_snapshot" INTEGER,
  PRIMARY KEY ("snapshot_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "leaderboard_cache_entries_page_idx"
  ON "leaderboard_cache_entries" ("snapshot_id", "rank", "score", "user_id");

CREATE TABLE IF NOT EXISTS "leaderboard_cache_current" (
  "scope" TEXT NOT NULL,
  "season_key" TEXT NOT NULL,
  "snapshot_id" TEXT NOT NULL,
  "snapshot_type" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "generated_at" TEXT NOT NULL,
  "score_through" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("scope", "season_key")
);

CREATE TABLE IF NOT EXISTS "leaderboard_cache_chunks" (
  "snapshot_id" TEXT NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "chunk_hash" TEXT NOT NULL,
  "row_count" INTEGER NOT NULL,
  "received_at" TEXT NOT NULL,
  PRIMARY KEY ("snapshot_id", "chunk_index")
);

CREATE TABLE IF NOT EXISTS "leaderboard_cache_nonces" (
  "nonce" TEXT PRIMARY KEY NOT NULL,
  "expires_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "leaderboard_cache_nonces_expiry_idx"
  ON "leaderboard_cache_nonces" ("expires_at");