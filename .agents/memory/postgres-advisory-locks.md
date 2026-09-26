---
name: Prisma advisory locks
description: Prisma lock-query types and transaction isolation when contended PostgreSQL advisory locks protect revisions.
---

When calling a PostgreSQL advisory-lock function through Prisma raw queries, return a supported scalar (for example, a boolean selected from a subquery that invokes the lock). Do not select the lock function's `void` result directly.

**Why:** Prisma fails to deserialize PostgreSQL's `void` column type, which aborts the transaction before the lock can protect the operation.

When a lock waiter must read the latest state written by the previous holder, use `READ COMMITTED` and perform those reads after acquiring the lock. Under `REPEATABLE READ`, the lock query can establish a snapshot before waiting, leaving later reads stale even after the lock is granted.

**Why:** A transaction-scoped advisory lock serializes writers, but it does not refresh a transaction snapshot that was captured before the wait.

**How to apply:** Keep the lock call inside the interactive transaction, project a supported value, and choose isolation based on whether the post-lock reads must observe the prior holder's commit.