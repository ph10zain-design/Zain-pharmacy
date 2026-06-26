// ============================================================
// js/features/need-vs-actual.js
// تقرير: الاحتياج الوزاري vs المصروف الفعلي
// ============================================================
// v6.7:
// - يقارن yearlyNeed (من القائمة الوزارية) مع المصروف الفعلي
// - يحسب نسبة الاستهلاك + الفجوة
// - يصنف المواد: تحت/فوق/طبيعي
// - يستثني الحركات المُلغاة
// ============================================================

Object.assign(App, {

    async renderNeedVsActualReport(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const currentYear = new Date().getFullYear();
        
        container.innerHTML = `
            <div class="card" style="padding:10px">
                <h4 style="margin:0 0 8px">📊 الاحتياج الوزاري vs المصروف الفعلي</h4>
                
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0">
                    <label>السنة:</label>
                    <select id="nva-year" class="form-control" style="width:auto">
                        ${[currentYear, currentYear-1, currentYear-2].map(y => 
                            `<option value="${y}">${y}</option>`).join('')}
                    </select>
                    <select id="nva-list-type" class="form-control" style="width:auto">
                        <option value="main">الرئيسية</option>
                        <option value="surgical">جراحية</option>
                    </select>
                    <button class="btn btn-primary btn-sm" id="nva-load-btn">🔄 تحميل</button>
                    <button class="btn btn-sm" id="nva-export-btn">📊 Excel</button>
                </div>
                
                <div id="nva-summary" style="margin:8px 0"></div>
                
                <div style="display:flex;gap:6px;margin:6px 0;font-size:0.78rem">
                    <button class="btn btn-sm" onclick="App._nvaFilter('all')">الكل</button>
                    <button class="btn btn-sm" onclick="App._nvaFilter('over')" style="color:var(--danger)">تجاوزت 100%</button>
                    <button class="btn btn-sm" onclick="App._nvaFilter('normal')" style="color:var(--success)">50-100%</button>
                    <button class="btn btn-sm" onclick="App._nvaFilter('under')" style="color:var(--warning)">أقل من 50%</button>
                    <button class="btn btn-sm" onclick="App._nvaFilter('zero')">صفر استهلاك</button>
                </div>
                
                <div id="nva-table" style="margin-top:8px;max-height:60vh;overflow-y:auto"></div>
            </div>
        `;
        
        document.getElementById('nva-load-btn').onclick = () => this._loadNvaData();
        document.getElementById('nva-export-btn').onclick = () => this._exportNvaData();
    },

    async _loadNvaData() {
        const year = parseInt(document.getElementById('nva-year').value);
        const listType = document.getElementById('nva-list-type').value;
        const tableDiv = document.getElementById('nva-table');
        const summaryDiv = document.getElementById('nva-summary');
        
        tableDiv.innerHTML = '<p class="text-muted" style="text-align:center;padding:20px">جارٍ التحميل...</p>';
        
        try {
            // 1. القائمة الوزارية
            const ministryItems = await MinistryLists.getAllItems(CURRENT_DEPT, listType);
            const ministryByCode = new Map();
            ministryItems.forEach(it => ministryByCode.set(it.code, it));
            
            // 2. المصروف الفعلي من movements
            const yearStart = new Date(year, 0, 1);
            const yearEnd = new Date(year + 1, 0, 1);
            
            const movsSnap = await db.collection('departments').doc(CURRENT_DEPT)
                .collection('movements')
                .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(yearStart))
                .where('createdAt', '<', firebase.firestore.Timestamp.fromDate(yearEnd))
                .get();
            
            // بناء reversedMovIds (الحركات المُلغاة)
            const reversedMovIds = new Set();
            movsSnap.docs.forEach(d => {
                const m = d.data();
                if (m.movType === 'reverse' && m.reverseOf) {
                    reversedMovIds.add(m.reverseOf);
                }
            });
            
            // حساب المصروف لكل مادة (استثناء الـ reversed و wastage) — v7.2: حُذف transfer_out
            const actualByCode = new Map();
            movsSnap.docs.forEach(d => {
                const m = d.data();
                if (m.movType !== 'out') return;
                if (m.dispensingType === 'wastage' || m.dispensingCategory === 'waste') return;
                if (m.movementSubType === 'return_expired') return;
                if (reversedMovIds.has(d.id)) return; // ✅ استثناء المُلغاة
                
                const code = m.code;
                if (!code) return;
                actualByCode.set(code, (actualByCode.get(code) || 0) + (m.quantity || 0));
            });
            
            // 3. بناء التقرير
            const rows = ministryItems.map(it => {
                const need = it.yearlyNeed || 0;
                const actual = actualByCode.get(it.code) || 0;
                const pct = need > 0 ? Math.round((actual / need) * 100) : (actual > 0 ? 999 : 0);
                const status = pct === 0 ? 'zero' :
                              pct < 50 ? 'under' :
                              pct <= 100 ? 'normal' : 'over';
                return { ...it, actualDispensed: actual, percentage: pct, status };
            });
            
            this._nvaRows = rows;
            this._nvaFilter('all');
            
            // ملخص
            const overCount = rows.filter(r => r.status === 'over').length;
            const normalCount = rows.filter(r => r.status === 'normal').length;
            const underCount = rows.filter(r => r.status === 'under').length;
            const zeroCount = rows.filter(r => r.status === 'zero').length;
            
            const totalNeed = rows.reduce((s, r) => s + (r.yearlyNeed || 0), 0);
            const totalActual = rows.reduce((s, r) => s + r.actualDispensed, 0);
            const overallPct = totalNeed > 0 ? Math.round((totalActual / totalNeed) * 100) : 0;
            
            summaryDiv.innerHTML = `
                <div class="kpi-row">
                    <div class="kpi-card"><strong>الإجمالي</strong><h2>${rows.length}</h2></div>
                    <div class="kpi-card" style="background:#3b1a1a"><strong>تجاوزت 100%</strong><h2 style="color:var(--danger)">${overCount}</h2></div>
                    <div class="kpi-card" style="background:#1a3a1a"><strong>50-100%</strong><h2 style="color:var(--success)">${normalCount}</h2></div>
                    <div class="kpi-card" style="background:#332a10"><strong>أقل من 50%</strong><h2 style="color:var(--warning)">${underCount}</h2></div>
                    <div class="kpi-card"><strong>صفر استهلاك</strong><h2 style="color:var(--muted)">${zeroCount}</h2></div>
                </div>
                <div style="background:#1a2d45;padding:8px;border-radius:6px;margin-top:6px;font-size:0.88rem">
                    📊 <strong>الإجمالي:</strong> احتياج وزاري ${totalNeed.toLocaleString()} | مصروف فعلي ${totalActual.toLocaleString()} | الاستهلاك العام <strong>${overallPct}%</strong>
                </div>
            `;
            
        } catch (e) {
            console.error(e);
            tableDiv.innerHTML = `<div class="alert-box alert-danger">فشل: ${e.message}</div>`;
        }
    },

    _nvaFilter(filter) {
        const rows = this._nvaRows || [];
        const filtered = filter === 'all' ? rows : rows.filter(r => r.status === filter);
        
        if (filtered.length === 0) {
            document.getElementById('nva-table').innerHTML = '<p class="text-muted" style="text-align:center;padding:20px">لا توجد نتائج</p>';
            return;
        }
        
        const sorted = [...filtered].sort((a, b) => b.percentage - a.percentage);
        
        document.getElementById('nva-table').innerHTML = `
            <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
                <thead style="position:sticky;top:0;background:#1e3a8a;color:white">
                    <tr>
                        <th style="padding:6px;text-align:right">المادة</th>
                        <th style="padding:6px">احتياج</th>
                        <th style="padding:6px">مصروف</th>
                        <th style="padding:6px">النسبة</th>
                    </tr>
                </thead>
                <tbody>
                    ${sorted.map(r => {
                        const color = r.status === 'over' ? '#ef4444' :
                                     r.status === 'under' ? '#f59e0b' :
                                     r.status === 'zero' ? '#6b7280' : '#10b981';
                        return `
                            <tr style="border-bottom:1px solid #1e3a8a">
                                <td style="padding:6px">
                                    <div style="font-weight:500">${r.name}</div>
                                    <code style="font-size:0.7rem;color:var(--muted)">${r.code}</code>
                                </td>
                                <td style="padding:6px;text-align:center">${(r.yearlyNeed || 0).toLocaleString()}</td>
                                <td style="padding:6px;text-align:center">${r.actualDispensed.toLocaleString()}</td>
                                <td style="padding:6px;text-align:center">
                                    <span style="background:${color};color:white;padding:2px 8px;border-radius:10px;font-weight:bold">
                                        ${r.percentage === 999 ? '∞' : r.percentage + '%'}
                                    </span>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    },

    _exportNvaData() {
        const rows = this._nvaRows || [];
        if (rows.length === 0) {
            showToast('لا توجد بيانات للتصدير', 'warning');
            return;
        }
        
        try {
            const data = [
                ['الكود', 'الاسم', 'الوحدة', 'المستوى', 'احتياج وزاري', 'مصروف فعلي', 'النسبة %', 'الحالة'],
                ...rows.map(r => [
                    r.code, r.name, r.unit, r.level,
                    r.yearlyNeed || 0, r.actualDispensed, r.percentage,
                    r.status === 'over' ? 'تجاوزت' : r.status === 'normal' ? 'طبيعي' :
                    r.status === 'under' ? 'أقل من 50%' : 'صفر'
                ])
            ];
            const ws = XLSX.utils.aoa_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Need vs Actual');
            XLSX.writeFile(wb, `احتياج_vs_مصروف_${new Date().toISOString().split('T')[0]}.xlsx`);
            showToast('✓ تم التصدير', 'success');
        } catch (e) {
            showToast(`فشل: ${e.message}`, 'error');
        }
    },
});
