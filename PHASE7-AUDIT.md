# 99’s Guide — Phase 7.1 Code Audit (22 Nov 2026)

Source: uploaded `99s-guide-main (50)(1).zip`. No access to live Render/Cloudflare flags, logs or canonical data in this audit. Never claim D1 leaderboard parity based on gamification 123/123.

## Existing code — do not rebuild
- Canonical seasons, snapshots, ranks, tie sizes and ledger aggregation: `server/features/leaderboard/{seasons,snapshots,scores,queries,reconciliation}.ts`, Prisma `LeaderboardSeason`, `LeaderboardSnapshot`, `LeaderboardSnapshotEntry`.
- D1 projection via outbox: `server/features/leaderboard/d1Outbox.ts`, `LeaderboardD1SyncOutbox`, Cloudflare private Worker `/internal/leaderboard-cache/`.
- D1 reads, metadata/snapshot/version checks, canonical fallback: `cacheReads.ts`, `cacheProtocol.ts`, `cacheReconciliation.ts`.
- Authenticated frontend: `src/features/gamification/{LeaderboardView,GamificationFrontend,api,types}.tsx/.ts`.
- D1 flags **default false** in `server/features/study-core/featureFlags.ts` and `.env.example` (deployment settings unknown).

## Confirmed gaps
1. **Public scope leak:** frontend `SCOPES` excludes WEEKLY but API availability and public rank/list accepted it. **Fixed in Phase 7.1:** availability lists only monthly, semester (if active), all-time; direct weekly list/rank request returns 400. Internal historical weekly processing untouched.
2. **D1 first page bypass:** `getLeaderboardPageWithCache` returns canonical PostgreSQL for `!input.cursor` after rebuilding a LIVE snapshot. Thus first-page D1 reads do not occur regardless of `LEADERBOARD_D1_READ_ENABLED`.
3. **D1 own rank bypass:** `getMyLeaderboardRankWithCache` rebuilds and returns canonical rank unconditionally. D1 rank endpoint is present but not used by this route.
4. **No proven Leaderboard D1 parity:** previous 123/123 is GamificationSnapshot, NOT leaderboard projection. Need independent comparison of current snapshots, rankings, ties, pagination, blocked-user visibility, source fingerprints and outbox delivery.
5. **Performance:** forcing snapshot rebuild on every active first-page and own-rank request might cause query/lock load. Must design freshness-aware safe route before D1 cutover; must never serve point totals behind the canonical ledger.

## Remaining Phase 7 sequence
- 7.1 Public scope contract **patched; locally requires user typecheck, build and tests**.
- 7.2 Read-only runtime inventory: flags, current seasons/snapshots, D1 cache manifest, outbox status; record no secrets.
- 7.3 Snapshot/revision/fingerprint and per-entry parity for Monthly / Semester / All Time; handle empty/late projection.
- 7.4 Controlled projection backfill and replay if tests pass; no point awards and no destructive operations.
- 7.5 Fix safe D1 read routing for first page and own rank while respecting ledger freshness and users' blocks; use failover.
- 7.6 Staging then monitored production cutover and rollback verification.

No migrations, worker uploads, DB writes, or production flag changes in this ZIP. Typescript full build is for the user’s local environment with installed dependencies; during packaging only transpilation/syntax and isolated period functions were verified.
