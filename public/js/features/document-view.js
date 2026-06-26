// ============================================================
// js/features/document-view.js
// عرض الطلبيات (مبني على documentRefs + movements بـ documentNo)
// ============================================================
// v6.6.1:
// - ✅ لا تكرار للبيانات - documentRef يحوي فقط: status + movementIds + summary
// - ✅ تفاصيل الطلبية تأتي من query على movements.where(documentNo == X)
// - ✅ الإلغاء يستثني الحركات الأصلية من الـ needs تلقائياً (يستخدم reverseOf)
// ============================================================

Object.assign(App, {

    async renderDocumentsView(containerId = 'dispense-ledger-tab-content') {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        container.innerHTML = `
            <div class="card" style="padding:10px">
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
                    <input type="text" id="doc-search" class="form-control" 
                        placeholder="🔍 رقم الطلبية..." style="flex:1;min-width:150px">
                    <select id="doc-filter-month" class="form-control" style="width:auto">
                        <option value="">كل الأشهر</option>
                        ${this._monthOptions()}
                    </select>
                    <select id="doc-filter-status" class="form-control" style="width:auto">
                        <option value="">كل الحالات</option>
                        <option value="active">مكتملة</option>
                        <option value="reversed">مُلغاة</option>
                    </select>
                    <button class="btn btn-sm btn-primary" id="doc-refresh">🔄</button>
                </div>
                <div id="doc-list-container">
                    <p class="text-muted" style="text-align:center;padding:20px">جارٍ التحميل...</p>
                </div>
            </div>
        `;
        
        document.getElementById('doc-search').addEventListener('input', 
            this._debounce(() => this._loadDocuments(), 250));
        document.getElementById('doc-filter-month').addEventListener('change', () => this._loadDocuments());
        document.getElementById('doc-filter-status').addEventListener('change', () => this._loadDocuments());
        document.getElementById('doc-refresh').addEventListener('click', () => this._loadDocuments());
        
        await this._loadDocuments();
    },

    _monthOptions() {
        const opts = [];
        const now = new Date();
        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            opts.push(`<option value="${y}-${m}">${y}-${m}</option>`);
        }
        return opts.join('');
    },

    _debounce(fn, ms) {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), ms);
        };
    },

    async _loadDocuments() {
        const container = document.getElementById('doc-list-container');
        if (!container) return;
        container.innerHTML = '<p class="text-muted" style="text-align:center;padding:20px">جارٍ التحميل...</p>';
        
        try {
            const search = document.getElementById('doc-search')?.value.trim() || '';
            const month = document.getElementById('doc-filter-month')?.value || '';
            const status = document.getElementById('doc-filter-status')?.value || '';
            
            // ✅ جلب من documentRefs (وثائق خفيفة)
            let query = db.collection('departments').doc(CURRENT_DEPT)
                .collection('documentRefs')
                .orderBy('createdAt', 'desc')
                .limit(100);
            
            if (month) {
                const [y, m] = month.split('-').map(Number);
                const start = new Date(y, m - 1, 1);
                const end = new Date(y, m, 1);
                query = db.collection('departments').doc(CURRENT_DEPT)
                    .collection('documentRefs')
                    .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(start))
                    .where('createdAt', '<', firebase.firestore.Timestamp.fromDate(end))
                    .orderBy('createdAt', 'desc');
            }
            
            const snap = await query.get();
            let refs = snap.docs.map(d => ({ documentNo: d.id, ...d.data() }));
            
            if (status) refs = refs.filter(r => r.status === status);
            if (search) {
                const q = search.toLowerCase();
                refs = refs.filter(r => 
                    r.documentNo.toLowerCase().includes(q) ||
                    (r.createdBy || '').toLowerCase().includes(q)
                );
            }
            
            if (refs.length === 0) {
                container.innerHTML = '<p class="text-muted" style="text-align:center;padding:20px">لا توجد طلبيات</p>';
                return;
            }
            
            container.innerHTML = refs.map(r => this._renderDocumentCard(r)).join('');
            
        } catch (e) {
            console.error(e);
            container.innerHTML = `<div class="alert-box alert-danger">فشل التحميل: ${e.message}</div>`;
        }
    },

    _renderDocumentCard(ref) {
        const isReversed = ref.status === 'reversed';
        const date = ref.createdAt?.toDate?.();
        const dateStr = date ? date.toLocaleDateString('ar-IQ') : '—';
        
        const statusBadge = isReversed 
            ? `<span style="background:var(--danger);color:white;padding:2px 6px;border-radius:4px;font-size:0.7rem">↩️ مُلغاة</span>`
            : `<span style="background:var(--success);color:white;padding:2px 6px;border-radius:4px;font-size:0.7rem">✅ مكتملة</span>`;
        
        return `
            <div class="card" style="padding:10px;margin:6px 0;cursor:pointer;
                ${isReversed ? 'opacity:0.7' : ''}"
                onclick="App.showDocumentDetails('${ref.documentNo}')">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                    <div style="flex:1;min-width:0">
                        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                            <strong style="font-family:monospace;font-size:1rem">📋 ${ref.documentNo}</strong>
                            ${statusBadge}
                        </div>
                        <div style="font-size:0.78rem;color:var(--muted);margin-top:2px">
                            📅 ${dateStr} | 💊 ${ref.itemCount || 0} مادة | إجمالي: ${ref.totalUnits || 0}
                        </div>
                        ${ref.createdBy ? `<div style="font-size:0.75rem;color:var(--muted)">👤 ${ref.createdBy}</div>` : ''}
                        ${isReversed && ref.reversedReason ? `<div style="font-size:0.72rem;color:var(--danger);margin-top:2px">سبب الإلغاء: ${ref.reversedReason}</div>` : ''}
                    </div>
                    <div style="text-align:left;font-size:0.75rem;color:var(--muted)">
                        ${date ? this._timeAgo(date) : ''}
                    </div>
                </div>
            </div>`;
    },

    _timeAgo(date) {
        const diff = Date.now() - date.getTime();
        const m = Math.floor(diff / 60000);
        const h = Math.floor(diff / 3600000);
        const d = Math.floor(diff / 86400000);
        if (m < 60) return `قبل ${m} دقيقة`;
        if (h < 24) return `قبل ${h} ساعة`;
        if (d < 30) return `قبل ${d} يوم`;
        return date.toLocaleDateString('ar-IQ');
    },

    // ========== تفاصيل طلبية ==========
    async showDocumentDetails(documentNo) {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:700px;max-height:90vh;overflow-y:auto">
                <button class="modal-close" onclick="this.closest('.modal').remove()">✕</button>
                <div id="doc-details-content">
                    <p class="text-muted" style="text-align:center;padding:20px">جارٍ التحميل...</p>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        try {
            // ✅ قراءة الـ ref الخفيفة
            const refDoc = db.collection('departments').doc(CURRENT_DEPT)
                .collection('documentRefs').doc(documentNo);
            const refSnap = await refDoc.get();
            if (!refSnap.exists) throw new Error('الطلبية غير موجودة');
            const ref = refSnap.data();
            
            // ✅ قراءة الحركات (التفاصيل الكاملة هنا)
            const movsSnap = await db.collection('departments').doc(CURRENT_DEPT)
                .collection('movements')
                .where('documentNo', '==', documentNo)
                .get();
            
            const movs = movsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            const originalMovs = movs.filter(m => m.movType === 'out');
            const reverseMovs = movs.filter(m => m.movType === 'reverse');
            
            const isReversed = ref.status === 'reversed';
            
            // استخراج المعلومات من أول حركة (هي مصدر الحقيقة - لا تكرار)
            const firstMov = originalMovs[0];
            const docDate = firstMov?.documentDate?.toDate?.();
            const destination = firstMov?.destination;
            const notes = firstMov?.notes;
            
            document.getElementById('doc-details-content').innerHTML = `
                <h3>📋 الطلبية ${documentNo}</h3>
                <div class="card" style="background:#1a2d45;padding:10px;margin:8px 0;font-size:0.88rem">
                    <div><strong>تاريخ الورقة:</strong> ${docDate ? docDate.toLocaleDateString('ar-IQ') : '—'}</div>
                    <div><strong>الجهة:</strong> ${destination?.main || '—'}${destination?.sub ? ' - ' + destination.sub : ''}</div>
                    <div><strong>المسلم:</strong> ${ref.createdBy || '—'}</div>
                    <div><strong>عدد المواد:</strong> ${ref.itemCount || 0}</div>
                    <div><strong>الإجمالي:</strong> ${ref.totalUnits || 0} وحدة</div>
                    <div><strong>الحالة:</strong> 
                        ${isReversed 
                            ? `<span style="color:var(--danger)">↩️ مُلغاة - ${ref.reversedReason || ''}</span>` 
                            : '<span style="color:var(--success)">✅ مكتملة</span>'}
                    </div>
                    ${notes ? `<div style="margin-top:4px"><strong>ملاحظات:</strong> ${notes}</div>` : ''}
                </div>
                
                <h4 style="margin:10px 0 4px;font-size:0.95rem">💊 المواد (${originalMovs.length})</h4>
                <div style="max-height:50vh;overflow-y:auto">
                    ${originalMovs.map((m, idx) => this._renderMovementInDoc(m, idx, isReversed)).join('')}
                </div>
                
                ${reverseMovs.length > 0 ? `
                    <h4 style="margin:10px 0 4px;font-size:0.95rem;color:var(--danger)">↩️ حركات الإلغاء (${reverseMovs.length})</h4>
                    <div style="max-height:30vh;overflow-y:auto;opacity:0.85">
                        ${reverseMovs.map((m, idx) => this._renderMovementInDoc(m, idx, false, true)).join('')}
                    </div>
                ` : ''}
                
                <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
                    <button class="btn btn-sm btn-primary" onclick="App.printDocumentPDF('${documentNo}')">🖨️ تنزيل PDF</button>
                    <button class="btn btn-sm" onclick="App.sendDocumentToTelegram('${documentNo}')" style="background:#0088cc;color:white">📲 إرسال Telegram</button>
                    ${!isReversed && isAdmin() ? `
                        <button class="btn btn-sm" style="background:var(--danger);color:white" 
                            onclick="App.reverseDispenseDocument('${documentNo}')">
                            ↩️ إلغاء الطلبية
                        </button>
                    ` : ''}
                </div>
            `;
        } catch (e) {
            console.error(e);
            document.getElementById('doc-details-content').innerHTML = 
                `<div class="alert-box alert-danger">فشل: ${e.message}</div>`;
        }
    },

    _renderMovementInDoc(m, idx, isStrikethrough = false, isReverse = false) {
        const batchInfo = m.batches && m.batches.length > 1
            ? `<div style="font-size:0.78rem;color:var(--primary);margin-top:2px">📦 ${m.batches.length} دفعات:
                ${m.batches.map(b => `<br>  • ${b.quantity} من ${b.batchNumber}`).join('')}
            </div>`
            : (m.batchNumber ? `<div style="font-size:0.78rem;color:var(--muted)">دفعة ${m.batchNumber}</div>` : '');
        
        const bg = isReverse ? '#2d1810' : '#0f1c30';
        const border = isReverse ? '#7c2d12' : '#1e3a8a';
        
        return `
            <div style="padding:8px;background:${bg};margin:4px 0;border-radius:6px;border:1px solid ${border};
                ${isStrikethrough ? 'text-decoration:line-through;opacity:0.6' : ''}">
                <div style="font-weight:bold;font-size:0.88rem">
                    ${isReverse ? '↩️ ' : ''}${idx + 1}. ${m.name || m.code}
                </div>
                <div style="font-size:0.82rem;margin-top:2px">
                    الكود: ${m.code || '—'} | الكمية: <strong>${m.quantity}</strong> ${m.unit || ''}
                    ${m.quantityWords ? `<br><span style="color:var(--primary)">"${m.quantityWords}"</span>` : ''}
                </div>
                ${batchInfo}
            </div>`;
    },

    // ========== إلغاء طلبية كاملة (Immutable - Reverse) ==========
    async reverseDispenseDocument(documentNo) {
        if (!isAdmin()) {
            showToast('فقط المسؤول يستطيع إلغاء الطلبيات', 'error');
            return;
        }
        
        // ✅ فحص اتصال موثوق
        const connected = await ConnectionMonitor.requireConnection('إلغاء الطلبية');
        if (!connected) return;
        
        const reason = prompt('سبب الإلغاء (إلزامي):');
        if (!reason || reason.trim().length < 3) {
            showToast('سبب الإلغاء إلزامي (3 أحرف فأكثر)', 'error');
            return;
        }
        const cleanReason = sanitizeInput(reason.trim(), 300);
        
        if (!await this.confirmAction(`متأكد من إلغاء الطلبية ${documentNo}؟\n\nسيتم:\n• إنشاء حركات عكسية تعيد الكميات للمخزون\n• الحركات الأصلية تبقى محفوظة (Immutable)\n• الطلبية تظهر كـ "مُلغاة"`)) return;
        
        showToast('⏳ جارٍ الإلغاء...', 'info', 3000);
        
        try {
            const refDoc = db.collection('departments').doc(CURRENT_DEPT)
                .collection('documentRefs').doc(documentNo);
            
            // ✅ أولاً: قراءة الـ ref خارج Transaction للحصول على movementIds
            const refSnap = await refDoc.get();
            if (!refSnap.exists) throw new Error('الطلبية غير موجودة');
            const refData = refSnap.data();
            if (refData.status === 'reversed') throw new Error('الطلبية مُلغاة سابقاً');
            const originalMovIds = refData.movementIds || [];
            if (originalMovIds.length === 0) throw new Error('لا توجد حركات مرتبطة');
            
            const transactionPromise = db.runTransaction(async (tx) => {
                // 1. إعادة قراءة الـ ref داخل Transaction
                const refSnap2 = await tx.get(refDoc);
                if (!refSnap2.exists) throw new Error('الطلبية اختفت');
                if (refSnap2.data().status === 'reversed') throw new Error('الطلبية مُلغاة (race)');
                
                // 2. قراءة كل الحركات الأصلية + المخزون + الدفعات
                const reads = [];
                for (const movId of originalMovIds) {
                    const movRef = db.collection('departments').doc(CURRENT_DEPT)
                        .collection('movements').doc(movId);
                    const movSnap = await tx.get(movRef);
                    if (!movSnap.exists) continue;
                    const m = movSnap.data();
                    
                    const invRef = db.collection('departments').doc(CURRENT_DEPT)
                        .collection('inventory').doc(m.inventoryId);
                    const invSnap = await tx.get(invRef);
                    
                    const batchReads = [];
                    if (m.batches && m.batches.length > 0) {
                        for (const b of m.batches) {
                            const bRef = invRef.collection('batches').doc(b.batchId);
                            const bSnap = await tx.get(bRef);
                            batchReads.push({ ref: bRef, snap: bSnap, data: b });
                        }
                    }
                    
                    reads.push({ invRef, invSnap, batchReads, originalMov: m, originalMovId: movId });
                }
                
                // 3. إنشاء الحركات العكسية + إعادة الكميات
                const reverseMovementIds = [];
                
                for (const r of reads) {
                    const curQty = r.invSnap.exists ? (r.invSnap.data().quantity || 0) : 0;
                    const newQty = curQty + r.originalMov.quantity;
                    
                    if (r.invSnap.exists) {
                        tx.update(r.invRef, {
                            quantity: newQty,
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                            depletionDate: null,
                        });
                    }
                    
                    for (const bs of r.batchReads) {
                        if (bs.snap.exists) {
                            tx.update(bs.ref, {
                                quantity: (bs.snap.data().quantity || 0) + bs.data.quantity,
                                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                            });
                        }
                    }
                    
                    const reverseRef = db.collection('departments').doc(CURRENT_DEPT)
                        .collection('movements').doc();
                    reverseMovementIds.push(reverseRef.id);
                    
                    // ✅ الحركة العكسية - reverseOf يربطها بالأصلية
                    tx.set(reverseRef, {
                        documentNo, // نفس رقم الطلبية
                        reverseOf: r.originalMovId, // ✅ المفتاح المهم لاستثناء الأصلية من الاحتياج
                        inventoryId: r.originalMov.inventoryId,
                        code: r.originalMov.code,
                        name: r.originalMov.name,
                        unit: r.originalMov.unit,
                        quantity: r.originalMov.quantity,
                        quantityBefore: curQty,
                        quantityAfter: newQty,
                        type: 'in',
                        movType: 'reverse',
                        movementSubType: 'reverse_dispense',
                        batches: r.originalMov.batches || [],
                        ...(r.originalMov.batchNumber ? { batchNumber: r.originalMov.batchNumber } : {}),
                        destination: { main: 'إلغاء طلبية', sub: documentNo },
                        notes: `إلغاء حركة من ${documentNo}. السبب: ${cleanReason}`,
                        reverseReason: cleanReason,
                        createdBy: CU.email,
                        createdByUid: CU.uid,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    });
                }
                
                // 4. تحديث الـ documentRef فقط: status + reverseInfo
                tx.update(refDoc, {
                    status: 'reversed',
                    reversedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    reversedBy: CU.email,
                    reversedByUid: CU.uid,
                    reversedReason: cleanReason,
                    reverseMovementIds,
                });
                
                // 5. Audit log
                const auditRef = db.collection('auditLog').doc();
                tx.set(auditRef, {
                    action: 'document_reversed',
                    documentNo,
                    reason: cleanReason,
                    itemCount: originalMovIds.length,
                    dept: CURRENT_DEPT,
                    by: CU.email,
                    byUid: CU.uid,
                    at: firebase.firestore.FieldValue.serverTimestamp(),
                });
            });
            
            // ✅ Timeout 30 ثانية
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('انتهى وقت الانتظار')), 30000)
            );
            await Promise.race([transactionPromise, timeoutPromise]);
            
            showToast(`✅ تم إلغاء الطلبية ${documentNo}`, 'success', 6000);
            document.querySelector('.modal')?.remove();
            if (App.loadInventoryData) App.loadInventoryData();
            this._loadDocuments();
            
        } catch (e) {
            console.error(e);
            showToast(`فشل الإلغاء: ${e.message}`, 'error', 7000);
        }
    },

    // ✅ v6.7: printDocumentPDF موجود الآن في pdf-generator.js
    // ✅ v6.7: sendDocumentToTelegram موجود الآن في telegram-notifier.js
});
