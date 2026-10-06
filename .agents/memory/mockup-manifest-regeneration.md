---
name: Mockup manifest regeneration
description: Covers order-only changes made to the mockup sandbox's generated component manifest during startup.
---

The mockup sandbox can reorder entries in its generated component manifest during startup even when the component set is unchanged.

**Why:** this creates unrelated generated-file diffs during visual CSS work.

**How to apply:** after restarting the sandbox, inspect manifest changes and discard order-only churn unless the set of components actually changed.
