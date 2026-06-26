// ============================================================
// js/features/reports-v73-ledger.js — سجل الحركات الشامل
// ============================================================
// 19 فلتر + خلاصة موسَّعة + تصدير Excel + إلغاء قيد ↩️
// منقول من ledger.js المحذوف، موسَّع مع فلاتر جديدة
// ============================================================

(function() {
'use strict';

const FETCH_LIMIT = 3000;
const PAGE_SIZE = 100;

const LedgerState = {
    raw: [],         // كل الحركات المُجلَبَة من Firestore
    filtered: [],    // بعد تطبيق الفلاتر
    page: 1,
    aggregate: false, // وضع الخلاصة
    filters: {
        search: '',
        code: '',
        scientific: '',
        unit: '',
        priority: '',
        type: 'all',
        subType: '',
        qtyMin: '',
        qtyMax: '',
        from: '',
        to: '',
        expFrom: '',
        expTo: '',
        backdatedOnly: false,
        docNo: '',
        batchNo: '',
        destMain: '',
        destSub: '',
        reverseStatus: 'all', // all | reversed | not_reversed
        wasteOnly: false,
        userId: ''
    }
};

Object.assign(App, {
    async renderFullLedger(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = `
            <div class="card">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
                    <h3 style="margin:0">📜 سجل الحركات الشامل</h3>
                    <span id="ledger-count-badge" class="badge badge-primary">—</span>
                </div>
                <p class="text-muted" style="font-size:0.78rem;margin:6px 0 10px">
                    كل حركات القسم: وارد + صادر + هدر + إلغاء قيد. <strong>19 فلتر</strong> + خلاصة موسَّعة لكل مادة.
                </p>

                <!-- الفلاتر السريعة (شريط دائم) -->
                <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
                    <input type="text" id="lg-search" class="form-control" placeholder="🔍 بحث سريع" style="flex:1;min-width:140px">
                    <select id="lg-type" class="form-control" style="width:auto">
                        <option value="all">كل الأنواع</option>
                        <option value="in">📥 وارد</option>
                        <option value="out">📤 صادر</option>
                        <option value="reverse">↩️ إلغاء قيد</option>
                    </select>
                    <input type="date" id="lg-from" class="form-control" style="width:auto" title="من">
                    <input type="date" id="lg-to" class="form-control" style="width:auto" title="إلى">
                    <button class="btn btn-sm" id="lg-toggle-drawer" type="button">🔍 فلاتر أكثر</button>
                </div>

                <!-- Filter Drawer (مخفي افتراضياً) -->
                <div id="lg-drawer" style="display:none;background:var(--surface2);padding:10px;border-radius:var(--radius-sm);margin-bottom:10px">
                    <details open>
                        <summary style="cursor:pointer;font-weight:600;margin-bottom:8px">المادة</summary>
                        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:6px">
                            <input type="text" id="lg-code" class="form-control" placeholder="الرمز الوطني">
                            <input type="text" id="lg-scientific" class="form-control" placeholder="الاسم العلمي">
                            <input type="text" id="lg-unit" class="form-control" placeholder="الشكل / الوحدة">
                            <select id="lg-priority" class="form-control">
                                <option value="">كل الأولويات</option>
                                <option value="A1">A1</option>
                                <option value="A2">A2</option>
                                <option value="A">A</option>
                                <option value="B">B</option>
                                <option value="C">C</option>
                            </select>
                        </div>
                    </details>
                    <details>
                        <summary style="cursor:pointer;font-weight:600;margin:8px 0">الحركة</summary>
                        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:6px">
                            <select id="lg-subtype" class="form-control">
                                <option value="">كل الأنواع الفرعية</option>
                                <option value="dispense">✅ صرف</option>
                                <option value="wastage">⚠️ هدر</option>
                                <option value="purchase">🛒 مشتريات</option>
                                <option value="dispense_circle">📥 تجهيز دائرة</option>
                                <option value="opening">📂 افتتاحي</option>
                            </select>
                            <input type="number" id="lg-qty-min" class="form-control" placeholder="كمية أقل من" min="0">
                            <input type="number" id="lg-qty-max" class="form-control" placeholder="كمية أكثر من" min="0">
                        </div>
                    </details>
                    <details>
                        <summary style="cursor:pointer;font-weight:600;margin:8px 0">التواريخ والوثائق</summary>
                        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:6px">
                            <input type="date" id="lg-exp-from" class="form-control" title="انتهاء من">
                            <input type="date" id="lg-exp-to" class="form-control" title="انتهاء إلى">
                            <input type="text" id="lg-docno" class="form-control" placeholder="رقم الطلبية">
                            <input type="text" id="lg-batchno" class="form-control" placeholder="رقم الوجبة">
                        </div>
                    </details>
                    <details>
                        <summary style="cursor:pointer;font-weight:600;margin:8px 0">الجهات والحالة</summary>
                        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:6px">
                            <select id="lg-dest-main" class="form-control">
                                <option value="">كل الجهات</option>
                                ${Object.keys(DESTINATIONS).map(k => `<option value="${k}">${k}</option>`).join('')}
                            </select>
                            <input type="text" id="lg-dest-sub" class="form-control" placeholder="الجهة الفرعية">
                            <select id="lg-reverse-status" class="form-control">
                                <option value="all">كل الحالات</option>
                                <option value="not_reversed">غير مُلغاة فقط</option>
                                <option value="reversed">مُلغاة فقط</option>
                            </select>
                            <input type="text" id="lg-user" class="form-control" placeholder="المسؤول (البريد)">
                            <label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;padding:6px"><input type="checkbox" id="lg-backdated"> ⏰ بأثر رجعي فقط</label>
                            <label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;padding:6px"><input type="checkbox" id="lg-waste-only"> ⚠️ هدر فقط</label>
                        </div>
                    </details>
                    <div style="margin-top:8px;display:flex;gap:6px;justify-content:flex-end">
                        <button class="btn btn-sm" id="lg-clear">🧹 مسح</button>
                        <button class="btn btn-sm btn-primary" id="lg-apply">✅ تطبيق</button>
                    </div>
                </div>

                <!-- شريط الأدوات -->
                <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
                    <label style="display:flex;align-items:center;gap:6px;font-size:0.85rem">
                        <input type="checkbox" id="lg-aggregate"> 📊 خلاصة بالمادة
                    </label>
                    <span style="flex:1"></span>
                    <button class="btn btn-sm" id="lg-export">📥 تصدير Excel</button>
                </div>

                <!-- الجدول -->
                <div id="lg-loading" style="text-align:center;padding:30px"><div style="font-size:2.4rem">⏳</div></div>
                <div id="lg-table-wrap" style="display:none">
                    <div class="table-wrap">
                        <table class="inventory-table" id="lg-table">
                            <thead id="lg-thead"></thead>
                            <tbody id="lg-tbody"></tbody>
                        </table>
                    </div>
                    <div id="lg-pagination" style="margin-top:8px"></div>
                </div>
            </div>`;

        // ربط الأحداث
        document.getElementById('lg-toggle-drawer').onclick = () => {
            const d = document.getElementById('lg-drawer');
            d.style.display = (d.style.display === 'none' || !d.style.display) ? 'block' : 'none';
        };
        document.getElementById('lg-apply').onclick = () => this._lgApplyFilters();
        document.getElementById('lg-clear').onclick = () => this._lgClearFilters();
        document.getElementById('lg-aggregate').onchange = (e) => {
            LedgerState.aggregate = e.target.checked;
            this._lgRender();
        };
        document.getElementById('lg-export').onclick = () => this._lgExport();

        // الفلاتر السريعة (تطبيق تلقائي)
        ['lg-search','lg-type','lg-from','lg-to'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const event = id === 'lg-search' ? 'input' : 'change';
            const handler = id === 'lg-search' ? debounce(() => this._lgApplyFilters(), 250) : () => this._lgApplyFilters();
            el.addEventListener(event, handler);
        });

        // افتراضي: آخر شهرين
        const now = new Date();
        const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        document.getElementById('lg-from').value = twoMonthsAgo.toISOString().split('T')[0];
        document.getElementById('lg-to').value = now.toISOString().split('T')[0];

        // تحميل
        await this._lgLoad();
    },

    async _lgLoad() {
        const dept = CURRENT_DEPT;
        const from = document.getElementById('lg-from').value;
        const to = document.getElementById('lg-to').value;
        const fromDate = from ? new Date(from + 'T00:00:00+03:00') : null;
        const toDate = to ? new Date(to + 'T23:59:59+03:00') : null;

        try {
            const baseQuery = db.collection('departments').doc(dept).collection('movements');
            // فلترة بـ effective date (تستخدم الـ helper المُضاف في utils.js)
            const movements = await fetchMovementsByEffectiveRange(baseQuery, fromDate, toDate, FETCH_LIMIT);

            // كشف الحركات الملغاة
            const reversedIds = new Set();
            movements.forEach(m => {
                if (m.movType === 'reverse' && m.reverseOf) reversedIds.add(m.reverseOf);
            });

            // إضافة _reversedBy للحركات الملغاة
            movements.forEach(m => {
                m._reversedBy = reversedIds.has(m._docId);
            });

            LedgerState.raw = movements;
            this._lgApplyFilters();
            document.getElementById('lg-loading').style.display = 'none';
            document.getElementById('lg-table-wrap').style.display = 'block';
        } catch (e) {
            console.error('_lgLoad:', e);
            const l = document.getElementById('lg-loading');
            if (l) l.innerHTML = `<p class="text-danger">فشل: ${escapeHtml(handleFirestoreError(e, 'lgLoad'))}</p>`;
        }
    },

    _lgApplyFilters() {
        const f = {
            search: (document.getElementById('lg-search')?.value || '').trim().toLowerCase(),
            code: (document.getElementById('lg-code')?.value || '').trim(),
            scientific: (document.getElementById('lg-scientific')?.value || '').trim().toLowerCase(),
            unit: (document.getElementById('lg-unit')?.value || '').trim().toLowerCase(),
            priority: document.getElementById('lg-priority')?.value || '',
            type: document.getElementById('lg-type')?.value || 'all',
            subType: document.getElementById('lg-subtype')?.value || '',
            qtyMin: parseFloat(document.getElementById('lg-qty-min')?.value || '') || null,
            qtyMax: parseFloat(document.getElementById('lg-qty-max')?.value || '') || null,
            from: document.getElementById('lg-from')?.value || '',
            to: document.getElementById('lg-to')?.value || '',
            expFrom: document.getElementById('lg-exp-from')?.value || '',
            expTo: document.getElementById('lg-exp-to')?.value || '',
            backdatedOnly: !!document.getElementById('lg-backdated')?.checked,
            docNo: (document.getElementById('lg-docno')?.value || '').trim(),
            batchNo: (document.getElementById('lg-batchno')?.value || '').trim(),
            destMain: document.getElementById('lg-dest-main')?.value || '',
            destSub: (document.getElementById('lg-dest-sub')?.value || '').trim().toLowerCase(),
            reverseStatus: document.getElementById('lg-reverse-status')?.value || 'all',
            wasteOnly: !!document.getElementById('lg-waste-only')?.checked,
            userId: (document.getElementById('lg-user')?.value || '').trim().toLowerCase()
        };
        LedgerState.filters = f;
        LedgerState.page = 1;

        // إعادة الجلب إذا تغير range التاريخ
        const oldFrom = LedgerState._lastFrom, oldTo = LedgerState._lastTo;
        if (oldFrom !== f.from || oldTo !== f.to) {
            LedgerState._lastFrom = f.from;
            LedgerState._lastTo = f.to;
            return this._lgLoad();
        }

        // تطبيق الفلاتر client-side
        const inv = AppState.inventory;
        const expFromDate = f.expFrom ? new Date(f.expFrom + 'T00:00:00+03:00') : null;
        const expToDate = f.expTo ? new Date(f.expTo + 'T23:59:59+03:00') : null;

        LedgerState.filtered = LedgerState.raw.filter(m => {
            // النوع
            if (f.type !== 'all' && m.movType !== f.type) return false;
            // النوع الفرعي
            if (f.subType && m.movementSubType !== f.subType) return false;
            // الكمية
            const q = m.quantity || 0;
            if (f.qtyMin !== null && q < f.qtyMin) return false;
            if (f.qtyMax !== null && q > f.qtyMax) return false;
            // المادة
            const item = m.inventoryId ? inv.get(m.inventoryId) : null;
            if (f.code && !normalizeCode(item?.code || m.code || '').includes(normalizeCode(f.code))) return false;
            if (f.scientific && !(item?.name || m.name || '').toLowerCase().includes(f.scientific)) return false;
            if (f.unit && !((item?.unit || m.unit || '').toLowerCase().includes(f.unit))) return false;
            if (f.priority) {
                // 🆕 v7.4: fallback على m.importPriority للحركات اليتيمة (المادة محذوفة)
                const itemPriority = item?.importPriority || m.importPriority || '';
                if (itemPriority !== f.priority) return false;
            }
            // تاريخ الانتهاء
            if (expFromDate || expToDate) {
                const exp = m.expiryDate?.toDate?.();
                if (!exp) return false;
                if (expFromDate && exp < expFromDate) return false;
                if (expToDate && exp > expToDate) return false;
            }
            // الوثيقة والوجبة
            if (f.docNo && !(m.documentNo || '').includes(f.docNo)) return false;
            if (f.batchNo && !(m.batchNumber || '').includes(f.batchNo)) return false;
            // الجهة
            if (f.destMain && (m.destination?.main || '') !== f.destMain && m.source !== f.destMain) return false;
            if (f.destSub && !((m.destination?.sub || '').toLowerCase().includes(f.destSub))) return false;
            // الإلغاء
            if (f.reverseStatus === 'reversed' && !m._reversedBy) return false;
            if (f.reverseStatus === 'not_reversed' && (m._reversedBy || m.movType === 'reverse')) return false;
            // الهدر فقط
            if (f.wasteOnly && m.movementSubType !== 'wastage') return false;
            // المسؤول
            if (f.userId && !((m.createdBy || '').toLowerCase().includes(f.userId))) return false;
            // backdated
            if (f.backdatedOnly) {
                const created = m.createdAt?.toDate?.();
                const dispDate = m.dispensingDate?.toDate?.();
                if (!created || !dispDate) return false;
                if (Math.abs(created - dispDate) <= 24 * 3600 * 1000) return false;
            }
            // بحث نصي
            if (f.search) {
                const hay = `${item?.name || m.name || ''} ${item?.code || m.code || ''} ${m.documentNo || ''} ${m.batchNumber || ''} ${m.destination?.main || ''} ${m.destination?.sub || ''} ${m.notes || ''} ${m.wasteReason || ''} ${m.createdByName || ''}`.toLowerCase();
                if (!hay.includes(f.search)) return false;
            }
            return true;
        });

        this._lgRender();
    },

    _lgClearFilters() {
        ['lg-search','lg-code','lg-scientific','lg-unit','lg-docno','lg-batchno','lg-dest-sub','lg-user'].forEach(id => {
            const el = document.getElementById(id); if (el) el.value = '';
        });
        ['lg-qty-min','lg-qty-max','lg-exp-from','lg-exp-to'].forEach(id => {
            const el = document.getElementById(id); if (el) el.value = '';
        });
        const sels = { 'lg-type': 'all', 'lg-priority': '', 'lg-subtype': '', 'lg-dest-main': '', 'lg-reverse-status': 'all' };
        Object.entries(sels).forEach(([id, v]) => { const el = document.getElementById(id); if (el) el.value = v; });
        const chks = ['lg-backdated', 'lg-waste-only'];
        chks.forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
        this._lgApplyFilters();
    },

    _lgRender() {
        const thead = document.getElementById('lg-thead');
        const tbody = document.getElementById('lg-tbody');
        const badge = document.getElementById('ledger-count-badge');
        const data = LedgerState.filtered;

        if (LedgerState.aggregate) {
            // وضع الخلاصة الموسَّعة (مادة | كمية | دفعات | أقدم انتهاء)
            const grouped = {};
            data.forEach(m => {
                if (m.movType === 'reverse' || m._reversedBy) return;
                const k = m.inventoryId;
                if (!grouped[k]) {
                    grouped[k] = {
                        name: m.name || '',
                        code: m.code || '',
                        unit: m.unit || '',
                        qtyIn: 0,
                        qtyOut: 0,
                        qtyWaste: 0,
                        batches: new Set(),
                        earliestExp: null,
                        count: 0
                    };
                }
                const g = grouped[k];
                g.count++;
                if (m.movType === 'in') {
                    g.qtyIn += m.quantity || 0;
                    if (m.batchNumber) g.batches.add(m.batchNumber);
                    const exp = m.expiryDate?.toDate?.();
                    if (exp && (!g.earliestExp || exp < g.earliestExp)) g.earliestExp = exp;
                } else if (m.movType === 'out') {
                    if (m.movementSubType === 'wastage') g.qtyWaste += m.quantity || 0;
                    else g.qtyOut += m.quantity || 0;
                }
            });

            const rows = Object.values(grouped).sort((a, b) =>
                (b.qtyIn + b.qtyOut + b.qtyWaste) - (a.qtyIn + a.qtyOut + a.qtyWaste));

            badge.textContent = `${rows.length} مادة`;
            thead.innerHTML = `<tr>
                <th>الرمز</th>
                <th>المادة</th>
                <th>الوحدة</th>
                <th>وارد</th>
                <th>صادر</th>
                <th>هدر</th>
                <th>عدد الدفعات</th>
                <th>أقدم انتهاء</th>
                <th>عدد الحركات</th>
            </tr>`;
            tbody.innerHTML = rows.length ? rows.map(r => `<tr>
                <td style="font-family:monospace;font-size:0.72rem">${escapeHtml(r.code)}</td>
                <td>${escapeHtml(r.name)}</td>
                <td>${escapeHtml(r.unit)}</td>
                <td style="color:var(--success);font-weight:600">${fmtNum(r.qtyIn)}</td>
                <td style="font-weight:600">${fmtNum(r.qtyOut)}</td>
                <td style="color:var(--danger)">${fmtNum(r.qtyWaste)}</td>
                <td>${r.batches.size}</td>
                <td>${r.earliestExp ? r.earliestExp.toLocaleDateString('en-GB', { calendar:'gregory', numberingSystem:'latn' }) : '—'}</td>
                <td>${r.count}</td>
            </tr>`).join('')
                : `<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--muted)">لا نتائج</td></tr>`;
            document.getElementById('lg-pagination').innerHTML = '';
            return;
        }

        // وضع الجدول العادي (الحركات منفصلة)
        const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
        if (LedgerState.page > totalPages) LedgerState.page = totalPages;
        const start = (LedgerState.page - 1) * PAGE_SIZE;
        const pageData = data.slice(start, start + PAGE_SIZE);

        badge.textContent = `${data.length} حركة`;
        thead.innerHTML = `<tr>
            <th>التاريخ</th>
            <th>المادة</th>
            <th>الجهة</th>
            <th>الوثيقة</th>
            <th>الوجبة</th>
            <th>الكمية</th>
            <th>النوع</th>
            <th>المسؤول</th>
            <th>ملاحظات</th>
        </tr>`;

        if (!pageData.length) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--muted)">لا حركات تطابق الفلاتر</td></tr>`;
        } else {
            tbody.innerHTML = pageData.map(m => {
                const dispDate = m.dispensingDate?.toDate?.() || m.createdAt?.toDate?.();
                const dateStr = dispDate?.toLocaleDateString('en-GB', { calendar:'gregory', numberingSystem:'latn' }) || '—';
                const created = m.createdAt?.toDate?.();
                const isBackdated = created && dispDate && Math.abs(created - dispDate) > 24*3600*1000;
                const dest = m.movType === 'in' ? (m.source || '—') : `${m.destination?.main || ''}${m.destination?.sub ? ' / ' + m.destination.sub : ''}`;
                let typeCell;
                if (m.movType === 'in') {
                    typeCell = m.movementSubType === 'purchase' ? '🛒 شراء'
                        : m.movementSubType === 'opening' ? '📂 افتتاحي'
                        : '📥 تجهيز';
                } else if (m.movType === 'out') {
                    typeCell = m.movementSubType === 'wastage' ? '⚠️ هدر' : '✅ صرف';
                } else if (m.movType === 'reverse') {
                    typeCell = '↩️ إلغاء';
                } else {
                    typeCell = m.movType;
                }
                const rowClass = m._reversedBy ? 'row-reversed' : (m.movType === 'reverse' ? 'row-reverse' : '');
                const notes = m.movType === 'reverse' ? (m.reverseReason || '')
                    : m.movementSubType === 'wastage' ? (m.wasteReason || '')
                    : (m.notes || '');
                return `<tr class="${rowClass}">
                    <td>${dateStr}${isBackdated ? ' <span style="color:#fb923c" title="بأثر رجعي">⏰</span>' : ''}</td>
                    <td>${escapeHtml(m.name || '—')}</td>
                    <td>${escapeHtml(dest)}</td>
                    <td style="font-family:monospace;font-size:0.7rem">${escapeHtml(m.documentNo || '—')}</td>
                    <td style="font-family:monospace;font-size:0.7rem">${escapeHtml(m.batchNumber || '—')}</td>
                    <td style="font-weight:600;color:${m.movType==='out'?'#fb923c':'var(--success)'}">${fmtNum(m.quantity || 0)}</td>
                    <td>${typeCell}</td>
                    <td style="font-size:0.7rem">${escapeHtml(m.createdByName || m.createdBy || '—')}</td>
                    <td style="font-size:0.7rem">${escapeHtml((notes || '').slice(0, 30))}</td>
                </tr>`;
            }).join('');
        }

        // Pagination
        const pagEl = document.getElementById('lg-pagination');
        if (data.length > PAGE_SIZE) {
            pagEl.innerHTML = `<div class="alert-box alert-warning" style="font-size:0.78rem">
                <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">
                    <span>صفحة ${LedgerState.page} من ${totalPages}</span>
                    <div style="display:flex;gap:6px">
                        <button class="btn btn-sm" onclick="App._lgGoPage(1)" ${LedgerState.page===1?'disabled':''}>⏮</button>
                        <button class="btn btn-sm" onclick="App._lgGoPage(${LedgerState.page-1})" ${LedgerState.page<=1?'disabled':''}>◀</button>
                        <button class="btn btn-sm" onclick="App._lgGoPage(${LedgerState.page+1})" ${LedgerState.page>=totalPages?'disabled':''}>▶</button>
                        <button class="btn btn-sm" onclick="App._lgGoPage(${totalPages})" ${LedgerState.page>=totalPages?'disabled':''}>⏭</button>
                    </div>
                </div>
            </div>`;
        } else if (LedgerState.raw.length >= FETCH_LIMIT) {
            pagEl.innerHTML = `<div class="alert-box alert-warning" style="font-size:0.78rem">⚠️ بلغت الحد ${FETCH_LIMIT}. استخدم فلاتر أدق.</div>`;
        } else {
            pagEl.innerHTML = '';
        }
    },

    _lgGoPage(p) {
        LedgerState.page = p;
        this._lgRender();
    },

    async _lgExport() {
        if (typeof XLSX === 'undefined') { showToast('XLSX غير محملة', 'error'); return; }
        const data = LedgerState.filtered;
        if (!data.length) { showToast('لا بيانات للتصدير', 'warning'); return; }

        const today = new Date().toISOString().split('T')[0];

        if (LedgerState.aggregate) {
            // تصدير الخلاصة
            const grouped = {};
            data.forEach(m => {
                if (m.movType === 'reverse' || m._reversedBy) return;
                const k = m.inventoryId;
                if (!grouped[k]) grouped[k] = { name: m.name || '', code: m.code || '', unit: m.unit || '', qtyIn: 0, qtyOut: 0, qtyWaste: 0, batches: new Set(), earliestExp: null, count: 0 };
                const g = grouped[k];
                g.count++;
                if (m.movType === 'in') {
                    g.qtyIn += m.quantity || 0;
                    if (m.batchNumber) g.batches.add(m.batchNumber);
                    const exp = m.expiryDate?.toDate?.();
                    if (exp && (!g.earliestExp || exp < g.earliestExp)) g.earliestExp = exp;
                } else if (m.movType === 'out') {
                    if (m.movementSubType === 'wastage') g.qtyWaste += m.quantity || 0;
                    else g.qtyOut += m.quantity || 0;
                }
            });
            const rows = Object.values(grouped).map(r => [
                r.code, r.name, r.unit, r.qtyIn, r.qtyOut, r.qtyWaste, r.batches.size,
                r.earliestExp?.toLocaleDateString('en-GB', { calendar:'gregory', numberingSystem:'latn' }) || '',
                r.count
            ]);
            // 🆕 v7.4: استخدام exportXlsxAudited
            if (typeof exportXlsxAudited === 'function') {
                await exportXlsxAudited({
                    filename: `ledger_summary_${CURRENT_DEPT}_${today}`,
                    reportName: 'Ledger Summary',
                    sheetName: 'خلاصة',
                    headers: ['الرمز','المادة','الوحدة','وارد','صادر','هدر','عدد الدفعات','أقدم انتهاء','عدد الحركات'],
                    rows,
                    columnWidths: [14, 35, 10, 10, 10, 10, 10, 12, 10],
                    extra: { aggregate: true, filters: LedgerState.filters }
                });
            } else {
                const wb = XLSX.utils.book_new();
                const ws = XLSX.utils.aoa_to_sheet([
                    ['الرمز','المادة','الوحدة','وارد','صادر','هدر','عدد الدفعات','أقدم انتهاء','عدد الحركات'],
                    ...rows
                ]);
                XLSX.utils.book_append_sheet(wb, ws, 'خلاصة');
                XLSX.writeFile(wb, `ledger_summary_${CURRENT_DEPT}_${today}.xlsx`);
            }
        } else {
            // تصدير الحركات
            const rows = data.map(m => {
                const dispDate = m.dispensingDate?.toDate?.() || m.createdAt?.toDate?.();
                const dateStr = dispDate?.toLocaleDateString('en-GB', { calendar:'gregory', numberingSystem:'latn' }) || '';
                const dest = m.movType === 'in' ? (m.source || '') : `${m.destination?.main || ''}${m.destination?.sub ? ' / ' + m.destination.sub : ''}`;
                const exp = m.expiryDate?.toDate?.()?.toLocaleDateString('en-GB', { calendar:'gregory', numberingSystem:'latn' }) || '';
                const notes = m.movType === 'reverse' ? (m.reverseReason || '') : m.movementSubType === 'wastage' ? (m.wasteReason || '') : (m.notes || '');
                return [dateStr, m.name || '', m.code || '', dest, m.documentNo || '', m.batchNumber || '', m.quantity || 0, m.movType || '', m.movementSubType || '', exp, m.manufacturer || '', m.createdByName || '', notes, m._reversedBy ? 'نعم' : ''];
            });

            if (typeof exportXlsxAudited === 'function') {
                await exportXlsxAudited({
                    filename: `ledger_${CURRENT_DEPT}_${today}`,
                    reportName: 'Ledger Detailed',
                    sheetName: 'سجل الحركات',
                    headers: ['التاريخ','المادة','الرمز','الجهة','الوثيقة','الوجبة','الكمية','النوع','نوع فرعي','الانتهاء','المصنّع','المسؤول','ملاحظات','مُلغاة'],
                    rows,
                    columnWidths: [12, 30, 14, 22, 14, 14, 10, 10, 12, 12, 16, 14, 30, 8],
                    extra: { aggregate: false, filters: LedgerState.filters, total: rows.length }
                });
            } else {
                const wb = XLSX.utils.book_new();
                const ws = XLSX.utils.aoa_to_sheet([
                    ['التاريخ','المادة','الرمز','الجهة','الوثيقة','الوجبة','الكمية','النوع','نوع فرعي','الانتهاء','المصنّع','المسؤول','ملاحظات','مُلغاة'],
                    ...rows
                ]);
                XLSX.utils.book_append_sheet(wb, ws, 'سجل الحركات');
                XLSX.writeFile(wb, `ledger_${CURRENT_DEPT}_${today}.xlsx`);
            }
        }
        showToast(`✅ صُدِّرت ${data.length} حركة`, 'success');
    }
});

})();
