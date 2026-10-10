---
name: Leaderboard semantics vs cache protocol
description: Keep ranking-source semantics independent from the D1 projection wire protocol.
---

Ranking semantics and the D1 manifest protocol are separate contracts. Store and validate scope-specific ranking semantics on canonical snapshots; keep the manifest's ranking version tied to the wire protocol. Maintenance audits should inspect each season's latest ready snapshot rather than every retained historical revision.

The live student leaderboard includes every active account, regardless of account role, including accounts with zero points. Focus Hub and Leaderboard data should begin syncing after authentication rather than waiting for navigation; use event-driven invalidation, not polling or manual refresh.

**Why:** Ranking population is a product requirement, and stale empty snapshots can hide valid active accounts. Lifetime scoring can change without changing bounded/final ranking behavior or the D1 worker contract. Historical snapshots remain available for cursor retention.

**How to apply:** When changing participant eligibility, bump ranking semantics for affected scopes and rebuild stale snapshots. Check roster coverage on reads; retain the existing authenticated realtime event path unless Supabase Realtime is explicitly configured. Bump the D1 manifest protocol only when its wire format changes.
