# Study Engine observability runbook

## Safety and privacy

- Health and release reports contain aggregate operational counts only. They do not include student, session, room, lecture, or request identifiers; private study content; raw error payloads; tokens; or secret values.
- Request metrics use a fixed route-family allowlist and a 15-minute in-memory window. Counters reset when the server process restarts.
- Structured logs remove request identity and network address fields and redact common secret and personal-data patterns. Do not add request bodies, user objects, or raw exception messages to operational logs.
- `/api/health` is a liveness response. `/api/ready` runs a lightweight database readiness query and returns only `ready` or `not_ready`.
- `/api/admin/study-health` requires the existing owner policy. The dashboard is hidden unless its development frontend flag is enabled.
- The health snapshot is cached for 30 seconds. If the refresh fails, health is shown as `UNKNOWN`/`STALE`, never as healthy based on old data.
- Durable Object and D1 reachability are not inferred from PostgreSQL outbox state. They remain explicitly unknown unless directly observed.
- Client error reporting accepts only two fixed error codes, is rate-limited, is disabled by default on the server, and never accepts messages, stacks, or component data.

## Enable the local owner dashboard

For a local development session only:

1. Set `VITE_SYSTEM_HEALTH_FRONTEND_ENABLED=true` for the frontend build.
2. Set `SYSTEM_HEALTH_FRONTEND_ENABLED=true` only if aggregate client-error counters are wanted. This does not enable transmission of error text or stacks.
3. Restart the local development workflow.

The frontend flag is development-only. The dashboard is not exposed in production builds by this flag. Server-side client error aggregation remains off unless explicitly enabled.

## Read-only diagnostics

Run the incident snapshot without a database connection:

```sh
npm run study:diagnose -- --json
```

Without a database target, database health is `UNKNOWN`. To inspect local PostgreSQL, provide an explicit loopback-only URL through `STUDY_DIAGNOSTICS_LOCAL_DATABASE_URL`. Staging checks require `--target=staging` and `STUDY_DIAGNOSTICS_STAGING_DATABASE_URL`; the checker rejects loopback staging URLs and hostnames that identify themselves as production.

Save reports only under the ignored local report directory:

```sh
npm run study:diagnose -- --target=local --json --output=.local/observability-reports/incident-latest.json
```

The command is read-only. It does not query an ambient `DATABASE_URL` and does not display database hostnames or connection strings.

## Release checks

The fast check runs the frontend/server build, typecheck, lint, Study Engine tests, maintenance tests, observability tests, owner-analytics frontend tests, and Prisma schema validation. It does not connect to an ambient database:

```sh
npm run study:release-check -- --target=local
```

An intended rollout profile may be supplied as JSON. Only known Study Engine feature flags with boolean values are accepted:

```sh
npm run study:release-check -- --target=local --profile=study-release-profile.example.json --json
```

The example profile is a disabled-feature baseline, not a set of flags to apply. The check never changes runtime flags.

To include Worker typechecking and database checks:

```sh
npm run study:release-check -- --target=staging --deep --json
```

Database inspection requires an explicit `STUDY_RELEASE_LOCAL_DATABASE_URL` or `STUDY_RELEASE_STAGING_DATABASE_URL`. Local URLs must use loopback. Staging URLs must be non-loopback and must not contain a production-style hostname. The checker compares required schema objects and migration counts, inspects aggregate outbox state, and never runs migrations or maintenance actions.

The optional cohort-wide ledger and Study Points projection audit can scan the full local/staging ledger. It runs only when both `--deep` and `STUDY_RELEASE_ALLOW_COHORT_AUDIT=true` are supplied. This audit uses aggregate SQL and returns only whether aggregate invariant violations exist; it does not emit row-level identifiers. Without that explicit opt-in, those gates remain `WARN` rather than being reported as healthy.

Pending outbox work is checked against `STUDY_RELEASE_MAX_PENDING_OUTBOX`. Set a non-negative integer appropriate for the release. Blocked, poison, and high-attempt work fails the gate. The health panel is descriptive and provides no replay, rebuild, repair, backfill, or flag-edit controls.

Release reports may be saved under `.local/observability-reports/`, which is excluded from version control:

```sh
npm run study:release-check -- --target=local --json --report=.local/observability-reports/release-latest.json
```

Exit codes: `0` is ready, `2` is ready with warnings (for example, an unconfigured database check), and `1` is not ready or the requested checks failed. There is no production target, automatic deployment, or automatic fix mode.

## Interpreting signals

- `HEALTHY`: a direct safe check succeeded.
- `DEGRADED`: a direct check observed an issue, such as blocked projection work.
- `UNHEALTHY`: a required direct check failed.
- `UNKNOWN`: the dependency was not directly verified, the feature is disabled, or the signal is unavailable. `UNKNOWN` is not equivalent to healthy.
- Release `WARN` means a required check was not performed or a dependency could not be probed; investigate before relying on the release result.
- Recent operational errors show stable service, route-family, and error-code aggregates only. No individual request or student can be traced from the dashboard.
- The 15-minute request, outcome, and error counters are bounded in-memory per process. They reset on restart, are not shared across replicas, and are not historical SLO data.

This prompt intentionally does not add an external observability vendor, a D1/Worker probe, production checks, schema changes, migrations, data repair, backfills, or later Prompt 51/52 work.