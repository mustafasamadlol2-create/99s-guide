# Phase 6: transient Supabase connection retry hotfix

This patch changes ONLY `scripts/gamification-d1-phase6.ts`. It is for the
Prisma `Can't reach database server` (usually P1001) error during
`npm run gamification:d1:backfill` or `npm run gamification:d1:verify`.

## What it changes
- Tests PostgreSQL connectivity before resetting the disposable Phase 6 D1 table.
- Retries transient Prisma connectivity/pool failures up to five times with
  1s, 2s, 4s, 8s and 12s waits. Reconnects the existing Prisma client.
- Does NOT retry non-transient errors or change calculation/rules/awards.
- Does NOT change Supabase, Cloudflare Worker, Render or Phase 1-5.

## How to apply
1. Stop any running Phase 6 backfill; do not run it concurrently.
2. Keep `PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED=false`.
3. Replace `scripts/gamification-d1-phase6.ts` in your existing project
   (do not delete any other project files).
4. From PowerShell check connectivity:
   `Test-NetConnection aws-0-eu-central-1.pooler.supabase.com -Port 5432`
   If `TcpTestSucceeded : False`, investigate your network / Supabase health.
5. Once database connectivity is restored, run:
   `npm run gamification:d1:backfill`
   `npm run gamification:d1:verify`
6. Look for 123/123 account parity (if you still have 123 active accounts).

### Important
- The script intentionally begins with a reset of ONLY the disposable
  GamificationSnapshot D1 table, then rebuilds all active accounts. A previous
  partial run of 100/123 accounts is not considered a completed cutover.
- Canonical Challenge refresh may persist legitimate rewards. Take a Supabase
  backup beforehand; rules/rewards are expected to be idempotent.
- Never enable Phase 6 read cutover solely because these commands pass.
- No database migration, Worker deployment or Render redeploy is required for
  this local CLI-only hotfix.
- Never send .env, connection URLs, passwords, or Worker secrets in chat.
