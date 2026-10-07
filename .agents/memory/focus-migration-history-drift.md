---
name: Focus migration history drift
description: Avoid applying unrelated schema changes when the configured Focus database and local Prisma migrations differ.
---

Before applying a Focus schema change, inspect migration status against the database selected by the running app. If local and database histories differ, do not run a broad deploy or schema push without reviewing every pending migration; apply only the approved change and preserve unrelated data and migration records.

**Why:** The configured database had a migration recorded that was absent from the checkout, while the local pending set included a table-drop migration unrelated to restoring Start Focus.

**How to apply:** Confirm the actual app database target, inspect local-pending and database-only migrations, and scope any approved migration operation to avoid unrelated DDL or data loss.
