# Clean six D1 tables — final behavior with progress reset

This version matches the clarified requirement.

## Content tables
- `Lecture`
- `Material`
- `Mcq`
- `Flashcard`

Rule:
- Exists in Supabase/PostgreSQL + D1 -> keep in D1.
- Exists only in D1 -> delete from D1.
- Supabase/PostgreSQL is never modified.

## Progress tables
- `FlashcardProgress`
- `LectureProgress`

Rule:
- Delete **all rows from Cloudflare D1** so Cloudflare progress becomes zero.
- Do **not** copy current Supabase progress back into D1.
- Do **not** modify Supabase/PostgreSQL progress.

So after apply:
- Cloudflare `FlashcardProgress` = 0 rows
- Cloudflare `LectureProgress` = 0 rows

## Dry run

```cmd
node scripts\clean-six-d1-tables-against-postgres.mjs
```

## Apply

The Cloudflare API token must have D1 write/edit permission.

```cmd
set "CLOUDFLARE_D1_CLEAN_CONFIRM=DELETE_D1_ROWS_NOT_IN_POSTGRES"
node scripts\clean-six-d1-tables-against-postgres.mjs --apply
```

The script creates a local JSON backup of D1 rows scheduled for deletion before applying changes.
