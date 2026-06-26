// ============================================================
// js/core/utils.js — دوال مساعدة + إدارة الحالة + تحميل المخزون
// ============================================================
// v6.8.2 (هذا الإصلاح):
// - 🔧 توحيد requireOnline مع ConnectionMonitor (عتبة 65s متوافقة مع check interval 60s)
//   كان: عتبة 15s → 45 ثانية من كل 60 يسقط لـ navigator.onLine (المُراد استبداله)
// - 🔧 cacheBatchNumbers: CHUNK 10→50 + إلغاء delay (5× أسرع، نفس الحماية)
// v6.2:
// - 🆕 دوال موحَّدة fmtNum / fmtDate / fmtDateTime / fmtTime
// - 🆕 جميع التواريخ تُعرَض بصيغة DD/MM/YYYY (ميلادي + أرقام لاتينية)
// ============================================================

function normalizeUnit(raw) {
    if (!raw) return 'Piece';
    const key = raw.trim().toLowerCase();
    return UNIT_ALIASES[key] || raw.trim();
}

function normalizeCode(code) {
    return String(code || '').replace(/[-\s]/g, '').toUpperCase().replace(/^0+/, '');
}

// ===== Security Utilities =====
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function sanitizeInput(val, maxLen = 500) {
    if (val === null || val === undefined) return '';
    return String(val)
        .replace(/<[^>]*>/g, '')
        .replace(/[<>"'`]/g, '')
        .trim()
        .slice(0, maxLen);
}

// ===== Online check (v6.8.2: موحَّد مع ConnectionMonitor) =====
// requireOnline سريعة (sync) للعمليات الخفيفة، لكنها تستفيد من آخر فحص لـ ConnectionMonitor
// العتبة 65 ثانية = check interval (60s) + هامش 5 ثوانٍ → آخر فحص دائماً صالح
// للعمليات الحساسة (الصرف، الاستلام، الحفظ) استخدم ConnectionMonitor.requireConnection (async)
function requireOnline(operationName = 'العملية') {
    if (window.ConnectionMonitor) {
        const status = ConnectionMonitor.getStatus();
        const ageMs = Date.now() - status.lastCheck;

        // فحص حديث (≤ 65 ثانية) → ثق به
        if (ageMs < 65000 && status.lastCheck > 0) {
            if (status.isConnected) return true;
            // الفحص الحديث يقول disconnected → ارفض + اطلب فحص جديد للتعافي
            showToast(`❌ لا يوجد اتصال موثوق بالخادم — تعذّر ${operationName}`, 'error', 5000);
            ConnectionMonitor.check().catch(() => {});
            return false;
        }

        // الفحص قديم/مفقود → اطلب فحص جديد في الخلفية + اعتمد على navigator حالياً
        ConnectionMonitor.check().catch(() => {});
    }

    // Fallback: navigator.onLine (أقل موثوقية لكن أفضل من لا شيء)
    if (!navigator.onLine) {
        showToast(`❌ لا يوجد اتصال — تعذّر ${operationName}`, 'error', 5000);
        return false;
    }
    return true;
}

function getMovementDate(m) {
    return m.dispensingDate?.toDate?.() || m.createdAt?.toDate?.() || null;
}

// ============================================================
// 🆕 v7.4: isBackdated محسَّن — يقارن بتاريخ بغداد لتجنب false positives
// ============================================================
/**
 * يفحص إن الحركة بأثر رجعي (تاريخ صرف فعلي قبل تاريخ الإدخال بأكثر من 48 ساعة)
 * نستخدم 48s ساعة بدل 24 لتجنب false positives لإدخال صباح اليوم التالي
 *
 * @param {Object} m - الحركة
 * @param {number} hoursThreshold - عتبة الساعات (افتراضي 48)
 * @returns {{isBackdated: boolean, daysBack: number}}
 */
function isMovementBackdated(m, hoursThreshold = 48) {
    const created = m.createdAt?.toDate?.();
    const disp = m.dispensingDate?.toDate?.();
    if (!created || !disp) return { isBackdated: false, daysBack: 0 };

    // الفرق بـ ms (موجب لو dispensingDate أقدم من createdAt)
    const diffMs = created.getTime() - disp.getTime();
    const diffHours = diffMs / 3600000;

    if (diffHours <= hoursThreshold) return { isBackdated: false, daysBack: 0 };

    // التحويل لعدد أيام كاملة بـ Baghdad TZ
    const dispBaghdad = new Date(disp.toLocaleString('en-US', { timeZone: BAGHDAD_TZ }));
    const createdBaghdad = new Date(created.toLocaleString('en-US', { timeZone: BAGHDAD_TZ }));
    const daysBack = Math.floor((createdBaghdad - dispBaghdad) / 86400000);

    return { isBackdated: true, daysBack };
}

// ============================================================
// 🆕 v7.5 #7: cooldownCheck مع localStorage (يصمد عبر reload)
// ============================================================
// المشكلة في v7.4: _notifCooldowns كانت Map في الذاكرة
//   - reload للصفحة = مسح كل الـ cooldowns
//   - 5 صرفات لنفس المادة + reload = 5 إشعارات شذوذ من جديد
//   - تبويب جديد له cooldowns مستقلة
//
// الحل: localStorage يصمد عبر الـ reload والتبويبات على نفس المتصفح
// ============================================================
const _COOLDOWN_LS_KEY = 'pharmacy_notif_cooldowns_v75';
const _notifCooldowns = (() => {
    // محاولة استرداد من localStorage
    try {
        const raw = localStorage.getItem(_COOLDOWN_LS_KEY);
        if (raw) {
            const obj = JSON.parse(raw);
            return new Map(Object.entries(obj));
        }
    } catch (e) { /* localStorage قد يكون محظوراً (private mode) */ }
    return new Map();
})();

function _persistCooldowns() {
    try {
        const obj = Object.fromEntries(_notifCooldowns);
        localStorage.setItem(_COOLDOWN_LS_KEY, JSON.stringify(obj));
    } catch (e) { /* تجاهل في حال quota exceeded أو private mode */ }
}

/**
 * يفحص إن مرّ وقت كافٍ منذ آخر إشعار من نفس النوع لنفس المعرف
 * @param {string} key - مفتاح فريد (مثل: anomaly:itemId)
 * @param {number} ttlMs - فترة الـ cooldown
 * @returns {boolean} true إذا مسموح بإرسال إشعار جديد
 */
function checkCooldown(key, ttlMs = 3600000) { // 1 ساعة افتراضي
    const last = _notifCooldowns.get(key);
    if (last && Date.now() - last < ttlMs) return false;
    _notifCooldowns.set(key, Date.now());

    // تنظيف cooldowns قديمة (>24 ساعة) لمنع memory leak
    if (_notifCooldowns.size > 500) {
        const cutoff = Date.now() - 86400000;
        for (const [k, t] of _notifCooldowns) {
            if (t < cutoff) _notifCooldowns.delete(k);
        }
    }
    // 🔴 v7.5: حفظ في localStorage بعد كل تحديث
    _persistCooldowns();
    return true;
}

// ============================================================
// 🆕 v7.4: getVapidKey — قراءة VAPID_KEY من Firestore بدل hardcoded
// ============================================================
let _vapidKeyCache = null;

async function getVapidKey() {
    if (_vapidKeyCache) return _vapidKeyCache;
    try {
        const doc = await db.collection('settings').doc('secrets')
            .collection('keys').doc('vapid_key').get();
        if (doc.exists) {
            _vapidKeyCache = doc.data().value || null;
        }
        // fallback: window.VAPID_KEY (لو معرَّف)
        if (!_vapidKeyCache && window.VAPID_KEY && window.VAPID_KEY !== 'YOUR_VAPID_KEY_HERE') {
            _vapidKeyCache = window.VAPID_KEY;
        }
        return _vapidKeyCache;
    } catch (e) {
        console.warn('getVapidKey:', e.message);
        return null;
    }
}

function clearVapidKeyCache() { _vapidKeyCache = null; }

// ============================================================
// 🆕 v7.3: دوال موحَّدة لفلترة الحركات بتاريخ الصرف الفعلي
// تحل مشكلة: حركة دُخلت اليوم بتاريخ صرف الشهر الماضي تختفي من فلتر "هذا الشهر"
// ============================================================

/**
 * يفحص إن الحركة ضمن فترة (بتاريخ الصرف الفعلي = dispensingDate || createdAt)
 * @param {Object} m - الحركة
 * @param {Date|null} from - بداية الفترة (شامل)
 * @param {Date|null} to - نهاية الفترة (شامل)
 * @returns {boolean}
 */
function isMovementInRange(m, from, to) {
    const date = getMovementDate(m);
    if (!date) return false;
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
}

/**
 * يفلتر مصفوفة حركات بناءً على تاريخ الصرف الفعلي
 * يقوم بتطبيق الفلتر client-side بعد جلب الحركات من Firestore
 * (Firestore يجلب بـ createdAt + هامش، ثم نُصفّي هنا بـ dispensingDate الفعلي)
 *
 * @param {Array} movements - مصفوفة الحركات
 * @param {Date|null} from
 * @param {Date|null} to
 * @returns {Array}
 */
function filterMovementsByEffectiveDate(movements, from, to) {
    if (!from && !to) return movements;
    return movements.filter(m => isMovementInRange(m, from, to));
}

/**
 * يجلب الحركات من Firestore بفلتر createdAt واسع، ثم يصفي بـ dispensingDate الفعلي
 * هذا يحل مشكلة: في Firestore فلتر createdAt بينما العرض dispensingDate
 *
 * @param {firebase.firestore.Query} baseQuery
 * @param {Date|null} from
 * @param {Date|null} to
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function fetchMovementsByEffectiveRange(baseQuery, from, to, limit = 3000) {
    // توسيع نطاق createdAt لاستيعاب dispensingDate المتأخر (60 يوماً قبل from، 1 يوم بعد to)
    let q = baseQuery;
    if (from) {
        const expandedFrom = new Date(from.getTime() - 60 * 86400000);
        q = q.where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(expandedFrom));
    }
    if (to) {
        const expandedTo = new Date(to.getTime() + 86400000);
        q = q.where('createdAt', '<=', firebase.firestore.Timestamp.fromDate(expandedTo));
    }
    q = q.orderBy('createdAt', 'desc').limit(limit);
    const snap = await q.get();
    const movs = snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
    // ثم نُصفّي بالتاريخ الفعلي
    return filterMovementsByEffectiveDate(movs, from, to);
}

// ============================================================
// 🆕 دوال موحَّدة لعرض الأرقام والتواريخ بالأرقام الإنجليزية
// ============================================================

/**
 * عرض رقم بفواصل آلاف إنجليزية: 1234567 → "1,234,567"
 */
function fmtNum(n) {
    if (n === null || n === undefined || n === '' || isNaN(n)) return '0';
    return Number(n).toLocaleString('en-US');
}

/**
 * عرض تاريخ بصيغة DD/MM/YYYY ميلادي مع توقيت بغداد
 * يقبل: Firestore Timestamp، Date، string، number، null
 */
function fmtDate(input) {
    if (!input) return '—';
    let date;
    if (input?.toDate) date = input.toDate();
    else if (input instanceof Date) date = input;
    else if (typeof input === 'number') date = new Date(input);
    else if (typeof input === 'string') date = new Date(input);
    else return '—';
    if (!date || isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-GB', {
        timeZone: BAGHDAD_TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        calendar: 'gregory', numberingSystem: 'latn'
    });
}

/**
 * عرض تاريخ + وقت بصيغة DD/MM/YYYY HH:MM:SS
 */
function fmtDateTime(input) {
    if (!input) return '—';
    let date;
    if (input?.toDate) date = input.toDate();
    else if (input instanceof Date) date = input;
    else if (typeof input === 'number') date = new Date(input);
    else if (typeof input === 'string') date = new Date(input);
    else return '—';
    if (!date || isNaN(date.getTime())) return '—';
    return date.toLocaleString('en-GB', {
        timeZone: BAGHDAD_TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
        calendar: 'gregory', numberingSystem: 'latn'
    });
}

/**
 * عرض الوقت فقط HH:MM:SS
 */
function fmtTime(input) {
    if (!input) return '—';
    let date;
    if (input?.toDate) date = input.toDate();
    else if (input instanceof Date) date = input;
    else return '—';
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleTimeString('en-GB', {
        timeZone: BAGHDAD_TZ,
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false, numberingSystem: 'latn'
    });
}

// الإصدار القديم — يُبقى للتوافق
function toBaghdadTime(timestamp) {
    return fmtDateTime(timestamp);
}

// ===== حساب أيام النفاد =====
async function calcDaysUntilDepletion(dept, itemId, currentQty) {
    if (currentQty <= 0) return 0;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const snap = await db.collection('departments').doc(dept)
        .collection('movements')
        .where('inventoryId', '==', itemId)
        .where('movType', '==', 'out')
        .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(cutoff))
        .limit(200).get();
    const total30 = snap.docs.reduce((s, d) => {
        const m = d.data();
        if (m.dispensingType === 'wastage' || m.dispensingCategory === 'waste') return s;
        if (m.movementSubType === 'return_expired') return s;
        return s + (m.quantity || 0);
    }, 0);
    if (total30 === 0) return Infinity;
    return Math.floor(currentQty / (total30 / 30));
}

async function calcSmartMinQty(dept, itemId) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const snap = await db.collection('departments').doc(dept)
        .collection('movements')
        .where('inventoryId', '==', itemId)
        .where('movType', '==', 'out')
        .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(cutoff))
        .limit(500).get();
    const total90 = snap.docs.reduce((s, d) => {
        const m = d.data();
        if (m.dispensingType === 'wastage' || m.dispensingCategory === 'waste') return s;
        if (m.movementSubType === 'return_expired') return s;
        return s + (m.quantity || 0);
    }, 0);
    if (total90 === 0) return null;
    return Math.ceil((total90 / 90) * 30);
}

function handleFirestoreError(e, context = '') {
    console.error(`[firestore-error][${context}]`, e?.code, e?.message);
    const code = e?.code || '';
    if (code === 'permission-denied') return 'لا تملك صلاحية هذه العملية — تواصل مع المسؤول';
    if (code === 'unavailable' || code === 'deadline-exceeded') return 'تعذّر الاتصال بالخادم — تحقق من الإنترنت وحاول مرة أخرى';
    if (code === 'not-found') return 'البيانات المطلوبة غير موجودة — ربما حُذفت من جهاز آخر';
    if (code.includes('quota')) return 'تجاوزت حصة الاستخدام اليومية — حاول لاحقاً';
    if (code === 'aborted') return 'تعارض في البيانات — أعد المحاولة';
    if (code === 'failed-precondition') return 'تعذّر تنفيذ العملية — تحقق من الفهارس (Composite Index)';
    return e?.message || 'خطأ غير متوقع — أعد تحميل الصفحة';
}

async function logSecurityEvent(action, details = '') {
    try {
        if (!CU) return;
        await db.collection('auditLog').add({
            action: 'security_event',
            event: action,
            details,
            by: CU.email,
            byUid: CU.uid,
            at: firebase.firestore.FieldValue.serverTimestamp(),
            userAgent: navigator.userAgent.slice(0, 100)
        });
    } catch (e) { console.warn('logSecurityEvent failed', e); }
}

function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function showToast(msg, type = 'success', duration) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.justifyContent = 'space-between';
    toast.style.gap = '10px';

    const msgSpan = document.createElement('span');
    msgSpan.textContent = msg;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none;border:none;color:inherit;cursor:pointer;font-size:0.9rem;padding:0;line-height:1;flex-shrink:0;opacity:0.8';
    closeBtn.setAttribute('aria-label', 'إغلاق');
    closeBtn.onclick = () => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    };

    toast.appendChild(msgSpan);
    toast.appendChild(closeBtn);
    container.appendChild(toast);

    const finalDuration = duration || (type === 'error' ? 6000 : type === 'warning' ? 5000 : 4000);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, finalDuration);
}

function isAdmin() { return CU?.role === 'admin'; }
function isStaff() { return CU?.role === 'admin' || CU?.role === 'staff'; }

function getPurchaseCode(createdAt) {
    const year = createdAt?.toDate?.()?.getFullYear() || new Date().getFullYear();
    return `مشتريات ${year}`;
}

function recalcEarliestExpiry(dept, itemId) {
    return db.collection('departments').doc(dept).collection('inventory').doc(itemId)
        .collection('batches').where('quantity', '>', 0).get()
        .then(snap => {
            if (snap.empty) {
                return db.collection('departments').doc(dept).collection('inventory').doc(itemId)
                    .update({ earliestExpiry: null, updatedAt: firebase.firestore.Timestamp.now() });
            }
            // 🆕 v6.9 fix #3: فلتر الدفعات المنتهية فعلياً
            const now = Date.now();
            const sorted = snap.docs
                .map(d => d.data())
                .filter(b => {
                    if (!b.expiryDate) return false;
                    const expMs = b.expiryDate.toMillis ? b.expiryDate.toMillis() : 0;
                    return expMs > now;  // فقط الدفعات السارية
                })
                .sort((a, b) => (a.expiryDate?.toMillis?.() ?? Infinity) - (b.expiryDate?.toMillis?.() ?? Infinity));
            const newExpiry = sorted.length > 0 ? sorted[0].expiryDate : null;
            return db.collection('departments').doc(dept).collection('inventory').doc(itemId)
                .update({ earliestExpiry: newExpiry, updatedAt: firebase.firestore.Timestamp.now() });
        })
        .catch(e => console.error('recalcEarliestExpiry فشل:', e));
}

// 🔧 v6.8.2: CHUNK=50 بدل 10، إلغاء delay الـ 50ms بين الـ chunks
// كان: 500 مادة × 50 chunks × (query + 50ms wait) ≈ 5-8 ثوانٍ
// الآن: 500 مادة × 10 chunks × query parallel ≈ 1-2 ثانية
async function cacheBatchNumbers(dept) {
    if (AppState._batchesCached && AppState.dept === dept) return;
    const items = [...AppState.inventory.values()];
    const CHUNK = 50;
    for (let i = 0; i < items.length; i += CHUNK) {
        const chunk = items.slice(i, i + CHUNK);
        await Promise.all(chunk.map(async item => {
            try {
                const snap = await db.collection('departments').doc(dept)
                    .collection('inventory').doc(item.id)
                    .collection('batches').where('quantity', '>', 0).get();
                item.batches = snap.docs
                    .map(d => {
                        const data = d.data();
                        return { batchNumber: data.batchNumber || '', quantity: data.quantity || 0, expiryDate: data.expiryDate || null };
                    });
                AppState.inventory.set(item.id, item);
            } catch(e) { item.batches = []; }
        }));
        // لا delay بين الـ chunks — HTTP/2 multiplexing يكفي
    }
    AppState._batchesCached = true;
}

function debounce(fn, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

function skeletonRows(cols, count = 6) {
    const n = count || 6;
    const widths = [90, 75, 60, 80, 55, 70];
    return Array(n).fill(0).map((_, r) =>
        `<tr>${Array(cols).fill(0).map((__, c) =>
            `<td><div class="skeleton-cell" style="width:${widths[(r + c) % widths.length]}%"></div></td>`
        ).join('')}</tr>`
    ).join('');
}

function dateInputToTimestamp(dateStr) {
    if (!dateStr) return firebase.firestore.Timestamp.now();
    return firebase.firestore.Timestamp.fromDate(new Date(dateStr + 'T00:00:00+03:00'));
}

function updateAppState(itemId, updates) {
    const item = AppState.inventory.get(itemId);
    if (item) {
        Object.assign(item, updates);
        AppState.inventory.set(itemId, item);
        itemsCache = [...AppState.inventory.values()];
    }
}

async function loadInventoryForDept(dept) {
    if (window._invUnsub) { window._invUnsub(); window._invUnsub = null; }
    AppState.inventory.clear();
    AppState.dept = dept;
    AppState.loaded = false;
    AppState._batchesCached = false;
    MovementsCache.clear();

    return new Promise(resolve => {
        let resolved = false;
        const unsub = db.collection(`departments/${dept}/inventory`).onSnapshot(snap => {
            snap.docChanges().forEach(change => {
                if (change.type === 'removed') AppState.inventory.delete(change.doc.id);
                else AppState.inventory.set(change.doc.id, { ...change.doc.data(), id: change.doc.id });
            });
            itemsCache = [...AppState.inventory.values()];
            AppState.loaded = true;
            InternalNotif?.updateBadge?.();
            if (!resolved) {
                resolved = true;
                cacheBatchNumbers(dept).catch(() => {});
                resolve();
            } else if (App._reRenderTable) App._reRenderTable();
        }, err => {
            console.error('inventory onSnapshot:', err);
            if (!resolved) { resolved = true; resolve(); }
        });
        window._invUnsub = unsub;
    });
}

async function addToSupplyQueue(itemId, item, currentQty) {
    const key = `supply_${itemId}`;
    const lastAdded = parseInt(sessionStorage.getItem(key) || '0');
    if (Date.now() - lastAdded < 30000) return;
    sessionStorage.setItem(key, String(Date.now()));

    try {
        const requestRef = db.collection('departments').doc(CURRENT_DEPT).collection('supplyRequests').doc('pending');
        await db.runTransaction(async tx => {
            const snap = await tx.get(requestRef);
            const existing = snap.exists ? (snap.data().items || []) : [];
            if (existing.some(i => i.itemId === itemId)) return;
            const suggestedQty = Math.max((item.minQuantity || 0) * 3, 1);
            existing.push({
                itemId,
                code: item.code || '',
                name: item.name || '',
                unit: item.unit || '',
                currentQty,
                minQuantity: item.minQuantity || 0,
                requestedQty: suggestedQty,
                addedAt: firebase.firestore.Timestamp.now()
            });
            tx.set(requestRef, { items: existing, status: 'draft', updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: CU?.email || '' }, { merge: true });
        });
        if (currentQty === 0) showToast(`🔴 ${item.name || ''} نفد — أُضيف لقائمة طلب التوريد`, 'error');
        else showToast(`⚠️ ${item.name || ''} وصل الحد الأدنى — أُضيف لقائمة طلب التوريد`, 'warning');
    } catch (e) { console.warn('addToSupplyQueue فشل:', e); }
}

// ============================================================
// 🆕 v6.8.1: دوال موحَّدة لـ documentRefs uniqueness
// ============================================================
// كل مسار يكتب documentNo في movements يجب أن يفحص + يكتب documentRefs
// داخل نفس الـ Transaction لضمان التفرّد على مستوى المشروع كله

/**
 * فحص تفرّد documentNo داخل Transaction.
 * يجب الاستدعاء بعد قراءات أخرى وقبل أي كتابة في الـ tx.
 * يرمي خطأ لو الرقم مستخدم. يعود null لو documentNo فارغ.
 *
 * @param {firebase.firestore.Transaction} tx
 * @param {string} dept
 * @param {string} documentNo
 * @returns {Promise<firebase.firestore.DocumentReference|null>}
 */
async function checkDocumentNoUnique(tx, dept, documentNo) {
    if (!documentNo) return null; // اختياري
    const refDoc = db.collection('departments').doc(dept)
        .collection('documentRefs').doc(documentNo);
    const snap = await tx.get(refDoc);
    if (snap.exists) {
        throw new Error(`رقم الوثيقة "${documentNo}" مستخدم سابقاً في هذا القسم`);
    }
    return refDoc;
}

/**
 * إنشاء documentRef داخل Transaction (سجل خفيف).
 * يجب الاستدعاء بعد checkDocumentNoUnique.
 *
 * @param {firebase.firestore.Transaction} tx
 * @param {firebase.firestore.DocumentReference} refDoc - من checkDocumentNoUnique
 * @param {Object} payload - { kind, movementIds, summary }
 */
function writeDocumentRef(tx, refDoc, payload) {
    if (!refDoc) return; // documentNo فارغ — لا شيء يُكتب
    tx.set(refDoc, {
        status: 'active',
        kind: payload.kind || 'movement',
        movementIds: payload.movementIds || [],
        itemCount: payload.itemCount || 1,
        totalUnits: payload.totalUnits || 0,
        summary: payload.summary || '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: CU?.email || 'unknown',
        createdByUid: CU?.uid || ''
    });
}
