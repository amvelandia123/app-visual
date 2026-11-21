// Service worker de Laboratorio Visual (ARCHITECTURE §16.4).
// El bloque entre marcadores lo genera `npm run pwa:sync`; no se edita a mano.

// <precache>
const CACHE_VERSION = '7476e5b0';
const PRECACHE = [
  './',
  'css/base.css',
  'css/fonts.css',
  'css/git.css',
  'css/layout.css',
  'css/pwa.css',
  'fonts/OFL.txt',
  'fonts/jetbrains-mono-latin-400-normal.woff2',
  'fonts/jetbrains-mono-latin-500-normal.woff2',
  'fonts/jetbrains-mono-latin-700-normal.woff2',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'icons/icon-maskable.svg',
  'icons/icon.svg',
  'index.html',
  'js/core/controller.js',
  'js/main.js',
  'js/modules/git/data.js',
  'js/modules/git/engine.js',
  'js/modules/git/index.js',
  'js/modules/git/parser.js',
  'js/modules/git/projection.js',
  'js/modules/git/view.js',
  'js/pwa/platform.js',
  'js/pwa/register.js',
  'js/ui/animator.js',
  'js/ui/app.js',
  'js/ui/console.js',
  'js/ui/explain.js',
  'js/ui/install.js',
  'js/ui/stepper.js',
  'manifest.webmanifest',
];
// </precache>

const CACHE_PREFIX = 'labvisual-';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

// Resuelve una ruta de la precaché contra el alcance del SW (funciona bajo /app-visual/ y en la raíz).
const toUrl = (path) => new URL(path, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // `cache: 'reload'` evita copias viejas de la caché HTTP.
    await Promise.all(PRECACHE.map(async (path) => {
      const response = await fetch(new Request(toUrl(path), { cache: 'reload' }));
      if (!response.ok) throw new Error(`No se pudo precachear ${path}: ${response.status}`);
      await cache.put(toUrl(path), response);
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match(toUrl('index.html'), { cacheName: CACHE_NAME });
      if (cached) return cached;
      return fetch(request);
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request, { cacheName: CACHE_NAME, ignoreSearch: true });
    return cached || fetch(request);
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (data.type === 'GET_VERSION') {
    event.source?.postMessage({ type: 'VERSION', version: CACHE_VERSION });
  }
});
