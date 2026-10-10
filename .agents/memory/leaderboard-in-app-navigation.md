---
name: Leaderboard in-app navigation
description: Keep leaderboard navigation inside the shared application shell.
---

Open the leaderboard as a main content tab from its single sidebar entry. Keep the normal app shell and sidebar visible; do not route it through a full-screen Profile subview or a portal to `document.body`.

**Why:** The previous Profile portal covered the app shell and made the leaderboard feel like an external page; the user explicitly corrected this behavior.

**How to apply:** When changing leaderboard navigation or presentation, use the app's main-tab content region and remove duplicate Profile shortcuts that reopen the full-screen leaderboard.
