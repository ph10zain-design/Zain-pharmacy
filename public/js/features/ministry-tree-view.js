// ============================================================
// js/features/ministry-tree-view.js
// عرض شجري للقائمة الوزارية: 17 نظام → 99 فئة → 41 مجموعة → 494 مادة
// ============================================================
// v6.7:
// - 4 مستويات: نظام → فئة فرعية → مجموعة → مادة
// - قابل للطي/الفتح
// - بحث + فلتر
// - يظهر للجميع، تعديل للـ admin فقط
// ============================================================

Object.assign(App, {

    async renderMinistryListTreeView(containerId, options = {}) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        container.innerHTML = `
            <div class="card" style="padding:10px">
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
                    <h4 style="margin:0;flex:1">📚 القائمة الوزارية</h4>
                    <select id="mlt-list-type" class="form-control" style="width:auto">
                        <option value="main">القائمة الرئيسية</option>
                        <option value="surgical">جراحية</option>
                        <option value="nursing">تمريضية</option>
                        <option value="emergency">طوارئ</option>
                    </select>
                </div>
                <div style="display:flex;gap:8px;margin:8px 0">
                    <input type="text" id="mlt-search" class="form-control" 
                        placeholder="🔍 بحث بالاسم أو الكود..." style="flex:1">
                    <select id="mlt-filter-level" class="form-control" style="width:auto">
                        <option value="">كل المستويات</option>
                        <option value="A1">A1</option>
                        <option value="A2">A2</option>
                        <option value="A">A</option>
                    </select>
                </div>
                <div style="display:flex;gap:6px;margin:6px 0;font-size:0.78rem">
                    <button class="btn btn-sm" onclick="App._mltExpandAll()">📂 فتح الكل</button>
                    <button class="btn btn-sm" onclick="App._mltCollapseAll()">📁 طي الكل</button>
                    <button class="btn btn-sm" onclick="App._mltExportFlat()">📊 تصدير Excel</button>
                </div>
                <div id="mlt-stats" style="margin:6px 0;font-size:0.78rem;color:var(--muted)"></div>
                <div id="mlt-tree" style="margin-top:8px"></div>
            </div>
        `;
        
        document.getElementById('mlt-list-type').addEventListener('change', () => this._loadTreeView());
        document.getElementById('mlt-search').addEventListener('input', 
            this._debounce(() => this._filterTreeView(), 250));
        document.getElementById('mlt-filter-level').addEventListener('change', () => this._filterTreeView());
        
        await this._loadTreeView();
    },

    async _loadTreeView() {
        const listType = document.getElementById('mlt-list-type')?.value || 'main';
        const treeDiv = document.getElementById('mlt-tree');
        const statsDiv = document.getElementById('mlt-stats');
        treeDiv.innerHTML = '<p class="text-muted" style="text-align:center;padding:20px">جارٍ التحميل...</p>';
        
        try {
            const tree = await MinistryLists.getItemsByHierarchy(CURRENT_DEPT, listType);
            const stats = await MinistryLists.getStats(CURRENT_DEPT, listType);
            
            if (!stats) {
                treeDiv.innerHTML = `<div class="alert-box alert-warning">لا توجد قائمة وزارية نشطة لـ ${CURRENT_DEPT}/${listType}</div>`;
                statsDiv.innerHTML = '';
                return;
            }
            
            const byLevelStr = Object.entries(stats.byLevel).map(([k, v]) => `${k}=${v}`).join(' | ');
            statsDiv.innerHTML = `
                📋 <strong>${stats.title}</strong> | ${stats.totalItems} مادة | ${byLevelStr}
            `;
            
            this._mltTree = tree;
            this._renderTreeHTML();
            
        } catch (e) {
            console.error(e);
            treeDiv.innerHTML = `<div class="alert-box alert-danger">فشل: ${e.message}</div>`;
        }
    },

    _renderTreeHTML() {
        const tree = this._mltTree;
        if (!tree) return;
        
        const treeDiv = document.getElementById('mlt-tree');
        const searchQuery = document.getElementById('mlt-search')?.value.trim().toLowerCase() || '';
        const filterLevel = document.getElementById('mlt-filter-level')?.value || '';
        
        // ترتيب الأنظمة بالكود
        const systems = Object.values(tree).sort((a, b) => a.code.localeCompare(b.code));
        
        const html = systems.map(sys => this._renderSystem(sys, searchQuery, filterLevel)).filter(Boolean).join('');
        
        treeDiv.innerHTML = html || '<p class="text-muted" style="text-align:center;padding:20px">لا توجد نتائج</p>';
    },

    _renderSystem(sys, searchQuery, filterLevel) {
        // عد المواد المتطابقة
        let matchCount = 0;
        const allItems = this._collectAllItems(sys);
        const filteredItems = allItems.filter(it => this._matchItem(it, searchQuery, filterLevel));
        matchCount = filteredItems.length;
        
        if (matchCount === 0 && (searchQuery || filterLevel)) return '';
        
        const sysId = `mlt-sys-${sys.code}`;
        const expanded = searchQuery || filterLevel; // افتح تلقائياً عند البحث
        
        const subCats = Object.values(sys.subCategories || {}).sort((a, b) => a.code.localeCompare(b.code));
        
        return `
            <div class="mlt-system" style="margin:4px 0;border:1px solid #1e3a8a;border-radius:6px;overflow:hidden">
                <div style="background:#1e3a8a;padding:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center"
                    onclick="App._mltToggle('${sysId}')">
                    <div>
                        <span id="${sysId}-icon">${expanded ? '📂' : '📁'}</span>
                        <strong>${sys.code}</strong> — ${sys.nameAr || sys.name}
                    </div>
                    <span style="background:#0f1c30;padding:2px 8px;border-radius:10px;font-size:0.75rem">
                        ${matchCount} / ${allItems.length}
                    </span>
                </div>
                <div id="${sysId}" style="${expanded ? '' : 'display:none'};padding:6px;background:#0f1c30">
                    ${subCats.map(sub => this._renderSubCat(sub, searchQuery, filterLevel)).join('')}
                    ${(sys.items || []).filter(it => this._matchItem(it, searchQuery, filterLevel))
                        .map(it => this._renderItem(it)).join('')}
                </div>
            </div>
        `;
    },

    _renderSubCat(sub, searchQuery, filterLevel) {
        const groups = Object.values(sub.groups || {}).sort((a, b) => a.code.localeCompare(b.code));
        const allItems = [
            ...(sub.items || []),
            ...groups.flatMap(g => g.items || [])
        ];
        const filteredItems = allItems.filter(it => this._matchItem(it, searchQuery, filterLevel));
        
        if (filteredItems.length === 0) return '';
        
        const subId = `mlt-sub-${sub.code}-${Math.random().toString(36).substr(2, 5)}`;
        const expanded = searchQuery || filterLevel;
        
        return `
            <div class="mlt-subcat" style="margin:3px 0 3px 8px;border-right:2px solid #0ea5e9;padding-right:8px">
                <div style="cursor:pointer;padding:4px 0;display:flex;justify-content:space-between"
                    onclick="App._mltToggle('${subId}')">
                    <div><span id="${subId}-icon">${expanded ? '📂' : '📁'}</span> <strong>${sub.code}</strong> — ${sub.name}</div>
                    <span style="font-size:0.72rem;color:var(--muted)">${filteredItems.length}</span>
                </div>
                <div id="${subId}" style="${expanded ? '' : 'display:none'};margin-top:2px">
                    ${groups.map(g => this._renderGroup(g, searchQuery, filterLevel)).join('')}
                    ${(sub.items || []).filter(it => this._matchItem(it, searchQuery, filterLevel))
                        .map(it => this._renderItem(it)).join('')}
                </div>
            </div>
        `;
    },

    _renderGroup(grp, searchQuery, filterLevel) {
        const items = (grp.items || []).filter(it => this._matchItem(it, searchQuery, filterLevel));
        if (items.length === 0) return '';
        
        const grpId = `mlt-grp-${grp.code}-${Math.random().toString(36).substr(2, 5)}`;
        const expanded = searchQuery || filterLevel;
        
        return `
            <div class="mlt-group" style="margin:2px 0 2px 8px;border-right:2px solid #f59e0b;padding-right:8px">
                <div style="cursor:pointer;padding:3px 0;display:flex;justify-content:space-between"
                    onclick="App._mltToggle('${grpId}')">
                    <div><span id="${grpId}-icon">${expanded ? '📂' : '📁'}</span> <strong>${grp.code}</strong> — ${grp.name}</div>
                    <span style="font-size:0.72rem;color:var(--muted)">${items.length}</span>
                </div>
                <div id="${grpId}" style="${expanded ? '' : 'display:none'};margin-top:2px">
                    ${items.map(it => this._renderItem(it)).join('')}
                </div>
            </div>
        `;
    },

    _renderItem(item) {
        const levelColor = item.level === 'A1' ? '#ef4444' : item.level === 'A2' ? '#f59e0b' : '#6b7280';
        return `
            <div style="padding:6px 8px;margin:2px 0 2px 8px;background:#1a2d45;border-radius:4px;
                cursor:pointer;display:flex;justify-content:space-between;align-items:center"
                onclick="App._mltShowItemDetails('${item.code}')">
                <div style="flex:1;min-width:0">
                    <div style="font-weight:500;font-size:0.86rem">${item.name}</div>
                    <div style="font-size:0.72rem;color:var(--muted);font-family:monospace">${item.code}</div>
                </div>
                <div style="text-align:left">
                    <span style="background:${levelColor};color:white;padding:1px 6px;border-radius:3px;font-size:0.7rem">${item.level || '—'}</span>
                    <div style="font-size:0.7rem;color:var(--muted);margin-top:2px">${item.unit || ''}</div>
                </div>
            </div>
        `;
    },

    _collectAllItems(sys) {
        const items = [...(sys.items || [])];
        for (const sub of Object.values(sys.subCategories || {})) {
            items.push(...(sub.items || []));
            for (const grp of Object.values(sub.groups || {})) {
                items.push(...(grp.items || []));
            }
        }
        return items;
    },

    _matchItem(item, searchQuery, filterLevel) {
        if (filterLevel && item.level !== filterLevel) return false;
        if (!searchQuery) return true;
        return (item.code || '').toLowerCase().includes(searchQuery) ||
               (item.name || '').toLowerCase().includes(searchQuery);
    },

    _filterTreeView() {
        this._renderTreeHTML();
    },

    _mltToggle(id) {
        const el = document.getElementById(id);
        const icon = document.getElementById(id + '-icon');
        if (!el) return;
        const isHidden = el.style.display === 'none';
        el.style.display = isHidden ? '' : 'none';
        if (icon) icon.textContent = isHidden ? '📂' : '📁';
    },

    _mltExpandAll() {
        document.querySelectorAll('#mlt-tree [id^="mlt-"]').forEach(el => {
            if (el.id.endsWith('-icon')) {
                el.textContent = '📂';
            } else {
                el.style.display = '';
            }
        });
    },

    _mltCollapseAll() {
        document.querySelectorAll('#mlt-tree [id^="mlt-"]').forEach(el => {
            if (el.id.endsWith('-icon')) {
                el.textContent = '📁';
            } else if (!el.classList.contains('mlt-system')) {
                // اطوِ كل شيء إلا الـ root level
                el.style.display = 'none';
            }
        });
    },

    async _mltShowItemDetails(code) {
        const item = await MinistryLists.getItemDetails(code, CURRENT_DEPT);
        if (!item) return;
        
        // ابحث في المخزون عن نفس الكود
        const invItem = Array.from(AppState.inventory.values()).find(it => it.code === code);
        
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:500px">
                <button class="modal-close" onclick="this.closest('.modal').remove()">✕</button>
                <h3>${item.name}</h3>
                <div class="card" style="background:#1a2d45;padding:10px;margin:8px 0;font-size:0.88rem">
                    <div><strong>الكود الوطني:</strong> <code>${item.code}</code></div>
                    <div><strong>الوحدة:</strong> ${item.unit || '—'}</div>
                    <div><strong>المستوى:</strong> ${item.level || '—'}</div>
                    <div><strong>التصنيف:</strong> ${item.systemNameAr || item.systemName || '—'}</div>
                    <div><strong>الفئة:</strong> ${item.subCategoryName || '—'}</div>
                    <div><strong>المجموعة:</strong> ${item.groupName || '—'}</div>
                    <div><strong>الاستطباب:</strong> ${item.indication || '—'}</div>
                    <div><strong>احتياج 2026 الوزاري:</strong> ${item.yearlyNeed || '—'}</div>
                    <div><strong>مصروف 2023:</strong> ${item.dispensed2023 || '—'}</div>
                    ${item.requiresPatientData ? '<div style="color:var(--warning)">⚠️ تتطلب أعداد مرضى</div>' : ''}
                    ${item.requiresPatientWeight ? '<div style="color:var(--warning)">⚠️ تتطلب أوزان مرضى</div>' : ''}
                </div>
                ${invItem ? `
                    <div class="card" style="background:#0f1c30;padding:10px;margin:8px 0">
                        <strong>📦 في مخزونك:</strong>
                        <div>الرصيد: ${invItem.quantity || 0} ${invItem.unit || ''}</div>
                        ${invItem.minQuantity ? `<div>الحد الأدنى: ${invItem.minQuantity}</div>` : ''}
                    </div>
                ` : '<div class="alert-box alert-warning">لم تُستلَم في المخزون بعد</div>'}
            </div>
        `;
        document.body.appendChild(modal);
    },

    async _mltExportFlat() {
        try {
            const listType = document.getElementById('mlt-list-type')?.value || 'main';
            const items = await MinistryLists.getAllItems(CURRENT_DEPT, listType);
            
            const headers = ['الكود', 'الاسم', 'الوحدة', 'المستوى', 'النظام', 'الفئة', 'المجموعة', 'احتياج 2026', 'مصروف 2023', 'الاستطباب'];
            const rows = items.map(it => [
                it.code, it.name, it.unit, it.level,
                it.systemNameAr || it.systemName,
                it.subCategoryName, it.groupName,
                it.yearlyNeed || '', it.dispensed2023 || '',
                it.indication || ''
            ]);
            
            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'القائمة الوزارية');
            XLSX.writeFile(wb, `قائمة_${CURRENT_DEPT}_${listType}.xlsx`);
            showToast('✓ تم التصدير', 'success');
        } catch (e) {
            showToast(`فشل التصدير: ${e.message}`, 'error');
        }
    },
});
