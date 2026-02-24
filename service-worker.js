// CR Attendance PWA — Service Worker v5
// KEY FIX: GAS/Google API calls are NOT intercepted — browser handles them natively
// This prevents false 'offline' errors during login when SW mishandles redirects

const CACHE_NAME = 'cr-attendance-v5';
const APP_SHELL  = ['/', './index.html', './manifest.json', './icon.svg'];

// ── INSTALL: cache app shell ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW v5] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: clear old caches ────────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW v5] Activating, clearing old caches...');
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW v5] Deleting old cache:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // ✅ NEVER intercept GAS or any Google API / CDN calls
  // Let the browser handle them natively — no SW interference
  if (
    url.hostname.includes('script.google.com')      ||
    url.hostname.includes('googleapis.com')          ||
    url.hostname.includes('googleusercontent.com')   ||
    url.hostname.includes('accounts.google.com')
  ) {
    // Returning without event.respondWith() = browser falls through to native fetch
    return;
  }

  // App shell: stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(event.request).then(cached => {
        const fresh = fetch(event.request)
          .then(res => {
            if (res && res.status === 200 && res.type !== 'opaque') {
              cache.put(event.request, res.clone());
            }
            return res;
          })
          .catch(() => cached); // if network fails, fall back to cache
        return cached || fresh;
      })
    )
  );
});

// ── MESSAGES ──────────────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW v5] Skip waiting — activating immediately');
    self.skipWaiting();
  }
});

// ── BACKGROUND SYNC ───────────────────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-attendance') {
    console.log('[SW v5] Background sync triggered');
    event.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(client =>
          client.postMessage({ type: 'SW_SYNC_PENDING' })
        )
      )
    );
  }
});
