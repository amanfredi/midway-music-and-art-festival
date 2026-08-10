const VERSION = '__VERSION__';
const CACHE = `circuit-map-${VERSION}`;
const PRECACHE = __PRECACHE__;

const INDEX_URL = new URL('./index.html', self.registration.scope).href;
const CONTENT_URL = new URL('./data/content.json', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache:'reload' bypasses the HTTP cache so a new worker version precaches fresh bytes
    await cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('circuit-map-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// Stale-while-revalidate for content.json: cached copy answers instantly (or at
// all, offline); a background refetch updates the cache and tells open pages.
// `cached` must be a clone: respondWith consumes the original's body, so
// reading it here throws once the refetch lands, and the catch below would
// swallow that along with the update message.
async function revalidateContent(cache, cached) {
  try {
    const fresh = await fetch(CONTENT_URL, { cache: 'no-cache' });
    if (!fresh.ok) return;
    const freshText = await fresh.clone().text();
    const cachedText = cached ? await cached.text() : null;
    await cache.put(CONTENT_URL, fresh);
    if (cachedText !== null && cachedText !== freshText) {
      for (const client of await self.clients.matchAll()) {
        client.postMessage({ type: 'content-updated' });
      }
    }
  } catch {
    /* offline — the cached copy stands */
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations (including with query strings like the ?t= demo clock) get the
  // cached app shell, so a tab reload works instantly with no network.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE)
        .then((cache) => cache.match(INDEX_URL))
        .then((cached) => cached ?? fetch(request)),
    );
    return;
  }

  if (url.href === CONTENT_URL) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(CONTENT_URL);
      const revalidation = revalidateContent(cache, cached?.clone());
      if (cached) {
        event.waitUntil(revalidation);
        return cached;
      }
      await revalidation;
      return (await cache.match(CONTENT_URL)) ?? Response.error();
    })());
    return;
  }

  // Everything else: cache-first. Deploys propagate by version bump — new site
  // bytes produce a new generated sw.js, whose install precaches everything fresh.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
