# Phase 2/10 — Files & Cloudflare R2 cutover

Goal: keep Supabase as the canonical database while moving student file delivery to Cloudflare R2. Phase 2 never deletes legacy `Material.fileData` from Supabase; it only ensures every PDF/NOTE has an R2 object and then prevents runtime PDF delivery from reading PostgreSQL bytea.

## Before strict cutover

1. Phase 1 must already be complete and `CONTENT_D1_PHASE1_CUTOVER_ENABLED=true` in Render.
2. Local `.env` must contain the production values for:
   - `SUPABASE_DATABASE_URL` (or the database URL already used by the project)
   - `CONTENT_WORKER_BASE_URL`
   - `CONTENT_SYNC_SECRET`
   - `R2_ENDPOINT`
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - `R2_BUCKET_NAME`
3. Deploy the updated Content Worker:
   - `npm run deploy:content-worker`
4. Deploy the updated Render backend with `FILES_R2_PHASE2_CUTOVER_ENABLED` still unset/false.
5. From the local project root run:
   - `npm run files:r2:backfill`
6. The command must end with:
   - `All PDF/NOTE files are present in Cloudflare R2. Phase 2 is ready for strict cutover.`
7. Optional independent verification:
   - `npm run files:r2:verify`

## Enable strict cutover

Set in Render:

`FILES_R2_PHASE2_CUTOVER_ENABLED=true`

Then redeploy Render.

After this switch:
- PDF/NOTE metadata used for file opens is read from D1.
- PDF/NOTE bytes are delivered only from R2.
- PostgreSQL `Material.fileData` is never selected on the strict runtime PDF path.
- A missing R2 object does not silently fall back to Supabase/PostgreSQL bytes.
- Existing legacy `fileData` remains untouched in Supabase as a canonical/backup copy.

New PDF/NOTE uploads already go directly to R2 and their metadata is synchronized to D1.
