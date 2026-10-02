---
name: Focus planner layout
description: The intended queue and audio alignment in the Focus Hub planner workspace.
---

For the non-phone Focus Hub workspace, keep the two-column layout, fill the available viewport, and preserve RTL. The preset row must fit without scrollbars. Keep the Lecture Queue header and Add Lecture control fixed while only its list scrolls, with a viewport sized for about two lectures. Today's Plan must size to its content with only a small bottom inset; never stretch it to fill an unrelated grid row. Route recovered vertical space to the timer and keep Focus Audio aligned with the Start Focus / Focus History row. Leave phone layout unchanged.

**Why:** the user specified the queue's internal scroll boundary, two-item viewport, desktop/iPad proportions, and mobile/theme/functionality constraints. They explicitly do not want a blank area beneath Today's Plan.

**How to apply:** check desktop, iPad portrait, and short-landscape heights together. Additional lectures must not increase page height; keep the plan summary content-height, Audio on the action row, and the timer able to use recovered space.