# Phase 5 + Phase 6: Render build compatibility hotfix

**Apply after:** Phase 6 Gamification D1 candidate + Phase 5 Focus D1 Read Hotfix, in either order.

## Problem
The Phase 5 hotfix overwrote `server/services/privateD1Read.ts` with an older
module that did not export `phase6GamificationReadCutoverEnabled`, even though
`server.ts` added by Phase 6 imports it. The Phase 5 hotfix also replaced
`package.json` without Phase 6's `gamification:d1:*` scripts.

## Files
- `server/services/privateD1Read.ts`: retains Phase 5 timeout/retry/diagnostics
  and Phase 6 cutover flag export.
- `package.json`: retains Phase 5 diagnostic and Phase 6 backfill/verify scripts.

## Apply
Unzip at the **repository root** so the included `99s-guide-main/` subdirectory
merges into the existing project folder; overwrite the two files.

## Local checks
Run in `99s-guide-main`:

```sh
npm run build
npm run study-engine:d1:diagnose
```

Only run diagnose if the relevant environment secrets are configured.
Redeploy Render after the build succeeds. No Prisma migration, no D1 migration,
no backfill and no Worker redeploy are necessary for this compatibility fix.

**Cutover:** keep `PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED=false`
until Phase 6 backfill, verification, and acceptance tests have passed.
This patch only repairs build compatibility; it does not attest to production
network connectivity or data consistency.
