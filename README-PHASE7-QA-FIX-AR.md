# Phase 7.1 — Fix QA blockers (tests only)

Source: exact files from `99s-guide-main (50)(1).zip` with Phase 7.1 patch applied. This patch changes only `tests/leaderboard.test.ts` in the application. No changes to production source code, points, prizes, worker, databases or flags.

## Findings
- TS2307 and 25 compile errors originated in `phase7-step1-payload` copied inside project, not runtime code. TypeScript also parsed duplicate unrelated source files there.
- Four unit tests are stale: current Points V2 competitive leaderboard uses `StudyPointsLedgerEntry` and `LEDGER_ONLY`, not legacy PointsLog; D1 is queried for cursor pages (first pages rebuild from canonical Postgres), so D1 fallback must be tested with a valid cursor.
- Four separate integration tests are intentionally SKIP without disposable Postgres test schema and must not run against production.

## Local Windows CMD steps

Take `git status -sb` checkpoint, unzip this ZIP in project root (keeping folder structure). Then:

```bat
node scripts\apply-phase7-tests-fix.cjs
node scripts\apply-phase7-tests-fix.cjs --apply
```

Remove the prior patch's extra TypeScript source tree from the project *after confirming Phase 7.1 was applied*: moving it one directory above the project is safer than deleting it:

```bat
move phase7-step1-payload ..\phase7-step1-payload-backup
```

If the destination folder already exists, choose a different name; avoid overwriting it. No application source file is moved; Phase 7.1 changes are already in their real paths.

Now test:

```bat
npm run typecheck
npm run build
npx tsx --test tests/phase7-public-leaderboard-scopes.test.ts
npm run test:leaderboard
```

Expected for leaderboard unit tests: 19 PASS / 4 SKIP / 0 FAIL (assuming no unanticipated baseline failures). SKIPs are DB integration tests requiring an explicitly disposable test database. Inspect actual results and do not blindly assume pass.

Do NOT push until all gates pass. Commit only seven Phase 7.1 production/test files; the corrected `tests/leaderboard.test.ts` is included in that list. Do not `git add .`. Keep `LEADERBOARD_D1_READ_ENABLED` / `LEADERBOARD_D1_PROJECTION_ENABLED` unchanged.

Rollback just QA test correction (does not roll back Phase 7.1):

```bat
node scripts\apply-phase7-tests-fix.cjs --rollback
```
