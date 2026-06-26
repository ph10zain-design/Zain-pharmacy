// ============================================================
// scripts/sync-claims.js — v7.5
// ============================================================
// 🔴 الإصلاح الأهم في v7.5: مزامنة Custom Claims
// 
// المشكلة في v7.4 والإصدارات السابقة:
//   - users.js يضع claimSyncRequired:true عند إنشاء/تعديل مستخدم
//   - auth.js ينتظر tokenResult.claims.role
//   - firestore.rules تفحص request.auth.token.role
//   - لكن لا يوجد أي سكربت يستدعي admin.auth().setCustomUserClaims()
//   - النتيجة: المستخدم الجديد عالق في شاشة "تحضير حسابك" للأبد
//
// الحل: هذا السكربت يُشغَّل كل 5 دقائق عبر GitHub Action
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
const auth = admin.auth();

const ALLOWED_ROLES = ['admin', 'staff', 'viewer'];

async function syncOne(doc) {
    const data = doc.data() || {};
    const uid = doc.id;
    const role = ALLOWED_ROLES.includes(data.role) ? data.role : 'viewer';
    const disabled = data.disabled === true;

    try {
        // 1. تعيين الـ claims على Firebase Auth
        await auth.setCustomUserClaims(uid, { role, disabled });

        // 2. إجبار token refresh — يضمن أن claims الجديدة تصل للعميل
        //    (revokeRefreshTokens يلغي كل الـ refresh tokens، فيعيد العميل المصادقة)
        await auth.revokeRefreshTokens(uid);

        // 3. تحديث Firestore لتأكيد المزامنة + مسح forceLogout
        // 🔴 v7.5 #19: مسح forceLogout هنا لمنع حلقة "خروج لانهائي"
        //    revokeRefreshTokens أعلاه يُجبر المستخدم على إعادة الدخول
        //    بعد إعادة الدخول، forceLogout=false → لا حلقة
        await doc.ref.update({
            claimSyncRequired: false,
            claimSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
            claimSyncedRole: role,
            claimSyncedDisabled: disabled,
            forceLogout: false
        });

        return { uid, role, disabled, status: 'ok' };
    } catch (e) {
        // إذا فشل: لا نُعدّل claimSyncRequired ليُعاد المحاولة في الدورة التالية
        return { uid, role, status: 'failed', error: e.message };
    }
}

async function main() {
    console.log('🔄 بدء مزامنة Custom Claims...');

    // 1. كل المستخدمين الذين يحتاجون مزامنة
    const snap = await db.collection('users')
        .where('claimSyncRequired', '==', true)
        .limit(500)  // حماية من overload
        .get();

    if (snap.empty) {
        console.log('✅ لا يوجد مستخدمين بحاجة لمزامنة');
        process.exit(0);
        return;
    }

    console.log(`📋 ${snap.size} مستخدم بحاجة للمزامنة`);
    const results = [];

    for (const doc of snap.docs) {
        const r = await syncOne(doc);
        results.push(r);
        const icon = r.status === 'ok' ? '✅' : '❌';
        const extra = r.error ? ` | ${r.error}` : '';
        console.log(`  ${icon} ${r.uid} → role=${r.role} disabled=${r.disabled || false}${extra}`);
    }

    // 2. تسجيل النتيجة في auditLog
    const ok = results.filter(r => r.status === 'ok').length;
    const failed = results.filter(r => r.status === 'failed').length;

    try {
        await db.collection('auditLog').add({
            action: 'claims_sync_run',
            count: results.length,
            ok,
            failed,
            failedDetails: results.filter(r => r.status === 'failed'),
            by: 'github-action:sync-claims',
            byUid: 'system',
            at: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        console.warn('audit log failed:', e.message);
    }

    console.log(`\n✅ اكتمل: ${ok} ناجح، ${failed} فاشل`);
}

main().then(() => process.exit(0)).catch(e => {
    console.error('❌ خطأ:', e);
    process.exit(1);
});
