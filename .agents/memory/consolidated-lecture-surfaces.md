---
name: Consolidated lecture surfaces
description: Safe editing practice for the large LectureDetailView that renders multiple student-facing tabs.
---

When changing presentation classes in the lecture detail view, use surrounding tab-specific context rather than matching a repeated utility class alone.

**Why:** MCQ, Flashcard, Notes, and PDF empty states intentionally reuse similar neutral class strings; an unscoped replacement can silently modify an unrelated tab.

**How to apply:** Keep changes class/token-only where required, patch against nearby tab markers or unique content, and inspect the final diff for cross-tab edits before verification.