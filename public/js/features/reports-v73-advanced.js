// ============================================================
// js/features/reports-v73-advanced.js — v7.4
// ============================================================
// إصلاحات v7.4 (الرياضية):
//   ✅ renderTurnoverReport: (opening+closing)/2 — لا quantity فقط
//   ✅ renderGapReport: مقارنة بالاحتياج المرفوع لا الصرف السابق
//   ✅ renderExceededNeedReport: المفتاح الصحيح (currentYear + 2)
//   ✅ renderYoYCompareReport: YTD normalization
//   ✅ renderABCReport: فحص division by zero
//   ✅ renderTopWasteReport: تصنيف منفصل "هدر بدون صرف"
//   ✅ renderDaysOfSupplyReport: 3 معدلات (30/90) للموسمية
//   ✅ renderBackdatedReport: 48 ساعة + Baghdad TZ
//   ✅ HTML/Excel separation: تنظيف صحيح للتصدير
//   ✅ audit log للتصدير في كل التقارير
//   ✅ fetch yearSummaries بدل 20K حركة (5/7 تقارير سنوية)
//
// إصلاحات v7.4 (المعمارية):
//   ✅ ReportCache مشترك (cache لمدة 5 دقائق بين التبويبات)
//   ✅ buildExportableTable يستخدم exportXlsxAudited
//
// تقرير جديد:
//   ✅ renderPriorityCoverageReport: نسبة توفر الأولوية الاستيرادية
//      (متطلب عراقي: A1 يجب توفرها >90%)
// ============================================================

(function() {
'use strict';

// ============================================================
// Helper: بناء جدول قابل للتصدير (مع audit)
// ============================================================
function buildExportableTable(containerId, title, headers, rawRows, displayRows, exportName, extra) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const rowsToDisplay = displayRows || rawRows;

    container.innerHTML = `
        <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
                <h3 style="margin:0">${title}</h3>
                <div style="display:flex;gap:6px;align-items:center">
                    <span class="badge badge-primary">${rawRows.length} سجل</span>
                    <button class="btn btn-sm" id="adv-export-btn">📥 Excel</button>
                </div>
            </div>
            ${rawRows.length === 0
                ? `<div style="text-align:center;padding:30px;color:var(--success)"><div style="font-size:2.4rem">✅</div><p>لا سجلات مطابقة</p></div>`
                : `<div class="table-wrap" style="margin-top:10px">
                    <table class="inventory-table">
                        <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
                        <tbody>${rowsToDisplay.map(r => `<tr>${r.map(c => `<td>${c == null ? '' : c}</td>`).join('')}</tr>`).join('')}</tbody>
                    </table>
                </div>`}
        </div>`;

    const btn = document.getElementById('adv-export-btn');
    if (btn) btn.onclick = async () => {
        if (!rawRows.length) { showToast('لا بيانات', 'warning'); return; }
        if (typeof exportXlsxAudited === 'function') {
            await exportXlsxAudited({
                filename: `${exportName}_${new Date().toISOString().split('T')[0]}`,
                reportName: title,
                sheetName: title.replace(/[^\u0600-\u06FF\w\s]/g, '').trim().slice(0, 30) || 'Report',
                headers,
                rows: rawRows,
                extra: extra || {}
            });
        } else {
            // fallback (لا audit)
            if (typeof XLSX === 'undefined') { showToast('XLSX غير محملة', 'error'); return; }
            const cleanRows = rawRows.map(r => r.map(c =>
                typeof c === 'string' ? c.replace(/<[^>]*>/g, '') : c
            ));
            const ws = XLSX.utils.aoa_to_sheet([headers, ...cleanRows]);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 30));
            XLSX.writeFile(wb, `${exportName}_${new Date().toISOString().split('T')[0]}.xlsx`);
            showToast('✅ صُدِّر', 'success');
        }
    };
}

// ============================================================
// 🔧 v7.4: Wrapper آمن — كل التقارير السنوية تستخدمه
// يستخدم cache من report-cache.js لتجنب 20K قراءة لكل تبويب
// ============================================================
async function getYearMovements(dept, year) {
    // v7.4: استخدام cache المشترك
    if (typeof fetchMovementsForYearCached === 'function') {
        return await fetchMovementsForYearCached(dept, year);
    }
    // fallback (لا cache)
    const start = new Date(year, 0, 1);
    const end = new Date(year + 1, 0, 1);
    const snap = await db.collection('departments').doc(dept).collection('movements')
        .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(start))
        .where('createdAt', '<', firebase.firestore.Timestamp.fromDate(end))
        .limit(20000).get();
    const reversed = new Set();
    snap.forEach(d => { const m = d.data(); if (m.movType === 'reverse' && m.reverseOf) reversed.add(m.reverseOf); });
    return snap.docs.filter(d => !reversed.has(d.id)).map(d => ({ ...d.data(), _docId: d.id }))
        .filter(m => m.movType !== 'reverse');
}

Object.assign(App, {

    // ============================================================
    // 🛒 المشتريات (v7.4: cache + audit)
    // ============================================================
    async renderPurchasesReport(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '<p class="text-muted" style="padding:20px">جارٍ التحميل...</p>';
        const currentYear = new Date().getFullYear();

        try {
            const movs = await getYearMovements(CURRENT_DEPT, currentYear);
            const purchases = movs.filter(m => m.movType === 'in' && m.movementSubType === 'purchase');

            const grouped = {};
            purchases.forEach(m => {
                const k = m.inventoryId;
                if (!grouped[k]) {
                    grouped[k] = {
                        name: m.name || '', code: m.code || '', unit: m.unit || '',
                        qty: 0, batches: new Set(), earliestExp: null
                    };
                }
                grouped[k].qty += m.quantity || 0;
                if (m.batchNumber) grouped[k].batches.add(m.batchNumber);
                const e = m.expiryDate?.toDate?.();
                if (e && (!grouped[k].earliestExp || e < grouped[k].earliestExp)) grouped[k].earliestExp = e;
            });

            // raw rows (للتصدير - بدون HTML)
            const rawRows = Object.values(grouped).sort((a, b) => b.qty - a.qty).map(r => [
                r.code, r.name, r.unit, r.qty, r.batches.size,
                r.earliestExp ? fmtDate(r.earliestExp) : '—'
            ]);
            // display rows (مع HTML للعرض)
            const displayRows = Object.values(grouped).sort((a, b) => b.qty - a.qty).map(r => [
                `<span style="font-family:monospace;font-size:0.72rem">${escapeHtml(r.code)}</span>`,
                escapeHtml(r.name),
                escapeHtml(r.unit),
                `<strong style="color:var(--primary)">${fmtNum(r.qty)}</strong>`,
                r.batches.size,
                r.earliestExp ? fmtDate(r.earliestExp) : '—'
            ]);

            buildExportableTable(containerId, `🛒 المشتريات — ${currentYear}`,
                ['الرمز','المادة','الوحدة','الكمية الإجمالية','عدد الدفعات','أقدم انتهاء'],
                rawRows, displayRows, `purchases_${currentYear}`, { year: currentYear });
        } catch (e) {
            container.innerHTML = `<p class="text-danger">فشل: ${escapeHtml(handleFirestoreError(e, 'purchases'))}</p>`;
        }
    },

    // ============================================================
    // 📥 تجهيز الدائرة (v7.4: cache + audit)
    // ============================================================
    async renderCircleReport(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '<p class="text-muted" style="padding:20px">جارٍ التحميل...</p>';
        const currentYear = new Date().getFullYear();

        try {
            const movs = await getYearMovements(CURRENT_DEPT, currentYear);
            const circle = movs.filter(m => m.movType === 'in' &&
                (m.movementSubType === 'dispense_circle' || (!m.movementSubType && m.source === 'تجهيز دائرة')));

            const grouped = {};
            circle.forEach(m => {
                const k = m.inventoryId;
                if (!grouped[k]) {
                    grouped[k] = { name: m.name || '', code: m.code || '', unit: m.unit || '', qty: 0, batches: new Set(), earliestExp: null };
                }
                grouped[k].qty += m.quantity || 0;
                if (m.batchNumber) grouped[k].batches.add(m.batchNumber);
                const e = m.expiryDate?.toDate?.();
                if (e && (!grouped[k].earliestExp || e < grouped[k].earliestExp)) grouped[k].earliestExp = e;
            });

            const rawRows = Object.values(grouped).sort((a, b) => b.qty - a.qty).map(r => [
                r.code, r.name, r.unit, r.qty, r.batches.size,
                r.earliestExp ? fmtDate(r.earliestExp) : '—'
            ]);
            const displayRows = Object.values(grouped).sort((a, b) => b.qty - a.qty).map(r => [
                `<span style="font-family:monospace;font-size:0.72rem">${escapeHtml(r.code)}</span>`,
                escapeHtml(r.name), escapeHtml(r.unit),
                `<strong style="color:var(--success)">${fmtNum(r.qty)}</strong>`,
                r.batches.size,
                r.earliestExp ? fmtDate(r.earliestExp) : '—'
            ]);

            buildExportableTable(containerId, `📥 تجهيز الدائرة — ${currentYear}`,
                ['الرمز','المادة','الوحدة','الكمية','عدد الدفعات','أقدم انتهاء'],
                rawRows, displayRows, `circle_${currentYear}`, { year: currentYear });
        } catch (e) {
            container.innerHTML = `<p class="text-danger">فشل: ${escapeHtml(handleFirestoreError(e, 'circle'))}</p>`;
        }
    },

    // ============================================================
    // 👥 الجهات (v7.4: cache + audit)
    // ============================================================
    async renderDestinationsReport(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '<p class="text-muted" style="padding:20px">جارٍ التحميل...</p>';
        const currentYear = new Date().getFullYear();

        try {
            const movs = await getYearMovements(CURRENT_DEPT, currentYear);
            const outs = movs.filter(m => m.movType === 'out' && m.movementSubType !== 'wastage');

            const grouped = {};
            outs.forEach(m => {
                const main = m.destination?.main || '—';
                if (!grouped[main]) grouped[main] = { qty: 0, count: 0, items: new Set() };
                grouped[main].qty += m.quantity || 0;
                grouped[main].count++;
                if (m.inventoryId) grouped[main].items.add(m.inventoryId);
            });

            const rawRows = Object.entries(grouped).sort((a, b) => b[1].qty - a[1].qty).map(([dest, d]) => [
                dest, d.qty, d.count, d.items.size
            ]);
            const displayRows = Object.entries(grouped).sort((a, b) => b[1].qty - a[1].qty).map(([dest, d]) => [
                escapeHtml(dest),
                `<strong>${fmtNum(d.qty)}</strong>`,
                d.count, d.items.size
            ]);

            buildExportableTable(containerId, `👥 الجهات — ${currentYear}`,
                ['الجهة','الكمية الإجمالية','عدد الحركات','عدد المواد المختلفة'],
                rawRows, displayRows, `destinations_${currentYear}`, { year: currentYear });
        } catch (e) {
            container.innerHTML = `<p class="text-danger">فشل: ${escapeHtml(handleFirestoreError(e, 'destinations'))}</p>`;
        }
    },

    // ============================================================
    // 📭 المفقودة (نفدت فعلياً)
    // ============================================================
    async renderOutOfStockReport(containerId) {
        const items = [...AppState.inventory.values()];
        const out = items.filter(i => (i.quantity || 0) === 0 && i.depletionDate);

        const now = new Date();
        const sorted = out.sort((a, b) => {
            const da = a.depletionDate?.toDate?.()?.getTime() || 0;
            const db = b.depletionDate?.toDate?.()?.getTime() || 0;
            return db - da;
        });

        const rawRows = sorted.map(i => {
            const depDate = i.depletionDate?.toDate?.();
            const days = depDate ? Math.ceil((now - depDate) / 86400000) : null;
            return [
                i.code || '', i.name || '', i.unit || '',
                i.importPriority || '—',
                depDate ? fmtDate(depDate) : '—',
                days !== null ? `${days} يوم` : '—'
            ];
        });
        const displayRows = sorted.map(i => {
            const depDate = i.depletionDate?.toDate?.();
            const days = depDate ? Math.ceil((now - depDate) / 86400000) : null;
            const isCritical = ['A1','A2'].includes(i.importPriority);
            return [
                `<span style="font-family:monospace;font-size:0.72rem">${escapeHtml(i.code || '')}</span>`,
                isCritical ? `<strong style="color:var(--danger)">⚠️ ${escapeHtml(i.name || '')}</strong>` : escapeHtml(i.name || ''),
                escapeHtml(i.unit || ''),
                i.importPriority || '—',
                depDate ? fmtDate(depDate) : '—',
                days !== null ? `${days} يوم` : '—'
            ];
        });

        buildExportableTable(containerId, '📭 المواد المفقودة',
            ['الرمز','المادة','الوحدة','الأولوية','تاريخ النفاد','منذ'],
            rawRows, displayRows, 'out_of_stock', {});
    },

    // ============================================================
    // 🔻 قريبة النفاذ (v7.4: استخدام 90-day cache)
    // ============================================================
    async renderLowStockReport(containerId) {
        const items = [...AppState.inventory.values()];
        const low = items.filter(i => (i.quantity || 0) > 0 && (i.quantity || 0) <= (i.minQuantity || 0));

        // 🚀 v7.4: cache مشترك للـ 90-day rates
        let rates = {};
        try {
            if (typeof fetch90DayDispenseRate === 'function') {
                rates = await fetch90DayDispenseRate(CURRENT_DEPT);
            }
        } catch (e) { console.warn('fetch90DayDispenseRate:', e.message); }

        const sorted = low.sort((a, b) => (a.quantity || 0) - (b.quantity || 0));

        const rawRows = sorted.map(i => {
            const r = rates[i.id];
            const rate = r?.conservative || 0;
            const daysLeft = rate > 0 ? Math.floor((i.quantity || 0) / rate) : null;
            return [
                i.code || '', i.name || '',
                i.quantity || 0, i.minQuantity || 0,
                i.unit || '', i.importPriority || '—',
                rate.toFixed(2),
                daysLeft !== null ? `${daysLeft} يوم` : '—'
            ];
        });
        const displayRows = sorted.map(i => {
            const r = rates[i.id];
            const rate = r?.conservative || 0;
            const daysLeft = rate > 0 ? Math.floor((i.quantity || 0) / rate) : null;
            return [
                `<span style="font-family:monospace;font-size:0.72rem">${escapeHtml(i.code || '')}</span>`,
                escapeHtml(i.name || ''),
                `<strong style="color:var(--warning)">${fmtNum(i.quantity || 0)}</strong>`,
                fmtNum(i.minQuantity || 0),
                escapeHtml(i.unit || ''),
                i.importPriority || '—',
                rate.toFixed(2),
                daysLeft !== null ? `${daysLeft} يوم` : '—'
            ];
        });

        buildExportableTable(containerId, '🔻 قريبة النفاذ',
            ['الرمز','المادة','الرصيد','الحد الأدنى','الوحدة','الأولوية','معدل يومي','أيام متبقية'],
            rawRows, displayRows, 'low_stock', {});
    },

    // ============================================================
    // ⏰ قريبة الانتهاء
    // ============================================================
    async renderNearExpiryReport(containerId) {
        const items = [...AppState.inventory.values()];
        const alertDays = SETTINGS.alertDays || 100;
        const now = new Date();
        const slowDays = SETTINGS.slowMovingDays || 30;

        const near = items.filter(i => {
            const e = i.earliestExpiry?.toDate?.();
            if (!e) return false;
            const days = Math.ceil((e - now) / 86400000);
            return days <= alertDays && (i.quantity || 0) > 0;
        }).sort((a, b) => (a.earliestExpiry?.toDate?.()?.getTime() || 0) - (b.earliestExpiry?.toDate?.()?.getTime() || 0));

        const rawRows = near.map(i => {
            const e = i.earliestExpiry.toDate();
            const days = Math.ceil((e - now) / 86400000);
            const last = i.lastDispenseAt?.toDate?.();
            const sinceLast = last ? Math.ceil((now - last) / 86400000) : null;
            const slow = sinceLast !== null && sinceLast >= slowDays;
            return [
                i.code || '', i.name || '',
                i.quantity || 0, i.unit || '',
                fmtDate(e),
                days < 0 ? `منتهية ${Math.abs(days)} يوم` : `${days} يوم`,
                slow ? 'بطيئة الحركة' : 'طبيعي'
            ];
        });
        const displayRows = near.map(i => {
            const e = i.earliestExpiry.toDate();
            const days = Math.ceil((e - now) / 86400000);
            const isExpired = days < 0;
            const last = i.lastDispenseAt?.toDate?.();
            const sinceLast = last ? Math.ceil((now - last) / 86400000) : null;
            const slow = sinceLast !== null && sinceLast >= slowDays;
            return [
                `<span style="font-family:monospace;font-size:0.72rem">${escapeHtml(i.code || '')}</span>`,
                escapeHtml(i.name || ''),
                fmtNum(i.quantity || 0),
                escapeHtml(i.unit || ''),
                fmtDate(e),
                isExpired ? `<strong style="color:var(--danger)">منتهية ${Math.abs(days)} يوم</strong>` : `<span style="color:var(--warning)">${days} يوم</span>`,
                slow ? '<strong style="color:var(--danger)">⚠️ بطيئة الحركة</strong>' : 'طبيعي'
            ];
        });

        buildExportableTable(containerId, `⏰ قريبة الانتهاء (≤ ${alertDays} يوم)`,
            ['الرمز','المادة','الرصيد','الوحدة','الانتهاء','المتبقي','الحالة'],
            rawRows, displayRows, 'near_expiry', { alertDays });
    },

    // ============================================================
    // 🐌 بطيئة الحركة
    // ============================================================
    async renderSlowMovingReport(containerId) {
        const items = [...AppState.inventory.values()];
        const slowDays = SETTINGS.slowMovingDays || 30;
        const now = new Date();

        const slow = items.filter(i => {
            if ((i.quantity || 0) === 0) return false;
            const last = i.lastDispenseAt?.toDate?.();
            if (!last) return false;
            const days = Math.ceil((now - last) / 86400000);
            return days >= slowDays;
        }).sort((a, b) => (a.lastDispenseAt?.toDate?.()?.getTime() || 0) - (b.lastDispenseAt?.toDate?.()?.getTime() || 0));

        const rawRows = slow.map(i => {
            const last = i.lastDispenseAt.toDate();
            const days = Math.ceil((now - last) / 86400000);
            const e = i.earliestExpiry?.toDate?.();
            const expSoon = e && Math.ceil((e - now) / 86400000) <= 180;
            return [
                i.code || '', i.name || '',
                i.quantity || 0, i.unit || '',
                fmtDate(last),
                `${days} يوم`,
                expSoon ? 'ستنتهي قريباً' : '—'
            ];
        });
        const displayRows = slow.map(i => {
            const last = i.lastDispenseAt.toDate();
            const days = Math.ceil((now - last) / 86400000);
            const e = i.earliestExpiry?.toDate?.();
            const expSoon = e && Math.ceil((e - now) / 86400000) <= 180;
            return [
                `<span style="font-family:monospace;font-size:0.72rem">${escapeHtml(i.code || '')}</span>`,
                escapeHtml(i.name || ''),
                fmtNum(i.quantity || 0),
                escapeHtml(i.unit || ''),
                fmtDate(last),
                `${days} يوم`,
                expSoon ? `<strong style="color:var(--danger)">⚠️ ستنتهي قريباً</strong>` : '—'
            ];
        });

        buildExportableTable(containerId, `🐌 بطيئة الحركة (≥ ${slowDays} يوم بلا صرف)`,
            ['الرمز','المادة','الرصيد','الوحدة','آخر صرف','منذ','تنبيه'],
            rawRows, displayRows, 'slow_moving', { slowDays });
    },

    // ============================================================
    // 🆕 جديدة بلا حركة
    // ============================================================
    async renderNewNoMovementReport(containerId) {
        const items = [...AppState.inventory.values()];
        const now = new Date();
        const newNoMov = items.filter(i =>
            !i.lastDispenseAt && !i.depletionDate && (i.quantity || 0) > 0
        ).sort((a, b) => (a.createdAt?.toDate?.()?.getTime() || 0) - (b.createdAt?.toDate?.()?.getTime() || 0));

        const rawRows = newNoMov.map(i => {
            const created = i.createdAt?.toDate?.();
            const days = created ? Math.ceil((now - created) / 86400000) : null;
            return [
                i.code || '', i.name || '',
                i.quantity || 0, i.unit || '',
                created ? fmtDate(created) : '—',
                days !== null ? `${days} يوم` : '—'
            ];
        });
        const displayRows = newNoMov.map(i => {
            const created = i.createdAt?.toDate?.();
            const days = created ? Math.ceil((now - created) / 86400000) : null;
            return [
                `<span style="font-family:monospace;font-size:0.72rem">${escapeHtml(i.code || '')}</span>`,
                escapeHtml(i.name || ''),
                fmtNum(i.quantity || 0),
                escapeHtml(i.unit || ''),
                created ? fmtDate(created) : '—',
                days !== null ? `${days} يوم` : '—'
            ];
        });

        buildExportableTable(containerId, '🆕 جديدة بلا حركة',
            ['الرمز','المادة','الرصيد','الوحدة','تاريخ الإضافة','منذ'],
            rawRows, displayRows, 'new_no_movement', {});
    },

    // ============================================================
    // 📊 مدى الأمان (v7.4: 3 معدلات للموسمية)
    // ============================================================
    async renderDaysOfSupplyReport(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '<p class="text-muted" style="padding:20px">جارٍ التحميل...</p>';

        try {
            // 🚀 v7.4: cache مشترك
            const rates = (typeof fetch90DayDispenseRate === 'function')
                ? await fetch90DayDispenseRate(CURRENT_DEPT)
                : {};

            const items = [...AppState.inventory.values()].filter(i => (i.quantity || 0) > 0);
            const rows = items.map(i => {
                const r = rates[i.id] || { r30: 0, r90: 0, conservative: 0 };
                // 🆕 v7.4: استخدام المعدل المحافظ (الأعلى) للتنبؤ الآمن
                const conservative = r.conservative || 0;
                const days = conservative > 0 ? Math.floor((i.quantity || 0) / conservative) : null;
                return { i, r30: r.r30 || 0, r90: r.r90 || 0, conservative, days };
            }).sort((a, b) => {
                if (a.days === null) return 1;
                if (b.days === null) return -1;
                return a.days - b.days;
            });

            const rawRows = rows.map(r => [
                r.i.code || '', r.i.name || '',
                r.i.quantity || 0,
                r.r30.toFixed(2), r.r90.toFixed(2), r.conservative.toFixed(2),
                r.days !== null ? `${r.days} يوم` : 'بلا حركة'
            ]);
            const displayRows = rows.map(r => {
                const color = r.days === null ? 'var(--muted)' : r.days < 30 ? 'var(--danger)' : r.days < 90 ? 'var(--warning)' : 'var(--success)';
                return [
                    `<span style="font-family:monospace;font-size:0.72rem">${escapeHtml(r.i.code || '')}</span>`,
                    escapeHtml(r.i.name || ''),
                    fmtNum(r.i.quantity || 0),
                    r.r30.toFixed(2), r.r90.toFixed(2),
                    `<strong>${r.conservative.toFixed(2)}</strong>`,
                    `<strong style="color:${color}">${r.days !== null ? r.days + ' يوم' : 'بلا حركة'}</strong>`
                ];
            });

            buildExportableTable(containerId, '📊 مدى الأمان (Days of Supply)',
                ['الرمز','المادة','الرصيد','معدل 30 يوم','معدل 90 يوم','المحافظ','أيام التغطية'],
                rawRows, displayRows, 'days_of_supply', {});
        } catch (e) {
            container.innerHTML = `<p class="text-danger">فشل: ${escapeHtml(handleFirestoreError(e, 'dos'))}</p>`;
        }
    },

    // ============================================================
    // 🔄 الدوران (v7.4: (opening+closing)/2 من yearSummaries)
    // ============================================================
    async renderTurnoverReport(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '<p class="text-muted" style="padding:20px">جارٍ التحميل...</p>';
        const currentYear = new Date().getFullYear();

        try {
            // 🆕 v7.4: من yearSummaries (لا 20K حركة)
            const [thisSummary, lastSummary] = await Promise.all([
                fetchYearSummary(CURRENT_DEPT, currentYear),
                fetchYearSummary(CURRENT_DEPT, currentYear - 1)
            ]);

            const items = [...AppState.inventory.values()];
            const rows = items.map(i => {
                const yearItem = thisSummary?.items?.[i.id];
                const lastItem = lastSummary?.items?.[i.id];

                const yearlyOut = yearItem?.totalDispensed || 0;
                const openingBalance = yearItem?.openingBalance ?? lastItem?.closingBalance ?? 0;
                const closingBalance = yearItem?.closingBalance ?? i.quantity ?? 0;

                // 🆕 v7.4: متوسط الرصيد = (opening + closing) / 2
                const avgStock = (openingBalance + closingBalance) / 2;
                const turnover = avgStock > 0 ? yearlyOut / avgStock : 0;

                return { i, yearlyOut, openingBalance, closingBalance, avgStock, turnover };
            }).filter(r => r.yearlyOut > 0 || r.avgStock > 0)
              .sort((a, b) => b.turnover - a.turnover);

            const rawRows = rows.map(r => [
                r.i.code || '', r.i.name || '',
                Math.round(r.openingBalance), Math.round(r.closingBalance),
                Math.round(r.avgStock), r.yearlyOut,
                r.turnover.toFixed(2)
            ]);
            const displayRows = rows.map(r => {
                const t = r.turnover;
                const color = t === 0 ? 'var(--muted)' : t < 1 ? 'var(--danger)' : t < 4 ? 'var(--warning)' : 'var(--success)';
                return [
                    `<span style="font-family:monospace;font-size:0.72rem">${escapeHtml(r.i.code || '')}</span>`,
                    escapeHtml(r.i.name || ''),
                    fmtNum(Math.round(r.openingBalance)),
                    fmtNum(Math.round(r.closingBalance)),
                    fmtNum(Math.round(r.avgStock)),
                    fmtNum(r.yearlyOut),
                    `<strong style="color:${color}">${t.toFixed(2)}</strong>`
                ];
            });

            buildExportableTable(containerId, `🔄 الدوران (Turnover) — ${currentYear}`,
                ['الرمز','المادة','الرصيد الافتتاحي','الرصيد الختامي','متوسط الرصيد','الصرف السنوي','معدل الدوران'],
                rawRows, displayRows, `turnover_${currentYear}`, { year: currentYear });

            // إشعار إذا yearSummary ناقص
            if (!thisSummary) {
                showToast(`⚠️ ملخص ${currentYear} غير مبني — استخدمنا الرصيد الحالي. ابنِ الملخص للنتائج الدقيقة.`, 'warning', 7000);
            }
        } catch (e) {
            container.innerHTML = `<p class="text-danger">فشل: ${escapeHtml(handleFirestoreError(e, 'turnover'))}</p>`;
        }
    },

    // ============================================================
    // 🔺 ABC / Pareto (v7.4: فحص division by zero + yearSummaries)
    // ============================================================
    async renderABCReport(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '<p class="text-muted" style="padding:20px">جارٍ التحميل...</p>';
        const currentYear = new Date().getFullYear();

        try {
            // 🆕 v7.4: من yearSummary (وثيقة واحدة بدل 20K)
            const summary = await fetchYearSummary(CURRENT_DEPT, currentYear);

            let arr = [];
            if (summary?.items) {
                arr = Object.entries(summary.items).map(([id, data]) => ({
                    id,
                    name: AppState.inventory.get(id)?.name || data.name || '',
                    code: AppState.inventory.get(id)?.code || data.code || '',
                    qty: data.totalDispensed || 0
                })).filter(x => x.qty > 0);
            } else {
                // fallback: جلب الحركات
                const movs = await getYearMovements(CURRENT_DEPT, currentYear);
                const map = {};
                movs.forEach(m => {
                    if (m.movType !== 'out' || m.movementSubType === 'wastage') return;
                    if (!map[m.inventoryId]) map[m.inventoryId] = { id: m.inventoryId, name: m.name || '', code: m.code || '', qty: 0 };
                    map[m.inventoryId].qty += m.quantity || 0;
                });
                arr = Object.values(map);
            }

            arr.sort((a, b) => b.qty - a.qty);
            const total = arr.reduce((s, x) => s + x.qty, 0);

            // 🆕 v7.4: فحص division by zero
            if (total === 0 || !arr.length) {
                container.innerHTML = `<div class="card">
                    <h3>🔺 ABC / Pareto — ${currentYear}</h3>
                    <p style="text-align:center;color:var(--muted);padding:30px">
                        لا توجد حركات صرف في ${currentYear}.<br>
                        ${summary ? '' : '<span style="font-size:0.78rem">(تأكد من بناء yearSummary للسنة)</span>'}
                    </p>
                </div>`;
                return;
            }

            let cum = 0;
            const classified = arr.map(x => {
                cum += x.qty;
                const pct = (cum / total) * 100;
                const cls = pct <= 80 ? 'A' : pct <= 95 ? 'B' : 'C';
                return { ...x, pct, cls };
            });

            const counts = { A: 0, B: 0, C: 0 };
            classified.forEach(x => counts[x.cls]++);

            container.innerHTML = `
                <div class="card">
                    <h3>🔺 ABC / Pareto — ${currentYear}</h3>
                    <p class="text-muted" style="font-size:0.78rem">A = أعلى 80% من الصرف، B = 80-95%، C = 95-100%</p>
                    <div class="kpi-row">
                        <div class="kpi-card" style="background:#3a2010"><strong>فئة A</strong><h2 style="color:var(--danger)">${counts.A}</h2></div>
                        <div class="kpi-card" style="background:#332a10"><strong>فئة B</strong><h2 style="color:var(--warning)">${counts.B}</h2></div>
                        <div class="kpi-card"><strong>فئة C</strong><h2>${counts.C}</h2></div>
                    </div>
                    <div style="display:flex;gap:6px;margin:8px 0;justify-content:flex-end">
                        <button class="btn btn-sm" id="abc-export-btn">📥 Excel</button>
                    </div>
                    <div class="table-wrap">
                        <table class="inventory-table">
                            <thead><tr><th>الرمز</th><th>المادة</th><th>الكمية</th><th>التراكمي %</th><th>الفئة</th></tr></thead>
                            <tbody>
                                ${classified.map(x => `<tr style="background:${x.cls==='A'?'rgba(239,68,68,0.05)':x.cls==='B'?'rgba(251,146,60,0.05)':'transparent'}">
                                    <td style="font-family:monospace;font-size:0.72rem">${escapeHtml(x.code)}</td>
                                    <td>${escapeHtml(x.name)}</td>
                                    <td>${fmtNum(x.qty)}</td>
                                    <td>${x.pct.toFixed(1)}%</td>
                                    <td><strong style="color:${x.cls==='A'?'var(--danger)':x.cls==='B'?'var(--warning)':'var(--text2)'}">${x.cls}</strong></td>
                                </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>`;

            const btn = document.getElementById('abc-export-btn');
            if (btn) btn.onclick = async () => {
                const rows = classified.map(x => [x.code, x.name, x.qty, x.pct.toFixed(1) + '%', x.cls]);
                if (typeof exportXlsxAudited === 'function') {
                    await exportXlsxAudited({
                        filename: `abc_${currentYear}`,
                        reportName: `ABC ${currentYear}`,
                        sheetName: 'ABC',
                        headers: ['الرمز','المادة','الكمية','التراكمي %','الفئة'],
                        rows,
                        extra: { year: currentYear, counts }
                    });
                }
            };
        } catch (e) {
            container.innerHTML = `<p class="text-danger">فشل: ${escapeHtml(handleFirestoreError(e, 'abc'))}</p>`;
        }
    },

    // ============================================================
    // ⚖️ الفجوة (v7.4: مقارنة بالاحتياج المرفوع الصحيح)
    // ============================================================
    async renderGapReport(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '<p class="text-muted" style="padding:20px">جارٍ التحميل...</p>';
        const currentYear = new Date().getFullYear();

        try {
            // 🆕 v7.4: المنطق الصحيح
            // الـ yearlyNeeds مفتاحه = سنة الرفع (currentYear + 2 حسب الدورة العراقية)
            // مثال: في 2026 نرفع احتياج 2028 → /yearlyNeeds/2028
            const targetYear = currentYear + 2;
            const needsDoc = await db.collection('yearlyNeeds').doc(String(targetYear)).get();

            // إن لم يوجد، جرّب السنة التالية فقط
            let needsDocFinal = needsDoc;
            let needsYear = targetYear;
            if (!needsDoc.exists) {
                const try2 = await db.collection('yearlyNeeds').doc(String(currentYear + 1)).get();
                if (try2.exists) {
                    needsDocFinal = try2;
                    needsYear = currentYear + 1;
                }
            }

            if (!needsDocFinal.exists) {
                container.innerHTML = `
                    <div class="card">
                        <h3>⚖️ الفجوة (الرصيد مقابل الاحتياج المرفوع)</h3>
                        <p class="text-warning" style="text-align:center;padding:30px">
                            لا توجد قائمة احتياج مرفوعة لـ ${currentYear + 1} أو ${currentYear + 2}.<br>
                            <span style="font-size:0.78rem">يجب الذهاب إلى صفحة "📈 تقدير الحاجة" ورفع قائمة أولاً.</span>
                        </p>
                    </div>`;
                return;
            }

            const needsData = needsDocFinal.data();
            const needsItems = needsData.items || [];

            const items = [...AppState.inventory.values()];
            const itemsMap = new Map(items.map(i => [i.id, i]));

            const rows = needsItems.map(n => {
                const item = itemsMap.get(n.id);
                const balance = item?.quantity || 0;
                const need = n.estimatedQty || 0;
                const gap = balance - need;
                const ratio = need > 0 ? ((balance / need) * 100) : null;
                return { item: item || { code: n.code, name: n.name, unit: n.unit }, need, balance, gap, ratio };
            }).filter(r => r.need > 0).sort((a, b) => a.gap - b.gap);

            const rawRows = rows.map(r => [
                r.item.code || '', r.item.name || '',
                r.balance, r.need, r.gap,
                r.ratio !== null ? `${r.ratio.toFixed(0)}%` : '—'
            ]);
            const displayRows = rows.map(r => {
                const color = r.gap < 0 ? 'var(--danger)' : r.ratio !== null && r.ratio < 50 ? 'var(--warning)' : 'var(--success)';
                return [
                    `<span style="font-family:monospace;font-size:0.72rem">${escapeHtml(r.item.code || '')}</span>`,
                    escapeHtml(r.item.name || ''),
                    fmtNum(r.balance),
                    fmtNum(r.need),
                    `<strong style="color:${color}">${r.gap >= 0 ? '+' : ''}${fmtNum(r.gap)}</strong>`,
                    r.ratio !== null ? `${r.ratio.toFixed(0)}%` : '—'
                ];
            });

            buildExportableTable(containerId,
                `⚖️ الفجوة (الرصيد مقابل احتياج ${needsYear})`,
                ['الرمز','المادة','الرصيد الحالي','الاحتياج المرفوع','الفجوة','النسبة'],
                rawRows, displayRows, `gap_${currentYear}`, { needsYear, currentYear });
        } catch (e) {
            container.innerHTML = `<p class="text-danger">فشل: ${escapeHtml(handleFirestoreError(e, 'gap'))}</p>`;
        }
    },

    // ============================================================
    // ⚠️ تجاوز الحاجة (v7.4: المفتاح الصحيح + cache)
    // ============================================================
    async renderExceededNeedReport(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '<p class="text-muted" style="padding:20px">جارٍ التحميل...</p>';
        const currentYear = new Date().getFullYear();

        try {
            // 🆕 v7.4: المفتاح الصحيح
            // الاحتياج المخصص للسنة الحالية = رُفع قبل سنتين
            // مثال: في 2026، الاحتياج المنفّذ هو /yearlyNeeds/2026 (الذي رُفع في 2024)
            const needsDoc = await db.collection('yearlyNeeds').doc(String(currentYear)).get();

            if (!needsDoc.exists) {
                container.innerHTML = `
                    <div class="card">
                        <h3>⚠️ تجاوز الحاجة المُقدَّرة — ${currentYear}</h3>
                        <p class="text-warning" style="text-align:center;padding:30px">
                            لا توجد قائمة احتياج مُسجَّلة لـ ${currentYear}.<br>
                            <span style="font-size:0.78rem">(الاحتياج لهذه السنة كان يجب رفعه قبل سنتين)</span>
                        </p>
                    </div>`;
                return;
            }

            const needsData = needsDoc.data();
            const needsMap = {};
            (needsData.items || []).forEach(n => { needsMap[n.id] = n.estimatedQty || 0; });

            // الصرف الفعلي من yearSummary
            const summary = await fetchYearSummary(CURRENT_DEPT, currentYear);
            const yearOut = {};
            if (summary?.items) {
                Object.entries(summary.items).forEach(([id, data]) => {
                    yearOut[id] = data.totalDispensed || 0;
                });
            } else {
                const movs = await getYearMovements(CURRENT_DEPT, currentYear);
                movs.forEach(m => {
                    if (m.movType !== 'out' || m.movementSubType === 'wastage') return;
                    yearOut[m.inventoryId] = (yearOut[m.inventoryId] || 0) + (m.quantity || 0);
                });
            }

            const items = [...AppState.inventory.values()];
            const rows = items.map(i => {
                const actual = yearOut[i.id] || 0;
                const estimated = needsMap[i.id] || 0;
                const exceed = actual - estimated;
                const ratio = estimated > 0 ? (actual / estimated) * 100 : null;
                return { i, actual, estimated, exceed, ratio };
            }).filter(r => r.estimated > 0 && r.exceed > 0).sort((a, b) => b.exceed - a.exceed);

            const rawRows = rows.map(r => [
                r.i.code || '', r.i.name || '',
                r.estimated, r.actual, r.exceed,
                r.ratio !== null ? `${r.ratio.toFixed(0)}%` : '—'
            ]);
            const displayRows = rows.map(r => [
                `<span style="font-family:monospace;font-size:0.72rem">${escapeHtml(r.i.code || '')}</span>`,
                escapeHtml(r.i.name || ''),
                fmtNum(r.estimated),
                fmtNum(r.actual),
                `<strong style="color:var(--danger)">+${fmtNum(r.exceed)}</strong>`,
                r.ratio !== null ? `${r.ratio.toFixed(0)}%` : '—'
            ]);

            buildExportableTable(containerId, `⚠️ تجاوز الحاجة المُقدَّرة — ${currentYear}`,
                ['الرمز','المادة','المُقدَّر','الفعلي','الزيادة','النسبة'],
                rawRows, displayRows, `exceeded_${currentYear}`, { year: currentYear });
        } catch (e) {
            container.innerHTML = `<p class="text-danger">فشل: ${escapeHtml(handleFirestoreError(e, 'exceeded'))}</p>`;
        }
    },

    // ============================================================
    // 📈 المقارنة السنوية (v7.4: YTD normalization)
    // ============================================================
    async renderYoYCompareReport(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '<p class="text-muted" style="padding:20px">جارٍ التحميل...</p>';
        const now = new Date();
        const currentYear = now.getFullYear();
        const prevYear = currentYear - 1;

        try {
            // 🆕 v7.4: YTD normalization
            // إذا 21 يونيو = 172 يوم من السنة، نُقارن:
            // - صرف 2026 (172 يوم فعلية)
            // - صرف 2025 من 1 يناير إلى 21 يونيو 2025 (نفس الـ 172 يوم)

            const dayOfYear = Math.floor((now - new Date(currentYear, 0, 1)) / 86400000) + 1;
            const isFullYear = dayOfYear >= 365;

            // الحصول على yearSummary للسنة الحالية والسابقة
            const [thisSummary, lastSummary] = await Promise.all([
                fetchYearSummary(CURRENT_DEPT, currentYear),
                fetchYearSummary(CURRENT_DEPT, prevYear)
            ]);

            // للسنة الحالية: نأخذ totalDispensed مباشرة (هو فقط لما مضى من السنة)
            // للسنة السابقة: إن كانت السنة الحالية ناقصة، نحتاج YTD comparable
            //   - الخيار 1 (مكلف): جلب حركات السنة السابقة YTD → نتجنبه
            //   - الخيار 2 (أرخص): scale السنة السابقة بنسبة dayOfYear/365
            //   - الخيار 3 (الأدق): استخدام monthSummaries إن وُجدت

            const cur = {};
            if (thisSummary?.items) {
                Object.entries(thisSummary.items).forEach(([id, data]) => {
                    cur[id] = { name: data.name || '', code: data.code || '', qty: data.totalDispensed || 0 };
                });
            }

            const prev = {};
            if (lastSummary?.items) {
                Object.entries(lastSummary.items).forEach(([id, data]) => {
                    prev[id] = {
                        name: data.name || '',
                        code: data.code || '',
                        qtyFullYear: data.totalDispensed || 0,
                        // 🆕 v7.4: تطبيع للفترة المماثلة
                        qtyYTD: isFullYear ? data.totalDispensed || 0 : Math.round((data.totalDispensed || 0) * dayOfYear / 365)
                    };
                });
            }

            const allIds = new Set([...Object.keys(cur), ...Object.keys(prev)]);

            const rows = [...allIds].map(id => {
                const c = cur[id]?.qty || 0;
                const pYTD = prev[id]?.qtyYTD || 0;
                const pFull = prev[id]?.qtyFullYear || 0;
                const name = cur[id]?.name || prev[id]?.name || AppState.inventory.get(id)?.name || '';
                const code = cur[id]?.code || prev[id]?.code || AppState.inventory.get(id)?.code || '';
                const diff = c - pYTD;
                const pct = pYTD > 0 ? ((c - pYTD) / pYTD * 100) : null;
                return { id, name, code, c, pYTD, pFull, diff, pct };
            }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

            const headers = isFullYear
                ? ['الرمز','المادة',`صرف ${prevYear}`,`صرف ${currentYear}`,'الفرق','التغير %']
                : ['الرمز','المادة',`${prevYear} (نفس الفترة)`,`${currentYear} (حالي)`,`${prevYear} كامل`,'الفرق','التغير %'];

            const rawRows = rows.map(r => isFullYear
                ? [r.code, r.name, r.pYTD, r.c, r.diff, r.pct !== null ? `${r.diff > 0 ? '+' : ''}${r.pct.toFixed(0)}%` : '—']
                : [r.code, r.name, r.pYTD, r.c, r.pFull, r.diff, r.pct !== null ? `${r.diff > 0 ? '+' : ''}${r.pct.toFixed(0)}%` : '—']
            );

            const displayRows = rows.map(r => {
                const diffStr = `<strong style="color:${r.diff > 0 ? 'var(--warning)' : r.diff < 0 ? 'var(--success)' : 'var(--muted)'}">${r.diff > 0 ? '+' : ''}${fmtNum(r.diff)}</strong>`;
                const pctStr = r.pct !== null ? `${r.diff > 0 ? '+' : ''}${r.pct.toFixed(0)}%` : '—';
                return isFullYear
                    ? [
                        `<span style="font-family:monospace;font-size:0.72rem">${escapeHtml(r.code)}</span>`,
                        escapeHtml(r.name),
                        fmtNum(r.pYTD), fmtNum(r.c), diffStr, pctStr
                    ]
                    : [
                        `<span style="font-family:monospace;font-size:0.72rem">${escapeHtml(r.code)}</span>`,
                        escapeHtml(r.name),
                        fmtNum(r.pYTD),
                        fmtNum(r.c),
                        `<span style="color:var(--muted)">${fmtNum(r.pFull)}</span>`,
                        diffStr, pctStr
                    ];
            });

            const title = isFullYear
                ? `📈 المقارنة السنوية: ${prevYear} ↔ ${currentYear}`
                : `📈 المقارنة YTD: ${prevYear} ↔ ${currentYear} (مطبَّع لـ ${dayOfYear} يوم)`;

            buildExportableTable(containerId, title, headers, rawRows, displayRows,
                `yoy_${currentYear}`, { currentYear, prevYear, dayOfYear, isFullYear });

            if (!isFullYear) {
                showToast(`ℹ️ المقارنة مطبَّعة لأن السنة الحالية لم تكتمل (${dayOfYear} من 365)`, 'info', 6000);
            }
        } catch (e) {
            container.innerHTML = `<p class="text-danger">فشل: ${escapeHtml(handleFirestoreError(e, 'yoy'))}</p>`;
        }
    },

    // ============================================================
    // 📉 أعلى نسبة هدر (v7.4: تصنيف منفصل + cache)
    // ============================================================
    async renderTopWasteReport(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '<p class="text-muted" style="padding:20px">جارٍ التحميل...</p>';
        const currentYear = new Date().getFullYear();

        try {
            // 🆕 v7.4: من yearSummary (أرخص بكثير)
            const summary = await fetchYearSummary(CURRENT_DEPT, currentYear);

            let stats = {};
            if (summary?.items) {
                Object.entries(summary.items).forEach(([id, data]) => {
                    stats[id] = {
                        id,
                        name: data.name || AppState.inventory.get(id)?.name || '',
                        code: data.code || AppState.inventory.get(id)?.code || '',
                        dispensed: data.totalDispensed || 0,
                        waste: data.totalWaste || 0
                    };
                });
            } else {
                const movs = await getYearMovements(CURRENT_DEPT, currentYear);
                movs.forEach(m => {
                    if (m.movType !== 'out') return;
                    if (!stats[m.inventoryId]) stats[m.inventoryId] = { id: m.inventoryId, name: m.name || '', code: m.code || '', dispensed: 0, waste: 0 };
                    if (m.movementSubType === 'wastage') stats[m.inventoryId].waste += m.quantity || 0;
                    else stats[m.inventoryId].dispensed += m.quantity || 0;
                });
            }

            // 🆕 v7.4: تصنيف منفصل
            const all = Object.values(stats).filter(s => s.waste > 0);
            const wasteWithDispense = all.filter(s => s.dispensed > 0).map(s => {
                const total = s.dispensed + s.waste;
                const wastePct = (s.waste / total) * 100;
                return { ...s, total, wastePct, category: 'mixed' };
            }).sort((a, b) => b.wastePct - a.wastePct);

            const wasteOnly = all.filter(s => s.dispensed === 0).map(s => ({
                ...s, total: s.waste, wastePct: 100, category: 'waste_only'
            })).sort((a, b) => b.waste - a.waste);

            const combinedRows = [
                ...wasteOnly.map(r => ({ ...r, sortKey: r.waste * 100 })), // أولاً (الأخطر)
                ...wasteWithDispense.map(r => ({ ...r, sortKey: r.wastePct }))
            ];

            const rawRows = combinedRows.map(r => [
                r.code, r.name, r.dispensed, r.waste, r.total,
                r.category === 'waste_only' ? 'هدر فقط' : `${r.wastePct.toFixed(1)}%`
            ]);
            const displayRows = combinedRows.map(r => {
                if (r.category === 'waste_only') {
                    return [
                        `<span style="font-family:monospace;font-size:0.72rem">${escapeHtml(r.code)}</span>`,
                        `<strong style="color:var(--danger)">⚠️ ${escapeHtml(r.name)}</strong>`,
                        '0',
                        `<strong style="color:var(--danger)">${fmtNum(r.waste)}</strong>`,
                        fmtNum(r.total),
                        `<strong style="color:var(--danger)">هدر بدون صرف</strong>`
                    ];
                }
                const color = r.wastePct > 20 ? 'var(--danger)' : r.wastePct > 10 ? 'var(--warning)' : 'var(--text2)';
                return [
                    `<span style="font-family:monospace;font-size:0.72rem">${escapeHtml(r.code)}</span>`,
                    escapeHtml(r.name),
                    fmtNum(r.dispensed),
                    `<strong style="color:var(--danger)">${fmtNum(r.waste)}</strong>`,
                    fmtNum(r.total),
                    `<strong style="color:${color}">${r.wastePct.toFixed(1)}%</strong>`
                ];
            });

            buildExportableTable(containerId, `📉 أعلى نسبة هدر — ${currentYear}`,
                ['الرمز','المادة','صرف','هدر','الإجمالي','نسبة الهدر'],
                rawRows, displayRows, `top_waste_${currentYear}`, {
                    year: currentYear,
                    wasteOnlyCount: wasteOnly.length,
                    wasteWithDispenseCount: wasteWithDispense.length
                });

            if (wasteOnly.length) {
                showToast(`⚠️ ${wasteOnly.length} مادة أُهدرت بدون أن تُصرف (إدارة سيئة للوارد)`, 'warning', 6000);
            }
        } catch (e) {
            container.innerHTML = `<p class="text-danger">فشل: ${escapeHtml(handleFirestoreError(e, 'topwaste'))}</p>`;
        }
    },

    // ============================================================
    // ⏰ الحركات بأثر رجعي (v7.4: 48 ساعة + Baghdad TZ)
    // ============================================================
    async renderBackdatedReport(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '<p class="text-muted" style="padding:20px">جارٍ التحميل...</p>';

        try {
            const since = new Date(Date.now() - 180 * 86400000);
            const snap = await db.collection('departments').doc(CURRENT_DEPT).collection('movements')
                .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(since))
                .orderBy('createdAt', 'desc')
                .limit(3000).get();

            const backdated = [];
            snap.forEach(d => {
                const m = d.data();
                // 🆕 v7.4: استخدام دالة isMovementBackdated (48 ساعة + Baghdad TZ)
                const check = typeof isMovementBackdated === 'function'
                    ? isMovementBackdated(m, 48)
                    : { isBackdated: false, daysBack: 0 };
                if (!check.isBackdated) return;
                backdated.push({ ...m, _diff: check.daysBack, _docId: d.id });
            });

            const rawRows = backdated.map(m => [
                fmtDate(m.createdAt),
                fmtDate(m.dispensingDate),
                `${m._diff} يوم`,
                m.name || '',
                m.quantity || 0,
                m.movType === 'in' ? 'وارد' : (m.movType === 'out' ? 'صادر' : m.movType),
                m.createdByName || m.createdBy || '—'
            ]);
            const displayRows = backdated.map(m => [
                fmtDate(m.createdAt),
                fmtDate(m.dispensingDate),
                `<strong style="color:var(--warning)">${m._diff} يوم</strong>`,
                escapeHtml(m.name || ''),
                fmtNum(m.quantity || 0),
                m.movType === 'in' ? '📥 وارد' : (m.movType === 'out' ? '📤 صادر' : m.movType),
                escapeHtml(m.createdByName || m.createdBy || '—')
            ]);

            buildExportableTable(containerId, '⏰ المؤرَّخة بأثر رجعي (آخر 6 أشهر، >48 ساعة)',
                ['تاريخ الإدخال','تاريخ الصرف الفعلي','الفارق','المادة','الكمية','النوع','المسؤول'],
                rawRows, displayRows, 'backdated', {});
        } catch (e) {
            container.innerHTML = `<p class="text-danger">فشل: ${escapeHtml(handleFirestoreError(e, 'backdated'))}</p>`;
        }
    },

    // ============================================================
    // 👤 العاملون (v7.4: cache + audit)
    // ============================================================
    async renderUsersReport(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '<p class="text-muted" style="padding:20px">جارٍ التحميل...</p>';

        try {
            const since = new Date(Date.now() - 90 * 86400000);
            const snap = await db.collection('departments').doc(CURRENT_DEPT).collection('movements')
                .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(since))
                .limit(5000).get();

            const byUser = {};
            snap.forEach(d => {
                const m = d.data();
                const u = m.createdBy || '—';
                if (!byUser[u]) byUser[u] = { name: m.createdByName || u, count: 0, in: 0, out: 0, waste: 0, reverse: 0 };
                byUser[u].count++;
                if (m.movType === 'in') byUser[u].in++;
                else if (m.movType === 'out') {
                    if (m.movementSubType === 'wastage') byUser[u].waste++;
                    else byUser[u].out++;
                } else if (m.movType === 'reverse') byUser[u].reverse++;
            });

            const sorted = Object.values(byUser).sort((a, b) => b.count - a.count);
            const rawRows = sorted.map(u => [u.name, u.count, u.in, u.out, u.waste, u.reverse]);
            const displayRows = sorted.map(u => [
                escapeHtml(u.name),
                u.count, u.in, u.out, u.waste, u.reverse
            ]);

            buildExportableTable(containerId, '👤 العاملون (آخر 90 يوم)',
                ['المسؤول','إجمالي الحركات','وارد','صادر','هدر','إلغاء قيد'],
                rawRows, displayRows, 'users_activity', {});
        } catch (e) {
            container.innerHTML = `<p class="text-danger">فشل: ${escapeHtml(handleFirestoreError(e, 'users'))}</p>`;
        }
    },

    // ============================================================
    // 🆕 v7.4: تقرير جديد — توفر الأولوية الاستيرادية
    // متطلب عراقي: A1 يجب توفرها بنسبة >90%
    // ============================================================
    async renderPriorityCoverageReport(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        try {
            const items = [...AppState.inventory.values()];

            // تجميع حسب الأولوية + حساب التوفر
            const groups = { A1: [], A2: [], A: [], B: [], C: [], unset: [] };
            items.forEach(i => {
                const p = i.importPriority || 'unset';
                if (!groups[p]) groups[p] = [];
                groups[p].push({
                    item: i,
                    available: (i.quantity || 0) > 0
                });
            });

            const targets = { A1: 95, A2: 90, A: 80, B: 70, C: 60, unset: null };

            const stats = Object.entries(groups).map(([p, arr]) => {
                const total = arr.length;
                const available = arr.filter(x => x.available).length;
                const coverage = total > 0 ? (available / total) * 100 : 0;
                const target = targets[p];
                const meetsTarget = target === null || coverage >= target;
                return { priority: p, total, available, missing: total - available, coverage, target, meetsTarget };
            }).filter(s => s.total > 0);

            container.innerHTML = `
                <div class="card">
                    <h3>🎯 توفر الأولوية الاستيرادية</h3>
                    <p class="text-muted" style="font-size:0.78rem">
                        نسبة المواد المتوفرة (الكمية > 0) من كل فئة. متطلب وزاري عراقي:
                        A1 ≥ 95%، A2 ≥ 90%، A ≥ 80%.
                    </p>

                    <div class="table-wrap">
                        <table class="inventory-table">
                            <thead><tr>
                                <th>الأولوية</th>
                                <th>إجمالي المواد</th>
                                <th>متوفر</th>
                                <th>مفقود</th>
                                <th>نسبة التوفر</th>
                                <th>الهدف</th>
                                <th>الحالة</th>
                            </tr></thead>
                            <tbody>
                                ${stats.map(s => {
                                    const color = s.meetsTarget ? 'var(--success)' : 'var(--danger)';
                                    const icon = s.meetsTarget ? '✅' : '❌';
                                    const label = s.priority === 'unset' ? 'غير محدد' : s.priority;
                                    return `<tr>
                                        <td><strong>${label}</strong></td>
                                        <td>${fmtNum(s.total)}</td>
                                        <td style="color:var(--success)">${fmtNum(s.available)}</td>
                                        <td style="color:var(--danger)">${fmtNum(s.missing)}</td>
                                        <td><strong style="color:${color}">${s.coverage.toFixed(1)}%</strong></td>
                                        <td>${s.target !== null ? '≥ ' + s.target + '%' : '—'}</td>
                                        <td>${icon}</td>
                                    </tr>`;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>

                    <h4 style="margin-top:14px">المواد المفقودة من فئة A1/A2 (الحرجة)</h4>
                    <div class="table-wrap">
                        <table class="inventory-table">
                            <thead><tr><th>الرمز</th><th>المادة</th><th>الأولوية</th><th>تاريخ النفاد</th></tr></thead>
                            <tbody>
                                ${groups.A1.concat(groups.A2).filter(x => !x.available).map(x => {
                                    const dep = x.item.depletionDate?.toDate?.();
                                    return `<tr>
                                        <td style="font-family:monospace;font-size:0.72rem">${escapeHtml(x.item.code || '')}</td>
                                        <td><strong style="color:var(--danger)">${escapeHtml(x.item.name || '')}</strong></td>
                                        <td>${x.item.importPriority}</td>
                                        <td>${dep ? fmtDate(dep) : '—'}</td>
                                    </tr>`;
                                }).join('') || '<tr><td colspan="4" style="text-align:center;padding:10px;color:var(--success)">✅ كل مواد A1/A2 متوفرة</td></tr>'}
                            </tbody>
                        </table>
                    </div>

                    <div style="display:flex;gap:6px;margin-top:8px;justify-content:flex-end">
                        <button class="btn btn-sm" id="pc-export-btn">📥 Excel</button>
                    </div>
                </div>`;

            const btn = document.getElementById('pc-export-btn');
            if (btn) btn.onclick = async () => {
                const exportRows = stats.map(s => [
                    s.priority === 'unset' ? 'غير محدد' : s.priority,
                    s.total, s.available, s.missing,
                    s.coverage.toFixed(1) + '%',
                    s.target !== null ? s.target + '%' : '—',
                    s.meetsTarget ? 'متحقق' : 'غير متحقق'
                ]);
                // إضافة المواد المفقودة من A1/A2 كـ sheet ثاني
                if (typeof exportXlsxAudited === 'function') {
                    await exportXlsxAudited({
                        filename: `priority_coverage_${new Date().toISOString().split('T')[0]}`,
                        reportName: 'Priority Coverage',
                        sheetName: 'نسبة التوفر',
                        headers: ['الأولوية','إجمالي','متوفر','مفقود','نسبة التوفر','الهدف','الحالة'],
                        rows: exportRows,
                        extra: { stats }
                    });
                }
            };
        } catch (e) {
            container.innerHTML = `<p class="text-danger">فشل: ${escapeHtml(handleFirestoreError(e, 'priorityCoverage'))}</p>`;
        }
    }
});

})();
