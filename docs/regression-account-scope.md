# Regression: Per-account offline data scoping never activated

## Severity

High — cross-user data leak risk + Apple Guideline 5.1.1(v) compliance
(financial data; no user data persists post-logout).

## Symptom

All personal offline caches (progress, points logs, calendar events) were
written to a single shared namespace `account:anonymous:*` for every
authenticated user, instead of `account:<userId>:*`.

## Root cause

`OfflineEngine`'s account scoping depends on `setActiveAccountId(id)` being
called when a session is established. That call was imported in `App.tsx` but
**never wired anywhere**. Because `accountStorageKey()` falls back to
`account:anonymous:` when no active account is set, every authenticated user's
data landed in the shared anonymous namespace:

- `account:anonymous:progress_db`
- `account:anonymous:points_log`
- `account:anonymous:calendar_events`
- `account:anonymous:offline_mutations_queue`
- `account:anonymous:offline_dlq`

Consequences:

1. **Cross-user leakage**: on any shared device, user B's offline fallbacks
   (e.g. `OfflineEngine.getCachedCalendarEvents()` in the calendar-fetch catch
   path, `App.tsx:1755`) read user A's cached data.
2. **No data purge on logout/self-delete**: `clearAccountData()` was never
   called by the sign-out, force-reset, or self-delete handlers, and even when
   called with no account it matched neither the scoped nor the legacy personal
   key sets for the anonymous namespace — violating 5.1.1(v).

## Fix (surgical)

1. `src/core/storage/accountData.ts` — `clearAccountData()` now always sweeps
   `account:anonymous:*` + legacy personal keys, plus the scoped prefix for the
   supplied (or active) account. Guarantees no user data survives logout even if
   it was written before scoping was established.
2. `src/App.tsx` — wire `setActiveAccountId(user.id)` at every point a session
   is established:
   - `restoreSession` server success (`/api/auth/me`)
   - `restoreSession` local SecureStorage fallback
   - OAuth popup success handler
   - iOS PWA cold-start OAuth recovery
   - OAuth redirect (`?oauth_done=1`) completion
   - `handleAuthSuccess`
   - `syncWithBackend` server response
3. `src/App.tsx` — on session teardown, null the active account and purge the
   per-account + anonymous + offline queues:
   - `handleSignOut`
   - `handleForceLocalReset`
   - `handleAccountSelfDelete`
   - session-expired event, admin forced-logout, and ban event handlers

## Verification

- `npm run typecheck` — pass
- `npx eslint src/App.tsx src/core/storage/accountData.ts` — pass
- Post-fix flow: user A logs in → caches under `account:<A>:*`; logout purges
  `account:<A>:*`, `account:anonymous:*`, legacy personal keys, and
  `BaghdadMedicalOfflineMutations` IndexedDB; user B's data is isolated.

## File map

| File | Change |
| --- | --- |
| `src/core/storage/accountData.ts` | `clearAccountData` now sweeps active + anonymous + legacy namespaces |
| `src/App.tsx` | `setActiveAccountId` wired at all 7 session-establishment points; null + purge at 6 teardown points |
