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
//
// v4 (2026-11-03): what the worker stored was never bounded. The catch-all
// (and the cache-first rules for cdn.jsdelivr.net, images and fonts) stored
// EVERY response with no size or status check, so a returning visitor's cache
// held the pose models, the ONNX/WASM runtimes and the chunks of every deploy
// ever visited (public/models alone is 115 MB, /ort 49 MB, and one hashed
// 23 MB .wasm under /_next/static/), plus any error response a cache-first rule
// had happily stored. Nothing ever evicted any of it, and on iPhone Safari a
// cache that large is a prime suspect for the Motion Layer freeze
// (docs/MOTION_LAYER_FREEZE.md, section 12). From v4:
//   - only complete 200 responses are stored (no errors, 206, redirects,
//     empty bodies, and no opaque cross-origin responses, which cannot be
//     inspected);
//   - nothing larger than MAX_ENTRY_BYTES is stored;
//   - the coco-ssd model host is not intercepted at all;
//   - the runtime part of the cache holds at most MAX_RUNTIME_ENTRIES entries,
//     oldest evicted first.
// Bumping the name makes `activate` delete every v3 entry.
const CACHE_NAME = 'angle-motion-v4';
const OFFLINE_URL = '/offline.html';

/**
 * The largest single response the worker will store. Every JS and CSS chunk the
 * app ships is under 520 KB uncompressed (largest: the analysis page chunk,
 * 515 KB at the time of writing), so 1 MiB keeps all of them and everything
 * else that makes the shell work offline, and refuses every model and WASM
 * runtime (the smallest is 6 MB) and media file.
 *
 * Size is read from the Content-Length header when there is one (the wire size;
 * a compressed response is smaller than what it unpacks to, which is
 * acceptable at this margin). A response that declares no length is measured by
 * reading a clone of it, stopping at the limit. An opaque response (a no-cors
 * cross-origin fetch) has status 0 and no readable headers or body, so its
 * size and its success cannot be known: it is never stored.
 */
const MAX_ENTRY_BYTES = 1024 * 1024;

/**
 * At most this many runtime entries (everything except the precached shell).
 * One full production build is about 175 files under /_next/static/, so this
 * holds one build and not two: when a deploy changes the chunk names, the
 * previous build's chunks are evicted oldest first as the new ones arrive.
 * Worst case (every entry at the 1 MiB limit) is 200 MiB; a real build is under
 * 10 MB because the one big file in it, the 23 MB ORT WASM, is not stored.
 */
const MAX_RUNTIME_ENTRIES = 200;

/**
 * Hosts whose requests the worker does not touch at all: the browser fetches
 * them itself. storage.googleapis.com serves the 68 MB COCO-SSD model; proxying
 * it through the worker only risked buffering it, and it must never be stored.
 */
const BYPASS_HOSTS = ['storage.googleapis.com'];

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

/** Why a response may or may not be stored: 'store', 'measure' (declares no size) or 'skip'. */
function classifyResponse(response) {
  if (!response) return 'skip';
  // Opaque (status 0), errors, redirects, 206 partial content and every non-200:
  // never stored. `ok` alone is not enough — it also admits 201..299.
  if (response.status !== 200) return 'skip';
  if (response.type === 'opaque' || response.type === 'opaqueredirect' || response.type === 'error') return 'skip';
  const header = response.headers && response.headers.get('Content-Length');
  if (header !== null && header !== undefined && header !== '') {
    const declared = Number(header);
    if (Number.isFinite(declared)) return declared > 0 && declared <= MAX_ENTRY_BYTES ? 'store' : 'skip';
  }
  return response.body ? 'measure' : 'skip';
}

/** Read `response` (a clone) and say whether its body is non-empty and within the limit. Stops reading at the limit. */
async function bodyWithinLimit(response) {
  const reader = response.body && response.body.getReader ? response.body.getReader() : null;
  if (!reader) return false;
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value ? value.byteLength : 0;
      if (total > MAX_ENTRY_BYTES) {
        reader.cancel().catch(() => {});
        return false;
      }
    }
  } catch (_) {
    return false;
  }
  return total > 0;
}

/** Keep at most `max` runtime entries; the precached shell is never evicted. Oldest first (Cache.keys() is in insertion order). */
async function trimCache(cache, max) {
  const keys = await cache.keys();
  const shell = new Set(PRECACHE_ASSETS);
  const runtime = keys.filter((req) => {
    try {
      return !shell.has(new URL(req.url).pathname);
    } catch (_) {
      return true;
    }
  });
  const excess = runtime.length - max;
  for (let i = 0; i < excess; i++) await cache.delete(runtime[i]);
}

/**
 * Decide, then store, a response for `request`. Call it synchronously from the
 * fetch handler with the ORIGINAL response (it clones before the body is
 * used); pass the returned promise to event.waitUntil. Never throws.
 */
function storeIfAllowed(request, response) {
  const verdict = classifyResponse(response);
  if (verdict === 'skip') return Promise.resolve(false);
  const forCache = response.clone();
  const probe = verdict === 'measure' ? response.clone() : null;
  return (async () => {
    try {
      if (probe && !(await bodyWithinLimit(probe))) {
        if (forCache.body) forCache.body.cancel().catch(() => {});
        return false;
      }
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, forCache);
      await trimCache(cache, MAX_RUNTIME_ENTRIES);
      return true;
    } catch (_) {
      return false;
    }
  })();
}

/** Store without ever affecting the response that goes back to the page. */
function storeInBackground(event, request, response) {
  try {
    event.waitUntil(storeIfAllowed(request, response));
  } catch (_) {
    /* the page still gets its response */
  }
}

/** Delete every cache whose name is not the current one (old versions, anything else on the origin). */
function deleteOldCaches() {
  return caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
  );
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
  event.waitUntil(deleteOldCaches());
  self.clients.claim();
});

// Fetch: cache strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and browser extensions
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) return;

  // Large third-party model hosts: not intercepted, not stored.
  if (BYPASS_HOSTS.includes(url.hostname)) return;

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
          storeInBackground(event, request, response);
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
          storeInBackground(event, request, response);
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
          storeInBackground(event, request, response);
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
        storeInBackground(event, request, response);
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// Test hook only: a service worker global has no `module`, so this never runs there.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CACHE_NAME, MAX_ENTRY_BYTES, MAX_RUNTIME_ENTRIES, BYPASS_HOSTS, PRECACHE_ASSETS,
    classifyResponse, bodyWithinLimit, trimCache, storeIfAllowed, storeInBackground, deleteOldCaches,
  };
}
