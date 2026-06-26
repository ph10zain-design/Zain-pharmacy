// ============================================================
// public/sw.js — Service Worker (online-only)
// ============================================================
// المشروع online-only: لا cache، كل شيء من الشبكة
// عند الانقطاع: ConnectionMonitor يتولى حجب الواجهة
// ============================================================

const SW_VERSION = 'v7.5';

// تنظيف كل الـ caches القديمة عند التثبيت
self.addEventListener('install', event => {
    console.log(`[SW ${SW_VERSION}] install`);
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.map(k => caches.delete(k)))
        ).then(() => self.skipWaiting())
    );
});

// السيطرة الفورية على كل الـ clients
self.addEventListener('activate', event => {
    console.log(`[SW ${SW_VERSION}] activate`);
    event.waitUntil(self.clients.claim());
});

// network-only: لا cache أبداً
self.addEventListener('fetch', event => {
    // تجاهل طلبات غير HTTP (chrome-extension، etc.)
    if (!event.request.url.startsWith('http')) return;

    event.respondWith(
        fetch(event.request).catch(() => {
            // عند فشل الشبكة: أرجع 503 بسيط
            // ConnectionMonitor يتولى عرض شاشة الحجب في الـ UI
            return new Response('offline', {
                status: 503,
                statusText: 'Service Unavailable'
            });
        })
    );
});
