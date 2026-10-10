---
name: Study Engagement readiness
description: Feature-availability states and privacy boundaries for Gamification reads.
---

Treat an unavailable feature-flags response as a configuration/read failure, not as an intentionally disabled feature. Public leaderboard labels may use only a sanitized display name; never return an email or account identifier.

**Why:** A failed flag request should remain diagnosable and retryable, while public leaderboard output must not leak private identity fields.

**How to apply:** Preserve separate loading, unavailable, disabled, empty, and failed states in Study Engagement UI; apply the same public-label rules to PostgreSQL and cache-backed leaderboard reads.
