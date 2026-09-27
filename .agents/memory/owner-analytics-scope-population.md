---
name: Owner analytics scope population
description: Why subject and lecture analytics currently use the global eligible-student population.
---

Until the data model exposes a canonical subject/lecture enrollment mapping, owner analytics must use the canonical global eligible-student count for scope suppression. Never estimate scope eligibility from observed activity or contributor counts. Make the global-population limitation clear when reporting subject or lecture analytics.

**Why:** Activity-derived populations would reveal participation and could make low-activity content appear to have a smaller eligible cohort than it actually does.

**How to apply:** Preserve the global eligibility denominator for subject and lecture thresholds until an authoritative content-specific enrollment source is introduced and privacy-reviewed.