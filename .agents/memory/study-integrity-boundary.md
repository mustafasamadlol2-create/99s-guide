---
name: Study Integrity boundary
description: Stable architecture boundary for future Integrity consumers and adapters.
---

Keep Integrity evaluation deterministic and internal. It consumes normalized source, evidence, timing, idempotency, ownership, and state inputs; product services remain responsible for database access and ownership truth. Share low-level canonicalization through study-core rather than importing the Study Event ingestion service.

**Why:** The Integrity foundation must stay independent of persistence/review workflows, and Study Events already need the same canonical JSON semantics. A shared primitive avoids service cycles and inconsistent fingerprints.

**How to apply:** Future feature adapters should pass bounded normalized facts to Integrity, keep product writes in their canonical service, and never make the Integrity core query feature tables.