// ============================================================
// js/features/telegram-notifier.js — v7.4
// ============================================================
// إصلاحات v7.4:
//   ✅ توحيد على collection واحدة: /users فقط (حذف /telegramUsers)
//   ✅ حقول /users: telegramEnabled, telegramChatId,
//      subscribeDaily, subscribeWeekly, subscribeReminders
//   ✅ Scripts (daily-summary.js, weekly-summary.js) تقرأ من /users نفسها
//   ✅ Cleanup تلقائي لـ OTPs المنتهية (عبر GitHub Action)
//
// ⚠️ ملاحظة هجرة: الـ admin يجب أن يحذف /telegramUsers من Firestore يدوياً
// أو يُشغّل scripts/migrate-telegram.js إن وُجد.
// ============================================================

Object.assign(App, {

    // ========== إرسال إشعار طلبية لـ Telegram ==========
    async sendDocumentToTelegram(documentNo, options) {
        const opts = options || {};
        try {
            const connected = await ConnectionMonitor.requireConnection('إرسال Telegram');
            if (!connected) return;

            // جلب بيانات الطلبية
            const refSnap = await db.collection('departments').doc(CURRENT_DEPT)
                .collection('documentRefs').doc(documentNo).get();
            if (!refSnap.exists) throw new Error('الطلبية غير موجودة');
            const ref = refSnap.data();

            const movsSnap = await db.collection('departments').doc(CURRENT_DEPT)
                .collection('movements')
                .where('documentNo', '==', documentNo)
                .where('movType', '==', 'out')
                .get();
            const movs = movsSnap.docs.map(d => d.data());

            if (movs.length === 0) throw new Error('لا توجد مواد');

            const firstMov = movs[0];
            const destination = firstMov.destination;
            const docDate = firstMov.documentDate?.toDate?.();

            // ===== صياغة الرسالة =====
            const itemsList = movs.map((m, i) =>
                `${i+1}. <b>${m.name || m.code}</b>\n   الكمية: ${m.quantity} ${m.unit || ''}`
            ).join('\n');

            const message = `
📋 <b>طلبية جديدة من ${DEPT_NAMES[CURRENT_DEPT]}</b>

🔢 رقم الطلبية: <code>${documentNo}</code>
📅 التاريخ: ${docDate ? fmtDate(docDate) : '—'}
🏥 الجهة: ${destination?.main || '—'}${destination?.sub ? ' - ' + destination.sub : ''}
👤 المسلِّم: ${ref.createdBy || '—'}

💊 <b>المواد (${movs.length}):</b>
${itemsList}

📊 الإجمالي: ${ref.totalUnits || 0} وحدة
            `.trim();

            // ===== تحديد المستلمين =====
            // 🆕 v7.4: قراءة من /users بدلاً من /telegramUsers
            let targets = opts.targetUids || [];

            if (targets.length === 0) {
                const usersSnap = await db.collection('users')
                    .where('role', 'in', ['admin', 'staff'])
                    .get();
                usersSnap.forEach(d => {
                    const u = d.data();
                    if (u.telegramEnabled && u.telegramChatId) {
                        targets.push({ uid: d.id, chatId: u.telegramChatId });
                    }
                });
            }

            if (targets.length === 0) {
                showToast('⚠️ لا يوجد مستخدمون مُفعِّلون لـ Telegram', 'warning');
                return;
            }

            // ===== كتابة في الـ Queue =====
            const queueRef = db.collection('telegramQueue').doc();
            await queueRef.set({
                type: 'document_dispensed',
                documentNo,
                message,
                targets,
                dept: CURRENT_DEPT,
                priority: 'normal',
                status: 'pending',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                createdBy: CU.email,
                metadata: {
                    itemCount: movs.length,
                    totalUnits: ref.totalUnits,
                    destination
                }
            });

            showToast(`📲 تم وضع الإشعار في الطابور — سيُرسل خلال دقيقة (${targets.length} مستلم)`, 'success', 5000);

        } catch (e) {
            console.error('Telegram queue failed:', e);
            showToast(`فشل: ${e.message}`, 'error');
        }
    },

    // ========== إرسال تنبيه عام ==========
    async sendTelegramAlert(message, options) {
        if (!CU) return false;
        const opts = options || {};
        try {
            const queueRef = db.collection('telegramQueue').doc();
            await queueRef.set({
                type: opts.type || 'general_alert',
                message,
                targets: opts.targets || [],
                dept: opts.dept || CURRENT_DEPT,
                priority: opts.priority || 'normal',
                status: 'pending',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                createdBy: CU.email
            });
            return true;
        } catch (e) {
            console.error(e);
            return false;
        }
    },

    // ========== ربط Telegram للمستخدم الحالي ==========
    async linkTelegramAccount() {
        if (!CU) return;
        const connected = await ConnectionMonitor.requireConnection('ربط Telegram');
        if (!connected) return;

        try {
            // 🔴 v7.5 #5: توليد OTP بطريقة آمنة تشفيرياً (لا Math.random)
            // 6 أحرف من مجموعة محدودة (لا O/0/I/1 للوضوح)
            const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            const buf = new Uint8Array(6);
            crypto.getRandomValues(buf);
            let otp = '';
            for (let i = 0; i < 6; i++) {
                otp += ALPHABET[buf[i] % ALPHABET.length];
            }
            const expiresAt = firebase.firestore.Timestamp.fromDate(new Date(Date.now() + 5 * 60000));

            await db.collection('telegramOTPs').doc(otp).set({
                uid: CU.uid,
                email: CU.email,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                expiresAt
            });

            const botUsername = window.TELEGRAM_BOT_USERNAME || 'YourPharmacyBot';
            const link = `https://t.me/${botUsername}?start=${otp}`;

            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content" style="max-width:450px;text-align:center">
                    <button class="modal-close" onclick="this.closest('.modal').remove()">✕</button>
                    <h3>📲 ربط Telegram</h3>
                    <p>اضغط الزر التالي ثم اضغط START في Telegram:</p>
                    <a href="${link}" target="_blank" rel="noopener" class="btn btn-primary" style="margin:12px 0;display:inline-block">
                        🔗 فتح Telegram Bot
                    </a>
                    <p style="font-size:0.82rem;color:var(--muted)">
                        أو أرسل <code style="background:#0f1c30;padding:2px 8px;border-radius:4px;font-size:1.1rem">/start ${otp}</code> للبوت
                    </p>
                    <p style="font-size:0.75rem;color:var(--muted);margin-top:12px">
                        ⏰ صالح لمدة 5 دقائق فقط
                    </p>
                </div>
            `;
            document.body.appendChild(modal);
        } catch (e) {
            console.error(e);
            showToast(`فشل توليد OTP: ${e.message}`, 'error');
        }
    },

    // ========== فك ربط Telegram ==========
    async unlinkTelegram() {
        if (!confirm('فك ربط Telegram؟ لن تستقبل الإشعارات بعد ذلك.')) return;
        try {
            await db.collection('users').doc(CU.uid).update({
                telegramChatId: firebase.firestore.FieldValue.delete(),
                telegramEnabled: false,
                subscribeDaily: false,
                subscribeWeekly: false,
                subscribeReminders: false,
                telegramUnlinkedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast('✓ تم فك ربط Telegram', 'success');
        } catch (e) {
            showToast(`فشل: ${e.message}`, 'error');
        }
    },

    // ========== 🆕 v7.4: تحديث اشتراك الإشعارات الدورية ==========
    /**
     * @param {Object} prefs - { subscribeDaily, subscribeWeekly, subscribeReminders }
     */
    async updateNotificationPrefs(prefs) {
        if (!CU) return;
        if (!requireOnline('تحديث الإشعارات')) return false;

        try {
            const update = {};
            if (typeof prefs.subscribeDaily === 'boolean') update.subscribeDaily = prefs.subscribeDaily;
            if (typeof prefs.subscribeWeekly === 'boolean') update.subscribeWeekly = prefs.subscribeWeekly;
            if (typeof prefs.subscribeReminders === 'boolean') update.subscribeReminders = prefs.subscribeReminders;
            if (Object.keys(update).length === 0) return false;

            update.lastPrefsUpdate = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('users').doc(CU.uid).update(update);
            return true;
        } catch (e) {
            console.error('updateNotificationPrefs:', e);
            return false;
        }
    },

    // ========== 🆕 v7.4: قراءة تفضيلات الإشعارات الحالية ==========
    async getNotificationPrefs() {
        if (!CU) return null;
        try {
            const doc = await db.collection('users').doc(CU.uid).get();
            if (!doc.exists) return null;
            const u = doc.data();
            return {
                telegramEnabled: !!u.telegramEnabled,
                telegramChatId: u.telegramChatId || null,
                subscribeDaily: !!u.subscribeDaily,
                subscribeWeekly: !!u.subscribeWeekly,
                subscribeReminders: !!u.subscribeReminders,
                fcmTokens: Array.isArray(u.fcmTokens) ? u.fcmTokens.length : 0,
                notificationsEnabled: !!u.notificationsEnabled
            };
        } catch (e) {
            console.warn('getNotificationPrefs:', e.message);
            return null;
        }
    }
});
