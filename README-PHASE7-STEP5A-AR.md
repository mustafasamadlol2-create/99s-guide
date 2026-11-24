# 99's Guide — Phase 7.5A | Safe Continuous Leaderboard Snapshot Refresh

**Scope:** Two files: `server/features/leaderboard/cacheReads.ts` and `tests/phase7-leaderboard-live-freshness.test.ts`. No database schema changes, no new environment secrets, no writes during installation to any remote service.

## What changes

- The Leaderboard first-page and own-rank endpoints no longer force a brand-new revision on *every* page/rank request. Instead, they consult the existing canonical freshness mechanism (5 minute freshness window, updated points ledger and active user roster), sharing concurrent reconciliation by season.
- When `LEADERBOARD_D1_READ_ENABLED` is **false**, the canonical PostgreSQL response remains unchanged.
- When `LEADERBOARD_D1_READ_ENABLED` is **true**, the first page can now try the existing validated D1 read path, with PostgreSQL fallback on missing, outdated, or inconsistent D1. Do **not** enable the read flag yet: own-rank is still canonical and we must complete Phase 7.5B plus real production validation first.
- This is NOT a proactive periodic worker. If nobody reads the leaderboard, a cached LIVE snapshot can age out; a scheduled refresh would be a separate operational decision.

## Install in your existing local project

1. Back up / commit your current work. Extract this ZIP into `C:\projects\CHECKPOINT\99s-guide-1` (preserve directory structure).
2. `node scripts\apply-phase7-step5a.cjs` — must show `CHECK_PASS`, otherwise STOP and share `BASELINE_CHANGED` (no force).
3. `node scripts\apply-phase7-step5a.cjs --apply`
4. `npx tsx --test tests/phase7-leaderboard-live-freshness.test.ts`
5. `npm run typecheck`
6. `npm run build`
7. `npm run test:leaderboard`
8. `npx tsx scripts/phase7-leaderboard-row-parity.ts` — if it returns STALE only, that is expected until a new D1 projection is made; do not repeat first-projection.

## Git (after tests pass)

```
git add server/features/leaderboard/cacheReads.ts tests/phase7-leaderboard-live-freshness.test.ts
git diff --cached --check
git commit -m "Phase 7.5A refresh leaderboard snapshots only when needed"
git push origin main
```

## Render and Cloudflare

- **KEEP** `LEADERBOARD_D1_READ_ENABLED=false` in both local `.env` and Render.
- **KEEP** `LEADERBOARD_D1_PROJECTION_ENABLED=false` until Phase 7.5A is deployed and validated; then we can enable it separately and perform the live sync check. Enable only on Render when authorized.
- No need to redeploy Private Worker; the v2 worker already passed initial projection in prior Phase 7.4.
- Confirm the new Git commit was deployed to Render; Cloudflare Pages alone does not deploy your backend.

## Restore local files (not production)

`node scripts\apply-phase7-step5a.cjs --restore`

This command restores bytes saved to `.phase7-step5a-backup.json` only if current files still match the files installed by this patch. Restore is not a Git rollback and cannot undo a production deployment.

## Safety

- No `git add .`. Do not upload `.env`, JSON backups or payload JSON to GitHub.
- Never rerun the first projection after it succeeded.
- Revalidation is required even if unit tests pass. Never consider D1 cutover approved solely from unit tests.
