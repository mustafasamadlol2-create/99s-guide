---
name: Study Points reward admission
description: Admission and versioning rules for adding Study Points sources.
---

Only activate a reward source after its completion meaning, trusted server-side evidence, idempotency boundary, and eligibility window are explicit. Preserve the current ruleset during an active season; introduce changed rewards under a new rule version at a declared season boundary. Never rewrite historical ledger entries or grant new-source awards retroactively. See `docs/STUDY_POINTS_RULESET_V1.md` for the current baseline.

**Why:** Opens, saves, repeated views, and client-reported activity do not prove that a student completed the learning activity; awarding from them would invite duplicate or unsupported points.

**How to apply:** Before adding Lecture/PDF, Notes, generic MCQ, Flashcard, or video rewards, identify their canonical server event, prove retry/concurrency safety, and shadow-evaluate the rule before enabling it for students.
