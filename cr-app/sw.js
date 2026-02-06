// Service Worker - CR Attendance App
// Handles offline caching, background sync, and network resilience

const CACHE_NAME = 'cr-attendance-v1';
const CACHE_URLS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
];

// Install Event - Cache critical assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching files');
      return cache.addAll(CACHE_URLS);
    })
  );
  self.skipWaiting();
});

// Activate Event - Clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event - Cache-first strategy with network fallback
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip external APIs (let them fail gracefully in app)
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(request).then((response) => {
      // Return from cache if available
      if (response) {
        console.log('[SW] Serving from cache:', url.pathname);
        return response;
      }

      // Otherwise, fetch from network
      return fetch(request)
        .then((response) => {
          // Cache successful responses
          if (response && response.status === 200 && response.type !== 'error') {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch((error) => {
          // Return offline fallback if needed
          console.log('[SW] Network failed, serving from cache or offline:', error);
          return caches.match(request) || new Response('Offline', { status: 503 });
        });
    })
  );
});

// Background Sync Event - Sync pending submissions when online
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-attendance') {
    event.waitUntil(syncPendingSubmissions());
  }
});

async function syncPendingSubmissions() {
  console.log('[SW] Syncing pending submissions...');
  // TODO: Implement background sync of queued submissions
  // This will be called when device comes back online
}

// Push Notification Event (for future use)
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    self.registration.showNotification(data.title || 'CR Attendance', {
      body: data.body || 'New notification',
      icon: './manifest.json',
      badge: './manifest.json',
    });
  }
});

console.log('[SW] Service Worker loaded');
