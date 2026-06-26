// ============================================================
// js/needs.js — لجنة تقدير الاحتياج (مُبسَّط — v7.1)
// ============================================================
// تغيير جذري عن v7.0:
//   حُذف:  المتوسط المرجَّح 3 سنوات، Fg، growthType، margin،
//          reserveMonths، ROP، Seasonal، fulfillmentRate auto-comp
//
//   الصيغة الجديدة (سطر واحد):
//     كمية الرفع = إجمالي المصروف للأقسام في السنة الماضية
//
//   لا طرح للرصيد المتبقي (يُعرض للمعلومة فقط).
//   عمود "أشهر التوفر" يُحسب تلقائياً مع تنبيه بصري لو < 12.
//   المواد الجديدة (لا مصروف، لا وارد، لا رصيد) تظهر بتنبيه أحمر
//   إذا كانت في القائمة الوزارية.
//
// السنوات:
//   targetYear = السنة الحالية (ديناميكي حسب وقت التشغيل)
//   dataYear   = السنة الماضية المكتملة (currentYear - 1)
// ============================================================

Object.assign(App, {

    renderNeedsPage() {
        const currentYear = new Date().getFullYear();
        const dataYear = currentYear - 1;
        const targetYear = currentYear;

        document.getElementById('main-content').innerHTML = `
            <div class="card">
                <h3>📈 لجنة تقدير الاحتياج ${targetYear}</h3>
                <p style="font-size:0.78rem;color:var(--text2);margin-bottom:6px">
                    📐 الحساب يعتمد على <strong>المصروف للأقسام</strong> خلال ${dataYear} (سنة كاملة).<br>
                    📦 الرصيد في 31/12/${dataYear} معروض للمعلومة فقط — <strong>لا يُطرح</strong> من الكمية.<br>
                    ⚠️ التوفر &lt; 12 شهر = تنبيه يدوي للجنة (نَفِدَت المادة فترةً).
                </p>

                <div class="kpi-row">
                    <div class="kpi-card">
                        <strong>إجمالي المواد</strong>
                        <h2 id="needs-total">-</h2>
                    </div>
                    <div class="kpi-card" style="background:#332a10">
                        <strong>تحتاج مراجعة</strong>
                        <h2 style="color:var(--warning)" id="needs-review-count">-</h2>
                    </div>
                    <div class="kpi-card" style="background:#3b1a1a">
                        <strong>⚠️ جديدة (تقدير يدوي)</strong>
                        <h2 style="color:var(--danger)" id="needs-newitems-count">-</h2>
                    </div>
                    <div class="kpi-card" style="background:#1a2d45">
                        <strong>مُعدَّلة يدوياً</strong>
                        <h2 style="color:var(--primary)" id="needs-adjusted-count">-</h2>
                    </div>
                </div>
            </div>

            <div class="card">
                <div style="display:flex;gap:6px;margin:8px 0;flex-wrap:wrap;align-items:center">
                    <select id="needs-priority-filter" class="form-control" style="width:auto">
                        <option value="">كل الأولويات</option>
                        <option>A1</option><option>A2</option><option>A</option>
                        <option>B</option><option>C</option>
                        <option value="__unset__">بدون أولوية</option>
                    </select>
                    <select id="needs-view-filter" class="form-control" style="width:auto">
                        <option value="">كل المواد</option>
                        <option value="needs_review">⚠️ تحتاج مراجعة</option>
                        <option value="new_items">🔴 مواد جديدة</option>
                        <option value="adjusted">✏ مُعدَّلة يدوياً</option>
                        <option value="received">📥 وصل منها شيء</option>
                    </select>
                    <input type="text" id="needs-search" class="form-control"
                           placeholder="بحث (اسم أو رمز)..." style="flex:1;min-width:120px">
                    <button class="btn btn-sm btn-primary" id="btn-calc-needs">🔄 حساب</button>
                    <button class="btn btn-sm btn-success" id="btn-save-needs">💾 حفظ</button>
                    <button class="btn btn-sm" id="btn-export-needs">📥 Excel</button>
                    <button class="btn btn-sm" id="btn-print-needs">🖨️ طباعة</button>
                    <input type="file" id="import-priority-file" accept=".xlsx,.xls" style="display:none">
                    <button class="btn btn-sm"
                            onclick="document.getElementById('import-priority-file').click()">
                        📤 استيراد أولوية
                    </button>
                </div>

                <div class="table-wrap">
                    <table class="inventory-table" id="needs-table">
                        <thead>
                            <tr>
                                <th>الرمز</th>
                                <th>الاسم</th>
                                <th title="الأولوية الاستيرادية — للفرز فقط، لا تؤثر على الحساب">أولوية</th>
                                <th title="المصروف للأقسام خلال ${dataYear} (الصافي بعد المرتجعات)">
                                    مصروف ${dataYear}
                                </th>
                                <th title="الرصيد في 31/12/${dataYear} — معلومة فقط، لا يُطرح">
                                    رصيد 31/12
                                </th>
                                <th title="أشهر التوفر الحقيقي (من 12) — حسبة تلقائية من فترات النفاد">
                                    توفر
                                </th>
                                <th title="كمية الرفع التلقائية = المصروف للأقسام">
                                    كمية الرفع
                                </th>
                                <th title="تعديل يدوي (اختياري) — يتطلب سبباً">
                                    تعديل يدوي
                                </th>
                                <th title="سبب التعديل (إلزامي عند التعديل)">سبب</th>
                                <th title="ما وصل فعلاً من طلبية ${targetYear} (يُعبَّأ خلال السنة)">
                                    ما وصل
                                </th>
                            </tr>
                        </thead>
                        <tbody></tbody>
                    </table>
                </div>
            </div>`;

        document.getElementById('btn-calc-needs').onclick = () => this.calculateAllNeeds();
        document.getElementById('btn-save-needs').onclick = () => this.saveNeedsAdjustments();
        document.getElementById('btn-export-needs').onclick = () => this.exportNeedsExcel();
        document.getElementById('btn-print-needs').onclick = () => this.printNeedsReport();
        document.getElementById('import-priority-file').onchange = (e) => this.importPriorityExcel(e.target);
        document.getElementById('needs-priority-filter').onchange = () => this.filterNeedsTable();
        document.getElementById('needs-view-filter').onchange = () => this.filterNeedsTable();
        document.getElementById('needs-search').oninput = debounce(() => this.filterNeedsTable(), 250);

        this.calculateAllNeeds();
    },

    // ============================================================
    // الحساب الرئيسي
    // ============================================================
    async calculateAllNeeds() {
        const tbody = document.querySelector('#needs-table tbody');
        if (!tbody) return;
        tbody.innerHTML = skeletonRows(10);

        const currentYear = new Date().getFullYear();
        const dataYear = currentYear - 1;

        try {
            let items = [...AppState.inventory.values()];

            // ───── جلب القائمة الوزارية (لاكتشاف المواد الجديدة) ─────
            let ministryCodes = new Set();
            try {
                const ministryItems = await MinistryLists.getAllItems(CURRENT_DEPT, 'main');
                ministryItems.forEach(mi => {
                    if (mi.code) ministryCodes.add(mi.code);
                });

                // دمج importPriority من القائمة الوزارية إن كان مفقوداً
                const ministryByCode = new Map();
                ministryItems.forEach(mi => ministryByCode.set(mi.code, mi));
                items = items.map(item => {
                    if (item.importPriority) return item;
                    const mi = item.code ? ministryByCode.get(item.code) : null;
                    if (mi?.importPriority) return { ...item, importPriority: mi.importPriority };
                    return item;
                });
            } catch (e) {
                console.warn('فشل تحميل القائمة الوزارية:', e.message);
            }

            // ───── جلب yearSummary للسنة المرجعية ─────
            const summaryDoc = await db.collection('yearSummaries')
                .doc(`${CURRENT_DEPT}-${dataYear}`).get();

            let rows;
            if (summaryDoc.exists) {
                const summary = summaryDoc.data();
                rows = items.map(item => this._buildItemRow(item, summary.items?.[item.id], ministryCodes));
            } else {
                showToast(`⚠️ ملخص ${dataYear} غير موجود — يجري الحساب من الحركات`, 'warning');
                rows = await this._calculateFromMovements(items, dataYear, ministryCodes);
            }

            needsDataCache = rows;
            this._renderNeedsKPIs(rows);
            this.renderNeedsTable(rows);

        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="10" class="text-danger">خطأ: ${escapeHtml(e.message)}</td></tr>`;
            console.error('calculateAllNeeds:', e);
        }
    },

    /**
     * المسار الاحتياطي: حساب مباشر من movements حين لا يوجد yearSummary
     * 🟡 إصلاح bug v7.0: استخدام Limit مع تحذير صريح بدل limit صامت
     */
    async _calculateFromMovements(items, dataYear, ministryCodes) {
        const startDate = firebase.firestore.Timestamp.fromDate(new Date(dataYear, 0, 1));
        const endDate = firebase.firestore.Timestamp.fromDate(new Date(dataYear + 1, 0, 1));

        // ✅ count أولاً لمعرفة هل سنتجاوز الحد
        const HARD_LIMIT = 20000;
        const countSnap = await db.collection('departments').doc(CURRENT_DEPT)
            .collection('movements')
            .where('createdAt', '>=', startDate)
            .where('createdAt', '<', endDate)
            .count().get().catch(() => null);

        if (countSnap && countSnap.data().count >= HARD_LIMIT) {
            const c = countSnap.data().count;
            const msg = `⚠️ عدد الحركات ${c} يتجاوز ${HARD_LIMIT} — لن يكون الحساب دقيقاً. ` +
                       `يجب إعادة بناء ملخص ${dataYear} من صفحة التقارير.`;
            showToast(msg, 'error', 8000);
            throw new Error(msg);
        }

        const movSnap = await db.collection('departments').doc(CURRENT_DEPT)
            .collection('movements')
            .where('createdAt', '>=', startDate)
            .where('createdAt', '<', endDate)
            .limit(HARD_LIMIT).get();

        // فلترة reverse
        const reversedIds = new Set();
        movSnap.forEach(d => {
            const m = d.data();
            if (m.movType === 'reverse' && m.reverseOf) reversedIds.add(m.reverseOf);
        });

        // تجميع لكل مادة
        const byItem = {};
        movSnap.forEach(d => {
            const m = { _docId: d.id, ...d.data() };
            if (!m.inventoryId) return;
            if (reversedIds.has(m._docId)) return;
            if (m.movType === 'reverse') return;
            if (!byItem[m.inventoryId]) byItem[m.inventoryId] = {
                dispensed: 0, received: 0, allMovs: []
            };

            byItem[m.inventoryId].allMovs.push(m);

            // المصروف الصافي للأقسام (مطابق لـ ledger.js)
            if (m.movType === 'out') {
                const cat = m.dispensingCategory || 'routine';
                const sub = m.movementSubType || '';
                // 🔧 v7.2: حُذف transfer_out — الصرف الطبيعي = routine && !return_expired
                const isRoutine = (cat === 'routine' && sub !== 'return_expired');
                if (isRoutine) byItem[m.inventoryId].dispensed += (m.quantity || 0);
            }
            if (m.movType === 'in') {
                byItem[m.inventoryId].received += (m.quantity || 0);
            }
        });

        // بناء row لكل مادة
        return items.map(item => {
            const data = byItem[item.id] || { dispensed: 0, received: 0, allMovs: [] };
            const fakeSummaryItem = {
                totalDispensed: data.dispensed,
                totalReceived: data.received,
                closingBalance: item.quantity || 0,
                // نحسب actualMonthsAvailable على الطاير
                actualMonthsAvailable: (typeof calcStockoutFromMovements === 'function')
                    ? calcStockoutFromMovements(0, data.allMovs, dataYear, item.createdAt).actualMonthsAvailable
                    : 12
            };
            return this._buildItemRow(item, fakeSummaryItem, ministryCodes);
        });
    },

    /**
     * بناء صف واحد للجدول لمادة واحدة
     * هذا هو قلب الخوارزمية الجديدة — سطور قليلة، بدون معاملات سحرية.
     */
    _buildItemRow(item, summaryItem, ministryCodes) {
        const si = summaryItem || {};

        // ───── الأرقام الأساسية ─────
        const dispensedToWards = Number(si.totalDispensed) || 0;
        const yearEndBalance = Number(si.closingBalance) || (Number(item.quantity) || 0);
        const totalReceived = Number(si.totalReceived) || 0;
        const monthsAvailable = (typeof si.actualMonthsAvailable === 'number')
            ? si.actualMonthsAvailable : 12;

        // ───── كمية الرفع التلقائية (الصيغة المُبسَّطة) ─────
        const autoToOrder = dispensedToWards;

        // ───── علامات مساعدة للعرض ─────
        // مادة جديدة: لا مصروف، لا وارد، لا رصيد، وموجودة في القائمة الوزارية
        const inMinistryList = ministryCodes && item.code && ministryCodes.has(item.code);
        const isNewItem = (
            dispensedToWards === 0 &&
            totalReceived === 0 &&
            yearEndBalance === 0
        );
        const isNewMinistryItem = isNewItem && inMinistryList;

        // تحتاج مراجعة: التوفر أقل من 11.5 شهر (تسامح لتقريب)
        const needsReview = monthsAvailable < 11.5 && !isNewItem;

        return {
            id: item.id,
            code: item.code || '',
            name: item.name || '',
            nameAr: item.nameAr || '',
            unit: item.unit || '',
            importPriority: item.importPriority || null,

            // الأرقام
            dispensedToWards,
            yearEndBalance,
            monthsAvailable,
            autoToOrder,
            totalReceived,

            // مؤشرات
            needsReview,
            isNewItem,
            isNewMinistryItem,
            inMinistryList,

            // التعديل اليدوي والاستلام (تُخزَّن على وثيقة المادة)
            finalNeedQty: (typeof item.finalNeedQty === 'number') ? item.finalNeedQty : null,
            adjustmentReason: item.adjustmentReason || '',
            receivedQty: (typeof item.receivedQty === 'number') ? item.receivedQty : null
        };
    },

    // ============================================================
    // KPIs
    // ============================================================
    _renderNeedsKPIs(rows) {
        const total = rows.length;
        const reviewCount = rows.filter(r => r.needsReview).length;
        const newItemsCount = rows.filter(r => r.isNewMinistryItem).length;
        const adjustedCount = rows.filter(r => r.finalNeedQty !== null).length;

        document.getElementById('needs-total').textContent = total;
        document.getElementById('needs-review-count').textContent = reviewCount;
        document.getElementById('needs-newitems-count').textContent = newItemsCount;
        document.getElementById('needs-adjusted-count').textContent = adjustedCount;
    },

    // ============================================================
    // عرض الجدول
    // ============================================================
    renderNeedsTable(rows) {
        const tbody = document.querySelector('#needs-table tbody');
        if (!tbody) return;
        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:2rem;color:var(--muted)">
                لا توجد مواد تطابق الفلتر
            </td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(r => this._renderRow(r)).join('');
    },

    _renderRow(r) {
        // ───── الأولوية ─────
        const priorityCell = r.importPriority
            ? `<span class="priority-${r.importPriority}">${r.importPriority}</span>`
            : '<span class="text-muted">—</span>';

        // ───── تنبيه أحمر للمواد الجديدة ─────
        let nameContent = escapeHtml(r.name);
        if (r.nameAr) nameContent += `<br><small class="text-muted">${escapeHtml(r.nameAr)}</small>`;

        let warningBadge = '';
        if (r.isNewMinistryItem) {
            warningBadge = ` <span style="background:rgba(239,68,68,0.18);color:#ef4444;padding:1px 5px;border-radius:4px;font-size:0.65rem;font-weight:600"
                title="مادة موجودة في القائمة الوزارية | لم تُستلم | لم تُصرف | احتياجها التلقائي = 0&#10;&#10;تقدير يدوي مطلوب من اللجنة">
                🔴 جديدة
            </span>`;
        }

        // ───── المصروف ─────
        const dispCell = `<span style="font-family:monospace;font-weight:600">${r.dispensedToWards.toLocaleString('en-US')}</span>`;

        // ───── الرصيد 31/12 ─────
        const balCell = `<span style="font-family:monospace;color:var(--text2)">${r.yearEndBalance.toLocaleString('en-US')}</span>`;

        // ───── أشهر التوفر ─────
        let availColor = 'var(--success)';
        let availIcon = '✓';
        if (r.isNewItem) {
            availColor = 'var(--muted)';
            availIcon = '—';
        } else if (r.monthsAvailable < 6) {
            availColor = 'var(--danger)';
            availIcon = '⚠️';
        } else if (r.monthsAvailable < 11.5) {
            availColor = 'var(--warning)';
            availIcon = '⚠️';
        }
        const monthsDisplay = r.isNewItem ? '—'
            : (r.monthsAvailable === Math.floor(r.monthsAvailable)
                ? String(r.monthsAvailable)
                : r.monthsAvailable.toFixed(1));
        const availCell = `<span style="color:${availColor};font-weight:600" title="${r.needsReview ? 'نَفِدَت المادة فترةً — راجع كمية الرفع يدوياً' : ''}">
            ${monthsDisplay} ${availIcon}
        </span>`;

        // ───── كمية الرفع التلقائية ─────
        const autoCell = r.isNewMinistryItem
            ? `<span style="color:var(--danger);font-weight:600" title="مادة جديدة بلا تاريخ — تتطلب تقديراً يدوياً">0 ⚠️</span>`
            : `<span style="font-family:monospace;font-weight:600;color:var(--primary)">${r.autoToOrder.toLocaleString('en-US')}</span>`;

        // ───── حقل التعديل اليدوي ─────
        const adjustValue = (r.finalNeedQty !== null) ? r.finalNeedQty : '';
        const adjustPlaceholder = r.isNewMinistryItem ? 'تقدير يدوي' : 'تعديل (اختياري)';
        const adjustCell = `<input type="number" class="need-qty-input form-control"
            data-id="${escapeHtml(r.id)}"
            value="${adjustValue}"
            placeholder="${adjustPlaceholder}"
            style="width:90px;font-family:monospace${r.isNewMinistryItem ? ';border-color:var(--danger)' : ''}"
            min="0">`;

        // ───── حقل السبب ─────
        const reasonCell = `<input type="text" class="need-reason-input form-control"
            data-id="${escapeHtml(r.id)}"
            value="${escapeHtml(r.adjustmentReason || '')}"
            placeholder="سبب التعديل..."
            style="width:130px"
            maxlength="300">`;

        // ───── حقل ما وصل ─────
        const receivedCell = isAdmin() || isStaff()
            ? `<input type="number" class="need-received-input form-control"
                data-id="${escapeHtml(r.id)}"
                value="${r.receivedQty ?? ''}"
                placeholder="—"
                style="width:75px;font-family:monospace"
                min="0">`
            : `<span class="text-muted">${r.receivedQty ?? '—'}</span>`;

        // ───── data attributes للفلترة ─────
        const dataAttrs = [
            `data-id="${escapeHtml(r.id)}"`,
            `data-needs-review="${r.needsReview ? '1' : '0'}"`,
            `data-new-item="${r.isNewMinistryItem ? '1' : '0'}"`,
            `data-adjusted="${r.finalNeedQty !== null ? '1' : '0'}"`,
            `data-received="${r.receivedQty !== null && r.receivedQty > 0 ? '1' : '0'}"`
        ].join(' ');

        return `<tr ${dataAttrs}>
            <td>${escapeHtml(r.code)}</td>
            <td>${nameContent}${warningBadge}</td>
            <td>${priorityCell}</td>
            <td>${dispCell}</td>
            <td>${balCell}</td>
            <td>${availCell}</td>
            <td>${autoCell}</td>
            <td>${adjustCell}</td>
            <td>${reasonCell}</td>
            <td>${receivedCell}</td>
        </tr>`;
    },

    // ============================================================
    // فلترة الجدول
    // ============================================================
    filterNeedsTable() {
        if (!needsDataCache.length) return;
        const priority = document.getElementById('needs-priority-filter')?.value || '';
        const view = document.getElementById('needs-view-filter')?.value || '';
        const q = (document.getElementById('needs-search')?.value || '').trim().toLowerCase();

        let filtered = needsDataCache;

        if (priority === '__unset__') {
            filtered = filtered.filter(r => !r.importPriority);
        } else if (priority) {
            filtered = filtered.filter(r => r.importPriority === priority);
        }

        if (view === 'needs_review') {
            filtered = filtered.filter(r => r.needsReview);
        } else if (view === 'new_items') {
            filtered = filtered.filter(r => r.isNewMinistryItem);
        } else if (view === 'adjusted') {
            filtered = filtered.filter(r => r.finalNeedQty !== null);
        } else if (view === 'received') {
            filtered = filtered.filter(r => r.receivedQty !== null && r.receivedQty > 0);
        }

        if (q) {
            filtered = filtered.filter(r =>
                (r.name || '').toLowerCase().includes(q) ||
                (r.nameAr || '').toLowerCase().includes(q) ||
                (r.code || '').toLowerCase().includes(q)
            );
        }

        this.renderNeedsTable(filtered);
    },

    // ============================================================
    // حفظ تعديلات اللجنة
    // ============================================================
    async saveNeedsAdjustments() {
        if (!isAdmin()) {
            showToast('حفظ الاحتياج — للمسؤول فقط', 'error');
            return;
        }
        if (!await this.confirmAction('حفظ جميع التعديلات؟')) return;

        const tbody = document.querySelector('#needs-table tbody');
        if (!tbody || !needsDataCache.length) return;

        let updated = 0;
        let writeBatch = db.batch();
        let batchCount = 0;
        const validationErrors = [];

        for (const row of tbody.querySelectorAll('tr[data-id]')) {
            const itemId = row.dataset.id;
            const cacheItem = needsDataCache.find(r => r.id === itemId);
            if (!cacheItem) continue;

            const qtyInput = row.querySelector('.need-qty-input');
            const reasonInput = row.querySelector('.need-reason-input');
            const receivedInput = row.querySelector('.need-received-input');
            if (!qtyInput) continue;

            // قراءة القيم
            const qtyStr = qtyInput.value.trim();
            const nq = qtyStr === '' ? null : parseInt(qtyStr);
            const nr = reasonInput?.value.trim() || '';
            const recStr = receivedInput?.value.trim() || '';
            const recQty = recStr === '' ? null : parseInt(recStr);

            // ───── فحص: لو غُيِّرَت الكمية، السبب إلزامي ─────
            if (nq !== null && nq !== cacheItem.autoToOrder && !nr) {
                validationErrors.push(`${cacheItem.code} ${cacheItem.name}: تعديل الكمية يتطلب سبباً`);
                continue;
            }

            // ───── فحص: لو nq === null ولا تغيير، نُخطي ─────
            const qtyChanged = nq !== cacheItem.finalNeedQty;
            const reasonChanged = nr !== cacheItem.adjustmentReason;
            const recChanged = recQty !== cacheItem.receivedQty;

            if (!qtyChanged && !reasonChanged && !recChanged) continue;

            try {
                const updates = {
                    updatedAt: firebase.firestore.Timestamp.now()
                };
                if (qtyChanged) updates.finalNeedQty = nq;
                if (reasonChanged) updates.adjustmentReason = nr;
                if (recChanged) updates.receivedQty = recQty;

                const ref = db.collection('departments').doc(CURRENT_DEPT)
                    .collection('inventory').doc(itemId);
                writeBatch.update(ref, updates);
                batchCount++;

                if (batchCount >= 100) {
                    await writeBatch.commit();
                    writeBatch = db.batch();
                    batchCount = 0;
                }

                // تحديث الـ cache و AppState
                cacheItem.finalNeedQty = nq;
                cacheItem.adjustmentReason = nr;
                cacheItem.receivedQty = recQty;
                const stateItem = AppState.inventory.get(itemId);
                if (stateItem) {
                    stateItem.finalNeedQty = nq;
                    stateItem.adjustmentReason = nr;
                    stateItem.receivedQty = recQty;
                }
                updated++;
            } catch (e) {
                validationErrors.push(`${cacheItem.code}: ${e.message}`);
            }
        }

        if (batchCount > 0) {
            try { await writeBatch.commit(); }
            catch (e) {
                showToast('فشل الحفظ النهائي: ' + e.message, 'error');
                return;
            }
        }

        // عرض الأخطاء
        if (validationErrors.length > 0) {
            const sample = validationErrors.slice(0, 3).join(' | ');
            const more = validationErrors.length > 3 ? ` (+${validationErrors.length - 3} أخرى)` : '';
            showToast(`⚠️ ${validationErrors.length} خطأ: ${sample}${more}`, 'warning', 6000);
        }

        if (updated > 0) {
            try {
                await db.collection('auditLog').doc().set({
                    action: 'save_needs_adjustments',
                    dept: CURRENT_DEPT,
                    count: updated,
                    by: CU.email, byUid: CU.uid,
                    at: firebase.firestore.FieldValue.serverTimestamp()
                });
            } catch (e) { /* audit failure is non-critical */ }
            showToast(`✅ تم حفظ ${updated} تعديل`, 'success');
        } else if (validationErrors.length === 0) {
            showToast('لا توجد تعديلات جديدة', 'warning');
        }
    },

    // ============================================================
    // تصدير Excel — مُبسَّط
    // ============================================================
    exportNeedsExcel() {
        if (!needsDataCache.length) {
            showToast('لا توجد بيانات للتصدير', 'warning');
            return;
        }
        const currentYear = new Date().getFullYear();
        const dataYear = currentYear - 1;
        const targetYear = currentYear;

        const data = [
            [`لجنة تقدير الاحتياج ${targetYear} — ${DEPT_NAMES[CURRENT_DEPT] || CURRENT_DEPT}`],
            [`أُعدَّ في: ${new Date().toLocaleDateString('en-GB', { timeZone: BAGHDAD_TZ })}`],
            [`مُعتمد على بيانات ${dataYear} الكاملة`],
            [],
            [
                'الرمز', 'الاسم (INN)', 'الاسم العربي', 'الوحدة', 'الأولوية',
                `مصروف ${dataYear}`, `رصيد 31/12/${dataYear}`, 'أشهر التوفر',
                'كمية الرفع التلقائية', 'كمية الرفع النهائية',
                'سبب التعديل', `ما وصل من ${targetYear}`, 'ملاحظات'
            ]
        ];

        document.querySelectorAll('#needs-table tbody tr[data-id]').forEach(row => {
            const cacheItem = needsDataCache.find(r => r.id === row.dataset.id);
            if (!cacheItem) return;
            const qtyInput = row.querySelector('.need-qty-input');
            const reasonInput = row.querySelector('.need-reason-input');
            const receivedInput = row.querySelector('.need-received-input');

            const finalQty = qtyInput?.value
                ? parseInt(qtyInput.value)
                : (cacheItem.finalNeedQty !== null ? cacheItem.finalNeedQty : cacheItem.autoToOrder);
            const reason = reasonInput?.value || cacheItem.adjustmentReason || '';
            const received = receivedInput?.value
                ? parseInt(receivedInput.value)
                : (cacheItem.receivedQty ?? '');

            let notes = '';
            if (cacheItem.isNewMinistryItem) notes = '🔴 مادة جديدة';
            else if (cacheItem.needsReview) notes = '⚠️ توفر < 12 شهر';

            data.push([
                cacheItem.code,
                cacheItem.name,
                cacheItem.nameAr || '',
                cacheItem.unit,
                cacheItem.importPriority || 'بدون',
                cacheItem.dispensedToWards,
                cacheItem.yearEndBalance,
                typeof cacheItem.monthsAvailable === 'number'
                    ? cacheItem.monthsAvailable.toFixed(1) : cacheItem.monthsAvailable,
                cacheItem.autoToOrder,
                finalQty,
                reason,
                received,
                notes
            ]);
        });

        const ws = XLSX.utils.aoa_to_sheet(data);
        ws['!cols'] = [
            { wch: 14 }, { wch: 32 }, { wch: 28 }, { wch: 10 }, { wch: 10 },
            { wch: 12 }, { wch: 12 }, { wch: 11 },
            { wch: 14 }, { wch: 14 },
            { wch: 25 }, { wch: 12 }, { wch: 20 }
        ];
        ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 12 } }];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `احتياج ${targetYear}`);

        const filename = `needs_${CURRENT_DEPT}_${targetYear}_${new Date().toISOString().slice(0, 10)}.xlsx`;
        XLSX.writeFile(wb, filename);
        showToast(`✅ تم تصدير ${needsDataCache.length} مادة`, 'success');
    },

    // ============================================================
    // طباعة
    // ============================================================
    printNeedsReport() {
        if (!needsDataCache.length) {
            showToast('لا توجد بيانات للطباعة', 'warning');
            return;
        }
        const currentYear = new Date().getFullYear();
        const dataYear = currentYear - 1;
        const targetYear = currentYear;

        const rows = needsDataCache.map(r => {
            const finalQty = (r.finalNeedQty !== null) ? r.finalNeedQty : r.autoToOrder;
            return `<tr>
                <td>${escapeHtml(r.code)}</td>
                <td>${escapeHtml(r.name)}</td>
                <td>${escapeHtml(r.unit)}</td>
                <td>${r.importPriority || '—'}</td>
                <td>${r.dispensedToWards.toLocaleString('en-US')}</td>
                <td>${r.yearEndBalance.toLocaleString('en-US')}</td>
                <td>${typeof r.monthsAvailable === 'number' ? r.monthsAvailable.toFixed(1) : r.monthsAvailable}</td>
                <td><strong>${finalQty.toLocaleString('en-US')}</strong></td>
                <td>${escapeHtml(r.adjustmentReason || '')}</td>
            </tr>`;
        }).join('');

        const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
            <title>احتياج ${targetYear}</title>
            <style>
                body{font-family:Arial;padding:20px;direction:rtl}
                h2{text-align:center;margin:8px 0}
                .meta{text-align:center;color:#555;font-size:0.85rem;margin-bottom:15px}
                table{border-collapse:collapse;width:100%;font-size:0.78rem}
                th,td{border:1px solid #aaa;padding:5px;text-align:right}
                th{background:#e8e8e8;font-weight:bold}
                tr:nth-child(even){background:#f8f8f8}
                @media print{ body{padding:5mm} }
            </style></head><body>
            <h2>لجنة تقدير الاحتياج ${targetYear}</h2>
            <div class="meta">
                ${DEPT_NAMES[CURRENT_DEPT] || CURRENT_DEPT}
                | مُعتمد على بيانات ${dataYear} الكاملة
                | ${new Date().toLocaleDateString('en-GB', { timeZone: BAGHDAD_TZ })}
            </div>
            <table>
                <thead><tr>
                    <th>الرمز</th><th>الاسم</th><th>الوحدة</th><th>أولوية</th>
                    <th>مصروف ${dataYear}</th><th>رصيد 31/12</th><th>توفر</th>
                    <th>كمية الرفع</th><th>سبب التعديل</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </body></html>`;

        const w = window.open('', '_blank');
        if (!w) {
            showToast('متصفحك يحجب النوافذ المنبثقة', 'error');
            return;
        }
        w.document.write(html);
        w.document.close();
        setTimeout(() => w.print(), 600);
    },

    // ============================================================
    // استيراد الأولوية الاستيرادية من Excel وزاري
    // (مُحتفظ بها بدون تغيير من v7.0 — لا تتأثر بالتبسيط)
    // ============================================================
    async importPriorityExcel(input) {
        if (!isAdmin()) {
            showToast('استيراد الأولوية — للمسؤول فقط', 'error');
            if (typeof logSecurityEvent === 'function') {
                logSecurityEvent('unauthorized_priority_import');
            }
            return;
        }
        if (!input.files?.[0]) return;
        if (!await this.confirmAction('استيراد الأولويات من Excel؟')) return;

        const reader = new FileReader();
        reader.onload = async e => {
            try {
                const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
                const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
                showToast('⏳ جاري استيراد الأولوية...', 'info');

                const allItemsSnap = await db.collection('departments').doc(CURRENT_DEPT)
                    .collection('inventory').get();
                const allItemsList = [];
                allItemsSnap.forEach(d => allItemsList.push({
                    ref: d.ref,
                    code: normalizeCode(d.data().code)
                }));

                const VALID = ['A1', 'A2', 'A', 'B', 'C'];
                let writeBatch = db.batch(), count = 0, total = 0, invalid = 0;

                for (let i = 1; i < rows.length; i++) {
                    const [code, priority] = rows[i];
                    if (!code || !priority) continue;
                    const np = String(priority).trim().toUpperCase();
                    if (!VALID.includes(np)) { invalid++; continue; }
                    const nc = normalizeCode(String(code));
                    const matched = allItemsList.filter(d => d.code === nc);
                    matched.forEach(d => {
                        writeBatch.update(d.ref, { importPriority: np });
                        count++; total++;
                    });
                    if (count >= 400) {
                        await writeBatch.commit();
                        writeBatch = db.batch();
                        count = 0;
                    }
                }
                if (count > 0) await writeBatch.commit();

                await db.collection('auditLog').doc().set({
                    action: 'import_priority',
                    dept: CURRENT_DEPT,
                    count: total,
                    invalidRowsCount: invalid,
                    by: CU.email, byUid: CU.uid,
                    at: firebase.firestore.FieldValue.serverTimestamp()
                });

                if (total === 0) {
                    showToast('⚠️ لم يُعثر على تطابق', 'warning');
                } else {
                    showToast(`✅ استورد أولوية ${total} مادة${invalid > 0 ? ` (${invalid} غير صالحة)` : ''}`, 'success');
                }
                this.calculateAllNeeds();
            } catch (err) {
                showToast('فشل الاستيراد: ' + err.message, 'error');
            }
        };
        reader.readAsArrayBuffer(input.files[0]);
    }
});
