/* ════════════════════════════════════════════════
   SERVICE WORKER — مخزون الصيدلية v5.4.0
   مستشفى الشطرة العام
   ————————————————————————————————————————————————
   ⚠️  عند كل deploy مهم: غيّر رقم CACHE_VERSION
   ════════════════════════════════════════════════ */

const CACHE_VERSION = 'pharmacy-v5.4.0';
const CACHE_NAME    = `pharmacy-${CACHE_VERSION}`;

const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

const CDN_URLS = [
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await Promise.allSettled(
        [...PRECACHE, ...CDN_URLS].map(url =>
          cache.add(url).catch(err => console.warn('[SW] فشل كاش:', url, err.message))
        )
      );
      console.log('[SW] تم التثبيت:', CACHE_VERSION);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k.startsWith('pharmacy-') && k !== CACHE_NAME)
            .map(k => { console.log('[SW] حذف قديم:', k); return caches.delete(k); })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = event.request.url;
  if (event.request.method !== 'GET') return;
  if (url.includes('firestore.googleapis.com') ||
      url.includes('securetoken.googleapis.com') ||
      url.includes('identitytoolkit.googleapis.com') ||
      url.startsWith('chrome-extension://')) return;

  if (url.includes('cdn.jsdelivr.net') || url.includes('gstatic.com/firebasejs')) {
    event.respondWith(cacheFirst(event.request));
    return;
  }
  event.respondWith(networkFirst(event.request));
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(CACHE_NAME)).put(req, res.clone());
    return res;
  } catch { return new Response('غير متاح', { status: 503 }); }
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(CACHE_NAME)).put(req, res.clone());
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    if (req.mode === 'navigate') {
      const idx = await caches.match('/index.html');
      if (idx) return idx;
    }
    return new Response('{"error":"offline"}', { status: 503, headers: {'Content-Type':'application/json'} });
  }
}

self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'GET_VERSION')
    event.source?.postMessage({ type: 'SW_VERSION', version: CACHE_VERSION });
});
