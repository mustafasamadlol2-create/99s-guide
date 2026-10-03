---
name: Supavisor development pool
description: Keep Replit development from exhausting the shared Supavisor session pool used by database-backed OAuth state.
---

When Replit development shares Supabase's Supavisor session pool, keep its Prisma connection pool small. Do not switch the production backend to transaction mode or bypass persisted OAuth state to work around pool exhaustion.

**Why:** The session pool's 15-client cap was reached, which prevented OAuth state upserts and returned a 503 before the provider redirect.

**How to apply:** Bound development connections only, preserve the production database URL, and verify database health plus `/api/auth/oauth-url` after restarting the app.