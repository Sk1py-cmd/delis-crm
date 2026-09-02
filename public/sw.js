const CACHE = "delis-static-v3";
const PRECACHE = ["/manifest.json", "/manifest-agent.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

function isSafeStaticRequest(request, url) {
  if (request.method !== "GET" || url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  return request.destination === "style"
    || request.destination === "script"
    || request.destination === "font"
    || request.destination === "image"
    || request.destination === "manifest"
    || url.pathname.startsWith("/_next/static/")
    || url.pathname === "/manifest.json"
    || url.pathname === "/manifest-agent.json";
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never cache or synthesize navigation responses. Authentication-sensitive CRM
  // HTML/RSC payloads must not survive sign-out or become visible to another user.
  // The already-loaded agent UI keeps its fieldwork queue in IndexedDB instead.
  if (request.mode === "navigate" || !isSafeStaticRequest(request, url)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === "basic") {
            caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    })
  );
});
