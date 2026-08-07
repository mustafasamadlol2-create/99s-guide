---
name: Google OAuth setup
description: Real Google Sign-In is configured; domain restriction enforced; redirect URI notes for production.
---

# Google OAuth setup

## State
GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set as Replit Secrets. Real Google OAuth is active — no more sandbox fallback.

## Domain restriction
Only `@comed.uobaghdad.edu.iq` emails are allowed through (`oauthService.ts: ALLOWED_DOMAIN`). The developer whitelist (`ss70eng1@gmail.com`) is also allowed with owner role. All other emails get OAUTH_DOMAIN_REJECTED.

**Why:** The app is exclusively for Baghdad University Medical College students. This is intentional policy, not a bug.

## Redirect URI
The server derives the redirect URI dynamically from `req.protocol` + `req.get("host")` (trust proxy is set). No `GOOGLE_REDIRECT_URI` env var needed.

**Current dev redirect URI:**
`https://7710db5c-2a35-43dc-8cce-e9d5917b8a32-00-3rxx5nlt5d0h1.pike.replit.dev/auth/callback/google`

**How to apply:** When deploying to a production domain, add the production URL's `/auth/callback/google` to Google Cloud Console → Credentials → Authorized redirect URIs. The server will automatically use the correct host for each environment.
