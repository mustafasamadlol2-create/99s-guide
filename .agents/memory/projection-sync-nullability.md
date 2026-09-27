---
name: Projection sync nullability
description: Preserve intentional null values when normalizing canonical projection payloads.
---

When a private projection mapper accepts snake_case and camelCase fields, distinguish an explicitly present `null` from a missing field before validating it. Nullish coalescing can erase nullable canonical values and make valid events fail sync validation.

**Why:** Mastery and retention evidence commonly has nullable timestamps and provenance fields; treating `null` as absent caused valid D1 projection writes to be rejected.

**How to apply:** Use own-property checks when choosing aliases in projection mappers, then validate whether the selected field is nullable or required.