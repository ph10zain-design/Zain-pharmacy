// ============================================================
// public/firebase-messaging-sw.js
// ============================================================
// 🔴 v7.4 (مهم): هذا الملف كان مفقوداً → FCM لا تعمل في الخلفية
// يجب أن يكون في الجذر مع اسم "firebase-messaging-sw.js" بالضبط
// يستقبل الإشعارات حتى لو كان التطبيق مغلق
// ============================================================

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyAPrdg8_Yf3orV0yjOkkmk35DAU9AP_sZU",
    authDomain: "phzain14.firebaseapp.com",
    projectId: "phzain14",
    storageBucket: "phzain14.firebasestorage.app",
    messagingSenderId: "303871664532",
    appId: "1:303871664532:web:dad9b6d38d2d83f79eef81"
});

const messaging = firebase.messaging();

// استقبال الإشعارات في الخلفية
messaging.onBackgroundMessage(payload => {
    console.log('[FCM-SW] Background message:', payload);
    const { title = 'مخزون الصيدلية', body = '' } = payload.notification || {};
    const type = payload.data?.type || 'general';

    // tag يمنع التكرار: إشعار نفس النوع يستبدل السابق
    return self.registration.showNotification(title, {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/favicon.png',
        tag: type,
        renotify: type === 'expiry' || type === 'instant_low',
        requireInteraction: type === 'instant_low' || type === 'anomaly',
        data: payload.data || {},
        dir: 'rtl',
        lang: 'ar'
    });
});

// التعامل مع النقر على الإشعار
self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = event.notification.data?.url || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            // افتح نافذة موجودة لو متاحة
            for (const c of list) {
                if (c.url.includes(self.location.origin) && 'focus' in c) {
                    c.navigate?.(url);
                    return c.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(url);
        })
    );
});

// تثبيت سريع
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
