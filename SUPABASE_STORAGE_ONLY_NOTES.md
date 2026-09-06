# Supabase Storage-only patch

This patch intentionally adds only private Supabase Storage support for PDF/NOTE materials.
It does not include the broader hardening/refactor work from other branches.

## What changed

- New PDF/NOTE uploads are limited to 50 MB.
- New PDF/NOTE binaries are uploaded to the private `academic-materials` bucket.
- PostgreSQL stores material metadata plus `storagePath`; new binaries are not stored in `fileData`.
- Existing/legacy materials that already have `fileData` continue to open exactly through the old database-backed path.
- `/api/materials/pdf/:id` keeps the same client-facing URL. After authentication, Storage-backed files are redirected to a 5-minute Supabase signed URL.
- Replacing/deleting a Storage-backed material deletes the old Storage object best-effort.
- Deleting a lecture cleans up its Storage-backed material objects.
- The frontend rejects PDF files over 50 MB before upload and gives uploads a longer request timeout.

## Required Render environment variables

These must exist on the BACKEND Render service only:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET=academic-materials`

Never expose `SUPABASE_SERVICE_ROLE_KEY` through `VITE_*` variables or frontend hosting.

## Required database migration

Deploy the migration before using new Storage uploads:

```bash
npx prisma migrate deploy
```

Migration added:

`prisma/migrations/20260824_add_material_storage_path/migration.sql`

It adds nullable `Material.storagePath`, so all existing rows remain compatible.

## Safe first test

1. Deploy backend + run Prisma migration.
2. Upload a small PDF/NOTE (for example 1-5 MB).
3. Confirm a new object appears under `academic-materials/materials/...`.
4. Open it from the app in PWA and Capacitor.
5. Replace it once and confirm only the current object remains.
6. Test a file slightly above 50 MB; the app should reject it rather than sending it.

Existing database PDFs are intentionally NOT migrated or deleted automatically in this patch.
