---
name: Study Points legacy preservation
description: Durable constraints for reconciling historical PointsLog data with the canonical Study Points ledger.
---

Treat legacy `PointsLog` rows as preserved history, not as mutable client-owned state. Keep point awards server-authoritative. While the legacy bridge is active, use `User.totalPoints` as the legacy lifetime balance and add only native ledger entries; imported legacy rows must not be counted twice. Backfill history per row with deterministic idempotency keys and an explicit adjustment for any difference between the log sum and the captured user balance. Allow ledger-only reads only after source coverage, adjustment, and projection reconciliation are verified.

**Why:** The product must retain historical point records while making new awards affect balances and gamification consistently.

**How to apply:** For Study Points changes, preserve the original log table, make imports additive and rerunnable, keep client sync from writing points, and verify cutover readiness before changing read modes.

When resetting balances without erasing history, zero `User.totalPoints`, append compensating `PointsLog` rows at the reset time (including a paired capture/correction for unlogged balance differences), and reverse canonical ledger awards rather than deleting them. Rebuild every active leaderboard scope afterward.

**Why:** Historical legacy rows still contribute to bounded rankings; changing only the lifetime balance leaves current weekly, monthly, or semester scores intact.

**How to apply:** Use one locked transaction, preserve original rows, ensure the compensating entries net to zero per account, and verify all scopes before declaring a reset complete.
