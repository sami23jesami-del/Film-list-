/* Film Liste : fonctionnement hors ligne.
   L'app elle-même est servie depuis le cache (mise à jour en arrière-plan),
   les polices et couvertures sont gardées en cache, les API (TMDB, TVmaze, iTunes) passent toujours par le réseau. */
const VERSION = 'v9';
const SHELL = 'fl-shell-' + VERSION, RUNTIME = 'fl-runtime-' + VERSION;
const SHELL_FILES = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('fl-') && k !== SHELL && k !== RUNTIME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName), keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (['api.themoviedb.org', 'api.tvmaze.com', 'itunes.apple.com', 'fr.wikipedia.org', 'en.wikipedia.org', 'www.wikidata.org', 'query.wikidata.org', 'v3.sg.media-imdb.com', 'api.github.com'].includes(url.hostname)) return; // toujours en direct

  // Pages et fichiers de l'app : réponse immédiate depuis le cache, mise à jour en arrière-plan
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const key = req.mode === 'navigate' ? './index.html' : req;
      const cached = await cache.match(key, { ignoreSearch: true });
      const network = fetch(req, { cache: 'no-cache' }).then(res => { if (res.ok) cache.put(key, res.clone()); return res; }).catch(() => null);
      // Ouverture de l'app : version en ligne d'abord (3 s max), sinon la copie hors ligne
      if (req.mode === 'navigate' && cached) {
        const fresh = await Promise.race([network, new Promise(r => setTimeout(() => r(null), 3000))]);
        if (fresh) return fresh;
        e.waitUntil(network); return cached;
      }
      if (cached) { e.waitUntil(network); return cached; }
      return (await network) || new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })());
    return;
  }

  // Polices Google et couvertures : cache d'abord
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) || req.destination === 'image') {
    e.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') { cache.put(req, res.clone()); e.waitUntil(trim(RUNTIME, 400)); }
        return res;
      } catch (err) { return cached || Response.error(); }
    })());
  }
});
