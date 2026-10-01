---
name: Focus display behavior
description: Keep Focus visuals honest about which session phases and progress the current plan model supports.
---

Focus displays should reflect persisted plan values and supported focus/break phases. Do not imply long-break scheduling or completed-today progress unless the product model and data provide them.

**Why:** The existing Focus plan stores focus and break durations but has no long-break phase or canonical daily-completion aggregate. Reference visuals must not create a false expectation about session behavior.

**How to apply:** When matching or extending Focus dashboard and active-session designs, reuse actual plan counts and durations. Add a new phase only alongside the corresponding persisted behavior and API support.