---
name: Focus read coordination
description: Scoping rule for Focus read sharing, invalidation, and stale-response protection.
---

Focus reads may share work only when the account, resource, query variant, and invalidation epoch all match. Mutations and remote invalidations should advance only affected resource epochs. Lifecycle recovery must invalidate the active view's resources before it starts fresh reads.

**Why:** canonical and non-canonical reads can target the same resource while requiring different data, and an unscoped in-flight request can cross account changes. A pending response from before a mutation or reconnect must not satisfy a fresh read.

**How to apply:** When adding or changing Focus reads, preserve account/query/epoch partitioning and ensure each mutation or socket event invalidates the matching scopes before reconciliation.
