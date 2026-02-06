// =====================================================
// SERVICE WORKER - PWA Offline Support
// =====================================================

const CACHE_NAME = 'cr-attendance-v1';
const urlsToCache = [
  './',
  './index.html',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js'
];

// Install event - cache files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('✅ Service Worker: Files cached');
      return cache.addAll(urlsToCache).catch(() => {
        console.log('⚠️ Some files could not be cached (network issue)');
      });
    })
  );
  self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - Network first, fallback to cache
self.addEventListener('fetch', event => {
  // Skip non-http(s) requests (chrome-extension, etc.)
  if (!event.request.url.startsWith('http')) {
    return;
  }
  
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Return cached version if offline
        return caches.match(event.request).then(response => {
          if (response) {
            console.log('📦 Serving from cache:', event.request.url);
            return response;
          }
          // Return offline page if available
          return caches.match('./index.html');
        });
      })
  );
});
