// ============================================================
// js/features/stock-card-view.js — v7.3 (إعادة كتابة كاملة)
// ============================================================
// التحول: من Modal → صفحة كاملة في BottomNav
//
// الميزات:
//   - قائمة كل المواد مع بحث (وضع افتراضي)
//   - بطاقة مفصَّلة لكل مادة (عند الاختيار)
//     • ترويسة شاملة (اسم، رمز، وحدة، أولوية، رصيد، حد أدنى، أقدم انتهاء)
//     • ملخص الوارد (تجهيز دائرة + مشتريات + افتتاحي + خلاصة موسَّعة)
//     • ملخص الصادر (صرف + هدر)
//     • قسم "🛒 المشتريات لهذه المادة" (تفاصيل + خلاصة)
//     • قسم "📥 تجهيز الدائرة لهذه المادة" (تفاصيل + خلاصة)
//     • جدول الحركات مع رصيد تراكمي + pagination (100/صفحة، حد 2000)
//     • فلاتر: تاريخ، نوع، جهة، رقم وجبة
//     • زر ↩️ إلغاء قيد بجانب كل صرف
//     • تصدير Excel + طباعة
// ============================================================

(function() {
'use strict';

const PAGE_SIZE = 100;
const FETCH_LIMIT = 2000;

const StockCardView = {
    _state: {
        view: 'list',          // 'list' | 'card'
        selectedItemId: null,
        movements: [],         // كل حركات المادة المختارة
        page: 1,
        filters: {
            search: '',
            type: 'all',
            from: '',
            to: '',
            batch: '',
            dest: ''
        }
    },

    // ============================================================
    // Entry point — يُستدعى من App.switchSection('cards')
    // ============================================================
    renderPage() {
        if (!CU) return;
        if (!AppState.loaded || AppState.dept !== CURRENT_DEPT) {
            loadInventoryForDept(CURRENT_DEPT).then(() => this.renderPage());
            return;
        }

        // الوضع الافتراضي: قائمة المواد
        if (this._state.view === 'list') this._renderListView();
        else this._renderCardView();
    },

    // ============================================================
    // وضع القائمة: كل المواد مع بحث
    // ============================================================
    _renderListView() {
        const container = document.getElementById('main-content');
        if (!container) return;

        const items = [...AppState.inventory.values()].sort((a, b) =>
            (a.name || '').localeCompare(b.name || ''));

        container.innerHTML = `
            <div class="card">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
                    <h3 style="margin:0">🃏 بطاقات المواد</h3>
                    <span class="badge badge-primary">${items.length} مادة</span>
                </div>
                <p class="text-muted" style="font-size:0.78rem;margin:6px 0 10px">
                    اختر مادة لعرض بطاقتها الكاملة (مثل صفحة الكارت الورقي).
                </p>
                <input type="text" id="card-list-search" class="form-control"
                    placeholder="🔍 بحث بالاسم أو الرمز" style="margin-bottom:10px">
                <div class="table-wrap">
                    <table class="inventory-table">
                        <thead><tr>
                            <th>الرمز</th>
                            <th>اسم المادة</th>
                            <th>الرصيد</th>
                            <th>الوحدة</th>
                            <th>الأولوية</th>
                            <th>أقرب انتهاء</th>
                            <th></th>
                        </tr></thead>
                        <tbody id="card-list-tbody"></tbody>
                    </table>
                </div>
            </div>`;

        const renderRows = (filtered) => {
            const tbody = document.getElementById('card-list-tbody');
            if (!tbody) return;
            if (!filtered.length) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--muted)">لا توجد نتائج</td></tr>`;
                return;
            }
            const now = new Date();
            const alertDays = SETTINGS.alertDays || 100;
            tbody.innerHTML = filtered.map(item => {
                const q = item.quantity || 0;
                const min = item.minQuantity || 0;
                const exp = item.earliestExpiry?.toDate?.();
                const expStr = exp ? exp.toLocaleDateString('en-GB', { calendar:'gregory', numberingSystem:'latn' }) : '—';
                const isExpired = exp && exp < now;
                const daysLeft = exp ? Math.ceil((exp - now) / 86400000) : null;
                const expiringSoon = !isExpired && daysLeft !== null && daysLeft <= alertDays;
                const isDepleted = q === 0 && item.depletionDate;
                const lowAlert = q > 0 && q <= min;
                const rowClass = isDepleted ? 'row-danger' : (isExpired || expiringSoon || lowAlert) ? 'row-warning' : '';
                const qtyClass = isDepleted ? 'qty-zero' : (lowAlert ? 'qty-low' : 'qty-ok');
                const priorityBadge = item.importPriority
                    ? `<span style="padding:1px 6px;border-radius:8px;font-size:0.7rem;background:${
                        item.importPriority === 'A1' ? 'rgba(239,68,68,0.2);color:#fca5a5' :
                        item.importPriority === 'A2' ? 'rgba(251,146,60,0.2);color:#fdba74' :
                        'rgba(34,211,238,0.15);color:var(--primary)'}">${escapeHtml(item.importPriority)}</span>`
                    : '<span style="color:var(--muted);font-size:0.7rem">—</span>';
                return `<tr class="${rowClass}" data-id="${escapeHtml(item.id)}" style="cursor:pointer">
                    <td style="font-family:monospace;font-size:0.72rem">${escapeHtml(item.code || '')}</td>
                    <td>${escapeHtml(item.name || '')}</td>
                    <td class="${qtyClass}">${fmtNum(q)}</td>
                    <td>${escapeHtml(item.unit || '')}</td>
                    <td>${priorityBadge}</td>
                    <td>${expStr}${isExpired?' <span class="expired-badge">منتهية</span>':(expiringSoon?' <span class="expired-badge">قريبة</span>':'')}</td>
                    <td><button class="btn btn-xs btn-primary" data-card-id="${escapeHtml(item.id)}">🃏 فتح</button></td>
                </tr>`;
            }).join('');

            // ربط النقر
            tbody.querySelectorAll('tr[data-id]').forEach(tr => {
                tr.onclick = (e) => {
                    if (e.target.tagName === 'BUTTON') return;
                    this.openCard(tr.dataset.id);
                };
            });
            tbody.querySelectorAll('button[data-card-id]').forEach(b => {
                b.onclick = (e) => { e.stopPropagation(); this.openCard(b.dataset.cardId); };
            });
        };

        renderRows(items);

        document.getElementById('card-list-search').oninput = debounce((e) => {
            const q = e.target.value.trim().toLowerCase();
            const filtered = !q ? items : items.filter(item => {
                const nameMatch = (item.name || '').toLowerCase().includes(q);
                const codeMatch = normalizeCode(item.code || '').includes(normalizeCode(q));
                return nameMatch || codeMatch;
            });
            renderRows(filtered);
        }, 250);
    },

    // ============================================================
    // فتح بطاقة مادة محددة
    // ============================================================
    async openCard(itemId) {
        const item = AppState.inventory.get(itemId);
        if (!item) { showToast('المادة غير موجودة', 'error'); return; }

        this._state.view = 'card';
        this._state.selectedItemId = itemId;
        this._state.page = 1;
        this._state.filters = { search: '', type: 'all', from: '', to: '', batch: '', dest: '' };
        this._renderCardView();
        await this._loadCardData();
    },

    backToList() {
        this._state.view = 'list';
        this._state.selectedItemId = null;
        this._state.movements = [];
        this._renderListView();
    },

    // ============================================================
    // وضع البطاقة: ترويسة + جدول حركات
    // ============================================================
    _renderCardView() {
        const container = document.getElementById('main-content');
        if (!container) return;
        const item = AppState.inventory.get(this._state.selectedItemId);
        if (!item) { this.backToList(); return; }

        const exp = item.earliestExpiry?.toDate?.();
        const expStr = exp ? exp.toLocaleDateString('en-GB', { calendar:'gregory', numberingSystem:'latn' }) : '—';
        const now = new Date();
        const isExpired = exp && exp < now;
        const daysLeft = exp ? Math.ceil((exp - now) / 86400000) : null;
        const expiringSoon = !isExpired && daysLeft !== null && daysLeft <= (SETTINGS.alertDays || 100);

        const priorityBadge = item.importPriority
            ? `<span style="padding:3px 10px;border-radius:12px;font-size:0.75rem;font-weight:600;background:${
                item.importPriority === 'A1' ? 'rgba(239,68,68,0.2);color:#fca5a5' :
                item.importPriority === 'A2' ? 'rgba(251,146,60,0.2);color:#fdba74' :
                'rgba(34,211,238,0.15);color:var(--primary)'}">${escapeHtml(item.importPriority)}</span>`
            : '';

        container.innerHTML = `
            <div class="card">
                <button class="btn btn-sm" onclick="StockCardView.backToList()" style="margin-bottom:10px">← العودة للقائمة</button>

                <!-- ترويسة المادة -->
                <div style="background:linear-gradient(135deg,var(--surface2),var(--surface3));padding:14px;border-radius:var(--radius);margin-bottom:14px">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
                        <div style="flex:1;min-width:200px">
                            <h2 style="margin:0 0 4px;font-size:1.05rem">${escapeHtml(item.name || '—')}</h2>
                            <div style="font-family:monospace;font-size:0.78rem;color:var(--muted)">${escapeHtml(item.code || '—')}</div>
                        </div>
                        ${priorityBadge}
                    </div>

                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-top:14px">
                        <div style="background:var(--surface1);padding:10px;border-radius:var(--radius-sm)">
                            <div style="font-size:0.65rem;color:var(--muted)">الرصيد الحالي</div>
                            <div style="font-size:1.3rem;font-weight:700;color:${(item.quantity||0)<=0?'var(--danger)':'var(--primary)'}">${fmtNum(item.quantity||0)}</div>
                            <div style="font-size:0.7rem;color:var(--text2)">${escapeHtml(item.unit||'')}</div>
                        </div>
                        <div style="background:var(--surface1);padding:10px;border-radius:var(--radius-sm)">
                            <div style="font-size:0.65rem;color:var(--muted)">الحد الأدنى (ROP)</div>
                            <div style="font-size:1.3rem;font-weight:700">${fmtNum(item.minQuantity||0)}</div>
                        </div>
                        <div style="background:var(--surface1);padding:10px;border-radius:var(--radius-sm)">
                            <div style="font-size:0.65rem;color:var(--muted)">أقرب انتهاء</div>
                            <div style="font-size:0.95rem;font-weight:600;color:${isExpired?'var(--danger)':(expiringSoon?'var(--warning)':'var(--text)')}">${expStr}</div>
                            ${exp && daysLeft !== null ? `<div style="font-size:0.68rem;color:var(--muted)">${daysLeft>0?`${daysLeft} يوم`:'منتهية'}</div>` : ''}
                        </div>
                        <div style="background:var(--surface1);padding:10px;border-radius:var(--radius-sm)" id="card-yearly-need">
                            <div style="font-size:0.65rem;color:var(--muted)">الحاجة السنوية المُقدَّرة</div>
                            <div style="font-size:1.1rem;font-weight:700;color:var(--text2)">—</div>
                        </div>
                    </div>
                </div>

                <!-- ملخصات الوارد والصادر (تُحدَّث بعد التحميل) -->
                <div id="card-summary"></div>

                <!-- أقسام المشتريات وتجهيز الدائرة -->
                <div id="card-sources"></div>

                <!-- الفلاتر -->
                <div style="background:var(--surface2);padding:10px;border-radius:var(--radius-sm);margin:14px 0">
                    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                        <input type="text" id="card-search" class="form-control" placeholder="🔍 بحث في الحركات" style="flex:1;min-width:120px">
                        <select id="card-type" class="form-control" style="width:auto;min-width:130px">
                            <option value="all">كل الأنواع</option>
                            <option value="in">📥 وارد</option>
                            <option value="out">📤 صادر</option>
                            <option value="reverse">↩️ إلغاء قيد</option>
                            <option value="purchase">🛒 مشتريات</option>
                            <option value="dispense_circle">📥 تجهيز دائرة</option>
                            <option value="opening">📂 افتتاحي</option>
                            <option value="dispense">✅ صرف</option>
                            <option value="wastage">⚠️ هدر</option>
                        </select>
                        <input type="date" id="card-from" class="form-control" style="width:auto" title="من تاريخ">
                        <span style="font-size:0.7rem;color:var(--muted)">إلى</span>
                        <input type="date" id="card-to" class="form-control" style="width:auto" title="إلى تاريخ">
                        <input type="text" id="card-batch" class="form-control" placeholder="رقم الوجبة" style="width:130px">
                        <select id="card-dest" class="form-control" style="width:auto">
                            <option value="">كل الجهات</option>
                            ${Object.keys(DESTINATIONS).map(k=>`<option value="${k}">${k}</option>`).join('')}
                        </select>
                    </div>
                    <div style="display:flex;justify-content:space-between;margin-top:8px;flex-wrap:wrap;gap:6px">
                        <button class="btn btn-sm" onclick="StockCardView.clearFilters()" style="background:var(--surface3)">🧹 مسح الفلاتر</button>
                        <div style="display:flex;gap:6px">
                            <button class="btn btn-sm" onclick="StockCardView.exportExcel()">📥 Excel</button>
                            <button class="btn btn-sm" onclick="StockCardView.printCard()">🖨️ طباعة</button>
                        </div>
                    </div>
                </div>

                <!-- جدول الحركات -->
                <div id="card-loading" style="text-align:center;padding:30px">
                    <div style="font-size:2rem">⏳</div>
                    <p style="color:var(--primary);margin-top:8px">جارٍ تحميل البطاقة...</p>
                </div>
                <div id="card-table-wrap" style="display:none">
                    <div class="table-wrap">
                        <table class="inventory-table" id="card-table">
                            <thead><tr>
                                <th>التاريخ</th>
                                <th>الجهة / المصدر</th>
                                <th>رقم الوثيقة</th>
                                <th>رقم الوجبة</th>
                                <th>الوارد</th>
                                <th>الصادر</th>
                                <th>الرصيد التراكمي</th>
                                <th>الانتهاء</th>
                                <th>النوع</th>
                                <th>ملاحظات</th>
                                <th>المسؤول</th>
                                ${isStaff() ? '<th class="no-print">إجراء</th>' : ''}
                            </tr></thead>
                            <tbody></tbody>
                        </table>
                    </div>
                    <div id="card-pagination" style="margin-top:8px"></div>
                </div>
            </div>`;

        // ربط الأحداث
        ['card-search','card-type','card-from','card-to','card-batch','card-dest'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const event = (id === 'card-search' || id === 'card-batch') ? 'input' : 'change';
            const handler = id === 'card-search' ? debounce(() => this._applyFilters(), 250) : () => this._applyFilters();
            el.addEventListener(event, handler);
        });
    },

    clearFilters() {
        ['card-search','card-batch'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        ['card-from','card-to'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        const t = document.getElementById('card-type'); if (t) t.value = 'all';
        const d = document.getElementById('card-dest'); if (d) d.value = '';
        this._applyFilters();
    },

    // ============================================================
    // تحميل بيانات البطاقة (الحركات + الحاجة السنوية)
    // ============================================================
    async _loadCardData() {
        const itemId = this._state.selectedItemId;
        if (!itemId) return;

        try {
            // 1. كل حركات المادة (حد 2000)
            const movs = await StockCard.getCardForItem(CURRENT_DEPT, itemId, { limit: FETCH_LIMIT });

            // 2. الحاجة السنوية من yearlyNeeds (إن وُجدت)
            try {
                const currentYear = new Date().getFullYear();
                const summaryDoc = await db.collection('yearSummaries').doc(`${CURRENT_DEPT}-${currentYear - 1}`).get();
                if (summaryDoc.exists) {
                    const summary = summaryDoc.data();
                    const itemSummary = summary.items?.[itemId];
                    if (itemSummary) {
                        const yearlyNeed = itemSummary.totalDispensed || 0;
                        const ynEl = document.getElementById('card-yearly-need');
                        if (ynEl) {
                            ynEl.innerHTML = `
                                <div style="font-size:0.65rem;color:var(--muted)">الحاجة السنوية المُقدَّرة (${currentYear})</div>
                                <div style="font-size:1.1rem;font-weight:700;color:var(--text2)">${fmtNum(yearlyNeed)}</div>
                                <div style="font-size:0.65rem;color:var(--muted)">من مصروف ${currentYear - 1}</div>`;
                        }
                    }
                }
            } catch (e) { /* ignore */ }

            this._state.movements = movs;
            this._buildSummary(movs);
            this._buildSourcesSections(movs);
            this._applyFilters();

            document.getElementById('card-loading').style.display = 'none';
            document.getElementById('card-table-wrap').style.display = 'block';
        } catch (e) {
            console.error('_loadCardData:', e);
            const loading = document.getElementById('card-loading');
            if (loading) loading.innerHTML = `<p class="text-danger">فشل: ${escapeHtml(handleFirestoreError(e, 'card-load'))}</p>`;
        }
    },

    // ============================================================
    // بناء الملخصات (وارد، صادر)
    // ============================================================
    _buildSummary(movs) {
        const summaryEl = document.getElementById('card-summary');
        if (!summaryEl) return;

        // تصفية الحركات الملغاة
        const valid = movs.filter(m => !m._reversedBy && m.movType !== 'reverse');

        let totalIn = 0, totalOut = 0, totalWaste = 0;
        const inBySource = { 'تجهيز دائرة': 0, 'مشتريات': 0, 'افتتاحي': 0 };
        const outByCat = { 'صرف': 0, 'هدر': 0 };

        valid.forEach(m => {
            const qty = Number(m.quantity) || 0;
            const sub = m.movementSubType || '';
            if (m.movType === 'in') {
                totalIn += qty;
                if (sub === 'opening') inBySource['افتتاحي'] += qty;
                else if (sub === 'purchase') inBySource['مشتريات'] += qty;
                else inBySource['تجهيز دائرة'] += qty;
            } else if (m.movType === 'out') {
                if (sub === 'wastage') { totalWaste += qty; outByCat['هدر'] += qty; }
                else { totalOut += qty; outByCat['صرف'] += qty; }
            }
        });

        summaryEl.innerHTML = `
            <div class="kpi-row" style="margin-bottom:14px">
                <div class="kpi-card" style="background:#1f3a2a">
                    <strong>📥 إجمالي الوارد</strong>
                    <h2 style="color:var(--success)">${fmtNum(totalIn)}</h2>
                    <div style="font-size:0.65rem;color:var(--muted);margin-top:4px;line-height:1.5">
                        تجهيز دائرة: ${fmtNum(inBySource['تجهيز دائرة'])}<br>
                        مشتريات: ${fmtNum(inBySource['مشتريات'])}<br>
                        افتتاحي: ${fmtNum(inBySource['افتتاحي'])}
                    </div>
                </div>
                <div class="kpi-card" style="background:#2a1a33">
                    <strong>📤 صَرف (للأقسام)</strong>
                    <h2 style="color:#a78bfa">${fmtNum(totalOut)}</h2>
                </div>
                <div class="kpi-card" style="background:#3a2010">
                    <strong>⚠️ هدر</strong>
                    <h2 style="color:var(--danger)">${fmtNum(totalWaste)}</h2>
                </div>
                <div class="kpi-card" style="background:#1a2d45">
                    <strong>📊 صافي الحركة</strong>
                    <h2 style="color:var(--primary)">${fmtNum(totalIn - totalOut - totalWaste)}</h2>
                </div>
            </div>`;
    },

    // ============================================================
    // بناء أقسام المشتريات وتجهيز الدائرة (مع الخلاصة الموسَّعة)
    // ============================================================
    _buildSourcesSections(movs) {
        const el = document.getElementById('card-sources');
        if (!el) return;
        const valid = movs.filter(m => !m._reversedBy && m.movType !== 'reverse');

        const purchases = valid.filter(m => m.movType === 'in' && m.movementSubType === 'purchase');
        const circle = valid.filter(m => m.movType === 'in' && (m.movementSubType === 'dispense_circle' || (!m.movementSubType && m.source === 'تجهيز دائرة')));

        const renderSection = (title, icon, color, list) => {
            if (!list.length) return '';
            const totalQty = list.reduce((s, m) => s + (Number(m.quantity)||0), 0);
            const batches = new Set(list.map(m => m.batchNumber).filter(b => b)).size;
            const earliestExp = list
                .map(m => m.expiryDate?.toDate?.())
                .filter(d => d)
                .sort((a, b) => a - b)[0];
            const earliestStr = earliestExp ? earliestExp.toLocaleDateString('en-GB', { calendar:'gregory', numberingSystem:'latn' }) : '—';

            const rows = list.slice(0, 50).map(m => {
                const date = (m.dispensingDate?.toDate?.() || m.createdAt?.toDate?.())?.toLocaleDateString('en-GB', { calendar:'gregory', numberingSystem:'latn' }) || '—';
                const exp = m.expiryDate?.toDate?.()?.toLocaleDateString('en-GB', { calendar:'gregory', numberingSystem:'latn' }) || '—';
                return `<tr>
                    <td style="font-size:0.72rem">${date}</td>
                    <td style="font-family:monospace;font-size:0.72rem">${escapeHtml(m.documentNo||'—')}</td>
                    <td style="font-family:monospace;font-size:0.72rem">${escapeHtml(m.batchNumber||'—')}</td>
                    <td style="text-align:left;font-weight:600;color:${color}">${fmtNum(m.quantity||0)}</td>
                    <td style="font-size:0.72rem">${exp}</td>
                </tr>`;
            }).join('');

            return `
                <details class="card" style="margin:8px 0;padding:0">
                    <summary style="padding:10px 12px;cursor:pointer;background:var(--surface2);border-radius:var(--radius-sm)">
                        <strong>${icon} ${title}</strong>
                        <span style="color:var(--muted);font-size:0.78rem;margin-right:8px">
                            الإجمالي: <strong style="color:${color}">${fmtNum(totalQty)}</strong>
                            | الدفعات: ${batches}
                            | أقدم انتهاء: ${earliestStr}
                        </span>
                    </summary>
                    <div style="padding:10px 12px">
                        <div class="table-wrap">
                            <table class="inventory-table" style="font-size:0.78rem">
                                <thead><tr>
                                    <th>التاريخ</th>
                                    <th>الوثيقة</th>
                                    <th>الوجبة</th>
                                    <th>الكمية</th>
                                    <th>الانتهاء</th>
                                </tr></thead>
                                <tbody>${rows}</tbody>
                            </table>
                        </div>
                        ${list.length > 50 ? `<p class="text-muted" style="font-size:0.72rem;margin-top:6px">عرض أحدث 50 من ${list.length}</p>` : ''}
                    </div>
                </details>`;
        };

        el.innerHTML = renderSection('المشتريات لهذه المادة', '🛒', 'var(--primary)', purchases)
                     + renderSection('تجهيز الدائرة لهذه المادة', '📥', 'var(--success)', circle);
    },

    // ============================================================
    // تطبيق الفلاتر وعرض الجدول
    // ============================================================
    _applyFilters() {
        const search = (document.getElementById('card-search')?.value || '').trim().toLowerCase();
        const type = document.getElementById('card-type')?.value || 'all';
        const from = document.getElementById('card-from')?.value || '';
        const to = document.getElementById('card-to')?.value || '';
        const batch = (document.getElementById('card-batch')?.value || '').trim();
        const dest = document.getElementById('card-dest')?.value || '';

        this._state.filters = { search, type, from, to, batch, dest };
        this._state.page = 1;
        this._renderTable();
    },

    _renderTable() {
        const tbody = document.querySelector('#card-table tbody');
        if (!tbody) return;
        const all = this._state.movements || [];
        const f = this._state.filters;

        // تطبيق الفلاتر
        const fromDate = f.from ? new Date(f.from + 'T00:00:00+03:00') : null;
        const toDate = f.to ? new Date(f.to + 'T23:59:59+03:00') : null;

        let filtered = all.filter(m => {
            // فلتر النوع
            if (f.type !== 'all') {
                if (['in','out','reverse'].includes(f.type)) {
                    if (m.movType !== f.type) return false;
                } else {
                    if (m.movementSubType !== f.type) return false;
                }
            }
            // فلتر التاريخ (يستخدم dispensingDate || createdAt)
            if (fromDate || toDate) {
                if (!isMovementInRange(m, fromDate, toDate)) return false;
            }
            // فلتر الوجبة
            if (f.batch && !(m.batchNumber || '').includes(f.batch)) return false;
            // فلتر الجهة
            if (f.dest) {
                const destMatch = (m.destination?.main || '') === f.dest;
                const sourceMatch = m.source === f.dest;
                if (!destMatch && !sourceMatch) return false;
            }
            // البحث النصي
            if (f.search) {
                const hay = `${m.documentNo||''} ${m.batchNumber||''} ${m.destination?.main||''} ${m.destination?.sub||''} ${m.notes||''} ${m.wasteReason||''} ${m.source||''}`.toLowerCase();
                if (!hay.includes(f.search)) return false;
            }
            return true;
        });

        // الرصيد التراكمي: نُرتب من الأقدم للأحدث، نحسب التراكم، ثم نقلب للعرض (الأحدث أعلى)
        // ملاحظة: quantityAfter موثوق من السجل لكنه قد لا يكون منطقياً بعد الفلترة
        // لذا: إذا لم يكن هناك فلتر زمني، نُبقي quantityAfter كما هو (هذا الرصيد التراكمي الحقيقي).
        // إذا كان هناك فلتر، نَعرض quantityAfter للحركة وقت حدوثها (لا "ضمن الفترة").

        // ترتيب من الأحدث للأقدم (الـ getCardForItem يُعيدها هكذا أصلاً)
        const filteredSorted = filtered;

        // Pagination
        const total = filteredSorted.length;
        const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        if (this._state.page > totalPages) this._state.page = totalPages;
        const pageStart = (this._state.page - 1) * PAGE_SIZE;
        const pageEnd = pageStart + PAGE_SIZE;
        const pageData = filteredSorted.slice(pageStart, pageEnd);

        if (!pageData.length) {
            const colspan = isStaff() ? 12 : 11;
            tbody.innerHTML = `<tr><td colspan="${colspan}" style="text-align:center;padding:2rem;color:var(--muted)">
                <div style="font-size:2rem">📋</div>لا توجد حركات تطابق الفلاتر
            </td></tr>`;
        } else {
            tbody.innerHTML = pageData.map(m => this._buildRow(m)).join('');
        }

        // Pagination UI
        const pagEl = document.getElementById('card-pagination');
        if (pagEl) {
            if (total > PAGE_SIZE) {
                pagEl.innerHTML = `<div class="alert-box alert-warning" style="font-size:0.78rem">
                    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">
                        <span>${total} حركة — صفحة ${this._state.page} من ${totalPages}</span>
                        <div style="display:flex;gap:6px" class="no-print">
                            <button class="btn btn-sm" onclick="StockCardView._goPage(1)" ${this._state.page===1?'disabled':''}>⏮</button>
                            <button class="btn btn-sm" onclick="StockCardView._goPage(${this._state.page-1})" ${this._state.page<=1?'disabled':''}>◀ السابق</button>
                            <button class="btn btn-sm" onclick="StockCardView._goPage(${this._state.page+1})" ${this._state.page>=totalPages?'disabled':''}>التالي ▶</button>
                            <button class="btn btn-sm" onclick="StockCardView._goPage(${totalPages})" ${this._state.page>=totalPages?'disabled':''}>⏭</button>
                        </div>
                    </div>
                </div>`;
            } else if (all.length === FETCH_LIMIT) {
                pagEl.innerHTML = `<div class="alert-box alert-warning" style="font-size:0.78rem">
                    ⚠️ بلغت الحد الأقصى (${FETCH_LIMIT} حركة). استخدم فلتر التاريخ لتضييق النطاق.
                </div>`;
            } else {
                pagEl.innerHTML = `<p style="font-size:0.72rem;color:var(--muted);text-align:center">${total} حركة</p>`;
            }
        }

        this._state.filteredCount = total;
    },

    _goPage(p) {
        this._state.page = p;
        this._renderTable();
    },

    _buildRow(m) {
        const dispDate = m.dispensingDate?.toDate?.() || m.createdAt?.toDate?.();
        const dateStr = dispDate ? dispDate.toLocaleDateString('en-GB', { timeZone:'Asia/Baghdad', calendar:'gregory', numberingSystem:'latn' }) : '—';
        const dest = m.movType === 'in'
            ? (m.source || '—')
            : `${m.destination?.main || ''}${m.destination?.sub ? ' / ' + m.destination.sub : ''}`;
        const expStr = m.expiryDate?.toDate?.()?.toLocaleDateString('en-GB', { calendar:'gregory', numberingSystem:'latn' }) || '—';
        const isWaste = m.movementSubType === 'wastage';
        const isReverse = m.movType === 'reverse';

        // التحقق من backdating
        const created = m.createdAt?.toDate?.();
        const isBackdated = m.dispensingDate && created && Math.abs(created.getTime() - m.dispensingDate.toDate().getTime()) > 24*60*60*1000;

        let typeCell;
        if (m.movType === 'out') {
            if (isWaste) typeCell = '<span style="color:var(--warning);font-size:0.72rem;font-weight:600">⚠️ هدر</span>';
            else typeCell = '<span style="color:var(--success);font-size:0.72rem;font-weight:600">✅ صرف</span>';
        } else if (m.movType === 'in') {
            if (m.movementSubType === 'purchase') typeCell = '<span style="color:var(--primary);font-size:0.72rem">🛒 شراء</span>';
            else if (m.movementSubType === 'opening') typeCell = '<span style="color:var(--muted);font-size:0.72rem">📂 افتتاحي</span>';
            else typeCell = '<span style="color:#94a3b8;font-size:0.72rem">📥 تجهيز</span>';
        } else if (isReverse) {
            typeCell = '<span style="color:#fb923c;font-size:0.72rem;font-weight:600">↩️ إلغاء</span>';
        } else {
            typeCell = '<span style="color:var(--muted);font-size:0.72rem">—</span>';
        }

        let notesCell = '—';
        if (isReverse && m.reverseReason) {
            notesCell = `<span style="color:#fb923c;font-size:0.7rem" title="${escapeHtml(m.reverseReason)}">↩️ ${escapeHtml(m.reverseReason.slice(0,25))}${m.reverseReason.length>25?'…':''}</span>`;
        } else if (isWaste && m.wasteReason) {
            notesCell = `<span style="color:var(--warning);font-size:0.7rem" title="${escapeHtml(m.wasteReason)}">⚠️ ${escapeHtml(m.wasteReason.slice(0,25))}${m.wasteReason.length>25?'…':''}</span>`;
        } else if (m.notes) {
            notesCell = `<span style="font-size:0.7rem;color:var(--muted)" title="${escapeHtml(m.notes)}">${escapeHtml(m.notes.slice(0,25))}${m.notes.length>25?'…':''}</span>`;
        }
        if (m._reversedBy) {
            notesCell = `<span style="color:#fb923c;font-size:0.7rem;text-decoration:line-through" title="هذه الحركة أُلغيت">${notesCell}</span> <span style="color:#fb923c;font-size:0.65rem">[ملغاة]</span>`;
        }

        const dateCell = isBackdated ? `${dateStr} <span title="مؤرَّخة بأثر رجعي" style="color:#fb923c">⏰</span>` : dateStr;
        const balanceCell = m.quantityAfter !== undefined ? fmtNum(m.quantityAfter) : '—';

        let actionCell = '';
        if (isStaff()) {
            if (m.movType === 'out' && !isReverse && !m._reversedBy) {
                actionCell = `<td class="no-print"><button class="btn btn-xs" style="background:rgba(251,146,60,0.15);color:#fb923c;font-size:0.7rem;padding:2px 6px" onclick="StockCardView.reverseMovement('${m._docId}')" title="إلغاء قيد">↩️</button></td>`;
            } else {
                actionCell = '<td class="no-print">—</td>';
            }
        }

        const rowClass = m._reversedBy ? 'row-reversed' : (isReverse ? 'row-reverse' : '');

        return `<tr class="${rowClass}">
            <td>${dateCell}</td>
            <td>${escapeHtml(dest)}</td>
            <td style="font-family:monospace;font-size:0.7rem">${escapeHtml(m.documentNo||'—')}</td>
            <td style="font-family:monospace;font-size:0.7rem">${escapeHtml(m.batchNumber||'—')}</td>
            <td style="color:var(--success);font-weight:600">${(m.movType==='in'||isReverse)?fmtNum(m.quantity||0):''}</td>
            <td style="color:#fb923c;font-weight:600">${m.movType==='out'?fmtNum(m.quantity||0):''}</td>
            <td style="font-weight:600">${balanceCell}</td>
            <td style="font-size:0.7rem">${expStr}</td>
            <td>${typeCell}</td>
            <td>${notesCell}</td>
            <td style="font-size:0.68rem">${escapeHtml(m.createdByName||m.createdBy||'—')}</td>
            ${actionCell}
        </tr>`;
    },

    // ============================================================
    // إلغاء قيد (Reverse Movement) — منقول من ledger.js المحذوف
    // ============================================================
    async reverseMovement(movDocId) {
        if (!isStaff()) { showToast('لا تملك صلاحية', 'error'); return; }
        try {
            const movDoc = await db.collection('departments').doc(CURRENT_DEPT)
                .collection('movements').doc(movDocId).get();
            if (!movDoc.exists) { showToast('الحركة غير موجودة', 'error'); return; }
            const mov = movDoc.data();

            if (mov.movType === 'reverse') { showToast('لا يمكن إلغاء حركة إلغاء', 'error'); return; }
            if (mov.movType === 'in') { showToast('لإلغاء استلام، سجِّل هدر بدلاً', 'warning'); return; }
            if (mov.reverseOf) { showToast('هذه الحركة مُلغاة بالفعل', 'warning'); return; }

            const reverseCheck = await db.collection('departments').doc(CURRENT_DEPT)
                .collection('movements').where('reverseOf', '==', movDocId).limit(1).get();
            if (!reverseCheck.empty) { showToast('هذه الحركة أُلغيت سابقاً', 'warning'); return; }

            const movDate = (mov.dispensingDate?.toDate?.() || mov.createdAt?.toDate?.())?.toLocaleDateString('en-GB', { calendar:'gregory', numberingSystem:'latn' }) || '—';
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.innerHTML = `<div class="modal-content">
                <button class="modal-close" onclick="this.closest('.modal').remove()">✕</button>
                <h3>↩️ إلغاء قيد حركة</h3>
                <div style="background:var(--warning-dim);padding:10px;border-radius:6px;margin:8px 0;font-size:0.82rem;border:1px solid var(--warning)">
                    ⚠️ سيُنشأ قيد عكسي يُعيد <b>${mov.quantity}</b> ${escapeHtml(mov.unit||'')} للمخزون. الحركة الأصلية لن تُحذف (تبقى مع شطب بصري).
                </div>
                <div style="background:var(--surface2);padding:10px;border-radius:6px;font-size:0.82rem;margin-bottom:8px">
                    <div><b>التاريخ:</b> ${movDate}</div>
                    <div><b>الكمية:</b> ${mov.quantity} ${escapeHtml(mov.unit||'')}</div>
                    <div><b>الجهة:</b> ${escapeHtml(mov.destination?.main||'-')} ${mov.destination?.sub?'/ '+escapeHtml(mov.destination.sub):''}</div>
                </div>
                <div class="form-group"><label>سبب الإلغاء * (إلزامي، 5 أحرف على الأقل)</label>
                    <textarea id="rev-reason" class="form-control" rows="3" maxlength="500" placeholder="مثال: خطأ في الكمية"></textarea>
                </div>
                <p id="rev-error" class="text-danger" style="margin-top:6px"></p>
                <div style="display:flex;gap:8px;margin-top:1rem">
                    <button class="btn btn-danger" id="rev-confirm">↩️ تأكيد الإلغاء</button>
                    <button class="btn" onclick="this.closest('.modal').remove()">إلغاء العملية</button>
                </div>
            </div>`;
            document.body.appendChild(modal);
            document.getElementById('rev-confirm').onclick = () => this._confirmReverse(movDocId);
        } catch (e) {
            showToast('خطأ: ' + e.message, 'error');
        }
    },

    async _confirmReverse(movDocId) {
        const connected = await ConnectionMonitor.requireConnection('إلغاء القيد');
        if (!connected) return;
        const reason = sanitizeInput(document.getElementById('rev-reason')?.value || '', 500);
        const errorEl = document.getElementById('rev-error');
        if (!reason || reason.length < 5) { errorEl.textContent = 'سبب الإلغاء مطلوب (5 أحرف على الأقل)'; return; }
        if (!await App.confirmAction('تأكيد نهائي: إلغاء هذه الحركة سيُعيد الكمية للمخزون. متابعة؟')) return;

        try {
            const origRef = db.collection('departments').doc(CURRENT_DEPT).collection('movements').doc(movDocId);
            await db.runTransaction(async tx => {
                const origSnap = await tx.get(origRef);
                if (!origSnap.exists) throw new Error('الحركة الأصلية غير موجودة');
                const orig = origSnap.data();

                const reverseCheck = await tx.get(
                    db.collection('departments').doc(CURRENT_DEPT).collection('movements')
                        .where('reverseOf', '==', movDocId).limit(1)
                );
                if (!reverseCheck.empty) throw new Error('الحركة أُلغيت من جهاز آخر');
                if (orig.movType !== 'out') throw new Error('يُسمح فقط بإلغاء حركات الصرف');

                const itemRef = db.collection('departments').doc(CURRENT_DEPT)
                    .collection('inventory').doc(orig.inventoryId);
                const iSnap = await tx.get(itemRef);
                if (!iSnap.exists) throw new Error('المادة لم تعد موجودة');

                const curQty = iSnap.data().quantity || 0;
                const newQty = curQty + (orig.quantity || 0);

                tx.update(itemRef, {
                    quantity: newQty,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    depletionDate: null
                });

                const reverseRef = db.collection('departments').doc(CURRENT_DEPT).collection('movements').doc();
                tx.set(reverseRef, {
                    inventoryId: orig.inventoryId,
                    code: orig.code || '', name: orig.name || '', unit: orig.unit || '',
                    movType: 'reverse',
                    movementSubType: 'reverse_' + (orig.movementSubType || 'dispense'),
                    reverseOf: movDocId,
                    reverseReason: reason,
                    quantity: orig.quantity || 0,
                    quantityBefore: curQty,
                    quantityAfter: newQty,
                    destination: orig.destination || null,
                    source: 'إلغاء قيد',
                    batchNumber: orig.batchNumber || '',
                    expiryDate: orig.expiryDate || null,
                    documentNo: '',
                    dept: CURRENT_DEPT,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    createdBy: CU.email,
                    createdByName: CU.name,
                    createdByKadre: KADRE_LABELS[CU.role]
                });

                tx.set(db.collection('auditLog').doc(), {
                    action: 'reverse_movement',
                    itemId: orig.inventoryId, itemName: orig.name,
                    dept: CURRENT_DEPT,
                    qty: orig.quantity || 0,
                    qtyBefore: curQty, qtyAfter: newQty,
                    reason: `إلغاء حركة ${movDocId}: ${reason}`,
                    by: CU.email, byUid: CU.uid,
                    at: firebase.firestore.FieldValue.serverTimestamp()
                });
            });

            LedgerCacheV2.clear();
            MovementsCache.clear();
            document.querySelector('.modal')?.remove();
            showToast('✅ تم إلغاء الحركة', 'success');
            await this._loadCardData();
        } catch (e) {
            const errEl = document.getElementById('rev-error');
            if (errEl) errEl.textContent = handleFirestoreError(e, 'reverseMovement');
            else showToast('فشل: ' + e.message, 'error');
        }
    },

    // ============================================================
    // تصدير Excel للبطاقة
    // ============================================================
    exportExcel() {
        if (typeof XLSX === 'undefined') { showToast('مكتبة Excel غير محملة', 'error'); return; }
        const item = AppState.inventory.get(this._state.selectedItemId);
        if (!item) return;
        const all = this._state.movements || [];
        const f = this._state.filters;
        const fromDate = f.from ? new Date(f.from + 'T00:00:00+03:00') : null;
        const toDate = f.to ? new Date(f.to + 'T23:59:59+03:00') : null;

        const filtered = all.filter(m => {
            if (f.type !== 'all') {
                if (['in','out','reverse'].includes(f.type)) { if (m.movType !== f.type) return false; }
                else { if (m.movementSubType !== f.type) return false; }
            }
            if (fromDate || toDate) { if (!isMovementInRange(m, fromDate, toDate)) return false; }
            if (f.batch && !(m.batchNumber||'').includes(f.batch)) return false;
            if (f.dest) {
                if ((m.destination?.main||'') !== f.dest && m.source !== f.dest) return false;
            }
            if (f.search) {
                const hay = `${m.documentNo||''} ${m.batchNumber||''} ${m.destination?.main||''} ${m.notes||''}`.toLowerCase();
                if (!hay.includes(f.search)) return false;
            }
            return true;
        });

        if (!filtered.length) { showToast('لا توجد بيانات للتصدير', 'warning'); return; }

        // ورقة 1: ترويسة + ملخص
        const headerRows = [
            ['بطاقة المادة'],
            ['اسم المادة', item.name || ''],
            ['الرمز الوطني', item.code || ''],
            ['الوحدة', item.unit || ''],
            ['الأولوية', item.importPriority || ''],
            ['الرصيد الحالي', item.quantity || 0],
            ['الحد الأدنى', item.minQuantity || 0],
            ['تاريخ التصدير', new Date().toLocaleDateString('en-GB', { calendar:'gregory', numberingSystem:'latn' })],
            ['عدد الحركات', filtered.length],
            ['']
        ];

        // ورقة 2: الحركات
        const movsHeader = ['التاريخ','الجهة','الوثيقة','الوجبة','الوارد','الصادر','الرصيد بعد','الانتهاء','النوع','المصنّع','الملاحظات','المسؤول','مُلغاة'];
        const movsRows = filtered.map(m => {
            const dispDate = m.dispensingDate?.toDate?.() || m.createdAt?.toDate?.();
            const dateStr = dispDate ? dispDate.toLocaleDateString('en-GB', { calendar:'gregory', numberingSystem:'latn' }) : '';
            const dest = m.movType === 'in' ? (m.source||'') : `${m.destination?.main||''}${m.destination?.sub?' / '+m.destination.sub:''}`;
            const expStr = m.expiryDate?.toDate?.()?.toLocaleDateString('en-GB', { calendar:'gregory', numberingSystem:'latn' }) || '';
            const isWaste = m.movementSubType === 'wastage';
            const isReverse = m.movType === 'reverse';
            let typeLabel = '—';
            if (m.movType === 'out') typeLabel = isWaste ? 'هدر' : 'صرف';
            else if (m.movType === 'in') typeLabel = { purchase:'مشتريات', opening:'افتتاحي', dispense_circle:'تجهيز دائرة' }[m.movementSubType] || 'وارد';
            else if (isReverse) typeLabel = 'إلغاء قيد';
            const notes = isReverse ? (m.reverseReason||'') : (isWaste ? (m.wasteReason||'') : (m.notes||''));
            return [
                dateStr, dest,
                m.documentNo||'', m.batchNumber||'',
                (m.movType==='in'||isReverse) ? (m.quantity||0) : '',
                m.movType==='out' ? (m.quantity||0) : '',
                m.quantityAfter ?? '',
                expStr, typeLabel,
                m.manufacturer || '', notes,
                m.createdByName || m.createdBy || '',
                m._reversedBy ? 'نعم' : ''
            ];
        });

        const wb = XLSX.utils.book_new();
        const ws1 = XLSX.utils.aoa_to_sheet(headerRows);
        const ws2 = XLSX.utils.aoa_to_sheet([movsHeader, ...movsRows]);
        ws1['!cols'] = [{ wch: 25 }, { wch: 30 }];
        ws2['!cols'] = movsHeader.map(() => ({ wch: 14 }));
        XLSX.utils.book_append_sheet(wb, ws1, 'الترويسة');
        XLSX.utils.book_append_sheet(wb, ws2, 'الحركات');

        const safeName = (item.name || 'مادة').replace(/[^\w\u0600-\u06FF]/g, '_').slice(0, 40);
        const today = new Date().toISOString().split('T')[0];
        XLSX.writeFile(wb, `بطاقة_${safeName}_${today}.xlsx`);
        showToast(`✅ صُدِّرت ${filtered.length} حركة`, 'success');
    },

    printCard() {
        document.body.classList.add('printing-card');
        window.print();
        setTimeout(() => document.body.classList.remove('printing-card'), 500);
    }
};

window.StockCardView = StockCardView;

// 🆕 v7.3: ربط الواجهة بـ App للوصول من inventory.js
window.App = window.App || {};
window.App.openCardPage = (itemId) => {
    if (typeof App.switchSection === 'function') App.switchSection('cards');
    setTimeout(() => StockCardView.openCard(itemId), 100);
};

})();
