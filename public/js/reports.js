// ============================================================
// js/reports.js — v6.8
// - 🔧 getFullYear → Baghdad — التقارير (الهدر + Dead Stock + الأكشن الكامل)
// إصلاحات: Onboarding في Firestore (لا localStorage)، رفع limits (v7.2: حُذف transfer_out)
// ============================================================

Object.assign(App, {
    async loadWasteReport() {
        const year = parseInt(document.getElementById('waste-year')?.value) || parseInt(new Intl.DateTimeFormat('en-CA', { timeZone: BAGHDAD_TZ }).format(new Date()).slice(0,4));
        const contentEl = document.getElementById('waste-content');
        const kpiEl = document.getElementById('waste-kpi');
        if (!contentEl) return;
        contentEl.innerHTML = skeletonRows(5, 4);
        try {
            const start = new Date(year, 0, 1), end = new Date(year, 11, 31, 23, 59, 59);
            const snap = await db.collection('departments').doc(CURRENT_DEPT).collection('movements')
                .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(start))
                .where('createdAt', '<=', firebase.firestore.Timestamp.fromDate(end)).limit(10000).get();
            if (snap.docs.length >= 10000) showToast('⚠️ تجاوزت 10000 حركة — التقرير قد يكون جزئياً', 'warning');
            const wm = snap.docs.filter(d => {
                const m = d.data();
                return m.dispensingType === 'wastage' || m.dispensingCategory === 'waste';
            });
            const em = snap.docs.filter(d => d.data().movementSubType === 'return_expired');
            const tw = wm.reduce((s, d) => s + (d.data().quantity || 0), 0);
            const te = em.reduce((s, d) => s + (d.data().quantity || 0), 0);
            if (kpiEl) kpiEl.innerHTML = `
                <div class="kpi-card" style="background:#3b1a1a"><strong>هدر</strong><h2 style="color:var(--danger)">${tw.toLocaleString('en-US')}</h2></div>
                <div class="kpi-card" style="background:#3b1a1a"><strong>مُتلَف منتهي</strong><h2 style="color:var(--danger)">${te.toLocaleString('en-US')}</h2></div>
                <div class="kpi-card"><strong>الإجمالي</strong><h2>${(tw + te).toLocaleString('en-US')}</h2></div>`;
            const byItem = {};
            [...wm, ...em].forEach(doc => {
                const m = doc.data();
                if (!byItem[m.inventoryId]) byItem[m.inventoryId] = { name: m.name || '', unit: m.unit || '', waste: 0, expired: 0 };
                if (m.dispensingType === 'wastage' || m.dispensingCategory === 'waste') byItem[m.inventoryId].waste += m.quantity || 0;
                if (m.movementSubType === 'return_expired') byItem[m.inventoryId].expired += m.quantity || 0;
            });
            const rows = Object.values(byItem).map(e => ({ ...e, total: e.waste + e.expired })).sort((a, b) => b.total - a.total).slice(0, 50);
            window._wasteRows = rows; window._wasteYear = year;
            contentEl.innerHTML = rows.length ? `<div class="table-wrap"><table class="inventory-table">
                <thead><tr><th>اسم المادة</th><th>وحدة</th><th>هدر</th><th>مُتلَف منتهي</th><th>الإجمالي</th></tr></thead>
                <tbody>${rows.map(r => `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.unit)}</td>
                    <td style="color:var(--warning)">${r.waste || 0}</td>
                    <td style="color:var(--danger)">${r.expired || 0}</td>
                    <td style="font-weight:bold">${r.total}</td></tr>`).join('')}
                </tbody></table></div>` : '<p class="text-muted">لا يوجد هدر ✅</p>';
        } catch (e) { contentEl.innerHTML = `<p class="text-danger">فشل: ${escapeHtml(e.message)}</p>`; }
    },

    printWasteReport() {
        const rows = window._wasteRows || [];
        const year = window._wasteYear || parseInt(new Intl.DateTimeFormat('en-CA', { timeZone: BAGHDAD_TZ }).format(new Date()).slice(0,4));
        if (!rows.length) { showToast('لا توجد بيانات', 'warning'); return; }
        const pw = window.open('', '_blank');
        pw.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>تقرير الهدر ${year}</title>
        <style>body{font-family:Arial;direction:rtl;margin:1cm;font-size:10px}h1{font-size:14px;text-align:center}
        table{width:100%;border-collapse:collapse}th{background:#1a3a5c;color:white;padding:5px;font-size:9px}
        td{border:1px solid #ddd;padding:4px;font-size:9px}tr:nth-child(even){background:#f5f5f5}
        @media print{.no-print{display:none}}</style></head><body>
        <h1>مستشفى الشطرة العام — تقرير الهدر ${year}</h1>
        <button class="no-print" onclick="window.print()" style="margin-bottom:10px;padding:6px 16px;cursor:pointer">🖨️ طباعة</button>
        <table><thead><tr><th>اسم المادة</th><th>وحدة</th><th>هدر</th><th>مُتلَف منتهي</th><th>الإجمالي</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${escapeHtml(r.name || '')}</td><td>${escapeHtml(r.unit || '')}</td><td>${r.waste || 0}</td><td>${r.expired || 0}</td><td><strong>${r.total}</strong></td></tr>`).join('')}</tbody>
        </table></body></html>`);
        pw.document.close();
    },

    async loadDeadStockReport() {
        const MONTHS = 6;
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - MONTHS);
        try {
            const snap = await db.collection('departments').doc(CURRENT_DEPT)
                .collection('movements').where('movType', '==', 'out')
                .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(cutoff)).limit(5000).get();
            // ⚠️ المادة "نشطة" حتى لو صُرفت كهدر — لكن نريد المواد التي لم تُصرَف فعلياً للاحتياج
            const activeIds = new Set();
            snap.docs.forEach(d => {
                const m = d.data();
                if (m.dispensingType === 'wastage' || m.dispensingCategory === 'waste') return;
                if (m.movementSubType === 'return_expired') return;
                activeIds.add(m.inventoryId);
            });
            const dead = itemsCache.filter(item => item.quantity > 0 && !activeIds.has(item.id));
            window._deadStockItems = dead;
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.innerHTML = `<div class="modal-content"><button class="modal-close" onclick="this.closest('.modal').remove()">✕</button>
                <h3>💤 Dead Stock — لم يُصرَف > ${MONTHS} أشهر</h3>
                ${dead.length === 0 ? '<p class="text-muted" style="text-align:center;padding:2rem">✅ لا توجد مواد راكدة</p>' : `
                <p class="text-muted">${dead.length} مادة برصيد > 0 لم تُصرَف > ${MONTHS} أشهر (يستثني الهدر)</p>
                <div class="table-wrap" style="max-height:55vh"><table class="inventory-table">
                    <thead><tr><th>الرمز</th><th>الاسم</th><th>الوحدة</th><th>الرصيد</th><th>أقرب انتهاء</th></tr></thead>
                    <tbody>${dead.map(item => `<tr>
                        <td>${escapeHtml(item.code || '')}</td><td>${escapeHtml(item.name || '')}</td>
                        <td>${escapeHtml(item.unit || '')}</td><td style="font-weight:bold">${item.quantity || 0}</td>
                        <td>${item.earliestExpiry?.toDate?.()?.toLocaleDateString('en-GB', { calendar: 'gregory', numberingSystem: 'latn' }) || '—'}</td>
                    </tr>`).join('')}</tbody></table></div>
                <div style="display:flex;gap:8px;margin-top:1rem">
                    <button class="btn btn-sm" onclick="App.exportDeadStock()">📊 تصدير Excel</button>
                </div>`}
            </div>`;
            document.body.appendChild(modal);
        } catch (e) { showToast('فشل: ' + e.message, 'error'); }
    },

    exportDeadStock() {
        const rows = window._deadStockItems || [];
        if (!rows.length) { showToast('لا توجد بيانات', 'warning'); return; }
        const ws = XLSX.utils.aoa_to_sheet([
            ['الرمز', 'الاسم', 'وحدة', 'الرصيد', 'أقرب انتهاء'],
            ...rows.map(r => [r.code || '', r.name || '', r.unit || '', r.quantity || 0,
                r.earliestExpiry?.toDate?.()?.toLocaleDateString('en-GB', { calendar: 'gregory', numberingSystem: 'latn' }) || '—'])
        ]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Dead Stock');
        XLSX.writeFile(wb, `dead_stock_${CURRENT_DEPT}.xlsx`);
    },

    // ⚠️ #7 (مُحذَفة): saveReceivedQty كانت تكتب على /yearlyNeeds/{year} غير المستخدَم
    //    منذ v6.1، حفظ receivedQty و fulfillmentRate يتم في needs.js عبر saveNeedsAdjustments
    //    على المسار: departments/{dept}/inventory/{itemId}
    //    لو احتجت تعديل receivedQty للمواد، استخدم صفحة "📈 تقدير الحاجة"

    printNeedsReport() {
        const ty = parseInt(new Intl.DateTimeFormat('en-CA', { timeZone: BAGHDAD_TZ }).format(new Date()).slice(0,4)) + 2;
        const dn = DEPT_NAMES[CURRENT_DEPT] || CURRENT_DEPT;
        const today = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Baghdad' });
        const pw = window.open('', '_blank');
        const thead = document.querySelector('#needs-table thead')?.innerHTML || '';
        const tbody = document.querySelector('#needs-table tbody')?.innerHTML || '';
        pw.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
        <title>لجنة تقدير الاحتياج</title>
        <style>body{font-family:Arial;direction:rtl;margin:1cm;font-size:11px}
        h1{font-size:16px;text-align:center}h2{font-size:13px;text-align:center;color:#555}
        table{width:100%;border-collapse:collapse}th{background:#1a3a5c;color:white;padding:5px;font-size:9px}
        td{border:1px solid #ddd;padding:4px;font-size:9px}tr:nth-child(even){background:#f5f5f5}
        .footer{margin-top:20px;display:flex;justify-content:space-between;font-size:10px}
        @media print{.no-print{display:none}}</style></head><body>
        <h1>مستشفى الشطرة العام</h1>
        <h2>لجنة تقدير الاحتياج — ${dn} — ${ty}</h2>
        <p style="text-align:center;color:#888;font-size:10px">تاريخ الإعداد: ${today}</p>
        <button class="no-print" onclick="window.print()" style="margin-bottom:10px;padding:6px 16px;cursor:pointer">🖨️ طباعة</button>
        <table><thead>${thead}</thead><tbody>${tbody}</tbody></table>
        <div class="footer"><div>المسؤول: __________________</div><div>التوقيع: __________________</div><div>التاريخ: ${today}</div></div>
        </body></html>`);
        pw.document.close();
    },

    exportLedgerPDF() {
        const tbody = document.querySelector('#ledger-table tbody');
        if (!tbody) { showToast('لا توجد بيانات', 'warning'); return; }
        const today = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Baghdad', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const deptName = DEPT_NAMES[CURRENT_DEPT] || CURRENT_DEPT;
        const headers = Array.from(document.querySelectorAll('#ledger-table thead th')).map(th => th.textContent.trim());
        const rows = Array.from(tbody.querySelectorAll('tr')).filter(tr => !tr.classList.contains('skeleton-row'))
            .map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim()));
        const pw = window.open('', '_blank');
        pw.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>سجل الصرف</title>
        <style>body{font-family:Arial;direction:rtl;margin:1cm;font-size:9px}
        h1{font-size:14px;text-align:center;margin:0}h2{font-size:11px;text-align:center;color:#444;margin:3px 0 10px}
        table{width:100%;border-collapse:collapse;table-layout:fixed}
        th{background:#1a3a5c;color:white;padding:4px 3px;font-size:8px}
        td{border:1px solid #ccc;padding:3px;font-size:8px;word-break:break-word;vertical-align:top}
        tr:nth-child(even){background:#f9f9f9}
        @media print{.no-print{display:none}@page{size:A4 landscape;margin:1cm}}</style></head><body>
        <h1>مستشفى الشطرة العام</h1><h2>سجل الصرف — ${deptName}</h2>
        <p style="text-align:center;font-size:9px;color:#666;margin-bottom:8px">${today} | ${rows.length} سجل</p>
        <button class="no-print" onclick="window.print()" style="margin-bottom:8px;padding:4px 12px;cursor:pointer">🖨️ طباعة</button>
        <table><thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>
        </body></html>`);
        pw.document.close();
    },

    async showItemTimeline(itemId, itemName) {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `<div class="modal-content" style="max-width:500px">
            <button class="modal-close" onclick="this.closest('.modal').remove()">✕</button>
            <h3>📅 تاريخ المادة — ${escapeHtml(itemName)}</h3>
            <div id="timeline-content"><div class="ai-thinking">جاري التحميل</div></div>
        </div>`;
        document.body.appendChild(modal);
        try {
            const snap = await db.collection('departments').doc(CURRENT_DEPT).collection('movements')
                .where('inventoryId', '==', itemId).orderBy('createdAt', 'desc').limit(100).get();
            const el = document.getElementById('timeline-content');
            if (!el) return;
            if (snap.empty) { el.innerHTML = '<p class="text-muted" style="text-align:center;padding:1rem">لا توجد حركات</p>'; return; }
            const movs = snap.docs.map(d => d.data());
            const totalOut = movs.filter(m => m.movType === 'out').reduce((s, m) => s + (m.quantity || 0), 0);
            const totalIn = movs.filter(m => m.movType === 'in').reduce((s, m) => s + (m.quantity || 0), 0);
            const item = AppState.inventory.get(itemId);
            el.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px">
                <div style="background:var(--surface3);padding:8px;border-radius:var(--radius-sm);text-align:center"><div style="font-size:1rem;font-weight:700;color:var(--primary)">${item?.quantity || 0}</div><div style="font-size:0.65rem;color:var(--muted)">الرصيد الحالي</div></div>
                <div style="background:var(--surface3);padding:8px;border-radius:var(--radius-sm);text-align:center"><div style="font-size:1rem;font-weight:700;color:var(--success)">${totalIn}</div><div style="font-size:0.65rem;color:var(--muted)">إجمالي وارد</div></div>
                <div style="background:var(--surface3);padding:8px;border-radius:var(--radius-sm);text-align:center"><div style="font-size:1rem;font-weight:700;color:var(--danger)">${totalOut}</div><div style="font-size:0.65rem;color:var(--muted)">إجمالي صادر</div></div>
            </div>
            <div style="max-height:50vh;overflow-y:auto">
                ${movs.map(m => {
                    const isIn = m.movType === 'in';
                    const date = getMovementDate(m)?.toLocaleDateString('en-GB', { timeZone: 'Asia/Baghdad' }) || '—';
                    const time = getMovementDate(m)?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) || '';
                    const subType = { dispense_circle: 'تجهيز دائرة', purchase: 'مشتريات', opening: 'افتتاحي', dispense: 'صرف', return_good: 'إرجاع جيد', return_expired: 'إرجاع منتهي', inventory_adj: 'تسوية', wastage: 'هدر' }[m.movementSubType] || m.movementSubType || '';
                    const dest = m.destination?.main || m.source || '';
                    return `<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
                        <div style="font-size:1.1rem;flex-shrink:0">${isIn ? '📥' : '📤'}</div>
                        <div style="flex:1">
                            <div style="display:flex;justify-content:space-between">
                                <span style="font-size:0.78rem;font-weight:600;color:${isIn ? 'var(--success)' : 'var(--danger)'}">${isIn ? '+' : '-'}${m.quantity || 0} ${escapeHtml(m.unit || '')}</span>
                                <span style="font-size:0.68rem;color:var(--muted)">${date} ${time}</span>
                            </div>
                            <div style="font-size:0.72rem;color:var(--text2)">${subType}${dest ? ' ← ' + escapeHtml(dest) : ''}</div>
                            <div style="font-size:0.68rem;color:var(--muted)">الرصيد بعدها: ${m.quantityAfter ?? '—'}${m.batchNumber ? ' | دفعة: ' + escapeHtml(m.batchNumber) : ''}</div>
                        </div>
                    </div>`;
                }).join('')}
            </div>
            ${snap.size >= 100 ? '<p class="text-muted" style="font-size:0.72rem;margin-top:6px">آخر 100 حركة فقط</p>' : ''}`;
        } catch (e) {
            const el = document.getElementById('timeline-content');
            if (el) el.innerHTML = `<p class="text-danger">فشل: ${escapeHtml(e.message)}</p>`;
        }
    },

    async runSmartMinUpdate() {
        if (!isStaff()) return;
        const confirmed = await this.confirmAction('AI سيحسب الحد الأدنى لكل مادة بناءً على معدل الصرف الفعلي (90 يوم × 30). هل تريد المتابعة؟');
        if (!confirmed) return;
        const resultsModal = document.createElement('div');
        resultsModal.className = 'modal';
        resultsModal.innerHTML = `<div class="modal-content"><button class="modal-close" onclick="this.closest('.modal').remove()">✕</button>
            <h3>🧠 اقتراحات الحد الأدنى الذكي</h3>
            <div id="smart-min-results"><div class="ai-thinking">جاري الحساب</div></div>
            <div class="ai-disclaimer">⚠️ للاستئناس فقط — القرار للصيدلاني</div>
        </div>`;
        document.body.appendChild(resultsModal);
        const el = document.getElementById('smart-min-results');
        const suggestions = [];
        try {
            const items = itemsCache.filter(i => i.quantity > 0).slice(0, 50);
            let done = 0;
            for (const item of items) {
                const suggested = await calcSmartMinQty(CURRENT_DEPT, item.id);
                done++;
                if (el) el.innerHTML = `<div class="ai-thinking">جاري الحساب (${done}/${items.length})</div>`;
                if (suggested === null) continue;
                const diff = suggested - (item.minQuantity || 0);
                if (Math.abs(diff) < 5) continue;
                suggestions.push({ id: item.id, name: item.name, unit: item.unit, current: item.minQuantity || 0, suggested, diff });
            }
            if (!suggestions.length) { if (el) el.innerHTML = '<p style="color:var(--success);text-align:center;padding:1rem">✅ الحدود الدنيا مناسبة</p>'; return; }
            window._smartMinSuggestions = suggestions;
            if (el) el.innerHTML = `<p style="font-size:0.82rem;margin-bottom:8px">${suggestions.length} مادة تحتاج تحديث:</p>
            <div style="max-height:50vh;overflow-y:auto">
                ${suggestions.map((s, i) => `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
                    <input type="checkbox" id="smin-${i}" checked>
                    <label for="smin-${i}" style="flex:1;font-size:0.82rem;cursor:pointer">
                        <strong>${escapeHtml(s.name)}</strong>
                        <span style="color:var(--muted)"> | الحالي: ${s.current} → مقترح: </span>
                        <strong style="color:${s.diff > 0 ? 'var(--warning)' : 'var(--success)'}">${s.suggested}</strong>
                    </label>
                </div>`).join('')}
            </div>
            <div style="display:flex;gap:8px;margin-top:1rem;justify-content:flex-end">
                <button class="btn btn-sm" onclick="this.closest('.modal').remove()">إلغاء</button>
                <button class="btn btn-primary btn-sm" onclick="App._applySmartMin()">✅ تطبيق المحدد</button>
            </div>`;
        } catch (e) { if (el) el.innerHTML = `<p class="text-danger">فشل: ${escapeHtml(e.message)}</p>`; }
    },

    async _applySmartMin() {
        const suggestions = window._smartMinSuggestions || [];
        const selected = suggestions.filter((_, i) => document.getElementById(`smin-${i}`)?.checked);
        if (!selected.length) { showToast('لم تختر أي مادة', 'warning'); return; }
        try {
            const batch = db.batch();
            selected.forEach(s => {
                const ref = db.collection('departments').doc(CURRENT_DEPT).collection('inventory').doc(s.id);
                batch.update(ref, { minQuantity: s.suggested, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
            });
            await batch.commit();
            await db.collection('auditLog').doc().set({
                action: 'smart_min_update', dept: CURRENT_DEPT, count: selected.length,
                items: selected.map(s => ({ id: s.id, name: s.name, old: s.current, new: s.suggested })),
                by: CU.email, byUid: CU.uid, at: firebase.firestore.FieldValue.serverTimestamp()
            });
            selected.forEach(s => { const item = AppState.inventory.get(s.id); if (item) { item.minQuantity = s.suggested; AppState.inventory.set(s.id, item); } });
            itemsCache = [...AppState.inventory.values()];
            document.querySelector('.modal')?.remove();
            showToast(`✅ تم تحديث الحد الأدنى لـ ${selected.length} مادة`, 'success');
            if (App._reRenderTable) App._reRenderTable();
        } catch (e) { showToast('فشل: ' + e.message, 'error'); }
    },

    async exportFullBackup() {
        if (!isAdmin()) { showToast('للمدير فقط', 'warning'); return; }
        showToast('جاري إنشاء النسخة الاحتياطية...', 'info');
        try {
            const today = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Baghdad' }).replace(/\//g, '-');
            const deptName = DEPT_NAMES[CURRENT_DEPT] || CURRENT_DEPT;
            const wb = XLSX.utils.book_new();
            const invData = [
                [`نسخة احتياطية — المخزون — ${deptName} — ${today}`], [],
                ['الرمز', 'الاسم', 'الوحدة', 'الكمية', 'الحد الأدنى', 'الأولوية', 'أقرب انتهاء', 'آخر استلام'],
                ...itemsCache.map(item => [
                    item.code || '', item.name || '', item.unit || '', item.quantity || 0,
                    item.minQuantity || 0, item.importPriority || '',
                    item.earliestExpiry?.toDate?.()?.toLocaleDateString('en-GB', { calendar: 'gregory', numberingSystem: 'latn' }) || '',
                    item.lastReceivedAt?.toDate?.()?.toLocaleDateString('en-GB', { calendar: 'gregory', numberingSystem: 'latn' }) || ''
                ])
            ];
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(invData), 'المخزون');

            // ⚠️ Pagination لجلب كل الحركات (كان 1000 فقط)
            const allMovs = [];
            let lastDoc = null;
            for (let i = 0; i < 5; i++) {
                let q = db.collection('departments').doc(CURRENT_DEPT).collection('movements')
                    .orderBy('createdAt', 'desc').limit(5000);
                if (lastDoc) q = q.startAfter(lastDoc);
                const snap = await q.get();
                if (snap.empty) break;
                allMovs.push(...snap.docs.map(d => ({ ...d.data(), id: d.id })));
                if (snap.docs.length < 5000) break;
                lastDoc = snap.docs[snap.docs.length - 1];
            }

            const movData = [
                [`نسخة احتياطية — الحركات — ${deptName} — ${today}`], [],
                ['التاريخ', 'الاسم', 'الرمز', 'النوع', 'النوع الفرعي', 'الكمية', 'الرصيد قبل', 'الرصيد بعد', 'الجهة', 'الدفعة', 'المسؤول'],
                ...allMovs.map(m => [
                    m.createdAt?.toDate?.()?.toLocaleDateString('en-GB', { calendar: 'gregory', numberingSystem: 'latn' }) || '',
                    m.name || '', m.code || '', m.movType || '', m.movementSubType || '',
                    m.quantity || 0, m.quantityBefore ?? '', m.quantityAfter ?? '',
                    m.destination?.main || '', m.batchNumber || '', m.createdByName || ''
                ])
            ];
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(movData), `${allMovs.length} حركة`);
            XLSX.writeFile(wb, `backup_${CURRENT_DEPT}_${today}.xlsx`);
            showToast(`✅ نسخة احتياطية: ${itemsCache.length} صنف + ${allMovs.length} حركة`, 'success');
        } catch (e) { showToast('فشل: ' + e.message, 'error'); }
    },

    // ⚠️ Onboarding يُخزَّن في Firestore (users/{uid}/onboardingDone) بدلاً من localStorage
    async checkOnboarding() {
        if (!CU?.uid) return;
        try {
            const userDoc = await db.collection('users').doc(CU.uid).get();
            if (userDoc.data()?.onboardingDone) return;
        } catch(e) { return; }

        const steps = [
            { icon: '📦', title: 'مرحباً في مخزون الصيدلية', text: 'سنريك كيف تستخدم التطبيق في 3 خطوات' },
            { icon: '📤', title: 'الصرف', text: 'اضغط على أي مادة ثم "صرف" لتسجيل الصرف' },
            { icon: '📥', title: 'الاستلام', text: 'عند وصول التجهيز اضغط "استلام" وأدخل الكمية' },
            { icon: '🤖', title: 'المساعد الذكي', text: 'اضغط AI في الأسفل للحصول على تحليلات ذكية' }
        ];
        let current = 0;
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'onboarding-modal';
        const render = () => {
            const s = steps[current];
            const isLast = current === steps.length - 1;
            modal.innerHTML = `<div class="modal-content" style="max-width:340px;text-align:center">
                <div style="font-size:3.5rem;margin-bottom:0.75rem">${s.icon}</div>
                <h3 style="margin-bottom:0.5rem">${s.title}</h3>
                <p style="color:var(--text2);font-size:0.85rem;margin-bottom:1.5rem;line-height:1.7">${s.text}</p>
                <div style="display:flex;justify-content:center;gap:6px;margin-bottom:1.5rem">
                    ${steps.map((_, i) => `<div style="width:8px;height:8px;border-radius:50%;background:${i === current ? 'var(--primary)' : 'var(--border2)'}"></div>`).join('')}
                </div>
                <div style="display:flex;gap:8px">
                    ${current > 0 ? `<button class="btn btn-sm" style="flex:1" onclick="App._onboardingNav(-1)">← السابق</button>` : ''}
                    <button class="btn btn-primary btn-sm" style="flex:1" onclick="App._onboardingNav(1)">
                        ${isLast ? 'ابدأ الاستخدام ✅' : 'التالي →'}
                    </button>
                </div>
                <button class="btn btn-sm" style="margin-top:8px;width:100%;opacity:0.6" onclick="App._onboardingDone()">تخطي</button>
            </div>`;
        };
        document.body.appendChild(modal);
        render();
        this._onboardingNav = (dir) => { current += dir; if (current >= steps.length) this._onboardingDone(); else render(); };
        this._onboardingDone = async () => {
            modal.remove();
            try {
                await db.collection('users').doc(CU.uid).update({
                    onboardingDone: true,
                    onboardingDoneAt: firebase.firestore.Timestamp.now()
                });
            } catch(e) { console.warn('Failed to save onboarding state:', e); }
        };
    },

    exportSupplierReport() {
        const now = new Date();
        const items = itemsCache.filter(item => {
            const exp = item.earliestExpiry?.toDate?.();
            if (!exp) return false;
            const days = Math.ceil((exp - now) / 86400000);
            return days > 0 && days <= 90;
        }).sort((a, b) => (a.earliestExpiry?.toDate?.()?.getTime() || 0) - (b.earliestExpiry?.toDate?.()?.getTime() || 0));
        if (!items.length) { showToast('لا توجد مواد تنتهي < 90 يوم', 'warning'); return; }
        const today = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Baghdad' });
        const ws = XLSX.utils.aoa_to_sheet([
            [`تقرير المورد — ${DEPT_NAMES[CURRENT_DEPT]} — ${today}`], [],
            ['ت', 'الرمز', 'الاسم', 'وحدة', 'الرصيد', 'أقرب انتهاء', 'أيام متبقية', 'الكمية المطلوبة'],
            ...items.map((item, i) => {
                const exp = item.earliestExpiry?.toDate?.();
                const days = exp ? Math.ceil((exp - now) / 86400000) : 0;
                return [i + 1, item.code || '', item.name || '', item.unit || '', item.quantity || 0, exp?.toLocaleDateString('en-GB', { calendar: 'gregory', numberingSystem: 'latn' }) || '—', days, '____________'];
            })
        ]);
        ws['!cols'] = [{ wch: 4 }, { wch: 14 }, { wch: 35 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 18 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'تقرير المورد');
        XLSX.writeFile(wb, `supplier_${CURRENT_DEPT}_${today.replace(/\//g, '-')}.xlsx`);
        showToast('✅ تم تصدير تقرير المورد', 'success');
    },

    async logout() {
        const confirmed = await this.confirmAction('هل تريد تسجيل الخروج؟');
        if (!confirmed) return;
        SessionCounter.reset();
        auth.signOut();
    },
});
