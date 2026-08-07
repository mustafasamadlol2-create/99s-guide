/**
 * OAuthService — Domain restriction and role assignment for OAuth providers.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Business rules — single source of truth                                │
 * │                                                                         │
 * │  1. ACCESS GATE: An email is permitted if it satisfies EITHER:          │
 * │       a) Its domain ends with @comed.uobaghdad.edu.iq, OR              │
 * │       b) It is the exact developer whitelist address.                   │
 * │     All other addresses are rejected before the DB is ever touched.     │
 * │                                                                         │
 * │  2. ROLE ASSIGNMENT:                                                     │
 * │     • mostafa.samad24001@comed.uobaghdad.edu.iq → "owner"              │
 * │     • ss70eng1@gmail.com (developer)             → "owner"              │
 * │     • Every other valid institutional email       → "user"              │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Import and call `verifyAndUpsertOAuthUser()` from every OAuth route
 * (real providers AND the developer sandbox) so these rules apply uniformly.
 */

import { randomUUID } from "node:crypto";
import { UserService, UserRecord } from "./userService.js";
import { AuthService } from "./authService.js";

// ─── Policy constants ─────────────────────────────────────────────────────────

/** The only email domain permitted to authenticate. */
export const ALLOWED_DOMAIN = "@comed.uobaghdad.edu.iq" as const;

/**
 * The primary owner / super-admin email.
 * Automatically elevated to the "owner" role on every login.
 */
export const PRIMARY_OWNER_EMAIL =
  "mostafa.samad24001@comed.uobaghdad.edu.iq" as const;

/**
 * Developer whitelist — the single external email address that may bypass
 * the institutional domain restriction.  Granted "owner" role automatically.
 *
 * This is an exact-match check; no glob or regex is used so it cannot be
 * spoofed by adding extra characters or subdomains.
 */
export const DEVELOPER_EMAIL = "ss70eng1@gmail.com" as const;

// ─── Guards ───────────────────────────────────────────────────────────────────

/**
 * Returns `true` only when the email ends with the exact ALLOWED_DOMAIN suffix.
 *
 * Uses a suffix match rather than `includes` so that a crafted email like
 * `attacker@evil.com@comed.uobaghdad.edu.iq.example.com` cannot bypass the check.
 */
export function isAllowedDomain(email: string): boolean {
  return email.toLowerCase().endsWith(ALLOWED_DOMAIN);
}

/**
 * Returns `true` when the email is permitted to authenticate.
 *
 * An email is permitted if EITHER:
 *   1. Its domain ends with ALLOWED_DOMAIN (@comed.uobaghdad.edu.iq), OR
 *   2. It is an exact (case-insensitive) match for DEVELOPER_EMAIL.
 *
 * This is the function callers should use for the access gate.
 * `isAllowedDomain` is preserved for internal use and direct domain checks.
 */
export function isAllowedEmail(email: string): boolean {
  const clean = email.toLowerCase();
  return isAllowedDomain(clean) || clean === DEVELOPER_EMAIL;
}

/**
 * Determines the database role for an authenticated user.
 * - Primary owner email → "owner"
 * - Developer email     → "owner"
 * - Any other permitted institutional email → "user"
 */
export function assignOAuthRole(email: string): "owner" | "user" {
  const clean = email.toLowerCase();
  if (clean === PRIMARY_OWNER_EMAIL || clean === DEVELOPER_EMAIL) return "owner";
  return "user";
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Verify domain restriction, determine role, then find-or-create the user.
 *
 * @throws An error with `.code === "OAUTH_DOMAIN_REJECTED"` when the email
 *         domain is not on the allow-list.  Callers should catch this specific
 *         code and render the denial page rather than a generic 500.
 */
export async function verifyAndUpsertOAuthUser(params: {
  email: string;
  name: string;
  avatar?: string;
}): Promise<UserRecord> {
  const cleanEmail = params.email.trim().toLowerCase();

  // ── 1. Access gate — reject before any DB operation ─────────────────────
  // Passes institutional domain members AND the developer whitelist address.
  if (!isAllowedEmail(cleanEmail)) {
    const err = new Error(
      "Access Denied: Only Baghdad University Medical College emails " +
        `(${ALLOWED_DOMAIN}) are allowed to sign in.`,
    );
    (err as any).code = "OAUTH_DOMAIN_REJECTED";
    throw err;
  }

  // ── 2. Role determined from policy, never from user input ─────────────────
  const role = assignOAuthRole(cleanEmail);

  // ── 3. Look up existing user ──────────────────────────────────────────────
  let user = await UserService.findByEmail(cleanEmail);

  if (user) {
    // Guarantee correct role on every login — idempotent and safe.
    if (user.role !== role) {
      await UserService.updateUser({ id: user.id, role });
      user.role = role;
    }
    await UserService.updateUser({
      id: user.id,
      lastActive: new Date().toISOString(),
    });
    return user;
  }

  // ── 4. First login — register with the correct role ───────────────────────
  // A cryptographically random password is set so the account can never be
  // brute-forced via the email/password flow; the user only signs in via OAuth.
  user = await AuthService.registerUser({
    email: cleanEmail,
    name:
      params.name.trim() ||
      cleanEmail.split("@")[0].replace(/[._-]+/g, " "),
    password: `oauth_secure_${randomUUID()}`,
    role,
  });

  // Attach the provider profile photo when available.
  if (params.avatar) {
    await UserService.updateUser({ id: user.id, avatar: params.avatar });
    user.avatar = params.avatar;
  }

  return user;
}

// ─── Styled denial page ───────────────────────────────────────────────────────

/**
 * Returns a fully self-contained HTML page shown inside the OAuth popup when
 * the domain restriction fires.  The page:
 *   • Explains the restriction clearly with the required domain name.
 *   • Posts `{ type: "OAUTH_DOMAIN_REJECTED", message }` to the opener so the
 *     parent app can surface the error inside the sign-in card.
 *   • Auto-closes the popup after 5 seconds.
 */
/**
 * Renders the "Access Denied" card page shown when a non-institutional email
 * attempts to sign in.
 *
 * @param redirectOnClose  When `true` the auto-close script navigates the
 *   page back to "/" instead of calling `window.close()`.  Use this for the
 *   redirect-based OAuth flow where the callback URL IS the main window — not
 *   a popup — so `window.close()` is blocked by the browser.
 * @param appOrigin  The app's own origin (e.g. "https://my.replit.dev").
 *   Used as the `targetOrigin` in `window.opener.postMessage()` so we never
 *   broadcast auth events to arbitrary origins.  Defaults to `"*"` if omitted
 *   (safe here because the rejection message contains no credentials).
 */
export function buildDomainRejectionPage(redirectOnClose = false, appOrigin = "*"): string {
  const message =
    `Access Denied: Only ${ALLOWED_DOMAIN} student emails are allowed ` +
    "to sign in to the Medical Education Portal.";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Access Denied — Baghdad Medical Portal</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
          Helvetica, Arial, sans-serif;
        background: linear-gradient(135deg, #FFF8F0 0%, #FEF3C7 100%);
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
      }
      .card {
        background: #FFFFFF;
        border: 1.5px solid #FED7AA;
        border-radius: 20px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04);
        padding: 2.5rem 2rem;
        text-align: center;
        max-width: 420px;
        width: 100%;
        animation: slideUp 0.3s cubic-bezier(0.22, 1, 0.36, 1) both;
      }
      @keyframes slideUp {
        from { opacity: 0; transform: translateY(16px) scale(0.97); }
        to   { opacity: 1; transform: translateY(0)   scale(1); }
      }
      .icon-wrap {
        width: 64px;
        height: 64px;
        border-radius: 50%;
        background: #FEF3C7;
        border: 1.5px solid #FDE68A;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 1.25rem;
      }
      .icon-wrap svg { width: 30px; height: 30px; }
      h2 {
        font-size: 1.2rem;
        font-weight: 700;
        color: #92400E;
        margin-bottom: 0.6rem;
        letter-spacing: -0.02em;
      }
      p {
        font-size: 0.875rem;
        color: #78350F;
        line-height: 1.65;
        margin-bottom: 0.75rem;
      }
      .domain-chip {
        display: inline-block;
        background: #FEF9C3;
        border: 1px solid #FDE68A;
        color: #92400E;
        padding: 5px 14px;
        border-radius: 99px;
        font-family: "SF Mono", "Fira Code", Consolas, monospace;
        font-size: 0.82rem;
        font-weight: 600;
        margin: 0.25rem 0 1rem;
        letter-spacing: 0.01em;
      }
      .note {
        font-size: 0.75rem;
        color: #A16207;
        margin-top: 1rem;
        opacity: 0.85;
      }
      .progress {
        width: 100%;
        height: 3px;
        background: #FEF3C7;
        border-radius: 99px;
        overflow: hidden;
        margin-top: 1.5rem;
      }
      .progress-bar {
        height: 100%;
        background: #F59E0B;
        border-radius: 99px;
        animation: drain 4.5s linear forwards;
        width: 100%;
      }
      @keyframes drain { from { width: 100%; } to { width: 0%; } }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="icon-wrap">
        <!-- Shield-X icon -->
        <svg viewBox="0 0 24 24" fill="none" stroke="#D97706" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
        </svg>
      </div>

      <h2>Access Denied</h2>
      <p>This Medical Portal is restricted to Baghdad University<br>College of Medicine students only.</p>
      <p>Please sign in with your official university email:</p>
      <span class="domain-chip">${ALLOWED_DOMAIN}</span>

      <p>The account you used does not belong to this institution.<br>
         Please try again with your student email address.</p>

      <p class="note">${redirectOnClose
        ? "Returning you to the sign&#8209;in page&hellip;"
        : "This window will close automatically&hellip;"}</p>
      <div class="progress"><div class="progress-bar"></div></div>
    </div>

    <script>
      (function () {
        var msg = {
          type: "OAUTH_DOMAIN_REJECTED",
          message: ${JSON.stringify(message)}
        };
        // Notify the parent app window if this is running in a popup and the
        // opener is still reachable (desktop Chrome / Firefox).
        // On Safari ITP, window.opener is nullified after the cross-origin
        // redirect through accounts.google.com, so postMessage may not fire —
        // the parent falls back to polling /api/auth/oauth-session/:stateToken
        // which returns { rejected: true } when domain restriction fires.
        var targetOrigin = ${JSON.stringify(appOrigin)};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(msg, targetOrigin);
          }
        } catch (e) { /* cross-origin guard */ }

        // After the progress bar drains (4.5 s), dismiss the page.
        // • Popup path  → window.close()  (browser allows this for script-opened windows)
        // • Redirect path → navigate back to the app (window.close() is blocked on
        //   pages that were not opened by window.open())
        setTimeout(function () {
          ${redirectOnClose
            ? "window.location.href = '/';"
            : "try { window.close(); } catch (e) {}"}
        }, 4500);
      })();
    </script>
  </body>
</html>`;
}
