/**
 * OAuthService — Domain restriction and role assignment for OAuth providers.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Business rules — single source of truth                               │
 * │                                                                         │
 * │  1. ACCESS GATE: An email is permitted if it satisfies ANY of:         │
 * │       a) Its domain ends with @comed.uobaghdad.edu.iq, OR              │
 * │       b) It is an exact address listed in the reviewer allowlist.      │
 * │                                                                         │
 * │     The App Store review account is explicitly allowed:                │
 * │       mustafasamadnm@gmail.com                                          │
 * │                                                                         │
 * │     Additional reviewer accounts can also be configured through        │
 * │     ALLOWED_REVIEWER_EMAILS.                                            │
 * │                                                                         │
 * │     All other addresses are rejected before the DB is touched.         │
 * │                                                                         │
 * │  2. ROLE ASSIGNMENT:                                                    │
 * │     • New OAuth accounts are always regular users.                      │
 * │     • Existing database roles are preserved and authoritative.         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Import and call `verifyAndUpsertOAuthUser()` from every OAuth route
 * so these rules apply uniformly.
 */

import { randomUUID } from "node:crypto";
import { UserService, UserRecord } from "./userService.js";
import { AuthService } from "./authService.js";

// ─── Policy constants ─────────────────────────────────────────────────────────

/** The institutional email domain normally permitted to authenticate. */
export const ALLOWED_DOMAIN = "@comed.uobaghdad.edu.iq" as const;

/**
 * Exact reviewer accounts permanently allowed in addition to the university
 * domain.
 *
 * This is an exact-match allowlist. It does NOT allow arbitrary Gmail users.
 */
const BUILT_IN_REVIEWER_EMAILS = [
  "mustafasamadnm@gmail.com",
] as const;

/**
 * Final reviewer allowlist.
 *
 * Includes:
 * 1. Built-in explicitly approved reviewer accounts.
 * 2. Any additional comma-separated accounts configured through:
 *    ALLOWED_REVIEWER_EMAILS
 */
const REVIEWER_EMAILS: ReadonlySet<string> = new Set([
  ...BUILT_IN_REVIEWER_EMAILS.map((email) =>
    email.trim().toLowerCase(),
  ),

  ...(process.env.ALLOWED_REVIEWER_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email),
    ),
]);

// ─── Guards ───────────────────────────────────────────────────────────────────

/**
 * Returns true only when the email ends with the exact institutional domain.
 */
export function isAllowedDomain(email: string): boolean {
  return email
    .trim()
    .toLowerCase()
    .endsWith(ALLOWED_DOMAIN);
}

/**
 * Returns true only when the exact normalized email address exists in the
 * reviewer allowlist.
 */
export function isReviewerEmail(email: string): boolean {
  return REVIEWER_EMAILS.has(
    email.trim().toLowerCase(),
  );
}

/**
 * Returns true when the account may authenticate.
 *
 * Allowed:
 * - @comed.uobaghdad.edu.iq accounts
 * - exact reviewer accounts
 *
 * Rejected:
 * - every other email address
 */
export function isAllowedEmail(email: string): boolean {
  const clean = email.trim().toLowerCase();

  return (
    isAllowedDomain(clean) ||
    isReviewerEmail(clean)
  );
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Verify domain restriction, determine role, then find-or-create the user.
 *
 * @throws An error with `.code === "OAUTH_DOMAIN_REJECTED"` when the email
 * is not permitted.
 */
export async function verifyAndUpsertOAuthUser(params: {
  email: string;
  name: string;
  avatar?: string;
  allowAnyEmail?: boolean;
  appleName?: string;
}): Promise<UserRecord> {
  const cleanEmail = params.email
    .trim()
    .toLowerCase();

  // ── 1. Access gate ────────────────────────────────────────────────────────
  //
  // Google:
  // - institutional domain is allowed
  // - exact reviewer email is allowed
  //
  // Apple:
  // allowAnyEmail can be enabled only by trusted server-side Apple callback
  // code because Apple may return private relay/personal addresses.
  //
  // Never accept allowAnyEmail from an untrusted client request.

  if (
    !params.allowAnyEmail &&
    !isAllowedEmail(cleanEmail)
  ) {
    const err = new Error(
      "Access Denied: Only Baghdad University Medical College emails " +
        `(${ALLOWED_DOMAIN}) are allowed to sign in.`,
    );

    (err as any).code = "OAUTH_DOMAIN_REJECTED";

    throw err;
  }

  // ── 2. Existing user lookup ───────────────────────────────────────────────

  let user = await UserService.findByEmail(
    cleanEmail,
  );

  if (user) {
    /**
     * A successful OAuth provider assertion proves ownership of the email.
     */
    await UserService.markEmailVerified(
      user.id,
    );

    /**
     * Apple only provides the real user name during the first authorization.
     *
     * If the currently stored name is still one of our generic fallback names,
     * upgrade it when Apple supplies a better name.
     */
    if (
      params.allowAnyEmail &&
      params.appleName
    ) {
      const fallbackNames = [
        "apple student",
        "apple user",
      ];

      const currentName = (
        user.name || ""
      )
        .trim()
        .toLowerCase();

      if (
        fallbackNames.includes(
          currentName,
        )
      ) {
        const appleName =
          params.appleName.trim();

        await UserService.updateUser({
          id: user.id,
          name: appleName,
        });

        user.name = appleName;
      }
    }

    await UserService.updateUser({
      id: user.id,
      lastActive:
        new Date().toISOString(),
    });

    return {
      ...user,
      emailVerified: true,
    };
  }

  // ── 3. First OAuth login ──────────────────────────────────────────────────
  //
  // New OAuth accounts are always created as regular users.
  //
  // They start as PENDING_PROFILE so that the frontend displays the profile
  // completion screen:
  //
  //   avatar
  //   full name
  //   academic group
  //   signature
  //
  // After profile completion, the account becomes ACTIVE.

  try {
    user =
      await AuthService.registerUser({
        email: cleanEmail,

        name:
          (
            params.allowAnyEmail
              ? (
                  params.appleName ||
                  ""
                ).trim()
              : ""
          ) ||
          params.name.trim() ||
          cleanEmail
            .split("@")[0]
            .replace(
              /[._-]+/g,
              " ",
            ),

        /**
         * OAuth users never use this password.
         *
         * A cryptographically random value prevents the OAuth-created account
         * from being authenticated through the legacy password flow.
         */
        password:
          `oauth_secure_${randomUUID()}`,

        role: "user",

        emailVerified: true,

        accountStatus:
          "PENDING_PROFILE",
      });
  } catch (err: any) {
    /**
     * Protection against a race condition:
     *
     * Another OAuth request may have created the same account between our
     * findByEmail() call and registerUser().
     *
     * Re-fetch the user before treating the operation as a failure.
     */
    const existing =
      await UserService.findByEmail(
        cleanEmail,
      );

    if (existing) {
      user = existing;
    } else {
      throw err;
    }
  }

  // ── 4. Provider avatar ────────────────────────────────────────────────────

  if (params.avatar) {
    await UserService.updateUser({
      id: user.id,
      avatar: params.avatar,
    });

    user.avatar =
      params.avatar;
  }

  return user;
}

// ─── Styled denial page ───────────────────────────────────────────────────────

/**
 * Returns a fully self-contained HTML page shown inside the OAuth flow when
 * an unauthorized email attempts to sign in.
 *
 * @param redirectOnClose
 * When true, redirect back to the app instead of calling window.close().
 *
 * @param appOrigin
 * App origin used as postMessage targetOrigin.
 *
 * @param scriptNonce
 * CSP nonce for the inline script.
 */
export function buildDomainRejectionPage(
  redirectOnClose = false,
  appOrigin = "*",
  scriptNonce = "",
): string {
  const message =
    `Access Denied: Only ${ALLOWED_DOMAIN} student emails are allowed ` +
    "to sign in to the Medical Education Portal.";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />

    <title>
      Access Denied — Baghdad Medical Portal
    </title>

    <style>
      *,
      *::before,
      *::after {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      body {
        font-family:
          -apple-system,
          BlinkMacSystemFont,
          "Segoe UI",
          Roboto,
          Helvetica,
          Arial,
          sans-serif;

        background:
          linear-gradient(
            135deg,
            #FFF8F0 0%,
            #FEF3C7 100%
          );

        min-height: 100vh;

        display: flex;
        align-items: center;
        justify-content: center;

        padding: 1.5rem;
      }

      .card {
        background: #FFFFFF;

        border:
          1.5px solid #FED7AA;

        border-radius: 20px;

        box-shadow:
          0 8px 32px rgba(0,0,0,0.08),
          0 2px 8px rgba(0,0,0,0.04);

        padding:
          2.5rem 2rem;

        text-align: center;

        max-width: 420px;
        width: 100%;

        animation:
          slideUp
          0.3s
          cubic-bezier(
            0.22,
            1,
            0.36,
            1
          )
          both;
      }

      @keyframes slideUp {
        from {
          opacity: 0;
          transform:
            translateY(16px)
            scale(0.97);
        }

        to {
          opacity: 1;
          transform:
            translateY(0)
            scale(1);
        }
      }

      .icon-wrap {
        width: 64px;
        height: 64px;

        border-radius: 50%;

        background: #FEF3C7;

        border:
          1.5px solid #FDE68A;

        display: flex;
        align-items: center;
        justify-content: center;

        margin:
          0 auto
          1.25rem;
      }

      .icon-wrap svg {
        width: 30px;
        height: 30px;
      }

      h2 {
        font-size: 1.2rem;

        font-weight: 700;

        color: #92400E;

        margin-bottom: 0.6rem;

        letter-spacing:
          -0.02em;
      }

      p {
        font-size: 0.875rem;

        color: #78350F;

        line-height: 1.65;

        margin-bottom:
          0.75rem;
      }

      .domain-chip {
        display:
          inline-block;

        background:
          #FEF9C3;

        border:
          1px solid #FDE68A;

        color:
          #92400E;

        padding:
          5px 14px;

        border-radius:
          99px;

        font-family:
          "SF Mono",
          "Fira Code",
          Consolas,
          monospace;

        font-size:
          0.82rem;

        font-weight:
          600;

        margin:
          0.25rem
          0
          1rem;

        letter-spacing:
          0.01em;
      }

      .note {
        font-size:
          0.75rem;

        color:
          #A16207;

        margin-top:
          1rem;

        opacity:
          0.85;
      }

      .progress {
        width:
          100%;

        height:
          3px;

        background:
          #FEF3C7;

        border-radius:
          99px;

        overflow:
          hidden;

        margin-top:
          1.5rem;
      }

      .progress-bar {
        height:
          100%;

        background:
          #F59E0B;

        border-radius:
          99px;

        animation:
          drain
          4.5s
          linear
          forwards;

        width:
          100%;
      }

      @keyframes drain {
        from {
          width: 100%;
        }

        to {
          width: 0%;
        }
      }
    </style>
  </head>

  <body>
    <div class="card">

      <div class="icon-wrap">

        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="#D97706"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
          />

          <line
            x1="9"
            y1="9"
            x2="15"
            y2="15"
          />

          <line
            x1="15"
            y1="9"
            x2="9"
            y2="15"
          />
        </svg>

      </div>

      <h2>
        Access Denied
      </h2>

      <p>
        This Medical Portal is restricted to Baghdad University
        <br />
        College of Medicine students only.
      </p>

      <p>
        Please sign in with your official university email:
      </p>

      <span class="domain-chip">
        ${ALLOWED_DOMAIN}
      </span>

      <p>
        The account you used does not belong to this institution.
        <br />
        Please try again with your student email address.
      </p>

      <p class="note">
        ${
          redirectOnClose
            ? "Returning you to the sign&#8209;in page&hellip;"
            : "This window will close automatically&hellip;"
        }
      </p>

      <div class="progress">
        <div class="progress-bar"></div>
      </div>

    </div>

    <script nonce="${scriptNonce}">
      (function () {
        var msg = {
          type: "OAUTH_DOMAIN_REJECTED",
          message: ${JSON.stringify(message)}
        };

        var targetOrigin =
          ${JSON.stringify(appOrigin)};

        try {
          if (
            window.opener &&
            !window.opener.closed
          ) {
            window.opener.postMessage(
              msg,
              targetOrigin
            );
          }
        } catch (e) {
          /* cross-origin guard */
        }

        setTimeout(
          function () {
            ${
              redirectOnClose
                ? "window.location.href = " +
                  JSON.stringify(
                    appOrigin.replace(/\/$/, "") +
                      "/?oauth_error=domain_rejected",
                  ) +
                  ";"
                : "try { window.close(); } catch (e) {}"
            }
          },
          4500
        );
      })();
    </script>

  </body>
</html>`;
}