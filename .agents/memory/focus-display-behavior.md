---
name: Focus display behavior
description: Keep Focus visuals honest about which session phases and progress the current plan model supports.
---

Focus displays should reflect persisted plan values and supported focus/break phases. Do not imply long-break scheduling or completed-today progress unless the product model and data provide them. In the Focus Hub planner, a full ring illustrates the selected duration and is decorative; the active-session ring remains tied to live remaining-time progress.

**Why:** The plan preview can show a full ring at 25:00 without implying completed work, while the active timer has real remaining-time data. Keeping those meanings distinct avoids false progress indicators.

**How to apply:** When matching or extending Focus dashboard and active-session designs, reuse actual plan counts and durations. Keep planner-ring styling separate from live progress, and add a new phase only alongside the corresponding persisted behavior and API support.