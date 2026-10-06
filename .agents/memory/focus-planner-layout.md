---
name: Focus planner layout
description: The intended queue and audio alignment in the Focus Hub planner workspace.
---

For the non-phone Focus Hub workspace, keep the two-column layout, fill the available viewport, and preserve RTL. The preset row must fit without scrollbars. Keep the Lecture Queue header and Add Lecture control fixed while only its list scrolls, with a viewport sized for about two lectures. Keep Today's Plan in its own grid row with a visible strip of page background between it and the timer; never create that spacing by overlapping or transferring space between the cards. Align Focus Audio with the Start Focus / Focus History row. Leave phone layout unchanged.

For visual redesigns, the user wants to work one Focus Hub section at a time: change only the named section and preserve surrounding layout, spacing, and behavior unless explicitly requested. Verify both light and dark themes.

**Why:** the user specified the queue's internal scroll boundary, two-item viewport, desktop/iPad proportions, and mobile/theme/functionality constraints, then explicitly repeated that the timer and plan summary must not overlap.

**How to apply:** check desktop, iPad portrait, and short-landscape heights together, and inspect the final responsive CSS override so it preserves both the timer's full content height and the background gap. Additional lectures must not increase page height; keep the card aligned through the space above Audio. For visual requests, compare both themes and avoid changing neighboring components.

For a five-metric plan summary, use a single row only when each label and value remains readable; switch to two columns at narrower planner widths and let the total span the row. Extracted previews may inherit viewport-shell rules that override local grid styles.

**Why:** a five-column layout became cramped on iPad, and an inherited viewport rule initially forced four columns on desktop.

**How to apply:** inspect both the app and extracted-preview styles, scope overrides to the Focus summary, and verify desktop, iPad, and phone widths.

For per-lecture session counts and study/break duration fields, keep the custom plus/minus controls and hide the browser’s native number-input spinners. Preserve the separate lecture reorder controls unless the user explicitly asks to remove them.

**Why:** the user wants the custom side controls to be the only steppers for these numeric fields and wants lecture reorder controls left intact.

**How to apply:** scope spinner suppression to the session-count and duration controls in both the app and extracted preview; retain numeric input validation and the custom plus/minus handlers.