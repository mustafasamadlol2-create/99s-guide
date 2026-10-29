# 99's Guide — Group Focus Worker

This Worker/Durable Object is the realtime runtime for Group Focus. PostgreSQL on the API remains canonical for rooms, memberships, completed summaries, Study Events, and eligible Study Points.

## Required configuration

Generate the signing keyrings locally:

```bash
node scripts/generate-group-focus-runtime-secrets.mjs
```

Never commit the generated values.

### Render / API

Set:

```text
GROUP_FOCUS_ENABLED=true
GROUP_FOCUS_CAPABILITY_KEYS_JSON=<generated capability keyring>
GROUP_FOCUS_CAPABILITY_ACTIVE_KID=gf-cap-v1
```

The capability keyring is required. A dedicated reconciliation keyring is
recommended for key separation, but it is optional. If the two reconciliation
variables are omitted, the runtime uses the capability keyring for machine
requests with a separate `gf-reconcile-v1` signing domain.

Optional dedicated keys:

```text
GROUP_FOCUS_RECONCILIATION_KEYS_JSON=<generated reconciliation keyring>
GROUP_FOCUS_RECONCILIATION_ACTIVE_KID=gf-rec-v1
```

### Cloudflare Group Focus Worker

Set the same capability keyring as a Worker secret/variable. If Render uses a
dedicated reconciliation keyring, set that same reconciliation keyring here as
well:

```text
GROUP_FOCUS_CAPABILITY_KEYS_JSON=<same capability keyring as Render>
GROUP_FOCUS_CAPABILITY_ACTIVE_KID=gf-cap-v1
# Optional when Render also omits these:
GROUP_FOCUS_RECONCILIATION_KEYS_JSON=<same reconciliation keyring as Render>
GROUP_FOCUS_RECONCILIATION_ACTIVE_KID=gf-rec-v1
# Optional for this production app; defaults to https://nine9s-guide.onrender.com
GROUP_FOCUS_API_BASE_URL=https://<your-render-api-origin>
```

`GROUP_FOCUS_API_BASE_URL` must be only the API origin (no path, query, credentials, or fragment).

Deploy with the repository config:

```bash
npm run deploy:group-focus
```

The root `npm run deploy` command now deploys this Group Focus Worker first and
then deploys the main application, so a normal production deploy cannot leave
the frontend pointing at an older or missing realtime Worker.

Then verify:

```text
GET https://<worker-origin>/health  -> 200 {"status":"ok"}
GET https://<worker-origin>/ready   -> 200 {"status":"ready","runtimeReady":true}
```

`/health` only proves the Worker is running. `/ready` proves that the Worker has the runtime configuration required to open realtime rooms. WebSocket room connections fail closed with `WORKER_RUNTIME_NOT_READY` when `/ready` is not healthy.

### Frontend build

After the Worker `/ready` endpoint returns 200, build the frontend with:

```text
VITE_GROUP_FOCUS_FRONTEND_ENABLED=true
VITE_GROUP_FOCUS_WORKER_URL=https://<worker-origin>
GROUP_FOCUS_WORKER_URL=https://<worker-origin>
```

Use only the Worker origin for either Worker URL variable; do not append `/rooms/...`.
The API now returns its canonical Worker origin with every realtime capability,
so `GROUP_FOCUS_WORKER_URL` on the backend is authoritative and the Vite value
is only a browser-side fallback.

## Runtime safety contract

- The browser never supplies authoritative user identity to the Durable Object.
- The API issues short-lived signed room capabilities.
- Host/member authorization changes are reconciled against PostgreSQL.
- A member who has left or was removed cannot resurrect a disconnected runtime participant with an old capability.
- Canonical reconciliation requests from the realtime client are Host-only.
- Terminal summaries are signed by the Worker and persisted idempotently by the API.
- Study Points are awarded only by the canonical backend from verified terminal evidence.
