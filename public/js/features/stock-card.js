// ============================================================
// js/features/stock-card.js — v7.3
// ============================================================
// المسؤوليات:
// - الدوال الأساسية لبطاقة المادة (Stock Card) والميزان الدوري
// - تحقق سلامة الحركات (Movement Integrity)
// - إدارة snapshots (شهرية موحَّدة، 31/12 يخدم السنوي تلقائياً)
//
// v7.3 (التنظيف):
//   - حُذف: '_REMOVE_ME' (بقايا transfer_out)
//   - حُذف: 'إرجاع' من inBySource
//   - حُذف: 'إرجاع منتهي' من outByCategory
//   - تغيير: snapshot شهرية (آخر يوم في الشهر) + 31/12 تُؤشَّر isYearlyArchive
//   - أُضيف: getMonthlySnapshot، saveMonthlySnapshot
//   - أُضيف: lazy-creation للشهور المفقودة
// ============================================================

(function() {
'use strict';

const BAGHDAD_TZ = 'Asia/Baghdad';

// ============================================================
// Helper Functions
// ============================================================

function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
}

function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function endOfDay(date) {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
}

function startOfMonth(year, month) { // month: 0-11
    return new Date(year, month, 1, 0, 0, 0, 0);
}

function endOfMonth(year, month) {
    return new Date(year, month + 1, 0, 23, 59, 59, 999);
}

function getEndOfPreviousMonth(date) {
    const d = new Date(date);
    return new Date(d.getFullYear(), d.getMonth(), 0, 23, 59, 59, 999);
}

function formatSnapshotId(date) {
    // YYYY-MM-DD (تاريخ آخر يوم من شهر)
    return date.toLocaleDateString('en-CA', { timeZone: BAGHDAD_TZ });
}

function toTimestamp(date) {
    return firebase.firestore.Timestamp.fromDate(date);
}

// ============================================================
// الدالة الأساسية: getBalanceAtDate
// ============================================================

/**
 * يعود الرصيد لمادة معينة في تاريخ معين
 * يستخدم quantityAfter من آخر حركة قبل (أو في) التاريخ
 */
async function getBalanceAtDate(dept, itemId, date) {
    const snap = await db.collection(`departments/${dept}/movements`)
        .where('inventoryId', '==', itemId)
        .where('createdAt', '<=', toTimestamp(endOfDay(date)))
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();

    if (snap.empty) return 0;

    const last = snap.docs[0].data();
    return Number(last.quantityAfter) || 0;
}

// ============================================================
// بطاقة المادة (Stock Card) لفترة معينة
// ============================================================

/**
 * يبني بطاقة المخزون لمادة معينة في فترة معينة
 * مع الرصيد التراكمي المتسلسل (مثل السجل الورقي)
 */
async function getStockCard(dept, itemId, startDate, endDate) {
    const start = startOfDay(startDate);
    const end = endOfDay(endDate);

    // 1. الرصيد الافتتاحي = الرصيد قبل start بيوم
    const opening = await getBalanceAtDate(dept, itemId, addDays(start, -1));

    // 2. كل الحركات في الفترة
    const movsSnap = await db.collection(`departments/${dept}/movements`)
        .where('inventoryId', '==', itemId)
        .where('createdAt', '>=', toTimestamp(start))
        .where('createdAt', '<=', toTimestamp(end))
        .orderBy('createdAt', 'asc')
        .get();

    let totalIn = 0, totalOut = 0;
    const inBySource = {
        'تجهيز دائرة': 0,
        'مشتريات': 0,
        'افتتاحي': 0
    };
    const outByCategory = {
        'صرف': 0,
        'هدر': 0
    };
    const lines = [];

    // كشف الحركات الملغاة
    const reversedIds = new Set();
    movsSnap.forEach(d => {
        const m = d.data();
        if (m.movType === 'reverse' && m.reverseOf) reversedIds.add(m.reverseOf);
    });

    movsSnap.forEach(d => {
        const m = d.data();
        const qty = Number(m.quantity) || 0;
        const sub = m.movementSubType || '';

        if (m.movType === 'in') {
            totalIn += qty;
            if (sub === 'opening') inBySource['افتتاحي'] += qty;
            else if (sub === 'purchase') inBySource['مشتريات'] += qty;
            else inBySource['تجهيز دائرة'] += qty;
        } else if (m.movType === 'out') {
            totalOut += qty;
            if (sub === 'wastage') outByCategory['هدر'] += qty;
            else outByCategory['صرف'] += qty;
        }

        lines.push({
            id: d.id,
            date: m.createdAt?.toDate?.(),
            dispensingDate: m.dispensingDate?.toDate?.() || m.createdAt?.toDate?.(),
            type: m.movType,
            subType: sub,
            quantity: qty,
            balanceAfter: Number(m.quantityAfter) || 0,
            documentNo: m.documentNo || '',
            destination: m.destination || null,
            source: m.source || '',
            batchNumber: m.batchNumber || '',
            expiryDate: m.expiryDate?.toDate?.() || null,
            manufacturer: m.manufacturer || '',
            notes: m.notes || '',
            wasteReason: m.wasteReason || '',
            reverseOf: m.reverseOf || null,
            reverseReason: m.reverseReason || '',
            reversedBy: reversedIds.has(d.id),
            createdBy: m.createdBy || '',
            createdByName: m.createdByName || ''
        });
    });

    // 3. الرصيد الختامي = آخر quantityAfter (أو opening إن لم تكن حركات)
    const closing = lines.length > 0
        ? lines[lines.length - 1].balanceAfter
        : opening;

    // 4. التحقق المحاسبي
    const expected = opening + totalIn - totalOut;
    const balanced = Math.abs(closing - expected) < 0.01;

    return {
        itemId,
        startDate: start,
        endDate: end,
        opening,
        totalIn,
        inBySource,
        totalOut,
        outByCategory,
        closing,
        expected,
        balanced,
        discrepancy: closing - expected,
        movements: lines,
        movementCount: lines.length
    };
}

// ============================================================
// 🆕 v7.3: getCardForItem — بطاقة كاملة بكل تاريخ المادة
// مع حد أعلى 2000 حركة + رصيد تراكمي صحيح
// ============================================================
async function getCardForItem(dept, itemId, options = {}) {
    const limit = options.limit || 2000;
    const onlyType = options.onlyType; // 'in' | 'out' | 'reverse' | null
    const subType = options.subType;   // 'purchase' | 'dispense_circle' | ...

    let query = db.collection(`departments/${dept}/movements`)
        .where('inventoryId', '==', itemId);

    if (onlyType) query = query.where('movType', '==', onlyType);
    if (subType) query = query.where('movementSubType', '==', subType);

    query = query.orderBy('createdAt', 'desc').limit(limit);
    const snap = await query.get();

    // كشف الحركات الملغاة
    const reversedIds = new Set();
    snap.docs.forEach(d => {
        const m = d.data();
        if (m.movType === 'reverse' && m.reverseOf) reversedIds.add(m.reverseOf);
    });

    return snap.docs.map(d => {
        const m = d.data();
        return {
            _docId: d.id,
            ...m,
            _reversedBy: reversedIds.has(d.id)
        };
    });
}

// ============================================================
// 🆕 v7.3: snapshots شهرية موحَّدة
// ============================================================

/**
 * يحفظ snapshot لرصيد كل المواد في تاريخ معين
 * snapshotDate يجب أن يكون آخر يوم في الشهر (YYYY-MM-DD)
 * إذا كان 31/12 → يُعلَّم isYearlyArchive: true (للأرشفة السنوية)
 */
async function saveMonthlySnapshot(dept, snapshotDate) {
    try {
        const invSnap = await db.collection(`departments/${dept}/inventory`).get();
        const balances = {};
        invSnap.forEach(d => { balances[d.id] = d.data().quantity || 0; });

        const snapId = formatSnapshotId(snapshotDate);
        const isYearly = snapshotDate.getMonth() === 11; // ديسمبر

        await db.collection('departments').doc(dept)
            .collection('balanceSnapshots').doc(snapId).set({
                balances,
                year: snapshotDate.getFullYear(),
                month: snapshotDate.getMonth() + 1, // 1-12
                date: snapId,
                dept,
                type: isYearly ? 'monthly_and_yearly' : 'monthly',
                isYearlyArchive: isYearly,
                archivedAt: firebase.firestore.Timestamp.now(),
                createdBy: window.CU?.email || 'system'
            });
        return snapId;
    } catch(e) {
        console.warn('saveMonthlySnapshot فشل:', e.message);
        return null;
    }
}

/**
 * يجلب snapshot لتاريخ معين
 * إذا لم يكن موجوداً، يبنيه على الطاير (lazy creation)
 */
async function getMonthlySnapshot(dept, year, month /* 1-12 */) {
    const endDate = new Date(year, month, 0, 23, 59, 59); // آخر يوم في الشهر
    const snapId = formatSnapshotId(endDate);

    try {
        const doc = await db.collection('departments').doc(dept)
            .collection('balanceSnapshots').doc(snapId).get();
        if (doc.exists) return { id: snapId, ...doc.data() };
    } catch (e) {
        console.warn('getMonthlySnapshot read فشل:', e.message);
    }

    // Lazy creation: احسبها من الحركات + المخزون الحالي
    // ملاحظة: lazy creation فقط للشهور الماضية (لا المستقبلية)
    if (endDate > new Date()) return null;

    try {
        // اجلب كل الحركات بعد endDate لطرحها من المخزون الحالي
        const invSnap = await db.collection(`departments/${dept}/inventory`).get();
        const currentBalances = {};
        invSnap.forEach(d => { currentBalances[d.id] = d.data().quantity || 0; });

        const movsSnap = await db.collection(`departments/${dept}/movements`)
            .where('createdAt', '>', toTimestamp(endDate))
            .get();

        // ابدأ بالرصيد الحالي ثم اطرح الحركات للوصول إلى نهاية الشهر المطلوب
        const balancesAtSnap = { ...currentBalances };
        movsSnap.forEach(d => {
            const m = d.data();
            const itemId = m.inventoryId;
            if (!itemId) return;
            if (m.movType === 'in') {
                balancesAtSnap[itemId] = (balancesAtSnap[itemId] || 0) - (m.quantity || 0);
            } else if (m.movType === 'out') {
                balancesAtSnap[itemId] = (balancesAtSnap[itemId] || 0) + (m.quantity || 0);
            } else if (m.movType === 'reverse') {
                // إلغاء قيد: يعكس حركة out → فعلياً يعيد الكمية
                balancesAtSnap[itemId] = (balancesAtSnap[itemId] || 0) - (m.quantity || 0);
            }
        });

        // احفظ للمستقبل
        const isYearly = endDate.getMonth() === 11;
        await db.collection('departments').doc(dept)
            .collection('balanceSnapshots').doc(snapId).set({
                balances: balancesAtSnap,
                year: endDate.getFullYear(),
                month: endDate.getMonth() + 1,
                date: snapId,
                dept,
                type: isYearly ? 'monthly_and_yearly' : 'monthly',
                isYearlyArchive: isYearly,
                archivedAt: firebase.firestore.Timestamp.now(),
                createdBy: 'lazy-creation',
                source: 'lazy'
            });

        return {
            id: snapId,
            balances: balancesAtSnap,
            year: endDate.getFullYear(),
            month: endDate.getMonth() + 1,
            date: snapId,
            source: 'lazy'
        };
    } catch (e) {
        console.warn('getMonthlySnapshot lazy فشل:', e.message);
        return null;
    }
}

// ============================================================
// الميزان الجماعي (Periodic Balance) لكل المواد
// يستخدم الـ snapshots الشهرية الجديدة
// ============================================================

async function getPeriodicBalance(dept, startDate, endDate) {
    const start = startOfDay(startDate);
    const end = endOfDay(endDate);

    // 1. أقرب snapshot قبل startDate
    const snapshotDate = getEndOfPreviousMonth(start);
    const snapData = await getMonthlySnapshot(
        dept,
        snapshotDate.getFullYear(),
        snapshotDate.getMonth() + 1
    );
    const snapshotBalances = snapData?.balances || {};
    const snapshotId = snapData?.id || formatSnapshotId(snapshotDate);

    // 2. كل الحركات من snapshot إلى endDate
    const movsSnap = await db.collection(`departments/${dept}/movements`)
        .where('createdAt', '>', toTimestamp(snapshotDate))
        .where('createdAt', '<=', toTimestamp(end))
        .get();

    const items = {};

    // كشف الحركات الملغاة
    const reversedIds = new Set();
    movsSnap.forEach(d => {
        const m = d.data();
        if (m.movType === 'reverse' && m.reverseOf) reversedIds.add(m.reverseOf);
    });

    // تهيئة من snapshot
    for (const [itemId, qty] of Object.entries(snapshotBalances)) {
        items[itemId] = _initItemBalance(qty);
    }

    // معالجة كل حركة
    movsSnap.forEach(d => {
        const m = d.data();
        const itemId = m.inventoryId;
        if (!itemId) return;
        // تجاهل الحركات الملغاة + حركات الإلغاء نفسها (تعويض متبادل)
        if (reversedIds.has(d.id)) return;
        if (m.movType === 'reverse') return;

        if (!items[itemId]) {
            items[itemId] = _initItemBalance(0);
        }

        const e = items[itemId];
        const qty = Number(m.quantity) || 0;
        const movDate = m.createdAt?.toDate?.();
        if (!movDate) return;

        const beforePeriod = movDate < start;

        if (beforePeriod) {
            // قبل بداية الفترة - يعدل opening فقط
            if (m.movType === 'in') e.opening += qty;
            else if (m.movType === 'out') e.opening -= qty;
        } else {
            // داخل الفترة
            const sub = m.movementSubType || '';
            if (m.movType === 'in') {
                e.totalIn += qty;
                if (sub === 'opening') e.inBySource['افتتاحي'] += qty;
                else if (sub === 'purchase') e.inBySource['مشتريات'] += qty;
                else e.inBySource['تجهيز دائرة'] += qty;
            } else if (m.movType === 'out') {
                e.totalOut += qty;
                if (sub === 'wastage') e.outByCategory['هدر'] += qty;
                else e.outByCategory['صرف'] += qty;
            }
        }
    });

    // حساب closing + التحقق المحاسبي + جلب معلومات المادة
    const invSnap = await db.collection(`departments/${dept}/inventory`).get();
    const inventoryMap = {};
    invSnap.forEach(d => {
        inventoryMap[d.id] = d.data();
    });

    // التأكد من تضمين كل المواد (حتى التي بدون حركات)
    for (const [itemId, invData] of Object.entries(inventoryMap)) {
        if (!items[itemId]) {
            const qty = Number(invData.quantity) || 0;
            items[itemId] = _initItemBalance(qty);
        }
    }

    // حساب closing
    for (const itemId in items) {
        const e = items[itemId];
        e.closing = e.opening + e.totalIn - e.totalOut;

        const isToday = Math.abs(end.getTime() - Date.now()) < 24 * 60 * 60 * 1000;
        if (isToday && inventoryMap[itemId]) {
            const actual = Number(inventoryMap[itemId].quantity) || 0;
            e.actualClosing = actual;
            e.discrepancy = actual - e.closing;
            e.balanced = Math.abs(e.discrepancy) < 0.01;
        } else {
            e.actualClosing = e.closing;
            e.discrepancy = 0;
            e.balanced = true;
        }

        const inv = inventoryMap[itemId] || {};
        e.itemInfo = {
            code: inv.code || '',
            name: inv.name || '',
            unit: inv.unit || '',
            importPriority: inv.importPriority || null,
            minQuantity: inv.minQuantity || 0
        };
    }

    const totals = _calculateTotals(items);
    return { items, totals, snapshotDate, snapshotId, snapshotSource: snapData?.source };
}

function _initItemBalance(opening = 0) {
    return {
        opening: Number(opening) || 0,
        totalIn: 0,
        totalOut: 0,
        closing: 0,
        actualClosing: 0,
        discrepancy: 0,
        balanced: true,
        inBySource: {
            'تجهيز دائرة': 0,
            'مشتريات': 0,
            'افتتاحي': 0
        },
        outByCategory: {
            'صرف': 0,
            'هدر': 0
        }
    };
}

function _calculateTotals(items) {
    const t = {
        itemCount: 0,
        balancedCount: 0,
        unbalancedCount: 0,
        totalOpening: 0,
        totalIn: 0,
        totalOut: 0,
        totalClosing: 0,
        inBySource: {
            'تجهيز دائرة': 0,
            'مشتريات': 0,
            'افتتاحي': 0
        },
        outByCategory: {
            'صرف': 0,
            'هدر': 0
        }
    };

    for (const itemId in items) {
        const e = items[itemId];
        t.itemCount++;
        if (e.balanced) t.balancedCount++;
        else t.unbalancedCount++;

        t.totalOpening += e.opening;
        t.totalIn += e.totalIn;
        t.totalOut += e.totalOut;
        t.totalClosing += e.closing;

        for (const src in e.inBySource) {
            t.inBySource[src] = (t.inBySource[src] || 0) + e.inBySource[src];
        }
        for (const cat in e.outByCategory) {
            t.outByCategory[cat] = (t.outByCategory[cat] || 0) + e.outByCategory[cat];
        }
    }

    return t;
}

// ============================================================
// التحقق من سلامة الحركات
// ============================================================

async function verifyMovementIntegrity(dept) {
    const issues = [];
    const inv = await db.collection(`departments/${dept}/inventory`).get();

    for (const doc of inv.docs) {
        const item = doc.data();
        const currentQty = Number(item.quantity) || 0;

        const lastMov = await db.collection(`departments/${dept}/movements`)
            .where('inventoryId', '==', doc.id)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();

        if (lastMov.empty) {
            if (currentQty !== 0) {
                issues.push({
                    itemId: doc.id,
                    name: item.name,
                    code: item.code,
                    currentQty,
                    expectedQty: 0,
                    diff: currentQty,
                    reason: 'الرصيد > 0 بدون حركات مسجَّلة'
                });
            }
            continue;
        }

        const lastAfter = Number(lastMov.docs[0].data().quantityAfter) || 0;
        if (Math.abs(currentQty - lastAfter) > 0.01) {
            issues.push({
                itemId: doc.id,
                name: item.name,
                code: item.code,
                currentQty,
                expectedQty: lastAfter,
                diff: currentQty - lastAfter,
                lastMovementId: lastMov.docs[0].id,
                reason: 'الرصيد الحالي لا يطابق quantityAfter لآخر حركة'
            });
        }
    }

    return issues;
}

// ============================================================
// Export
// ============================================================

window.StockCard = {
    // الدوال الأساسية
    getBalanceAtDate,
    getStockCard,
    getCardForItem,
    getPeriodicBalance,
    verifyMovementIntegrity,

    // Snapshots
    saveMonthlySnapshot,
    getMonthlySnapshot,

    // Helpers
    helpers: {
        addDays,
        startOfDay,
        endOfDay,
        startOfMonth,
        endOfMonth,
        getEndOfPreviousMonth,
        formatSnapshotId
    }
};

})();
