// ============================================================
// scripts/monthly-snapshot.js
// ============================================================
// يُشغَّل تلقائياً آخر يوم من كل شهر (عبر GitHub Action)
// يحفظ balanceSnapshot لكل قسم في تاريخ آخر يوم بالشهر
//
// إذا كان ديسمبر → يُعلَّم isYearlyArchive:true (للأرشفة السنوية)
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

function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

async function snapshotDept(dept, snapshotDate) {
    const balances = {};
    const invSnap = await db.collection('departments').doc(dept).collection('inventory').get();
    invSnap.forEach(d => { balances[d.id] = d.data().quantity || 0; });

    const snapId = formatDate(snapshotDate);
    const isYearly = snapshotDate.getMonth() === 11;

    await db.collection('departments').doc(dept)
        .collection('balanceSnapshots').doc(snapId).set({
            balances,
            year: snapshotDate.getFullYear(),
            month: snapshotDate.getMonth() + 1,
            date: snapId,
            dept,
            type: isYearly ? 'monthly_and_yearly' : 'monthly',
            isYearlyArchive: isYearly,
            archivedAt: admin.firestore.Timestamp.now(),
            createdBy: 'github-action-monthly'
        });

    return { dept, snapId, itemCount: Object.keys(balances).length, isYearly };
}

async function main() {
    // آخر يوم في الشهر الحالي (في توقيت بغداد)
    // GitHub Action يعمل بتوقيت UTC، نُعدّل +3 ساعات
    const now = new Date(Date.now() + 3 * 3600 * 1000);
    const lastDayThisMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    console.log(`📸 Snapshot لتاريخ: ${formatDate(lastDayThisMonth)}`);

    const departments = ['pharmacy', 'medical_supplies'];
    for (const dept of departments) {
        try {
            const result = await snapshotDept(dept, lastDayThisMonth);
            console.log(`✅ ${result.dept}: ${result.itemCount} مادة | snapshot ${result.snapId}${result.isYearly ? ' [أرشيف سنوي]' : ''}`);
        } catch (e) {
            console.error(`❌ فشل ${dept}:`, e.message);
        }
    }
}

main().then(() => process.exit(0)).catch(e => {
    console.error('❌ خطأ عام:', e);
    process.exit(1);
});
