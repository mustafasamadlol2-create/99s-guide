# 99's Guide

99's Guide is a medical education portal for lectures, study progress, flashcards, assessments, calendars, notifications, and moderated student discussion.

## Architecture

- Frontend: React 19, TypeScript, Vite, Tailwind CSS, Motion, and Capacitor integrations.
- Backend: Express and Socket.IO in `server.ts`.
- Database: PostgreSQL accessed through Prisma in `server/services/prismaClient.ts`.
- Local persistence: IndexedDB and Capacitor Preferences for offline caches and session support.
- Academic data: Prisma is authoritative for mutable lectures, materials, MCQs, flashcards, and videos. `materials_db.json` is retained as read-only legacy catalog data during migration.

## Requirements

- Node.js 20 or newer.
- PostgreSQL for backend operation.
- Xcode and CocoaPods for iOS builds, or Android Studio for Android builds.

## Local Development

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` and provide local development values.

3. Start the development server:

   ```sh
   npm run dev
   ```

The development preflight does not modify the database by default. To explicitly run Prisma `db push` against a local database, set `PRISMA_DB_PUSH=true`. Shared database hosts require an additional explicit `ALLOW_SHARED_DB_PUSH=true`.

## Environment Variables

Important variables include:

- `NODE_ENV`: `development`, `test`, or `production`.
- `DATABASE_URL` or `SUPABASE_DATABASE_URL`: PostgreSQL connection string.
- `DIRECT_URL`: direct PostgreSQL URL for Prisma migrations when required.
- `JWT_SECRET`: required in production.
- `APP_URL`: canonical application URL; required in production for safe reset links.
- `FRONTEND_URL`: browser application origin used after OAuth completes.
- `BACKEND_URL`: backend origin used to construct provider callback URLs.
- `VITE_API_BASE_URL`: API base URL for native Capacitor builds. Web production uses same-origin API paths when unset.
- `GOOGLE_*`, `FACEBOOK_*`, and `APPLE_*`: optional OAuth provider configuration.
- `SMTP_*`: password-reset email delivery configuration.
- `ALLOWED_REVIEWER_EMAILS`: optional comma-separated exact emails allowed to sign in beyond the institutional domain (App Store review accounts). See "App Store Review Access".
- `PRISMA_DB_PUSH`: explicit local development schema sync switch.
- `ALLOW_SHARED_DB_PUSH`: additional guard for shared development databases.

Never commit `.env` or place secrets in `VITE_*` variables. Vite variables are delivered to the client.

The release UI exposes Google OAuth and Sign in with Apple. Facebook callback code is retained for compatibility but is not an enabled client login path.

## Prisma Workflow

Validate the schema:

```sh
npx prisma validate
```

Generate the client after schema changes:

```sh
npx prisma generate
```

Production schema changes should use reviewed migration files and `prisma migrate deploy` during deployment. Runtime production schema mutation is disabled.

## Build and Verification

```sh
npm run build
npm run typecheck
npm run lint
npx prisma validate
```

The repository has focused OAuth state regression tests (`npm run test:auth`) but no automated browser/provider integration suite. Manual verification should cover login, logout, lecture navigation, PDF access, calendar operations, offline recovery, Arabic RTL layout, and native Capacitor session delivery.

## Deployment

1. Provide production environment variables through the deployment platform.
2. Run reviewed Prisma migrations before starting the application.
3. Build with `npm run build`.
4. Start with `npm start` and `NODE_ENV=production`.

Production startup fails closed when required database, JWT, or canonical URL configuration is missing.

## Capacitor

Set `VITE_API_BASE_URL` to the deployed HTTPS API origin for native builds, then run:

```sh
npm run cap:sync
```

Open the platform project with `npm run cap:open:ios` or `npm run cap:open:android`.

## App Store Review Access

The application restricts sign-in to `@comed.uobaghdad.edu.iq` institutional emails. Apple's reviewers cannot sign in with an institutional address, so the app supports an explicit, operator-vetted reviewer allowlist:

1. Set `ALLOWED_REVIEWER_EMAILS` on the backend to a comma-separated list of exact email addresses (for example `review@example.com`). Each address is deliberately trusted by the operator by being listed here — this is not a wildcard or a "anyone" bypass, and it grants no admin or owner privileges.
2. These accounts register and sign in through the normal email + password flow. Because they are trusted by configuration, they are treated as email-verified and are signed in immediately (no verification email round trip).
3. In App Store Connect, under App Review Information → Sign-in, provide the reviewer email and password for one of the allowlisted accounts.
4. Legal documents (Privacy Policy, Terms of Service, Support, Medical Disclaimer) are publicly reachable without signing in at `/privacy`, `/terms`, `/support`, and `/disclaimer`, and are linked from the sign-in screen.

Leave `ALLOWED_REVIEWER_EMAILS` unset to keep the app fully restricted to the institutional domain.

## iOS Release Configuration

### Versioning
The canonical release version is `1.0.0`, defined in `package.json` and displayed in the app (Settings and Profile screens). It must match the native build version: the Xcode project uses `MARKETING_VERSION = 1.0.0` (displayed as the App Store version) with `CURRENT_PROJECT_VERSION` as the build number. Keep all three in sync before submission.

### Google OAuth (production)
The web and native OAuth flows share the same server routes and are already Capacitor/iOS-compatible (PKCE + CSRF state, in-app browser sheet with session polling on iOS, `?oauth_done=1` return handling, and deep-link processing in `SceneDelegate`). In production the Google callback URI is pinned to the backend origin, so the Google Cloud Console must list exactly:

```
https://nine9s-guide.onrender.com/auth/callback/google
```

and the backend must have `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` set. No code change is required.

### Sign in with Apple
The app offers Google as a third-party login provider, so Apple's App Review guideline 4.8 applies and "Continue with Apple" must be available — it already is (UI button + complete server-side OAuth flow). No code change is required, but the following must be configured manually before submission, otherwise the button will fail:

- Apple Developer: enable **Sign in with Apple** for the App ID (`com.nine9sguide.app`).
- Create a **Service ID** (client ID) and a **private key** (one key may be shared), noting the Team ID, Key ID, and the Service ID value.
- Register the Service ID's callback URL as exactly `https://nine9s-guide.onrender.com/auth/callback/apple`.
- Set the backend environment variables: `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY`.

Because the app performs Sign in with Apple through a web OAuth flow (in-app browser), no native `com.apple.developer.applesignin` entitlement or Xcode capability is required.

### Push notifications
Native push (APNs/FCM) is deliberately **disabled for the current release**: the backend stores device tokens but has no APNs/FCM delivery pipeline, and registering without delivery would prompt for an unusable permission. In-app notifications are fully functional (socket.io). To enable native push later you must: implement APNs (or FCM) delivery on the backend, re-enable the `pushEnabledForRelease` flag in `src/core/device/capacitor/nativeBridge.ts`, add the `aps-environment` entitlement and an APNs key/certificate in the Apple Developer portal and Xcode, then re-run `npm run cap:sync`.

## Security Notes

- Authorization is enforced by the backend; frontend role checks only control presentation.
- Authenticated PDF and user-scoped API data must not be treated as public cacheable resources.
- Offline failures are persisted and surfaced rather than silently discarded.
- Do not use ad hoc scripts to write production-like data. Keep experiments in isolated local databases and disposable fixtures.
