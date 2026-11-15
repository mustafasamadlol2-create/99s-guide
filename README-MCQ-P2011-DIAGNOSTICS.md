# 99s Guide — MCQ quiz_progress/P2011 diagnosis (read-only)

Observed: MCQ submit -> `quiz_progress/P2011`. Prisma P2011 means a NOT NULL database constraint failed during the `LectureProgress.upsert()` stage. The current app message does not include the exact column/constraint. This is **not** a D1-read timeout or a points-award failure.

This patch changes ONLY:
- `server.ts`: log a sanitized column/constraint name from Prisma metadata on P2011, without dumping student data, answers, SQL or credentials.
- `scripts/diagnose-mcq-progress-p2011.ts`: read-only schema/trigger inspection. Does not write DB, D1, points, progress, or outbox.

## How to use
1. Extract this ZIP over your current project. Back up `server.ts` before replacing, and verify there have been no intervening local edits.
2. Locally, with your existing `.env` targeting the correct Supabase instance, run:

       npx tsx scripts/diagnose-mcq-progress-p2011.ts

   The tool will mark NOT NULL/default mismatches and list triggers. It is safe to run while the app is live.
3. Run `npm run build`, deploy the backend to Render, then attempt ONE MCQ submission with a test account.
4. In Render Logs search for `[MCQ Submit Error] stage=quiz_progress code=P2011 constraint=...`. Share **only** the `constraint` (and `model`) value and diagnostic script output. Do not paste environment variables, DATABASE_URL, SQL rows or full user data.

## Safe rollout
- Keep `PRIVATE_D1_PHASE6_GAMIFICATION_SYNC_ENABLED=true` if currently stable.
- Keep `PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED=false`.
- Do NOT rerun Phase 6 backfill or database migrations just for P2011.
- Do NOT loosen SQL constraints without identifying the exact column/table/trigger. A `P2011` can be thrown from a trigger on `LectureProgress` rather than from `LectureProgress` itself.

No claims of root cause or database repair are made until the constraint is identified from the live environment.
