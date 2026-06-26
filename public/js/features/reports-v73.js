// ============================================================
// js/features/reports-v73.js — v7.4 (مُحدَّث)
// ============================================================
// إصلاحات v7.4:
//   ✅ switchReportsTab واحد (لا تعارض مع dashboard.js)
//   ✅ renderWarehouseDashboard يستخدم yearSummaries (لا 20K حركة)
//   ✅ renderAnnualReport: يقرأ السنة الصحيحة + audit للتصدير
//   ✅ تبويب جديد: priority-coverage (نسبة توفر الأولوية الاستيرادية)
// ============================================================

(function() {
'use strict';

// ============================================================
// switchReportsTab — الوحيد في المشروع
// ============================================================
window.switchReportsTab = async function(tab) {
    const tabsContainer = document.getElementById('reports-tabs');
    if (tabsContainer) {
        tabsContainer.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('reports-tab-' + tab)?.classList.add('active');
    }
    if (App.destroyCharts) App.destroyCharts();
    const container = document.getElementById('reports-tab-content');
    if (!container) return;

    // مؤشر تحميل سريع
    container.innerHTML = `<div style="text-align:center;padding:30px"><div style="font-size:2.4rem">⏳</div><p style="color:var(--primary)">جارٍ التحميل...</p></div>`;

    // حفظ التبويب الحالي في sessionStorage
    try { sessionStorage.setItem('reports_active_tab', tab); } catch {}

    try {
        switch (tab) {
            case 'warehouse':         return await App.renderWarehouseDashboard('reports-tab-content');
            case 'ledger':            return await App.renderFullLedger('reports-tab-content');
            case 'purchases':         return await App.renderPurchasesReport('reports-tab-content');
            case 'circle':            return await App.renderCircleReport('reports-tab-content');
            case 'destinations':      return await App.renderDestinationsReport('reports-tab-content');
            case 'out-of-stock':      return await App.renderOutOfStockReport('reports-tab-content');
            case 'low-stock':         return await App.renderLowStockReport('reports-tab-content');
            case 'near-expiry':       return await App.renderNearExpiryReport('reports-tab-content');
            case 'slow-moving':       return await App.renderSlowMovingReport('reports-tab-content');
            case 'new-no-mov':        return await App.renderNewNoMovementReport('reports-tab-content');
            case 'days-of-supply':    return await App.renderDaysOfSupplyReport('reports-tab-content');
            case 'turnover':          return await App.renderTurnoverReport('reports-tab-content');
            case 'abc':               return await App.renderABCReport('reports-tab-content');
            case 'gap':               return await App.renderGapReport('reports-tab-content');
            case 'exceeded':          return await App.renderExceededNeedReport('reports-tab-content');
            case 'yoy-compare':       return await App.renderYoYCompareReport('reports-tab-content');
            case 'top-waste':         return await App.renderTopWasteReport('reports-tab-content');
            case 'backdated':         return await App.renderBackdatedReport('reports-tab-content');
            case 'users':             return await App.renderUsersReport('reports-tab-content');
            case 'annual':            return await App.renderAnnualReport('reports-tab-content');
            case 'count':             return await App.renderCountTab('reports-tab-content');
            case 'waste':             return await App.renderWasteReport('reports-tab-content');
            case 'priority-coverage': return await App.renderPriorityCoverageReport('reports-tab-content');
            // التبويبات القديمة من reports-v67-tabs.js
            case 'documents':         container.innerHTML = '<div id="documents-view-container"></div>'; return await App.renderDocumentsView?.('documents-view-container');
            case 'ministry':          container.innerHTML = '<div id="ministry-tree-container"></div>'; return await App.renderMinistryListTreeView?.('ministry-tree-container');
            case 'yoy':               container.innerHTML = '<div id="yoy-diff-container"></div>'; return await App.renderYoYDiffView?.('yoy-diff-container');
            case 'nva':               container.innerHTML = '<div id="nva-container"></div>'; return await App.renderNeedVsActualReport?.('nva-container');
            case 'balance':           container.innerHTML = '<div id="periodic-balance-container"></div>'; if (typeof PeriodicBalance !== 'undefined') return await PeriodicBalance.render('periodic-balance-container');
        }
        container.innerHTML = `<p style="text-align:center;padding:30px;color:var(--muted)">التبويب غير معروف: ${tab}</p>`;
    } catch (e) {
        console.error('switchReportsTab', tab, e);
        container.innerHTML = `<div style="padding:20px;color:var(--danger)">فشل التحميل: ${escapeHtml(handleFirestoreError(e, 'switchReportsTab'))}</div>`;
    }
};

// ============================================================
// 📊 لوحة المخزن (v7.4: يستخدم yearSummaries عند الإمكان)
// ============================================================
Object.assign(App, {
    async renderWarehouseDashboard(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const dept = CURRENT_DEPT;
        const items = [...AppState.inventory.values()];
        const currentYear = new Date().getFullYear();

        // 🚀 v7.4: استخدام yearSummary (وثيقة واحدة) بدل جلب 20K حركة
        let yearTotals = { totalDispensed: 0, totalReceived: 0, totalWaste: 0 };
        try {
            const summary = await fetchYearSummary(dept, currentYear);
            if (summary) {
                yearTotals.totalDispensed = summary.totalOut || summary.totalDispensed || 0;
                yearTotals.totalReceived = summary.totalIn || summary.totalReceived || 0;
                yearTotals.totalWaste = summary.totalWaste || 0;
            }
        } catch (e) {
            console.warn('warehouse yearSummary:', e.message);
        }

        const totalQty = items.reduce((s, i) => s + (i.quantity || 0), 0);
        const lowItems = items.filter(i => (i.quantity || 0) > 0 && (i.quantity || 0) <= (i.minQuantity || 0));
        const outItems = items.filter(i => (i.quantity || 0) === 0 && i.depletionDate);

        container.innerHTML = `
            <div class="kpi-row">
                <div class="kpi-card"><strong>📦 المواد</strong><h2>${fmtNum(items.length)}</h2></div>
                <div class="kpi-card"><strong>📊 إجمالي الكميات</strong><h2>${fmtNum(totalQty)}</h2></div>
                <div class="kpi-card" style="background:#1f3a2a"><strong>✅ نشطة</strong><h2 style="color:var(--success)">${fmtNum(items.filter(i => (i.quantity||0)>0).length)}</h2></div>
                <div class="kpi-card" style="background:#332a10"><strong>⚠️ تحت الحد</strong><h2 style="color:var(--warning)">${fmtNum(lowItems.length)}</h2></div>
                <div class="kpi-card" style="background:#331a1a"><strong>🔴 نفدت</strong><h2 style="color:var(--danger)">${fmtNum(outItems.length)}</h2></div>
            </div>

            <div class="kpi-row" style="margin-top:8px">
                <div class="kpi-card" style="background:#1a2a3a"><strong>📤 صرف ${currentYear}</strong><h2 style="color:#22d3ee">${fmtNum(yearTotals.totalDispensed)}</h2></div>
                <div class="kpi-card" style="background:#1f3a2a"><strong>📥 وارد ${currentYear}</strong><h2 style="color:var(--success)">${fmtNum(yearTotals.totalReceived)}</h2></div>
                <div class="kpi-card" style="background:#3a2010"><strong>♻️ هدر ${currentYear}</strong><h2 style="color:var(--danger)">${fmtNum(yearTotals.totalWaste)}</h2></div>
            </div>

            <div class="card">
                <h3>📊 توزيع حسب الأولوية الاستيرادية</h3>
                <canvas id="warehouse-priority-chart" height="200"></canvas>
            </div>

            <div class="card">
                <h3>🏆 أعلى 10 مواد رصيداً</h3>
                <div class="table-wrap">
                    <table class="inventory-table">
                        <thead><tr><th>الرمز</th><th>المادة</th><th>الرصيد</th><th>الوحدة</th><th>الأولوية</th></tr></thead>
                        <tbody>
                            ${[...items].sort((a,b) => (b.quantity||0)-(a.quantity||0)).slice(0,10).map(i => `
                                <tr>
                                    <td style="font-family:monospace;font-size:0.72rem">${escapeHtml(i.code||'')}</td>
                                    <td>${escapeHtml(i.name||'')}</td>
                                    <td style="font-weight:600">${fmtNum(i.quantity||0)}</td>
                                    <td>${escapeHtml(i.unit||'')}</td>
                                    <td>${i.importPriority || '—'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>`;

        // مخطط الأولوية
        const priorityCounts = { A1: 0, A2: 0, A: 0, B: 0, C: 0, '—': 0 };
        items.forEach(i => {
            const p = i.importPriority || '—';
            priorityCounts[p] = (priorityCounts[p] || 0) + 1;
        });

        new Chart(document.getElementById('warehouse-priority-chart'), {
            type: 'doughnut',
            data: {
                labels: Object.keys(priorityCounts),
                datasets: [{
                    data: Object.values(priorityCounts),
                    backgroundColor: ['#ef4444','#f97316','#eab308','#22d3ee','#94a3b8','#64748b']
                }]
            },
            options: {
                plugins: { legend: { position: 'right', labels: { color: '#e1e7f0' } } }
            }
        });
    },

    // ============================================================
    // 📋 التقارير السنوية (v7.4: + audit للتصدير)
    // ============================================================
    async renderAnnualReport(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const dept = CURRENT_DEPT;
        const currentYear = new Date().getFullYear();
        const years = [];
        for (let y = currentYear; y >= currentYear - 4; y--) years.push(y);

        container.innerHTML = `
            <div class="card">
                <h3>📋 التقارير السنوية</h3>
                <div class="form-group">
                    <label>السنة</label>
                    <select id="annual-year" class="form-control" style="width:auto">
                        ${years.map(y => `<option value="${y}">${y}</option>`).join('')}
                    </select>
                </div>
                <button class="btn btn-primary" id="annual-load">📊 تحميل</button>
                <button class="btn" id="annual-export">📥 تصدير Excel</button>
                <div id="annual-result" style="margin-top:14px"></div>
            </div>`;

        document.getElementById('annual-load').onclick = async () => {
            const year = parseInt(document.getElementById('annual-year').value);
            const result = document.getElementById('annual-result');
            result.innerHTML = '<p class="text-muted">جارٍ التحميل...</p>';

            try {
                const summary = await fetchYearSummary(dept, year);
                if (!summary) {
                    result.innerHTML = `<p class="text-warning">ملخص ${year} غير موجود. يجب بناؤه من صفحة الأرشفة.</p>`;
                    return;
                }
                const items = Object.entries(summary.items || {})
                    .map(([id, data]) => ({
                        id, ...data,
                        name: AppState.inventory.get(id)?.name || data.name || '—',
                        code: AppState.inventory.get(id)?.code || ''
                    }))
                    .sort((a, b) => (b.totalDispensed || 0) - (a.totalDispensed || 0));

                result.innerHTML = `
                    <h4>السنة ${year} — ${items.length} مادة</h4>
                    <div class="table-wrap">
                        <table class="inventory-table">
                            <thead><tr>
                                <th>الرمز</th>
                                <th>المادة</th>
                                <th>وارد</th>
                                <th>صرف</th>
                                <th>هدر</th>
                                <th>الرصيد الختامي</th>
                                <th>أشهر التوفر</th>
                            </tr></thead>
                            <tbody>
                                ${items.slice(0, 300).map(i => `
                                    <tr>
                                        <td style="font-family:monospace;font-size:0.72rem">${escapeHtml(i.code)}</td>
                                        <td>${escapeHtml(i.name)}</td>
                                        <td style="color:var(--success)">${fmtNum(i.totalReceived||0)}</td>
                                        <td>${fmtNum(i.totalDispensed||0)}</td>
                                        <td style="color:var(--warning)">${fmtNum(i.totalWaste||0)}</td>
                                        <td style="font-weight:600">${fmtNum(i.closingBalance||0)}</td>
                                        <td>${typeof i.actualMonthsAvailable === 'number' ? i.actualMonthsAvailable.toFixed(1) : '—'}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                    ${items.length > 300 ? `<p class="text-muted">يُعرض 300 من ${items.length} — استخدم تصدير Excel للكل</p>` : ''}`;
            } catch (e) {
                result.innerHTML = `<p class="text-danger">فشل: ${escapeHtml(handleFirestoreError(e, 'annualReport'))}</p>`;
            }
        };

        document.getElementById('annual-export').onclick = async () => {
            const year = parseInt(document.getElementById('annual-year').value);
            try {
                const summary = await fetchYearSummary(dept, year);
                if (!summary) { showToast(`ملخص ${year} غير موجود`, 'warning'); return; }
                const rows = Object.entries(summary.items || {}).map(([id, data]) => {
                    const inv = AppState.inventory.get(id);
                    return [
                        inv?.code || data.code || '',
                        inv?.name || data.name || '',
                        inv?.unit || '',
                        data.totalReceived || 0,
                        data.totalDispensed || 0,
                        data.totalWaste || 0,
                        data.closingBalance || 0,
                        typeof data.actualMonthsAvailable === 'number' ? data.actualMonthsAvailable.toFixed(1) : ''
                    ];
                });

                // 🆕 v7.4: استخدام exportXlsxAudited
                if (typeof exportXlsxAudited === 'function') {
                    await exportXlsxAudited({
                        filename: `annual_${dept}_${year}`,
                        reportName: `Annual Report ${year}`,
                        sheetName: `سنة ${year}`,
                        headers: ['الرمز','المادة','الوحدة','وارد','صرف','هدر','الرصيد الختامي','أشهر التوفر'],
                        rows,
                        columnWidths: [14, 35, 10, 12, 12, 12, 14, 12],
                        extra: { year, dept }
                    });
                } else {
                    // fallback
                    const wb = XLSX.utils.book_new();
                    const ws = XLSX.utils.aoa_to_sheet([
                        [`التقرير السنوي ${year} — ${DEPT_NAMES[dept]}`], [],
                        ['الرمز','المادة','الوحدة','وارد','صرف','هدر','الرصيد الختامي','أشهر التوفر'],
                        ...rows
                    ]);
                    ws['!cols'] = [{wch:14},{wch:35},{wch:10},{wch:12},{wch:12},{wch:12},{wch:14},{wch:12}];
                    XLSX.utils.book_append_sheet(wb, ws, `سنة ${year}`);
                    XLSX.writeFile(wb, `annual_${dept}_${year}.xlsx`);
                    showToast('✅ تم التصدير', 'success');
                }
            } catch (e) {
                showToast('فشل: ' + e.message, 'error');
            }
        };
    },

    // ============================================================
    // 📦 الجرد الدوري (مبسَّط)
    // ============================================================
    async renderCountTab(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = `
            <div class="card">
                <h3>📦 الجرد الدوري</h3>
                <p class="text-muted" style="font-size:0.78rem">قارن الكميات الفعلية بالنظام لتحديد الفروقات.</p>
                <p>للجرد الكامل، استخدم زر "الميزان الدوري" في تبويب آخر.</p>
                <button class="btn btn-primary" onclick="switchReportsTab('balance')">📒 فتح الميزان الدوري</button>
            </div>`;
    },

    // ============================================================
    // 📉 تقرير الهدر (v7.4: audit للتصدير)
    // ============================================================
    async renderWasteReport(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const dept = CURRENT_DEPT;
        const currentYear = new Date().getFullYear();

        container.innerHTML = `
            <div class="card">
                <h3>📉 تقرير الهدر</h3>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                    <label>من تاريخ:</label>
                    <input type="date" id="waste-from" class="form-control" style="width:auto" value="${currentYear}-01-01">
                    <label>إلى:</label>
                    <input type="date" id="waste-to" class="form-control" style="width:auto" value="${new Date().toISOString().split('T')[0]}">
                    <button class="btn btn-primary" id="waste-load">📊 تحميل</button>
                    <button class="btn" id="waste-export" style="background:var(--success);color:#fff">📥 Excel</button>
                </div>
                <div id="waste-result" style="margin-top:14px"></div>
            </div>`;

        let lastRows = [];

        document.getElementById('waste-load').onclick = async () => {
            const from = document.getElementById('waste-from').value;
            const to = document.getElementById('waste-to').value;
            if (!from || !to) { showToast('حدد التواريخ', 'warning'); return; }
            const result = document.getElementById('waste-result');
            result.innerHTML = '<p class="text-muted">جارٍ التحميل...</p>';

            try {
                const fromDate = new Date(from + 'T00:00:00+03:00');
                const toDate = new Date(to + 'T23:59:59+03:00');
                const snap = await db.collection('departments').doc(dept).collection('movements')
                    .where('movType', '==', 'out')
                    .where('movementSubType', '==', 'wastage')
                    .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(fromDate))
                    .where('createdAt', '<=', firebase.firestore.Timestamp.fromDate(toDate))
                    .limit(5000).get();

                const reversed = new Set();
                snap.forEach(d => { const m = d.data(); if (m.reverseOf) reversed.add(m.reverseOf); });

                const byItem = {};
                let totalWaste = 0;
                snap.forEach(d => {
                    if (reversed.has(d.id)) return;
                    const m = d.data();
                    if (!byItem[m.inventoryId]) {
                        byItem[m.inventoryId] = {
                            name: m.name || '', code: m.code || '', unit: m.unit || '',
                            quantity: 0, count: 0, reasons: []
                        };
                    }
                    byItem[m.inventoryId].quantity += m.quantity || 0;
                    byItem[m.inventoryId].count++;
                    if (m.wasteReason) byItem[m.inventoryId].reasons.push(m.wasteReason);
                    totalWaste += m.quantity || 0;
                });

                const rows = Object.values(byItem).sort((a, b) => b.quantity - a.quantity);
                lastRows = rows;

                if (!rows.length) {
                    result.innerHTML = `<p style="text-align:center;color:var(--success);padding:14px">✅ لا هدر في هذه الفترة</p>`;
                    return;
                }
                result.innerHTML = `
                    <div class="kpi-row">
                        <div class="kpi-card" style="background:#3a2010"><strong>إجمالي الهدر</strong><h2 style="color:var(--danger)">${fmtNum(totalWaste)}</h2></div>
                        <div class="kpi-card"><strong>عدد المواد</strong><h2>${rows.length}</h2></div>
                    </div>
                    <div class="table-wrap">
                        <table class="inventory-table">
                            <thead><tr><th>الرمز</th><th>المادة</th><th>الكمية</th><th>الوحدة</th><th>عدد المرات</th><th>الأسباب</th></tr></thead>
                            <tbody>
                                ${rows.map(r => `<tr>
                                    <td style="font-family:monospace;font-size:0.72rem">${escapeHtml(r.code)}</td>
                                    <td>${escapeHtml(r.name)}</td>
                                    <td style="color:var(--danger);font-weight:600">${fmtNum(r.quantity)}</td>
                                    <td>${escapeHtml(r.unit)}</td>
                                    <td>${r.count}</td>
                                    <td style="font-size:0.7rem">${escapeHtml([...new Set(r.reasons)].slice(0,3).join(' • '))}</td>
                                </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>`;
            } catch (e) {
                result.innerHTML = `<p class="text-danger">فشل: ${escapeHtml(handleFirestoreError(e, 'wasteReport'))}</p>`;
            }
        };

        document.getElementById('waste-export').onclick = async () => {
            if (!lastRows.length) { showToast('حمّل البيانات أولاً', 'warning'); return; }
            const from = document.getElementById('waste-from').value;
            const to = document.getElementById('waste-to').value;
            if (typeof exportXlsxAudited === 'function') {
                await exportXlsxAudited({
                    filename: `waste_${dept}_${from}_${to}`,
                    reportName: 'Waste Report',
                    sheetName: 'الهدر',
                    headers: ['الرمز','المادة','الوحدة','الكمية','عدد المرات','الأسباب'],
                    rows: lastRows.map(r => [r.code, r.name, r.unit, r.quantity, r.count, [...new Set(r.reasons)].join(' • ')]),
                    columnWidths: [14, 35, 10, 12, 10, 30],
                    extra: { from, to, dept }
                });
            }
        };
    }
});

})();
