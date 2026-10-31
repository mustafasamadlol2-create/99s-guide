# Phase 3/10 — Users & Authentication Read Cutover

Supabase remains the canonical database. Cloudflare D1 stores a non-sensitive read replica for recurring user/session/profile reads. Password hashes, reset tokens and verification tokens are intentionally not copied to D1.

## Order

1. `npm run migrate:deploy`
2. `npm run d1:private:migrate`
3. `npm run deploy:private-worker`
4. Deploy Render with `PRIVATE_D1_WRITE_MIRROR_ENABLED=true`, but keep `PRIVATE_D1_PHASE3_CUTOVER_ENABLED=false`.
5. From the local machine, run `npm run users:d1:backfill`.
6. When verification is OK, set `PRIVATE_D1_PHASE3_CUTOVER_ENABLED=true` in Render and redeploy.
7. Test login/session restore, profile, user roster, group/role display, profile update, logout/login, and Apple/Google sign-in if available.

The Phase 3 cutover is strict: recurring user/profile reads do not fall back to Supabase when the flag is enabled. Credential verification (password hash/reset/verification tokens) remains canonical-only in Supabase because those secrets are intentionally not replicated.
