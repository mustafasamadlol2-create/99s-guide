# Prompt 48 Study Engine Regression Manifest

Run the cross-domain suite with:

```sh
npm run test:study-engine
```

The runner is sequential to reduce port contention and timing sensitivity. It
uses the existing domain tests rather than introducing a second set of product
rules.

| Domain | Test files |
| --- | --- |
| Solo Focus, timers, handoff, notes, audio, and client lifecycle | `tests/focus-*.test.ts`, `tests/prompt11-focus-client.test.ts` |
| Group Focus contracts, runtime, capability security, reconciliation, and transport | `tests/group-focus-*.test.ts` |
| Study Events, integrity, points, analyzer, insights, schema, and projections | `tests/study-*.test.ts` |
| Recall lifecycle, eligibility, tokens, cooldown, privacy, and rewards | `tests/recall-*.test.ts` |
| Gamification, challenges, levels, and achievements | `tests/gamification-*.test.ts` |
| Leaderboard snapshots, privacy, cursors, and D1 projection | `tests/leaderboard-*.test.ts` |
| Mastery and private D1 projection | `tests/mastery-*.test.ts`, `tests/lecture-mastery-*.test.ts` |
| Retention state, evaluation, and reconciliation | `tests/lecture-retention-*.test.ts` |
| Owner aggregate analytics and private access boundaries | `tests/owner-analytics*.test.ts` |
| Ask My Study Data grounding, routing, and privacy | `tests/ask-study-data-*.test.ts` |
| Private D1 outbox and projection contracts | `tests/private-d1-*.test.ts` |

Database-backed tests remain opt-in through their existing per-prompt safety
gates. The gates require explicit test-only enablement, a disposable schema,
and matching database URLs; the aggregate command does not enable them. When
the gate is absent, those tests report as skipped. Never point a gate at a
production or shared application schema.

The focused scripts in `package.json` remain available for domain-level
diagnosis. This manifest does not add migrations, production enablement,
monitoring, rollout controls, or device certification.