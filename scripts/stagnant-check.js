// ============================================================
// scripts/stagnant-check.js — v7.4
// ============================================================
// يُشغَّل أسبوعياً (أحد 9 صباحاً بغداد = 6 UTC) عبر GitHub Action
// يفحص المواد التي لم تتحرك منذ slowMovingDays + يرسل تنبيه
// ============================================================

const admin = require('firebase-admin');
const https = require('https');

let serviceAccount;
if (process.env.FIREBASE_SA) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SA);
} else {
    try { serviceAccount = require('./service-account.json'); }
    catch (e) { console.error('❌ FIREBASE_SA مطلوب'); process.exit(1); }
}

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

function sendTelegram(chatId, text) {
    if (!TELEGRAM_TOKEN) return Promise.resolve({ status: 0 });
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
        const opts = {
            hostname: 'api.telegram.org',
            path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
        };
        const req = https.request(opts, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function checkDept(dept) {
    // إعدادات
    const settingsDoc = await db.collection('settings').doc('general').get();
    const slowDays = settingsDoc.exists ? (settingsDoc.data().slowMovingDays || 30) : 30;
    const now = new Date();
    const threshold = new Date(now.getTime() - slowDays * 86400000);

    // جلب المخزون (الذي له كمية > 0)
    const invSnap = await db.collection('departments').doc(dept).collection('inventory')
        .where('quantity', '>', 0).get();

    const stagnant = [];
    invSnap.forEach(doc => {
        const i = doc.data();
        if (!i.lastDispenseAt) return; // مواد جديدة بلا حركة → ليست راكدة
        const last = i.lastDispenseAt.toDate?.();
        if (!last || last >= threshold) return;
        const days = Math.ceil((now - last) / 86400000);
        stagnant.push({
            id: doc.id, code: i.code || '', name: i.name || '',
            quantity: i.quantity || 0, lastDispenseAt: last, days
        });
    });

    stagnant.sort((a, b) => a.lastDispenseAt - b.lastDispenseAt); // الأقدم أولاً
    return { dept, slowDays, count: stagnant.length, items: stagnant };
}

async function main() {
    console.log('🚀 فحص المواد الراكدة...');
    const depts = ['pharmacy', 'medical_supplies'];
    const results = [];

    for (const dept of depts) {
        try {
            const r = await checkDept(dept);
            results.push(r);
            console.log(`  ${dept}: ${r.count} مادة راكدة`);
        } catch (e) {
            console.error(`  ${dept}: فشل - ${e.message}`);
        }
    }

    // بناء رسالة Telegram + notificationsLog
    let totalStagnant = 0;
    for (const r of results) {
        if (r.count === 0) continue;
        totalStagnant += r.count;

        const deptName = r.dept === 'pharmacy' ? '💊 الأدوية' : '🩺 المستلزمات الطبية';
        const items5 = r.items.slice(0, 10).map((i, n) =>
            `   ${n + 1}. ${i.name}: ${i.quantity} (منذ ${i.days} يوم)`
        ).join('\n');

        const msg = `💤 <b>تقرير المواد الراكدة</b>\n\n` +
                    `🏥 القسم: ${deptName}\n` +
                    `📊 العتبة: ${r.slowDays} يوم بلا صرف\n` +
                    `📦 المجموع: ${r.count} مادة\n\n` +
                    `<b>أكثر المواد ركوداً:</b>\n${items5}` +
                    (r.count > 10 ? `\n   + ${r.count - 10} مادة أخرى` : '');

        // تسجيل في notificationsLog
        try {
            await db.collection('notificationsLog').add({
                type: 'stagnant',
                title: `💤 ${r.count} مادة راكدة في ${deptName}`,
                body: msg.length > 500 ? msg.slice(0, 500) : msg,
                items: r.items.slice(0, 50),
                dept: r.dept,
                sentAt: admin.firestore.FieldValue.serverTimestamp(),
                sentBy: 'github-action:stagnant-check',
                readAt: null
            });
        } catch (e) { console.warn('notificationsLog write:', e.message); }

        // إرسال Telegram للمشتركين
        if (TELEGRAM_TOKEN) {
            // 🆕 v7.4: قراءة من /users
            const subs = await db.collection('users')
                .where('telegramEnabled', '==', true)
                .where('subscribeWeekly', '==', true)
                .get();
            let sent = 0;
            for (const doc of subs.docs) {
                const chatId = doc.data().telegramChatId;
                if (!chatId) continue;
                try {
                    const result = await sendTelegram(chatId, msg);
                    if (result.status === 200) sent++;
                    await new Promise(r => setTimeout(r, 50));
                } catch (e) { console.warn(`tg fail ${chatId}:`, e.message); }
            }
            console.log(`  📲 Telegram: ${sent}`);
        }
    }

    console.log(`✅ المجموع: ${totalStagnant} مادة راكدة عبر كل الأقسام`);
}

main().then(() => process.exit(0)).catch(e => {
    console.error('❌ خطأ:', e);
    process.exit(1);
});
