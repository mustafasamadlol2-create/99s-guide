# Repository Audit — Focus Hub and Points / Gamification

Repository-only source audit. This report describes code and configuration defaults found in the workspace; it does not establish which environment flags are set, whether migrations have been applied to any database, or whether external Worker deployments are reachable. No database or environment values were inspected, and no tests or signed-in/device UI sessions were run. “Implemented” below means source code is wired to a route or caller where stated, not that production behavior was independently exercised.

## 1. Executive Summary

- **Focus Hub:** Source implements planning, presets, a persisted active session, timer transitions, short breaks, resource handoff, interruptions, history, summaries, and metrics. The authenticated API and PostgreSQL service are the canonical write path. The frontend maintains a responsive local timer view but reconciles it against server session state on lifecycle/realtime events. The web app also has local-only Focus Audio.
- **Focus data:** `FocusPlan`, `FocusPlanItem`, `FocusSession`, and `FocusBreak` data lives in PostgreSQL through Prisma. Focus transitions also write canonical `StudyEvent` records and update `StudyDailyMetric`; outbox rows replicate selected projections to private D1. Focus invalidations use Socket.IO. A private D1 Focus-session read path exists but is not used by the Focus service.
- **Group Focus:** This is a connected but separately flagged system. PostgreSQL owns rooms, memberships, and finalized summaries; a Cloudflare Worker and Durable Object provide realtime room state. The server verifies runtime summaries before persisting canonical events and awarding eligible points.
- **Study Points:** Source contains a server-side, idempotent ledger with source validation, daily/weekly caps, locking, reversal logic, and a balance projection. Current active award rules are verified Focus completion, Group Focus participation/social bonus, daily consistency, and eligible correct periodic Recall answers. MCQ-set and flashcard awards are explicitly unsupported. The `STUDY_POINTS_ENABLED` registry default is false, but the award paths do not use that flag as a general execution gate.
- **Legacy/read-mode mismatch:** `PointsLog` and `User.totalPoints` remain. The source default read mode is `LEGACY_ONLY`; therefore new ledger awards can coexist with level/lifetime displays and all-time ranking that still use legacy totals. Weekly/monthly ranking reads the new ledger. This needs operational attention before interpreting displayed totals as one unified balance.
- **Gamification UI:** The Profile entry is opt-in with `VITE_GAMIFICATION_FRONTEND_ENABLED`. The authenticated gamification, achievements, challenges, and leaderboard APIs are mounted regardless of `GAMIFICATION_ENABLED`; that server flag is not an observed authorization or route gate. Private UI refreshes on load/manual refresh, not through a found Focus/Gamification push listener.
- **Leaderboards:** Weekly/monthly/all-time are supported in source; semester selection exists but the server’s semester boundary list is empty, so semester requests can fail with missing season configuration. PostgreSQL snapshots are canonical. Optional D1 cache reads validate snapshot metadata and fall back to PostgreSQL.
- **Not verifiable from the repository:** Actual feature rollout, active ruleset rows, applied schema, live data, production deployment configuration, Worker availability, and signed-in visual/device behavior. The audit intentionally does not infer these from code.

## 2. Focus Hub — Frontend

**Entry and exposure.** `src/features/focus/components/FocusHub.tsx` is the Hub/planner screen, and `ActiveFocusScreen.tsx` is the active-session experience. `FOCUS_HUB_V2_ENABLED` in `src/config/featureFlags.ts` exposes the Hub in development by default unless explicitly disabled; production builds require `VITE_FOCUS_HUB_V2_ENABLED=true`. The entry is integrated in the main app rather than being a separate artifact.

**Planning and queue.** The Hub supports a lecture queue, per-lecture session counts, focus/break durations, ordering, a plan view, and presets including 25/5, 45/10, 50/10, 90/20, and Custom. Plan selection and normalization are shared through `focusHubModel.ts`; active-screen calculations use `focusActiveModel.ts`. `FocusLecturePicker.tsx` handles lecture selection. The source includes custom +/- steppers and a queue-specific scroll layout. The planner’s duration ring is a preview, not a completed-work indicator. Layout supports LTR/RTL, responsive breakpoints, dark mode, and safe-area spacing. There was no screenshot/device validation in this audit.

**Study and breaks.** `ActiveFocusScreen.tsx` renders the active session, pause/resume/end actions, current lecture/session position, plan progress, and break flow. Break state is a distinct persisted object, not Study time. Starting a break during active Study pauses Study and the chosen “resume on return” behavior is represented in persisted state; if Study was already paused, return should preserve that pause. Break pause/resume/return controls are available. No separate break-extension endpoint was found. Plan flags for MCQ, flashcards, and video configure post-Focus actions; they do not themselves complete those activities or award their points.

**History and summary.** `FocusHistoryScreens.tsx` provides history/summary screens, with styles in `focus-history.css`. It calls the Focus API for paged history, metrics, session summary, and post-Focus action context. The visual summary is sourced from persisted plan/session values; source memory explicitly distinguishes decorative planner progress from live session progress and disallows implying unsupported long-break scheduling or completion totals.

**Audio and notes.** `FocusAudioPlanningCard.tsx` and `src/features/focus-audio/*` implement ambient audio and local audio-file playback with a provider, playback engine, lifecycle handling, artwork, and preferences. `VITE_FOCUS_AUDIO_ENABLED` defaults on unless explicitly false. User-selected local audio is session-only and is not uploaded or persisted; preference storage is not a storage path for the selected file itself. Focus Quick Notes are **removed**, not merely hidden: no current Focus Quick Notes UI/API/model was found, and the repository has a forward drop migration (`20260929190000_remove_focus_quick_notes`). Unrelated notes are outside this feature.

**State and recovery.** `runtime/controller.ts`, `clock.ts`, `timer.ts`, `cache.ts`, `idempotency.ts`, `lifecycle.ts`, and `source.ts` maintain the client view and API operation keys. The client uses a monotonic clock for smooth countdown rendering but takes session status/timestamps from the server. Lifecycle handling covers browser visibility/page/network events and native app lifecycle; the app re-reads canonical state rather than treating a background timer as authoritative. `App.tsx` listens for `focus_state_changed`. Terminal mutation failures have a canonical-state recovery path; a transport/response error does not prove the server mutation failed.

## 3. Focus Hub — Backend/API

`server/routes/focus.ts` mounts authenticated routes under `/api/focus`; the route middleware derives the user ID from the authenticated request, validates request schemas, and maps `FocusError` to structured status/code responses. `server/features/focus/service.ts` and `repository.ts` own transitions and PostgreSQL access; `timer.ts` validates and calculates active/pause time from persisted start, planned-end, checkpoint, and accumulated seconds.

The session timer is not accepted as a client-supplied award duration. Session start, pause, resume, complete, abandon, handoff, interruption, and break operations use server-validated transitions and idempotency keys. Completion requires a ready timer state (with a small documented tolerance), persists a backend completion event and session evidence in the transaction, and invokes the Study Points awarder from the same transaction. The route then performs best-effort mastery/achievement/challenge refreshes after a first-seen completion; failures in those refreshes do not undo the committed session.

Plan and session ownership queries include both row ID and authenticated user ID. Writes are schema-validated, bounded JSON is enforced by the Focus JSON parser, and expected service errors return explicit codes. There is no general CRUD/delete-plan route: plans are created, listed, read, updated, and archived. An abandoned session is terminal and does not use the completion award path.

`FOCUS_HUB_ENABLED` and `STUDY_EVENTS_ENABLED` are checked by the Focus service; Study Events is a hard dependency for event-backed transitions. In contrast, `FOCUS_RESOURCE_HANDOFF_ENABLED` exists in the feature-flag registry but no runtime check was found in the Focus route/service/client. Thus its default-false registry entry does not establish that handoff is actually disabled.

## 4. Focus Hub — Database

Prisma/PostgreSQL is the canonical store; `prisma/schema.prisma` defines:

- `FocusPlan` and `FocusPlanItem`: owned plan, plan version/status/timezone, lecture order, session count, durations, and configured post-actions.
- `FocusSession`: session state, plan/lecture references, server timestamps/checkpoints, active/pause seconds, completion reason, and terminal state.
- `FocusBreak` and `FocusBreakCommand`: persisted break timing, pause/remaining state, resume-on-return choice, and idempotent break commands.
- `StudyEvent`: normalized event stream used for Focus lifecycle and downstream verification; per-user idempotency keys protect replays.
- `StudyDailyMetric`: per-user logical-day materialized counters, including Focus seconds, completed sessions, and interruptions (plus other study counters).
- `PrivateD1SyncOutbox`: durable transactional projection delivery for private D1.

Focus daily ranges use `Asia/Baghdad` logical dates. The current metric endpoint exposes `today`, `last7Days`, and month-to-date ranges. `FocusPlan` and `FocusSession` projection records are separate D1 read models, not the canonical write store. Relevant repository migrations include Focus/events, D1 outbox, the Quick Notes add/drop history, and the October 2026 break-runtime and pause/resume migrations. Their presence does **not** prove they are applied to any configured database.

Group Focus adds the PostgreSQL models `GroupFocusRoom`, `GroupFocusMembership`, `GroupFocusRun`, and `GroupFocusParticipantSummary`. It shares `StudyEvent`, `StudyPointsLedgerEntry`, and related projections, but is not a solo Focus session row.

## 5. Focus Hub — Cloudflare / Realtime / Cache

**Socket.IO:** successful mutating `/api/focus` responses broadcast `focus_state_changed` to `user-${userId}` from `server.ts`. `src/App.tsx` subscribes and refreshes Focus-facing state. This is an invalidation signal; PostgreSQL remains authoritative. The signal is emitted after any successful mutating Focus route, not as the session clock itself.

**Private D1:** Focus plan and daily-metric projections are written through `server/services/privateD1Sync.ts` and drained by a server-started outbox worker. The private-data Worker exposes `/internal/private-read/focus-plans`, `/internal/private-read/focus-sessions`, and `/internal/private-read/study-daily-metrics`; reads require Worker configuration and a shared private-sync header. Focus plan and daily-metric reads are wired into the service behind `PRIVATE_D1_FOCUS_PLAN_READS_ENABLED` and `PRIVATE_D1_STUDY_DAILY_METRIC_READS_ENABLED`; Focus reads use a short 600 ms timeout, validate user scope/IDs/version/revision/date/counters, and fall back to PostgreSQL on disabled, malformed, or failed reads. A nonempty D1 result can be returned without a freshness comparison to a PostgreSQL watermark, so asynchronous projection lag can present stale/incomplete data until the outbox catches up.

**Unused projection reader:** `fetchFocusSessionProjections` and the Worker session read route exist, and session projections are enqueued, but the Focus service imports and uses only plan and daily-metric readers. No session-history/current-session D1 read use was found.

**Group Focus Worker:** `cloudflare-group-focus-worker/src/index.ts` routes room WebSockets into `GroupFocusRoom.ts`, a Durable Object backed by room/runtime state modules. Authenticated app REST calls create/join/manage rooms and obtain short-lived capability credentials; the Worker forwards verified credentials to the Durable Object. The Durable Object owns realtime coordination, not canonical completed study summaries. It posts snapshots/final summaries to authenticated internal routes under `/api/internal/group-focus/runtime`; the server validates signatures/contracts and reconciles persisted summaries/events. This Worker path is optional/flagged and was not runtime-probed.

## 6. Focus Hub — Current Data Flow

1. **Plan:** `FocusHub` and `focusApi.ts` send a validated plan request to `/api/focus/plans`. The authenticated route calls `FocusService`, which writes `FocusPlan`/`FocusPlanItem` and enqueues their D1 projection in the same PostgreSQL transaction. The UI receives the canonical DTO.
2. **Start and transitions:** the client runtime sends a unique idempotency key to `/api/focus/sessions/start` or a session transition route. The service verifies ownership/current state, applies the server timer transition, writes `FocusSession` and `StudyEvent`, and queues applicable projections. A successful mutation broadcasts a Socket.IO invalidation; subscribers refetch canonical data.
3. **Pause/background/reload:** the client uses monotonic time only for presentation. On foreground, visibility, reconnect, app resume, or invalidation, it fetches `/sessions/current` (and related break state) and reconciles with server timestamps. If server timer invariants cannot be safely resolved, the API returns reconciliation-required state rather than trusting the client clock.
4. **Complete:** server completion is validated against persisted timing; a backend-sourced `focus_session_completed` event is recorded. In the same transaction, Study Points verifies the source evidence, idempotently appends any eligible ledger entry and updates the balance projection. After commit, mastery/achievement/challenge refreshes are best effort.
5. **History/metrics:** history and summary APIs query PostgreSQL canonical sessions/events/ledger context. Metrics may read the validated D1 daily-metric projection when enabled, otherwise PostgreSQL. The UI updates from API results and realtime invalidation.
6. **Group Focus:** REST room/member operations create server-authorized access; the Worker/DO manages realtime participation; signed summary reconciliation persists PostgreSQL group-run/participant records and canonical study evidence, then downstream achievement/challenge/points work uses the verified server record.

## 7. Focus Hub — Problems / Risks / Missing Wiring

- **Handoff flag is declarative only:** `FOCUS_RESOURCE_HANDOFF_ENABLED` defaults false in `featureFlags.ts`, but the service and route do not check it. This is an apparent rollout-gate gap.
- **Session D1 reader is dead/unconnected:** session projections are written and a Worker reader exists, but the Focus service does not call it. It adds projection-maintenance surface without reducing current-session/history PostgreSQL reads.
- **Projection freshness:** Focus D1 plan/metric responses are structurally and scope-validated, but there is no observed revision/watermark freshness comparison against canonical PostgreSQL on these read paths. A valid but delayed projection may be served until the outbox catches up.
- **Quick Notes status:** feature removed, with historical add/drop migrations. Do not mistake the old migration for a live UI/API feature.
- **Feature flags are not deployment evidence:** default false values say nothing about the runtime’s actual env. The report did not inspect values.
- **Refresh load:** each successful mutation emits invalidation; clients that subscribe may refetch several related resources. This is reasonable for correctness but could create duplicate reads across multiple open views/tabs. No runtime traffic measurement was made.
- **Error reconciliation is important:** a committed terminal mutation can be followed by client transport/protocol failure. Treating every API rejection as “nothing changed” risks stale route/state; the source has a reconciliation path, but it should remain covered by tests.
- **Breaks are distinct from Study:** the persisted break lifecycle and user choice support the pause/return behavior; break duration is not Focus-earned time. UI changes must not add unsupported phases or imply break seconds count as study.
- **No Group Focus UI guarantee:** Worker/backend functionality is present, but frontend visibility requires `VITE_GROUP_FOCUS_FRONTEND_ENABLED=true`, server rollout requires its own flag, and a Worker URL is needed. Runtime availability was not confirmed.

## 8. Points & Gamification — Frontend

`src/features/gamification/GamificationFrontend.tsx` provides overview, achievements, challenges, and leaderboard tabs, with bilingual text and styles in `gamification.css`. It is opened from Profile via `ProfileView.tsx` only when `GAMIFICATION_FRONTEND_ENABLED` is true; the build flag is `VITE_GAMIFICATION_FRONTEND_ENABLED`, false unless explicitly set to `"true"`.

`src/features/gamification/api.ts` requests:

- private summary from `/api/me/gamification`;
- achievements from `/api/me/achievements`;
- challenges from `/api/me/challenges`;
- pages from `/api/leaderboards/:scope`;
- the viewer’s rank from `/api/me/leaderboard-rank`;
- a selected participant’s sanitized profile from `/api/users/:userId/gamification`.

The API client requests no-store/bypasses its normal cache. Summary, achievements, and challenges load in parallel on view refresh; leaderboard pages are cursor-paginated. A manual Refresh control is present. No listener for `focus_state_changed` or a gamification-specific socket event was found in this frontend; a page left open after Focus completion can be stale until refresh/reload.

The UI is private and opt-in, but the server APIs are independently mounted and authenticated. Hiding this frontend does not hide or disable server endpoints. A ledger-history/reversal interface was not found.

## 9. Points & Gamification — Backend/API

### Study Points

`server/features/study-points/awardEngine.ts`, `awardRules.ts`, `sources/*`, `integrityGate.ts`, and `ledger.ts` implement server-side award evaluation and append/reversal operations. The caller supplies source identifiers/evidence, not arbitrary point amounts; source adapters re-read/validate canonical Focus, Group Focus, consistency, or Recall data. A candidate award is rejected if the source is unsupported, insufficient, duplicated, inconsistent, or over a cap.

Current source-defined rules in `awardRules.ts`:

- Focus verified completion: minimum 600 active seconds; 4 points at 10–24 minutes, 8 at 25–44, 12 at 45–59, 16 at 60–89, and 20 at 90+ minutes.
- Group Focus verified participation: uses the Focus completion schedule; eligible sessions can also receive a +2 verified social bonus after 25 minutes, capped at 3 bonuses / 6 bonus points per Baghdad day.
- Daily consistency: +5 once for a verified study day with at least 25 Focus minutes.
- Periodic Recall: +2 for a server-verified correct objective answer; daily cap 6, weekly cap 20. This path is separately gated by `RECALL_POINTS_ENABLED`.
- MCQ verified set and flashcard due-review descriptors are `INACTIVE_UNSUPPORTED`, despite matching plan/activity concepts existing elsewhere.

`caps.ts` applies category/day caps (FOCUS 60, MASTERY 40, PROGRESS 30, CONSISTENCY 5) and a 100-point overall daily cap. Award transactions use idempotency uniqueness plus advisory locks around the user balance, caps, and idempotency keys. Same-key/same-payload retries replay; changed payloads conflict. Verified source rows and transaction boundaries mitigate client replay/farming; they do not make abuse impossible if a canonical source itself is invalid.

### Reversals and projections

`reverseStudyPointsLedgerEntry` writes an equal-and-opposite `REVERSAL` row, preserves category, updates the balance projection, and only permits a same-user eligible original once. It rejects reversal rows, already-reversed rows, and imported legacy rows. The operation exists in the ledger service but no user-facing reversal route or ordinary admin reversal route was found.

`StudyPointsBalanceProjection` is incrementally updated after append/reversal. Accounting audit/reconciliation and projection repair logic exist; admin endpoints support a user’s reconciliation and repair of the projection. The balance is a projection of ledger rows, not an independent award source.

### Gamification APIs and lifecycle

`server/routes/gamification.ts`, `achievements.ts`, `challenges.ts`, and `leaderboards.ts` mount authenticated reads. `GAMIFICATION_ENABLED` defaults false but does not gate the observed routers; the Profile UI has a separate frontend flag. Achievement/challenge refreshes are invoked after Focus and Group Focus, and Study Points has a post-commit refresh hook. Reads also reconcile/refresh in their service paths.

Rule-set, checksum, level, achievement, challenge, and metric services are in `server/features/gamification/*`. The static definitions are versioned, but actual active database rule-set rows/checksums were not inspected. No startup auto-activation or ordinary user activation API was found; the existence of draft/activation service methods is not proof that the deployed database has a matching active ruleset.

## 10. Points & Gamification — Database

Relevant Prisma models and roles:

- `User` and `PointsLog`: retained legacy points/level fields and records; `User.totalPoints` remains a compatibility source.
- `StudyPointsLedgerEntry`: append-only award, import, or reversal record with category, source/rule version, idempotency, and reversal linkage.
- `StudyPointsBalanceProjection`: derived current/category totals maintained as ledger rows change; rebuildable/reconcilable.
- `StudyEvent`, `FocusSession`, `GroupFocusRun`, `GroupFocusParticipantSummary`, and `RecallAttempt`: canonical evidence/source data used to qualify awards.
- `GamificationRuleSet`: versioned/checksummed definition lifecycle.
- `UserAchievementProgress` and `UserAchievement`: private per-user progress and unlock records.
- `UserGamificationLevel`: persisted/rebuildable level projection.
- `UserChallengeProgress`: challenge period instance, progress, and status.
- `LeaderboardSeason`, `LeaderboardSnapshot`, and `LeaderboardSnapshotEntry`: canonical period definition, generated scoring snapshot, rank/tie/score/user/level snapshot values.
- `LeaderboardD1SyncOutbox` and `PrivateD1SyncOutbox`: projection delivery queues.
- `StudyDailyMetric`: per-day derived counters consumed by Focus/challenge/read paths.

The schema and migration chain include Study Points ledger/balance, gamification rules/levels/challenges, and canonical leaderboard migrations. `PointsLog` is not dropped by the new system. No data rows, constraint state, applied migration status, or current balances were inspected.

## 11. Leaderboards

`server/features/leaderboard/{periods,seasons,scores,snapshots,queries,cursor,locks,reconciliation}.ts` supplies ranking and snapshot behavior; `routes/leaderboards.ts` exposes user reads and protected maintenance operations.

- **Weekly/monthly:** server-defined time windows and verified Study Points ledger scores, with stable cursor pagination.
- **All-time:** lifetime score is selected through the compatibility read mode. Source default `LEGACY_ONLY` means `PointsLog`/legacy totals, not newly appended ledger entries.
- **Semester:** `SEMESTER` is a recognized scope in code, but the server-owned semester boundary array is empty. Selecting/requesting semester can return `LEADERBOARD_SEASON_CONFIGURATION_MISSING`; it is not a configured working period.
- **Rank logic:** a canonical snapshot stores rank, tie size, score, user ID, and level snapshot. Rows are ordered by rank, score, and user ID for stable pages; tied ranks follow SQL `RANK()` semantics, so later ranks can have gaps. The authenticated viewer’s block relationships are used to filter visible entries/counts.
- **Snapshots:** PostgreSQL snapshot rows are canonical. Pages and own-rank read a readable snapshot rather than recomputing a full leaderboard for each page. Rebuild/finalize/reconciliation/repair are maintenance paths, not normal user actions.
- **D1 cache:** optional Worker cache is a replica of a PostgreSQL snapshot and validates snapshot identity/fingerprint/freshness; failures or stale cache fall back to PostgreSQL. Outbox drainers are started by the server. Cache availability is not required for canonical results.

No snapshot contents or current season rows were inspected, so this section describes code behavior only.

## 12. Achievements

`server/features/gamification/definitions.ts` contains three source-defined achievements (private visibility): a first Focus completion, a points milestone, and a first Group Focus run. Evaluation/progress/read/refresh logic is split across `achievementEvaluation.ts`, `achievementProgress.ts`, `achievementRead.ts`, `achievementRefresh.ts`, and related maintenance/types files.

Focus completion triggers a best-effort post-commit achievement refresh. Group summary reconciliation also schedules an achievement refresh. The achievement read route is authenticated and may reconcile progress before returning it. Unlocks are persisted per user and keyed against definition/checksum versions; checksum compatibility code deliberately keeps Challenge hashes separate from Achievement/Level hashes.

Since the source definitions are private, they do not appear in public participant profiles. The points-milestone achievement reads the compatibility total; with source default `LEGACY_ONLY`, new ledger awards may not count toward that milestone unless the read mode is changed or the achievement’s source is adjusted. Active definition registration and live unlock rows are unverified.

## 13. Challenges / Levels / Public Profile

**Challenges.** Four weekly challenge definitions are source-defined. Instances/progress are per-user and week-bounded; refresh paths compute supported metrics from canonical Focus/group records and Baghdad-local windows. Focus completion explicitly refreshes `focus.completed_sessions`, `focus.verified_seconds`, and `consistency.qualifying_days`; Group Focus refreshes related sources. The challenge UI shows progress/status but no claim/reward workflow was found. The dedicated qualifying-day window calculation should not be taken as evidence that every general consistency metric is available through the metric registry.

**Levels.** `levelMath.ts`, `thresholds.ts`, `levelService.ts`, and the persisted `UserGamificationLevel` model calculate/cache level and max level from the selected compatible lifetime total. The source read mode defaults to legacy, so a new Study Points ledger can move while level/XP lifetime totals remain based on `PointsLog`. Projection checks/reconciliation exist; current projection state is unknown.

**Public profile.** Authenticated `GET /api/users/:userId/gamification` calls `publicProfile.ts`. It returns only profile-safe fields and visibility-approved achievements, not private challenge progress, ledger entries, attempts, candidate IDs, or detailed totals. Current source achievements are private, so the public payload is limited accordingly. Block/privacy checks are enforced server-side; the frontend uses the endpoint only for a selected leaderboard participant.

## 14. Cloudflare / D1 / Projection Architecture

- **Canonical database:** Prisma/PostgreSQL owns Focus, Group Focus, canonical Study Events, points ledger/projection, gamification progress, seasons, snapshots, and outboxes.
- **Private-data Worker/D1:** `cloudflare-private-data-api/src/index.ts` plus migrations `0001_study_engine_batch_a_projections.sql` and `0002_leaderboard_cache.sql` maintain private study projections and leaderboard cache. Server-to-Worker reads/writes use a shared private-sync secret header, no-store requests, and user-scope checks; actual secret values were not inspected.
- **Outboxes:** PostgreSQL writes and projection enqueueing are transactionally coupled. `server.ts` starts both `startPrivateD1SyncDrainer()` and `startLeaderboardD1OutboxDrainer()`. This avoids losing a queued projection if the source transaction fails, but delivery remains asynchronous.
- **Focus D1:** plans and StudyDailyMetric reads are wired; FocusSession projection read is not consumed. Default feature flags disable the private read paths unless explicitly configured.
- **Leaderboard D1:** snapshot cache has explicit reconciliation/repair, outbox and cache protocol; D1 is a cache, not ranking authority.
- **Group Focus Worker:** `cloudflare-group-focus-worker/src/index.ts`, `GroupFocusRoom.ts`, `roomState.ts`, `runtimeState.ts`, and `capability.ts` implement WebSocket/Durable Object coordination. Canonical summary reconciliation returns through authenticated/signed server paths; the Worker is not the source for awarded points.
- **Client access:** no direct browser-to-Supabase/PostgreSQL access was found for these features. Frontend requests use same-origin `/api` routes; database and private D1 credentials remain server-side.

## 15. Legacy / Duplicate / Dead Code

- **Legacy points:** `PointsLog`/`User.totalPoints` continue to serve compatibility reads and may remain visible in existing parts of the app. New Study Points are not generally mirrored back to legacy `PointsLog`.
- **No-op old award helper:** the frontend’s old `handleAddPoints` path is a no-op; it is not the current trusted award mechanism.
- **Mixed balance semantics:** default `LEGACY_ONLY` lifetime/level/all-time behavior can diverge from ledger categories and weekly/monthly scores. A switch to `LEGACY_PLUS_LEDGER`/ledger-only has baseline/cutover checks; it should not be assumed from code presence.
- **D1 dead read path:** Focus-session D1 reads exist but no consumer was found in the Focus service.
- **Quick Notes:** old migration history remains, but the current feature and model are removed by a forward migration.
- **Unsupported awards:** MCQ-set and flashcard award rules are descriptors only and explicitly inactive/unsupported.
- **No live Focus/Gamification bridge:** Focus invalidation is wired to Focus application state; GamificationFrontend does not subscribe to it. Post-commit backend refresh does not itself guarantee an already-mounted client view reload.
- **Rule activation:** draft/activation helpers do not prove an active DB ruleset; there is no observed startup activation path or user activation route.

## 16. Performance & Synchronization Findings

- **PostgreSQL load:** canonical Focus reads, transitions, history, point source validation, and leaderboard snapshots use PostgreSQL. Focus DTO generation can make separate completed-session and break lookups; current-session calls are bounded, while history/summary and repeated view refreshes deserve query-plan review under real data. No query plan or load test was run.
- **Potential repeated reads:** Focus completion triggers asynchronous mastery, achievements, and challenge refreshes; there is also a Study Points post-commit refresh hook. These can repeat some canonical metric/source reads. They are best effort and do not block the committed response, but can increase query fan-out.
- **N+1:** no obvious per-leaderboard-row database query was seen in the snapshot page path; page/count are batched. This source review did not prove the absence of N+1 behavior in every refresh/evaluation helper.
- **Projection lag:** private D1 outboxes are asynchronous. Focus plan/metric readers validate structure and scope but can accept a valid lagging projection. Leaderboard D1 has stronger snapshot freshness/reconciliation checks and canonical PostgreSQL fallback.
- **Worker/realtime:** Socket.IO carries invalidation, not high-frequency timer ticks. Group Focus uses a Durable Object for realtime and sends canonical summaries back for server verification; this limits PostgreSQL writes during live collaboration but depends on Worker URL, capability validity, and summary reconciliation.
- **No client polling finding:** Focus timer rendering is local-clock-driven and reconciled on lifecycle/events; no high-frequency API timer polling was found. Gamification view uses explicit loads/manual refresh rather than push refresh, so it can be stale rather than polling excessively.
- **Race protection:** Focus/Study Event idempotency, ledger advisory locks, unique reversal link, leaderboard locks/snapshot identity, and D1 revision fencing reduce duplicate/racing mutations. Correct behavior still depends on database constraints and configured migrations, which were not checked.

## 17. Security / Permissions Findings

- Focus and private gamification endpoints require an authenticated user. Focus service queries scope rows to that user; writes do not trust a client-supplied owner ID.
- Study Points awards derive amounts and eligibility from server-held evidence and use transaction/idempotency/cap enforcement. The ledger reversal method scopes the original row to the same user; it is not exposed as an ordinary client route.
- Public gamification profiles are allowlisted/sanitized; challenge progress and private achievements are not public by default. Leaderboard visibility uses block filtering and a profile-safe endpoint.
- Admin reconciliation/repair/review paths use `requireAdmin` in `server.ts`; they are not exposed by the Profile UI.
- Group Focus uses short-lived capabilities for Worker room access, authenticated REST membership operations, and a server internal summary path with signature/contract validation. Do not treat arbitrary Durable Object client claims as award evidence.
- Private Worker calls carry a server-side secret and use no-store semantics. No values were read or reproduced.
- Feature flags are **not** security controls. In particular, `GAMIFICATION_ENABLED` and `STUDY_POINTS_ENABLED` are not observed as general route/award gates; hiding the frontend does not disable authenticated endpoints or backend execution paths.
- No direct browser-to-database path for Focus/points/gamification was found.

## 18. Full Relevant File List

Core frontend:

- `src/App.tsx`; `src/config/featureFlags.ts`
- `src/features/focus/api/focusApi.ts`
- `src/features/focus/focusActiveModel.ts`; `src/features/focus/focusHubModel.ts`
- `src/features/focus/runtime/{cache,clock,controller,idempotency,index,lifecycle,source,timer,types}.ts`
- `src/features/focus/components/{ActiveFocusScreen,FocusAudioPlanningCard,FocusHistoryScreens,FocusHub,FocusLecturePicker,FocusSessionHandoff,FocusVisuals}.tsx`
- `src/features/focus/components/{focusAudioArtwork,focus-history.css,focus-hub-approved.css,FocusTimerScene.css}`
- `src/features/focus-audio/{ambientCatalog,constants,engine,errors,focusBridge,hooks,id3Artwork,index,lifecycle,localFile,preferences,provider,store,types}.ts` (`provider.tsx` is TSX)
- `src/features/gamification/{api,GamificationFrontend,index,types}.ts` (`GamificationFrontend.tsx`); `src/features/gamification/gamification.css`
- `src/features/profile/components/ProfileView.tsx`

Core backend:

- `server.ts`
- Routes: `server/routes/{focus,groupFocus,groupFocusRuntimeInternal,gamification,achievements,challenges,leaderboards,recall,adminStudyPoints,adminStudyIntegrity}.ts`
- Focus: `server/features/focus/{errors,historyCursor,index,repository,schemas,service,timer,types}.ts`
- Group Focus: `server/features/group-focus/{capability,errors,index,runtimeSummary,schemas,service,types}.ts`
- Study Points: `server/features/study-points/{accountingAudit,aggregate,awardEngine,awardRules,awardTypes,balanceProjection,caps,constants,cursor,cutover,errors,fingerprint,idempotency,index,integrityGate,ledger,legacyBridge,locks,metadata,postCommitHooks,readModel,reconciliation,repairPlanner,types,validation}.ts`; `server/features/study-points/sources/{consistency,focus,groupFocus,recall}.ts`
- Gamification: all source in `server/features/gamification/`, including achievement, challenge, checksum, level, metric, public-profile, ruleset, and validation modules.
- Leaderboards: all source in `server/features/leaderboard/`, including `cacheProtocol.ts`, `cacheReads.ts`, `cacheReconciliation.ts`, `d1Outbox.ts`, `queries.ts`, `scores.ts`, `seasons.ts`, and `snapshots.ts`.
- Study core/events/integrity: all source in `server/features/study-core/`, `server/features/study-events/`, and `server/features/study-integrity/` (including `study-integrity/persistence/*`).
- Recall evidence and attempts: all source in `server/features/recall/`.
- Projection services: `server/services/privateD1Read.ts`, `server/services/privateD1Sync.ts`.
- Workers: `cloudflare-group-focus-worker/src/{GroupFocusRoom,capability,index,roomState,runtimeState}.ts`; `cloudflare-group-focus-worker/{wrangler.jsonc,tsconfig.json,worker-configuration.d.ts}`; `cloudflare-private-data-api/src/{index,leaderboardCache}.ts`.
- Schemas/migrations: `prisma/schema.prisma`; relevant migrations listed in sections 4 and 10; `cloudflare-private-data-api/migrations/{0001_study_engine_batch_a_projections.sql,0002_leaderboard_cache.sql}`.
- Release/health support: `server/release/stageDefinitions.ts`, `server/observability/health.ts`, `scripts/study-release-check.ts`.

This inventory focuses on implementation and directly connected wiring, not every shared UI primitive, translation dictionary, generic auth/API helper, or unrelated application model.

## 19. Full Relevant API Endpoint List

All application endpoints below are same-origin and authenticated unless marked internal/admin. Paths are mounted as shown in `server.ts`.

**Focus (`/api/focus`, `server/routes/focus.ts`):**

- `GET /metrics`
- `POST /plans`; `GET /plans`; `GET /plans/:planId`; `PATCH /plans/:planId`; `POST /plans/:planId/archive`
- `POST /sessions/start`; `GET /sessions/current`; `GET /history`
- `GET /sessions/:sessionId/summary`; `GET /sessions/:sessionId/post-actions`; `GET /sessions/:sessionId/break`
- `POST /sessions/:sessionId/break/start`; `/break/pause`; `/break/resume`; `/break/return`
- `POST /sessions/:sessionId/pause`; `/resume`; `/complete`; `/abandon`
- `POST /sessions/:sessionId/handoff/start`; `/handoff/return`; `/interruptions`

**Group Focus (`/api/group-focus`, `server/routes/groupFocus.ts`):**

- `POST /rooms`; `POST /rooms/:roomId/capability`
- `GET /rooms/public`; `GET /rooms/mine`; `GET /rooms/:roomId`; `GET /rooms/:roomId/summary`; `GET /rooms/:roomId/members`
- `POST /rooms/:roomId/join`; `/leave`; `/members/:userId/remove`; `/close`; `/invite/rotate`
- `PATCH /rooms/:roomId/me/lecture`
- Internal authenticated/signed runtime callbacks: `POST /api/internal/group-focus/runtime/snapshot` and `/summary` (`server/routes/groupFocusRuntimeInternal.ts`).

**Points / Gamification / leaderboard:**

- `GET /api/me/gamification`
- `GET /api/me/achievements`
- `GET /api/me/challenges`
- `GET /api/users/:userId/gamification`
- `GET /api/leaderboards/:scope`; `GET /api/me/leaderboard-rank`
- Admin season/snapshot rebuild, finalize, reconciliation, and repair endpoints are mounted under `/api/admin/leaderboards`; details are in `server/routes/leaderboards.ts`.
- `GET /api/admin/study-points/users/:userId/reconciliation`; `POST /api/admin/study-points/users/:userId/reconciliation/repair-projection`
- `GET /api/admin/study-integrity/signals`; `GET /api/admin/study-integrity/signals/:signalId`; `POST /api/admin/study-integrity/signals/:signalId/review`

There is no observed ordinary user endpoint for ledger history or ledger reversal.

**Recall paths relevant to Study Points (`/api/recall`, `server/routes/recall.ts`):**

- `GET /eligibility`; `GET /attempts/:attemptId` (protected attempt read)
- `POST /next`; `POST /attempts/:attemptId/answer`; `POST /attempts/:attemptId/skip`

**Worker/internal D1 routes:**

- Private-data Worker: `GET /health`; `POST /internal/private-sync`; internal private reads `/internal/private-read/focus-plans`, `/focus-sessions`, `/study-daily-metrics`; `/internal/leaderboard-cache/*` read/write/reconciliation protocol.
- Group Focus Worker: `GET /health`; WebSocket connection route for a room under `/rooms/:roomId/connect`; room coordination then occurs through Durable Object messages.

## 20. Full Relevant Database Model/Table List

**Focus and shared study evidence**

- `FocusPlan`, `FocusPlanItem`, `FocusSession`, `FocusBreak`, `FocusBreakCommand`
- `StudyEvent`, `StudyDailyMetric`, `PrivateD1SyncOutbox`
- `GroupFocusRoom`, `GroupFocusMembership`, `GroupFocusRun`, `GroupFocusParticipantSummary`

**Points and Gamification**

- `User`, `PointsLog`
- `StudyPointsLedgerEntry`, `StudyPointsBalanceProjection`
- `GamificationRuleSet`, `UserAchievementProgress`, `UserAchievement`, `UserGamificationLevel`, `UserChallengeProgress`
- `RecallAttempt`, `RecallItemState` (Recall source/eligibility state; answer records feed evidence)
- `IntegritySignal`, `IntegrityReviewAction` (integrity observations and administrative review)

**Leaderboards / D1 sync**

- `LeaderboardSeason`, `LeaderboardSnapshot`, `LeaderboardSnapshotEntry`, `LeaderboardD1SyncOutbox`
- Private D1 projection tables are defined in the Worker migrations; they are replicas/cache tables, not Prisma canonical models.

`User` is shared and contains legacy total/level compatibility fields. The audit did not inspect row contents, database constraints as deployed, migration status, or live D1 state.

## 21. Feature Flag List and Current Defaults

**Backend registry (`server/features/study-core/featureFlags.ts`):** every listed flag defaults false in source; values are true only for accepted strings `1`, `true`, `yes`, or `on`. Missing/malformed values are false.

- `STUDY_EVENTS_ENABLED`
- `FOCUS_HUB_ENABLED`
- `FOCUS_RESOURCE_HANDOFF_ENABLED`
- `GROUP_FOCUS_ENABLED`
- `STUDY_POINTS_ENABLED`
- `STUDY_INTEGRITY_ENABLED`
- `GAMIFICATION_ENABLED`
- `SPACED_RECALL_ENABLED`
- `RECALL_POINTS_ENABLED`
- `MASTERY_ENABLED`
- `STUDY_ANALYZER_ENABLED`
- `AI_STUDY_INSIGHTS_ENABLED`
- `AI_STUDY_INSIGHTS_CACHE_ENABLED`
- `ASK_MY_STUDY_DATA_ENABLED`
- `ASK_MY_STUDY_DATA_AI_ENABLED`
- `OWNER_STUDY_ANALYTICS_ENABLED`
- `LEADERBOARD_D1_PROJECTION_ENABLED`
- `LEADERBOARD_D1_READ_ENABLED`

**Other server-side gates:** `PRIVATE_D1_FOCUS_PLAN_READS_ENABLED`, `PRIVATE_D1_FOCUS_SESSION_READS_ENABLED`, and `PRIVATE_D1_STUDY_DAILY_METRIC_READS_ENABLED` require their flag plus configured private Worker URL and secret. They are not entries in the general study-feature registry. `FOCUS_RESOURCE_HANDOFF_ENABLED`, `STUDY_POINTS_ENABLED`, `STUDY_INTEGRITY_ENABLED`, and `GAMIFICATION_ENABLED` are present as registry defaults but were not found to gate the corresponding general runtime routes/award engine; `RECALL_POINTS_ENABLED` is an actual Recall-award gate. Group Focus, Focus Hub, and Study Events are checked in their relevant service paths.

**Frontend (`src/config/featureFlags.ts`):**

- `VITE_FOCUS_HUB_V2_ENABLED`: development default on unless `"false"`; production requires `"true"`.
- `VITE_FOCUS_AUDIO_ENABLED`: on unless explicitly `"false"`.
- `VITE_GROUP_FOCUS_FRONTEND_ENABLED`, `VITE_GAMIFICATION_FRONTEND_ENABLED`, and `VITE_SPACED_RECALL_FRONTEND_ENABLED`: off unless explicitly `"true"`.
- `VITE_GROUP_FOCUS_WORKER_URL`: empty unless set; Group Focus realtime requires a usable Worker URL.

No actual environment values were read. Source defaults are not statements about the current deployment.

## 22. Items That Are Fully Working

“Working” here means the feature has connected source paths across UI/API/service/data or an explicit backend integration; runtime was not exercised.

- Focus Hub planner and active session have connected frontend components, authenticated APIs, server service transitions, PostgreSQL persistence, and lifecycle reconciliation.
- Focus timer and break state are persisted/server-validated rather than awarded from a browser-only timer.
- Focus history, session summary, post-action context, and daily metrics have API/service implementations.
- Focus transitions write canonical Study Events and enqueue private projections transactionally.
- Focus mutation invalidation is wired through Socket.IO and consumed in the app.
- Focus Audio playback, lifecycle, preferences, and local-file handling are implemented; chosen file content is local/session-only.
- Group Focus has REST room/member/capability APIs, Worker/Durable Object realtime, signed server reconciliation, canonical summary storage, and downstream verified-source consumers.
- New Study Points ledger has server-derived rules, deduplication, caps/locks, reversals at service level, projection maintenance, and reconciliation/repair support.
- Gamification summary/achievement/challenge APIs and opt-in Profile UI are connected.
- Weekly/monthly/all-time leaderboard query and PostgreSQL snapshot paths exist; D1 cache has a PostgreSQL fallback.
- Private profile-safe gamification and authenticated/admin boundaries are source-wired.

## 23. Items That Are Partially Working

- **One unified balance:** new ledger awards coexist with legacy `PointsLog`; source-default `LEGACY_ONLY` lifetime/level/all-time and ledger-based weekly/monthly views can disagree.
- **Gamification rollout:** frontend is opt-in, but server gamification APIs are not gated by `GAMIFICATION_ENABLED`; UI visibility and backend availability differ.
- **General Study Points rollout:** `STUDY_POINTS_ENABLED` appears in health/registry but does not gate observed award execution. Focus or Group Focus completion may still call the awarder when its own feature path is enabled.
- **Semester leaderboard:** scope exists in API/UI vocabulary, but no server-defined semester boundaries are configured.
- **Focus D1 projections:** plan/metric reads are wired but can serve structurally valid lagging data; Focus session D1 reads are unused.
- **Already-open Gamification view:** post-commit backend refreshes do not push updated data to the mounted UI; manual refresh/re-entry is required.
- **Ruleset lifecycle:** versioned definitions and activation utilities exist, but active ruleset state is database-dependent and unverified; no automatic activation was found.
- **Reversal access:** reversal service is implemented, but no ordinary API/UI path exposes it.
- **Group Focus availability:** full backend/realtime source exists, but both server/frontend gates and Worker configuration determine whether users can access it.

## 24. Items That Are Not Connected / Not Exposed

- Focus-session D1 read projections have no Focus service consumer.
- No current Focus Quick Notes UI, endpoint, or model is connected; it was removed.
- MCQ-set and flashcard point-award rules are explicitly unsupported.
- No ordinary client endpoint/UI for Study Points ledger history or reversal was found.
- `GAMIFICATION_ENABLED` is not connected to server route registration or the observed gamification read paths.
- `STUDY_POINTS_ENABLED` is not connected to the observed award engine call paths as an execution gate.
- `FOCUS_RESOURCE_HANDOFF_ENABLED` is not connected to the handoff service/route path as a gate.
- Gamification frontend has no observed realtime listener for Focus completion or Study Points changes.
- There is no configured semester-window source in `server/features/leaderboard/periods.ts`.
- No direct client database integration for these systems was found.

## 25. Items That Should Be Reviewed or Changed

These are review targets, not fixes made in this audit:

1. Decide whether `STUDY_POINTS_ENABLED`, `GAMIFICATION_ENABLED`, and `FOCUS_RESOURCE_HANDOFF_ENABLED` should be enforced gates. Their names/defaults currently imply rollout controls that the corresponding source paths do not consistently honor.
2. Choose and document the intended points cutover/read mode. Align lifetime totals, level thresholds, achievements, and all-time leaderboard with the same canonical balance or make legacy-vs-ledger semantics explicit in UI.
3. Configure semester boundaries or remove/disable the semester option until the server can resolve a season.
4. Verify the active GamificationRuleSet rows/checksums through the approved database workflow before enabling achievement/challenge reads in a deployment.
5. Either wire the Focus-session D1 reader into a justified read path or remove/retire it; do not assume projection existence means it reduces PostgreSQL load.
6. Consider watermark/revision freshness checks for Focus plan and daily-metric reads so a nonempty stale projection cannot silently omit newer canonical rows.
7. Decide how a mounted Gamification view should learn about committed Focus/Recall awards—explicit invalidation/refetch, a short bounded refresh, or current manual refresh—while avoiding unnecessary polling.
8. Ensure admin-only repair/reversal operational procedures are explicit. The ledger reversal method has no observed HTTP surface, while reconciliation has admin routes.
9. Keep award source validation and idempotency tests aligned with Focus post-commit recovery, group-summary retries, Recall answer replays, and category/day/week cap races.
10. Before rollout, verify migrations and Worker schemas against the intended environment, check D1 outbox backlog/fallback metrics, and exercise the authenticated UI on desktop, iPad, and phone. Those checks are outside this repository-only report.

