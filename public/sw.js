// P-Flow : cache hors ligne de l'appli web (iPhone, PC).
// - Page de l'appli : réseau d'abord, copie de secours en cache.
// - Fichiers versionnés (assets/*) : cache d'abord.
// - Page de téléchargement, version.json et APK : jamais mis en cache (toujours la dernière version).
const CACHE = 'pflow-v2';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon.svg', './apple-touch-icon.png'];
const NEVER = ['telecharger.html', 'version.json', '.apk'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER.some(n => url.pathname.endsWith(n))) return;
  const isAppPage = req.mode === 'navigate' && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'));
  if (isAppPage) {
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); }
      return r;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  if (req.mode === 'navigate') return; // autres pages : comportement normal du navigateur
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return r;
  })));
});
