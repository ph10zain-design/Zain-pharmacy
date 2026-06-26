// ============================================================
// scripts/build-year-summary.js — v7.5
// ============================================================
// 🔴 v7.5: بناء /yearSummaries/{dept}-{year} من حركات السنة
//
// المشكلة في v7.4:
//   - reports-v73-advanced.js يقرأ من yearSummaries
//   - لا يوجد أي كود يكتب لها
//   - النتيجة: كل تقرير يدخل المسار الاحتياطي (20K حركة)
//
// الحل: هذا السكربت يبني الملخص دفعةً واحدة
//
// يُشغَّل:
//   1. يدوياً (workflow_dispatch) عند الحاجة لإعادة البناء
//   2. تلقائياً يوم 1 يناير الساعة 4 صباحاً بغداد لبناء ملخص السنة السابقة
//   3. تلقائياً منتصف الأسبوع لتحديث السنة الحالية (running total)
//
// ============================================================

const admin = require('firebase-admin');

let serviceAccount;
if (process.env.FIREBASE_SA) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SA);
} else {
    try { serviceAccount = require('./service-account.json'); }
    catch (e) { console.error('❌ FIREBASE_SA مطلوب'); process.exit(1); }
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function buildSummary(dept, year) {
    console.log(`\n📊 بناء ملخص ${dept}-${year}...`);

    const start = admin.firestore.Timestamp.fromDate(new Date(year, 0, 1));
    const end = admin.firestore.Timestamp.fromDate(new Date(year + 1, 0, 1));

    // 1. جلب كل حركات السنة بصفحات (pagination)
    const items = {};
    let movCount = 0;
    let lastDoc = null;
    const PAGE = 2000;

    while (true) {
        let q = db.collection('departments').doc(dept).collection('movements')
            .where('createdAt', '>=', start)
            .where('createdAt', '<', end)
            .orderBy('createdAt', 'asc')
            .limit(PAGE);
        if (lastDoc) q = q.startAfter(lastDoc);

        const snap = await q.get();
        if (snap.empty) break;

        // تجميع الـ reverseOf داخل هذه الصفحة
        const reversedIds = new Set();
        snap.forEach(d => {
            const m = d.data();
            if (m.reverseOf) reversedIds.add(m.reverseOf);
        });

        snap.forEach(d => {
            if (reversedIds.has(d.id)) return;
            const m = d.data();
            if (m.movType === 'reverse') return;

            const id = m.inventoryId;
            if (!id) return;

            if (!items[id]) {
                items[id] = {
                    name: m.name || '',
                    code: m.code || '',
                    unit: m.unit || '',
                    totalDispensed: 0,
                    totalReceived: 0,
                    totalWasted: 0,
                    dispenseCount: 0,
                    receiveCount: 0,
                    wasteCount: 0
                };
            }

            // تحديث الأسماء/الرموز من أحدث حركة (في حال تغيّرت)
            if (m.name && !items[id].name) items[id].name = m.name;
            if (m.code && !items[id].code) items[id].code = m.code;
            if (m.unit && !items[id].unit) items[id].unit = m.unit;

            const qty = m.quantity || 0;
            if (m.movType === 'out') {
                if (m.movementSubType === 'wastage') {
                    items[id].totalWasted += qty;
                    items[id].wasteCount++;
                } else {
                    items[id].totalDispensed += qty;
                    items[id].dispenseCount++;
                }
            } else if (m.movType === 'in') {
                items[id].totalReceived += qty;
                items[id].receiveCount++;
            }
        });

        movCount += snap.size;
        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.size < PAGE) break;
    }

    console.log(`  📥 ${movCount} حركة معالَجة | ${Object.keys(items).length} مادة فريدة`);

    // 2. جلب الأرصدة الافتتاحية من snapshot 31 ديسمبر السنة السابقة
    const prevSnapDate = `${year - 1}-12-31`;
    const thisSnapDate = `${year}-12-31`;

    let openingBalances = {};
    let closingBalances = {};
    let hasPrevSnap = false;
    let hasThisSnap = false;

    try {
        const prevSnap = await db.collection('departments').doc(dept)
            .collection('balanceSnapshots').doc(prevSnapDate).get();
        if (prevSnap.exists) {
            openingBalances = prevSnap.data().balances || {};
            hasPrevSnap = true;
            console.log(`  📸 الافتتاحي من snapshot ${prevSnapDate}`);
        } else {
            console.log(`  ⚠️ لا يوجد snapshot ${prevSnapDate} — الافتتاحي = 0`);
        }
    } catch (e) {
        console.warn(`  ⚠️ خطأ snapshot افتتاحي:`, e.message);
    }

    try {
        const thisSnap = await db.collection('departments').doc(dept)
            .collection('balanceSnapshots').doc(thisSnapDate).get();
        if (thisSnap.exists) {
            closingBalances = thisSnap.data().balances || {};
            hasThisSnap = true;
            console.log(`  📸 الختامي من snapshot ${thisSnapDate}`);
        }
    } catch (e) {
        console.warn(`  ⚠️ خطأ snapshot ختامي:`, e.message);
    }

    // 3. إن لم يوجد ختامي (السنة الحالية) → جلب من inventory الحالي
    const currentYear = new Date().getFullYear();
    if (!hasThisSnap && year === currentYear) {
        console.log(`  📦 الختامي = inventory الحالي (السنة الجارية)`);
        const invSnap = await db.collection('departments').doc(dept).collection('inventory').get();
        invSnap.forEach(d => { closingBalances[d.id] = d.data().quantity || 0; });
    }

    // 4. دمج: لكل مادة، أضف opening + closing
    const allItemIds = new Set([
        ...Object.keys(items),
        ...Object.keys(openingBalances),
        ...Object.keys(closingBalances)
    ]);

    let totalDispensed = 0, totalReceived = 0, totalWasted = 0;
    for (const id of allItemIds) {
        if (!items[id]) {
            items[id] = {
                name: '', code: '', unit: '',
                totalDispensed: 0, totalReceived: 0, totalWasted: 0,
                dispenseCount: 0, receiveCount: 0, wasteCount: 0
            };
        }
        items[id].openingBalance = openingBalances[id] || 0;
        // إن لم يوجد ختامي ولا في السنة الحالية → null (تقرير الدوران سيستخدم fallback)
        items[id].closingBalance = (id in closingBalances) ? closingBalances[id] : null;

        totalDispensed += items[id].totalDispensed;
        totalReceived += items[id].totalReceived;
        totalWasted += items[id].totalWasted;
    }

    // 5. الحفظ
    const docId = `${dept}-${year}`;
    await db.collection('yearSummaries').doc(docId).set({
        dept,
        year,
        items,
        itemCount: Object.keys(items).length,
        movementCount: movCount,
        totalDispensed,
        totalReceived,
        totalWasted,
        hasOpeningSnapshot: hasPrevSnap,
        hasClosingSnapshot: hasThisSnap,
        builtAt: admin.firestore.FieldValue.serverTimestamp(),
        builtBy: 'github-action:build-year-summary'
    });

    console.log(`  ✅ ${docId}: حفظ كامل`);
    return {
        dept, year,
        itemCount: Object.keys(items).length,
        movCount,
        totalDispensed,
        totalReceived,
        totalWasted
    };
}

async function main() {
    // تحديد السنة المستهدفة:
    //   - متغير بيئة TARGET_YEAR
    //   - أو السنة السابقة (افتراضي للجدول التلقائي)
    const targetYear = process.env.TARGET_YEAR
        ? parseInt(process.env.TARGET_YEAR)
        : new Date().getFullYear() - 1;

    const depts = (process.env.DEPTS || 'pharmacy,medical_supplies').split(',').map(s => s.trim());

    console.log(`🚀 بناء ملخصات سنة ${targetYear} للأقسام: ${depts.join(', ')}`);

    const results = [];
    for (const dept of depts) {
        try {
            const r = await buildSummary(dept, targetYear);
            results.push(r);
        } catch (e) {
            console.error(`❌ فشل ${dept}-${targetYear}:`, e.message);
            results.push({ dept, year: targetYear, error: e.message });
        }
    }

    // تسجيل في auditLog
    try {
        await db.collection('auditLog').add({
            action: 'year_summary_built',
            year: targetYear,
            depts,
            results,
            by: 'github-action:build-year-summary',
            byUid: 'system',
            at: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        console.warn('audit log failed:', e.message);
    }

    const failed = results.filter(r => r.error).length;
    console.log(`\n${failed === 0 ? '✅' : '⚠️'} اكتمل: ${results.length - failed} ناجح، ${failed} فاشل`);
}

main().then(() => process.exit(0)).catch(e => {
    console.error('❌ خطأ عام:', e);
    process.exit(1);
});
