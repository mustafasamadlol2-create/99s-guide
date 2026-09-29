---
name: Recall eligibility parity
description: The private availability read must stay aligned with server-side Recall issuance without exposing candidate identifiers.
---

The private Recall eligibility read must mirror issuance rules for active attempts, the global cooldown, daily and weekly caps, and protected candidate availability. It stays read-only and returns no candidate or attempt IDs.

**Why:** A client-visible “available” state that issuance rejects creates inconsistent launch behavior. Exposing identifiers can leak private study data and invite client-controlled selection.

**How to apply:** When changing Recall issuance policy, update eligibility in the same change and reuse the same predicates where possible. Add contract tests for status parity and verify identifiers remain absent.