/* Service worker — PWA Vérification QR SYDONIA
   Stratégie : RÉSEAU D'ABORD pour toute l'interface (une nouvelle version publiée est donc vue au prochain chargement),
   cache seulement en secours hors connexion. Les appels Apps Script (autre origine) ne sont jamais interceptés.
   Pour forcer le renouvellement du cache : changer VERSION (et le ?v= dans index.html). */
const VERSION = "2026-11-15-1";
const PREFIX = "sydonia-verif-qr-";
const CACHE = PREFIX + VERSION;
const SHELL = ["./", "./index.html", "./styles.css", "./config.js", "./app.js", "./vendor/jsQR.js", "./manifest.webmanifest", "./fonts/dm-sans-400.woff2", "./fonts/dm-sans-700.woff2", "./assets/logo-64.png", "./assets/logo-128.png", "./assets/icon-192.png", "./assets/icon-512.png", "./assets/icon-maskable-192.png", "./assets/icon-maskable-512.png", "./assets/apple-touch-icon.png", "./assets/favicon.ico", "./assets/favicon-32.png", "./assets/favicon-16.png"];
const isOurs = (k) => k.startsWith("extractor-qr-") || k.startsWith("sydonia-verif-qr-");   // ne supprime que les caches de CETTE application

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((u) => cache.add(new Request(u, { cache: "reload" })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && isOurs(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => { if (event.data === "SKIP_WAITING") self.skipWaiting(); });

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // Apps Script, polices externes : jamais interceptés
  if (url.pathname.endsWith("/service-worker.js")) return;   // toujours frais

  // Une seule entrée de cache par fichier (adresse sans paramètres ?v=...) : le dernier contenu reçu remplace toujours l'ancien.
  const key = req.mode === "navigate" ? "./index.html" : (() => { const u = new URL(req.url); u.search = ""; u.hash = ""; return u.href; })();
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(req, { cache: "no-cache" });
      if (fresh && fresh.ok && fresh.type === "basic") cache.put(key, fresh.clone()).catch(() => {});
      return fresh;
    } catch (err) {
      const hit = await cache.match(key);
      if (hit) return hit;
      return new Response("Hors connexion et ressource non disponible en cache.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  })());
});
