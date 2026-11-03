# Phase 6/10 — Gamification Read Replica — SAFETY-GATED PATCH

This is a **candidate** Phase 6 implementation, not a production-approved cutover.
It builds one server-owned D1 snapshot per user from the existing canonical
Supabase/PostgreSQL Study Points, Levels, Achievements and Challenges logic.
The snapshot is not a second points calculator; rewards, enrollments, challenge
completion and rule definitions remain server-owned, canonical PostgreSQL writes.
No caps are added, and no leaderboard implementation is changed.

## Added

- Private D1 `GamificationSnapshot` table with owner-scope and revision checks.
- Private Worker read endpoint `/internal/private-read/gamification-snapshot`.
- Snapshot publication via existing PostgreSQL `PrivateD1SyncOutbox` after
  canonical post-commit refresh, behind an independent sync flag.
- Read cutover behind a separate disabled-by-default flag for `/api/me/gamification`,
  `/api/me/achievements`, `/api/me/challenges`. Public profile remains canonical
  and is expected to be considered with Leaderboard in Phase 7.
- Explicit 503 with **no** PostgreSQL fallback if a D1 snapshot is missing,
  malformed or the Challenge week has rolled over after cutover.
- Canonical user deletion tombstone (requires Prisma migration), and a scoped
  repair/backfill script. Phase 1–5 D1 tables are not rebuilt by this script.

## First deployment: do NOT enable read cutover

1. Replace the patch files at the same repository paths.
2. Add on Render:
   `PRIVATE_D1_PHASE6_GAMIFICATION_SYNC_ENABLED=false`
   `PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED=false`
3. Apply the **additive** PostgreSQL migration: `npm run migrate:deploy`.
   Phase 6 includes a new deletion outbox trigger, unlike Phase 5.
4. Deploy Private Data Worker: `npm run deploy:private-worker`.
5. Deploy Render while both Phase 6 flags remain false.
6. Ensure local `.env` has `PRIVATE_DATA_WORKER_BASE_URL`,
   `PRIVATE_DATA_SYNC_SECRET`, and `SUPABASE_DATABASE_URL`.
7. Run `npm run gamification:d1:backfill` and then
   `npm run gamification:d1:verify`. Both must pass count + per-account checks.
8. **Only after backfill**, enable `PRIVATE_D1_PHASE6_GAMIFICATION_SYNC_ENABLED=true`
   on Render to enqueue post-commit updates, redeploy, and inspect the outbox
   drainer for poisoned/blocked rows and live point/achievement/challenge parity.

## Cutover blockers

**Keep `PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED=false` until production
verification proves ongoing delivery, read-your-writes consistency where
required, and week-boundary refresh.** A static backfill by itself cannot
prove those gates. There is deliberately no silent Supabase fallback under the
Phase 6 read-cutover flag, so do not enable the flag before these gates pass.

The backfill calls canonical Challenge refresh, which can create weekly Challenge
instances/progress and award valid, previously-unawarded rewards. It does not
wipe or reset canonical records, but it **is not read-only** to PostgreSQL.
Run it only after taking any appropriate canonical DB backup and verifying
Gamification rules are active/healthy. The D1 reset touches only the disposable
`GamificationSnapshot` table, not the earlier Phase 1–5 replicas.

A failed check means Phase 6 is **IN PROGRESS**, not DONE. Rollback is to turn off
Phase 6 cutover; Phase 1–5 flags are left alone.
