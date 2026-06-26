// ============================================================
// js/features/periodic-balance.js
// واجهة الميزان الدوري لكل المواد + تصدير Excel وزاري
// v6.9
// ============================================================

(function() {
'use strict';

// 🔧 v7.2: استُخدم DEPT_NAMES من globals.js مباشرةً (لا تظليل) — قسمَين فقط

const PeriodicBalance = {
    _state: {
        dept: null,
        year: null,
        month: null,
        period: 'monthly',  // 'monthly' | 'yearly' | 'custom'
        startDate: null,
        endDate: null,
        data: null
    },

    /**
     * فتح واجهة الميزان الدوري
     * تُستدعى من tab "الميزان الدوري" في التقارير
     */
    async render(containerId = 'periodic-balance-container') {
        const container = document.getElementById(containerId);
        if (!container) return;

        // تهيئة الحالة الافتراضية: الشهر الحالي
        const now = new Date();
        const baghdadNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Baghdad' }));
        this._state.dept = (typeof CURRENT_DEPT !== 'undefined') ? CURRENT_DEPT : 'pharmacy';
        this._state.year = baghdadNow.getFullYear();
        this._state.month = baghdadNow.getMonth();
        this._state.period = 'monthly';

        container.innerHTML = this._renderShell();
        this._attachHandlers();
        await this._loadAndRender();
    },

    _renderShell() {
        const now = new Date();
        const currentYear = now.getFullYear();
        const monthOptions = ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                              'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

        const monthSel = monthOptions.map((m, i) =>
            `<option value="${i}" ${i === this._state.month ? 'selected' : ''}>${m} ${currentYear}</option>`
        ).join('');

        const yearSel = [currentYear, currentYear - 1, currentYear - 2].map(y =>
            `<option value="${y}" ${y === this._state.year ? 'selected' : ''}>${y}</option>`
        ).join('');

        const deptSel = Object.entries(DEPT_NAMES).map(([k, v]) =>
            `<option value="${k}" ${k === this._state.dept ? 'selected' : ''}>${v}</option>`
        ).join('');

        return `
            <div class="card" style="margin-bottom:12px">
                <h3 style="margin:0 0 10px">📒 الميزان الدوري</h3>
                <div class="row" style="gap:8px;flex-wrap:wrap">
                    <div style="flex:1;min-width:140px">
                        <label style="font-size:0.78rem;color:var(--text2)">القسم</label>
                        <select id="pb-dept" class="form-control">${deptSel}</select>
                    </div>
                    <div style="flex:0 0 140px">
                        <label style="font-size:0.78rem;color:var(--text2)">النوع</label>
                        <select id="pb-period" class="form-control">
                            <option value="monthly" ${this._state.period === 'monthly' ? 'selected' : ''}>شهري</option>
                            <option value="yearly" ${this._state.period === 'yearly' ? 'selected' : ''}>سنوي</option>
                        </select>
                    </div>
                    <div id="pb-month-wrapper" style="flex:1;min-width:140px;${this._state.period === 'yearly' ? 'display:none' : ''}">
                        <label style="font-size:0.78rem;color:var(--text2)">الشهر</label>
                        <select id="pb-month" class="form-control">${monthSel}</select>
                    </div>
                    <div style="flex:0 0 100px">
                        <label style="font-size:0.78rem;color:var(--text2)">السنة</label>
                        <select id="pb-year" class="form-control">${yearSel}</select>
                    </div>
                </div>
                <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
                    <button id="pb-refresh" class="btn btn-primary">🔄 تحديث</button>
                    <button id="pb-export" class="btn">📤 تصدير Excel</button>
                    <button id="pb-print" class="btn">🖨️ طباعة</button>
                </div>
            </div>

            <div id="pb-loading" style="display:none;text-align:center;padding:30px">
                <div style="font-size:2rem">⏳</div>
                <p style="color:var(--primary);margin-top:8px">جارٍ حساب الميزان...</p>
            </div>

            <div id="pb-empty" style="display:none;text-align:center;padding:30px;color:var(--muted)">
                لا توجد بيانات للفترة المحددة
            </div>

            <div id="pb-content" style="display:none">
                <div id="pb-kpis"></div>
                <div id="pb-summary"></div>
                <div id="pb-unbalanced-section"></div>
                <div id="pb-table-section"></div>
            </div>
        `;
    },

    _attachHandlers() {
        document.getElementById('pb-period').addEventListener('change', (e) => {
            this._state.period = e.target.value;
            document.getElementById('pb-month-wrapper').style.display =
                this._state.period === 'yearly' ? 'none' : 'block';
        });

        document.getElementById('pb-refresh').addEventListener('click', () => this._loadAndRender());
        document.getElementById('pb-export').addEventListener('click', () => this._exportExcel());
        document.getElementById('pb-print').addEventListener('click', () => window.print());
    },

    async _loadAndRender() {
        const loading = document.getElementById('pb-loading');
        const content = document.getElementById('pb-content');
        const empty = document.getElementById('pb-empty');

        // قراءة الفلاتر
        this._state.dept = document.getElementById('pb-dept').value;
        this._state.period = document.getElementById('pb-period').value;
        this._state.year = parseInt(document.getElementById('pb-year').value);
        this._state.month = parseInt(document.getElementById('pb-month').value);

        // حساب الفترة
        let startDate, endDate;
        if (this._state.period === 'monthly') {
            startDate = new Date(this._state.year, this._state.month, 1, 0, 0, 0, 0);
            endDate = new Date(this._state.year, this._state.month + 1, 0, 23, 59, 59, 999);
        } else {
            startDate = new Date(this._state.year, 0, 1, 0, 0, 0, 0);
            endDate = new Date(this._state.year, 11, 31, 23, 59, 59, 999);
        }
        this._state.startDate = startDate;
        this._state.endDate = endDate;

        loading.style.display = 'block';
        content.style.display = 'none';
        empty.style.display = 'none';

        try {
            const result = await StockCard.getPeriodicBalance(
                this._state.dept,
                startDate,
                endDate
            );
            this._state.data = result;

            if (Object.keys(result.items).length === 0) {
                loading.style.display = 'none';
                empty.style.display = 'block';
                return;
            }

            this._renderResult(result);
            loading.style.display = 'none';
            content.style.display = 'block';
        } catch (e) {
            console.error('Failed to load periodic balance:', e);
            loading.style.display = 'none';
            empty.style.display = 'block';
            empty.innerHTML = `❌ خطأ: ${e.message}`;
        }
    },

    _renderResult(result) {
        const { items, totals } = result;

        // KPIs
        const kpis = document.getElementById('pb-kpis');
        kpis.innerHTML = `
            <div class="card" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:10px">
                <div style="text-align:center;padding:8px;background:var(--surface2);border-radius:6px">
                    <div style="font-size:0.72rem;color:var(--text2)">المواد</div>
                    <div style="font-size:1.3rem;font-weight:bold">${fmtNum(totals.itemCount)}</div>
                </div>
                <div style="text-align:center;padding:8px;background:rgba(74,222,128,0.1);border-radius:6px">
                    <div style="font-size:0.72rem;color:var(--text2)">متوازنة</div>
                    <div style="font-size:1.3rem;font-weight:bold;color:#4ade80">${fmtNum(totals.balancedCount)} ✓</div>
                </div>
                <div style="text-align:center;padding:8px;background:rgba(248,113,113,0.1);border-radius:6px">
                    <div style="font-size:0.72rem;color:var(--text2)">غير متوازنة</div>
                    <div style="font-size:1.3rem;font-weight:bold;color:#f87171">${fmtNum(totals.unbalancedCount)} ⚠️</div>
                </div>
            </div>
        `;

        // الإجماليات
        const summary = document.getElementById('pb-summary');
        const totalReceipts = totals.totalIn;
        const totalIssues = totals.totalOut;
        const expectedClosing = totals.totalOpening + totalReceipts - totalIssues;

        summary.innerHTML = `
            <div class="card" style="margin-bottom:10px">
                <h4 style="margin:0 0 8px">إجماليات الفترة</h4>
                <table style="width:100%;font-size:0.85rem">
                    <tr>
                        <td style="padding:4px 8px;color:var(--text2)">الرصيد الافتتاحي</td>
                        <td style="padding:4px 8px;text-align:left;font-family:monospace">${fmtNum(totals.totalOpening)}</td>
                    </tr>
                    <tr>
                        <td style="padding:4px 8px;color:#4ade80">+ الوارد (تجهيز دائرة)</td>
                        <td style="padding:4px 8px;text-align:left;color:#4ade80;font-family:monospace">${fmtNum(totals.inBySource['تجهيز دائرة'] || 0)}</td>
                    </tr>
                    <tr>
                        <td style="padding:4px 8px;color:#4ade80">+ الوارد (مشتريات)</td>
                        <td style="padding:4px 8px;text-align:left;color:#4ade80;font-family:monospace">${fmtNum(totals.inBySource['مشتريات'] || 0)}</td>
                    </tr>
                    <tr>
                        <td style="padding:4px 8px;color:#4ade80">+ الوارد (افتتاحي)</td>
                        <td style="padding:4px 8px;text-align:left;color:#4ade80;font-family:monospace">${fmtNum(totals.inBySource['افتتاحي'] || 0)}</td>
                    </tr>
                    <tr>
                        <td style="padding:4px 8px;color:#4ade80">+ الوارد (إرجاع)</td>
                        <td style="padding:4px 8px;text-align:left;color:#4ade80;font-family:monospace">${fmtNum(totals.inBySource['إرجاع'] || 0)}</td>
                    </tr>
                    <tr>
                        <td style="padding:4px 8px;color:#fb923c">- الصادر (صرف)</td>
                        <td style="padding:4px 8px;text-align:left;color:#fb923c;font-family:monospace">${fmtNum(totals.outByCategory['صرف'] || 0)}</td>
                    </tr>
                    <tr>
                        <td style="padding:4px 8px;color:#f87171">- الهدر</td>
                        <td style="padding:4px 8px;text-align:left;color:#f87171;font-family:monospace">${fmtNum(totals.outByCategory['هدر'] || 0)}</td>
                    </tr>
                    <tr>
                        <td style="padding:4px 8px;color:#f87171">- الإرجاع المنتهي</td>
                        <td style="padding:4px 8px;text-align:left;color:#f87171;font-family:monospace">${fmtNum(totals.outByCategory['إرجاع منتهي'] || 0)}</td>
                    </tr>
                    <tr style="border-top:2px solid var(--primary)">
                        <td style="padding:8px;font-weight:bold;color:var(--primary)">= الرصيد الختامي</td>
                        <td style="padding:8px;text-align:left;font-weight:bold;color:var(--primary);font-family:monospace;font-size:1rem">${fmtNum(totals.totalClosing)} ${totals.unbalancedCount === 0 ? '✓' : '⚠️'}</td>
                    </tr>
                </table>
            </div>
        `;

        // المواد غير المتوازنة
        const unbalancedSection = document.getElementById('pb-unbalanced-section');
        const unbalanced = Object.entries(items)
            .filter(([_, e]) => !e.balanced)
            .sort((a, b) => Math.abs(b[1].discrepancy) - Math.abs(a[1].discrepancy));

        if (unbalanced.length > 0) {
            unbalancedSection.innerHTML = `
                <div class="card" style="margin-bottom:10px;border:1px solid #f87171;background:rgba(248,113,113,0.05)">
                    <h4 style="margin:0 0 8px;color:#f87171">⚠️ المواد غير المتوازنة (${unbalanced.length})</h4>
                    <p style="font-size:0.78rem;color:var(--text2);margin-bottom:8px">
                        فروقات تحتاج تحقيق صيدلاني — قد تكون: خطأ تسجيل، هدر غير موثَّق، أو فقدان
                    </p>
                    <div style="max-height:300px;overflow-y:auto">
                        <table style="width:100%;font-size:0.78rem">
                            <thead style="background:var(--surface2);position:sticky;top:0">
                                <tr>
                                    <th style="padding:6px;text-align:right">الاسم</th>
                                    <th style="padding:6px;text-align:left">الفعلي</th>
                                    <th style="padding:6px;text-align:left">المتوقع</th>
                                    <th style="padding:6px;text-align:left">الفرق</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${unbalanced.slice(0, 50).map(([id, e]) => `
                                    <tr style="border-bottom:1px solid var(--border)">
                                        <td style="padding:6px">${escapeHtml(e.itemInfo.name || id)}</td>
                                        <td style="padding:6px;text-align:left;font-family:monospace">${fmtNum(e.actualClosing)}</td>
                                        <td style="padding:6px;text-align:left;font-family:monospace">${fmtNum(e.closing)}</td>
                                        <td style="padding:6px;text-align:left;font-family:monospace;color:${e.discrepancy > 0 ? '#4ade80' : '#f87171'}">${e.discrepancy > 0 ? '+' : ''}${fmtNum(e.discrepancy)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } else {
            unbalancedSection.innerHTML = '';
        }

        // الجدول التفصيلي
        const tableSection = document.getElementById('pb-table-section');
        const sortedItems = Object.entries(items)
            .filter(([_, e]) => e.opening > 0 || e.totalIn > 0 || e.totalOut > 0 || e.closing > 0)
            .sort((a, b) => (a[1].itemInfo.name || '').localeCompare(b[1].itemInfo.name || ''));

        tableSection.innerHTML = `
            <div class="card">
                <h4 style="margin:0 0 8px">التفاصيل (${sortedItems.length} مادة فعَّالة)</h4>
                <div style="overflow-x:auto;max-height:600px">
                    <table style="width:100%;font-size:0.74rem;border-collapse:collapse">
                        <thead style="background:var(--surface2);position:sticky;top:0">
                            <tr>
                                <th style="padding:6px;text-align:right">الرمز</th>
                                <th style="padding:6px;text-align:right">الاسم</th>
                                <th style="padding:6px;text-align:left">افتتاحي</th>
                                <th style="padding:6px;text-align:left">وارد</th>
                                <th style="padding:6px;text-align:left">صادر</th>
                                <th style="padding:6px;text-align:left">هدر</th>
                                <th style="padding:6px;text-align:left">ختامي</th>
                                <th style="padding:6px;text-align:center">✓</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${sortedItems.map(([id, e]) => `
                                <tr style="border-bottom:1px solid var(--border);${!e.balanced ? 'background:rgba(248,113,113,0.05)' : ''}">
                                    <td style="padding:4px 6px;font-family:monospace;font-size:0.7rem">${escapeHtml(e.itemInfo.code || '—')}</td>
                                    <td style="padding:4px 6px">${escapeHtml(e.itemInfo.name || id)}</td>
                                    <td style="padding:4px 6px;text-align:left;font-family:monospace;color:var(--text2)">${fmtNum(e.opening)}</td>
                                    <td style="padding:4px 6px;text-align:left;font-family:monospace;color:#4ade80">${e.totalIn > 0 ? '+' + fmtNum(e.totalIn) : '0'}</td>
                                    <td style="padding:4px 6px;text-align:left;font-family:monospace;color:#fb923c">${e.outByCategory['صرف'] > 0 ? '-' + fmtNum(e.outByCategory['صرف']) : '0'}</td>
                                    <td style="padding:4px 6px;text-align:left;font-family:monospace;color:#f87171">${e.outByCategory['هدر'] > 0 ? '-' + fmtNum(e.outByCategory['هدر']) : '0'}</td>
                                    <td style="padding:4px 6px;text-align:left;font-family:monospace;font-weight:bold;color:var(--primary)">${fmtNum(e.closing)}</td>
                                    <td style="padding:4px 6px;text-align:center">${e.balanced ? '<span style="color:#4ade80">✓</span>' : `<span style="color:#f87171" title="فرق ${e.discrepancy}">⚠️</span>`}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    /**
     * تصدير Excel بصيغة الوزارة - ورقتان
     */
    async _exportExcel() {
        if (!this._state.data) {
            showToast('لا توجد بيانات للتصدير', 'warning');
            return;
        }

        if (typeof XLSX === 'undefined') {
            showToast('مكتبة Excel غير محملة', 'error');
            return;
        }

        const { items, totals } = this._state.data;
        const deptName = DEPT_NAMES[this._state.dept] || this._state.dept;

        const periodLabel = this._state.period === 'monthly'
            ? `${this._state.month + 1}/${this._state.year}`
            : `${this._state.year}`;

        // ===== الورقة 1: الملخص =====
        const summarySheet = [
            ['التقرير', 'الميزان الدوري'],
            ['المستشفى', 'مستشفى الشطرة العام'],
            ['القسم', deptName],
            ['الفترة', periodLabel],
            ['تاريخ التقرير', new Date().toLocaleDateString('en-GB', {
                calendar: 'gregory',
                numberingSystem: 'latn',
                timeZone: 'Asia/Baghdad'
            })],
            [''],
            ['عدد المواد', totals.itemCount],
            ['متوازنة', totals.balancedCount],
            ['غير متوازنة', totals.unbalancedCount],
            [''],
            ['البيان', 'الكمية'],
            ['الرصيد الافتتاحي', totals.totalOpening],
            ['وارد - تجهيز دائرة', totals.inBySource['تجهيز دائرة'] || 0],
            ['وارد - مشتريات', totals.inBySource['مشتريات'] || 0],
            ['وارد - افتتاحي', totals.inBySource['افتتاحي'] || 0],
            ['وارد - إرجاع', totals.inBySource['إرجاع'] || 0],
            ['إجمالي الوارد', totals.totalIn],
            ['صادر - صرف', totals.outByCategory['صرف'] || 0],
            ['صادر - هدر', totals.outByCategory['هدر'] || 0],
            ['صادر - إرجاع منتهي', totals.outByCategory['إرجاع منتهي'] || 0],
            ['إجمالي الصادر', totals.totalOut],
            ['الرصيد الختامي', totals.totalClosing]
        ];

        // ===== الورقة 2: التفاصيل =====
        const detailsHeader = [
            'ت', 'الرمز الوطني', 'اسم المادة', 'الوحدة',
            'الرصيد الافتتاحي',
            'وارد - تجهيز دائرة',
            'وارد - مشتريات',
            'وارد - افتتاحي',
            'وارد - إرجاع',
            'إجمالي الوارد',
            'صادر - صرف',
            'صادر - هدر',
            'صادر - إرجاع منتهي',
            'إجمالي الصادر',
            'الرصيد الختامي المحسوب',
            'الرصيد الختامي الفعلي',
            'الفرق',
            'ملاحظات'
        ];

        const detailsRows = Object.entries(items)
            .filter(([_, e]) => e.opening > 0 || e.totalIn > 0 || e.totalOut > 0 || e.closing > 0)
            .sort((a, b) => (a[1].itemInfo.name || '').localeCompare(b[1].itemInfo.name || ''))
            .map(([id, e], i) => [
                i + 1,
                e.itemInfo.code || '',
                e.itemInfo.name || id,
                e.itemInfo.unit || '',
                e.opening,
                e.inBySource['تجهيز دائرة'] || 0,
                e.inBySource['مشتريات'] || 0,
                e.inBySource['افتتاحي'] || 0,
                e.inBySource['إرجاع'] || 0,
                e.totalIn,
                e.outByCategory['صرف'] || 0,
                e.outByCategory['هدر'] || 0,
                e.outByCategory['إرجاع منتهي'] || 0,
                e.totalOut,
                e.closing,
                e.actualClosing,
                e.discrepancy,
                e.balanced ? '' : 'يحتاج مراجعة'
            ]);

        // إنشاء الـ workbook
        const wb = XLSX.utils.book_new();
        const ws1 = XLSX.utils.aoa_to_sheet(summarySheet);
        const ws2 = XLSX.utils.aoa_to_sheet([detailsHeader, ...detailsRows]);

        // تنسيق RTL
        ws1['!cols'] = [{ wch: 30 }, { wch: 20 }];
        ws2['!cols'] = detailsHeader.map(() => ({ wch: 15 }));

        XLSX.utils.book_append_sheet(wb, ws1, 'الملخص');
        XLSX.utils.book_append_sheet(wb, ws2, 'التفاصيل');

        const fileName = `ميزان_${deptName}_${periodLabel.replace('/', '-')}.xlsx`;
        XLSX.writeFile(wb, fileName);

        showToast('✓ تم تصدير الملف', 'success');
    }
};

window.PeriodicBalance = PeriodicBalance;

})();
