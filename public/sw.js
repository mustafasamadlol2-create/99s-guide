/**
 * 99's Guide — Production Service Worker
 *
 * Strategy:
 *   • Static assets  → Cache-First, dynamic population
 *   • HTML navigation → Network-First, cache fallback
 *   • API / socket.io / uploads / PDFs → always Network (never cached)
 *   • Everything else → Network-First, cache fallback
 *
 * Cache versioning guarantees stale caches from prior versions are
 * deleted during the activate phase — no infinite cache growth.
 */

const CACHE_VERSION = 'v1.3.0';
const CACHE_NAME = `app-shell-${CACHE_VERSION}`;

// Minimal app shell pre-cached at install time.
// Vite-hashed assets are populated dynamically on first fetch.
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/favicon-32x32.png',
  '/favicon-16x16.png',
  '/icon-192.png',
  '/icon-512-maskable.png',
  '/apple-touch-icon.png',
];

// ─── 1. INSTALL ───────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => {
        // Pre-cache failure is non-fatal; assets are cached on first fetch.
      })
  );
});

// ─── 2. ACTIVATE ─────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Enable navigation preload — speeds up repeat navigation by starting
      // the network request during SW startup, before fetch() is called.
      if ('navigationPreload' in self.registration) {
        try { await self.registration.navigationPreload.enable(); } catch (_) {}
      }
      // Clear old versioned caches
      const names = await caches.keys();
      await Promise.all(
        names.map((name) => {
          if (name !== CACHE_NAME) return caches.delete(name);
        })
      );
      await self.clients.claim();
    })()
  );
});

// ─── 3. FETCH ────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET; let POST/PUT/DELETE/PATCH pass through untouched.
  if (request.method !== 'GET') return;

  // ── Passthrough list — never cache these ──────────────────────────────────

  // API calls: authenticated, user-specific, must always be fresh.
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Socket.io: WebSocket upgrades and polling must not be intercepted.
  if (url.pathname.startsWith('/socket.io/')) {
    return;
  }

  // Uploaded user files: never serve stale user-generated content.
  if (url.pathname.startsWith('/uploads/')) {
    return;
  }

  // PDFs: reserved for Phase 2 offline caching — pass through for now.
  if (url.pathname.endsWith('.pdf')) {
    return;
  }

  // Authentication callbacks and reset pages may contain one-time codes or
  // session-bearing responses. Never place them in Cache Storage.
  if (url.pathname.startsWith('/auth/callback') ||
      url.pathname.startsWith('/auth/') ||
      url.pathname.startsWith('/reset-password') ||
      url.searchParams.has('oauth_done') ||
      url.searchParams.has('oauth_error') ||
      url.searchParams.has('token')) {
    return;
  }

  // Cross-origin requests: don't interfere with external resources.
  if (url.origin !== self.location.origin) {
    return;
  }

  // ── Static assets: Cache-First ────────────────────────────────────────────
  const isStaticAsset =
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/fonts/') ||
    url.pathname.startsWith('/emojis/') ||
    /\.(js|css|woff2?|png|jpe?g|webp|gif|ico|svg)$/.test(url.pathname);

  if (isStaticAsset) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // ── HTML navigation: Network-First, cached shell fallback ─────────────────
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        // Use preload response if available (started during SW startup)
        let response;
        try {
          response = await event.preloadResponse;
        } catch (_) {
          response = undefined;
        }
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        }
        // Fallback to direct fetch
        try {
          response = await fetch(request);
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        } catch (_) {
          // Offline fallback — try cached shell
          const cached = await caches.match('/');
          return cached || caches.match('/index.html');
        }
      })()
    );
    return;
  }

  // ── Default: Network-First, cache fallback ────────────────────────────────
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Cache-First strategy.
 * Returns the cached response immediately if present; otherwise fetches from
 * the network, caches a successful response, and returns it.
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const clone = response.clone();
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, clone);
    }
    return response;
  } catch {
    // No network and no cache — return an empty offline response.
    return new Response('', { status: 503, statusText: 'Service Unavailable' });
  }
}

// ─── 4. MESSAGE — controlled update trigger ───────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
