# 99's Guide — Performance Audit & Conservative Optimization Report

Date: 2026-08-24
Baseline: `99s-guide-storage-only(1).zip`
Scope: performance, responsiveness, code maintainability, PWA/offline stability, PDF/Storage preservation. No visual redesign and no intentional behavior change.

## Executive summary

The app already had several good performance foundations: Vite route splitting, vendor/UI/realtime chunks, API request caching, request retries, socket realtime updates, IndexedDB/offline stores, service-worker navigation preload, and Prisma query `select` usage in important endpoints.

The largest practical bottlenecks found were not animation or CSS. They were redundant/oversized data transfers, unnecessary database work, aggressive background prefetching, fragile offline health handling, repeated YouTube iframe work, oversized launch assets, and maintainability risks caused by very large modules and an App/Bulletin circular type dependency.

This pass deliberately avoids a full rewrite of `server.ts`, `App.tsx`, or authentication/offline/PDF architecture. The goal is to obtain real performance wins while keeping regression risk low.

## Baseline hotspots

### 1. `/api/materials` was too expensive for every caller — HIGH
The endpoint could query and merge up to 2,000 lectures, 2,000 MCQs, 2,000 flashcards, 2,000 materials, and 2,000 public calendar events, then return subjects + MCQs + flashcards + videos + calendar data as one payload.

The dashboard only needs the subject hierarchy. The offline synchronizer only needs MCQs/flashcards. Loading the entire combined payload for both is unnecessary network, JSON parsing, memory allocation, and database work.

**Fix:** Added two backwards-compatible scopes to the existing endpoint:
- `/api/materials?scope=subjects` -> subject hierarchy only, and only lecture/material relational queries.
- `/api/materials?scope=offline` -> MCQs + flashcards only, and only those relational queries.
- Existing `/api/materials` remains full response for compatibility.

The main dashboard now uses `scope=subjects`; DataSyncManager uses `scope=offline`.

### 2. App startup performed redundant API warmups — HIGH
`App.tsx` already refreshes academic data and starts offline synchronization after login. A second idle-preload block then warmed `/api/materials`, `/api/lectures`, `/api/calendar/events`, `/api/notifications`, and `/api/users` again.

This creates avoidable network traffic and server/DB pressure shortly after startup. `/api/users` is particularly unnecessary for most normal users.

**Fix:** Kept route/component preloading but removed the redundant API warmup block. Existing data refresh/caching remains responsible for data freshness.

### 3. One transient web health-check failure could mark the whole app offline — HIGH
The PWA health ping ran periodically and immediately switched the app to offline state after one failed request. Temporary Wi-Fi handoffs, browser scheduling, or a brief Render hiccup can therefore create a false offline banner even when the connection returns immediately.

**Fix:**
- Native iOS/Android continues to use Capacitor Network.
- Web health pings use an 8-second timeout, no retry storm, and require **two consecutive ping failures** before switching the app to offline.
- A successful ping resets the failure counter immediately.
- Explicit browser `offline` events still take effect immediately.

### 4. DataSync could destroy PWA caches after one malformed response — CRITICAL STABILITY
If `/api/materials` JSON parsing failed, DataSyncManager deleted Cache Storage and unregistered every service worker. A temporary backend/proxy response could therefore turn a recoverable network issue into a broken PWA/offline state.

**Fix:** A malformed response now keeps the last known-good offline data. It does **not** delete caches and does **not** unregister the service worker.

### 5. Upload timeout was too short for 50 MB Storage uploads — MEDIUM/HIGH
The generic upload timeout was 30 seconds. That is too aggressive for a 50 MB PDF on mobile networks and can abort a valid Supabase Storage upload from the client side.

**Fix:** Upload timeout is now 120 seconds. Normal API requests stay at 15 seconds.

### 6. Request coalescing could affect mutations — CORRECTNESS/PERFORMANCE
The request in-flight map was keyed for all methods. Request deduplication is useful for identical GETs but should not coalesce POST/PATCH/DELETE operations.

**Fix:** Pending-request coalescing now applies to GET requests only. Mutations are always independent.

### 7. Launch-screen images were very large — HIGH COLD-START ASSET COST
Baseline public assets:
- `Dark_mode.png`: ~1.24 MB
- `Light_mode.png`: ~625 KB
- unused `test-light.png`: ~1.11 MB

**Fix:** Converted the two launch images to visually equivalent WebP assets:
- `Dark_mode.webp`: ~89 KB
- `Light_mode.webp`: ~103 KB

The unused test image was removed. LaunchScreen now references the WebP files. This cuts roughly 1.67 MB from the two live splash assets alone and reduces the packaged public directory substantially.

### 8. Every VideoCard could independently load/poll YouTube iframe API and create a hidden player — HIGH ON VIDEO-HEAVY LECTURES
The original VideoCard created a hidden YouTube player per card just to obtain duration. Multiple cards could also append the YouTube iframe API script while it was still loading.

**Fix:**
- One shared YouTube iframe API loader per page.
- Duration work starts only when the card approaches the viewport (IntersectionObserver with pre-load margin).
- Hidden players are cleaned up deterministically.
- Existing thumbnail, duration display, and tap/open behavior remain unchanged.

### 9. Circular dependency `App.tsx` <-> `BulletinCenter.tsx` — MAINTAINABILITY/BUILD GRAPH
`BulletinCenter` imported the `AppNotification` type from `App.tsx`, while `App.tsx` lazy-loads BulletinCenter.

**Fix:** `AppNotification` moved to `src/core/types.ts`; both modules import it from the shared type layer. This removes the cycle without changing runtime behavior.

## Safe code splitting performed

The project contains very large files:
- `server.ts`: ~8.7k lines
- `App.tsx`: ~5.1k lines
- `LectureDetailView.tsx`: ~3.4k lines before this pass
- `AuthScreen.tsx`: ~2.3k lines

A blind split of these files is dangerous and does not automatically improve runtime speed. This pass therefore extracts only leaf-level units with clear boundaries:

1. `src/core/routing/appLazyRoutes.ts`
   - owns lazy route declarations and route preloading
   - removes route-loader setup from `App.tsx`

2. `src/features/lectures/components/VideoCard.tsx`
   - extracts the self-contained video card from `LectureDetailView.tsx`
   - also contains the optimized shared YouTube API loader

3. `AppNotification` moved to `src/core/types.ts`
   - removes App/Bulletin module cycle

The existing `server/services/supabaseStorage.ts` from the Storage-only baseline remains intact and was not folded back into `server.ts`.

After this pass:
- `App.tsx`: ~5,143 -> ~5,070 lines
- `LectureDetailView.tsx`: ~3,378 -> ~3,215 lines

A complete decomposition of `server.ts` and `App.tsx` should be a separate refactor phase after device/PWA regression testing. The recommended target architecture is listed below.

## Files intentionally NOT changed

The pass does not modify the core native bridge, Capacitor configuration, Supabase Storage service semantics, PDF signed-URL resolver, authentication logic, calendar UI, subject UI, home visual design, or existing iOS native project sources.

This is deliberate because the user specifically reported prior regressions in Splash, Offline, and PDF behavior after broad refactoring.

## Recommended next structural refactor (after this ZIP passes device testing)

### `server.ts`
Split by route domain, preserving the same Express app and middleware contracts:
- `server/routes/auth.ts`
- `server/routes/lectures.ts`
- `server/routes/materials.ts`
- `server/routes/calendar.ts`
- `server/routes/notifications.ts`
- `server/routes/qa.ts`
- `server/routes/moderation.ts`
- `server/routes/users.ts`
- `server/socket/registerSocketHandlers.ts`
- `server/middleware/auth.ts`
- `server/services/*`

Do this incrementally, one route family at a time, with endpoint contract tests after each move.

### `App.tsx`
Split stateful domains rather than arbitrary line ranges:
- `useAuthSession()`
- `useAcademicData()`
- `useRealtimeSync()`
- `useNotifications()`
- `useNavigationState()`
- `useOfflineSync()`
- layout shells for desktop/mobile

This is primarily maintainability work; runtime gains should come from narrower subscriptions and fewer parent-level state updates, not from file count itself.

### `LectureDetailView.tsx`
Later candidates:
- PDF/notes section
- MCQ section
- flashcard section
- Q&A section
- video section

These should be memoized/lazy-loaded by active tab only after regression coverage is in place.

## Validation performed in this environment

- Existing security contract script: **PASS (13 checks)**.
- TypeScript syntax/transpile parsing of every modified critical TS/TSX file: **PASS**.
- Full dependency-based `npm ci`, full typecheck, full Vite production build, and device runtime testing could not be completed in this sandbox because dependency installation timed out. No claim is made that those environment-dependent checks passed here.

The uploaded ZIP did not contain `node_modules`; the final ZIP also omits it. The user should run the normal clean install/build locally before Capacitor sync.

## User regression checklist

Test both PWA and Capacitor:
1. Login/logout and account restoration.
2. Splash exits correctly in light and dark mode.
3. No false offline banner while network is working.
4. Toggle Wi-Fi/airplane mode and verify offline/online transition.
5. Dashboard/subject/lecture counts load normally.
6. Open PDF and Notes from an old DB-backed material.
7. Upload/open/delete a new Supabase Storage PDF under 50 MB.
8. YouTube opens exactly once and duration appears when video cards are near viewport.
9. Calendar updates/realtime updates.
10. Notifications/Bulletin navigation.
11. Admin lecture/material selectors.
12. Background/resume the iOS app and verify reconnect without duplicate requests or offline state.

## Expected practical impact

Most noticeable improvements should be:
- less data transferred and parsed on dashboard startup;
- fewer startup/background requests;
- lower DB work for materials synchronization;
- dramatically lighter launch artwork;
- fewer hidden YouTube iframe players and duplicate script loads;
- more stable online/offline state;
- safer large PDF uploads;
- cleaner module graph for future development.

The exact percentage improvement depends on production dataset size, Render latency, Supabase latency, device, and network. Device/PWA measurements should be taken by the user after deployment rather than invented from static analysis.
