---
name: Prisma migration schema drift
description: Detect live schema differences even when Prisma migration history appears complete.
---

Before applying a Prisma schema change, inspect migration status against the database selected by the running app and compare actual required columns with the Prisma model. A migration can be recorded as successful while its DDL is absent. Compare local migration directory names with finished database migration names too; if histories differ, do not run a broad deploy or schema push without reviewing every local-only migration. Apply only the approved, narrowly scoped change and preserve unrelated data.

**Why:** One configured database reported all local migrations applied even though the live `User` table lacked a column required by OAuth. In another Focus repair, the database had a migration absent from the checkout while the local pending set included an unrelated table drop. Migration history alone does not prove schema shape.

**How to apply:** Confirm the app database target, inspect live catalog columns for the affected model, compare migration names in both directions, inspect relevant SQL, and apply only the exact idempotent repair needed.
