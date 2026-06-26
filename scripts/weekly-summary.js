// ============================================================
// scripts/weekly-summary.js
// ============================================================
// يُشغَّل كل أحد 8 صباحاً بغداد عبر GitHub Action
// يُرسل ملخص الأسبوع للمشتركين في Telegram
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
if (!TELEGRAM_TOKEN) { console.error('❌ TELEGRAM_BOT_TOKEN مطلوب'); process.exit(1); }

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
            let body = ''; res.on('data', c => body += c);
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject); req.write(data); req.end();
    });
}

async function buildWeeklySummary(dept) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const snap = await db.collection('departments').doc(dept).collection('movements')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(sevenDaysAgo))
        .limit(5000).get();

    const reversed = new Set();
    snap.forEach(d => { const m = d.data(); if (m.movType === 'reverse' && m.reverseOf) reversed.add(m.reverseOf); });

    let totalIn = 0, totalOut = 0, totalWaste = 0;
    const topItems = {};
    snap.forEach(d => {
        if (reversed.has(d.id)) return;
        const m = d.data();
        if (m.movType === 'reverse') return;
        if (m.movType === 'in') totalIn += m.quantity || 0;
        else if (m.movType === 'out') {
            if (m.movementSubType === 'wastage') totalWaste += m.quantity || 0;
            else {
                totalOut += m.quantity || 0;
                if (!topItems[m.inventoryId]) topItems[m.inventoryId] = { name: m.name || '', qty: 0 };
                topItems[m.inventoryId].qty += m.quantity || 0;
            }
        }
    });

    const top5 = Object.values(topItems).sort((a, b) => b.qty - a.qty).slice(0, 5);
    return { dept, totalIn, totalOut, totalWaste, top5, movCount: snap.size };
}

async function main() {
    const departments = ['pharmacy', 'medical_supplies'];
    const summaries = [];
    for (const dept of departments) summaries.push(await buildWeeklySummary(dept));

    let msg = `<b>📊 ملخص الأسبوع</b>\n<i>آخر 7 أيام</i>\n\n`;
    for (const s of summaries) {
        const deptName = s.dept === 'pharmacy' ? '💊 الأدوية' : '🩺 المستلزمات';
        msg += `<b>${deptName}</b>\n`;
        msg += `• 📥 وارد: ${s.totalIn.toLocaleString()}\n`;
        msg += `• 📤 صرف: ${s.totalOut.toLocaleString()}\n`;
        msg += `• ♻️ هدر: ${s.totalWaste.toLocaleString()}\n`;
        if (s.top5.length) {
            msg += `• 🏆 أعلى 5:\n`;
            s.top5.forEach((t, i) => { msg += `   ${i+1}. ${t.name}: ${t.qty.toLocaleString()}\n`; });
        }
        msg += '\n';
    }

    // 🆕 v7.4: قراءة من /users بدلاً من /telegramUsers
    const subs = await db.collection('users')
        .where('telegramEnabled', '==', true)
        .where('subscribeWeekly', '==', true).get();

    let sent = 0, failed = 0;
    for (const doc of subs.docs) {
        try {
            const u = doc.data();
            const chatId = u.telegramChatId;
            if (!chatId) continue;
            const r = await sendTelegram(chatId, msg);
            if (r.status === 200) sent++; else failed++;
            await new Promise(r => setTimeout(r, 50));
        } catch (e) { failed++; }
    }

    // 🆕 v7.4: تسجيل في notificationsLog
    try {
        for (const dept of depts) {
            await db.collection('notificationsLog').add({
                type: 'weekly_summary',
                title: '📈 الملخص الأسبوعي',
                body: msg.length > 500 ? msg.slice(0, 500) + '...' : msg,
                dept,
                sentAt: admin.firestore.FieldValue.serverTimestamp(),
                sentBy: 'github-action:weekly-summary',
                sent,
                failed,
                readAt: null
            });
        }
    } catch (e) { console.warn('notificationsLog:', e.message); }

    console.log(`✅ أُرسل: ${sent} | فشل: ${failed}`);
}

main().then(() => process.exit(0)).catch(e => {
    console.error('❌ خطأ:', e);
    process.exit(1);
});
