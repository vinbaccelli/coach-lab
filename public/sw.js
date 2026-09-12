// Bump CACHE_NAME on any change to the precache list or the caching rules
// below. `activate` deletes every cache whose key differs from the current one,
// so the bump is the only thing that evicts entries written by an older
// service worker. v1 ran from launch with an auth-dependent document in its
// precache list (see PRECACHE_ASSETS), so those entries are immortal until this
// name changes.
//
// v3 (2026-09-09): the catch-all at the bottom used to be
// stale-while-revalidate for EVERY same-origin request that fell through,
// which silently included unhashed files served straight out of public/ — most
// damagingly the bundled demo and court videos. `return cached || networkFetch`
// hands back the stale copy and only refreshes the cache for NEXT time, so
// re-encoding a video at the same URL left every browser that had already
// fetched it serving the old bytes indefinitely.
//
// Build output under /_next/static/ was never at risk: those filenames carry a
// content hash, so a new build is a new URL that cannot collide with a cached
// entry. Verified by rebuild — changing emitted code moved the analysis chunk
// from page-20a0462fb88eef0c.js to page-97c9b85e228d079a.js.
const CACHE_NAME = 'angle-motion-v3';
const OFFLINE_URL = '/offline.html';

// Static shell assets only — every visitor gets byte-identical responses for
// these, so a shared cache is safe.
//
// `/` is deliberately NOT precached. It is a force-dynamic, auth-dependent
// document: app/page.tsx renders the marketing landing page for logged-out
// visitors and the control panel for signed-in ones. `cache.addAll` fetches
// with `credentials: 'same-origin'`, so precaching `/` stores whichever auth
// state the installing client happened to be in and then serves it to the
// other one.
const PRECACHE_ASSETS = [
  '/offline.html',
  '/manifest.json',
  '/favicon.svg',
  '/icons/icon-192x192.svg',
  '/icons/icon-512x512.svg',
  '/icons/apple-touch-icon.svg',
];

/**
 * True for any same-origin response whose content depends on who is signed in:
 * HTML documents and Next's React Server Component payloads. None of these may
 * ever be read from or written to a shared cache — one poisoned entry serves
 * the wrong auth state to every later visit until site data is cleared.
 *
 * RSC fetches need their own test: they target the same URL as the page but
 * carry `mode: 'cors'`, so they fall straight past the `navigate` check into
 * the generic handler at the bottom of this file.
 */
function isAuthDependent(request, url) {
  if (url.origin !== self.location.origin) return false;
  if (request.mode === 'navigate' || request.destination === 'document') return true;
  if (request.headers.get('RSC')) return true;
  const accept = request.headers.get('Accept') || '';
  // text/x-component is the RSC payload content type.
  return accept.includes('text/html') || accept.includes('text/x-component');
}

// Install: precache shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and browser extensions
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) return;

  // Network-first for API routes
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .catch(() => new Response(JSON.stringify({ error: 'Offline' }), {
          headers: { 'Content-Type': 'application/json' },
        }))
    );
    return;
  }

  // Cache-first for TF.js WASM model files (large, rarely change)
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Cache-first for static assets (images, icons, fonts)
  if (
    request.destination === 'image' ||
    request.destination === 'font' ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/favicon.svg'
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Auth-dependent documents and RSC payloads: network only. Never read from
  // the cache, never written to it. A navigation that cannot reach the network
  // gets the static offline page; an RSC fetch is left to fail exactly as it
  // would with no service worker installed, so the router handles it normally.
  if (isAuthDependent(request, url)) {
    if (request.mode === 'navigate') {
      event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    }
    return;
  }

  // Media: never cached, always straight to the network.
  //
  // Three independent reasons. These files live in public/ with STABLE,
  // unhashed URLs, so a cached copy survives re-encoding the file in place and
  // there is no new URL to break the tie. Playback issues Range requests, whose
  // 206 responses the Cache API refuses to store at all. And they are large —
  // one 26 MB video would dominate the origin's storage quota and could evict
  // the shell assets that make offline work.
  if (
    request.destination === 'video' ||
    request.destination === 'audio' ||
    request.headers.has('range') ||
    /\.(mp4|mov|webm|m4v|mp3|wav|ogg)$/i.test(url.pathname)
  ) {
    return; // no respondWith → the browser performs its normal fetch
  }

  // Content-hashed build output: safe cache-first, and safe to keep forever.
  // A new build emits a new filename, so a stale entry can never shadow current
  // code — it simply becomes unreferenced and is evicted with the cache version.
  if (url.origin === self.location.origin && url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
          }
          return response;
        });
      })
    );
    return;
  }

  // Everything else — unhashed same-origin files and cross-origin requests:
  // NETWORK-FIRST. The cache is an offline fallback, never the first answer, so
  // a deploy that changes a file in place is picked up on the very next request
  // rather than the one after it.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.status !== 206) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
