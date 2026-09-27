---
name: Arabic number-word validation
description: Avoid false positives when matching Arabic number words in natural-text safety validators.
---

Arabic number-word checks need Unicode-letter boundaries. Short alternatives such as `ست` can occur inside ordinary words such as `مستقر`, so substring matching rejects valid Arabic prose.

**Why:** A natural Arabic insight was rejected as a numeric claim because an unbounded number-word alternative matched inside a normal word. That can force needless deterministic fallbacks for the supported locale.

**How to apply:** Bound Arabic number-word alternatives with Unicode-letter-aware boundaries, and test both standalone number words and ordinary words containing those substrings.