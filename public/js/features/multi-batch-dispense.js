// ============================================================
// js/features/multi-batch-dispense.js
// نموذج "قائمة تجهيز" - يأخذ معلومات من الورقة الحكومية
// ============================================================
// 🔴 v6.8.2 (هذا الإصلاح):
// - استخدام writeDocumentRef helper بدل الكتابة inline (سكيما موحَّدة:
//   kind + summary مع باقي مسارات الكتابة)
// - استبدال O(n²) lookup `itemRefs.indexOf(itemRefs.find(...))` بـ idx من forEach
//   و `itemReads.find(ir => ir.item.fefoplan.some(...))` بـ `itemReads[itemIdx]`
// - حُذف itemIdx field الذي كان يُحسَب لكن لا يُستخدم
// ============================================================
// v6.6.1:
// - ✅ documentRefs بدلاً من dispenseDocuments (لا تكرار للبيانات)
// - ✅ فحص تفرّد documentNo داخل Transaction (atomic)
// - ✅ التاريخ في توقيت محلي صحيح (لا UTC midnight)
// - ✅ ConnectionMonitor.requireConnection() بدلاً من navigator.onLine
// - ✅ DraftManager لمنع فقدان البيانات عند الانقطاع
// - ✅ Try/catch شامل + استرجاع المسودة عند الفشل
// ============================================================

Object.assign(App, {

    _dispDocAutoSave: null,

    // ========== فتح نموذج قائمة التجهيز ==========
    async openDispenseDocument() {
        // فحص الصلاحية
        if (!isStaff()) {
            showToast('تحتاج صلاحية كادر للصرف', 'error');
            return;
        }
        
        // فحص اتصال موثوق (ليس navigator.onLine فقط)
        const ok = await ConnectionMonitor.requireConnection('فتح نموذج قائمة التجهيز');
        if (!ok) return;

        // التاريخ المحلي (بدون UTC issues)
        // 🔧 v6.8: استخدام توقيت بغداد (UTC+3) لتفادي drift في آخر اليوم
        const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: BAGHDAD_TZ }).format(new Date());

        const destOptions = Object.keys(DESTINATIONS).map(main => {
            const subs = DESTINATIONS[main];
            if (Array.isArray(subs)) {
                return subs.map(s => `<option value="${main}|${s}">${main} - ${s}</option>`).join('');
            } else {
                return `<option value="${main}|">${main}</option>`;
            }
        }).join('');

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'dispense-doc-modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:700px;max-height:90vh;overflow-y:auto">
                <button class="modal-close" onclick="App.closeDispenseDocument()">✕</button>
                <h3>📋 قائمة تجهيز جديدة</h3>
                <p class="text-muted" style="font-size:0.82rem;margin:4px 0 12px">
                    أدخل المعلومات من الورقة الحكومية + المواد المطلوبة
                </p>
                <div id="dd-draft-banner" style="display:none;background:#1e3a8a;padding:8px;border-radius:6px;margin:8px 0;font-size:0.85rem"></div>

                <div class="card" style="background:#1a2d45;padding:10px;margin:8px 0">
                    <h4 style="margin:0 0 8px;font-size:0.95rem">📄 معلومات الورقة</h4>
                    <div class="form-row" style="display:flex;gap:8px;margin:6px 0">
                        <div style="flex:1">
                            <label style="font-size:0.8rem">رقم الطلبية * (من الورقة)</label>
                            <div style="display:flex;gap:4px">
                                <input type="text" id="dd-doc-no" class="form-control" 
                                    placeholder="0212587" maxlength="20" required
                                    style="font-family:monospace;font-size:1.05rem;letter-spacing:1px;flex:1">
                                <button type="button" class="btn btn-sm" id="dd-ocr-btn" 
                                    onclick="App.openOCRForDocNo()" title="قراءة من صورة"
                                    style="background:var(--surface3);padding:6px 10px">📷</button>
                            </div>
                            <small id="dd-docno-hint" style="color:var(--muted);font-size:0.72rem"></small>
                        </div>
                        <div style="width:140px">
                            <label style="font-size:0.8rem">التاريخ *</label>
                            <input type="date" id="dd-date" class="form-control" value="${todayStr}" required>
                        </div>
                    </div>
                    <div style="margin:6px 0">
                        <label style="font-size:0.8rem">الجهة المستلمة *</label>
                        <select id="dd-destination" class="form-control" required>
                            <option value="">-- اختر الجهة --</option>
                            ${destOptions}
                        </select>
                        <div id="dd-custom-dest-wrapper" style="display:none;margin-top:4px">
                            <input type="text" id="dd-custom-dest" class="form-control" placeholder="اسم القسم في التمريض">
                        </div>
                    </div>
                    <div style="margin:6px 0">
                        <label style="font-size:0.8rem">ملاحظات (اختياري)</label>
                        <input type="text" id="dd-notes" class="form-control" maxlength="200">
                    </div>
                </div>

                <div class="card" style="padding:10px;margin:8px 0">
                    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
                        <h4 style="margin:0;font-size:0.95rem">💊 المواد <span id="dd-items-count" style="color:var(--primary)">(0)</span></h4>
                        <div style="display:flex;gap:6px;flex-wrap:wrap">
                            <button class="btn btn-sm" id="dd-ocr-btn" type="button" style="background:rgba(129,140,248,0.15);color:#818cf8;border:1px solid #818cf8">
                                📷 من صورة (OCR)
                            </button>
                            <button class="btn btn-sm btn-primary" id="dd-add-item-btn">+ إضافة مادة</button>
                        </div>
                    </div>
                    <div id="dd-items-list" style="margin-top:8px;min-height:60px">
                        <p class="text-muted" style="text-align:center;padding:20px;font-size:0.85rem">لم تُضَف أي مادة بعد.</p>
                    </div>
                </div>

                <div style="display:flex;gap:8px;margin-top:12px">
                    <button class="btn btn-primary" id="dd-save-btn" style="flex:1" disabled>
                        💾 صرف الطلبية
                    </button>
                    <button class="btn" onclick="App.closeDispenseDocument(true)" style="background:var(--muted);color:#0f172a">
                        إلغاء
                    </button>
                </div>
                <div id="dd-error" style="color:var(--danger);margin-top:8px;font-size:0.85rem"></div>
                <div id="dd-progress" style="display:none;margin-top:8px"></div>
                <div style="margin-top:8px;font-size:0.7rem;color:var(--muted);text-align:center">
                    💾 يُحفظ تلقائياً عند كل تغيير لحماية البيانات
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // حالة افتراضية
        this._dispenseDocState = {
            items: [],
            destMain: '',
            destSub: '',
            destValue: '',
            customDest: '',
            documentNo: '',
            date: todayStr,
            notes: '',
        };

        // فحص وجود مسودة سابقة
        const draftFormId = `dispense-doc-${CURRENT_DEPT}`;
        const draft = DraftManager.load(draftFormId);
        if (draft && draft.items && draft.items.length > 0) {
            const age = DraftManager.getAge(draftFormId);
            const ageText = age < 1 ? 'الآن' : age < 60 ? `قبل ${age} دقيقة` : `قبل ${Math.floor(age/60)} ساعة`;
            
            const banner = document.getElementById('dd-draft-banner');
            banner.style.display = 'block';
            banner.innerHTML = `
                <strong>💾 وُجدت مسودة محفوظة</strong> (${ageText})<br>
                <span style="font-size:0.78rem">رقم: ${draft.documentNo || '—'} | ${draft.items.length} مادة</span>
                <div style="margin-top:6px">
                    <button class="btn btn-sm btn-primary" id="dd-restore-draft">استرجاع</button>
                    <button class="btn btn-sm" id="dd-discard-draft" style="background:var(--muted);color:#0f172a">تجاهل ومسح</button>
                </div>
            `;
            document.getElementById('dd-restore-draft').onclick = () => this._restoreDraft(draft);
            document.getElementById('dd-discard-draft').onclick = () => {
                DraftManager.clear(draftFormId);
                banner.style.display = 'none';
            };
        }

        // ربط الأحداث
        this._attachDispenseDocHandlers();
        
        // تفعيل الحفظ التلقائي
        this._dispDocAutoSave = DraftManager.attachAutoSave(draftFormId, () => this._getDispenseDocSnapshot());
    },

    _attachDispenseDocHandlers() {
        const docNoInput = document.getElementById('dd-doc-no');
        const dateInput = document.getElementById('dd-date');
        const destSelect = document.getElementById('dd-destination');
        const customDestInput = document.getElementById('dd-custom-dest');
        const notesInput = document.getElementById('dd-notes');
        const docNoHint = document.getElementById('dd-docno-hint');
        
        // مراقبة تغييرات → تشغيل حفظ تلقائي
        const triggerSave = () => this._dispDocAutoSave?.triggerSave();
        
        docNoInput.addEventListener('input', async (e) => {
            const v = sanitizeInput(e.target.value.trim(), 20);
            this._dispenseDocState.documentNo = v;
            triggerSave();
            
            // فحص استباقي للتفرّد (لتنبيه المستخدم مبكراً)
            docNoHint.textContent = '';
            if (v && /^\d{4,10}$/.test(v)) {
                try {
                    const ref = db.collection('departments').doc(CURRENT_DEPT)
                        .collection('documentRefs').doc(v);
                    const snap = await ref.get();
                    if (snap.exists) {
                        docNoHint.style.color = 'var(--danger)';
                        docNoHint.textContent = '⚠️ هذا الرقم مستخدم سابقاً';
                    } else {
                        docNoHint.style.color = 'var(--success)';
                        docNoHint.textContent = '✓ متاح';
                    }
                } catch (e) { /* تجاهل */ }
            }
        });
        
        dateInput.addEventListener('change', (e) => {
            this._dispenseDocState.date = e.target.value;
            triggerSave();
        });
        
        destSelect.addEventListener('change', (e) => {
            const [main, sub] = e.target.value.split('|');
            this._dispenseDocState.destMain = main;
            this._dispenseDocState.destSub = sub;
            this._dispenseDocState.destValue = e.target.value;
            const isText = DESTINATIONS[main] === 'text';
            document.getElementById('dd-custom-dest-wrapper').style.display = isText ? 'block' : 'none';
            triggerSave();
        });
        
        customDestInput.addEventListener('input', (e) => {
            this._dispenseDocState.customDest = sanitizeInput(e.target.value, 100);
            triggerSave();
        });
        
        notesInput.addEventListener('input', (e) => {
            this._dispenseDocState.notes = sanitizeInput(e.target.value, 200);
            triggerSave();
        });

        document.getElementById('dd-add-item-btn').onclick = () => this._openItemPicker();
        // 🆕 v6.9: زر OCR
        const ocrBtn = document.getElementById('dd-ocr-btn');
        if (ocrBtn) ocrBtn.onclick = () => this._openOCRForDispenseDoc();
        document.getElementById('dd-save-btn').onclick = () => this._saveDispenseDocument();
    },

    _getDispenseDocSnapshot() {
        return { ...this._dispenseDocState };
    },

    _restoreDraft(draft) {
        this._dispenseDocState = {
            items: draft.items || [],
            destMain: draft.destMain || '',
            destSub: draft.destSub || '',
            destValue: draft.destValue || '',
            customDest: draft.customDest || '',
            documentNo: draft.documentNo || '',
            date: draft.date || '',
            notes: draft.notes || '',
        };
        
        document.getElementById('dd-doc-no').value = draft.documentNo || '';
        document.getElementById('dd-date').value = draft.date || '';
        document.getElementById('dd-destination').value = draft.destValue || '';
        document.getElementById('dd-custom-dest').value = draft.customDest || '';
        document.getElementById('dd-notes').value = draft.notes || '';
        
        if (draft.destMain && DESTINATIONS[draft.destMain] === 'text') {
            document.getElementById('dd-custom-dest-wrapper').style.display = 'block';
        }
        
        document.getElementById('dd-draft-banner').style.display = 'none';
        this._renderDispenseDocItems();
        showToast('✓ تم استرجاع المسودة', 'success', 2000);
    },

    closeDispenseDocument(forceDiscard = false) {
        const state = this._dispenseDocState;
        const draftFormId = `dispense-doc-${CURRENT_DEPT}`;
        
        // إذا كانت توجد بيانات وحاول الإغلاق
        if (!forceDiscard && state && state.items && state.items.length > 0) {
            if (!confirm('توجد بيانات مُدخلة. هل تريد:\nموافق = حفظ كمسودة والإغلاق\nإلغاء = العودة للنموذج')) {
                return;
            }
            // حفظ نهائي قبل الإغلاق
            this._dispDocAutoSave?.saveNow();
            showToast('💾 المسودة محفوظة - يمكنك الرجوع لها لاحقاً', 'info', 3000);
        } else if (forceDiscard) {
            DraftManager.clear(draftFormId);
        }
        
        this._dispDocAutoSave?.stop();
        this._dispDocAutoSave = null;
        document.getElementById('dispense-doc-modal')?.remove();
        this._dispenseDocState = null;
    },

    // ========== اختيار مادة ==========
    async _openItemPicker() {
        const picker = document.createElement('div');
        picker.className = 'modal';
        picker.id = 'dd-item-picker';
        picker.style.zIndex = '10000';
        picker.innerHTML = `
            <div class="modal-content" style="max-width:600px;max-height:80vh;overflow-y:auto">
                <button class="modal-close" onclick="document.getElementById('dd-item-picker').remove()">✕</button>
                <h3>🔍 اختر مادة</h3>
                <input type="text" id="dd-search-input" class="form-control" 
                    placeholder="ابحث بالاسم أو الكود الوطني..." style="margin:8px 0" autofocus>
                <div id="dd-search-results" style="margin-top:8px;max-height:50vh;overflow-y:auto">
                    <p class="text-muted" style="text-align:center;padding:20px">جارٍ التحميل...</p>
                </div>
            </div>
        `;
        document.body.appendChild(picker);

        const inv = Array.from(AppState.inventory.values())
            .filter(it => (it.quantity || 0) > 0)
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        const renderResults = (filter = '') => {
            const filtered = filter.length < 1 ? inv.slice(0, 50) : 
                inv.filter(it => 
                    (it.code || '').toLowerCase().includes(filter.toLowerCase()) ||
                    (it.name || '').toLowerCase().includes(filter.toLowerCase()) ||
                    (it.nameAr || '').toLowerCase().includes(filter.toLowerCase())
                ).slice(0, 50);
            
            const html = filtered.map(it => {
                const isAdded = this._dispenseDocState.items.some(x => x.itemId === it.id);
                return `
                    <div style="padding:8px;border-bottom:1px solid var(--border);
                        ${isAdded ? 'opacity:0.5' : 'cursor:pointer'}"
                        ${isAdded ? '' : `onclick="App._selectItemForDispense('${it.id}')"`}>
                        <div style="font-weight:bold;font-size:0.9rem">${it.name || ''}</div>
                        <div style="font-size:0.78rem;color:var(--muted)">
                            ${it.code || '—'} | ${it.unit || ''} | الرصيد: ${it.quantity || 0}
                            ${isAdded ? ' • ✓ مضافة' : ''}
                        </div>
                    </div>`;
            }).join('');
            document.getElementById('dd-search-results').innerHTML = html || 
                '<p class="text-muted" style="text-align:center;padding:20px">لا توجد نتائج</p>';
        };

        document.getElementById('dd-search-input').addEventListener('input', (e) => renderResults(e.target.value));
        renderResults();
    },

    async _selectItemForDispense(itemId) {
        document.getElementById('dd-item-picker')?.remove();
        const item = AppState.inventory.get(itemId);
        if (!item) return;

        const qtyModal = document.createElement('div');
        qtyModal.className = 'modal';
        qtyModal.id = 'dd-qty-modal';
        qtyModal.style.zIndex = '10000';
        qtyModal.innerHTML = `
            <div class="modal-content" style="max-width:500px">
                <button class="modal-close" onclick="document.getElementById('dd-qty-modal').remove()">✕</button>
                <h3>إضافة: ${item.name}</h3>
                <p class="text-muted" style="font-size:0.82rem">
                    الكود: ${item.code || '—'} | الرصيد: ${item.quantity || 0} ${item.unit || ''}
                </p>
                <div style="margin:8px 0">
                    <label style="font-size:0.85rem">الكمية المطلوبة *</label>
                    <input type="number" id="dd-qty-input" class="form-control" 
                        min="1" max="${item.quantity || 0}" autofocus style="font-size:1.1rem">
                    <div id="dd-qty-words" style="color:var(--primary);font-size:0.85rem;margin-top:4px;min-height:18px"></div>
                </div>
                <div id="dd-fefo-preview" style="margin:8px 0;padding:8px;background:#1a2d45;border-radius:6px;display:none">
                    <strong style="font-size:0.85rem">📊 FEFO Preview:</strong>
                    <div id="dd-fefo-content" style="margin-top:4px;font-size:0.82rem"></div>
                </div>
                <div id="dd-qty-error" style="color:var(--danger);font-size:0.82rem;margin-top:4px"></div>
                <div style="display:flex;gap:8px;margin-top:12px">
                    <button class="btn btn-primary" id="dd-qty-confirm" style="flex:1">إضافة للطلبية</button>
                    <button class="btn" onclick="document.getElementById('dd-qty-modal').remove()" style="background:var(--muted);color:#0f172a">إلغاء</button>
                </div>
            </div>
        `;
        document.body.appendChild(qtyModal);

        const qtyInput = document.getElementById('dd-qty-input');
        const wordsDiv = document.getElementById('dd-qty-words');
        const updateOnChange = async () => {
            const qty = parseInt(qtyInput.value);
            wordsDiv.textContent = (qty > 0 && window.NumberToArabic) ? `📝 كتابة: ${NumberToArabic.convert(qty)}` : '';
            if (qty > 0 && qty <= (item.quantity || 0)) await this._showFefoPreview(itemId, qty);
            else document.getElementById('dd-fefo-preview').style.display = 'none';
        };
        qtyInput.addEventListener('input', updateOnChange);

        document.getElementById('dd-qty-confirm').onclick = async () => {
            const qty = parseInt(qtyInput.value);
            const errEl = document.getElementById('dd-qty-error');
            errEl.textContent = '';
            if (!qty || qty <= 0) { errEl.textContent = 'أدخل كمية أكبر من صفر'; return; }
            if (qty > (item.quantity || 0)) { errEl.textContent = `الرصيد المتاح: ${item.quantity || 0} فقط`; return; }
            
            const plan = await this._calculateFefoPlan(itemId, qty);
            if (!plan.canFulfill) {
                errEl.textContent = `الدفعات الصالحة لا تكفي (${plan.availableValid} فقط)`;
                return;
            }
            
            this._dispenseDocState.items.push({
                itemId, code: item.code || '', name: item.name || '', unit: item.unit || '',
                quantity: qty,
                quantityWords: NumberToArabic ? NumberToArabic.convert(qty) : '',
                fefoplan: plan.plan,
            });
            this._dispDocAutoSave?.triggerSave();
            this._renderDispenseDocItems();
            qtyModal.remove();
        };
    },

    async _calculateFefoPlan(itemId, qty) {
        const itemRef = db.collection('departments').doc(CURRENT_DEPT).collection('inventory').doc(itemId);
        const batchesSnap = await itemRef.collection('batches').where('quantity', '>', 0).get();
        const batches = batchesSnap.docs.map(b => ({ id: b.id, ...b.data() }));
        // 🟢 v7.1: المسار الرسمي عبر App.calcFefoDistribution الذي يفلتر دفاعياً
        // (المنتهية + الـ null expiry)
        if (App.calcFefoDistribution) {
            return App.calcFefoDistribution(batches, qty);
        }

        // 🔴 v7.1 Bug #5: fallback المُحسَّن (لو inventory.js لم يُحمَّل بعد)
        // null/undefined expiry → Infinity (LAST) لا new Date(0) (FIRST)
        const nowMs = Date.now();
        const validBatches = batches.filter(b => {
            const e = b.expiryDate?.toDate?.();
            return e && e.getTime() > nowMs;
        });
        validBatches.sort((a, b) => {
            const ea = a.expiryDate?.toMillis?.() ?? Infinity;
            const eb = b.expiryDate?.toMillis?.() ?? Infinity;
            return ea - eb;
        });
        const plan = [];
        let remaining = qty;
        for (const b of validBatches) {
            if (remaining <= 0) break;
            const take = Math.min(remaining, b.quantity || 0);
            if (take > 0) {
                plan.push({ id: b.id, batchNumber: b.batchNumber || b.id, take, expiryDate: b.expiryDate });
                remaining -= take;
            }
        }
        const availableValid = validBatches.reduce((s, b) => s + (b.quantity || 0), 0);
        return { canFulfill: remaining === 0, plan, availableValid };
    },

    async _showFefoPreview(itemId, qty) {
        const plan = await this._calculateFefoPlan(itemId, qty);
        const div = document.getElementById('dd-fefo-preview');
        const content = document.getElementById('dd-fefo-content');
        if (!plan.canFulfill) {
            div.style.display = 'block';
            content.innerHTML = `<span style="color:var(--danger)">⚠️ الدفعات الصالحة لا تكفي (متاح: ${plan.availableValid})</span>`;
            return;
        }
        div.style.display = 'block';
        if (plan.plan.length === 1) {
            const p = plan.plan[0];
            const exp = p.expiryDate?.toDate?.();
            content.innerHTML = `✓ من دفعة <strong>${p.batchNumber}</strong> ${exp ? `(تنتهي ${exp.toLocaleDateString('ar-IQ')})` : ''}`;
        } else {
            const lines = plan.plan.map(p => {
                const exp = p.expiryDate?.toDate?.();
                return `  • ${p.take} من ${p.batchNumber} ${exp ? `(${exp.toLocaleDateString('ar-IQ')})` : ''}`;
            });
            content.innerHTML = `✓ موزَّعة على ${plan.plan.length} دفعات (FEFO):<br>${lines.join('<br>')}`;
        }
    },

    _renderDispenseDocItems() {
        const items = this._dispenseDocState.items;
        const listDiv = document.getElementById('dd-items-list');
        const countSpan = document.getElementById('dd-items-count');
        const saveBtn = document.getElementById('dd-save-btn');
        countSpan.textContent = `(${items.length})`;
        saveBtn.disabled = items.length === 0;
        
        if (items.length === 0) {
            listDiv.innerHTML = '<p class="text-muted" style="text-align:center;padding:20px;font-size:0.85rem">لم تُضَف أي مادة بعد.</p>';
            return;
        }
        listDiv.innerHTML = items.map((it, idx) => `
            <div style="padding:8px;background:#0f1c30;margin:4px 0;border-radius:6px;border:1px solid #1e3a8a">
                <div style="display:flex;justify-content:space-between;align-items:flex-start">
                    <div style="flex:1;min-width:0">
                        <div style="font-weight:bold;font-size:0.88rem">${idx + 1}. ${it.name}</div>
                        <div style="font-size:0.78rem;color:var(--muted);margin-top:2px">
                            ${it.code} | ${it.quantity} ${it.unit} | "${it.quantityWords}"
                        </div>
                        <div style="font-size:0.75rem;color:var(--primary);margin-top:2px">
                            ${it.fefoplan.length === 1 ? `دفعة ${it.fefoplan[0].batchNumber}` : `${it.fefoplan.length} دفعات FEFO`}
                        </div>
                    </div>
                    <button class="btn btn-sm" onclick="App._removeDispenseDocItem(${idx})" 
                        style="background:var(--danger);color:white;padding:4px 8px;font-size:0.75rem">🗑️</button>
                </div>
            </div>
        `).join('');
    },

    _removeDispenseDocItem(idx) {
        this._dispenseDocState.items.splice(idx, 1);
        this._dispDocAutoSave?.triggerSave();
        this._renderDispenseDocItems();
    },

    // ========== الحفظ النهائي (Atomic Transaction) ==========
    async _saveDispenseDocument() {
        const errEl = document.getElementById('dd-error');
        errEl.textContent = '';
        const state = this._dispenseDocState;
        const documentNo = sanitizeInput(state.documentNo, 20);
        const dateStr = state.date;
        
        // التحقق من المدخلات
        if (!documentNo) { errEl.textContent = 'رقم الطلبية إلزامي'; return; }
        if (!/^\d{4,10}$/.test(documentNo)) { errEl.textContent = 'رقم الطلبية يجب أن يكون 4-10 أرقام'; return; }
        if (!dateStr) { errEl.textContent = 'التاريخ إلزامي'; return; }
        if (!state.destMain) { errEl.textContent = 'الجهة المستلمة إلزامية'; return; }
        if (state.items.length === 0) { errEl.textContent = 'أضف مادة واحدة على الأقل'; return; }
        
        const isTextDest = DESTINATIONS[state.destMain] === 'text';
        const finalSubDest = isTextDest ? (state.customDest || state.destMain) : (state.destSub || '');
        if (isTextDest && !state.customDest) { errEl.textContent = 'حدد اسم القسم المستلم'; return; }
        
        // ✅ التاريخ بشكل صحيح (تجنب UTC midnight)
        const [y, m, d] = dateStr.split('-').map(Number);
        const dateObj = new Date(y, m - 1, d, 12, 0, 0); // ظهراً في التوقيت المحلي
        
        // ✅ فحص اتصال موثوق قبل البدء
        showToast('⏳ فحص الاتصال...', 'info', 1500);
        const connected = await ConnectionMonitor.requireConnection('حفظ الطلبية');
        if (!connected) {
            errEl.textContent = 'لا يوجد اتصال - البيانات محفوظة كمسودة';
            this._dispDocAutoSave?.saveNow();
            return;
        }
        
        const progressDiv = document.getElementById('dd-progress');
        progressDiv.style.display = 'block';
        progressDiv.innerHTML = `<div class="alert-box alert-info">⏳ جارٍ حفظ ${state.items.length} مادة...</div>`;
        document.getElementById('dd-save-btn').disabled = true;
        
        const draftFormId = `dispense-doc-${CURRENT_DEPT}`;
        const itemsToProcess = [...state.items];
        const formDocumentNo = documentNo;
        
        // 🔴 v7.5 #22: فحص قبلي لحد Firestore (500 op/transaction)
        // كل مادة ≈ 4 ops (قراءة inventory + قراءة batches + كتابة inventory + كتابة movement)
        // كل دفعة في FEFO plan ≈ 2 ops (قراءة + كتابة batch)
        // + 1 documentRef + 1 audit = ~3 ops ثابتة
        // 
        // التقدير المحافظ: تجاوز 100 مادة = خطر تجاوز الـ 500 (إذا كل مادة لها 1-2 دفعة)
        const estimatedOps = itemsToProcess.length * 2 +  // inventory read + write
                             itemsToProcess.reduce((s, it) => s + (it.fefoplan?.length || 1) * 2, 0) +  // batch ops
                             itemsToProcess.length +  // movement writes
                             3;  // documentRef + audit + buffer
        if (estimatedOps > 450) {  // هامش أمان 50 op
            progressDiv.innerHTML = `<div class="alert-box alert-error">
                ❌ القائمة كبيرة جداً (${itemsToProcess.length} مادة، ~${estimatedOps} عملية).<br>
                الحد الأقصى للـ Firestore هو 500 عملية/transaction.<br>
                <b>الحل:</b> قسّم القائمة على 2-3 طلبيات أصغر (50 مادة لكل واحدة كحد أقصى).
            </div>`;
            document.getElementById('dd-save-btn').disabled = false;
            return;
        }
        
        try {
            // ✅ Transaction مع timeout لمنع التعليق الأبدي
            const transactionPromise = db.runTransaction(async (tx) => {
                // ===== المرحلة 1: تجهيز refs =====
                const refDoc = db.collection('departments').doc(CURRENT_DEPT)
                    .collection('documentRefs').doc(formDocumentNo);
                
                // 🔧 v6.8.1: قراءات متوازية بدل تسلسلية
                // كان: 60+ tx.get() تسلسلي = 12 ثانية على شبكة 200ms latency
                // الآن: قراءتين متوازيتين = ~400ms
                const itemRefs = itemsToProcess.map(it => ({
                    item: it,
                    itemRef: db.collection('departments').doc(CURRENT_DEPT)
                        .collection('inventory').doc(it.itemId)
                }));
                
                // 🔴 v6.8.2: استخدام idx من forEach بدل O(n²) lookup
                const batchRefList = [];
                itemRefs.forEach((r, idx) => {
                    r.item.fefoplan.forEach(p => {
                        batchRefList.push({
                            itemIdx: idx,  // ✅ O(1) من forEach
                            plan: p,
                            ref: r.itemRef.collection('batches').doc(p.id)
                        });
                    });
                });
                
                // ✅ كل القراءات متوازية في batch واحد
                const allReads = await Promise.all([
                    tx.get(refDoc),
                    ...itemRefs.map(r => tx.get(r.itemRef)),
                    ...batchRefList.map(b => tx.get(b.ref))
                ]);
                
                const refSnap = allReads[0];
                if (refSnap.exists) {
                    throw new Error(`رقم الطلبية ${formDocumentNo} مستخدم سابقاً`);
                }
                
                // ربط الـ snaps بالـ refs
                const itemReads = itemRefs.map((r, i) => {
                    const itemSnap = allReads[1 + i];
                    if (!itemSnap.exists) throw new Error(`المادة ${r.item.name} غير موجودة`);
                    return { ref: r.itemRef, snap: itemSnap, batchSnaps: [], item: r.item };
                });
                
                // 🔴 v6.8.2: O(1) lookup عبر itemIdx (كان O(n²))
                const batchSnapsOffset = 1 + itemRefs.length;
                batchRefList.forEach((b, i) => {
                    const bSnap = allReads[batchSnapsOffset + i];
                    if (!bSnap.exists) throw new Error(`الدفعة ${b.plan.batchNumber} لم تعد موجودة`);
                    const itemRead = itemReads[b.itemIdx];  // ✅ O(1) من index
                    if (itemRead) {
                        itemRead.batchSnaps.push({ ref: b.ref, snap: bSnap, plan: b.plan });
                    }
                });
                
                // ===== المرحلة 3: التحقق من الأرصدة =====
                for (const r of itemReads) {
                    const curQty = r.snap.data().quantity || 0;
                    if (r.item.quantity > curQty) {
                        throw new Error(`${r.item.name}: الكمية المطلوبة ${r.item.quantity} > الموجود ${curQty}`);
                    }
                    for (const bs of r.batchSnaps) {
                        const bQty = bs.snap.data().quantity || 0;
                        if (bs.plan.take > bQty) {
                            throw new Error(`الدفعة ${bs.plan.batchNumber}: ${bs.plan.take} > ${bQty}`);
                        }
                    }
                }
                
                // ===== المرحلة 4: إنشاء الحركات + تحديث المخزون =====
                const movementIds = [];
                let totalUnits = 0;
                
                for (const r of itemReads) {
                    const curQty = r.snap.data().quantity || 0;
                    const newQty = curQty - r.item.quantity;
                    totalUnits += r.item.quantity;
                    
                    tx.update(r.ref, {
                        quantity: newQty,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        depletionDate: newQty === 0 ? firebase.firestore.Timestamp.now() : (r.snap.data().depletionDate || null),
                    });
                    
                    const movementBatches = [];
                    for (const bs of r.batchSnaps) {
                        const bData = bs.snap.data();
                        const newBQty = (bData.quantity || 0) - bs.plan.take;
                        tx.update(bs.ref, {
                            quantity: newBQty,
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        });
                        movementBatches.push({
                            batchId: bs.plan.id,
                            batchNumber: bs.plan.batchNumber,
                            quantity: bs.plan.take,
                            expiryDate: bData.expiryDate || null,
                            source: bData.source || '',
                        });
                    }
                    
                    const movRef = db.collection('departments').doc(CURRENT_DEPT)
                        .collection('movements').doc();
                    movementIds.push(movRef.id);
                    
                    // ✅ كل المعلومات هنا (لا تكرار في documentRefs)
                    tx.set(movRef, {
                        documentNo: formDocumentNo,
                        inventoryId: r.ref.id,
                        code: r.item.code,
                        name: r.item.name,
                        unit: r.item.unit,
                        quantity: r.item.quantity,
                        quantityWords: r.item.quantityWords,
                        quantityBefore: curQty,
                        quantityAfter: newQty,
                        type: 'out',
                        movType: 'out',
                        movementSubType: 'dispense',
                        batches: movementBatches,
                        ...(movementBatches.length === 1 ? {
                            batchNumber: movementBatches[0].batchNumber,
                            expiryDate: movementBatches[0].expiryDate,
                        } : {}),
                        destination: { main: state.destMain, sub: finalSubDest },
                        notes: state.notes || '',
                        createdBy: CU.email || CU.uid,
                        createdByUid: CU.uid,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        documentDate: firebase.firestore.Timestamp.fromDate(dateObj),
                    });
                }
                
                // ===== المرحلة 5: إنشاء documentRef عبر الـ helper =====
                // 🔴 v6.8.2: writeDocumentRef بدل inline (سكيما موحَّدة مع باقي المسارات)
                // يضيف: kind + summary اللذين كانا مفقودين في النسخة القديمة
                writeDocumentRef(tx, refDoc, {
                    kind: 'multi_batch_dispense',
                    movementIds,
                    itemCount: itemsToProcess.length,
                    totalUnits,
                    summary: `طلبية ${formDocumentNo}: ${itemsToProcess.length} مادة (${totalUnits} وحدة) → ${state.destMain}${finalSubDest ? ' / ' + finalSubDest : ''}`
                });
                
                // ===== المرحلة 6: Audit log =====
                const auditRef = db.collection('auditLog').doc();
                tx.set(auditRef, {
                    action: 'dispense_document_created',
                    documentNo: formDocumentNo,
                    itemCount: itemsToProcess.length,
                    totalUnits,
                    destination: { main: state.destMain, sub: finalSubDest },
                    dept: CURRENT_DEPT,
                    by: CU.email,
                    byUid: CU.uid,
                    at: firebase.firestore.FieldValue.serverTimestamp(),
                });
            });
            
            // ✅ Timeout 30 ثانية كحد أقصى
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('انتهى وقت الانتظار (30 ثانية) - الاتصال بطيء جداً')), 30000)
            );
            
            await Promise.race([transactionPromise, timeoutPromise]);
            
            // ===== نجاح =====
            DraftManager.clear(draftFormId); // مسح المسودة
            
            // 🔴 v7.5 #21: مسح cache التقارير بعد طلبية كبيرة
            if (typeof MovementsCache !== 'undefined') MovementsCache.clear();
            if (typeof LedgerCacheV2 !== 'undefined') LedgerCacheV2.clear();
            if (typeof ReportCache !== 'undefined') ReportCache.invalidateAfterMovement(CURRENT_DEPT);
            
            // 🔧 v6.8.1: إعادة حساب earliestExpiry لكل مادة (دفعة الأقرب انتهاء قد نفدت)
            // كان مفقوداً → تنبيهات الانتهاء تظل خاطئة حتى أول استلام
            Promise.all(itemsToProcess.map(it => 
                recalcEarliestExpiry(CURRENT_DEPT, it.itemId).catch(e => 
                    console.warn(`recalcEarliestExpiry(${it.itemId}):`, e.message)
                )
            )).catch(e => console.warn('recalc batch:', e.message));
            
            progressDiv.innerHTML = `
                <div class="alert-box alert-success">
                    ✅ تم صرف الطلبية بنجاح!<br>
                    رقم الطلبية: <strong>${formDocumentNo}</strong><br>
                    المواد: ${itemsToProcess.length} | الإجمالي: ${itemsToProcess.reduce((s, it) => s + it.quantity, 0)}
                </div>
            `;
            
            showToast(`✅ تم صرف طلبية ${formDocumentNo}`, 'success', 6000);
            
            setTimeout(() => {
                this.closeDispenseDocument(true);
                if (App.loadInventoryData) App.loadInventoryData();
                if (App.renderInventoryList) App.renderInventoryList();
            }, 2000);
            
        } catch (e) {
            console.error('فشل صرف الطلبية:', e);
            // ✅ المسودة محفوظة - لن تضيع البيانات
            this._dispDocAutoSave?.saveNow();
            errEl.textContent = e.message;
            progressDiv.style.display = 'none';
            document.getElementById('dd-save-btn').disabled = false;
            
            showToast(
                `❌ فشل الصرف: ${e.message}\n💾 بياناتك محفوظة كمسودة`,
                'error', 7000
            );
        }
    },

    // 🆕 v6.9: فتح OCR لورقة الصرف
    _openOCRForDispenseDoc() {
        if (typeof OCRDispense === 'undefined') {
            showToast('وحدة OCR غير محملة', 'error');
            return;
        }

        OCRDispense.open(async (items, docInfo) => {
            // ملء حقول معلومات الورقة
            if (docInfo.documentNo) {
                const docNoEl = document.getElementById('dd-doc-no');
                if (docNoEl && !docNoEl.value) {
                    docNoEl.value = docInfo.documentNo;
                    if (this._dispenseDocState) this._dispenseDocState.documentNo = docInfo.documentNo;
                }
            }
            if (docInfo.date) {
                const dateEl = document.getElementById('dd-date');
                if (dateEl && !dateEl.value) dateEl.value = docInfo.date;
            }

            // محاولة مطابقة الجهة المستلمة
            if (docInfo.destination) {
                const sel = document.getElementById('dd-destination');
                if (sel) {
                    for (const opt of sel.options) {
                        const optText = opt.text || '';
                        const optVal = opt.value || '';
                        if (optText.includes(docInfo.destination) ||
                            docInfo.destination.includes(optText.replace(/[^\u0600-\u06FF\w\s]/g, '').trim()) ||
                            optVal.split('|')[0] === docInfo.destination) {
                            sel.value = optVal;
                            sel.dispatchEvent(new Event('change'));
                            break;
                        }
                    }
                }
            }

            // إضافة المواد بـ FEFO تلقائي
            let added = 0, failed = 0;
            for (const it of items) {
                const item = AppState.inventory.get(it.itemId);
                if (!item) { failed++; continue; }

                try {
                    const plan = await this._calculateFefoPlan(it.itemId, it.qty);
                    if (plan && plan.canFulfill) {
                        this._dispenseDocState.items.push({
                            itemId: it.itemId,
                            qty: it.qty,
                            name: item.name,
                            unit: item.unit,
                            fefoplan: plan.plan,
                            fromOCR: true,
                            extractedExpiry: it.extractedExpiry,
                            extractedBatch: it.extractedBatch
                        });
                        added++;
                    } else {
                        failed++;
                    }
                } catch (e) {
                    console.error(`Failed to add ${item.name}:`, e);
                    failed++;
                }
            }

            this._renderDispenseDocItems();
            if (this._dispDocAutoSave) this._dispDocAutoSave.saveNow();

            const msg = failed > 0
                ? `✓ أُضيف ${added}/${items.length} مادة (${failed} فشلت)`
                : `✓ تم نقل ${added} مادة من الصورة`;
            showToast(msg, added > 0 ? 'success' : 'warning', 4000);
        });
    },
});
