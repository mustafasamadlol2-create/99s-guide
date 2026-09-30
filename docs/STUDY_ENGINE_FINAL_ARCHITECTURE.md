# Study Engine Final Architecture and Safety Audit

## Authority map

```text
PostgreSQL canonical records
  → deterministic domain rules
  → derived projections and caches (including D1)
  → privacy-safe APIs
  → frontend
```

PostgreSQL remains the authority for canonical study records and Leaderboard ranking snapshots. D1 is derived state and must have a tested PostgreSQL fallback. AI may explain approved deterministic facts; it does not determine study facts or mutate canonical outcomes. Study Engine usage is not a personal academic Calendar planner. Opening a PDF/resource is a handoff and is not proof of reading, completion, Mastery, Retention, or Points.

## Feature and gate matrix

| Area | Backend flag(s) | Runtime guard confirmed | Production frontend |
| --- | --- | --- | --- |
| Study events / Solo Focus | `STUDY_EVENTS_ENABLED`, `FOCUS_HUB_ENABLED` | Yes, in event and Focus service paths | DEV-only |
| Focus resource handoff | `FOCUS_RESOURCE_HANDOFF_ENABLED` | No guard found | DEV-only |
| Group Focus | `GROUP_FOCUS_ENABLED` | Yes, route/service paths | DEV-only |
| Study Points / integrity / Gamification | `STUDY_POINTS_ENABLED`, `STUDY_INTEGRITY_ENABLED`, `GAMIFICATION_ENABLED` | No service-level shutdown confirmed; Points flag appears in health reporting | DEV-only |
| Recall / Recall rewards | `SPACED_RECALL_ENABLED`, `RECALL_POINTS_ENABLED` | Yes, issuance and reward paths | DEV-only |
| Mastery / Retention | `MASTERY_ENABLED` | No service-level shutdown confirmed; flag appears in health reporting | DEV-only |
| Leaderboard projection / reads | `LEADERBOARD_D1_PROJECTION_ENABLED`, `LEADERBOARD_D1_READ_ENABLED` | Yes, writer/read paths | Existing Leaderboard surface; D1 is derived |
| Study Analyzer | `STUDY_ANALYZER_ENABLED` | Yes, route path | DEV-only |
| AI Study Insights | `AI_STUDY_INSIGHTS_ENABLED`, `AI_STUDY_INSIGHTS_CACHE_ENABLED` | Yes, route/cache path | DEV-only |
| Ask My Study Data | `ASK_MY_STUDY_DATA_ENABLED`, `ASK_MY_STUDY_DATA_AI_ENABLED` | Yes, route/service path | DEV-only |
| Owner Analytics | `OWNER_STUDY_ANALYTICS_ENABLED` | No feature-service guard confirmed | DEV-only |

“No guard confirmed” means release operators must not rely on that registry flag as a kill switch. This audit does not add or claim new production frontend behavior.

## Privacy map

- Owner Analytics is intended to return aggregate-only data with population safeguards and owner authorization.
- Study Analyzer and Ask My Study Data use deterministic, privacy-scoped facts; AI output is bounded by those facts.
- Public profiles and Leaderboards must not disclose private study evidence, user identifiers beyond the product contract, or raw rollout cohort membership.
- System Health and release reports contain operational aggregates only.
- No study performance, grades, accuracy, health information, Mastery, Points, or study frequency is used for rollout eligibility.

## Compatibility and rollback

- Preserve old routes, accepted request shapes, and additive response compatibility for installed App Store clients.
- New frontend with flags OFF and old frontend with new backend must remain compatible before any backend deployment is considered.
- Worker protocol and D1 projection compatibility must be verified when those services are in scope.
- Roll back feature exposure before considering code rollback. Preserve canonical history and immutable ledgers.
- Production PWA/native behavior remains unverified until the Prompt 51 manual checklists are completed.

## Audit boundary

This document reflects repository source inspection and the Prompt 51 local certification manifest. It is not a production configuration, live database, Worker, privacy penetration, or deployment audit. Those checks were not performed. The current application release remains blocked by required device/PWA and database-gated certification.