// ============================================================
// js/core/report-cache.js — v7.5
// ============================================================
// 🎯 الهدف: حل كارثة قراءات Firestore
//
// 🔴 إصلاحات v7.5:
//   #20 تحذير صريح عند بلوغ HARD_LIMIT (لا data loss صامت)
//   #21 ReportCache.invalidateAfterMovement(dept) لمسح cache التقارير
//       بعد أي صرف/استلام (كان مفقوداً → تقارير قديمة 5 دقائق)
// ============================================================

(function() {
'use strict';

const CACHE_TTL = 5 * 60 * 1000; // 5 دقائق
const MAX_ENTRIES = 30;          // LRU eviction
const HARD_LIMIT_MOVEMENTS = 20000;
const HARD_LIMIT_DISPENSE = 5000;

const ReportCache = {
    _store: new Map(),

    get(key) {
        const entry = this._store.get(key);
        if (!entry) return null;
        if (Date.now() - entry.t > CACHE_TTL) {
            this._store.delete(key);
            return null;
        }
        // LRU: نقل للنهاية (آخر استخدام)
        this._store.delete(key);
        this._store.set(key, entry);
        return entry.data;
    },

    set(key, data) {
        if (this._store.size >= MAX_ENTRIES) {
            const firstKey = this._store.keys().next().value;
            this._store.delete(firstKey);
        }
        this._store.set(key, { data, t: Date.now() });
    },

    invalidate(prefix) {
        if (!prefix) {
            this._store.clear();
            return;
        }
        for (const key of this._store.keys()) {
            if (key.startsWith(prefix)) {
                this._store.delete(key);
            }
        }
    },

    /**
     * 🔴 v7.5 #21: مسح cache التقارير بعد أي صرف/استلام/هدر
     * كان مفقوداً في v7.4 → التقارير ترى بيانات قديمة 5 دقائق بعد الحركة
     * يُستدعى من inventory.js و multi-batch-dispense.js بعد commit
     */
    invalidateAfterMovement(dept) {
        const year = new Date().getFullYear();
        this.invalidate(`ys:${dept}:${year}`);        // ملخص السنة الحالية
        this.invalidate(`myc:${dept}:${year}`);        // حركات السنة الحالية
        this.invalidate(`dr90:${dept}`);               // معدل 90 يوم
    },

    clear() {
        this._store.clear();
    },

    stats() {
        const now = Date.now();
        const entries = [...this._store.entries()].map(([k, v]) => ({
            key: k,
            ageSec: Math.floor((now - v.t) / 1000),
            size: typeof v.data === 'object' && v.data?.length ? v.data.length : 1
        }));
        return { count: this._store.size, entries };
    }
};

/**
 * يجلب yearSummary من /yearSummaries/{dept}-{year}
 * يُبنى عبر scripts/build-year-summary.js (workflow أسبوعي + سنوي)
 */
async function fetchYearSummary(dept, year) {
    const key = `ys:${dept}:${year}`;
    const cached = ReportCache.get(key);
    if (cached !== null) return cached;

    try {
        const doc = await db.collection('yearSummaries').doc(`${dept}-${year}`).get();
        const data = doc.exists ? doc.data() : null;
        ReportCache.set(key, data);
        return data;
    } catch (e) {
        console.warn(`fetchYearSummary(${dept}, ${year}):`, e.message);
        return null;
    }
}

/**
 * يجلب حركات سنة كاملة من Firestore مع cache.
 * 🔴 v7.5 #20: تحذير صريح عند بلوغ الحد لمنع data loss صامت
 */
async function fetchMovementsForYearCached(dept, year) {
    const key = `myc:${dept}:${year}`;
    const cached = ReportCache.get(key);
    if (cached !== null) return cached;

    const start = new Date(year, 0, 1);
    const end = new Date(year + 1, 0, 1);
    const snap = await db.collection('departments').doc(dept).collection('movements')
        .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(start))
        .where('createdAt', '<', firebase.firestore.Timestamp.fromDate(end))
        .limit(HARD_LIMIT_MOVEMENTS).get();

    // 🔴 v7.5 #20: تحذير صريح عند بلوغ الحد
    if (snap.size >= HARD_LIMIT_MOVEMENTS) {
        const msg = `⚠️ التقرير غير كامل: حجم الحركات بلغ الحد الأقصى ${HARD_LIMIT_MOVEMENTS}.`
                  + ` يجب بناء ملخص ${year} (workflow: Build Year Summary) لدقة الأرقام.`;
        console.warn(msg);
        if (typeof showToast === 'function') {
            showToast(msg, 'error', 10000);
        }
    }

    const reversed = new Set();
    snap.forEach(d => {
        const m = d.data();
        if (m.movType === 'reverse' && m.reverseOf) reversed.add(m.reverseOf);
    });
    const data = snap.docs
        .filter(d => !reversed.has(d.id))
        .map(d => ({ ...d.data(), _docId: d.id }))
        .filter(m => m.movType !== 'reverse');

    // علامة "بُلِغ الحد" تُحفظ مع البيانات (لو احتاج المُتصل)
    data._hitLimit = snap.size >= HARD_LIMIT_MOVEMENTS;
    ReportCache.set(key, data);
    return data;
}

/**
 * 🔴 v7.5 #20: نفس التحذير لـ fetch90DayDispenseRate
 */
async function fetch90DayDispenseRate(dept) {
    const key = `dr90:${dept}`;
    const cached = ReportCache.get(key);
    if (cached !== null) return cached;

    const since = new Date(Date.now() - 90 * 86400000);
    const snap = await db.collection('departments').doc(dept).collection('movements')
        .where('movType', '==', 'out')
        .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(since))
        .limit(HARD_LIMIT_DISPENSE).get();

    if (snap.size >= HARD_LIMIT_DISPENSE) {
        const msg = `⚠️ معدّل 90 يوم غير كامل: ${HARD_LIMIT_DISPENSE}+ حركة.`
                  + ` بعض المواد قد لا تظهر بدقة في مدى الأمان.`;
        console.warn(msg);
        if (typeof showToast === 'function') {
            showToast(msg, 'warning', 6000);
        }
    }

    const reversed = new Set();
    snap.forEach(d => {
        const m = d.data();
        if (m.reverseOf) reversed.add(m.reverseOf);
    });

    const now = Date.now();
    const totals30 = {}, totals90 = {}, counts = {};
    snap.forEach(d => {
        if (reversed.has(d.id)) return;
        const m = d.data();
        if (m.movementSubType === 'wastage') return;
        const id = m.inventoryId;
        if (!id) return;
        const dt = m.createdAt?.toMillis?.() || 0;
        const ageDays = (now - dt) / 86400000;
        if (ageDays <= 30) totals30[id] = (totals30[id] || 0) + (m.quantity || 0);
        totals90[id] = (totals90[id] || 0) + (m.quantity || 0);
        counts[id] = (counts[id] || 0) + 1;
    });

    const rates = {};
    new Set([...Object.keys(totals90)]).forEach(id => {
        const r30 = (totals30[id] || 0) / 30;
        const r90 = (totals90[id] || 0) / 90;
        rates[id] = { r30, r90, conservative: Math.max(r30, r90), count: counts[id] };
    });

    ReportCache.set(key, rates);
    return rates;
}

// التصدير للنطاق العام
window.ReportCache = ReportCache;
window.fetchYearSummary = fetchYearSummary;
window.fetchMovementsForYearCached = fetchMovementsForYearCached;
window.fetch90DayDispenseRate = fetch90DayDispenseRate;

})();
