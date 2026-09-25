---
name: Git checkpoint tracking
description: How to distinguish automatically checkpointed work from current uncommitted edits.
---

Recheck both `git status --short` and the latest commit contents after multi-turn edits. A Replit checkpoint can place part of an in-progress change in Git history while later edits remain in the working tree; a clean or small diff does not necessarily describe everything done in the current task.

**Why:** A state-machine correction appeared in the latest commit while a later HTTP integration-test edit remained uncommitted, so the working diff alone understated the change.

**How to apply:** Before further edits or final reporting, compare the latest commit with the working tree and report both accurately. Do not create another commit merely to make the status look uniform.