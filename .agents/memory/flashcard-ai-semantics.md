---
name: Flashcard AI semantics
description: Durable product semantics for future Flashcard AI and review/import work.
---

`clinicalConcept` is the canonical Flashcard front/prompt, and `explanation` is the canonical back/answer. A front-only extracted card is reviewable but not import-ready; enhancement may fill a missing explanation but must not rewrite an existing explanation or the front.

**Why:** The persisted Flashcard model has only the concept/front and explanation/back as content fields, so treating explanation as optional metadata would create incomplete cards and make later review/import ambiguous.

**How to apply:** Keep extraction source-faithful, require both fields for generated/import-ready cards, and make any future enhancement mode explicitly opt into rewriting rather than silently changing existing content.