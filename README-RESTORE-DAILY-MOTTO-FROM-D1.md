# Restore DailyMotto from Cloudflare D1 to Supabase/PostgreSQL

This is a one-time recovery tool for the `DailyMotto` table only.

It follows the same recovery approach used for the User table:

- Cloudflare D1 is read-only during this operation.
- Nothing is deleted or changed in Cloudflare.
- Only Supabase/PostgreSQL `DailyMotto` is written.
- No other table is touched.
- Matching IDs are updated from D1.
- Missing IDs are created using the original D1 ID.
- Any rows that exist only in Supabase are left untouched.
- A JSON backup of the current Supabase `DailyMotto` table is created before apply.

Fields restored:

- `id`
- `message`
- `isActive`
- `isFeatured`
- `createdBy`
- `createdAt`
- `updatedAt`

## Required environment variables

Use the same values already used successfully for the User recovery:

```cmd
set "DATABASE_URL=YOUR_DATABASE_URL"
set "CLOUDFLARE_ACCOUNT_ID=YOUR_ACCOUNT_ID"
set "CLOUDFLARE_API_TOKEN=YOUR_API_TOKEN"
set "CLOUDFLARE_D1_DATABASE_ID=YOUR_D1_DATABASE_ID"
```

## Dry run

```cmd
node scripts\restore-daily-motto-from-cloudflare-d1.mjs
```

This changes nothing.

## Apply

Only after checking the dry-run report:

```cmd
set "CLOUDFLARE_DAILY_MOTTO_RESTORE_CONFIRM=RESTORE_DAILY_MOTTO_FROM_D1"
node scripts\restore-daily-motto-from-cloudflare-d1.mjs --apply
```
