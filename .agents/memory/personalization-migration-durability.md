---
name: Personalization migration durability
description: The ownership rule for failed local V1-to-V2 personalization migration.
---

The legacy V1 record remains the durable authority until the V2 envelope write succeeds. A failed V2 write must return an invalid/fallback result rather than a found V2 candidate.

**Why:** Treating an in-memory migrated candidate as a found cache lets the Provider mark state as committed even though a reload cannot restore it.

**How to apply:** Keep write-before-delete ordering, preserve V1 on write failure, and make the Provider render its safe fallback until a durable V2 envelope exists.