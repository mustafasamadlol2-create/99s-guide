# Restore User table from Cloudflare D1 to Supabase/PostgreSQL

This tool restores **only users**.

It does **not** delete anything from Cloudflare and it does **not** touch any
other D1/Supabase table.

## Behavior

- Reads every row from Cloudflare D1 table `User`.
- Restores the supported User fields into Supabase/PostgreSQL.
- If the same D1 `id` already exists in Supabase, that user is updated.
- If the same email already exists with a different id (the normal post-reset
  case), the current Supabase id is kept and the old D1 profile is merged onto it.
  This avoids cascading deletion of fresh data created after the reset.
- Otherwise, the user is created using the original D1 id.
- Existing Supabase users not represented in D1 are left untouched.
- Passwords are not restored.
- Presence/socket/device-token state is not restored.
- `sessionVersion` is bumped so every restored account must obtain a fresh OAuth
  session.
- Before `--apply`, the existing Supabase User table is backed up locally as JSON.

## CMD — set variables

```cmd
set "DATABASE_URL=YOUR_SUPABASE_POSTGRES_DATABASE_URL"
set "CLOUDFLARE_ACCOUNT_ID=YOUR_CLOUDFLARE_ACCOUNT_ID"
set "CLOUDFLARE_API_TOKEN=YOUR_CLOUDFLARE_API_TOKEN"
set "CLOUDFLARE_D1_DATABASE_ID=YOUR_D1_DATABASE_ID"
```

Check that CMD sees them:

```cmd
if defined DATABASE_URL (echo DATABASE_URL OK) else (echo DATABASE_URL MISSING)
if defined CLOUDFLARE_ACCOUNT_ID (echo ACCOUNT_ID OK) else (echo ACCOUNT_ID MISSING)
if defined CLOUDFLARE_API_TOKEN (echo API_TOKEN OK) else (echo API_TOKEN MISSING)
if defined CLOUDFLARE_D1_DATABASE_ID (echo D1_DATABASE_ID OK) else (echo D1_DATABASE_ID MISSING)
```

## Step 1 — dry run

```cmd
node scripts\restore-users-from-cloudflare-d1.mjs
```

Nothing is modified in dry-run mode.

For the situation described (about 100+ D1 users and 1 current Supabase user),
a normal report should look roughly like:

```text
d1Users: 100+
currentSupabaseUsers: 1
createWithD1Id: ~99+
mergeByEmailKeepCurrentId: 1
```

## Step 2 — apply

Only after the dry-run numbers look correct:

```cmd
set "CLOUDFLARE_USER_RESTORE_CONFIRM=RESTORE_USERS_FROM_D1"
node scripts\restore-users-from-cloudflare-d1.mjs --apply
```

The script is idempotent: if interrupted, running it again continues by
updating/creating the same users rather than intentionally duplicating them.

## Important OAuth note

This script restores the `User` table only, exactly as requested.

Google login can match the restored user by email.

Apple Sign In also benefits from the restored User row, but if the separate
`OAuthIdentity` table was erased too, an Apple returning user whose provider no
longer supplies an email may still need the old Apple `providerSubject` mapping
restored separately. This tool intentionally does not touch `OAuthIdentity`.



## v3 owner handling

`isPrimaryOwner` is intentionally skipped completely.

- Existing Supabase users keep their current `isPrimaryOwner` value.
- Newly restored users use the database/schema default for `isPrimaryOwner`
  (normally `false`).
- D1 owner flags are not copied.
- No restore/apply decision depends on owner data.

This keeps the recovery focused only on restoring the User records and avoids
changing the application's owner setup.
