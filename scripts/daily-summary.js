// ============================================================
// scripts/daily-summary.js
// ============================================================
// يُشغَّل يومياً 8 صباحاً بغداد (5 UTC) عبر GitHub Action
// يُرسل ملخص الحركات لآخر 24 ساعة إلى مشتركي Telegram
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
if (!TELEGRAM_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN مطلوب');
    process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

function sendTelegram(chatId, text) {
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

async function buildDeptSummary(dept) {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
    const snap = await db.collection('departments').doc(dept).collection('movements')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(yesterday))
        .limit(2000).get();

    let totalIn = 0, totalOut = 0, totalWaste = 0;
    const reversed = new Set();
    snap.forEach(d => { const m = d.data(); if (m.movType === 'reverse' && m.reverseOf) reversed.add(m.reverseOf); });
    snap.forEach(d => {
        if (reversed.has(d.id)) return;
        const m = d.data();
        if (m.movType === 'reverse') return;
        if (m.movType === 'in') totalIn += m.quantity || 0;
        else if (m.movType === 'out') {
            if (m.movementSubType === 'wastage') totalWaste += m.quantity || 0;
            else totalOut += m.quantity || 0;
        }
    });

    // المواد قريبة الانتهاء
    const invSnap = await db.collection('departments').doc(dept).collection('inventory')
        .where('quantity', '>', 0).get();
    const now = new Date();
    const nearExp = [];
    invSnap.forEach(d => {
        const i = d.data();
        const e = i.earliestExpiry?.toDate();
        if (!e) return;
        const days = Math.ceil((e - now) / 86400000);
        if (days > 0 && days <= 30) nearExp.push({ name: i.name, days });
    });
    nearExp.sort((a, b) => a.days - b.days);

    const lowStock = [];
    invSnap.forEach(d => {
        const i = d.data();
        if ((i.quantity || 0) > 0 && (i.quantity || 0) <= (i.minQuantity || 0)) {
            lowStock.push({ name: i.name, qty: i.quantity });
        }
    });

    return { dept, totalIn, totalOut, totalWaste, nearExp, lowStock, movCount: snap.size };
}

async function main() {
    const departments = ['pharmacy', 'medical_supplies'];
    const summaries = [];
    for (const dept of departments) {
        summaries.push(await buildDeptSummary(dept));
    }

    let msg = `<b>📊 الملخص اليومي</b>\n`;
    msg += `<i>آخر 24 ساعة</i>\n\n`;
    for (const s of summaries) {
        const deptName = s.dept === 'pharmacy' ? '💊 الأدوية' : '🩺 المستلزمات';
        msg += `<b>${deptName}</b>\n`;
        msg += `• 📥 وارد: ${s.totalIn.toLocaleString()}\n`;
        msg += `• 📤 صرف: ${s.totalOut.toLocaleString()}\n`;
        msg += `• ♻️ هدر: ${s.totalWaste.toLocaleString()}\n`;
        if (s.nearExp.length) msg += `• ⏰ ${s.nearExp.length} مادة تنتهي ≤30 يوم\n`;
        if (s.lowStock.length) msg += `• 🔻 ${s.lowStock.length} مادة قريبة النفاذ\n`;
        msg += '\n';
    }

    // 🆕 v7.4: قراءة من /users بدلاً من /telegramUsers (توحيد البنية)
    const subs = await db.collection('users')
        .where('telegramEnabled', '==', true)
        .where('subscribeDaily', '==', true).get();

    let sent = 0, failed = 0;
    const sentChatIds = [];
    for (const doc of subs.docs) {
        try {
            const u = doc.data();
            const chatId = u.telegramChatId;
            if (!chatId) continue;
            const r = await sendTelegram(chatId, msg);
            if (r.status === 200) {
                sent++;
                sentChatIds.push(String(chatId));
            } else {
                failed++;
                console.warn(`Failed ${chatId}: ${r.body.slice(0, 100)}`);
            }
            await new Promise(r => setTimeout(r, 50)); // rate limit
        } catch (e) { failed++; console.warn(e.message); }
    }

    // 🆕 v7.4: تسجيل الإشعار في notificationsLog لكل قسم
    try {
        for (const dept of depts) {
            await db.collection('notificationsLog').add({
                type: 'daily_summary',
                title: '📊 الملخص اليومي',
                body: msg.length > 500 ? msg.slice(0, 500) + '...' : msg,
                dept,
                sentAt: admin.firestore.FieldValue.serverTimestamp(),
                sentBy: 'github-action:daily-summary',
                sent: sent,
                failed: failed,
                readAt: null
            });
        }
    } catch (e) { console.warn('notificationsLog write failed:', e.message); }

    console.log(`✅ أُرسل: ${sent} | فشل: ${failed}`);
}

main().then(() => process.exit(0)).catch(e => {
    console.error('❌ خطأ:', e);
    process.exit(1);
});
