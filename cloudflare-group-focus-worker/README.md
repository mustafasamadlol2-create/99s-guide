# 99's Guide — Group Focus Worker

This Worker/Durable Object is the realtime runtime for Group Focus. PostgreSQL on the API remains canonical for rooms, memberships, completed summaries, Study Events, and eligible Study Points.

## Required configuration

Generate the two independent 32-byte signing keyrings locally:

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
GROUP_FOCUS_RECONCILIATION_KEYS_JSON=<generated reconciliation keyring>
GROUP_FOCUS_RECONCILIATION_ACTIVE_KID=gf-rec-v1
```

The capability keyring and reconciliation keyring are different secrets.

### Cloudflare Group Focus Worker

Set the same capability keyring and reconciliation keyring as Worker secrets/variables, plus the canonical API origin:

```text
GROUP_FOCUS_CAPABILITY_KEYS_JSON=<same capability keyring as Render>
GROUP_FOCUS_RECONCILIATION_KEYS_JSON=<same reconciliation keyring as Render>
GROUP_FOCUS_RECONCILIATION_ACTIVE_KID=gf-rec-v1
GROUP_FOCUS_API_BASE_URL=https://<your-render-api-origin>
```

`GROUP_FOCUS_API_BASE_URL` must be only the API origin (no path, query, credentials, or fragment).

Deploy with the repository config:

```bash
npx wrangler deploy --config cloudflare-group-focus-worker/wrangler.jsonc
```

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
```

Use only the Worker origin for `VITE_GROUP_FOCUS_WORKER_URL`; do not append `/rooms/...`.

## Runtime safety contract

- The browser never supplies authoritative user identity to the Durable Object.
- The API issues short-lived signed room capabilities.
- Host/member authorization changes are reconciled against PostgreSQL.
- A member who has left or was removed cannot resurrect a disconnected runtime participant with an old capability.
- Canonical reconciliation requests from the realtime client are Host-only.
- Terminal summaries are signed by the Worker and persisted idempotently by the API.
- Study Points are awarded only by the canonical backend from verified terminal evidence.
