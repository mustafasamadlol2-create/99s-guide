---
name: Leaderboard semantics vs cache protocol
description: Keep ranking-source semantics independent from the D1 projection wire protocol.
---

Ranking semantics and the D1 manifest protocol are separate contracts. Store and validate scope-specific ranking semantics on canonical snapshots; keep the manifest's ranking version tied to the wire protocol. Maintenance audits should inspect each season's latest ready snapshot rather than every retained historical revision.

**Why:** Lifetime scoring can change without changing bounded/final ranking behavior or the D1 worker contract. Historical snapshots remain available for cursor retention, so auditing every revision would report old semantics as a permanent incompatibility.

**How to apply:** When changing lifetime ranking inputs, bump the all-time semantics version, rebuild stale all-time snapshots, validate cache projections against scope-specific semantics, and leave the manifest protocol version unchanged unless the wire format changes.
