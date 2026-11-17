# Phase 6 — Current-week safe reconciliation (one-time maintenance)

This patch **adds one script only**; it does not replace the existing Phase 5/6 app files.

## Problem

After the Baghdad Challenges week rolls over, earlier D1 Gamification snapshots expire. Existing `gamification:d1:verify` correctly finds week rollover and (sometimes) delayed points. **Do not** turn on Phase 6 cutover or reset the D1 Gamification table as a workaround.

## Prerequisites

- Render `PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED=false`.
- Private Worker reachable; its URL and secret configured in the local `.env`.
- Supabase database connection configured; take a recent backup before `--apply`.
- Render outbox drainer operational (`PRIVATE_D1_WRITE_MIRROR_ENABLED=true` with valid secret). Check `PENDING`, `RETRY`, `BLOCKED`, `POISON` rows before cutover.
- Prevent laptop sleep during long scripts.

## 1. Dry run (read-only)

```bash
npx tsx scripts/phase6-gamification-weekly-reconcile.ts
```

Prints summary mismatches and expired-week snapshots without modifying Supabase or D1.

## 2. Explicit, small-batch repair

**Only after backup / approval to refresh canonical Challenges.** Refreshing challenges can enroll the current week and award legitimately earned, previously unawarded rewards. This is intentional canonical behavior and is NOT read-only.

```bash
npx tsx scripts/phase6-gamification-weekly-reconcile.ts --apply --confirm-apply --max=10
```

This regenerates only mismatched/expired snapshots and **enqueues** 10 at a time via the normal PostgreSQL outbox; it does not directly edit D1 and does not reset the table. Let Render drain the outbox, rerun a dry-run, then apply again as needed. No new migrations or Worker deployment required.

If an account has an outstanding `PENDING`/`RETRY`/`BLOCKED`/`POISON` GamificationSnapshot outbox row, it is skipped to prevent repetitive enqueue. Inspect drainer logs and delivery status first; do not repeatedly queue the same account.

A single-account repair can be scoped to a known user ID (do not post user IDs to public chat):

```bash
npx tsx scripts/phase6-gamification-weekly-reconcile.ts --user-id=USER_ID --apply --confirm-apply --max=1
```

## 3. Verify after outbox delivery

```bash
npm run gamification:d1:verify
```

Do NOT enable cutover unless both count and per-user parity pass and the weekly rollover is automated for future Mondays. **This script is manual recovery only, not a permanent weekly scheduler.** Full production cutover also requires proving realtime points synchronization and correct Focus/MCQ writes.
