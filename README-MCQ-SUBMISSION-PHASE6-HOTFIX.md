# MCQ Submission — Phase 5/6 Hotfix

This patch targets one confirmed weakness in the MCQ submission flow:
- The frontend had a default **15-second** timeout for `POST /api/mcqs/submit`.
- The backend awarded all correct MCQs in **one** Prisma interactive transaction with a **15-second** timeout, in addition to grading and progress writes.

It does **not** assert that this is the only cause of your failure. If submission fails after deployment, the UI displays a safe diagnostic token like `mcq_points/P2028`, and Render prints `[MCQ Submit Error] stage=... code=... type=...`, so we can identify the actual source.

## Contents
- `src/features/lectures/components/LectureDetailView.tsx`: MCQ-specific 90-second timeout; prevent double-click; visibly show submission in progress; display safe error code/stage, preserve chosen answers on failure.
- `server/features/study-points/awardEngine.ts`: chunk verified MCQ/flashcard points into groups of six under the *existing* 15s transaction policy, without changing scoring, daily caps, or ledger idempotency; fire post-commit update once even if a later chunk fails.
- `server.ts`: stage/code-only diagnostics for MCQ submission and 503 for transient Prisma connectivity errors. Nothing sensitive logged.

## Install
1. Back up or commit your working Phase 6 source first.
2. Unzip and copy the three files to matching paths in your existing repo (not as a fresh project). This is based on the Phase 5/6 source archive available in this chat; if you have modified these files locally, compare changes instead of blindly overwriting.
3. Run `npm run build` locally and deploy your backend/frontend together via your normal pipeline.
4. Keep `PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED=false`. Do not re-run migrations or D1 backfill for this patch.
5. Test with 1 question then a longer set. Check Render Logs for `[MCQ Submit Error]` if a failure persists and copy only `stage`, `code`, `type` (no credentials).

## Safety notes
- Supabase remains the source of truth for grading, progress, and points; D1 sync is downstream only.
- This patch does not disable earning points or grant a silent fallback.
- If a later points batch fails, already committed ledger entries remain canonical; idempotency prevents double awards when users retry after connectivity has been restored. Repeated quiz submissions may still generate separate analytics attempts; avoid clicking repeatedly.
- Network/storage reliability cannot be tested from this environment; final end-to-end verification must be performed against your Render + Supabase deployment.
