---
name: OAuth popup handoff
description: Prevent browser caching or optional web storage from stranding one-time OAuth flows in a blank popup.
---

Treat OAuth authorization URL requests as non-cacheable, one-time operations. Do not automatically retry them, because each request can mint a distinct state token.

For web PKCE, write the verifier synchronously to session-scoped storage before navigating the pre-opened popup. Any additional Capacitor Preferences mirror should be best-effort and must not block navigation.

**Why:** In Replit Development, Google sign-in opened an `about:blank` popup while the app waited before navigating. The server could generate a valid Google URL, so cached one-time responses and waiting on optional browser storage were the relevant failure modes.

**How to apply:** For changes to browser OAuth initiation, preserve `no-store`/cache bypass, disable retries for state-minting calls, and ensure web storage does not delay the popup handoff.