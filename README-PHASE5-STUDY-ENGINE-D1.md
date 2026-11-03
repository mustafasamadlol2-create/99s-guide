# Phase 5/10 — Study Engine D1 Read Cutover

Supabase/PostgreSQL remains canonical for Study Engine writes. Cloudflare Private D1 becomes the normal read replica for Focus Plans, Focus Sessions, and Study Daily Metrics (including MCQ/flashcard activity counters).

## Safe rollout

1. Keep `PRIVATE_D1_PHASE5_STUDY_ENGINE_CUTOVER_ENABLED=false`.
2. Deploy the Private Data Worker.
3. Deploy the Render backend with the Phase 5 code while the flag is false.
4. Run `npm run study-engine:d1:backfill` locally.
5. Require all three verification rows to report `OK`.
6. Set `PRIVATE_D1_PHASE5_STUDY_ENGINE_CUTOVER_ENABLED=true` on Render and redeploy.
7. Test Focus Plans, current Focus Session, Focus metrics, MCQ/flashcard activity updates, refresh, and logout/login.

The backfill rebuilds only the disposable D1 copies of `FocusPlan`, `FocusSession`, and `StudyDailyMetric`. It never deletes canonical Supabase rows.

Explicit `canonical=1` Focus reads remain PostgreSQL-backed in Phase 5 for immediate post-mutation reconciliation. They are removed later during the global direct-read cleanup phase.
