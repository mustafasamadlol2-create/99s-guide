---
name: Gemini structured schemas
description: Compatibility rule for using strict Zod contracts with Gemini structured output.
---

Do not send Zod-generated Draft JSON Schema directly to Gemini. Restrict the provider-facing schema to the keywords supported by the installed Gemini SDK, then run the original strict Zod schema after JSON parsing.

**Why:** Zod emits useful validation keywords such as string-length and exclusive-bound constraints that Gemini structured output may reject. Provider constraints and application trust validation therefore need separate layers.

**How to apply:** Whenever AI response schemas or the Gemini SDK version change, preserve the provider-schema sanitizer and keep strict post-response Zod parsing as the final trust boundary.