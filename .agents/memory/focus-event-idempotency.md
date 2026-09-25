---
name: Focus event idempotency
description: Replay rules for Focus events whose service methods look up prior events directly.
---

For a stable idempotency key, a matching semantic payload is a replay; a changed payload must conflict. Do not blindly re-ingest the stored payload while ignoring the incoming request.

**Why:** A real PostgreSQL test exposed that a retry with a different interruption duration could be silently accepted as a replay.

**How to apply:** When adding a Focus event mutation with a direct prior-event lookup, compare every normalized semantic field with the incoming DTO before returning replay; conflicts must add no writes.