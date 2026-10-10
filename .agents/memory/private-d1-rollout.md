---
name: Private D1 rollout checks
description: Operational checks for deploying authenticated private-data Worker reads and applying D1 migrations safely.
---

Treat D1 schema, Worker code, and Worker secrets as separate rollout steps. Updating a Wrangler secret does not deploy source code; a Worker can authenticate correctly yet return 404 when the deployed version lacks newly added routes. Applying SQL directly to D1 also does not mark Wrangler migrations as applied, while running the full migration command may execute unrelated pending migrations.

**Why:** The private-data Worker returned 401 until its secret was synchronized, then 404 because the deployed Worker code lagged behind the local source. D1 tables had also been applied directly to avoid an unrelated pending migration, leaving Wrangler’s ledger behind the actual schema.

**How to apply:** Before enabling private D1 reads or mirroring, verify the secret, deploy the Worker source, test authenticated read-only routes, verify D1 health/table coverage, and reconcile migration-ledger state without blindly applying unrelated migrations.
