# 99’s Guide — Phase 7.5B (Safe D1 Own-Rank Reads)

## Why
Phase 7.5A passed and is committed as `40a4bad`. The current leaderboard first page can use D1 behind the read flag but **own rank is still PostgreSQL-only**. D1 pagination also must not underfill a viewer’s page after hiding blocked or inactive accounts.

## Changes (exactly 2 project files)
- `server/features/leaderboard/cacheReads.ts`: add the D1 rank GET path and strict account ownership/manifest/current-pointer/age/roster/Points Ledger checks; any anomaly falls back to canonical PostgreSQL. If D1 lacks the viewer's row, canonical eligibility determines the result. Privacy-filtered page rows also fail over to PostgreSQL rather than displaying underfilled pages.
- `tests/phase7-leaderboard-d1-own-rank.test.ts`: six focused tests (zero points, account isolation, malformed values, null fallback, rank guards, privacy/pagination).

The patch changes no database tables, points/awards, Worker, secrets or production flags. It does **not** turn on D1 reads.

## Install (Windows CMD, at repository root)

```
node scripts\apply-phase7-step5b.cjs
```

Expected: `CHECK_PASS files=2 ready=2 already=0`. If `BASELINE_CHANGED`, **STOP** and report it: you may have code newer than Phase 7.5A.

After a Git checkpoint:

```
node scripts\apply-phase7-step5b.cjs --apply
npx tsx --test tests/phase7-leaderboard-d1-own-rank.test.ts
npx tsx --test tests/phase7-leaderboard-live-freshness.test.ts
npm run typecheck
npm run build
npm run test:leaderboard
```

To publish only reviewed code:

```
git add server/features/leaderboard/cacheReads.ts tests/phase7-leaderboard-d1-own-rank.test.ts
git diff --cached --check
git commit -m "Phase 7.5B guard D1 own-rank and filtered leaderboard pages"
git push origin main
```

Confirm Render deployed the new commit. `LEADERBOARD_D1_READ_ENABLED=false` must stay unchanged until the separate live continuous-projection test proves fresh D1 snapshots and 3/3 row parity. Keep `LEADERBOARD_D1_PROJECTION_ENABLED=false` until that controlled test begins. If projection is enabled later, remember this code only refreshes when a read occurs; it does not schedule proactive updates.

## Restore (local only)

`node scripts\apply-phase7-step5b.cjs --restore`

Only after the files still match the installed patch and `.phase7-step5b-backup.json` remains available. Rollback does not roll back a Git push or production deployment.

## Important test limits
The patch author validated parsing and installer behavior in an isolated local source copy, not on your connected PostgreSQL or D1 Worker. Your `npm run typecheck`, `npm run build`, tests, and eventual live parity checks are required before enabling flags.
