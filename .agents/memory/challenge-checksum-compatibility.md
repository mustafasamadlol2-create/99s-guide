---
name: Gamification checksum compatibility
description: Why Challenge definitions use a separate checksum from the legacy Gamification definition bundle.
---

Keep Challenge definition checksums separate from the legacy Gamification bundle checksum. The earlier Achievement and Level rule sets persisted the legacy checksum before Challenge contracts existed; adding Challenge definitions to that payload would invalidate existing stored hashes and related proof rows. Challenge definitions are validated by their own versioned checksum, and migrations should backfill that checksum without rewriting the legacy one.

**Why:** Existing users' Achievement and Level snapshots depend on the historical definition hash remaining byte-for-byte stable.

**How to apply:** When changing Challenge definitions or rule-set registration, update the Challenge checksum path and preserve the legacy bundle checksum semantics for already-persisted versions.