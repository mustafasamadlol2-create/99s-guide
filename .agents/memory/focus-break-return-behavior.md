---
name: Focus break return behavior
description: Preserve the user's chosen Study pause/resume behavior around Short Breaks.
---

When a Short Break starts during active Study, pause Study and resume it when the user returns. If Study was already paused before the break, keep it paused on return.

**Why:** The user explicitly chose “Pause; auto-resume on Study” for mid-session breaks and specified that a pre-existing pause must remain paused.

**How to apply:** Preserve this distinction in Focus break service transitions and UI reconciliation. Break duration and break state remain separate from study metrics.
