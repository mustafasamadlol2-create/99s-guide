# Study Engine Production Rollout Plan

## Current decision

**Mode: `PREPARE_ONLY`. Status: `BLOCKED — REQUIRED DEVICE CERTIFICATION INCOMPLETE`.**

Prompt 51 reports `READY_WITH_WARNINGS`, `MANUAL_DEVICE_REQUIRED`, `productionRolloutAllowed: false`, 23 `NOT_RUN` scenarios, 4 `BLOCKED` scenarios, and 75 database-gated test cases not verified against a disposable schema. The required iPhone, iPad, PWA, and database checks are not complete. No activation or dark deployment may begin.

The rollout-status command is intentionally read-only:

```sh
npm run study:rollout-status
npm run study:rollout-status -- --json
```

It reads the committed Prompt 51 certification manifest. It does not run Prompt 50, contact a database or provider, inspect production configuration, write a report, alter flags, or call deployment/migration tools. Its `NOT_RUN` Prompt 50 result is deliberate. Run the Prompt 50 release check separately against local/staging only after confirming the explicit target.

**Startup side effect observed during verification:** restarting the configured local preview ran `scripts/predev.cjs`, which rewrote `.env` with an empty patch (same observed 1,342-byte size; no configuration values were changed) and skipped `prisma db push`. The application’s existing startup health function called Prisma `User.findFirst()`. The configured development database target was not inspected, so it cannot be confirmed that this read was isolated from production. No write or migration ran. The release-control check itself had both local/staging database target variables unset and made no database connection. Avoid further app restarts or database checks until the development target is verified as disposable/local.

## Authorization boundary

This preparation tooling has no production execution implementation. `PREPARE_ONLY` is the only supported mode in its status command. Production changes remain with existing deployment/operator mechanisms and require a separate, explicit authorization for each production operation. A ready report is not authorization.

Do not use this guide to:

- deploy backend, frontend, or Workers;
- run production migrations, D1 migrations, maintenance, or backfills;
- inspect production configuration or database state;
- enable production flags;
- invoke AI providers;
- upload TestFlight builds or submit to the App Store.

None of those actions were run while preparing this plan.

## Required certification before reconsidering rollout

1. Complete `docs/IOS_MANUAL_CERTIFICATION_CHECKLIST.md` on a real iPhone using a non-production account.
2. Complete `docs/IPAD_MANUAL_CERTIFICATION_CHECKLIST.md` on a real iPad in portrait and supported landscape.
3. Complete `docs/PWA_MANUAL_CERTIFICATION_CHECKLIST.md` in a supported browser, including installation, offline behavior, service-worker update, stale-client recovery, and offline-write safety.
4. Identify a disposable local database schema and run the database-gated tests against that schema. Never use production for these tests.
5. Update the Prompt 51 manifest with actual evidence. Do not convert `NOT_RUN` or `BLOCKED` to `PASS` based on source inspection alone.
6. Run the applicable Prompt 48 regression, Prompt 49 maintenance safety, Prompt 50 observability, Prompt 51 certification, build, typecheck, lint, Prisma validation, and Prompt 50 release checks.
7. Review each `READY_WITH_WARNINGS` item. A warning is not non-critical merely because a feature is disabled.

The release gate must be `READY`, or have individually documented warnings proven non-critical. Any failed check blocks rollout.

## Planned stages

The order below is explicit and has no automatic advancement. The status utility only reports the plan; it cannot mark a stage complete or activate it.

| Stage | Prerequisites | Intended backend flags | Required operator checks | Rollback |
| --- | --- | --- | --- | --- |
| 0 — Dark deployment | Certification and release gates pass; explicit deployment approval | All OFF | Core routes, health/readiness, old-client contract | Stop the approved pipeline; preserve canonical data |
| 1 — Internal smoke | Stage 0 stable; existing authorized test accounts | All OFF unless existing account targeting is already supported | Focus, resource handoff, Quick Notes, completion, Points/Gamification, Recall, Mastery, Analyzer, Group with controlled accounts | Keep user-facing flags OFF |
| 2 — Solo Focus | Stage 1 observed healthy | `STUDY_EVENTS_ENABLED`, `FOCUS_HUB_ENABLED` | Plan/start/pause/resume/resource handoff/complete/history; calendar stays unchanged | Disable effective Focus gates; preserve history and events |
| 3 — Group Focus | Stage 2 stable; Group runtime and reconciliation healthy | `GROUP_FOCUS_ENABLED` | Two-account host/join/countdown/reconnect/complete/summary | Disable Group Focus; Solo Focus remains |
| 4 — Points and Gamification | Canonical event sources stable | `STUDY_POINTS_ENABLED`, `STUDY_INTEGRITY_ENABLED`, `GAMIFICATION_ENABLED` | Expected award, idempotent retry, balance/categories/Level/Achievements/Challenges | Dedicated award stop only if effective; never edit ledger rows |
| 5 — Leaderboard projection | Points source trusted | `LEADERBOARD_D1_PROJECTION_ENABLED` | Projection audit against PostgreSQL authority | Stop writes through an effective gate |
| 5a — D1 reads | Projection is ready and audited | `LEADERBOARD_D1_READ_ENABLED` | Ready snapshots and PostgreSQL fallback | Disable D1 reads; use PostgreSQL fallback |
| 6 — Recall | Points source stable | `SPACED_RECALL_ENABLED`, `RECALL_POINTS_ENABLED` | Server-authoritative issuance, cooldowns, attempts, eligible rewards | Disable issuance/rewards where effective; preserve attempts |
| 7 — Mastery and Retention | Recall/evidence foundations stable | `MASTERY_ENABLED` (declared; not an effective runtime guard today) | Deterministic evidence and retention evaluation | Hide UI/read surface by an effective mechanism; preserve evidence |
| 8 — Study Analyzer | Mastery/Retention validated | `STUDY_ANALYZER_ENABLED` | Deterministic, private output and calendar isolation | Disable UI/read surface by an effective mechanism |
| 9 — AI and Ask My Study Data | Analyzer stable; provider and privacy checks pass | `AI_STUDY_INSIGHTS_ENABLED`, `AI_STUDY_INSIGHTS_CACHE_ENABLED`, `ASK_MY_STUDY_DATA_ENABLED`, `ASK_MY_STUDY_DATA_AI_ENABLED` | Grounded facts, privacy boundaries, Cloudflare Workers AI only | Disable AI; deterministic Analyzer remains |
| 10 — Owner Analytics | Aggregate privacy and authorization checks pass | `OWNER_STUDY_ANALYTICS_ENABLED` (declared; not an effective runtime guard today) | Aggregate-only output and minimum-population rules | Disable through an effective mechanism |
| 11 — General availability | Each applicable stage separately observed and approved | No mass enable | Critical errors, privacy regressions, canonical invariants, stage smoke all pass | Disable affected feature first; preserve history |

### Flag and frontend limits

All 18 server Study Engine flags default to OFF. A declared flag is not automatically an effective kill switch. Current service/route runtime reads were confirmed for `STUDY_EVENTS_ENABLED`, `FOCUS_HUB_ENABLED`, `GROUP_FOCUS_ENABLED`, `SPACED_RECALL_ENABLED`, `RECALL_POINTS_ENABLED`, both Leaderboard D1 flags, AI Insights/cache, and Ask My Study Data/AI.

The following declared flags do **not** currently provide a verified runtime guard in feature services/routes: `FOCUS_RESOURCE_HANDOFF_ENABLED`, `STUDY_POINTS_ENABLED`, `STUDY_INTEGRITY_ENABLED`, `GAMIFICATION_ENABLED`, `MASTERY_ENABLED`, and `OWNER_STUDY_ANALYTICS_ENABLED`. Do not use them as rollback promises. Implement and test a guard in a separately scoped maintenance change before relying on one.

Study Engine production frontend routes are currently hard-disabled by `DEV` checks in `src/config/featureFlags.ts`. Build-time `VITE_*` values do not enable these production surfaces. No production client activation path is claimed here.

## Observation checkpoints

At each human-operated stage, review only operational correctness:

- Prompt 50 overall health and readiness;
- critical/new aggregate error families;
- outbox backlog and projection lag;
- Points failures and canonical ledger invariants;
- Group runtime and terminal reconciliation;
- D1 fallback correctness;
- Recall, Mastery, Retention, and Analyzer errors;
- AI degradation and deterministic fallback health;
- privacy/security signals and old-client compatibility.

Do not inspect individual students for release safety or use grades, accuracy, Mastery, Points, or study frequency as incident or cohort criteria. A stage requires an observation period and a separate human decision; success never advances the next stage automatically.

## Migration and maintenance conditions

No production migration or Prompt 49 maintenance action was run. If a future separately authorized release requires either:

- verify clean migration history, backward compatibility, and the existing backup/restore policy;
- use only additive/forward-compatible schema changes during mixed-version rollout;
- perform maintenance in `audit → dry-run → bounded canary → re-audit → wider apply` order;
- use the existing production confirmation mechanism;
- do not fabricate historical Points, Mastery, or Retention;
- do not drop tables/columns or delete canonical history as rollback.

## Versioned preparation artifacts

- `release/study-engine-rollout-profile.json` — intended all-OFF profile; it is not installed into any environment.
- `release/study-engine-release-manifest.json` — safe draft release inventory. It records the observed source versions and explicitly marks the production environment uninspected and Prompt 52 release check not run.
- `docs/STUDY_ENGINE_FINAL_RELEASE_AUDIT.md` — current gate and architecture audit.
- `docs/STUDY_ENGINE_ROLLBACK_RUNBOOK.md` — data-preserving incident response.