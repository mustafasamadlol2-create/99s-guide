# Phase 1/10 — Academic Content Cutover

Goal: Supabase PostgreSQL remains canonical for academic-content writes, while student reads are served from Cloudflare D1. R2 continues to serve file bytes. This phase does **not** move authentication/profile reads yet; those are handled in a later phase.

## Covered reads

- Lectures and lecture detail
- `/api/materials` relational content
- Module Resource lists and R2 metadata lookup
- Global Calendar events
- Today's Message / active mottos
- Global search
- Legacy `/api/content` compatibility reads
- Flashcard content list used by the academic catalog

## Deployment order

1. Make sure `CONTENT_WORKER_BASE_URL` and `CONTENT_SYNC_SECRET` are configured on Render. The same secret must be configured on the Cloudflare content worker.
2. Apply the D1 migration:

   `npm run d1:content:migrate`

3. Deploy the content worker:

   `npm run deploy:content-worker`

4. Redeploy the Render backend with this patch while leaving `CONTENT_D1_PHASE1_CUTOVER_ENABLED=false`.
5. Run the one-time canonical backfill from an environment that has the production Supabase database variables and the content-worker variables (Render Shell is suitable):

   `npm run content:d1:backfill`

   The command upserts canonical Supabase rows, removes stale D1 rows, and verifies per-table row counts.
6. Optional verification-only rerun:

   `npm run content:d1:verify`

7. Only after verification passes, set on Render:

   `CONTENT_D1_PHASE1_CUTOVER_ENABLED=true`

   Then redeploy Render.

## Cutover behavior

With `CONTENT_D1_PHASE1_CUTOVER_ENABLED=true`, covered academic GET routes do not fall back to Supabase. If D1 is unavailable, they return a controlled `CONTENT_D1_UNAVAILABLE` response instead of silently recreating Supabase egress.

Supabase remains the canonical write store. Successful mutations are mirrored to D1; failed mirror attempts are durably queued in the existing `SystemSetting` outbox and retried.
