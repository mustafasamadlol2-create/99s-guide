---
name: Personalization preview scoping
description: The My 99 preview must reuse the runtime semantic token declarations without taking ownership of the global app theme.
---

The Personalization Studio scopes each canonical theme token block to both its committed global selector and the local `data-personalization-preview-theme` attribute. The global `data-app-theme` bridge remains the only owner of the document theme.

**Why:** Draft theme selection must render a faithful preview while leaving the committed application unchanged, including when Classic is previewed under an alternate global theme.

**How to apply:** Add future previewable theme tokens to the existing selector-list declarations and keep preview UI declarative. Do not create JavaScript palettes, direct DOM theme mutations, or feature-specific preview selectors.