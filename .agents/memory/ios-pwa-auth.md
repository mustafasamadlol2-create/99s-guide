---
name: iOS installed-PWA auth
description: Why iPhone home-screen PWA needs Bearer-token session delivery and the in-app-sheet OAuth polling flow.
---

# iOS installed-PWA auth constraints

## The rule
On iPhone when the app runs as an installed (home-screen) PWA, never rely on the httpOnly cookie alone, and never use the full-page OAuth redirect flow.

**Why:** Two iOS standalone-container behaviors broke auth on iPhone only (iPad/Mac use the desktop popup flow because modern iPad UA is "Macintosh"):
1. External navigation opens an in-app browser **sheet with a separate cookie jar** — cookies set by the OAuth callback there never reach the installed app; redirecting the sheet back to `/` shows a second, signed-out app copy (user saw a black screen).
2. The standalone container does not dependably persist/send the session cookie → login succeeded, next request 401'd, `app-session-expired` logged the user out instantly.

**How to apply:**
- Detection: `isIosStandalonePwa()` in `src/core/utils/platform.ts` (UA regex + `navigator.standalone` / `display-mode: standalone`).
- OAuth: PWA branch requests `flow=inapp` (state prefixed `i:`), opens the sheet via `location.href` (SPA stays alive underneath), and polls `/api/auth/oauth-session/:stateToken` — same mechanism as native Capacitor. Callback serves a "close this window" card and must NOT redirect the sheet to `/`.
- Email/password: apiClient sends `X-Session-Delivery: bearer` in this container; login/register/refresh then include the JWT in JSON for SecureStorage + Authorization-header use. All other web clients stay cookie-only (security hardening preserved).
- Server accepts cookie OR Bearer; cookie takes precedence.

## Deployment gotcha
The user tests on a separate Render deployment (nine9s-guide.onrender.com). Fixes made here take effect there only after the user redeploys, and each public domain must be registered as a Google OAuth redirect URI (`<origin>/auth/callback/google`).
