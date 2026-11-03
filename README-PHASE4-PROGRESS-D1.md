# Phase 4/10 — Progress D1 Read Cutover

Supabase/PostgreSQL remains canonical for progress writes. Cloudflare Private D1 becomes the student-facing read replica for:

- `LectureProgress`
- `FlashcardProgress`
- `UserProgress` (material/PDF progress)
- `VideoWatchProgress`

## Safe rollout

1. Keep `PRIVATE_D1_PHASE4_PROGRESS_CUTOVER_ENABLED=false`.
2. Run `npm run migrate:deploy` to install transaction-safe progress outbox triggers in Supabase.
3. Run `npm run d1:private:migrate`.
4. Run `npm run deploy:private-worker`.
5. Redeploy Render with the existing private D1 mirror enabled.
6. From the local project machine run `npm run progress:d1:backfill`.
7. Only after every verification row is `OK`, set `PRIVATE_D1_PHASE4_PROGRESS_CUTOVER_ENABLED=true` in Render and redeploy.
8. Test lecture completion status, PDFs/notes progress, flashcard review state, video watch progress, Profile progress, refresh/logout/login.

During strict Phase 4 cutover, user-facing progress GET routes do **not** silently fall back to PostgreSQL if Private D1 is unavailable. This prevents Supabase egress from returning unexpectedly.
