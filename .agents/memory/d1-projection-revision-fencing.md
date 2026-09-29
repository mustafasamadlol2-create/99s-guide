---
name: D1 projection revision fencing
description: Preserve last-writer ordering for private D1 projections under concurrent sync and delete events.
---

Fence projection revisions in SQL, not with a read followed by an unconditional write. Compare arbitrary-length decimal revisions as canonical text by length and then binary lexical order; never convert them to JavaScript `Number` or SQLite integers.

**Why:** Separate reads and writes let a delayed older sync overwrite a newer row or deletion marker. Updating the row, tombstone, and user watermark in one D1 batch keeps those state transitions consistent.

**How to apply:** Use conditional `ON CONFLICT ... DO UPDATE WHERE` guards and batch related row, tombstone, and watermark statements. Read the resulting row in the same batch to classify applied, idempotent, and stale deliveries.