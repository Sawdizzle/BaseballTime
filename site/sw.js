// Makes the site installable and keeps the shell available offline.
// Tournament data is never cached here — it comes live from Supabase, and the
// page has its own short-lived cache of the last board for a fast first paint.
const CACHE = "bbtime-shell-v5";
const SHELL = [
  "/", "/index.html", "/app.webmanifest", "/icon-192.png", "/icon-512.png",
  "/fonts/bc-600.woff2", "/fonts/bc-700.woff2", "/fonts/bc-800.woff2",
  "/fonts/bsc-400.woff2", "/fonts/bsc-600.woff2", "/fonts/bsc-700.woff2", "/fonts/bsc-800.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Stale-while-revalidate for our own shell: serve the cached copy immediately
// and refresh it in the background, so a repeat visit paints without waiting on
// the network but a deploy is still picked up on the next load. The previous
// network-first order meant every visit paid a full round trip for 120 KB of
// HTML before anything appeared.
//
// Only the shell. /api/ is dynamic (the manifest and sitemap vary by Host, the
// calendar and player lookups by query), and caching those here quietly grew a
// second, unbounded copy of them in the shell cache.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/calendar.ics") return;

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(e.request);
      const fresh = fetch(e.request)
        .then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; })
        .catch(() => hit || cache.match("/index.html"));
      return hit || fresh;
    })
  );
});
