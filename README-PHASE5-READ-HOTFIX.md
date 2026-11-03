# Phase 5/10 — Focus D1 read reliability hotfix (not Phase 6)

## Why the toast appeared

The original Focus Plan / Session D1 read path had a **600 ms timeout**, which was designed for fallback-mode experiments. Phase 5 enabled strict, fail-closed reads, but kept that timeout and converted any timeout / HTTP / malformed response to the same public 503 message. Worker cold starts or transient latency can trigger the toast while other app screens continue to work.

## Changes

- Increase the Focus projection read timeout from 600 ms to 4,000 ms.
- Retry exactly once **only** for read-only transient transport/HTTP 408, 425, 429, 5xx failures. No retry on 401/403/404, malformed rows or scope mismatch.
- Emit sanitized structured Render logs with `failureCode` (`TIMEOUT`, `HTTP_401`, `HTTP_500`, `MALFORMED` etc.). No user identifiers, Worker secrets or row contents.
- Add `npm run study-engine:d1:diagnose`: checks Worker health, D1 read endpoints, canonical/D1 per-user counts and repeated current-session requests. Never modifies data.
- Keep Supabase canonical for writes. **No silent PostgreSQL read fallback** when the strict Phase 5 flag is true.

## Deployment

1. Replace files from the ZIP at the same paths, on your **Phase 5 successful repository**, not a Phase 6 patch. Leave Phase 6 off.
2. No Prisma migration, D1 migration, worker redeploy or backfill is required **just for this hotfix** (no schema or Worker changes).
3. Build/redeploy the **Render backend**. Ensure `PRIVATE_DATA_WORKER_BASE_URL` and `PRIVATE_DATA_SYNC_SECRET` match the deployed Worker and `PRIVATE_D1_PHASE5_STUDY_ENGINE_CUTOVER_ENABLED=true` only if your original Phase 5 backfill/verification passed.
4. Run `npm run study-engine:d1:diagnose` locally with your .env configured. Avoid posting secrets or user IDs.
5. Test dashboard/settings, Focus Plans, current session, Focus metrics and MCQ/Flashcard activity; refresh several times.

## If error persists

Find the structured Render log with category `[Phase5StudyEngine]` and send **only the `failureCode`** (never environment secrets). `HTTP_401`/`HTTP_403` suggests mismatched secret; `HTTP_404` may mean the wrong worker deployment; `HTTP_500` means Worker/D1 exception or schema/binding; `TIMEOUT` points to latency or connectivity; `MALFORMED` means a projection shape issue. The diagnosis command will distinguish count/scope mismatches from network failures. If production user experience is affected, you may explicitly turn Phase 5 cutover `false` for a temporary rollback and redeploy; that is **a conscious rollback**, not a silent fallback or a fix.

This patch has been code-reviewed locally but not tested against your live Worker/Render/Supabase, since those credentials and service logs are not present here. Do not declare Phase 5 finally healthy until post-deploy checks pass.
