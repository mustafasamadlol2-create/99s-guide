---
name: Prisma partial uniqueness
description: Constraint modeling limits and role invariants for PostgreSQL schemas managed by Prisma 5.22.
---

Prisma 5.22 does not support the `partialIndexes` preview feature, so partial unique indexes cannot be represented in the Prisma schema.

**Why:** Adding a partial unique index only to handwritten migration SQL creates a schema-parity risk. In Group Focus, room membership writes are private service operations: room creation creates the one `HOST` row, and all joins create `MEMBER` rows.

**How to apply:** Keep the membership role server-owned and reject client role fields. Do not add an unmodeled partial index unless Prisma schema support is upgraded and validated or a deliberate drift-management strategy is documented.