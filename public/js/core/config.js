// ============================================================
// js/core/config.js — Firebase initialization
// ============================================================
// يجب تحميل هذا الملف قبل أي شيء آخر في js/
// يُعرِّف المتغيرات العامة `db` و `auth` التي تستخدمها كل الملفات
// ============================================================

const firebaseConfig = {
    apiKey: "AIzaSyAPrdg8_Yf3orV0yjOkkmk35DAU9AP_sZU",
    authDomain: "phzain14.firebaseapp.com",
    projectId: "phzain14",
    storageBucket: "phzain14.firebasestorage.app",
    messagingSenderId: "303871664532",
    appId: "1:303871664332:web:dad9b6d38d2d83f79eef81"
};

// تهيئة Firebase (مرة واحدة فقط)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// المتغيرات العامة - تستخدمها كل ملفات js/
const auth = firebase.auth();
const db = firebase.firestore();

// إعدادات Firestore لتقليل reads
// (Online-only - لا persistence لتفادي مشاكل sync)
db.settings({
    ignoreUndefinedProperties: true,
    merge: true
});

// تصدير للنطاق العام
window.auth = auth;
window.db = db;
