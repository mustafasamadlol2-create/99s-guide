---
name: Outbox lease fencing
description: Preserve safe acknowledgements and retry updates when a worker's lease expires during delivery.
---

For leased outbox work, fence acknowledgements and retry-state updates by a monotonically increasing lease generation. The existing attempt count can provide that generation when it increments on every lease and is never reset; both the row identity/revision and generation must match for mutations.

**Why:** A slow delivery can finish after another worker has reclaimed the expired row. Without fencing, the old worker could delete the current row or overwrite the new worker's retry state.

**How to apply:** Keep the generation predicate on every completion/failure mutation. If attempts are reset, coalesced, or otherwise stop being monotonic, introduce a separate lease token before changing the update semantics.