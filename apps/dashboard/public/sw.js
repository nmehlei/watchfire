// Watchfire-Dashboard service worker.
// Spec 12 §PWA layer:
//   - Cache-first  for static assets (_next/static/*, icons, manifest)
//   - Network-first for /api/* (always try fresh, fall back to last cached)
//   - Stale-while-revalidate for the app shell (RSC pages)
//
// Bump CACHE_VERSION when the SW logic changes — the activate handler
// purges old versions atomically.

const CACHE_VERSION = "v1";
const STATIC_CACHE = `iris-static-${CACHE_VERSION}`;
const API_CACHE = `iris-api-${CACHE_VERSION}`;
const SHELL_CACHE = `iris-shell-${CACHE_VERSION}`;
const ALL_CACHES = [STATIC_CACHE, API_CACHE, SHELL_CACHE];

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("iris-") && !ALL_CACHES.includes(n))
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never touch Auth.js routes — the sign-in flow involves redirects,
  // cookies, and CSRF tokens that must not be cached.
  if (url.pathname.startsWith("/api/auth")) return;

  // Never touch the SSE stream — it must stay live.
  if (url.pathname === "/api/events") return;

  // Static assets — cache-first.
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.json" ||
    url.pathname === "/favicon.ico"
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // BFF API — network-first.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // Everything else (RSC pages) — stale-while-revalidate. The user sees
  // last-known content instantly; the SW refreshes in the background.
  event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    return cached || new Response("offline", { status: 503, headers: { "content-type": "text/plain" } });
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response("offline", { status: 503, headers: { "content-type": "text/plain" } });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await refresh) || new Response("offline", { status: 503, headers: { "content-type": "text/plain" } });
}
