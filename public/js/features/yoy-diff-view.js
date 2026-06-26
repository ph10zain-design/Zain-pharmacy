// ============================================================
// js/features/yoy-diff-view.js
// مقارنة قوائم وزارية بين سنتين
// ============================================================
// v6.7:
// - يستخدم MinistryLists.compareYears(dept, listType, year1, year2)
// - 3 أقسام: مواد جديدة + محذوفة + معدلة
// - تصدير Excel
// ============================================================

Object.assign(App, {

    async renderYoYDiffView(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const currentYear = new Date().getFullYear();
        
        container.innerHTML = `
            <div class="card" style="padding:10px">
                <h4 style="margin:0 0 8px">📊 مقارنة قوائم وزارية بين سنتين</h4>
                <p class="text-muted" style="font-size:0.82rem">
                    لمعرفة الفروقات بين قائمة سنة وأخرى (مواد جديدة، محذوفة، معدلة)
                </p>
                
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">
                    <div>
                        <label style="font-size:0.8rem">السنة الأقدم:</label>
                        <select id="yoy-year1" class="form-control" style="width:auto">
                            ${this._yearOptions(currentYear - 1)}
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.8rem">السنة الأحدث:</label>
                        <select id="yoy-year2" class="form-control" style="width:auto">
                            ${this._yearOptions(currentYear)}
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.8rem">النوع:</label>
                        <select id="yoy-list-type" class="form-control" style="width:auto">
                            <option value="main">الرئيسية</option>
                            <option value="surgical">جراحية</option>
                            <option value="nursing">تمريضية</option>
                            <option value="emergency">طوارئ</option>
                        </select>
                    </div>
                    <button class="btn btn-primary" id="yoy-compare-btn" style="align-self:flex-end">🔄 قارن</button>
                </div>
                
                <div id="yoy-results" style="margin-top:12px"></div>
            </div>
        `;
        
        document.getElementById('yoy-compare-btn').onclick = () => this._loadYoYComparison();
    },

    _yearOptions(selectedYear) {
        const currentYear = new Date().getFullYear();
        const opts = [];
        for (let y = currentYear - 4; y <= currentYear + 1; y++) {
            opts.push(`<option value="${y}" ${y === selectedYear ? 'selected' : ''}>${y}</option>`);
        }
        return opts.join('');
    },

    async _loadYoYComparison() {
        const year1 = parseInt(document.getElementById('yoy-year1').value);
        const year2 = parseInt(document.getElementById('yoy-year2').value);
        const listType = document.getElementById('yoy-list-type').value;
        
        if (year1 >= year2) {
            showToast('السنة الأولى يجب أن تكون أقدم من الثانية', 'error');
            return;
        }
        
        const resultsDiv = document.getElementById('yoy-results');
        resultsDiv.innerHTML = '<p class="text-muted" style="text-align:center;padding:20px">جارٍ المقارنة...</p>';
        
        try {
            const result = await MinistryLists.compareYears(CURRENT_DEPT, listType, year1, year2);
            this._yoyResult = result;
            
            const { added, removed, modified } = result;
            
            resultsDiv.innerHTML = `
                <div class="kpi-row" style="margin:8px 0">
                    <div class="kpi-card" style="background:#1a3a1a">
                        <strong>مواد جديدة</strong><h2 style="color:var(--success)">+${added.length}</h2>
                    </div>
                    <div class="kpi-card" style="background:#3b1a1a">
                        <strong>مواد محذوفة</strong><h2 style="color:var(--danger)">-${removed.length}</h2>
                    </div>
                    <div class="kpi-card" style="background:#332a10">
                        <strong>مواد معدلة</strong><h2 style="color:var(--warning)">~${modified.length}</h2>
                    </div>
                </div>
                
                <div style="display:flex;gap:6px;margin:8px 0">
                    <button class="btn btn-sm" onclick="App._yoyShowSection('added')">📥 الجديدة (${added.length})</button>
                    <button class="btn btn-sm" onclick="App._yoyShowSection('removed')">📤 المحذوفة (${removed.length})</button>
                    <button class="btn btn-sm" onclick="App._yoyShowSection('modified')">✏️ المعدلة (${modified.length})</button>
                    <button class="btn btn-sm" onclick="App._yoyExport()">📊 Excel</button>
                </div>
                
                <div id="yoy-section-content" style="margin-top:8px"></div>
            `;
            
            // عرض الجديدة افتراضياً
            this._yoyShowSection('added');
            
        } catch (e) {
            console.error(e);
            resultsDiv.innerHTML = `<div class="alert-box alert-danger">فشل: ${e.message}</div>`;
        }
    },

    _yoyShowSection(section) {
        const result = this._yoyResult;
        if (!result) return;
        const div = document.getElementById('yoy-section-content');
        
        let items, title, color;
        switch (section) {
            case 'added': items = result.added; title = '📥 المواد الجديدة'; color = 'success'; break;
            case 'removed': items = result.removed; title = '📤 المواد المحذوفة'; color = 'danger'; break;
            case 'modified': items = result.modified; title = '✏️ المواد المعدلة'; color = 'warning'; break;
            default: return;
        }
        
        if (items.length === 0) {
            div.innerHTML = `<p class="text-muted" style="text-align:center;padding:20px">لا توجد ${title}</p>`;
            return;
        }
        
        if (section === 'modified') {
            div.innerHTML = `
                <h5 style="color:var(--${color})">${title} (${items.length})</h5>
                ${items.map(it => `
                    <div style="padding:8px;background:#0f1c30;margin:4px 0;border-radius:6px;border-right:3px solid var(--${color})">
                        <div style="font-weight:bold">${it.name}</div>
                        <div style="font-size:0.78rem;color:var(--muted);font-family:monospace">${it.code}</div>
                        <div style="font-size:0.82rem;margin-top:4px">
                            <strong>التغييرات:</strong> ${it.changes.join('، ')}
                        </div>
                        ${this._renderModifiedDetails(it)}
                    </div>
                `).join('')}
            `;
        } else {
            div.innerHTML = `
                <h5 style="color:var(--${color})">${title} (${items.length})</h5>
                ${items.map(it => `
                    <div style="padding:6px;background:#0f1c30;margin:3px 0;border-radius:6px;border-right:3px solid var(--${color})">
                        <div style="font-weight:500;font-size:0.88rem">${it.name}</div>
                        <div style="font-size:0.78rem;color:var(--muted)">
                            <code>${it.code}</code> | ${it.unit || ''} | ${it.level || ''}
                        </div>
                    </div>
                `).join('')}
            `;
        }
    },

    _renderModifiedDetails(it) {
        const rows = [];
        if (it.changes.includes('الاسم')) rows.push(`<div>الاسم: <s>${it.before.name}</s> → <strong>${it.after.name}</strong></div>`);
        if (it.changes.includes('الوحدة')) rows.push(`<div>الوحدة: <s>${it.before.unit}</s> → <strong>${it.after.unit}</strong></div>`);
        if (it.changes.includes('المستوى')) rows.push(`<div>المستوى: <s>${it.before.level}</s> → <strong>${it.after.level}</strong></div>`);
        if (it.changes.includes('الاحتياج')) rows.push(`<div>الاحتياج: <s>${it.before.yearlyNeed||0}</s> → <strong>${it.after.yearlyNeed||0}</strong></div>`);
        return `<div style="font-size:0.78rem;margin-top:4px;color:var(--muted)">${rows.join('')}</div>`;
    },

    async _yoyExport() {
        const result = this._yoyResult;
        if (!result) return;
        
        try {
            const wb = XLSX.utils.book_new();
            
            // Sheet 1: المضافة
            const addedRows = [['الكود', 'الاسم', 'الوحدة', 'المستوى', 'الاحتياج']];
            result.added.forEach(it => addedRows.push([it.code, it.name, it.unit, it.level, it.yearlyNeed || '']));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(addedRows), 'المضافة');
            
            // Sheet 2: المحذوفة
            const removedRows = [['الكود', 'الاسم', 'الوحدة', 'المستوى']];
            result.removed.forEach(it => removedRows.push([it.code, it.name, it.unit, it.level]));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(removedRows), 'المحذوفة');
            
            // Sheet 3: المعدلة
            const modRows = [['الكود', 'الاسم', 'التغييرات', 'القديم', 'الجديد']];
            result.modified.forEach(it => {
                modRows.push([it.code, it.name, it.changes.join('، '),
                    `${it.before.name} | ${it.before.unit} | ${it.before.level}`,
                    `${it.after.name} | ${it.after.unit} | ${it.after.level}`]);
            });
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(modRows), 'المعدلة');
            
            XLSX.writeFile(wb, `مقارنة_${result.year1}_vs_${result.year2}.xlsx`);
            showToast('✓ تم التصدير', 'success');
        } catch (e) {
            showToast(`فشل: ${e.message}`, 'error');
        }
    },
});
