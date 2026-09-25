---
name: Cross-service test clocks
description: Keep Focus and Study Event clocks aligned in time-dependent integration tests.
---

Focus service clock injection does not automatically control the Study Event ingestion clock. A Focus test fixture timestamp that is future-dated relative to event ingestion can fail canonical timestamp validation even when the Focus state is otherwise valid.

**Why:** The resulting error is a generic invalid-event response and can look like a schema or database failure during real PostgreSQL tests.

**How to apply:** Use historical timestamps for Focus integration fixtures unless the same clock is injected into both service boundaries.