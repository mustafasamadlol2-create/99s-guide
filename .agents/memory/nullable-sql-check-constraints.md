---
name: Nullable SQL check constraints
description: PostgreSQL CHECK constraints accept UNKNOWN, which matters for paired nullable provenance fields.
---

When a check constraint defines valid states across nullable discriminator and version columns, ensure every invalid partial-null combination evaluates to false. `COALESCE(expression, FALSE)` is a direct way to prevent PostgreSQL's CHECK semantics from accepting an UNKNOWN result.

**Why:** PostgreSQL treats a CHECK expression that evaluates to NULL/UNKNOWN as passing, so a seemingly exhaustive `OR` across nullable columns can allow an invalid mixed state.

**How to apply:** For migrations that add nullable provenance or paired metadata fields, enumerate partial-null cases and make the final constraint result explicitly true or false.