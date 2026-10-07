---
name: Supavisor development pool
description: Keep Replit development from exhausting the shared Supavisor session pool used by database-backed OAuth state.
---

When Prisma commands need the app database, follow the app's configured target rather than assuming Replit's managed `DATABASE_URL` is the same database. In this project, `SUPABASE_DATABASE_URL` takes priority for the app; Replit's database pane can point elsewhere. Keep one-off Prisma clients capped to a single connection when sharing Supavisor's session pool.

**Why:** The app and Replit-managed database targets differed, and an uncapped one-off Prisma client hit the shared 15-client session limit. Pool exhaustion also previously blocked OAuth state upserts.

**How to apply:** Mirror the app's target selection for migration status and exact DDL, cap temporary clients, and inspect the target schema before writing. Preserve the production database URL and OAuth state behavior; never use broad migration commands when histories diverge.