---
name: Auth & PWA Production Audit
description: Findings and fixes from the comprehensive authentication/security/PWA audit. Reference before touching auth, OAuth, cookies, JWT, or the sandbox callback.
---

## Critical fixes applied

### Sandbox bypass (CLOSED)
`/auth/callback/sandbox` accepted any `?email=...` — attacker could obtain owner JWT.
Fix: blocked in production (`NODE_ENV==="production"` → 404) + state validation (state must be in `pendingOAuthStates`).

### OAuth CSRF / state not validated (CLOSED)
`pendingOAuthStates` Map added (server.ts near pendingOAuthSessions). `/api/auth/oauth-url` records stateToken before returning. Both `/auth/callback/:provider` and `/auth/callback/sandbox` validate + delete (one-time use). Error flows skip state check (provider error may arrive without consumed state).

### XSS in OAuth error reflection (CLOSED)
`escapeHtml()` helper added to server.ts. All provider/user-controlled values going into HTML now use `escapeHtml()`. Error message from sandbox catch block replaced with a generic string.

### JS injection in callback pages (CLOSED)
All auth token / userId / email values interpolated into `<script>` blocks now use `JSON.stringify()`. postMessage target changed from `'*'` to `JSON.stringify(appOrigin)` (computed server-side from req.protocol + req.get("host")).

### Password reset timing-safe (CLOSED)
`crypto.timingSafeEqual()` replaces `!==` on reset tokens.

### JWT algorithm pinning (CLOSED)
All `jwt.verify()` calls now pass `{ algorithms: ["HS256"] }` — prevents algorithm-confusion attacks.

### Cookie explicit path (CLOSED)
`setCookieToken` + both `clearCookie` calls now include `path: "/"` to guarantee matching.

### Fetch timeouts (CLOSED)
`AbortSignal.timeout(10_000)` added to all external OAuth provider fetch calls (Google token + userinfo, Facebook token + profile, Apple GET token exchange).

### Rate limiting (CLOSED)
`/api/auth/oauth-url` and `/auth/callback` prefixes added to `authLimiter`.

## Frontend fixes applied

### Overlapping polls (CLOSED)
`let pollInFlight = false` guard in native polling `setInterval` + `finally { pollInFlight = false }`.

### Stale browserFinished timer (CLOSED)
`browserFinishedTimerRef` added. 1.8s setTimeout stored and cleared on unmount / new attempt / success.

### isMountedRef in native success path (CLOSED)
Added `if (!isMountedRef.current) return;` check inside poll success branch before state writes.

### browserFinishedTimerRef cleared on success (CLOSED)
Success branch now clears `browserFinishedTimerRef` before dispatching OAUTH_AUTH_SUCCESS.

## PWA fix

### SW controllerchange reload (CLOSED)
`window.location.reload()` re-enabled in `controllerchange` handler (was commented out). Ensures users get fresh assets after SW update.

## Known remaining items (not fixed — architectural or OOscope)

- No CSP header (Helmet CSP disabled server.ts:237) — needs careful policy design to avoid breaking inline scripts
- Apple `jwt.decode` without signature validation — Apple requires public key verification; needs `apple-auth` library or JWKS fetch
- No session revocation / jti — stolen JWTs valid until 30d expiry; password change does not invalidate tokens
- Registration not transactional (user + welcome points) — failure leaves partial record; points failure is already swallowed
- OAuth existing-user two-step update (role + lastActive) not in transaction — low risk
- CORS whitelist includes `*.run.app` broadly — review if scope can be narrowed
- ApiCache and ban-cache not cleared on logout — stale data served until TTL expires
