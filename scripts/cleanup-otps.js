// ============================================================
// scripts/cleanup-otps.js — v7.5
// ============================================================
// يُشغَّل يومياً 3 صباحاً بغداد (0 UTC) عبر GitHub Action
// 
// المهام:
//   1. حذف OTPs Telegram المنتهية من /telegramOTPs
//   2. حذف telegramQueue قديمة (>7 أيام، sent/failed)
//   3. حذف notificationsLog قديمة (>90 يوم)
//   4. 🔴 v7.5 #8: حذف انتقائي لـ auditLog:
//      - الإجرائية (login, export, cleanup): >1 سنة
//      - الحرجة (صرف/هدر/مستخدمين/مفاتيح): >7 سنوات (للامتثال الصحي)
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

async function deleteInBatches(query, label) {
    let total = 0;
    while (true) {
        const snap = await query.limit(400).get();
        if (snap.empty) break;
        const batch = db.batch();
        snap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        total += snap.size;
        console.log(`  ${label}: حُذف ${total} حتى الآن`);
        if (snap.size < 400) break;
    }
    return total;
}

async function main() {
    console.log('🧹 بدء تنظيف Firestore...');
    const now = admin.firestore.Timestamp.now();
    const cutoff7d = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 7 * 86400000));
    const cutoff90d = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 90 * 86400000));

    let stats = {};

    // 1. OTPs المنتهية
    try {
        const otpQuery = db.collection('telegramOTPs').where('expiresAt', '<', now);
        stats.otps = await deleteInBatches(otpQuery, 'OTPs المنتهية');
    } catch (e) {
        console.warn('OTPs cleanup:', e.message);
        stats.otps = 0;
    }

    // 2. telegramQueue قديمة (>7 أيام) status='sent' أو 'failed'
    try {
        // الـ sent
        const qSent = db.collection('telegramQueue')
            .where('status', '==', 'sent')
            .where('createdAt', '<', cutoff7d);
        stats.queueSent = await deleteInBatches(qSent, 'queue sent');
    } catch (e) { console.warn('queue sent:', e.message); stats.queueSent = 0; }

    try {
        // الـ failed
        const qFailed = db.collection('telegramQueue')
            .where('status', '==', 'failed')
            .where('createdAt', '<', cutoff7d);
        stats.queueFailed = await deleteInBatches(qFailed, 'queue failed');
    } catch (e) { console.warn('queue failed:', e.message); stats.queueFailed = 0; }

    // 3. notificationsLog قديمة (>90 يوم)
    try {
        const notifQuery = db.collection('notificationsLog')
            .where('sentAt', '<', cutoff90d);
        stats.notifs = await deleteInBatches(notifQuery, 'notifs قديمة');
    } catch (e) { console.warn('notifs:', e.message); stats.notifs = 0; }

    // 4. auditLog قديمة — 🔴 v7.5 #8: حذف انتقائي وحذر
    //    المشكلة في v7.4: حذف كل auditLog أقدم من سنة → مخالفة لائحية
    //    لأن وزارة الصحة العراقية + التنظيمات الدوائية تطلب الاحتفاظ 5-10 سنوات
    //    
    //    الحل في v7.5:
    //    - الأحداث الحرجة (صرف/هدر/استلام/تعديل مستخدمين/مفاتيح) → الاحتفاظ 7 سنوات
    //    - الأحداث الإجرائية (login/export/cleanup_run) → الاحتفاظ 1 سنة
    try {
        const CRITICAL_ACTIONS = [
            'dispense', 'wastage', 'receive', 'add_item',
            'dispense_document_created',
            'create_user', 'update_user', 'delete_user', 'hard_delete_user',
            'api_key_updated', 'password_reset_requested',
            'claims_sync_run', 'year_summary_built',
            'monthly_snapshot'
        ];
        const cutoff1y = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 365 * 86400000));
        const cutoff7y = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 7 * 365 * 86400000));
        
        // 4a. الأحداث الإجرائية فقط — أكثر من سنة
        // (نقسّمها على دفعات حسب الـ action لتجنّب الحاجة لـ composite index)
        const ROUTINE_ACTIONS = ['login_success', 'report_export', 'cleanup_run',
                                  'failed_login_attempt'];
        let routineDeleted = 0;
        for (const action of ROUTINE_ACTIONS) {
            const q = db.collection('auditLog')
                .where('action', '==', action)
                .where('at', '<', cutoff1y);
            routineDeleted += await deleteInBatches(q, `audit routine (${action})`);
        }
        stats.auditRoutine = routineDeleted;
        
        // 4b. الأحداث الحرجة — أكثر من 7 سنوات (للامتثال)
        let criticalDeleted = 0;
        for (const action of CRITICAL_ACTIONS) {
            const q = db.collection('auditLog')
                .where('action', '==', action)
                .where('at', '<', cutoff7y);
            criticalDeleted += await deleteInBatches(q, `audit critical 7y+ (${action})`);
        }
        stats.auditCritical = criticalDeleted;
        
        stats.audit = routineDeleted + criticalDeleted;
    } catch (e) { console.warn('audit:', e.message); stats.audit = 0; }

    // تسجيل النتيجة في auditLog نفسه (للمراقبة)
    try {
        await db.collection('auditLog').add({
            action: 'cleanup_run',
            event: 'daily_cleanup',
            stats,
            by: 'github-action',
            at: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch {}

    console.log('✅ التنظيف اكتمل:', stats);
}

main().then(() => process.exit(0)).catch(e => {
    console.error('❌ خطأ:', e);
    process.exit(1);
});
