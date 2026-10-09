---
name: Gamification realtime invalidation
description: The authority and scope contract for live Gamification updates.
---

Gamification socket events are invalidation signals only; clients reread affected API resources. PostgreSQL remains authoritative, and existing scoring, achievement, challenge, leaderboard, and D1 projection behavior must not change.

**Why:** asynchronous socket delivery cannot serve as the source of truth, and realtime work must not create a second path for deriving Gamification state.

**How to apply:** Emit invalidations after committed changes, scope user-specific resources to that user's authenticated room, and fan out only non-sensitive leaderboard/rank invalidations to other authenticated clients.
