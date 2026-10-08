---
name: Study Points legacy preservation
description: Durable constraints for reconciling historical PointsLog data with the canonical Study Points ledger.
---

Treat legacy `PointsLog` rows as preserved history, not as mutable client-owned state. Keep point awards server-authoritative. While the legacy bridge is active, use `User.totalPoints` as the legacy lifetime balance and add only native ledger entries; imported legacy rows must not be counted twice. Backfill history per row with deterministic idempotency keys and an explicit adjustment for any difference between the log sum and the captured user balance. Allow ledger-only reads only after source coverage, adjustment, and projection reconciliation are verified.

**Why:** The product must retain historical point records while making new awards affect balances and gamification consistently.

**How to apply:** For Study Points changes, preserve the original log table, make imports additive and rerunnable, keep client sync from writing points, and verify cutover readiness before changing read modes.
