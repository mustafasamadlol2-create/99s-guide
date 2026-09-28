---
name: Guide/source reconciliation
description: Keep pasted implementation guides and compacted summaries aligned with the live repository before editing.
---

Treat attached guides, prior-session summaries, and copied snippets as intent and history, not as proof of current source state. Before patching, locate the current definitions and inspect their imports, types, and nearby control flow; make the smallest change that fits what exists now.

**Why:** Repository code can evolve independently of a guide or a compacted context snapshot, so stale anchors and assumptions can cause failed or misplaced edits.

**How to apply:** Search for the current symbol or route, read the focused source block, and reconcile its actual shape with the requested behavior before making edits.