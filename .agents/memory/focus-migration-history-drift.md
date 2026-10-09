---
name: Focus migration history drift
description: Avoid applying unrelated schema changes when the configured Focus database and local Prisma migrations differ.
---

Before applying a Focus schema change, inspect migration status against the database selected by the running app. Compare local migration directory names with finished migration names in the database; a zero count of unfinished rows only means no migration was interrupted. If histories differ, do not run a broad deploy or schema push without reviewing every local-only migration; apply only the approved change and preserve unrelated data and migration records.

**Why:** The configured database had a migration recorded that was absent from the checkout, while the local pending set included a table-drop migration unrelated to restoring Start Focus. A zero count of unfinished database migration rows did not reveal several local migrations that had never been applied.

**How to apply:** Confirm the actual app database target, compare local and database migration names in both directions, inspect local-only SQL, and scope any approved migration operation to avoid unrelated DDL or data loss.
