---
name: Prisma advisory locks
description: A Prisma-specific requirement for transaction-scoped PostgreSQL advisory-lock queries.
---

When calling a PostgreSQL advisory-lock function through Prisma raw queries, return a supported scalar (for example, a boolean selected from a subquery that invokes the lock). Do not select the lock function's `void` result directly.

**Why:** Prisma fails to deserialize PostgreSQL's `void` column type, which aborts the transaction before the lock can protect the operation.

**How to apply:** Keep the lock call inside the interactive transaction and project a supported value from the query for any user- or resource-scoped advisory lock.