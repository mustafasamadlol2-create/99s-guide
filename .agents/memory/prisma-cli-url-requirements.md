---
name: Prisma CLI URL requirements
description: Prisma schema-only commands require nonempty values for declared datasource URLs.
---

When `schema.prisma` declares `directUrl = env("DIRECT_URL")`, Prisma validation fails if `DIRECT_URL` resolves to an empty string, even when `DATABASE_URL` is set.

**Why:** The development environment had an empty `DIRECT_URL`; validation and client generation succeeded after both datasource variables were temporarily set to inert local placeholder URLs, without connecting to a database.

**How to apply:** For schema-only validation or generation, temporary local placeholder URLs are sufficient. Never use placeholders for migrations or commands that connect to a database, and do not point schema-only checks at production just to satisfy environment validation.