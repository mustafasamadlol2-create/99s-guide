# Study Engine Rollback and Incident Runbook

## Scope and first response

This is an operator runbook, not an automated rollback command. No production action has been performed or authorized by this document.

When a halt condition is detected:

1. Stop stage advancement and record the affected release/stage and time.
2. Classify the incident as `INFO`, `WARNING`, or `CRITICAL` using the existing Prompt 50 severity model.
3. For an affected feature, disable its **effective** runtime gate or user-facing surface through the approved existing control.
4. Keep the already deployed code if safe; prefer a forward fix to destructive schema rollback.
5. Preserve canonical records, event history, immutable Points ledger entries, Recall attempts, Focus history, and outbox evidence.
6. Review aggregate operational signals; do not use individual-student surveillance.
7. After the root cause is fixed, use Prompt 49 audit/repair procedures only when an explicit, scoped maintenance action is justified and authorized.

Immediate rollout halt conditions include:

- cross-account/private-data exposure, public-profile privacy leak, or privacy regression;
- duplicate canonical Points, invalid ledger mutation, or duplicate verified study credit;
- Focus lifecycle or Group terminal reconciliation corruption;
- unexpected Study Engine calendar events;
- incorrect Mastery/Retention mutation or ledger invariant failure;
- old-client breakage or critical migration issue.

AI provider degradation is normally `WARNING` if deterministic Analyzer behavior remains healthy. D1 degradation is normally `WARNING` if PostgreSQL fallback works. Group runtime degradation must not take down Solo Focus.

## Effective runtime controls observed in source

Service/route runtime checks currently exist for:

- `STUDY_EVENTS_ENABLED`, `FOCUS_HUB_ENABLED`;
- `GROUP_FOCUS_ENABLED`;
- `SPACED_RECALL_ENABLED`, `RECALL_POINTS_ENABLED`;
- `LEADERBOARD_D1_PROJECTION_ENABLED`, `LEADERBOARD_D1_READ_ENABLED`;
- `AI_STUDY_INSIGHTS_ENABLED`, `AI_STUDY_INSIGHTS_CACHE_ENABLED`;
- `ASK_MY_STUDY_DATA_ENABLED`, `ASK_MY_STUDY_DATA_AI_ENABLED`.

Verify the control in the deployed version before relying on it. A name in the feature-flag registry is not proof that a request path checks it.

These registry entries are **not verified as runtime shutdown controls** in feature services/routes: `FOCUS_RESOURCE_HANDOFF_ENABLED`, `STUDY_POINTS_ENABLED`, `STUDY_INTEGRITY_ENABLED`, `GAMIFICATION_ENABLED`, `MASTERY_ENABLED`, and `OWNER_STUDY_ANALYTICS_ENABLED`. Do not report rollback complete by setting one of these values. The production frontend surfaces are also DEV-only in current source; frontend production enablement is not implemented.

## Feature-specific rollback

| Feature | First response | Preserve |
| --- | --- | --- |
| Solo Focus | Disable effective Focus gates; keep core app available | Focus history and StudyEvents |
| Group Focus | Disable Group Focus; verify Solo Focus remains healthy | Sessions, reconciliation evidence, outbox |
| Points/Gamification | Use a dedicated tested award stop if available; stop affected path | Immutable ledger and legitimate award history |
| Leaderboard D1 | Disable D1 reads and verify PostgreSQL fallback; separately stop projection writes if needed | PostgreSQL snapshots and ranking authority |
| Recall | Disable issuance/UI and rewards through effective controls | Historical attempts, cooldown/evidence history |
| Mastery/Retention | Disable the read/UI surface through an effective mechanism | Canonical evidence and computed history |
| Study Analyzer | Disable its surface through an effective mechanism | Canonical source events |
| AI Insights / Ask My Study Data | Disable AI paths; retain deterministic Analyzer | Canonical study data and privacy-safe audit records |
| Owner Analytics | Disable the surface through an effective mechanism | Canonical data; do not broaden access |

## Prohibited rollback actions

- Do not delete StudyEvents, Focus history, Recall attempts, or canonical evidence to hide a defect.
- Do not edit/delete ledger rows, reverse all awards, or invent historical awards. An individually confirmed invalid award must use the existing immutable reversal procedure after investigation.
- Do not delete production data to roll back UI behavior.
- Do not drop tables/columns during mixed-version operation. Prefer a forward fix.
- Do not run every Prompt 49 repair/rebuild tool as a generic response.
- Do not use production student records as test fixtures.

## Privacy-safe incident notes

Record release/stage, timestamps, aggregate health signals, error family, affected subsystem, decision, and follow-up verification. Exclude credentials, raw confirmation material, student identifiers, private request payloads, and individual study outcomes.

After the incident, confirm the affected feature is actually disabled, fallback/core behavior is healthy, no canonical invariant is broken, and all stage advancement remains paused until a new human review.