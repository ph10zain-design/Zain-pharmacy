// ============================================================
// js/settings.js — v7.1
// تبسيط:
//   - حُذف: UI أوزان الاحتياج (needsWeights) — لم تعد مستخدمة
//   - حُذف: UI زمن التوريد + الموسمية (ROP/seasonal) — حُذفت من الاحتياج
//   - بقي: alertDays + slowMovingDays + باقي الإعدادات
//
// v6.8: getFullYear → Baghdad — الإعدادات + الجرد + التسوية + إدارة المستخدمين
// ============================================================

Object.assign(App, {
    renderSettingsPage() {
        document.getElementById('main-content').innerHTML = `
            <div class="card"><h3>⚙️ الإعدادات</h3>
                <h4>التنبيهات</h4>
                <div class="form-group"><label>مدة التنبيه قبل الانتهاء (أيام)</label><input type="number" id="set-alert-days" class="form-control" value="${SETTINGS.alertDays}"></div>
                <div class="form-group"><label>مدة بطيئة الحركة (أيام)</label><input type="number" id="set-slow-days" class="form-control" value="${SETTINGS.slowMovingDays}"></div>
                <button class="btn btn-success btn-sm" id="btn-save-settings">💾 حفظ التنبيهات</button>
                <hr style="border-color:var(--border);margin:1rem 0">
                <h4>📋 طلبات التوريد</h4>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">
                    <button class="btn btn-sm" id="btn-supply-request">📋 عرض القائمة المعلقة</button>
                    <button class="btn btn-sm btn-primary no-print" id="btn-print-supply">🖨️ طباعة الطلب</button>
                </div>
                <div id="supply-request-preview"></div>
                <hr style="border-color:var(--border);margin:1rem 0">
                <h4>📂 نسخ احتياطي</h4>
                <button class="btn btn-sm" id="btn-export-inventory">📥 المخزون الكامل</button>
                <button class="btn btn-sm" id="btn-export-movements">📥 الحركات</button>
                <hr style="border-color:var(--border);margin:1rem 0">
                <h4>📱 تثبيت التطبيق</h4>
                <p style="font-size:0.8rem;color:var(--text2);margin-bottom:8px">
                    ثبّت التطبيق على هاتفك ليبدو كتطبيق حقيقي.
                </p>
                <button class="btn btn-primary btn-sm" onclick="PWAInstall.showManually()">📱 تثبيت التطبيق</button>
                <hr style="border-color:var(--border);margin:1rem 0">
                <h4>🔔 الإشعارات الدورية (v7.4)</h4>
                <p style="font-size:0.8rem;color:var(--text2);margin-bottom:8px">
                    حدّد ما تريد استلامه. يتطلب ربط Telegram أولاً.
                </p>
                <div id="notif-prefs-area" style="background:var(--surface2);padding:10px;border-radius:var(--radius-sm);margin-bottom:10px">
                    <label style="display:flex;align-items:center;gap:8px;padding:6px;cursor:pointer">
                        <input type="checkbox" id="pref-sub-daily" style="width:18px;height:18px">
                        <span>📊 الملخص اليومي (كل صباح 8:00)</span>
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;padding:6px;cursor:pointer">
                        <input type="checkbox" id="pref-sub-weekly" style="width:18px;height:18px">
                        <span>📈 الملخص الأسبوعي (كل أحد 8:00)</span>
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;padding:6px;cursor:pointer">
                        <input type="checkbox" id="pref-sub-reminders" style="width:18px;height:18px">
                        <span>📈 تذكيرات تقدير الاحتياج السنوي</span>
                    </label>
                    <button class="btn btn-success btn-sm" id="btn-save-prefs" style="margin-top:6px">💾 حفظ التفضيلات</button>
                    <div id="notif-prefs-status" style="font-size:0.74rem;margin-top:4px;color:var(--muted)"></div>
                </div>

                <h4>🔗 ربط حساب Telegram</h4>
                <p style="font-size:0.8rem;color:var(--text2);margin-bottom:8px">
                    اربط حسابك بـ Telegram لاستلام الإشعارات. (الرمز يصلح 5 دقائق)
                </p>
                <div id="telegram-link-area" style="display:flex;gap:6px;flex-wrap:wrap">
                    <button class="btn btn-primary btn-sm" id="btn-gen-otp">📱 توليد رمز ربط</button>
                    <button class="btn btn-sm" id="btn-unlink-telegram" style="background:var(--danger);color:#fff">🔓 فك الربط</button>
                </div>
                <div id="telegram-link-result" style="margin-top:8px"></div>

                <hr style="border-color:var(--border);margin:1rem 0">
                <h4>💤 فحص المواد الراكدة (v7.4)</h4>
                <p style="font-size:0.8rem;color:var(--text2);margin-bottom:8px">
                    افحص المواد التي لم تتحرك منذ ${SETTINGS.slowMovingDays || 30} يوم. تُرسل النتيجة كإشعار.
                </p>
                <button class="btn btn-primary btn-sm" id="btn-check-stagnant">🔍 فحص الآن</button>
                <div id="stagnant-check-result" style="margin-top:8px"></div>
                ${isAdmin() ? `<hr style="border-color:var(--border);margin:1rem 0"><h4>📥 استيراد قائمة الأدوية الرسمية</h4>
                <p style="font-size:0.8rem;color:var(--text2);margin-bottom:8px">
                    استيراد قائمة وزارة الصحة (Excel) — ينشئ المواد الجديدة ويتجاهل الموجودة.
                </p>
                <input type="file" id="drug-list-file" accept=".xlsx,.xls" style="display:none">
                <button class="btn btn-primary btn-sm" onclick="document.getElementById('drug-list-file').click()">
                    📋 اختر ملف Excel (.xlsx)
                </button>
                <div id="drug-import-result" style="margin-top:8px"></div>` : ''}
                ${isAdmin() ? `<hr style="border-color:var(--border);margin:1rem 0"><h4>🔑 مفاتيح API (v6.9)</h4>
                <p style="font-size:0.8rem;color:var(--text2);margin-bottom:8px">
                    تُخزَّن في Firestore بأمان ولا تدخل أي مستودع git
                </p>
                <div class="form-group">
                    <label>مفتاح Gemini Vision (لـ OCR)</label>
                    <div style="display:flex;gap:6px">
                        <input type="password" id="gemini-key-input" class="form-control" placeholder="AIza..." style="flex:1" autocomplete="off">
                        <button class="btn btn-primary btn-sm" id="btn-save-gemini">حفظ</button>
                    </div>
                    <div id="gemini-key-status" style="font-size:0.74rem;margin-top:4px;color:var(--muted)">
                        احصل عليه من: <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:var(--primary)">aistudio.google.com/app/apikey</a>
                    </div>
                </div>
                <div class="form-group">
                    <label>🆕 v7.4 — VAPID Key (لإشعارات FCM Web Push)</label>
                    <div style="display:flex;gap:6px">
                        <input type="password" id="vapid-key-input" class="form-control" placeholder="BIxxx..." style="flex:1" autocomplete="off">
                        <button class="btn btn-primary btn-sm" id="btn-save-vapid">حفظ</button>
                    </div>
                    <div id="vapid-key-status" style="font-size:0.74rem;margin-top:4px;color:var(--muted)">
                        احصل عليه من: Firebase Console → Project Settings → Cloud Messaging → Web Push certificates → Generate key pair
                    </div>
                </div>
                <hr style="border-color:var(--border);margin:1rem 0">
                <h4>🧊 إدارة Cold-Chain (v6.9)</h4>
                <p style="font-size:0.8rem;color:var(--text2);margin-bottom:8px">
                    اقتراح تلقائي للمواد التي تحتاج تبريد/تجميد بناء على أسمائها
                </p>
                <button class="btn btn-sm" id="btn-cc-suggest">🔍 اقتراح مواد Cold-Chain تلقائياً</button>
                ` : ''}
                ${isAdmin() ? `<hr style="border-color:var(--border);margin:1rem 0"><h4>👥 إدارة المستخدمين</h4><button class="btn btn-sm" id="btn-manage-users">فتح إدارة المستخدمين</button>` : ''}
            </div>`;
        document.getElementById('btn-save-settings').onclick = async () => {
            const ad = parseInt(document.getElementById('set-alert-days').value) || 100;
            const sd = parseInt(document.getElementById('set-slow-days').value) || 30;
            if (ad < 1 || ad > 365 || sd < 1 || sd > 365) {
                showToast('القيم يجب أن تكون بين 1 و 365 يوم', 'error');
                return;
            }
            try {
                await db.collection('settings').doc('general').set({
                    alertDays: ad, slowMovingDays: sd,
                    updatedAt: firebase.firestore.Timestamp.now(),
                    updatedBy: CU?.email || 'system'
                }, { merge: true });
                SETTINGS.alertDays = ad; SETTINGS.slowMovingDays = sd;
                showToast('✅ تم الحفظ', 'success');
            } catch (e) {
                showToast('فشل الحفظ: ' + e.message, 'error');
            }
        };

        document.getElementById('btn-supply-request').onclick = () => this.loadSupplyRequest();

        // 🆕 v6.9: حفظ مفتاح Gemini
        const btnSaveGemini = document.getElementById('btn-save-gemini');
        if (btnSaveGemini) {
            btnSaveGemini.onclick = async () => {
                const input = document.getElementById('gemini-key-input');
                const status = document.getElementById('gemini-key-status');
                const key = input.value.trim();

                if (!key.startsWith('AIza') || key.length < 30) {
                    status.innerHTML = '<span style="color:#f87171">❌ المفتاح غير صحيح (يبدأ بـ AIza ويزيد طوله عن 30 حرف)</span>';
                    return;
                }
                try {
                    await db.collection('settings').doc('secrets')
                        .collection('keys').doc('gemini').set({
                            value: key,
                            updatedAt: firebase.firestore.Timestamp.now(),
                            updatedBy: CU.uid
                        });
                    if (typeof GeminiVision !== 'undefined') GeminiVision.clearKey();
                    input.value = '';
                    status.innerHTML = '<span style="color:#4ade80">✓ المفتاح محفوظ بأمان</span>';
                    showToast('✓ مفتاح Gemini محفوظ', 'success');

                    await db.collection('auditLog').add({
                        action: 'api_key_updated', keyName: 'gemini',
                        by: CU.email, byUid: CU.uid,
                        at: firebase.firestore.Timestamp.now()
                    });
                } catch (e) {
                    status.innerHTML = `<span style="color:#f87171">فشل: ${escapeHtml(e.message)}</span>`;
                }
            };
        }

        // 🆕 v7.4: حفظ VAPID Key
        const btnSaveVapid = document.getElementById('btn-save-vapid');
        if (btnSaveVapid) {
            btnSaveVapid.onclick = async () => {
                const input = document.getElementById('vapid-key-input');
                const status = document.getElementById('vapid-key-status');
                const key = input.value.trim();

                if (!key.startsWith('B') || key.length < 80) {
                    status.innerHTML = '<span style="color:#f87171">❌ المفتاح غير صحيح (يبدأ بـ B ويزيد طوله عن 80 حرف)</span>';
                    return;
                }
                try {
                    await db.collection('settings').doc('secrets')
                        .collection('keys').doc('vapid_key').set({
                            value: key,
                            updatedAt: firebase.firestore.Timestamp.now(),
                            updatedBy: CU.uid
                        });
                    if (typeof clearVapidKeyCache === 'function') clearVapidKeyCache();
                    input.value = '';
                    status.innerHTML = '<span style="color:#4ade80">✓ المفتاح محفوظ — أعد تشغيل التطبيق لاستلام إشعارات FCM</span>';
                    showToast('✓ VAPID Key محفوظ — أعد التشغيل', 'success');

                    await db.collection('auditLog').add({
                        action: 'api_key_updated', keyName: 'vapid_key',
                        by: CU.email, byUid: CU.uid,
                        at: firebase.firestore.Timestamp.now()
                    });
                } catch (e) {
                    status.innerHTML = `<span style="color:#f87171">فشل: ${escapeHtml(e.message)}</span>`;
                }
            };
        }

        // 🆕 v7.4: تفضيلات الإشعارات الدورية
        this._loadNotificationPrefs();

        const btnSavePrefs = document.getElementById('btn-save-prefs');
        if (btnSavePrefs) {
            btnSavePrefs.onclick = async () => {
                const status = document.getElementById('notif-prefs-status');
                status.innerHTML = '<span style="color:var(--muted)">⏳ جاري الحفظ...</span>';
                try {
                    const prefs = {
                        subscribeDaily: document.getElementById('pref-sub-daily').checked,
                        subscribeWeekly: document.getElementById('pref-sub-weekly').checked,
                        subscribeReminders: document.getElementById('pref-sub-reminders').checked
                    };
                    const ok = await App.updateNotificationPrefs(prefs);
                    if (ok) {
                        status.innerHTML = '<span style="color:#4ade80">✓ تم الحفظ</span>';
                        showToast('✓ التفضيلات محفوظة', 'success');
                    } else {
                        status.innerHTML = '<span style="color:#f87171">فشل الحفظ</span>';
                    }
                } catch (e) {
                    status.innerHTML = `<span style="color:#f87171">فشل: ${escapeHtml(e.message)}</span>`;
                }
            };
        }

        // 🆕 v7.4: فك ربط Telegram
        const btnUnlink = document.getElementById('btn-unlink-telegram');
        if (btnUnlink) {
            btnUnlink.onclick = () => App.unlinkTelegram?.();
        }

        // 🆕 v7.4: فحص المواد الراكدة يدوياً
        const btnStagnant = document.getElementById('btn-check-stagnant');
        if (btnStagnant) {
            btnStagnant.onclick = async () => {
                const result = document.getElementById('stagnant-check-result');
                btnStagnant.disabled = true;
                result.innerHTML = '<span style="color:var(--muted)">⏳ جاري الفحص...</span>';
                try {
                    const r = await App.checkStagnantItems();
                    if (r.count === 0) {
                        result.innerHTML = '<span style="color:#4ade80">✅ لا توجد مواد راكدة</span>';
                    } else if (r.skipped) {
                        result.innerHTML = `<span style="color:#fb923c">ℹ️ ${r.count} مادة راكدة — لكن أُرسل إشعار هذا الأسبوع</span>`;
                    } else {
                        result.innerHTML = `<span style="color:#4ade80">✓ أُرسل إشعار: ${r.count} مادة راكدة</span>`;
                    }
                } catch (e) {
                    result.innerHTML = `<span style="color:#f87171">فشل: ${escapeHtml(e.message)}</span>`;
                } finally {
                    btnStagnant.disabled = false;
                }
            };
        }


        if (btnCC) {
            btnCC.onclick = () => {
                if (typeof ColdChain === 'undefined') {
                    showToast('وحدة Cold-Chain غير محملة', 'error');
                    return;
                }
                ColdChain.openSuggestionDialog();
            };
        }
        document.getElementById('btn-print-supply').onclick = () => window.print();
        document.getElementById('btn-export-inventory').onclick = () => {
            const data = [['الرمز','الاسم','الكمية','الوحدة','الأولوية','الحد الأدنى','تاريخ الانتهاء']];
            AppState.inventory.forEach(item => data.push([
                item.code||'', item.name||'', item.quantity||0, item.unit||'',
                item.importPriority||'',
                item.minQuantity||0,
                item.earliestExpiry?.toDate?.()?.toLocaleDateString('en-GB', { calendar: 'gregory', numberingSystem: 'latn' })||''
            ]));
            const ws = XLSX.utils.aoa_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'المخزون');
            XLSX.writeFile(wb, `inventory_${CURRENT_DEPT}_${new Date().toISOString().split('T')[0]}.xlsx`);
        };
        document.getElementById('btn-export-movements').onclick = async () => {
            if (!requireOnline('تصدير الحركات')) return;
            try {
                showToast('⏳ جاري جلب الحركات...', 'info');
                // ⚠️ رفع الحد إلى 20000 (كان 5000) ودعم pagination تلقائي
                const allDocs = [];
                let lastDoc = null;
                for (let i = 0; i < 5; i++) {
                    let q = db.collection('departments').doc(CURRENT_DEPT).collection('movements')
                        .orderBy('createdAt', 'desc').limit(5000);
                    if (lastDoc) q = q.startAfter(lastDoc);
                    const snap = await q.get();
                    if (snap.empty) break;
                    allDocs.push(...snap.docs);
                    if (snap.docs.length < 5000) break;
                    lastDoc = snap.docs[snap.docs.length - 1];
                }
                if (allDocs.length >= 25000) showToast('⚠️ تجاوزت 25000 حركة — التصدير جزئي', 'warning');
                const data = [['التاريخ','المادة','الرمز','النوع','نوع فرعي','الكمية','الجهة/المصدر','رقم الدفعة','نوع الصرف','المسؤول']];
                allDocs.forEach(d => {
                    const m = d.data();
                    const isW = m.dispensingType === 'wastage' || m.dispensingCategory === 'waste';
                    let typeLabel = '—';
                    if (m.movType === 'out') {
                        if (isW) typeLabel = 'هدر';
                        else if (m.movementSubType === 'return_expired') typeLabel = 'إتلاف';
                        else typeLabel = 'احتياج';
                    } else if (m.movType === 'in') {
                        typeLabel = m.movementSubType || 'وارد';
                    } else if (m.movType === 'reverse') {
                        typeLabel = 'إلغاء قيد';
                    }
                    data.push([
                        m.createdAt ? toBaghdadTime(m.createdAt) : '',
                        m.name || '',
                        m.code || '',
                        m.movType || '',
                        m.movementSubType || '',
                        m.quantity || 0,
                        m.destination?.main || m.source || '',
                        m.batchNumber || '',
                        typeLabel,
                        m.createdByName || m.createdBy || ''
                    ]);
                });
                // ⚠️ الإصلاح الكارثي: XLSX.utils.book_new() لا يأخذ معاملات!
                const ws = XLSX.utils.aoa_to_sheet(data);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'الحركات');
                XLSX.writeFile(wb, `movements_${CURRENT_DEPT}_${new Date().toISOString().split('T')[0]}.xlsx`);
                showToast(`✅ تم تصدير ${allDocs.length} حركة`, 'success');
            } catch(e) {
                showToast('فشل التصدير: ' + handleFirestoreError(e, 'export_movements'), 'error');
            }
        };
        // 🆕 ربط Telegram عبر OTP
        document.getElementById('btn-gen-otp').onclick = async () => {
            if (!requireOnline('توليد رمز الربط')) return;
            const btn = document.getElementById('btn-gen-otp');
            const result = document.getElementById('telegram-link-result');
            btn.disabled = true;
            btn.textContent = '⏳ جاري التوليد...';
            try {
                // 🔴 v7.5 #5: توليد OTP بطريقة آمنة تشفيرياً (لا Math.random)
                // Math.random قابل للتنبؤ → مهاجم يستطيع تخمين OTPs
                const buf = new Uint32Array(1);
                crypto.getRandomValues(buf);
                // 6 أرقام: استخدام modulo على رقم عشوائي 32 بت (تحيُّز مهمَل)
                const otp = String(100000 + (buf[0] % 900000));
                const expiresAt = firebase.firestore.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000);
                await db.collection('telegramOTPs').doc(otp).set({
                    otp,
                    uid: CU.uid,
                    email: CU.email,
                    role: CU.role,
                    dept: CURRENT_DEPT,
                    used: false,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    expiresAt
                });
                result.innerHTML = `
                    <div style="background:var(--surface3);padding:14px;border-radius:8px;border:2px dashed var(--primary)">
                        <p style="margin:0 0 8px 0;font-size:0.85rem">رمز الربط (يصلح 10 دقائق):</p>
                        <div style="font-size:2rem;font-weight:bold;letter-spacing:0.5rem;color:var(--primary);font-family:monospace;text-align:center;padding:8px;background:var(--surface);border-radius:6px">
                            ${otp}
                        </div>
                        <p style="margin:8px 0 0 0;font-size:0.78rem;color:var(--text2)">
                            افتح بوت Telegram، ثم أرسل:<br>
                            <code style="background:var(--surface);padding:2px 6px;border-radius:4px;display:inline-block;margin-top:4px;font-family:monospace">/link ${otp}</code>
                        </p>
                    </div>`;
                btn.textContent = '🔄 توليد رمز جديد';
            } catch(e) {
                result.innerHTML = `<p class="text-danger">❌ فشل: ${escapeHtml(e.message)}</p>`;
                btn.textContent = '📱 توليد رمز ربط';
            } finally {
                btn.disabled = false;
            }
        };
        if (isAdmin()) document.getElementById('btn-manage-users').onclick = () => this.showUsersManager();
        if (isAdmin()) {
            const fileInput = document.getElementById('drug-list-file');
            if (fileInput) fileInput.onchange = (e) => this.importDrugListExcel(e.target);
        }
    },

    async loadSupplyRequest() {
        const container = document.getElementById('supply-request-preview');
        if (!container) return;
        container.innerHTML = '<p class="text-muted">جاري التحميل...</p>';
        try {
            const snap = await db.collection('departments').doc(CURRENT_DEPT).collection('supplyRequests').doc('pending').get();
            if (!snap.exists || !snap.data().items?.length) {
                container.innerHTML = '<p class="text-muted">لا توجد مواد في قائمة الطلب حالياً</p>';
                return;
            }
            const items = snap.data().items || [];
            container.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0">
                    <strong>${items.length} مادة في القائمة المعلقة</strong>
                    ${isAdmin() ? '<button class="btn btn-xs btn-danger" id="btn-clear-supply">مسح القائمة</button>' : ''}
                </div>
                <div class="table-wrap">
                    <table class="inventory-table">
                        <thead><tr><th>الرمز</th><th>الاسم</th><th>الوحدة</th><th>الرصيد الحالي</th><th>الحد الأدنى</th><th>الكمية المطلوبة</th></tr></thead>
                        <tbody>
                            ${items.map(i=>`<tr>
                                <td>${escapeHtml(i.code||'')}</td>
                                <td>${escapeHtml(i.name||'')}</td>
                                <td>${escapeHtml(i.unit||'')}</td>
                                <td style="color:${i.currentQty===0?'var(--danger)':'var(--warning)'}">${i.currentQty}</td>
                                <td>${i.minQuantity}</td>
                                <td><input type="number" class="supply-qty-input form-control" data-id="${escapeHtml(i.itemId)}" value="${i.requestedQty}" min="1" style="width:70px"></td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>`;
            if (isAdmin()) {
                document.getElementById('btn-clear-supply')?.addEventListener('click', async () => {
                    if (!await this.confirmAction('مسح قائمة طلب التوريد بالكامل؟')) return;
                    await db.collection('departments').doc(CURRENT_DEPT).collection('supplyRequests').doc('pending').delete();
                    container.innerHTML = '<p class="text-muted">تم مسح القائمة</p>';
                    showToast('تم مسح قائمة التوريد', 'success');
                });
            }
        } catch (e) { container.innerHTML = `<p class="text-danger">فشل: ${escapeHtml(e.message)}</p>`; }
    },

    async startInventoryCount() {
        if (!isStaff()) { showToast('لا تملك صلاحية', 'error'); return; }
        if (!await this.confirmAction('بدء جرد جديد؟ سيتم تسجيل الأرصدة الحالية كنقطة بداية.')) return;
        try {
            const existing = await db.collection('departments').doc(CURRENT_DEPT).collection('inventoryCounts').where('status', '==', 'open').limit(1).get();
            if (!existing.empty) { showToast('يوجد جرد مفتوح بالفعل — أغلقه أولاً', 'warning'); return; }
            const items = [...AppState.inventory.values()].map(item => ({
                itemId: item.id, code: item.code || '', name: item.name || '', unit: item.unit || '',
                systemQty: item.quantity || 0, countedQty: null, notes: ''
            }));
            await db.collection('departments').doc(CURRENT_DEPT).collection('inventoryCounts').doc().set({
                status: 'open', startedAt: firebase.firestore.Timestamp.now(), startedBy: CU.email,
                completedAt: null, completedBy: null, totalItems: items.length, items
            });
            showToast(`✅ تم فتح الجرد — ${items.length} مادة`, 'success');
            this.loadInventoryCount();
        } catch (e) { showToast('فشل فتح الجرد: ' + handleFirestoreError(e, 'startInventoryCount'), 'error'); }
    },

    async loadInventoryCount() {
        const statusEl = document.getElementById('count-status');
        const contentEl = document.getElementById('count-content');
        if (!contentEl) return;
        contentEl.innerHTML = '<p class="text-muted">جاري التحميل...</p>';
        try {
            const snap = await db.collection('departments').doc(CURRENT_DEPT).collection('inventoryCounts').where('status', '==', 'open').orderBy('startedAt', 'desc').limit(1).get();
            if (snap.empty) {
                contentEl.innerHTML = '<p class="text-muted">لا يوجد جرد مفتوح حالياً</p>';
                if (statusEl) statusEl.style.display = 'none';
                return;
            }
            const countDoc = snap.docs[0];
            const countData = countDoc.data();
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.textContent = `⚠️ يوجد جرد مفتوح منذ ${countData.startedAt?.toDate?.()?.toLocaleDateString('en-GB', { calendar: 'gregory', numberingSystem: 'latn' })||'—'} — أدخل الكميات الفعلية ثم اضغط "إغلاق وتسوية"`;
            }
            const items = countData.items || [];
            contentEl.innerHTML = `
                <div class="table-wrap" style="max-height:60vh">
                    <table class="inventory-table" id="count-table">
                        <thead><tr><th>الرمز</th><th>الاسم</th><th>الوحدة</th><th>رصيد النظام</th><th>الكمية الفعلية</th><th>الفرق</th><th>ملاحظة</th></tr></thead>
                        <tbody>
                            ${items.map((item, idx) => `<tr data-idx="${idx}">
                                <td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.unit)}</td>
                                <td>${item.systemQty}</td>
                                <td><input type="number" class="count-actual-input form-control" style="width:70px" min="0" data-idx="${idx}" value="${item.countedQty !== null ? item.countedQty : ''}" placeholder="أدخل"></td>
                                <td class="count-diff-cell" id="diff-${idx}" style="font-weight:bold">—</td>
                                <td><input type="text" class="count-note-input form-control" style="width:90px" data-idx="${idx}" value="${escapeHtml(item.notes||'')}" placeholder="سبب" maxlength="200"></td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
                <div style="display:flex;gap:8px;margin-top:1rem;flex-wrap:wrap">
                    <button class="btn btn-success btn-sm" id="btn-save-count-progress">💾 حفظ التقدم</button>
                    ${isAdmin() ? '<button class="btn btn-sm" id="btn-close-count" style="background:var(--warning);color:#0f172a">🔒 إغلاق وتسوية</button>' : ''}
                    <button class="btn btn-sm" id="btn-export-count">📥 Excel</button>
                </div>
                <p id="count-error" class="text-danger" style="margin-top:8px"></p>`;
            contentEl.querySelectorAll('.count-actual-input').forEach(input => {
                input.addEventListener('input', function() {
                    const idx = this.dataset.idx;
                    const sysQty = items[idx]?.systemQty ?? 0;
                    const actual = parseInt(this.value);
                    const diffEl = document.getElementById(`diff-${idx}`);
                    if (!diffEl) return;
                    if (isNaN(actual)) { diffEl.textContent = '—'; diffEl.style.color = 'var(--muted)'; return; }
                    const diff = actual - sysQty;
                    diffEl.textContent = (diff > 0 ? '+' : '') + diff;
                    diffEl.style.color = diff === 0 ? 'var(--success)' : diff > 0 ? 'var(--warning)' : 'var(--danger)';
                });
            });
            document.getElementById('btn-save-count-progress')?.addEventListener('click', () => this.saveCountProgress(countDoc.id, items));
            document.getElementById('btn-close-count')?.addEventListener('click', () => this.closeInventoryCount(countDoc.id, items));
            document.getElementById('btn-export-count')?.addEventListener('click', () => this.exportCountExcel(items));
        } catch (e) { contentEl.innerHTML = `<p class="text-danger">فشل: ${escapeHtml(e.message)}</p>`; }
    },

    async saveCountProgress(countId, items) {
        document.querySelectorAll('.count-actual-input').forEach(inp => {
            const idx = parseInt(inp.dataset.idx);
            const val = parseInt(inp.value);
            if (!isNaN(val)) items[idx].countedQty = val;
        });
        document.querySelectorAll('.count-note-input').forEach(inp => {
            const idx = parseInt(inp.dataset.idx);
            items[idx].notes = sanitizeInput(inp.value, 200);
        });
        try {
            await db.collection('departments').doc(CURRENT_DEPT).collection('inventoryCounts').doc(countId).update({ items });
            showToast('✅ تم حفظ التقدم', 'success');
        } catch (e) { showToast('فشل الحفظ: ' + e.message, 'error'); }
    },

    async closeInventoryCount(countId, items) {
        if (!isAdmin()) { showToast('إغلاق الجرد — للمسؤول فقط', 'error'); return; }
        document.querySelectorAll('.count-actual-input').forEach(inp => {
            const idx = parseInt(inp.dataset.idx);
            const val = parseInt(inp.value);
            if (!isNaN(val)) items[idx].countedQty = val;
        });
        document.querySelectorAll('.count-note-input').forEach(inp => {
            const idx = parseInt(inp.dataset.idx);
            items[idx].notes = sanitizeInput(inp.value, 200);
        });
        const discrepancies = items.filter(i => i.countedQty !== null && i.countedQty !== i.systemQty);
        // ⚠️ حماية ضد القسمة على الصفر و القيم السالبة
        const bigOnes = discrepancies.filter(i => {
            if (!i.systemQty || i.systemQty <= 0) return Math.abs(i.countedQty || 0) > 10;
            return Math.abs(i.countedQty - i.systemQty) / i.systemQty > 0.2;
        });
        const confirmMsg = bigOnes.length > 0
            ? `يوجد ${bigOnes.length} مادة بفارق أكبر من 20%: ${bigOnes.slice(0,3).map(i=>i.name).join('، ')}...\nهل تريد المتابعة وتسوية الفروقات؟`
            : `إغلاق الجرد وتسوية ${discrepancies.length} مادة بفارق؟ لا يمكن التراجع.`;
        if (!await this.confirmAction(confirmMsg)) return;
        const errorEl = document.getElementById('count-error');
        try {
            let writeBatch = db.batch(), batchCount = 0;
            for (const item of discrepancies) {
                if (item.countedQty === null) continue;
                const diff = item.countedQty - item.systemQty;
                const itemRef = db.collection('departments').doc(CURRENT_DEPT).collection('inventory').doc(item.itemId);
                writeBatch.update(itemRef, { quantity: item.countedQty, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
                const movRef = db.collection('departments').doc(CURRENT_DEPT).collection('movements').doc();
                writeBatch.set(movRef, {
                    inventoryId: item.itemId, code: item.code || '', name: item.name || '', unit: item.unit || '',
                    movType: diff >= 0 ? 'in' : 'out', movementSubType: 'inventory_adj',
                    quantity: Math.abs(diff), quantityBefore: item.systemQty, quantityAfter: item.countedQty,
                    countedQty: item.countedQty, systemQty: item.systemQty,
                    adjustmentReason: item.notes || 'تسوية جرد دوري', dispensingDate: firebase.firestore.Timestamp.now(),
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(), createdBy: CU.email, createdByName: CU.name, createdByKadre: KADRE_LABELS[CU.role], dept: CURRENT_DEPT
                });
                writeBatch.set(db.collection('auditLog').doc(), {
                    action: 'inventory_adj', itemId: item.itemId, itemName: item.name || '', dept: CURRENT_DEPT,
                    qty: Math.abs(diff), qtyBefore: item.systemQty, qtyAfter: item.countedQty,
                    reason: item.notes || 'تسوية جرد دوري', by: CU.email, byUid: CU.uid, at: firebase.firestore.FieldValue.serverTimestamp()
                });
                batchCount++;
                if (batchCount >= 100) { await writeBatch.commit(); writeBatch = db.batch(); batchCount = 0; }
            }
            writeBatch.update(db.collection('departments').doc(CURRENT_DEPT).collection('inventoryCounts').doc(countId), {
                status: 'completed', completedAt: firebase.firestore.Timestamp.now(), completedBy: CU.email, items,
                discrepancies: discrepancies.length, matchedItems: items.filter(i => i.countedQty !== null && i.countedQty === i.systemQty).length
            });
            if (batchCount > 0) await writeBatch.commit();
            discrepancies.forEach(item => {
                if (item.countedQty === null) return;
                const si = AppState.inventory.get(item.itemId);
                if (si) { si.quantity = item.countedQty; AppState.inventory.set(item.itemId, si); }
            });
            itemsCache = [...AppState.inventory.values()];
            MovementsCache.clear();
            showToast(`✅ تم إغلاق الجرد — سُوِّيت ${discrepancies.length} مادة`, 'success');
            this.loadInventoryCount();
        } catch (e) { if (errorEl) errorEl.textContent = 'فشل الإغلاق: ' + e.message; }
    },

    exportCountExcel(items) {
        const data = [['الرمز','الاسم','الوحدة','رصيد النظام','الكمية الفعلية','الفرق','ملاحظة']];
        items.forEach(i => {
            const diff = i.countedQty !== null ? i.countedQty - i.systemQty : '';
            data.push([i.code, i.name, i.unit, i.systemQty, i.countedQty ?? '', diff, i.notes || '']);
        });
        const ws = XLSX.utils.aoa_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'الجرد الدوري');
        XLSX.writeFile(wb, `inventory_count_${CURRENT_DEPT}_${new Date().toISOString().split('T')[0]}.xlsx`);
    },

    showReconciliation() {
        const modal = document.createElement('div');
        modal.className = 'modal';
        const y = parseInt(new Intl.DateTimeFormat('en-CA', { timeZone: BAGHDAD_TZ }).format(new Date()).slice(0,4)); // 🔧 v6.8 Baghdad
        modal.innerHTML = `<div class="modal-content">
            <button class="modal-close" onclick="this.closest('.modal').remove()">✕</button>
            <h3>⚖️ كشف التسوية</h3>
            <p class="text-muted" style="font-size:0.8rem">عرض فقط — يحسب: وارد − صادر + إرجاع جيد − إتلاف ± تسويات</p>
            <div style="display:flex;gap:8px;margin:8px 0;flex-wrap:wrap;align-items:center">
                <label style="font-size:0.85rem">من:</label>
                <input type="date" id="rec-from" class="form-control" style="flex:1" value="${y}-01-01">
                <label style="font-size:0.85rem">إلى:</label>
                <input type="date" id="rec-to" class="form-control" style="flex:1" value="${new Date().toISOString().split('T')[0]}">
                <button class="btn btn-primary btn-sm" id="btn-run-rec">تشغيل</button>
            </div>
            <div id="rec-results"></div>
        </div>`;
        document.body.appendChild(modal);
        document.getElementById('btn-run-rec').onclick = () => this.runReconciliation();
    },

    async runReconciliation() {
        const fromVal = document.getElementById('rec-from')?.value;
        const toVal = document.getElementById('rec-to')?.value;
        const results = document.getElementById('rec-results');
        if (!results) return;
        if (!fromVal || !toVal) { results.innerHTML = '<p class="text-danger">حدد نطاق التاريخ</p>'; return; }
        results.innerHTML = '<p class="text-muted">جاري الحساب...</p>';
        const tsFrom = firebase.firestore.Timestamp.fromDate(new Date(fromVal + 'T00:00:00+03:00'));
        const tsTo = firebase.firestore.Timestamp.fromDate(new Date(toVal + 'T23:59:59+03:00'));
        try {
            const snap = await db.collection('departments').doc(CURRENT_DEPT).collection('movements')
                .where('createdAt', '>=', tsFrom).where('createdAt', '<=', tsTo).limit(10000).get();
            if (snap.docs.length >= 10000) showToast('⚠️ تجاوزت 10000 حركة — النتائج جزئية', 'warning');
            const byItem = {};
            snap.forEach(d => {
                const m = d.data();
                if (!m.inventoryId || !m.name) return;
                if (!byItem[m.inventoryId]) byItem[m.inventoryId] = { name: m.name, in: 0, out: 0, returnGood: 0, returnExpired: 0, wastage: 0, adj: 0 };
                const e = byItem[m.inventoryId];
                const st = m.movementSubType;
                const qty = m.quantity || 0;
                // 🔧 v7.2: حُذفت transfer_in/transfer_out — لم تعد ممكنة
                if (st === 'dispense_circle' || st === 'opening' || st === 'purchase') e.in += qty;
                else if (st === 'dispense') e.out += qty;
                else if (st === 'wastage') e.wastage += qty;
                else if (st === 'return_good') e.returnGood += qty;
                else if (st === 'return_expired') e.returnExpired += qty;
                else if (st === 'inventory_adj') e.adj += (m.movType === 'in' ? 1 : -1) * qty;
            });
            const rows = Object.values(byItem).filter(e => e.in || e.out || e.returnGood || e.returnExpired || e.wastage || e.adj);
            results.innerHTML = rows.length ? `
                <div class="table-wrap" style="max-height:55vh">
                    <table class="inventory-table">
                        <thead><tr><th>الاسم</th><th>وارد</th><th>صادر</th><th>هدر</th><th>إرجاع جيد</th><th>إتلاف</th><th>تسويات</th><th>صافي</th></tr></thead>
                        <tbody>
                            ${rows.map(r => {
                                const net = r.in + r.returnGood - r.out - r.wastage - r.returnExpired + r.adj;
                                return `<tr>
                                    <td>${escapeHtml(r.name)}</td>
                                    <td style="color:var(--success)">${r.in||0}</td>
                                    <td style="color:var(--danger)">${r.out||0}</td>
                                    <td style="color:var(--warning)">${r.wastage||0}</td>
                                    <td style="color:var(--success)">${r.returnGood||0}</td>
                                    <td style="color:var(--danger)">${r.returnExpired||0}</td>
                                    <td>${r.adj||0}</td>
                                    <td style="font-weight:bold;color:${net>=0?'var(--success)':'var(--danger)'}">${net>=0?'+':''}${net}</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
                <p class="text-muted" style="margin-top:6px;font-size:0.78rem">تحليل ${snap.docs.length} حركة — ${rows.length} مادة</p>` :
                '<p class="text-muted">لا توجد حركات في هذه الفترة</p>';
        } catch (e) { results.innerHTML = `<p class="text-danger">فشل: ${escapeHtml(e.message)}</p>`; }
    },

    async showUsersManager() {
        const snap = await db.collection('users').get();
        const allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const total = allUsers.length, active = allUsers.filter(u => !u.disabled).length;
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content"><button class="modal-close" onclick="this.closest('.modal').remove()">✕</button>
            <h3>👥 إدارة المستخدمين</h3>
            <p class="text-muted" id="users-counter">${total} مستخدم — ${active} مفعّل، ${total - active} معطّل</p>
            <div style="display:flex;gap:6px;margin:8px 0;flex-wrap:wrap">
                <input type="text" id="users-search" class="form-control" placeholder="🔍 بحث باسم أو بريد" style="flex:2">
                <select id="users-role-f" class="form-control" style="width:auto"><option value="">كل الأدوار</option><option value="admin">المسؤول</option><option value="staff">كادر المذخر</option><option value="viewer">المشاهد</option></select>
                <select id="users-status-f" class="form-control" style="width:auto"><option value="">كل الحالات</option><option value="active">مفعّل</option><option value="disabled">معطّل</option></select>
                <button class="btn btn-primary btn-sm" onclick="showAddUserModal()">+ إضافة</button>
            </div>
            <div id="users-list-container"></div></div>`;
        document.body.appendChild(modal);
        window._allUsers = allUsers;
        renderUsersModalList(allUsers);
        const searchInput = document.getElementById('users-search');
        if (searchInput) { searchInput.addEventListener('input', debounce(function() { filterUsersModal(this.value, '', ''); }, 250)); }
        document.getElementById('users-role-f').onchange = function() { filterUsersModal('', this.value, ''); };
        document.getElementById('users-status-f').onchange = function() { filterUsersModal('', '', this.value); };
    },

    // ============================================================
    // 🆕 v6.5: استيراد قائمة الأدوية من Excel
    // ============================================================
    async importDrugListExcel(input) {
        if (!isAdmin()) {
            showToast('استيراد القائمة — للمسؤول فقط', 'error');
            logSecurityEvent('unauthorized_drug_import');
            return;
        }
        if (!input.files?.[0]) return;
        if (!requireOnline('استيراد القائمة')) return;

        const resultDiv = document.getElementById('drug-import-result');
        resultDiv.innerHTML = '<p style="color:var(--text2)">⏳ جاري قراءة الملف...</p>';

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

                if (rows.length < 2) {
                    resultDiv.innerHTML = '<p class="text-danger">❌ الملف فارغ أو غير صالح</p>';
                    return;
                }

                // عرض معاينة + اختيار القسم
                this._showDrugImportPreview(rows);
            } catch (e) {
                resultDiv.innerHTML = `<p class="text-danger">❌ فشل قراءة الملف: ${escapeHtml(e.message)}</p>`;
            }
        };
        reader.readAsArrayBuffer(input.files[0]);
    },

    _showDrugImportPreview(rows) {
        // الصف الأول = الرؤوس
        const header = rows[0].map(h => String(h || '').trim());
        const dataRows = rows.slice(1).filter(r => r.some(c => c !== '' && c != null));

        // اكتشاف الأعمدة تلقائياً
        const findCol = (patterns) => {
            for (const p of patterns) {
                const idx = header.findIndex(h => h.toLowerCase().includes(p.toLowerCase()));
                if (idx >= 0) return idx;
            }
            return -1;
        };

        const colCode = findCol(['رمز وطني', 'كود', 'code', 'الرمز']);
        const colName = findCol(['inn', 'اسم علمي', 'name', 'الاسم العلمي', 'اسم الدواء']);
        const colNameAr = findCol(['اسم عربي', 'اسم بالعربية', 'arabic', 'الاسم العربي']);
        const colUnit = findCol(['وحدة', 'unit', 'الوحدة', 'شكل']);
        const colLevel = findCol(['level', 'مستوى', 'فئة', 'a1', 'a2']);
        const colPriority = findCol(['أولوية', 'priority', 'استيراد', 'a1/a2']);

        // معاينة 5 صفوف
        const preview = dataRows.slice(0, 5).map(r => ({
            code: colCode >= 0 ? String(r[colCode] || '').trim() : '',
            name: colName >= 0 ? String(r[colName] || '').trim() : '',
            nameAr: colNameAr >= 0 ? String(r[colNameAr] || '').trim() : '',
            unit: colUnit >= 0 ? String(r[colUnit] || '').trim() : '',
            level: colLevel >= 0 ? String(r[colLevel] || '').trim() : '',
            priority: colPriority >= 0 ? String(r[colPriority] || '').trim() : ''
        }));

        const allItems = dataRows.map(r => ({
            code: colCode >= 0 ? String(r[colCode] || '').trim() : '',
            name: colName >= 0 ? String(r[colName] || '').trim() : '',
            nameAr: colNameAr >= 0 ? String(r[colNameAr] || '').trim() : '',
            unit: colUnit >= 0 ? String(r[colUnit] || '').trim() : '',
            level: colLevel >= 0 ? String(r[colLevel] || '').trim() : '',
            priority: colPriority >= 0 ? String(r[colPriority] || '').trim().toUpperCase() : ''
        })).filter(item => item.code && item.name);

        // عرض dialog
        const m = document.createElement('div');
        m.className = 'modal drug-import-modal';
        m.style.zIndex = '400';
        m.innerHTML = `
            <div class="modal-content" style="max-width:700px">
                <button class="modal-close" onclick="this.closest('.modal').remove()">✕</button>
                <h3>📥 استيراد ${allItems.length} مادة</h3>

                <div style="background:var(--surface3);padding:10px;border-radius:6px;margin:8px 0">
                    <h4 style="margin:0 0 8px 0">🔍 الأعمدة المكتشَفة:</h4>
                    <table style="width:100%;font-size:0.8rem">
                        <tr><td style="color:var(--text2)">الرمز الوطني:</td><td>${colCode >= 0 ? `✅ ${escapeHtml(header[colCode])}` : '<span style="color:var(--danger)">❌ غير موجود</span>'}</td></tr>
                        <tr><td style="color:var(--text2)">اسم INN:</td><td>${colName >= 0 ? `✅ ${escapeHtml(header[colName])}` : '<span style="color:var(--danger)">❌ غير موجود</span>'}</td></tr>
                        <tr><td style="color:var(--text2)">الاسم العربي:</td><td>${colNameAr >= 0 ? `✅ ${escapeHtml(header[colNameAr])}` : '<span style="color:var(--text2)">— سيتم تركه فارغاً</span>'}</td></tr>
                        <tr><td style="color:var(--text2)">الوحدة:</td><td>${colUnit >= 0 ? `✅ ${escapeHtml(header[colUnit])}` : '<span style="color:var(--text2)">— Piece افتراضي</span>'}</td></tr>
                        <tr><td style="color:var(--text2)">المستوى (A1/A2):</td><td>${colLevel >= 0 ? `✅ ${escapeHtml(header[colLevel])}` : '<span style="color:var(--text2)">— اختياري</span>'}</td></tr>
                        <tr><td style="color:var(--text2)">الأولوية:</td><td>${colPriority >= 0 ? `✅ ${escapeHtml(header[colPriority])}` : '<span style="color:var(--text2)">— اختياري</span>'}</td></tr>
                    </table>
                </div>

                ${colCode < 0 || colName < 0 ? `
                    <div style="background:#3b1a1a;padding:10px;border-radius:6px;margin:8px 0;color:var(--danger)">
                        ⚠️ <b>الرمز الوطني والاسم العلمي مطلوبان.</b><br>
                        تأكد أن الأعمدة تحوي كلمات مثل: "رمز وطني"، "اسم علمي" أو "INN"
                    </div>
                ` : ''}

                <h4 style="margin-top:14px">📋 معاينة (5 صفوف):</h4>
                <div style="overflow-x:auto;max-height:200px;overflow-y:auto">
                    <table class="inventory-table" style="font-size:0.75rem">
                        <thead><tr><th>الرمز</th><th>الاسم</th><th>وحدة</th><th>مستوى</th><th>أولوية</th></tr></thead>
                        <tbody>
                            ${preview.map(p => `<tr>
                                <td>${escapeHtml(p.code)}</td>
                                <td>${escapeHtml(p.name)}</td>
                                <td>${escapeHtml(p.unit)}</td>
                                <td>${escapeHtml(p.level)}</td>
                                <td>${escapeHtml(p.priority)}</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>

                <hr style="border-color:var(--border);margin:1rem 0">

                <div class="form-group">
                    <label>القسم الذي ستُستورَد إليه المواد <span style="color:var(--danger)">*</span></label>
                    <select id="drug-import-dept" class="form-control">
                        <option value="pharmacy">💊 الأدوية</option>
                        <option value="medical_supplies">🩺 المستلزمات الطبية</option>
                    </select>
                </div>

                <div style="background:#1a2d45;padding:10px;border-radius:6px;margin:8px 0;font-size:0.8rem">
                    ℹ️ <b>كيف يعمل الاستيراد:</b><br>
                    • المواد ذات الرمز <b>الجديد</b> ستُضاف برصيد 0<br>
                    • المواد ذات الرمز <b>الموجود</b> ستُحدَّث (الاسم/الوحدة/الأولوية فقط)<br>
                    • <b>لن يُحذف</b> أي شيء<br>
                    • الكميات والدفعات الحالية لن تتأثر
                </div>

                <div style="display:flex;gap:8px;margin-top:1rem">
                    <button class="btn btn-success" id="btn-confirm-import" ${(colCode < 0 || colName < 0) ? 'disabled' : ''}>
                        ✅ بدء الاستيراد (${allItems.length} مادة)
                    </button>
                    <button class="btn" onclick="this.closest('.modal').remove()">إلغاء</button>
                </div>
                <div id="drug-import-progress" style="margin-top:8px"></div>
            </div>`;
        document.body.appendChild(m);

        document.getElementById('btn-confirm-import').onclick = async () => {
            await this._executeDrugImport(allItems);
        };
    },

    async _executeDrugImport(items) {
        const dept = document.getElementById('drug-import-dept').value;
        const btn = document.getElementById('btn-confirm-import');
        const progressDiv = document.getElementById('drug-import-progress');
        btn.disabled = true;
        btn.textContent = '⏳ جاري الاستيراد...';

        // جلب المواد الموجودة لتجنب التكرار
        progressDiv.innerHTML = '⏳ جاري تحميل المخزون الحالي...';
        const existingSnap = await db.collection('departments').doc(dept).collection('inventory').get();
        const existingByCode = {};
        existingSnap.docs.forEach(d => {
            const data = d.data();
            if (data.code) existingByCode[normalizeCode(data.code)] = { id: d.id, ...data };
        });

        let created = 0, updated = 0, errors = 0, skipped = 0;
        const total = items.length;
        const chunkSize = 50;

        for (let i = 0; i < total; i += chunkSize) {
            const chunk = items.slice(i, Math.min(i + chunkSize, total));
            const batch = db.batch();

            for (const item of chunk) {
                if (!item.code || !item.name) { skipped++; continue; }

                const normCode = normalizeCode(item.code);
                const existing = existingByCode[normCode];

                // اكتشاف الأولوية الصحيحة (A1/A2/A/B/C)
                let priority = null;
                if (item.priority) {
                    const p = item.priority.toUpperCase().trim();
                    if (['A1', 'A2', 'A', 'B', 'C'].includes(p)) priority = p;
                } else if (item.level) {
                    const lv = item.level.toUpperCase().trim();
                    if (['A1', 'A2'].includes(lv)) priority = lv;
                }

                if (existing) {
                    // تحديث: الاسم/الوحدة/الأولوية فقط (لا نلمس الكمية)
                    const ref = db.collection('departments').doc(dept).collection('inventory').doc(existing.id);
                    const updates = {
                        updatedAt: firebase.firestore.Timestamp.now(),
                        lastImportedAt: firebase.firestore.Timestamp.now()
                    };
                    if (!existing.name && item.name) updates.name = item.name;
                    if (!existing.nameAr && item.nameAr) updates.nameAr = item.nameAr;
                    if (item.unit && existing.unit !== normalizeUnit(item.unit)) updates.unit = normalizeUnit(item.unit);
                    if (priority && existing.importPriority !== priority) updates.importPriority = priority;
                    if (item.level && existing.level !== item.level) updates.level = item.level;

                    batch.update(ref, updates);
                    updated++;
                } else {
                    // إنشاء جديد بمعرف مبني على الرمز
                    const safeDocId = item.code.replace(/[\/\\\.\#\$\[\]]/g, '_').slice(0, 100);
                    const ref = db.collection('departments').doc(dept).collection('inventory').doc(safeDocId);
                    batch.set(ref, {
                        code: item.code,
                        name: item.name,
                        nameAr: item.nameAr || '',
                        unit: normalizeUnit(item.unit) || 'Piece',
                        level: item.level || null,
                        importPriority: priority,
                        quantity: 0,
                        minQuantity: 0,
                        earliestExpiry: null,
                        depletionDate: null,
                        createdAt: firebase.firestore.Timestamp.now(),
                        createdBy: CU.email,
                        source: 'official_drug_list_2026',
                        category: dept,
                        lastImportedAt: firebase.firestore.Timestamp.now()
                    });
                    created++;
                }
            }

            try {
                await batch.commit();
            } catch (e) {
                console.error('batch commit failed:', e);
                errors += chunk.length;
            }

            // تحديث التقدم
            const done = Math.min(i + chunkSize, total);
            const pct = Math.round((done / total) * 100);
            progressDiv.innerHTML = `
                <div style="background:var(--surface3);padding:8px;border-radius:6px">
                    <div style="background:var(--surface4);height:8px;border-radius:4px;overflow:hidden">
                        <div style="background:var(--primary);height:100%;width:${pct}%;transition:width 0.3s"></div>
                    </div>
                    <p style="font-size:0.8rem;margin:6px 0 0 0">
                        ${done} / ${total} (${pct}%) — جديد: ${created} | محدَّث: ${updated} | تخطّى: ${skipped}
                    </p>
                </div>`;
        }

        // تسجيل في auditLog
        try {
            await db.collection('auditLog').add({
                action: 'import_drug_list',
                dept,
                created, updated, skipped, errors,
                total,
                by: CU.email, byUid: CU.uid,
                at: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (e) {}

        btn.style.display = 'none';
        progressDiv.innerHTML = `
            <div style="background:#1a3a1a;padding:14px;border-radius:8px;border:2px solid var(--success);margin-top:8px">
                <h4 style="margin:0 0 8px 0;color:var(--success)">✅ اكتمل الاستيراد!</h4>
                <table style="width:100%;font-size:0.85rem">
                    <tr><td>📋 الإجمالي:</td><td><strong>${fmtNum(total)}</strong> مادة</td></tr>
                    <tr><td>🆕 جديدة:</td><td><strong style="color:var(--success)">${fmtNum(created)}</strong></td></tr>
                    <tr><td>🔄 محدَّثة:</td><td><strong style="color:var(--primary)">${fmtNum(updated)}</strong></td></tr>
                    <tr><td>⏭ تخطّت:</td><td>${fmtNum(skipped)}</td></tr>
                    ${errors > 0 ? `<tr><td>❌ أخطاء:</td><td style="color:var(--danger)"><strong>${fmtNum(errors)}</strong></td></tr>` : ''}
                </table>
                <button class="btn btn-primary" style="width:100%;margin-top:10px" onclick="document.querySelector('.drug-import-modal')?.remove();App.renderSettingsPage()">
                    ✅ إغلاق
                </button>
            </div>`;

        showToast(`✅ تم استيراد ${created} مادة جديدة + تحديث ${updated}`, 'success', 8000);
    },

    // ============================================================
    // 🆕 v7.4: تحميل تفضيلات الإشعارات وعرضها في checkboxes
    // ============================================================
    async _loadNotificationPrefs() {
        const dailyEl = document.getElementById('pref-sub-daily');
        const weeklyEl = document.getElementById('pref-sub-weekly');
        const remindersEl = document.getElementById('pref-sub-reminders');
        const statusEl = document.getElementById('notif-prefs-status');
        if (!dailyEl || !weeklyEl || !remindersEl) return;

        try {
            const prefs = await App.getNotificationPrefs?.();
            if (!prefs) {
                if (statusEl) statusEl.innerHTML = '<span style="color:var(--muted)">⏳ تعذّر تحميل التفضيلات</span>';
                return;
            }

            dailyEl.checked = prefs.subscribeDaily;
            weeklyEl.checked = prefs.subscribeWeekly;
            remindersEl.checked = prefs.subscribeReminders;

            if (!prefs.telegramEnabled || !prefs.telegramChatId) {
                if (statusEl) {
                    statusEl.innerHTML = '<span style="color:#fb923c">⚠️ Telegram غير مربوط — الإشعارات الدورية تحتاج ربط Telegram أولاً</span>';
                }
            } else {
                if (statusEl) {
                    statusEl.innerHTML = `<span style="color:#4ade80">✓ Telegram مربوط (chatId: ...${String(prefs.telegramChatId).slice(-4)})</span>`;
                }
            }
        } catch (e) {
            console.warn('_loadNotificationPrefs:', e.message);
        }
    }
});
