# Phase 5 Focus / Phase 6 Gamification safety patch

## Why

- `gamification:d1:verify` previously called `buildCanonicalGamificationD1Snapshot` which calls `getMyChallenges`. This causes mutating Challenge refresh (including potential reward grants), and can hold a long transaction per account. The verify-only path now compares D1 with a **read-only** canonical summary and the Baghdad week key and current-week Challenge progress.
- A Phase 5 Focus active session can exist in canonical Supabase while the async outbox has not yet delivered the corresponding D1 state. Strict D1 reads can then show no current session even though a subsequent start fails `ACTIVE_SESSION_EXISTS`.

## Environment

Retain Phase 5 cutover configuration. Keep `PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED=false`. Do not perform a destructive backfill to fix these symptoms.

## Procedure

1. Run `npm run build` after overlaying these files on your current project.
2. Run `npm run gamification:d1:verify`. It does not call Challenge refresh, award points or enroll users. It reports mismatch **reasons**. It is expected that week rollover from Sun Nov 15 to Mon Nov 16 can cause `challenge.week rollover / stale D1 snapshot` errors even when Points are equal.
3. Run `npm run focus:d1:current-audit`. Read-only: compares Supabase nonterminal sessions and Worker nonterminal FocusSession projections, without printing user IDs. It audits all active accounts plus the 50 most recently updated Focus sessions.
4. **Only after reviewing the audit** run `npm run focus:d1:current-repair` for the affected set, or `npx tsx scripts/focus-d1-current-reconcile.ts --user-id=<verified_user_id> --repair --confirm-repair` to target one account. This queues new FocusSession snapshots through the existing PostgreSQL outbox. It never marks sessions completed. The Render outbox drainer must be running and healthy for D1 to receive them. Rerun audit to verify.
5. Do not enable Phase 6 cutover until all points, rules, achievements and current-week Challenge snapshots reconcile and the weekly lifecycle issue is addressed. Repairs may not fix a persistent outbox delivery problem; check drainer logs and failed outbox rows.

## Cautions

- `verify-only` tests current week, not correctness of all historical Challenge awards. It intentionally does **not** create new weekly Challenge enrollments. That is a separate, transactional, scheduled server-side lifecycle requirement.
- Do not run `gamification:d1:backfill` again just for the 18 mismatches without diagnosing them. Backfill rebuilds the entire D1 Gamification snapshot table and can run Challenge refresh for every user.
- No database schema migration or Worker deploy is required for this patch. The Focus repair mode intentionally creates durable outbox jobs and advances projection revisions, but does not change Focus session statuses or reward totals.
- This patch is reconstructed from the last archived Phase 5 + Phase 6 versions and subsequent named hotfix files. Review against any newer local changes before replacing these files.
