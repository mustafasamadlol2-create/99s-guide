# Cloudflare canonical reconciliation

This is a one-time production maintenance tool for 99's Guide.

## What it does

- PostgreSQL/Supabase remains the canonical source.
- Deletes only D1 rows whose canonical record no longer exists.
- Clears disposable leaderboard D1 cache tables so they rebuild from PostgreSQL.
- Keeps every R2 object that is referenced by a current canonical:
  - Material
  - ModuleResource
  - active ResourceMultipartUpload
  - current managed user avatar
- Deletes only orphan R2 objects that are not referenced by the canonical database.
- Aborts orphan multipart uploads.
- Does not mutate PostgreSQL/Supabase.
- Refuses destructive mode while private/leaderboard D1 outboxes are active.

## Required environment variables

- DATABASE_URL
- CLOUDFLARE_ACCOUNT_ID
- CLOUDFLARE_API_TOKEN
- CLOUDFLARE_D1_DATABASE_ID (optional if database_id exists in Worker wrangler config)

For R2 cleanup, the existing app variables are also used:

- R2_ENDPOINT
- R2_ACCESS_KEY_ID
- R2_SECRET_ACCESS_KEY
- R2_BUCKET_NAME
- R2_REGION

## Step 1 — dry run (safe)

```bash
node scripts/reconcile-cloudflare-from-postgres.mjs
```

Review the JSON report. Nothing is deleted.

## Step 2 — apply

Only after the dry-run report looks correct:

```bash
CLOUDFLARE_RECONCILE_CONFIRM=RECONCILE_CLOUDFLARE_FROM_POSTGRES node scripts/reconcile-cloudflare-from-postgres.mjs --apply
```

On Windows PowerShell:

```powershell
$env:CLOUDFLARE_RECONCILE_CONFIRM="RECONCILE_CLOUDFLARE_FROM_POSTGRES"
node scripts/reconcile-cloudflare-from-postgres.mjs --apply
```

Afterward, deploy/restart Render normally so existing outbox/realtime systems continue from the clean canonical state.
