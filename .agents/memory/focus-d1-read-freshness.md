---
name: Focus D1 read freshness
description: Keep Focus plan and daily-metric reads safe while PostgreSQL remains canonical and D1 delivery stays asynchronous.
---

Accept a D1 Focus Plan list only when its ordered IDs and `planVersion` values match the lightweight canonical PostgreSQL snapshot. For Study Daily Metrics, compare the full row set and each D1 revision against the canonical `projectionRevision`; write that revision in the same transaction as its outbox entry. A zero metric revision is legacy state and is safe only when its `updatedAt` still matches PostgreSQL.

**Why:** A valid-looking D1 response can omit a newly created row or lag a committed write while its outbox delivery is pending. Per-row revisions detect delayed delivery; comparing the full requested ID set also detects incomplete lists and date ranges.

**How to apply:** Keep mutation responses canonical, let the existing outbox deliver asynchronously, and fall back to PostgreSQL whenever the D1 snapshot differs. Do not use wall-clock timestamps as the normal version fence or change Focus timer/UI behavior to compensate.
