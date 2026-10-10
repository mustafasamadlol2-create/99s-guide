# Study Engagement data-readiness release checks

## Source-verified behavior

- The current source-controlled Gamification bundle is `gamification-v1`, with three achievements and four weekly challenges.
- The private summary, achievement, and challenge routes require an authenticated user and honor `GAMIFICATION_ENABLED`. A disabled route returns `FEATURE_DISABLED` without caching private responses.
- The frontend loads the server flags from `/api/study/features`. It does not treat an unavailable flag response as “disabled”; it displays a retryable unavailable state. An explicit false flag displays a disabled state.
- Leaderboard public entries include only a sanitized `User.name`. Email-like values, UUIDs, and empty names are omitted; emails and account IDs are not entry fields. Both PostgreSQL and D1-cache reads obtain display names from the active user record.
- Existing `User.name` supports this display field. This change adds no schema migration.

## Production verification status

Read-only inspection on 2026-10-10 confirmed that the five additive Gamification and leaderboard migrations listed below are applied successfully. Exactly one active rule set is registered as `gamification-v1`; its achievement, level, and challenge checksums match the current source bundle, and its lifecycle timestamps are valid. The destructive points/leaderboard reset migration is not present in production migration history.

The deployment service reports that this project has no active published deployment, and no production values for `GAMIFICATION_ENABLED` or `STUDY_POINTS_ENABLED` are available. Therefore production runtime flags and `/api/study/features` remain **unavailable**, not verified as enabled or disabled. Do not enable the feature based on database readiness alone.

## Checks required before enabling in production

1. Before enabling Study Engagement, publish the app with `GAMIFICATION_ENABLED=true` and `STUDY_POINTS_ENABLED=true`; then confirm `/api/study/features` returns both values as `true`. Confirm authenticated summary, achievement, challenge, and leaderboard reads succeed for a test account.
2. Recheck `_prisma_migrations` and confirm these additive migrations remain applied and successful:
   - `20260925130000_gamification_rule_sets`
   - `20260925140000_user_achievement_state`
   - `20260926100000_gamification_level_projection`
   - `20260926110000_gamification_challenges`
   - `20260926120000_leaderboard_canonical`
3. Reconfirm exactly one active `GamificationRuleSet` is registered as `gamification-v1` and all three definition checksums match the current source bundle.
4. **Do not apply** `20261010140000_reset_leaderboard_points_for_rebuild` as part of this release. It deletes canonical points, projections, legacy point rows, level rows, and leaderboard snapshots. Its status and the separate reset work must be resolved by the authorized operator before any migration deployment that could apply it.
5. Never run a production migration, repair, backfill, or points reset as part of these checks. Use the authorized, read-only production inspection path and the existing backup/approval process.

## Automated verification

Run `npm run typecheck`, `npm run build`, `npm run test:gamification`, `npm run test:gamification-achievements`, and `npm run test:leaderboard`. PostgreSQL cases are gated by explicit disposable-schema markers and must only run against isolated test schemas. Do not point those gates at production.

In this workspace, type checking, build, and non-database suites passed. The Prompt 22 rule-set, Prompt 23 achievement/challenge, Prompt 24 level/summary, and Prompt 26 leaderboard PostgreSQL cases passed against separate disposable schemas using their explicit safety gates. The standard test scripts still skip gated PostgreSQL cases when those markers are absent. Production database checks used only a dedicated read-only connection and a read-only transaction; no production data or schema was changed.
