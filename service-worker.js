// =====================
// service-worker.js — CR Attendance PWA
// =====================
const CACHE_VERSION = 'v4';
const CACHE_NAME    = `cr-attendance-${CACHE_VERSION}`;

const STATIC_SHELL  = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './service-worker.js'
];

// ── INSTALL: cache the app shell ──────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching app shell');
        return Promise.allSettled(STATIC_SHELL.map(url => cache.add(url)));
      })
      .then(() => {
        console.log('[SW] Install complete');
        return self.skipWaiting();
      })
  );
});

// ── ACTIVATE: clear old caches ────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating', CACHE_NAME);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k.startsWith('cr-attendance-') && k !== CACHE_NAME)
          .map(k => { console.log('[SW] Removing old cache:', k); return caches.delete(k); })
      ))
      .then(() => {
        console.log('[SW] Now controlling all clients');
        return self.clients.claim();
      })
  );
});

// ── FETCH: serve cached, fall back to network ─────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never cache Google Apps Script API calls
  if (
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('googleapis.com')
  ) {
    event.respondWith(
      fetch(event.request)
        .catch(() => new Response(
          JSON.stringify({ ok: false, error: 'offline' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        ))
    );
    return;
  }

  // Cache-first with background refresh (stale-while-revalidate)
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        const networkFetch = fetch(event.request)
          .then(response => {
            if (response && response.status === 200 && event.request.method === 'GET') {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => null);

        if (cached) return cached;

        return networkFetch.then(response => {
          if (response) return response;
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

// ── BACKGROUND SYNC ────────────────────────────────────────
self.addEventListener('sync', event => {
  console.log('[SW] Sync triggered:', event.tag);
  if (event.tag === 'sync-attendance') {
    event.waitUntil(triggerClientSync());
  }
});

async function triggerClientSync() {
  const allClients = await self.clients.matchAll({
    includeUncontrolled: true,
    type: 'window'
  });
  if (allClients.length === 0) {
    console.log('[SW] No active clients to sync');
    return;
  }
  allClients.forEach(client => {
    client.postMessage({ type: 'SW_SYNC_PENDING' });
    console.log('[SW] Sync message sent to client:', client.id);
  });
}

// ── MESSAGES from main app ─────────────────────────────────
self.addEventListener('message', event => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Skipping waiting — activating new version');
    self.skipWaiting();
  }

  if (event.data.type === 'CACHE_URLS') {
    const urls = event.data.urls || [];
    caches.open(CACHE_NAME).then(cache => cache.addAll(urls));
  }
});
