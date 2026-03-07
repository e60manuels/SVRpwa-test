const CACHE_NAME = 'svr-pwa-cache-v0.2.22';
const MAP_CACHE_NAME = 'svr-pwa-map-tiles';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './offline.html',
  './css/local_style.css',
  './css/custom_styles.css',
  './css/MarkerCluster.css',
  './css/MarkerCluster.Default.css',
  './js/local_app.js',
  './js/leaflet.markercluster.js',
  './fonts/befalow.ttf',
  './assets/Woonplaatsen_in_Nederland.csv',
  './assets/campsites_preset.json',
  './icons/icon-192.webp',
  './icons/icon-512.png',
  'https://code.jquery.com/jquery-3.6.0.min.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/fontawesome.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/solid.min.css',
  'https://unpkg.com/swiper/swiper-bundle.min.css',
  'https://unpkg.com/swiper/swiper-bundle.min.js'
];

// Install event - caching assets
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Forceer de nieuwe SW om direct actief te worden
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('SW: Caching assets');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Activate event - cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME && cache !== MAP_CACHE_NAME) {
            console.log('SW: Clearing old cache');
            return caches.delete(cache);
          }
        })
      );
    }).then(() => {
      return self.clients.claim(); // Forceer de nieuwe SW om direct controle te nemen
    })
  );
});

// Fetch event - network first for index.html, cache-first for other static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const PROXY_BASE_URL_HOSTNAME = 'svr-proxy-worker.e60-manuels.workers.dev'; // Replace with your actual worker hostname

  // Skip Service Worker for requests to the Cloudflare Worker proxy or any API endpoint
  if (url.hostname === PROXY_BASE_URL_HOSTNAME || url.pathname.includes('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Map Tiles strategy (Cache-first)
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(MAP_CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((response) => {
          return response || fetch(event.request).then((networkResponse) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        });
      })
    );
    return;
  }

  // Robust Strategy for App Shell (index.html)
  // This ensures the app shell loads offline even in subdirectories
  const isAppShell = event.request.mode === 'navigate' || 
                     url.pathname.endsWith('/index.html') || 
                     (url.origin === location.origin && url.pathname.endsWith('/'));

  if (isAppShell) {
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, networkResponse.clone()); // Update cache
            return networkResponse;
          });
        })
        .catch(() => {
          // If network fails, try to serve the ROOT of the app from cache
          return caches.match('./index.html').then(response => {
            return response || caches.match('./').then(rootResponse => {
                return rootResponse || caches.match('./offline.html');
            });
          });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      // Cache-first strategy for other static assets
      return response || fetch(event.request).catch((error) => {
        // For image/script requests that fail and are not in cache
        throw error;
      });
    })
  );
});
