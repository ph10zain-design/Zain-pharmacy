// ============================================================
// js/inventory.js — المخزون + الصرف + الوارد
// ============================================================
// v7.3:
//   - حُذف: showReturnModal و saveReturn (ميزة الإرجاع كلها)
//   - حُذف: زر "↩️ إرجاع" من جدول المخزون
//   - تغيير: زر "بطاقة" 📋 → 🃏 (يفتح صفحة كاملة بدل modal)
// ============================================================

Object.assign(App, {
    renderInventoryPage() {
        if (!CU) return;
        if (!AppState.loaded || AppState.dept !== CURRENT_DEPT) {
            loadInventoryForDept(CURRENT_DEPT).then(() => this.renderInventoryPage());
            return;
        }
        document.getElementById('main-content').innerHTML = `
            <div class="card">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
                    <h3>${DEPT_NAMES[CURRENT_DEPT]} <span class="badge badge-primary">${itemsCache.length} مادة</span></h3>
                    <select id="dept-select" class="form-control" style="width:auto">${Object.entries(DEPT_NAMES).map(([k,v])=>`<option value="${k}" ${CURRENT_DEPT===k?'selected':''}>${v}</option>`).join('')}</select>
                </div>
                <div style="display:flex;justify-content:space-between;margin:10px 0;align-items:center;gap:6px;flex-wrap:wrap">
                    <input type="text" id="inv-search" class="form-control" placeholder="🔍 بحث" style="flex:1;min-width:150px">
                    ${isStaff() ? `
                        <button class="btn btn-primary btn-sm" id="multi-receive-btn" style="background:var(--info);color:#0f172a">📥 استلام متعدد</button>
                        <button class="btn btn-primary btn-sm" id="dispense-doc-btn" style="background:var(--success)">📋 قائمة تجهيز</button>
                        <button class="btn btn-primary btn-sm" id="add-btn">+ إضافة</button>
                    ` : '<span class="text-muted" style="font-size:.75rem">👁 عرض فقط</span>'}
                </div>
                <div id="inv-error" class="text-danger" style="display:none"></div>
                <div class="table-wrap" aria-live="polite" aria-atomic="false">
                    <table class="inventory-table" id="inv-table" role="table" aria-label="جدول مخزون الأدوية">
                        <thead><tr><th>الرمز</th><th>الاسم</th><th>الكمية</th><th>الوحدة</th><th>الانتهاء</th><th>آخر استلام</th><th></th></tr></thead>
                        <tbody></tbody>
                    </table>
                </div>
            </div>`;
        document.getElementById('dept-select').onchange = (e) => {
            CURRENT_DEPT = e.target.value;
            if (window._invUnsub) window._invUnsub();
            loadInventoryForDept(CURRENT_DEPT).then(() => this.renderInventoryPage());
        };
        document.getElementById('inv-search').oninput = debounce(function() {
            const q = this.value.trim().toLowerCase();
            const filtered = !q ? itemsCache : itemsCache.filter(item => {
                const nameMatch = (item.name || '').toLowerCase().includes(q);
                const codeMatch = normalizeCode(item.code || '').includes(normalizeCode(q));
                const batchMatch = (item.batches || []).some(b => (b.batchNumber || '').toLowerCase().includes(q));
                return nameMatch || codeMatch || batchMatch;
            });
            window._tableVisible = 60;
            window._tableItems = filtered;
            App._reRenderTable?.() || App.renderTable(filtered);
        }, 250);
        if (isStaff()) document.getElementById('add-btn').onclick = () => this.showAddModal();
        if (isStaff()) document.getElementById('dispense-doc-btn').onclick = () => this.openDispenseDocument();
        if (isStaff()) document.getElementById('multi-receive-btn').onclick = () => this.showMultiReceiveModal();
        this.renderTable(itemsCache);
    },

    renderTable(items) {
        const tbody = document.querySelector('#inv-table tbody');
        if (!tbody) return;
        if (!items || items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2.5rem 1rem"><div style="font-size:2.5rem;margin-bottom:8px">📦</div><p style="color:var(--muted);margin:0 0 12px">لا توجد مواد في هذا القسم بعد</p>${isStaff() ? '<button class="btn btn-primary btn-sm" onclick="App.showAddModal()">+ إضافة أول مادة</button>' : ''}</td></tr>`;
            return;
        }

        const BATCH = 60;
        window._tableItems = items;
        window._tableVisible = Math.min(BATCH, items.length);

        const renderVisible = () => {
            const now = new Date();
            const alertDays = SETTINGS.alertDays || 100;
            const visible = (window._tableItems || []).slice(0, window._tableVisible);
            const rows = visible.map(item => {
                const q = item.quantity || 0, min = item.minQuantity || 0;
                const exp = item.earliestExpiry?.toDate?.();
                const expStr = exp ? exp.toLocaleDateString('en-GB', { calendar: 'gregory', numberingSystem: 'latn' }) : '-';
                const isExpired = exp && exp < now;
                const daysLeft = exp ? Math.ceil((exp - now) / 86400000) : null;
                const lowAlert = q > 0 && q <= min;
                const expiringSoon = !isExpired && daysLeft !== null && daysLeft <= alertDays;
                // ⚠️ المادة الجديدة (qty=0 + لا depletionDate) لا تُعرض بلون أحمر
                const isReallyDepleted = q === 0 && item.depletionDate;
                const rowClass = isReallyDepleted ? 'row-danger' : (isExpired || expiringSoon || lowAlert) ? 'row-warning' : '';
                const qtyClass = isReallyDepleted ? 'qty-zero' : (lowAlert ? 'qty-low' : 'qty-ok');
                let action = '';
                if (isStaff()) {
                    action = `<button class="btn btn-xs btn-primary" data-id="${escapeHtml(item.id)}" data-action="dispense" data-dispense-id="${escapeHtml(item.id)}" aria-label="صرف ${escapeHtml(item.name)}">📤</button>
                              <button class="btn btn-xs" data-id="${escapeHtml(item.id)}" data-action="receive" aria-label="استلام ${escapeHtml(item.name)}" style="background:var(--success);color:#0f172a;margin:0 2px">📥</button>
                              <button class="btn btn-xs" data-id="${escapeHtml(item.id)}" data-action="card" aria-label="بطاقة ${escapeHtml(item.name)}" style="background:var(--info);color:#0f172a;margin:0 2px" title="بطاقة المادة">🃏</button>
                              <button class="btn btn-xs" data-id="${escapeHtml(item.id)}" data-action="info" aria-label="معلومات ${escapeHtml(item.name)}" style="background:var(--surface3);color:var(--primary)">ℹ️</button>`;
                } else {
                    action = `<button class="btn btn-xs" data-id="${escapeHtml(item.id)}" data-action="card" aria-label="بطاقة ${escapeHtml(item.name)}" style="background:var(--info);color:#0f172a" title="بطاقة المادة">🃏</button>`;
                }
                // 🆕 v6.9: cold-chain badge
                const ccBadge = (typeof ColdChain !== 'undefined' && ColdChain.isColdChain(item))
                    ? ' ' + ColdChain.renderBadge(item)
                    : '';
                return `<tr class="${rowClass}" data-id="${escapeHtml(item.id)}">
                    <td style="cursor:pointer;font-family:monospace;font-size:0.72rem" data-code="${escapeHtml(item.code||'')}" onclick="App.copyCode(this.dataset.code)" title="انقر لنسخ الرمز">${escapeHtml(item.code || '')}</td>
                    <td>${escapeHtml(item.name || '')}${ccBadge}</td>
                    <td class="${qtyClass}" data-field="quantity" aria-label="الكمية: ${q} ${escapeHtml(item.unit||'')}">${q}</td>
                    <td>${escapeHtml(item.unit || '')}</td>
                    <td>${expStr} ${isExpired?'<span class="expired-badge">منتهية</span>':(expiringSoon?'<span class="expired-badge">قريبة</span>':'')}</td>
                    <td style="font-size:0.65rem;color:var(--muted)">${item.lastReceivedAt?.toDate?.()?.toLocaleDateString('en-GB',{timeZone:'Asia/Baghdad'})||'—'}</td>
                    <td>${action}</td>
                </tr>`;
            });

            const remaining = (window._tableItems || []).length - window._tableVisible;
            if (remaining > 0) {
                rows.push(`<tr><td colspan="7" style="text-align:center;padding:0.8rem"><button class="btn btn-sm" onclick="window._tableVisible+=60;App._reRenderTable()">تحميل المزيد (${remaining} متبقي)</button></td></tr>`);
            }

            tbody.innerHTML = rows.join('');
            tbody.querySelectorAll('button[data-action]').forEach(b => {
                b.onclick = () => {
                    if (b.dataset.action === 'dispense') this.showDispenseModal(b.dataset.id);
                    else if (b.dataset.action === 'receive') this.showReceiveModal(b.dataset.id);
                    else if (b.dataset.action === 'info') this.showDrugInfoModal(b.dataset.id);
                    // 🆕 v7.3: البطاقة تفتح صفحة كاملة بدل modal
                    else if (b.dataset.action === 'card') {
                        if (typeof App.openCardPage === 'function') App.openCardPage(b.dataset.id);
                        else if (typeof StockCardView !== 'undefined') StockCardView.open(b.dataset.id);
                        else showToast('وحدة بطاقة المادة غير محملة', 'error');
                    }
                };
            });
        };

        this._reRenderTable = renderVisible;
        renderVisible();
    },

    showAddModal() {
        if (!isStaff()) { showToast('لا تملك صلاحية الإضافة', 'error'); return; }
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'إضافة مادة جديدة');
        modal.innerHTML = `<div class="modal-content"><button class="modal-close" onclick="this.closest('.modal').remove()">✕</button>
            <h3>➕ إضافة مادة</h3>
            <div class="form-group"><label>الرمز الوطني *</label><input type="text" id="add-code" class="form-control" maxlength="30"></div>
            <div class="form-group"><label>الاسم العلمي</label><input type="text" id="add-name" class="form-control" maxlength="200"></div>
            <div class="form-group"><label>الوحدة</label><input type="text" id="add-unit" class="form-control" maxlength="50"></div>
            <div class="form-group"><label>الكمية الأولية</label><input type="number" id="add-qty" class="form-control" value="0" min="0"></div>
            <div class="form-group"><label>تاريخ الانتهاء</label><input type="date" id="add-expiry" class="form-control"></div>
            <div class="form-group"><label>الحد الأدنى</label><input type="number" id="add-minQty" class="form-control" value="0" min="0"></div>
            <div class="form-group"><label>الأولوية</label><select id="add-priority" class="form-control"><option value="">غير محدد</option><option>A1</option><option>A2</option><option>A</option><option>B</option><option>C</option></select></div>

            <button class="btn btn-success" onclick="App.saveNewItem()">💾 حفظ</button><button class="btn" onclick="this.closest('.modal').remove()">إلغاء</button>
            <p id="add-error" class="text-danger" style="margin-top:8px"></p></div>`;
        document.body.appendChild(modal);
        this.setupModalFocus(modal);
    },

    async saveNewItem() {
        const code = sanitizeInput(document.getElementById('add-code').value, 30);
        const errorEl = document.getElementById('add-error');
        if (!code) { errorEl.textContent = 'الرمز الوطني إلزامي — تنسيق: XX-XXX-XXX'; return; }
        if (await this.confirmAction(`إضافة "${code}"؟`)) {
            const name = sanitizeInput(document.getElementById('add-name').value, 200);
            const unit = normalizeUnit(sanitizeInput(document.getElementById('add-unit').value, 50));
            const qty = parseInt(document.getElementById('add-qty').value) || 0;
            const minQty = parseInt(document.getElementById('add-minQty').value) || 0;
            const importPriority = document.getElementById('add-priority').value;
            const expInput = document.getElementById('add-expiry').value;
            const earliestExpiry = expInput ? dateInputToTimestamp(expInput) : null;

            // 🔴 v7.5 #16: حلّ تصادم Document IDs
            // كان في v7.4: code.replace(/[\/\\\.\#\$\[\]]/g, '_') → 
            //   "01.234" و "01_234" يصيران نفس docId
            // الحل في v7.5:
            //   - sanitization أوسع (يشمل أرقام عربية، spaces، tabs، newlines)
            //   - فحص field-level على الـ code قبل الإضافة (يكتشف التصادم بالـ code الأصلي)
            //   - إذا الـ safeDocId مستخدم لكنه لـ code مختلف → نرفض ونرفع خطأ
            const safeDocId = code
                .replace(/[\/\\\.\#\$\[\]\s\u200C-\u200F]/g, '_')  // أوسع
                .replace(/_+/g, '_')                                  // دمج _ متكررة
                .replace(/^_|_$/g, '')                                // إزالة _ في البداية/النهاية
                .slice(0, 100) || 'item';
            const itemRef = db.collection('departments').doc(CURRENT_DEPT).collection('inventory').doc(safeDocId);

            try {
                // فحص field-level أوّلاً: هل code موجود فعلاً؟ (يكتشف تصادمات sanitization)
                const codeCheck = await db.collection('departments').doc(CURRENT_DEPT)
                    .collection('inventory').where('code', '==', code).limit(1).get();
                if (!codeCheck.empty) {
                    throw new Error('DUPLICATE_CODE');
                }
                
                let docRef = null;
                await db.runTransaction(async tx => {
                    const existingSnap = await tx.get(itemRef);
                    if (existingSnap.exists) {
                        // الـ docId مستخدم — هذا يعني تصادم sanitization (code مختلف، نفس safeDocId)
                        throw new Error('DOCID_COLLISION');
                    }
                    tx.set(itemRef, {
                        code, name, unit, quantity: qty, minQuantity: minQty,
                        importPriority: importPriority || null,
                        earliestExpiry,
                        depletionDate: null,
                        // 🔴 v7.5 #18: serverTimestamp بدل Timestamp.now()
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        createdBy: CU.email,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        source: 'manual_entry', category: CURRENT_DEPT
                    });
                    docRef = itemRef;

                    // إنشاء دفعة افتتاحية إذا كانت الكمية > 0
                    if (qty > 0) {
                        const batchRef = itemRef.collection('batches').doc();
                        tx.set(batchRef, {
                            batchNumber: 'OPENING',
                            quantity: qty,
                            expiryDate: earliestExpiry || null,
                            receivedDate: firebase.firestore.FieldValue.serverTimestamp(),
                            source: 'افتتاحي',
                            isOpeningBalance: true,
                            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                            createdBy: CU.email
                        });
                    }

                    // auditLog داخل Transaction لضمان الترابط
                    tx.set(db.collection('auditLog').doc(), {
                        action: 'add_item', itemId: safeDocId, itemName: name, code,
                        dept: CURRENT_DEPT, qty,
                        by: CU.email, byUid: CU.uid,
                        at: firebase.firestore.FieldValue.serverTimestamp()
                    });
                });

                AppState.inventory.set(safeDocId, {
                    id: safeDocId, code, name, unit, quantity: qty, minQuantity: minQty,
                    importPriority,
                    earliestExpiry, depletionDate: null
                });
                itemsCache = [...AppState.inventory.values()];
                document.querySelector('.modal').remove();
                showToast('✅ تمت الإضافة', 'success');
                this.renderTable(itemsCache);
                this._saveInstantNotif('instant_add',
                    `➕ مادة جديدة: ${name}`,
                    `الرمز: ${code || '—'} | الوحدة: ${unit}
الرصيد الأولي: ${qty} | القسم: ${DEPT_NAMES[CURRENT_DEPT] || CURRENT_DEPT}
المسؤول: ${CU.email}`,
                    [{ code: code || '—', name, batchNumber: qty > 0 ? 'OPENING' : '—', quantity: qty, expiryDate: '—' }]
                ).catch(() => {});
            } catch (e) {
                if (e.message === 'DUPLICATE_CODE') {
                    errorEl.textContent = 'هذا الرمز موجود مسبقاً — ابحث عنه في قائمة المخزون';
                } else if (e.message === 'DOCID_COLLISION') {
                    // 🔴 v7.5 #16: تصادم safeDocId مع رمز آخر (مثل 01.234 و 01_234)
                    errorEl.textContent = 'تصادم في معرّف المادة — هذا الرمز مشابه لرمز آخر. عدّل الرمز قليلاً ثم حاول.';
                } else {
                    errorEl.textContent = handleFirestoreError(e, 'saveNewItem');
                }
            }
        }
    },

    showDispenseModal(itemId) {
        if (!isStaff()) { showToast('لا تملك صلاحية الصرف', 'error'); return; }
        const itemData = AppState.inventory.get(itemId);
        if (!itemData) { showToast('المادة غير موجودة', 'error'); return; }
        if (itemData.quantity <= 0) { showToast('الكمية صفر', 'error'); return; }
        let batchesHTML = '<option value="">🔄 FEFO تلقائي (يوزَّع على كل الدفعات)</option>';
        let validBatches = [];
        const snapPromise = db.collection('departments').doc(CURRENT_DEPT).collection('inventory').doc(itemId)
            .collection('batches').where('quantity', '>', 0).get();

        snapPromise.then(snap => {
            const allBatches = snap.docs.map(b => ({ id: b.id, ...b.data() }))
                .sort((a, b) => (a.expiryDate?.toMillis?.() ?? Infinity) - (b.expiryDate?.toMillis?.() ?? Infinity));
            const now = new Date();
            allBatches.forEach(bd => {
                const exp = bd.expiryDate?.toDate?.();
                const valid = exp && exp > now;
                if (valid) validBatches.push({ id: bd.id, batchNumber: bd.batchNumber || bd.id, quantity: bd.quantity, expiryDate: bd.expiryDate });
                const expIso = exp ? exp.toISOString() : '';
                const expDisplay = exp ? exp.toLocaleDateString('en-GB', { calendar: 'gregory', numberingSystem: 'latn' }) : '؟';
                // ⚠️ data-expiry-iso ISO format للحسابات
                batchesHTML += `<option value="${escapeHtml(bd.id)}" data-valid="${valid}" data-qty="${bd.quantity}" data-batch="${escapeHtml(bd.batchNumber||bd.id)}" data-expiry-iso="${expIso}">${escapeHtml(bd.batchNumber||bd.id)} | ${bd.quantity} | ${expDisplay} ${valid?'':'⚠️'}</option>`;
            });
            const batchSelect = document.getElementById('disp-batch');
            if (batchSelect) batchSelect.innerHTML = batchesHTML;
            if (!validBatches.length) showToast('لا توجد دفعات صالحة', 'warning');
            // إعادة تحميل المعاينة
            this.calcFefoPreview(itemId, itemData);
        }).catch(e => showToast('فشل تحميل الدفعات', 'error'));

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', `صرف ${escapeHtml(itemData.name)}`);
        modal.innerHTML = `<div class="modal-content"><button class="modal-close" onclick="this.closest('.modal').remove()">✕</button>
            <h3>📤 صرف ${escapeHtml(itemData.name)}</h3><p>الكمية: <strong>${itemData.quantity}</strong> ${escapeHtml(itemData.unit||'')}</p>
            <div id="fefo-preview" style="margin-bottom:8px"></div>
            <div class="form-group"><label>تاريخ الصرف</label><input type="date" id="disp-date" class="form-control" value="${new Date().toISOString().split('T')[0]}"></div>
            <div class="form-group"><label>الكمية</label><input type="number" id="disp-qty" class="form-control" min="1" max="${itemData.quantity}" value="1" oninput="App.updateFefoPreview('${escapeHtml(itemId)}')"></div>
            <div class="form-group"><label>الدفعة (FEFO)</label><select id="disp-batch" class="form-control" oninput="App.updateFefoPreview('${escapeHtml(itemId)}')">${batchesHTML}</select></div>
            <div id="expiry-warning" class="alert-box alert-warning" style="display:none"></div>
            <div class="form-group">
                <label>نوع الصرف</label>
                <div id="disp-type-toggle" style="display:flex;gap:0;margin-top:6px;border-radius:var(--radius-sm);overflow:hidden;border:1px solid var(--border2)">
                    <label id="disp-type-need-label" style="flex:1;display:flex;align-items:center;justify-content:center;gap:4px;padding:10px;cursor:pointer;font-weight:600;background:var(--success-dim);color:var(--success);transition:all var(--t-fast);font-size:0.78rem">
                        <input type="radio" name="disp-type" value="need" checked style="display:none">
                        ✅ احتياج
                    </label>
                    <label id="disp-type-waste-label" style="flex:1;display:flex;align-items:center;justify-content:center;gap:4px;padding:10px;cursor:pointer;font-weight:normal;border-right:1px solid var(--border2);transition:all var(--t-fast);font-size:0.78rem">
                        <input type="radio" name="disp-type" value="wastage" style="display:none">
                        ⚠️ هدر
                    </label>
                </div>
            </div>
            <div id="disp-dest-group" class="form-group"><label>الجهة *</label><select id="disp-dest" class="form-control"><option value="">-- اختر --</option>${Object.keys(DESTINATIONS).map(k=>`<option value="${k}">${k}</option>`).join('')}</select></div>
            <div class="form-group" id="sub-dest-group" style="display:none"><label>الجهة الفرعية</label><div id="sub-dest-container"></div></div>
            <div class="form-group"><label>رقم الوثيقة</label><input type="text" id="disp-doc-no" class="form-control" placeholder="رقم وصل/أمر الصرف (اختياري)" maxlength="50"></div>
            <div class="form-group"><label>ملاحظات</label><input type="text" id="disp-notes" class="form-control" maxlength="300"></div>
            <div class="form-group" id="disp-waste-reason-group" style="display:none"><label>سبب الهدر *</label><input type="text" id="disp-waste-reason" class="form-control" placeholder="منتهي الصلاحية / تالف / مكسور..." maxlength="300"></div>
            <button class="btn btn-primary" id="dispense-btn">✅ تأكيد</button><button class="btn" onclick="this.closest('.modal').remove()">إلغاء</button>
            <p id="disp-error" class="text-danger" style="margin-top:10px"></p></div>`;
        document.body.appendChild(modal);
        this.setupModalFocus(modal);
        document.getElementById('disp-dest').onchange = function() {
            const dest = DESTINATIONS[this.value];
            const sg = document.getElementById('sub-dest-group');
            const sc = document.getElementById('sub-dest-container');
            if (Array.isArray(dest)) { sg.style.display = 'block'; sc.innerHTML = `<select id="disp-sub-dest" class="form-control">${dest.map(d=>`<option value="${d}">${d}</option>`).join('')}</select>`; }
            else if (dest === 'text') { sg.style.display = 'block'; sc.innerHTML = '<input type="text" id="disp-sub-dest" class="form-control" placeholder="الجناح / القاعة">'; }
            else { sg.style.display = 'none'; sc.innerHTML = ''; }
        };
        document.querySelectorAll('input[name="disp-type"]').forEach(radio => {
            radio.addEventListener('change', function() {
                const val = this.value;
                const needLabel = document.getElementById('disp-type-need-label');
                const wasteLabel = document.getElementById('disp-type-waste-label');
                const wasteGroup = document.getElementById('disp-waste-reason-group');
                const destGroup = document.getElementById('disp-dest-group');

                // إخفاء كل الحقول الخاصة
                wasteGroup.style.display = 'none';

                // إعادة تعيين كل الـ labels
                [needLabel, wasteLabel].forEach(l => {
                    l.style.background = '';
                    l.style.color = '';
                    l.style.fontWeight = 'normal';
                });

                if (val === 'wastage') {
                    wasteGroup.style.display = 'block';
                    destGroup.style.display = 'block'; // للهدر، الجهة لازم تكون موجودة (داخلية حتى لو هدر)
                    wasteLabel.style.background = 'var(--warning-dim)';
                    wasteLabel.style.color = 'var(--warning)';
                    wasteLabel.style.fontWeight = '600';
                } else {
                    destGroup.style.display = 'block';
                    needLabel.style.background = 'var(--success-dim)';
                    needLabel.style.color = 'var(--success)';
                    needLabel.style.fontWeight = '600';
                }
            });
        });
        document.getElementById('dispense-btn').onclick = () => this.safeDispense(itemId, itemData);
        this.calcFefoPreview(itemId, itemData);
    },

    calcFefoDistribution(validBatches, requestedQty) {
        // 🔴 v7.1 Bug #8: فلترة دفاعية للدفعات المنتهية والكميات الصفرية
        // (قد لا يفلتر المُتصل دائماً، فنحمي أنفسنا)
        const nowMs = Date.now();
        const filtered = validBatches.filter(b => {
            if (!b || (b.quantity || 0) <= 0) return false;
            const expMs = b.expiryDate instanceof Date
                ? b.expiryDate.getTime()
                : (b.expiryDate?.toMillis?.() ?? Infinity);
            return expMs > nowMs;  // ✅ منتهية تُستبعد
        });

        // 🔴 v7.1 Bug #5: null/undefined expiry → Infinity (sort LAST)
        // 🟢 v7.1 Bug #9: ترتيب ثانوي بـ receivedDate (الأقدم استلاماً أولاً عند تساوي الانتهاء)
        const sorted = filtered.sort((a, b) => {
            const aMs = a.expiryDate instanceof Date ? a.expiryDate.getTime() : (a.expiryDate?.toMillis?.() ?? Infinity);
            const bMs = b.expiryDate instanceof Date ? b.expiryDate.getTime() : (b.expiryDate?.toMillis?.() ?? Infinity);
            if (aMs !== bMs) return aMs - bMs;
            // ترتيب ثانوي: الأقدم استلاماً
            const aRcv = a.receivedDate instanceof Date ? a.receivedDate.getTime() : (a.receivedDate?.toMillis?.() ?? Infinity);
            const bRcv = b.receivedDate instanceof Date ? b.receivedDate.getTime() : (b.receivedDate?.toMillis?.() ?? Infinity);
            return aRcv - bRcv;
        });

        const plan = [];
        let remaining = requestedQty;
        for (const batch of sorted) {
            if (remaining <= 0) break;
            const take = Math.min(remaining, batch.quantity);
            plan.push({ ...batch, take });
            remaining -= take;
        }
        return { plan, canFulfill: remaining === 0, shortage: remaining };
    },

    async calcFefoPreview(itemId, itemData) {
        const qty = parseInt(document.getElementById('disp-qty')?.value) || 0;
        if (qty <= 0) return;
        const validBatches = [];
        const batchSelect = document.getElementById('disp-batch');
        if (!batchSelect) return;
        for (const opt of batchSelect.options) {
            if (opt.dataset.valid === 'true') {
                // ⚠️ استخدام expiryIso (ISO format) بدلاً من التاريخ العربي
                const expIso = opt.dataset.expiryIso;
                const expDate = expIso ? new Date(expIso) : null;
                validBatches.push({
                    id: opt.value,
                    batchNumber: opt.dataset.batch || opt.textContent.split(' | ')[0],
                    quantity: parseInt(opt.dataset.qty) || 0,
                    expiryDate: expDate && !isNaN(expDate.getTime()) ? expDate : null
                });
            }
        }
        const distribution = this.calcFefoDistribution(validBatches, qty);
        const previewEl = document.getElementById('fefo-preview');
        if (!previewEl) return;
        previewEl.innerHTML = distribution.canFulfill ? `
            <div class="alert-box alert-info" style="margin-bottom:8px">
                <div style="font-size:0.75rem;font-weight:600;margin-bottom:4px">🔄 توزيع FEFO المقترح</div>
                ${distribution.plan.map(p => `<div style="font-size:0.72rem">${escapeHtml(p.batchNumber)} — ${p.take} ${escapeHtml(itemData.unit||'')} (ينتهي: ${p.expiryDate?.toLocaleDateString('en-GB', { calendar: 'gregory', numberingSystem: 'latn' })||'—'})</div>`).join('')}
            </div>` : `<div class="alert-box alert-warning">⚠️ الكمية المطلوبة (${qty}) أكبر من المتوفر في الدفعات الصالحة (${validBatches.reduce((s,b)=>s+b.quantity,0)})</div>`;
    },

    updateFefoPreview(itemId) {
        const itemData = AppState.inventory.get(itemId);
        if (itemData) this.calcFefoPreview(itemId, itemData);
    },

    async safeDispense(itemId, itemData) {
        // 🔧 v6.8.1: فحص اتصال فعلي قبل البدء (وليس navigator.onLine فقط)
        const connected = await ConnectionMonitor.requireConnection('الصرف');
        if (!connected) return;
        const qty = parseInt(document.getElementById('disp-qty')?.value);
        const batchId = document.getElementById('disp-batch')?.value;
        const destMain = sanitizeInput(document.getElementById('disp-dest')?.value || '', 100);
        const subDest = sanitizeInput(document.getElementById('disp-sub-dest')?.value || '', 100);
        const notes = sanitizeInput(document.getElementById('disp-notes')?.value, 300);
        const dispensingType = document.querySelector('input[name="disp-type"]:checked')?.value || 'need';
        const wasteReason = sanitizeInput(document.getElementById('disp-waste-reason')?.value, 300);
        const documentNo = sanitizeInput(document.getElementById('disp-doc-no')?.value || '', 50);

        // 🔧 v7.2: حُذف transfer — فقط need / wastage
        let dispensingCat, movementSubType, finalDestMain, finalSubDest;
        if (dispensingType === 'wastage') {
            dispensingCat = 'waste';
            movementSubType = 'wastage';
            finalDestMain = destMain || 'هدر';
            finalSubDest = subDest;
        } else {
            dispensingCat = 'routine';
            movementSubType = 'dispense';
            finalDestMain = destMain;
            finalSubDest = subDest;
        }

        const errorEl = document.getElementById('disp-error');
        if (dispensingType === 'wastage' && !wasteReason) { errorEl.textContent = 'سبب الهدر إلزامي'; return; }
        if (dispensingType === 'need' && !destMain) { errorEl.textContent = 'حدد الجهة المستلمة للدواء'; return; }
        if (!qty || qty <= 0) { errorEl.textContent = 'أدخل كمية أكبر من صفر'; return; }

        const now = Date.now();
        if (now - (lastDispenseTime[CU.uid] || 0) < RATE_LIMIT_MS) { errorEl.textContent = 'انتظر 3 ثوانٍ'; return; }

        const itemRef = db.collection('departments').doc(CURRENT_DEPT).collection('inventory').doc(itemId);

        // ===== بناء خطة الصرف =====
        const isAutoFefo = !batchId;
        let plan = [];
        try {
            if (batchId) {
                const bs = await itemRef.collection('batches').doc(batchId).get();
                if (!bs.exists) { errorEl.textContent = 'الدفعة المختارة غير موجودة'; return; }
                const bd = bs.data();
                if ((bd.quantity || 0) < qty) { errorEl.textContent = `الدفعة تحوي ${bd.quantity||0} فقط — أقل من ${qty}`; return; }
                const bExp = bd.expiryDate?.toDate?.();
                if (bExp && bExp <= new Date() && dispensingType !== 'wastage') {
                    if (!await this.confirmAction('الدفعة منتهية الصلاحية — متأكد من الصرف منها؟ (يُفضَّل تسجيلها كهدر)')) return;
                }
                plan = [{ id: batchId, batchNumber: bd.batchNumber || batchId, take: qty }];
            } else {
                const bs = await itemRef.collection('batches').where('quantity', '>', 0).get();
                const allBatches = bs.docs.map(b => ({ id: b.id, ...b.data() }));
                const validBatches = allBatches.filter(b => {
                    const e = b.expiryDate?.toDate?.();
                    return e && e > new Date();
                });
                const dist = this.calcFefoDistribution(validBatches, qty);
                if (!dist.canFulfill) {
                    const avail = validBatches.reduce((s, b) => s + (b.quantity || 0), 0);
                    errorEl.textContent = `الكمية المطلوبة (${qty}) أكبر من المتوفر في الدفعات الصالحة (${avail})`;
                    return;
                }
                plan = dist.plan.map(p => ({ id: p.id, batchNumber: p.batchNumber, take: p.take }));
            }
        } catch (e) {
            errorEl.textContent = handleFirestoreError(e, 'safeDispense:planning');
            return;
        }

        // ===== تأكيد =====
        const currentItem = AppState.inventory.get(itemId);
        const planDesc = plan.length === 1
            ? `من دفعة ${plan[0].batchNumber}`
            : `موزَّعة على ${plan.length} دفعات (FEFO)`;
        const typeLabel = dispensingType === 'wastage' ? 'هدر' : 'صرف';
        if (currentItem && qty / (currentItem.quantity || 1) > 0.5) {
            const pct = Math.round((qty / currentItem.quantity) * 100);
            if (!await this.confirmAction(`${typeLabel} ${qty} (${pct}% من الرصيد) ${planDesc}. متأكد؟`)) return;
        } else {
            if (!await this.confirmAction(`${typeLabel} ${qty} ${planDesc} إلى ${finalDestMain}؟`)) return;
        }

        // ===== التنفيذ الذرّي =====
        let _finalQty = 0;
        let _movementBatches = [];
        try {
            await db.runTransaction(async tx => {
                // 🔧 v6.8.1: فحص تفرّد documentNo داخل Transaction (قبل أي قراءة أخرى)
                const docRefDoc = await checkDocumentNoUnique(tx, CURRENT_DEPT, documentNo);
                
                const itemSnap = await tx.get(itemRef);
                if (!itemSnap.exists) throw new Error('المادة غير موجودة');
                const batchRefs = plan.map(p => itemRef.collection('batches').doc(p.id));
                const batchSnaps = await Promise.all(batchRefs.map(r => tx.get(r)));

                const curQty = itemSnap.data().quantity || 0;
                if (qty > curQty) throw new Error(`الكمية المطلوبة (${qty}) أكبر من المتوفر الحالي (${curQty}) — أعد المحاولة`);
                for (let i = 0; i < plan.length; i++) {
                    if (!batchSnaps[i].exists) throw new Error(`الدفعة ${plan[i].batchNumber} لم تعد موجودة`);
                    const bQty = batchSnaps[i].data().quantity || 0;
                    if (plan[i].take > bQty) throw new Error(`دفعة ${plan[i].batchNumber}: الكمية تغيرت (متوفر ${bQty}) — أعد المحاولة`);
                }

                const newItemQty = curQty - qty;
                _finalQty = newItemQty;
                tx.update(itemRef, {
                    quantity: newItemQty,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    depletionDate: newItemQty === 0 ? firebase.firestore.Timestamp.now() : (itemSnap.data().depletionDate || null)
                });

                const batchesForMovement = [];
                for (let i = 0; i < plan.length; i++) {
                    const bData = batchSnaps[i].data();
                    const newBQty = (bData.quantity || 0) - plan[i].take;
                    if (newBQty <= 0) tx.update(batchRefs[i], { quantity: 0, depletedAt: firebase.firestore.Timestamp.now(), depletedBy: CU.email, depletedReason: dispensingType });
                    else tx.update(batchRefs[i], { quantity: newBQty });
                    batchesForMovement.push({
                        batchId: plan[i].id,
                        batchNumber: bData.batchNumber || plan[i].batchNumber,
                        quantity: plan[i].take,
                        expiryDate: bData.expiryDate || null,
                        source: bData.source || ''
                    });
                }
                _movementBatches = batchesForMovement;

                const firstBatch = batchesForMovement[0];
                const movRef = db.collection('departments').doc(CURRENT_DEPT).collection('movements').doc();
                tx.set(movRef, {
                    inventoryId: itemId, code: itemData.code || '', name: itemData.name || '', unit: itemData.unit || '',
                    movType: 'out',
                    movementSubType,
                    dispensingCategory: dispensingCat,
                    dispensingType,
                    quantity: qty, quantityBefore: curQty, quantityAfter: newItemQty,
                    destination: { main: finalDestMain, sub: finalSubDest },
                    dept: CURRENT_DEPT,
                    source: firstBatch.source,
                    batchNumber: firstBatch.batchNumber,
                    expiryDate: firstBatch.expiryDate,
                    batches: batchesForMovement,
                    isMultiBatch: batchesForMovement.length > 1,
                    fefoAuto: isAutoFefo,
                    documentNo,
                    notes: dispensingType === 'wastage' ? wasteReason : notes,
                    wasteReason: dispensingType === 'wastage' ? wasteReason : null,
                    dispensingDate: dateInputToTimestamp(document.getElementById('disp-date')?.value),
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    createdBy: CU.email, createdByName: CU.name, createdByKadre: KADRE_LABELS[CU.role]
                });

                tx.set(db.collection('auditLog').doc(), {
                    action: dispensingType === 'wastage' ? 'wastage' : 'dispense',
                    itemId, itemName: itemData.name, dept: CURRENT_DEPT,
                    qty, qtyBefore: curQty, qtyAfter: newItemQty,
                    batchCount: batchesForMovement.length,
                    documentNo,
                    reason: `${typeLabel} ${plan.length===1?'من دفعة واحدة':`موزَّع على ${plan.length} دفعات`} إلى ${finalDestMain}`,
                    by: CU.email, byUid: CU.uid,
                    at: firebase.firestore.FieldValue.serverTimestamp(),
                    sessionId: generateUUID()
                });
                
                // 🔧 v6.8.1: كتابة documentRef لضمان التفرّد
                writeDocumentRef(tx, docRefDoc, {
                    kind: 'single_dispense',
                    movementIds: [movRef.id],
                    itemCount: 1,
                    totalUnits: qty,
                    summary: `${typeLabel} ${itemData.name || ''} (${qty})`
                });
            });

            updateAppState(itemId, { quantity: _finalQty, depletionDate: _finalQty === 0 ? new Date() : null });
            const updItem = AppState.inventory.get(itemId);
            // 🔴 v7.5 #24: تسجيل فشل addToSupplyQueue (مهم للـ purchasing flow)
            if (updItem && _finalQty <= (updItem.minQuantity || 0)) {
                addToSupplyQueue(itemId, updItem, _finalQty).catch(e =>
                    console.warn(`addToSupplyQueue(${itemId}):`, e.message)
                );
            }

            const _batchRows = _movementBatches.map(b => ({
                code: itemData.code || '—',
                name: itemData.name || '—',
                batchNumber: b.batchNumber || '—',
                quantity: b.quantity,
                expiryDate: b.expiryDate?.toDate?.().toLocaleDateString('en-GB', { calendar: 'gregory', numberingSystem: 'latn' }) || '—'
            }));
            if (_finalQty === 0) {
                this._saveInstantNotif('instant_low', `📉 نفاد مخزون: ${itemData.name}`, `الرمز: ${itemData.code||'—'} | القسم: ${DEPT_NAMES[CURRENT_DEPT]||CURRENT_DEPT}
المسؤول: ${CU.email}`, _batchRows).catch(() => {});
            } else if (updItem && _finalQty <= (updItem.minQuantity || 0)) {
                this._saveInstantNotif('instant_low', `⚠️ رصيد تحت الحد: ${itemData.name}`, `الرصيد: ${_finalQty} | الحد الأدنى: ${updItem.minQuantity||0}
القسم: ${DEPT_NAMES[CURRENT_DEPT]||CURRENT_DEPT}`, _batchRows).catch(() => {});
            }
            if (dispensingType === 'wastage') {
                this._saveInstantNotif('instant_wastage', `⚠️ هدر مسجَّل: ${itemData.name}`, `الكمية: ${qty} ${itemData.unit||''}
السبب: ${wasteReason||'—'}
المسؤول: ${CU.email}`, _batchRows).catch(() => {});
            }
            // 🔴 v7.5 #24: تسجيل فشل recalcEarliestExpiry (اتساق البيانات)
            recalcEarliestExpiry(CURRENT_DEPT, itemId).catch(e =>
                console.warn(`recalcEarliestExpiry(${itemId}):`, e.message)
            );
            lastDispenseTime[CU.uid] = now;
            document.querySelector('.modal').remove();
            const successMsg = (plan.length > 1
                ? `✅ تم صرف ${qty} موزَّع على ${plan.length} دفعات (FEFO)`
                : '✅ تم الصرف');
            showToast(successMsg, 'success');
            MovementsCache.clear();
            LedgerCacheV2.clear();
            // 🔴 v7.5 #21: مسح cache التقارير بعد كل صرف (كان مفقوداً)
            if (typeof ReportCache !== 'undefined') ReportCache.invalidateAfterMovement(CURRENT_DEPT);
            SessionCounter?.inc?.('dispense');

            // 🆕 v7.3: فحوصات الإشعارات
            App.checkAnomalyAndNotify?.(itemId, qty);
            const _dispDateInput = document.getElementById('disp-date')?.value;
            if (_dispDateInput) {
                // 🔴 v7.5 #17: حساب daysBack بـ Baghdad TZ (كان يستعمل local time للعميل)
                // كان: Math.floor((new Date() - dispDateObj) / 86400000) ← false positives
                // الآن: استخدام isMovementBackdated الذي يحوّل لـ Asia/Baghdad
                if (typeof isMovementBackdated === 'function') {
                    const mockMov = {
                        dispensingDate: { toDate: () => new Date(_dispDateInput) },
                        createdAt: { toDate: () => new Date() }
                    };
                    const { isBackdated, daysBack } = isMovementBackdated(mockMov, 48);
                    if (isBackdated && daysBack >= 1) {
                        App.notifyBackdatedMovement?.(itemId, qty, _dispDateInput, daysBack);
                    }
                }
            }

            const row = document.querySelector(`#inv-table tbody tr[data-id="${itemId}"]`);
            if (row) {
                const qCell = row.querySelector('[data-field="quantity"]');
                if (qCell) {
                    qCell.textContent = _finalQty;
                    qCell.style.color = 'var(--success)';
                    setTimeout(() => { qCell.style.color = ''; }, 1500);
                }
                if (_finalQty === 0) row.style.background = 'rgba(239,68,68,0.08)';
                else if (_finalQty <= (itemData.minQuantity || 0)) row.style.background = 'rgba(251,146,60,0.08)';
            } else { this.renderTable(itemsCache); }
        } catch (e) { errorEl.textContent = handleFirestoreError(e, 'safeDispense'); }
    },

    showReceiveModal(itemId) {
        if (!isStaff()) { showToast('لا تملك صلاحية', 'error'); return; }
        const item = AppState.inventory.get(itemId);
        if (!item) { showToast('المادة غير موجودة', 'error'); return; }

        // 🆕 v6.9: تنبيه cold-chain إن لزم
        const ccBadge = (typeof ColdChain !== 'undefined' && ColdChain.isColdChain(item))
            ? ColdChain.renderBadge(item, 'large') + ' '
            : '';

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', `استلام دفعة — ${escapeHtml(item.name)}`);
        modal.innerHTML = `<div class="modal-content"><button class="modal-close" onclick="this.closest('.modal').remove()">✕</button>
            <h3>📥 استلام دفعة - ${ccBadge}${escapeHtml(item.name)}</h3>
            <!-- 🆕 v6.9: زر OCR -->
            <div style="margin-bottom:10px">
                <button class="btn btn-sm" type="button" onclick="App.openOCRForReceive('${itemId}')"
                    style="background:rgba(129,140,248,0.15);color:#818cf8;border:1px solid #818cf8;width:100%">
                    📷 قراءة الورقة بـ OCR
                </button>
            </div>
            <div class="form-group"><label>تاريخ الاستلام *</label><input type="date" id="receive-date" class="form-control" value="${new Date().toISOString().split('T')[0]}"></div>
            <div class="form-group"><label>نوع الوارد</label><select id="receive-source" class="form-control">${SETTINGS.sources.map(s=>`<option value="${s}">${s}</option>`).join('')}</select></div>
            <div class="form-group"><label>الكمية *</label><input type="number" id="receive-qty" class="form-control" min="1" max="500000" value="1" oninput="(() => { const v=parseInt(this.value)||0; const warn=document.getElementById('receive-qty-warn'); if(warn) warn.style.display = v>50000?'block':'none'; })()">
                <div id="receive-qty-warn" class="alert-box alert-warning" style="display:none;margin-top:4px;padding:4px 8px;font-size:0.75rem">⚠️ كمية كبيرة جداً — تأكد من صحة الرقم</div>
            </div>
            <div class="form-group"><label>رقم الدفعة *</label><input type="text" id="receive-batch" class="form-control" maxlength="50"></div>
            <div class="form-group"><label>المصنّع (اختياري)</label><input type="text" id="receive-manufacturer" class="form-control" maxlength="100"></div>
            <div class="form-group"><label>تاريخ الانتهاء *</label><input type="date" id="receive-expiry" class="form-control"></div>
            <div class="form-group"><label>رقم الوثيقة</label><input type="text" id="receive-doc" class="form-control" maxlength="50"></div>
            <div class="form-group"><label>ملاحظات</label><textarea id="receive-notes" class="form-control" rows="2" maxlength="300"></textarea></div>
            <button class="btn btn-success" id="btn-save-receive">💾 استلام</button><button class="btn" onclick="this.closest('.modal').remove()">إلغاء</button>
            <p id="receive-error" class="text-danger" style="margin-top:10px"></p></div>`;
        document.body.appendChild(modal);
        this.setupModalFocus(modal);
        document.getElementById('btn-save-receive').onclick = () => this.saveReceive(itemId, item);

        // 🆕 v6.9: تنبيه cold-chain
        if (typeof ColdChain !== 'undefined' && ColdChain.isColdChain(item)) {
            setTimeout(() => ColdChain.showReceiveAlert(item), 200);
        }
    },

    // 🆕 v6.9: فتح OCR للوارد (يملأ النموذج تلقائياً)
    openOCRForReceive(itemId) {
        if (typeof OCRReceive === 'undefined') {
            showToast('وحدة OCR غير محملة', 'error');
            return;
        }

        OCRReceive.open((items, header) => {
            // ملء الحقول العامة
            if (header.date) {
                const el = document.getElementById('receive-date');
                if (el) el.value = header.date;
            }
            if (header.source) {
                const el = document.getElementById('receive-source');
                if (el && Array.from(el.options).some(o => o.value === header.source)) {
                    el.value = header.source;
                }
            }
            if (header.documentNo) {
                const el = document.getElementById('receive-doc');
                if (el) el.value = header.documentNo;
            }

            // إن كانت مادة واحدة، املأ الباقي
            if (items.length === 1) {
                const it = items[0];
                if (it.quantity) {
                    const el = document.getElementById('receive-qty');
                    if (el) { el.value = it.quantity; el.dispatchEvent(new Event('input')); }
                }
                if (it.batchNumber) {
                    const el = document.getElementById('receive-batch');
                    if (el) el.value = it.batchNumber;
                }
                if (it.expiryDate) {
                    const el = document.getElementById('receive-expiry');
                    if (el) {
                        // تحويل YYYY-MM إلى YYYY-MM-01
                        let exp = it.expiryDate;
                        if (/^\d{4}-\d{2}$/.test(exp)) exp += '-01';
                        el.value = exp;
                    }
                }
                if (it.manufacturer) {
                    const el = document.getElementById('receive-manufacturer');
                    if (el) el.value = it.manufacturer;
                }
                showToast('✓ تم ملء النموذج', 'success');
            } else if (items.length > 1) {
                // البحث عن مطابق للمادة الحالية
                const matched = items.find(it => it.matched?.item?.id === itemId);
                if (matched) {
                    if (matched.quantity) document.getElementById('receive-qty').value = matched.quantity;
                    if (matched.batchNumber) document.getElementById('receive-batch').value = matched.batchNumber;
                    if (matched.expiryDate) {
                        let exp = matched.expiryDate;
                        if (/^\d{4}-\d{2}$/.test(exp)) exp += '-01';
                        document.getElementById('receive-expiry').value = exp;
                    }
                    if (matched.manufacturer) document.getElementById('receive-manufacturer').value = matched.manufacturer;
                    showToast(`✓ ملء بيانات هذه المادة من ${items.length} مواد في الورقة`, 'success', 4000);
                } else {
                    showToast(`📋 ${items.length} مادة في الورقة - هذه ليست مطابقة`, 'warning', 4000);
                }
            }
        });
    },

    async saveReceive(itemId, item) {
        // 🔧 v6.8.1: فحص اتصال فعلي
        const connected = await ConnectionMonitor.requireConnection('استلام الوارد');
        if (!connected) return;
        const source = sanitizeInput(document.getElementById('receive-source').value, 50);
        const qty = parseInt(document.getElementById('receive-qty').value) || 0;
        const batchNumber = sanitizeInput(document.getElementById('receive-batch').value, 50);
        const manufacturer = sanitizeInput(document.getElementById('receive-manufacturer')?.value, 100);
        const expiryDate = document.getElementById('receive-expiry').value;
        const documentNo = sanitizeInput(document.getElementById('receive-doc').value, 50);
        const notes = sanitizeInput(document.getElementById('receive-notes').value, 300);
        const receivingDate = document.getElementById('receive-date').value;
        const errorEl = document.getElementById('receive-error');
        if (!qty || qty <= 0) { errorEl.textContent = 'أدخل كمية أكبر من صفر'; return; }
        if (qty > 500000) { errorEl.textContent = 'الكمية أكبر من الحد المسموح (500,000)'; return; }
        if (!batchNumber) { errorEl.textContent = 'رقم الدفعة إلزامي — أدخله كما هو مكتوب على العبوة'; return; }
        if (!expiryDate) { errorEl.textContent = 'تاريخ الانتهاء إلزامي — اختره من التقويم'; return; }
        const itemRef = db.collection('departments').doc(CURRENT_DEPT).collection('inventory').doc(itemId);
        
        // 🔴 v7.5 #10: استخدام batchId محسوب من رقم الدفعة (deterministic)
        // ✅ يمنع race condition: لا حاجة لـ pre-check خارج الـ transaction
        // ✅ tx.get داخل الـ transaction يفحص الوجود ذرّياً
        // الـ ID مبني من رقم الدفعة + hash من تاريخ الانتهاء (للتمييز بين دفعات
        // بنفس الرقم ومنتهيات مختلفة، وهو ممكن نادراً مع إعادة استعمال أرقام)
        const safeBatchNum = batchNumber.replace(/[\/\\\.\#\$\[\]]/g, '_').slice(0, 40);
        const expHash = newExpiry ? Math.abs((newExpiry.toMillis() / 86400000) | 0).toString(36) : 'noexp';
        const deterministicBatchId = `${safeBatchNum}__${expHash}`;
        
        // فحص استشاري للمستخدم (ليس أمان، فقط UX)
        try {
            const dupRef = itemRef.collection('batches').doc(deterministicBatchId);
            const dupSnap = await dupRef.get();
            if (dupSnap.exists) {
                const dupBatch = dupSnap.data();
                const dupQty = dupBatch.quantity || 0;
                const dupExp = dupBatch.expiryDate?.toDate?.()?.toLocaleDateString('en-GB', { calendar: 'gregory', numberingSystem: 'latn' }) || '—';
                const ok = await this.confirmAction(`⚠️ دفعة "${batchNumber}" موجودة (الكمية: ${dupQty} | الانتهاء: ${dupExp}).\n\nسيُضاف ${qty} إلى نفس الدفعة. تأكيد؟`);
                if (!ok) return;
            }
        } catch(e) {
            // 🔴 v7.5 #24: تسجيل بدل ابتلاع
            console.warn('dup check failed:', e.message);
        }
        if (!await this.confirmAction(`استلام ${qty} ${escapeHtml(item.unit)} من ${source}؟`)) return;
        const newExpiry = dateInputToTimestamp(expiryDate);
        let finalQty, finalEarliestExpiry;
        try {
            await db.runTransaction(async tx => {
                // 🔧 v6.8.1: فحص تفرّد documentNo
                const docRefDoc = await checkDocumentNoUnique(tx, CURRENT_DEPT, documentNo);
                
                const itemSnap = await tx.get(itemRef);
                if (!itemSnap.exists) throw new Error('المادة غير موجودة');
                const cur = itemSnap.data();
                const curQty = cur.quantity || 0;
                finalQty = curQty + qty;
                let curEarliest = cur.earliestExpiry;
                if (!curEarliest || newExpiry.toMillis() < curEarliest.toMillis()) curEarliest = newExpiry;
                finalEarliestExpiry = curEarliest;
                tx.update(itemRef, {
                    quantity: finalQty,
                    earliestExpiry: finalEarliestExpiry,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    depletionDate: null,
                    // 🔴 v7.5 #18: serverTimestamp بدل Timestamp.now() (وقت العميل قد يكون خاطئاً)
                    lastReceivedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    lastReceivedFrom: source
                });
                
                // 🔴 v7.5 #10: استخدام deterministicBatchId بدل auto-id
                // إذا الدفعة موجودة بنفس الرقم ونفس الانتهاء → ندمج (نزيد الكمية)
                // إذا غير موجودة → ننشئ
                // كل هذا داخل tx → atomic، لا race condition
                const batchRef = itemRef.collection('batches').doc(deterministicBatchId);
                const existingBatchSnap = await tx.get(batchRef);
                if (existingBatchSnap.exists) {
                    // دمج: زيادة الكمية، تحديث manufacturer لو فارغ
                    const existing = existingBatchSnap.data();
                    tx.update(batchRef, {
                        quantity: (existing.quantity || 0) + qty,
                        manufacturer: existing.manufacturer || manufacturer || null,
                        lastTopUpAt: firebase.firestore.FieldValue.serverTimestamp(),
                        lastTopUpQty: qty,
                        lastTopUpSource: source
                    });
                } else {
                    tx.set(batchRef, {
                        batchNumber,
                        manufacturer: manufacturer || null,
                        quantity: qty,
                        expiryDate: newExpiry,
                        source,
                        receivedDate: firebase.firestore.FieldValue.serverTimestamp(),
                        isOpeningBalance: source === 'افتتاحي'
                    });
                }
                const movRef = db.collection('departments').doc(CURRENT_DEPT).collection('movements').doc();
                // 🔧 v7.2: تحديد movementSubType - لا transfer_in بعد الآن
                let movSubType = 'dispense_circle';
                if (source === 'افتتاحي') movSubType = 'opening';
                else if (source === 'مشتريات') movSubType = 'purchase';

                tx.set(movRef, {
                    inventoryId: itemId, code: item.code || '', name: item.name || '', unit: item.unit || '',
                    movType: 'in',
                    movementSubType: movSubType,
                    quantity: qty, quantityBefore: curQty, quantityAfter: finalQty,
                    source, batchNumber, expiryDate: newExpiry, documentNo, notes,
                    dispensingDate: dateInputToTimestamp(receivingDate),
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    createdBy: CU.email, createdByName: CU.name, createdByKadre: KADRE_LABELS[CU.role],
                    dept: CURRENT_DEPT
                });
                tx.set(db.collection('auditLog').doc(), {
                    action: 'receive',
                    itemId, itemName: item.name, dept: CURRENT_DEPT,
                    qty, qtyBefore: curQty, qtyAfter: finalQty,
                    source,
                    by: CU.email, byUid: CU.uid,
                    at: firebase.firestore.FieldValue.serverTimestamp()
                });
                
                // 🔧 v6.8.1: كتابة documentRef لضمان التفرّد
                writeDocumentRef(tx, docRefDoc, {
                    kind: 'receive',
                    movementIds: [movRef.id],
                    itemCount: 1,
                    totalUnits: qty,
                    summary: `استلام ${item.name || ''} (${qty}) من ${source}`
                });
            });
            // 🔴 v7.5 #21: مسح cache التقارير بعد كل استلام
            if (typeof ReportCache !== 'undefined') ReportCache.invalidateAfterMovement(CURRENT_DEPT);
            updateAppState(itemId, { quantity: finalQty, earliestExpiry: finalEarliestExpiry, depletionDate: null, lastReceivedAt: new Date(), lastReceivedFrom: source });
            const rcvItem = AppState.inventory.get(itemId);
            this._saveInstantNotif('instant_receive',
                `📥 استلام وارد: ${rcvItem?.name || itemId}`,
                `الكمية: ${qty} ${rcvItem?.unit||''} | المصدر: ${source}
رقم الوجبة: ${batchNumber} | القسم: ${DEPT_NAMES[CURRENT_DEPT]||CURRENT_DEPT}
المسؤول: ${CU.email}`,
                [{ code: rcvItem?.code||'—', name: rcvItem?.name||'—', batchNumber: batchNumber, quantity: qty, expiryDate: expiryDate || '—' }]
            ).catch(() => {});
            await recalcEarliestExpiry(CURRENT_DEPT, itemId);
            document.querySelector('.modal').remove();
            showToast('✅ تم الاستلام', 'success');
            MovementsCache.clear();
            SessionCounter?.inc?.('receive');
            this.renderTable(itemsCache);
        } catch (e) { errorEl.textContent = handleFirestoreError(e, 'saveReceive'); }
    },

    async showDrugInfoModal(itemId) {
        const item = AppState.inventory.get(itemId);
        if (!item) { showToast('المادة غير موجودة', 'error'); return; }
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `<div class="modal-content"><button class="modal-close" onclick="this.closest('.modal').remove()">✕</button><h3>ℹ️ Drug Info</h3><div id="drug-info-content"><p class="text-muted">جاري البحث...</p></div></div>`;
        document.body.appendChild(modal);
        const container = document.getElementById('drug-info-content');
        try {
            const result = await this.fetchDrugInfo(item.name || '', item.unit || '', CURRENT_DEPT);
            if (result.error) {
                container.innerHTML = `<p class="text-muted">${escapeHtml(result.error)}</p><p class="text-muted">Source: ${escapeHtml(result.source)}</p>`;
            } else {
                let html = '<div style="background:var(--surface2);padding:1rem;border-radius:var(--radius-sm);font-family:monospace;white-space:pre-wrap">';
                if (result.data) {
                    const d = result.data;
                    if (d.results && d.results[0]) {
                        const r = d.results[0];
                        html += escapeHtml(`Name     : ${r.openfda?.generic_name?.[0]||item.name}\nBrand    : ${r.openfda?.brand_name?.[0]||'N/A'}\nCategory : ${r.openfda?.product_type?.[0]||'N/A'}\nWarnings : ${r.warnings?.[0]?r.warnings[0].substring(0,200):'N/A'}\n`);
                    }
                    else if (d.PC_Compounds) {
                        const c = d.PC_Compounds[0];
                        html += escapeHtml(`Name     : ${c?.props?.find(p=>p.urn.label==='IUPAC Name')?.value?.sval||item.name}\nFormula  : ${c?.props?.find(p=>p.urn.label==='Molecular Formula')?.value?.sval||'N/A'}\nWeight   : ${c?.props?.find(p=>p.urn.label==='Molecular Weight')?.value?.sval||'N/A'}\n`);
                    }
                    else html += 'Details retrieved successfully.\n';
                }
                html += '</div>';
                html += `<p class="text-muted" style="margin-top:8px">Source: ${escapeHtml(result.source)}</p>`;
                container.innerHTML = html;
            }
        } catch (e) { container.innerHTML = `<p class="text-danger">فشل البحث: ${escapeHtml(e.message)}</p>`; }
        container.innerHTML += `<div class="alert-box alert-warning" style="margin-top:10px;font-size:0.8rem">⚠️ المعلومات للاستئناس فقط — القرار للصيدلاني دائماً.<br>المصدر قاعدة بيانات أمريكية وقد تختلف عن المسجَّل في العراق.</div>`;
    },

    async fetchDrugInfo(name, unit, dept) {
        // 🔧 v6.8.1: cache في sessionStorage لمدة ساعة
        const cacheKey = `druginfo:${dept}:${name}:${unit}`;
        try {
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Date.now() - parsed.at < 60 * 60 * 1000) {
                    return parsed.result;
                }
            }
        } catch (e) { /* ignore */ }
        
        let url = '', source = '';
        if (dept === 'pharmacy') { url = `https://api.fda.gov/drug/label.json?search=openfda.generic_name:"${encodeURIComponent(name)}"&limit=1`; source = 'OpenFDA'; }
        else if (dept === 'medical_supplies') { url = `https://accessgudid.nlm.nih.gov/api/v2/devices/lookup.json?di=${encodeURIComponent(name)}`; source = 'GUDID (FDA)'; }
        else { url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/JSON`; source = 'PubChem'; }
        const controller = new AbortController();
        // 🔧 v6.8.1: timeout 5 ثوانٍ بدلاً من 8 (سرعة أعلى، يفشل أسرع)
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        let result;
        try {
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!res.ok) { result = { error: `HTTP ${res.status}`, source }; }
            else {
                const contentLength = parseInt(res.headers.get('content-length') || '0');
                if (contentLength > 2 * 1024 * 1024) { result = { error: 'الاستجابة كبيرة جداً (> 2MB)', source }; }
                else {
                    const text = await res.text();
                    if (text.length > 2 * 1024 * 1024) { result = { error: 'الاستجابة كبيرة جداً', source }; }
                    else {
                        const data = JSON.parse(text);
                        result = { data, source };
                    }
                }
            }
        } catch (e) {
            clearTimeout(timeoutId);
            if (e.name === 'AbortError') result = { error: 'انتهت مهلة الاتصال (5 ثوانٍ)', source };
            else result = { error: e.message || 'No data found', source };
        }
        // حفظ في cache (حتى لو خطأ - لتفادي spam)
        try {
            sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), result }));
        } catch (e) { /* ignore quota errors */ }
        return result;
    },

    setupModalFocus(modal) {
        setTimeout(() => {
            const firstFocusable = modal.querySelector('input:not([disabled]), select:not([disabled]), button:not([disabled])');
            firstFocusable?.focus();
        }, 50);
        modal.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') modal.remove();
            if (e.key !== 'Tab') return;
            const focusable = [...modal.querySelectorAll('input:not([disabled]), select:not([disabled]), button:not([disabled]), textarea:not([disabled])')].filter(el => el.offsetParent !== null);
            if (!focusable.length) return;
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        });
    },

    // ============================================================
    // 🆕 v7.3: إدخال طلبية متعددة الأصناف بنفس رقم الوثيقة
    // نموذج واحد لعدة مواد، Transaction واحدة
    // ============================================================
    showMultiReceiveModal() {
        if (!isStaff()) { showToast('لا تملك صلاحية الاستلام', 'error'); return; }

        const today = new Date().toISOString().split('T')[0];
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'multi-receive-modal';
        modal.innerHTML = `<div class="modal-content" style="max-width:720px;max-height:92vh;overflow-y:auto">
            <button class="modal-close" onclick="this.closest('.modal').remove()">✕</button>
            <h3>📥 استلام طلبية متعددة الأصناف</h3>
            <p class="text-muted" style="font-size:0.78rem;margin-bottom:10px">أدخل عدة مواد دفعة واحدة بنفس رقم الوثيقة (مثل قائمة تجهيز 0212582 فيها 3 مواد).</p>

            <div style="background:var(--surface2);padding:10px;border-radius:var(--radius-sm);margin-bottom:12px">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px">
                    <div class="form-group" style="margin:0">
                        <label>تاريخ الاستلام *</label>
                        <input type="date" id="mr-date" class="form-control" value="${today}">
                    </div>
                    <div class="form-group" style="margin:0">
                        <label>نوع الوارد *</label>
                        <select id="mr-source" class="form-control">${SETTINGS.sources.map(s=>`<option value="${s}">${s}</option>`).join('')}</select>
                    </div>
                </div>
                <div class="form-group" style="margin:0">
                    <label>رقم الوثيقة *</label>
                    <input type="text" id="mr-docno" class="form-control" placeholder="مثل: 0212582" maxlength="100">
                </div>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <strong style="font-size:0.85rem">المواد:</strong>
                <button class="btn btn-sm btn-primary" id="mr-add-row" type="button">+ إضافة مادة</button>
            </div>

            <div class="table-wrap" style="max-height:50vh">
                <table class="inventory-table" id="mr-table">
                    <thead><tr>
                        <th style="width:30%">المادة</th>
                        <th style="width:14%">الكمية</th>
                        <th style="width:18%">رقم الوجبة</th>
                        <th style="width:18%">تاريخ الانتهاء</th>
                        <th style="width:14%">المصنّع</th>
                        <th style="width:6%"></th>
                    </tr></thead>
                    <tbody id="mr-rows"></tbody>
                </table>
            </div>

            <p id="mr-error" class="text-danger" style="margin-top:8px;font-size:0.82rem"></p>
            <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
                <button class="btn" onclick="this.closest('.modal').remove()">إلغاء</button>
                <button class="btn btn-success" id="mr-save">💾 حفظ كل المواد</button>
            </div>
        </div>`;
        document.body.appendChild(modal);
        this.setupModalFocus(modal);

        this._mrRowCounter = 0;
        document.getElementById('mr-add-row').onclick = () => this._mrAddRow();
        document.getElementById('mr-save').onclick = () => this._mrSaveAll();
        this._mrAddRow(); // ابدأ بصف واحد
    },

    _mrAddRow() {
        const idx = ++this._mrRowCounter;
        const rows = document.getElementById('mr-rows');
        if (!rows) return;
        const items = [...AppState.inventory.values()];
        const opts = items.map(i =>
            `<option value="${escapeHtml(i.id)}" data-unit="${escapeHtml(i.unit||'')}" data-code="${escapeHtml(i.code||'')}" data-name="${escapeHtml(i.name||'')}">${escapeHtml(i.name||'')} | ${escapeHtml(i.code||'')}</option>`
        ).join('');
        const tr = document.createElement('tr');
        tr.dataset.rowId = idx;
        tr.innerHTML = `
            <td><select class="form-control mr-item" style="font-size:0.78rem"><option value="">-- اختر مادة --</option>${opts}</select></td>
            <td><input type="number" class="form-control mr-qty" min="1" max="500000" placeholder="0" style="font-size:0.78rem"></td>
            <td><input type="text" class="form-control mr-batch" maxlength="50" placeholder="B-..." style="font-size:0.78rem"></td>
            <td><input type="date" class="form-control mr-expiry" style="font-size:0.78rem"></td>
            <td><input type="text" class="form-control mr-mfg" maxlength="100" placeholder="(اختياري)" style="font-size:0.78rem"></td>
            <td style="text-align:center"><button class="btn btn-xs" onclick="this.closest('tr').remove()" style="background:var(--danger);color:white" title="حذف">✕</button></td>`;
        rows.appendChild(tr);
    },

    async _mrSaveAll() {
        const errorEl = document.getElementById('mr-error');
        const docNo = sanitizeInput(document.getElementById('mr-docno')?.value, 100);
        const dateInput = document.getElementById('mr-date')?.value;
        const source = document.getElementById('mr-source')?.value;

        if (!docNo) { errorEl.textContent = 'رقم الوثيقة إلزامي'; return; }
        if (!source) { errorEl.textContent = 'حدد نوع الوارد'; return; }

        const rowsEls = [...document.querySelectorAll('#mr-rows tr')];
        if (!rowsEls.length) { errorEl.textContent = 'أضف مادة واحدة على الأقل'; return; }

        // جمع البيانات والتحقق
        const rows = [];
        for (const tr of rowsEls) {
            const sel = tr.querySelector('.mr-item');
            const itemId = sel?.value;
            const itemOpt = sel?.selectedOptions[0];
            const qty = parseInt(tr.querySelector('.mr-qty')?.value) || 0;
            const batchNum = sanitizeInput(tr.querySelector('.mr-batch')?.value, 50);
            const expiry = tr.querySelector('.mr-expiry')?.value;
            const mfg = sanitizeInput(tr.querySelector('.mr-mfg')?.value, 100);

            if (!itemId) { errorEl.textContent = 'اختر مادة في كل الصفوف'; return; }
            if (!qty || qty <= 0) { errorEl.textContent = 'أدخل كمية أكبر من صفر لكل مادة'; return; }
            if (qty > 500000) { errorEl.textContent = `الكمية لـ ${itemOpt?.dataset?.name||''} أكبر من 500,000`; return; }
            if (!batchNum) { errorEl.textContent = `رقم الدفعة إلزامي لكل مادة (${itemOpt?.dataset?.name||''})`; return; }
            if (!expiry) { errorEl.textContent = `تاريخ الانتهاء إلزامي لكل مادة (${itemOpt?.dataset?.name||''})`; return; }

            rows.push({
                itemId,
                itemName: itemOpt.dataset.name || '',
                itemCode: itemOpt.dataset.code || '',
                itemUnit: itemOpt.dataset.unit || '',
                qty, batchNum, expiry, mfg
            });
        }

        // فحص مادة مكررة
        const seenIds = new Set();
        for (const r of rows) {
            if (seenIds.has(r.itemId)) {
                errorEl.textContent = `المادة "${r.itemName}" مكررة في الجدول`;
                return;
            }
            seenIds.add(r.itemId);
        }

        if (!await this.confirmAction(`استلام ${rows.length} مادة بنفس الوثيقة ${docNo}؟`)) return;

        const connected = await ConnectionMonitor.requireConnection('استلام طلبية متعددة');
        if (!connected) return;

        try {
            // عمل Transaction واحدة لكل المواد
            const dateTs = dateInput ? dateInputToTimestamp(dateInput) : firebase.firestore.Timestamp.now();
            const year = (dateInput ? new Date(dateInput) : new Date()).getFullYear();
            const movRefs = [];
            const finalQtys = {};

            await db.runTransaction(async tx => {
                const docRefDoc = await checkDocumentNoUnique(tx, CURRENT_DEPT, docNo);

                for (const r of rows) {
                    const itemRef = db.collection('departments').doc(CURRENT_DEPT)
                        .collection('inventory').doc(r.itemId);
                    const iSnap = await tx.get(itemRef);
                    if (!iSnap.exists) throw new Error(`المادة ${r.itemName} غير موجودة`);

                    const curQty = iSnap.data().quantity || 0;
                    const newQty = curQty + r.qty;
                    finalQtys[r.itemId] = newQty;

                    const expiryTs = dateInputToTimestamp(r.expiry);
                    const curEarliest = iSnap.data().earliestExpiry;
                    const newEarliest = (!curEarliest || expiryTs.toMillis() < curEarliest.toMillis())
                        ? expiryTs : curEarliest;

                    tx.update(itemRef, {
                        quantity: newQty,
                        earliestExpiry: newEarliest,
                        depletionDate: null,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        lastReceivedAt: firebase.firestore.Timestamp.now(),
                        lastReceivedFrom: source
                    });

                    const batchRef = itemRef.collection('batches').doc();
                    tx.set(batchRef, {
                        batchNumber: r.batchNum,
                        manufacturer: r.mfg || null,
                        quantity: r.qty,
                        expiryDate: expiryTs,
                        source,
                        receivedDate: firebase.firestore.Timestamp.now(),
                        isOpeningBalance: source === 'افتتاحي',
                        createdAt: firebase.firestore.Timestamp.now(),
                        createdBy: CU.email
                    });

                    let movSubType = 'dispense_circle';
                    if (source === 'افتتاحي') movSubType = 'opening';
                    else if (source === 'مشتريات') movSubType = 'purchase';

                    const movRef = db.collection('departments').doc(CURRENT_DEPT)
                        .collection('movements').doc();
                    movRefs.push(movRef.id);
                    tx.set(movRef, {
                        inventoryId: r.itemId, code: r.itemCode, name: r.itemName, unit: r.itemUnit,
                        movType: 'in',
                        movementSubType: movSubType,
                        quantity: r.qty, quantityBefore: curQty, quantityAfter: newQty,
                        source, purchaseYear: source === 'مشتريات' ? year : null,
                        batchNumber: r.batchNum, expiryDate: expiryTs,
                        manufacturer: r.mfg || null,
                        documentNo: docNo, dept: CURRENT_DEPT,
                        dispensingDate: dateTs,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        createdBy: CU.email, createdByName: CU.name, createdByKadre: KADRE_LABELS[CU.role]
                    });

                    tx.set(db.collection('auditLog').doc(), {
                        action: 'multi_receive',
                        itemId: r.itemId, itemName: r.itemName, dept: CURRENT_DEPT,
                        qty: r.qty, qtyBefore: curQty, qtyAfter: newQty,
                        source, documentNo: docNo,
                        by: CU.email, byUid: CU.uid,
                        at: firebase.firestore.FieldValue.serverTimestamp()
                    });
                }

                writeDocumentRef(tx, docRefDoc, {
                    kind: 'multi_receive',
                    movementIds: movRefs,
                    itemCount: rows.length,
                    totalUnits: rows.reduce((s, r) => s + r.qty, 0),
                    summary: `طلبية متعددة (${rows.length} مادة) — ${source} — وثيقة ${docNo}`
                });
            });

            // تحديث AppState
            for (const r of rows) {
                updateAppState(r.itemId, {
                    quantity: finalQtys[r.itemId],
                    depletionDate: null,
                    lastReceivedAt: new Date(),
                    lastReceivedFrom: source
                });
                recalcEarliestExpiry(CURRENT_DEPT, r.itemId).catch(() => {});
            }
            MovementsCache.clear();
            LedgerCacheV2.clear();
            document.querySelector('.modal').remove();
            showToast(`✅ تم استلام ${rows.length} مادة بنجاح`, 'success');
            this.renderTable(itemsCache);
        } catch (e) {
            errorEl.textContent = handleFirestoreError(e, '_mrSaveAll');
        }
    },
});
