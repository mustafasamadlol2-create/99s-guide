---
name: Focus Quick Notes removal
description: User-approved scope and migration approach for removing Focus Quick Notes.
---

Remove Focus Quick Notes and its stored rows permanently, while preserving unrelated note features and data. Use a forward migration to drop its table; do not rewrite migration history or apply the destructive migration to an unknown database.

**Why:** The user confirmed permanent removal of this feature only. The intended database environment must be known before deleting stored rows.

**How to apply:** Keep the deletion scoped to the Focus Quick Notes table and apply the forward migration only after confirming the target database.