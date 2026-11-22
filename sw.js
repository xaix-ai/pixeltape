// PIXELTAPE service worker — makes the website installable, lets it open offline,
// and powers the "✨ new update — REFRESH" message.
//
// How updates reach people: every Netlify deploy stamps a new BUILD into this file
// (see netlify.toml). The browser notices the file changed, downloads the new version
// in the background, and the page offers a REFRESH button. Nothing to do by hand.
const BUILD = "__BUILD__";
const CACHE = `pixeltape-${BUILD}`;
const CORE = [
  "./",
  "index.html",
  "style.css",
  "script.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/logo.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-64.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)));
  // No skipWaiting here: the page asks the listener first (the REFRESH button).
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("pixeltape-") && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

// the page sends this when someone presses REFRESH
self.addEventListener("message", event => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (request.headers.has("range")) return;                 // audio streaming: let the browser handle it
  if (url.hostname.endsWith("cloudflareinsights.com")) return; // analytics: never cache
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (url.origin !== self.location.origin && !isFont) return;

  // cache first (fast, works offline); anything new gets saved for next time
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: request.mode === "navigate" });
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok || response.type === "opaque") {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      if (request.mode === "navigate") return caches.match("index.html");
      throw error;
    }
  })());
});
