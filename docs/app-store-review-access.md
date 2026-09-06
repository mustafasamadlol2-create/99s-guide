# App Store Review Access

This document describes the minimal, secure mechanism Apple reviewers use to
access the production application without weakening the student-only access
gate, and the configuration required to submit the app.

## Access policy (unchanged)

Authentication is restricted to:

1. Institutional email accounts ending in `@comed.uobaghdad.edu.iq`, and
2. Exact email addresses listed in the `ALLOWED_REVIEWER_EMAILS` environment
   variable (operator-vetted allowlist).

See `server/services/oauthService.ts` — this is the single source of truth and
applies to Google OAuth, Apple Sign-In, and email/password login/registration.

There is **no** demo mode, guest account, or hidden bypass in the production
build. The developer sandbox (`/auth/callback/sandbox`) fails closed: it only
exists when `NODE_ENV=development` **and** `ALLOW_SANDBOX_AUTH=true`.

## How reviewer access works (a dedicated review account)

Apple reviewers cannot use a `@comed.uobaghdad.edu.iq` email, and their own
Apple ID email cannot be known in advance. The supported flow is a
pre-registered review account placed on the allowlist:

1. **Set the allowlist on the backend (Render):**
   `ALLOWED_REVIEWER_EMAILS=<review-account-email>` (comma-separated if more
   than one). Example: `ALLOWED_REVIEWER_EMAILS=appreview99s@gmail.com`.

2. **Pre-register the review account yourself** before submission so the
   password is under your control (email/password sign-up on the auth screen,
   or via Google/Apple sign-in with that account). Reviewer emails are marked
   verified automatically — no verification link is needed. The account is a
   regular `user` role with the same content access as a student.

3. **Provide the credentials in App Store Connect → App Review Information →
   Sign-In Information**, e.g.:
   - "Sign in with the provided account: email `appreview99s@gmail.com`,
     password `<set-by-operator>` (Continue with Google), or use the same
     email/password directly."
   - Add the App Review Notes: "Reviewer access is via the credentials in the
     Sign-In Information section. No institutional email is required."

## Security properties

- The allowlist is an exact-match set; it is never a wildcard/domain bypass.
- The review email is chosen by the operator and never published, so it cannot
  be used to claim an account.
- Reviewer accounts receive only the ordinary `user` role — all existing
  admin/owner permission rules are untouched.
- All other production authentication and authorization behavior is unchanged.

## Sign in with Apple backend configuration (required before submission)

The frontend now exposes "Continue with Apple", wired to the existing backend
OAuth implementation (`/api/auth/oauth-url?provider=apple` →
`/auth/callback/apple`). It requires these environment variables on the
backend (never hardcoded in the repository):

- `APPLE_CLIENT_ID` — the Service ID (e.g. `com.nine9sguide.app.signin`)
- `APPLE_TEAM_ID`
- `APPLE_KEY_ID`
- `APPLE_PRIVATE_KEY` — the `.p8` private key contents (or base64)

In the Apple Developer account:

1. Add the **Sign in with Apple** capability to the App ID
   `com.nine9sguide.app`.
2. Create a Service ID with a Sign in with Apple configuration whose callback
   URLs include `https://nine9s-guide.onrender.com/auth/callback/apple`.
3. Create a Sign in with Apple Keys key (ES256, `.p8`) and use its ID/team.

When `APPLE_*` variables are unset, the Apple button returns a "provider not
configured" error rather than failing open.
