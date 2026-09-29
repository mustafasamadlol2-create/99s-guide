# Study Engine Maintenance Runbook

This CLI provides scoped, resumable maintenance for canonical Study Engine projections. It defaults to dry-run and writes machine-readable JSON to stdout. It does not replace product services or establish a second source of business rules.

## Safety rules

- Start with the `readiness preflight` and an audit for the domain you intend to change.
- All rebuild commands are dry-run unless `--apply` is present.
- Use `--user-id`, `--lecture-id`, `--season-id`, or `--snapshot-id` to scope work. Use `--all` only when a global scan is intended.
- Pass a fixed `--as-of` timestamp for retention rebuilds and time-sensitive reconciliations.
- Use `--limit` and `--batch-size` to bound work. Batch size is limited to 1–500.
- Optional `--sleep-ms` (0–60,000) adds a pause between processed items. Optional
  `--max-rps` (0–1,000) caps item throughput; both default to disabled.
- A job stops at the first item error by default. `--max-errors` is an explicit override.
- Reports contain aggregate counts and safe error codes, not row payloads.
- Outbox compaction is dry-run by default and requires both `--apply` and an explicit `--older-than-days` or `--before` cutoff. It deletes only retained terminal outbox rows, never canonical study evidence.
- Production apply is disabled while checkpoints are local files. The parser also requires an explicit production environment and confirmation token, but those do not override the local-checkpoint restriction.
- Do not run any maintenance command against production as part of Prompt 49.

## Common commands

```sh
npm run study:readiness -- --environment=development
npm run study-maintenance -- points audit --user-id USER_ID --environment=development
npm run study-maintenance -- points rebuild --all --limit 100 --environment=development
npm run study-maintenance -- points rebuild --user-id USER_ID --apply --environment=development
npm run study-maintenance -- mastery audit --user-id USER_ID --lecture-id LECTURE_ID
npm run study-maintenance -- retention rebuild --user-id USER_ID --as-of 2026-09-29T12:00:00Z
npm run study-maintenance -- orphans audit --environment=development
npm run study-maintenance -- compatibility audit --environment=development
```

Use `--report-file reports/study-maintenance/<name>.json` to save the report. Checkpoints are stored locally under `reports/study-maintenance/checkpoints` by default. Do not delete a lock file from a live process; a leftover lock after a crash needs operator review before removal.

## Scope and recovery

`--resume-job <id>` resumes the exact paused job. The stored job type, version, mode, environment, and canonical scope must match. Completed jobs cannot be resumed. `--after-id` is for an intentional new keyset run and cannot be combined with `--resume-job`.

SIGINT and SIGTERM stop after the current item and save the last fully processed cursor. Checkpoints include cumulative scanned, changed, would-change, unchanged, skipped, error, and status counts. A report status of `PAUSED` means the job needs a deliberate resume; `COMPLETED` means discovery reached the end. Local active-job locks are deterministic hashes of job type, job version, and canonical target scope, so different job IDs cannot overlap the same scope while unrelated scopes can run in parallel. Checkpoint files remain keyed by job ID.

## Supported domain operations

- **Points and Levels**: audit or rebuild the canonical projection through their existing reconciliation services.
- **Achievements**: audit canonical metric-derived progress or rebuild only `UserAchievementProgress`. Both commands require an explicit fixed `--as-of`; missing permanent unlocks are flagged for review and never backfilled by maintenance.
- **Challenges**: audit progress or rebuild only the current-window progress for a scoped user.
- **Mastery and Retention**: keyset-scan canonical user/lecture candidates and use the existing deterministic reconciliation services.
- **Private D1**: audit or re-enqueue the existing canonical Mastery/Retention projections for D1. This reads the Worker, so pass `--allow-cloudflare`; apply also requires `--allow-external-writes`. Apply writes the PostgreSQL outbox, not D1 directly.
- **Leaderboard snapshots**: audit or reconcile one season, optionally restricted to one snapshot. Reconciliation can create a replacement revision, so use a dry-run first and pass `--apply` only after reviewing it.
- **Leaderboard D1 cache**: audit one snapshot with `--allow-cloudflare`. Rebuilding queues a projection in PostgreSQL; apply requires `--allow-external-writes`.
- **Focus and Group Focus**: bounded, read-only invariant samples. These commands require `--all` to make the global scope explicit; use `--limit` to bound the sample.
- **Ruleset audit**: validates the single active Gamification ruleset against the source bundle and stored checksums.
- **Orphan audit**: checks PostgreSQL projection/user and outbox-target relationships without deleting rows. D1 projection orphans are explicitly reported as unsupported because this command has no safe local D1 read path.
- **Compatibility audit**: compares persisted PostgreSQL rule and projection versions with source-controlled definitions. D1-observed and AI prompt/cache versions without a safe inventory path are reported as unsupported, not assumed compatible.
- **Readiness preflight**: checks database connectivity, required tables and indexes, migration state, active ruleset, rule versions, local Wrangler config-file presence, selected feature-flag presence, outbox backlog, and a read-only Points/Level sample. It does not verify live Cloudflare credentials or remote binding values.
- **Outbox status**: reports pending, delayed, leased, blocked, poison, and succeeded counts without exposing payloads.
- **Outbox delivery lifecycle**: both D1 queues make at most 8 delivery attempts per entry. Network/timeouts, HTTP 429, temporary Worker/D1 unavailability, and retryable 5xx responses use exponential backoff with equal jitter (15-second base, five-minute cap). Malformed or structurally invalid payloads, incompatible schema/projection versions, deterministic validation/conflict failures, impossible targets, and exhausted transient retries become `POISON`. Authentication or configuration failures become `BLOCKED` and are not automatically retried. Delivery happens after the canonical PostgreSQL transaction, so a Worker failure does not roll back canonical study writes.
- **Outbox replay**: dry-run inspects delayed or `BLOCKED` entries. After correcting configuration, apply can reschedule an entry only while fewer than 8 attempts have been used and its lease is inactive. Apply requires both `--allow-cloudflare` and `--allow-external-writes` because making queued work eligible can trigger Worker delivery. Poison and successful entries are not replayed.
- **Outbox compaction**: `outbox compact --older-than-days 30` inspects eligible terminal rows; add `--apply` to delete them. Successful rows are retained at least 30 days and poison rows at least 90 days. A requested older cutoff can extend, but never shorten, those retention periods. `BLOCKED`, pending, retryable, or leased rows are never deleted based on age.

## Deliberately unavailable operations

- **Production apply** is unavailable until job state and locking use a durable shared store. Local checkpoint files are not sufficient for multi-process or multi-host production resumability.

## Exit behavior

Argument and safety violations exit nonzero before work begins. A maintenance report with item errors exits nonzero. Readiness failures and audit warnings also exit nonzero so they can be used in local automation. A skipped item is reported separately from an error and is not treated as a repair.