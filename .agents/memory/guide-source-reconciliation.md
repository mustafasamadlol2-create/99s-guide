---
name: Guide/source reconciliation
description: Keep pasted implementation guides and compacted summaries aligned with the live repository before editing.
---

Treat attached guides, prior-session summaries, copied snippets, and historical “future model” assertions as intent and history, not proof of current source state. Before patching, locate the current definitions and inspect their imports, types, and nearby control flow. If later work already activated a model or rule, update the stale assertion rather than rolling the feature back or weakening unrelated checks.

**Why:** Repository code evolves across sequential prompts; old “not yet supported” snapshots can falsely reject a later accepted feature.

**How to apply:** Search the live schema or registry and relevant later implementation/tests, then reconcile the historical assertion with the current contract while preserving the remaining invariants.