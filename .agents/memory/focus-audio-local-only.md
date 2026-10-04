---
name: Focus Audio local-only rule
description: Preserve the session-only, non-uploaded boundary for user-selected Focus Audio.
---

Selected audio stays local to the current app session and is not uploaded or persisted.

**Why:** the user explicitly set this as a privacy and scope requirement for Focus Audio.

**How to apply:** treat this as a hard constraint on Focus Audio storage and network behavior; do not add upload or persistence paths for selected audio.