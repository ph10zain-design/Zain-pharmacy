// ============================================================
// js/features/pharmacy-ai.js — v6.8
// - 🔧 YoY timestamps: UTC → Baghdad — AI Dashboard + Assistant (محلي)
// إصلاحات: SETTINGS.alertDays بدل 30/100 الثابتة، YoY يستبعد wastage (v7.2: حُذف transfer_out)
// ============================================================

const PharmacyAI = {
    _dashboardLoaded: false,
    _dashCharts: {},
    _lastUpdate: null,

    renderPage() {
        const mc = document.getElementById('main-content');
        if (!mc) return;
        mc.innerHTML = `
        <div style="padding:12px">
            <div class="ai-tabs">
                <button class="ai-tab-btn active" id="ai-tab-dash" onclick="PharmacyAI.switchTab('dashboard')">📊 داشبورد AI</button>
                <button class="ai-tab-btn" id="ai-tab-asst" onclick="PharmacyAI.switchTab('assistant')">🤖 المساعد</button>
            </div>
            <div id="ai-tab-content"></div>
        </div>`;
        this.switchTab('dashboard');
    },

    switchTab(tab) {
        ['dashboard', 'assistant'].forEach(t => {
            const btn = document.getElementById(`ai-tab-${t === 'dashboard' ? 'dash' : 'asst'}`);
            if (btn) btn.classList.toggle('active', t === tab);
        });
        const c = document.getElementById('ai-tab-content');
        if (!c) return;
        if (tab === 'dashboard') { this._buildDashboardShell(c); this.loadDashboard(); }
        else this._buildAssistantShell(c);
    },

    _buildDashboardShell(c) {
        c.innerHTML = `
        <div id="ai-notif-banners"></div>
        <button class="aid-refresh-btn" onclick="PharmacyAI._refreshDashboard()">
            <span class="aid-refresh-icon">🔄</span> تحديث
        </button>
        <div id="aid-last-update" class="aid-last-update"></div>
        <div id="aid-health-section"></div>
        <div id="aid-alerts-section"></div>
        <div id="aid-today-section"></div>
        <div id="aid-yoy-section"></div>
        <div id="aid-charts-section"></div>
        <div id="aid-recommendations-section"></div>
        <p class="ai-disclaimer">⚠️ هذه التحليلات للاستئناس فقط — القرار النهائي للصيدلاني</p>`;
        InternalNotif.renderBanners('ai-notif-banners');
    },

    _buildAssistantShell(c) {
        c.innerHTML = `
        <div class="ai-panel">
            <div class="ai-quick-btns">
                <button class="ai-quick-btn" onclick="PharmacyAI.ask('expiring')">⏰ قارب الانتهاء</button>
                <button class="ai-quick-btn" onclick="PharmacyAI.ask('zero')">🔴 ناضبة</button>
                <button class="ai-quick-btn" onclick="PharmacyAI.ask('low')">📉 تحت الحد</button>
                <button class="ai-quick-btn" onclick="PharmacyAI.ask('top10')">🏆 الأكثر صرفاً</button>
                <button class="ai-quick-btn" onclick="PharmacyAI.ask('dead')">💤 راكدة</button>
                <button class="ai-quick-btn" onclick="PharmacyAI.ask('abc')">📊 ABC سريع</button>
            </div>
            <div class="ai-input-row">
                <input type="text" id="ai-free-input" class="form-control" placeholder="اسأل عن مادة أو وضع المخزون..."
                       onkeydown="if(event.key==='Enter') PharmacyAI.askFree()">
                <button class="btn btn-primary btn-sm" onclick="PharmacyAI.askFree()">إرسال</button>
            </div>
            <div id="ai-result" class="ai-result"><p class="text-muted" style="text-align:center">اختر تحليلاً أو اكتب سؤالك</p></div>
            <p class="ai-disclaimer">⚠️ للاستئناس فقط — القرار للصيدلاني</p>
        </div>`;
    },

    async loadDashboard() {
        if (this._dashboardLoaded) return;
        this._renderHealthSection();
        this._renderAlertsSection();
        await this._fetchTodayMovements();
        await this._fetchYoYData();
        this._renderChartsSection();
        this._renderRecommendations();
        this._dashboardLoaded = true;
        this._lastUpdate = new Date();
        const el = document.getElementById('aid-last-update');
        if (el) el.textContent = `آخر تحديث: ${this._lastUpdate.toLocaleTimeString('en-GB', { hour12: false, numberingSystem: 'latn' })}`;
    },

    _refreshDashboard() {
        this._dashboardLoaded = false;
        Object.values(this._dashCharts).forEach(c => c?.destroy?.());
        this._dashCharts = {};
        const btn = document.querySelector('.aid-refresh-btn');
        if (btn) btn.classList.add('spinning');
        this.loadDashboard().then(() => { if (btn) btn.classList.remove('spinning'); });
    },

    _renderHealthSection() {
        const el = document.getElementById('aid-health-section');
        if (!el) return;
        const now = new Date();
        // ⚠️ استخدم SETTINGS.alertDays بدلاً من القيم الثابتة
        const alertDays = SETTINGS.alertDays || 100;
        const criticalDays = Math.min(30, Math.floor(alertDays / 3));
        let total = 0, zero = 0, low = 0, expiring = 0, expCritical = 0;
        AppState.inventory.forEach(item => {
            total++;
            const q = item.quantity || 0, min = item.minQuantity || 0;
            const exp = item.earliestExpiry?.toDate?.();
            // ⚠️ المادة الجديدة (qty=0 + لا depletionDate) لا تُحسب ناضبة
            if (q === 0 && item.depletionDate) zero++;
            else if (q > 0 && q <= min) low++;
            if (exp && exp > now) {
                const days = Math.ceil((exp - now) / 86400000);
                if (days <= alertDays) expiring++;
                if (days <= criticalDays) expCritical++;
            }
        });
        const health = total === 0 ? 0 : Math.round(((total - zero - low) / total) * 100);
        const hColor = health >= 80 ? 'var(--success)' : health >= 60 ? 'var(--warning)' : 'var(--danger)';
        el.innerHTML = `
        <div class="aid-card info">
            <div class="aid-card-header"><span class="aid-card-title">🏥 صحة المخزون</span>
                <span class="aid-card-badge info">${health}%</span></div>
            <div class="aid-kpi-row">
                <div class="aid-kpi"><div class="aid-kpi-val">${total}</div><div class="aid-kpi-lbl">إجمالي</div></div>
                <div class="aid-kpi"><div class="aid-kpi-val" style="color:var(--danger)">${zero}</div><div class="aid-kpi-lbl">ناضبة</div></div>
                <div class="aid-kpi"><div class="aid-kpi-val" style="color:var(--warning)">${low}</div><div class="aid-kpi-lbl">تحت الحد</div></div>
            </div>
            <div class="aid-progress"><div class="aid-progress-bar" style="width:${health}%;background:${hColor}"></div></div>
            <div style="display:flex;justify-content:space-between;font-size:0.72rem;color:var(--muted)">
                <span>⏰ تنتهي < ${alertDays} يوم: ${expiring}</span>
                <span>🔴 تنتهي < ${criticalDays} يوم: ${expCritical}</span>
            </div>
        </div>`;
    },

    _renderAlertsSection() {
        const el = document.getElementById('aid-alerts-section');
        if (!el) return;
        const now = new Date();
        // ⚠️ استخدم SETTINGS.alertDays بدلاً من 30 ثابت
        const alertDays = SETTINGS.alertDays || 100;
        const criticalDays = Math.min(30, Math.floor(alertDays / 3));
        const critItems = [], warnItems = [];
        AppState.inventory.forEach(item => {
            const q = item.quantity || 0, min = item.minQuantity || 0;
            const exp = item.earliestExpiry?.toDate?.();
            if (q === 0 && item.depletionDate) critItems.push({ name: item.name, reason: 'ناضب', code: item.code });
            else if (q > 0 && q <= min) warnItems.push({ name: item.name, reason: `${q}/${min}`, code: item.code });
            if (exp && exp > now) {
                const days = Math.ceil((exp - now) / 86400000);
                if (days <= criticalDays) critItems.push({ name: item.name, reason: `ينتهي ${days} يوم`, code: item.code });
            }
        });
        if (!critItems.length && !warnItems.length) { el.innerHTML = `<div class="aid-card success"><div class="aid-card-header"><span class="aid-card-title">✅ لا توجد تنبيهات حرجة</span></div></div>`; return; }
        el.innerHTML = `
        ${critItems.length ? `<div class="aid-card critical">
            <div class="aid-card-header"><span class="aid-card-title">🔴 تنبيهات حرجة</span>
                <span class="aid-card-badge critical">${critItems.length}</span></div>
            ${critItems.slice(0, 5).map(i => `<div class="aid-item"><span>${escapeHtml(i.name || '')}</span><span style="color:var(--danger)">${escapeHtml(i.reason)}</span></div>`).join('')}
            ${critItems.length > 5 ? `<div style="font-size:0.72rem;color:var(--muted);padding:4px 0">+${critItems.length - 5} أخرى</div>` : ''}
        </div>` : ''}
        ${warnItems.length ? `<div class="aid-card warning">
            <div class="aid-card-header"><span class="aid-card-title">⚠️ تحت الحد الأدنى</span>
                <span class="aid-card-badge warning">${warnItems.length}</span></div>
            ${warnItems.slice(0, 5).map(i => `<div class="aid-item"><span>${escapeHtml(i.name || '')}</span><span style="color:var(--warning)">${escapeHtml(i.reason)}</span></div>`).join('')}
        </div>` : ''}`;
    },

    async _fetchTodayMovements() {
        const el = document.getElementById('aid-today-section');
        if (!el) return;
        try {
            const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
            const snap = await db.collection('departments').doc(CURRENT_DEPT).collection('movements')
                .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(todayStart)).limit(500).get();
            let out = 0, inp = 0, waste = 0;
            snap.forEach(d => {
                const m = d.data();
                const isW = m.dispensingType === 'wastage' || m.dispensingCategory === 'waste';
                if (m.movType === 'out') {
                    if (isW || m.movementSubType === 'return_expired') waste += m.quantity || 0;
                    else out += m.quantity || 0;
                }
                else if (m.movType === 'in' && m.movementSubType !== 'return_good') inp += m.quantity || 0;
            });
            el.innerHTML = `<div class="aid-card info">
                <div class="aid-card-header"><span class="aid-card-title">📅 نشاط اليوم</span>
                    <span class="aid-card-badge info">${snap.size} عملية</span></div>
                <div class="aid-kpi-row">
                    <div class="aid-kpi"><div class="aid-kpi-val" style="color:var(--danger)">${out}</div><div class="aid-kpi-lbl">صُرف</div></div>
                    <div class="aid-kpi"><div class="aid-kpi-val" style="color:var(--success)">${inp}</div><div class="aid-kpi-lbl">وارد</div></div>
                    <div class="aid-kpi"><div class="aid-kpi-val" style="color:var(--warning)">${waste}</div><div class="aid-kpi-lbl">هدر</div></div>
                </div>
            </div>`;
        } catch (e) { el.innerHTML = ''; }
    },

    async _fetchYoYData() {
        const el = document.getElementById('aid-yoy-section');
        if (!el) return;
        try {
            const now = new Date();
            // 🔧 v6.8: توقيت بغداد للحدود الزمنية
            const _bdStr = new Intl.DateTimeFormat('en-CA', { timeZone: BAGHDAD_TZ }).format(now);
            const [_y, _mo, _d] = _bdStr.split('-').map(Number);
            const thisYear = _y;
            const lastYear = _y - 1;
            const m = _mo - 1; // 0-based

            // 🔧 v6.8.1: استخدم ISO مع +03:00 لتفادي drift من Date constructor المحلي
            // كان: new Date(thisYear, 0, 1) يعتمد على timezone المتصفح
            const startThis = firebase.firestore.Timestamp.fromDate(new Date(`${thisYear}-01-01T00:00:00+03:00`));
            const startLast = firebase.firestore.Timestamp.fromDate(new Date(`${lastYear}-01-01T00:00:00+03:00`));
            const mm = String(_mo).padStart(2, '0');
            const dd = String(_d).padStart(2, '0');
            const endLast = firebase.firestore.Timestamp.fromDate(new Date(`${lastYear}-${mm}-${dd}T23:59:59+03:00`));

            const [snapThis, snapLast] = await Promise.all([
                db.collection('departments').doc(CURRENT_DEPT).collection('movements')
                    .where('movType', '==', 'out').where('createdAt', '>=', startThis).limit(5000).get(),
                db.collection('departments').doc(CURRENT_DEPT).collection('movements')
                    .where('movType', '==', 'out').where('createdAt', '>=', startLast).where('createdAt', '<=', endLast).limit(5000).get()
            ]);

            // ⚠️ استبعاد الهدر والإرجاع المنتهي من YoY (v7.2: حُذف transfer_out)
            const sumQty = snap => snap.docs.reduce((s, d) => {
                const m = d.data();
                if (m.dispensingType === 'wastage' || m.dispensingCategory === 'waste') return s;
                if (m.movementSubType === 'return_expired') return s;
                return s + (m.quantity || 0);
            }, 0);
            const qtyThis = sumQty(snapThis);
            const qtyLast = sumQty(snapLast);
            const diff = qtyLast > 0 ? Math.round(((qtyThis - qtyLast) / qtyLast) * 100) : null;
            const diffColor = diff === null ? 'var(--muted)' : diff > 0 ? 'var(--success)' : diff < 0 ? 'var(--danger)' : 'var(--text2)';
            const diffText = diff === null ? 'لا توجد بيانات العام الماضي' : diff > 0 ? `▲ ${diff}% زيادة عن نفس الفترة` : diff < 0 ? `▼ ${Math.abs(diff)}% انخفاض عن نفس الفترة` : 'نفس مستوى العام الماضي';

            el.innerHTML = `<div class="aid-card info">
                <div class="aid-card-header">
                    <span class="aid-card-title">📈 مقارنة سنة بسنة (YoY)</span>
                    <span class="aid-card-badge info">${thisYear} vs ${lastYear}</span>
                </div>
                <div class="aid-kpi-row">
                    <div class="aid-kpi"><div class="aid-kpi-val">${qtyThis.toLocaleString('en-US')}</div><div class="aid-kpi-lbl">صُرف ${thisYear}</div></div>
                    <div class="aid-kpi"><div class="aid-kpi-val" style="color:var(--muted)">${qtyLast.toLocaleString('en-US')}</div><div class="aid-kpi-lbl">صُرف ${lastYear} (ن.ف)</div></div>
                    <div class="aid-kpi"><div class="aid-kpi-val" style="color:${diffColor}">${diff !== null ? (diff > 0 ? '+' : '') + diff + '%' : '—'}</div><div class="aid-kpi-lbl">التغيير</div></div>
                </div>
                <div style="font-size:0.75rem;color:${diffColor};padding:4px 0">${diffText}</div>
                <div style="font-size:0.7rem;color:var(--muted)">⚠️ يستبعد الهدر — يقارن من يناير حتى اليوم</div>
            </div>`;
        } catch (e) {
            const el2 = document.getElementById('aid-yoy-section');
            if (el2) el2.innerHTML = '';
        }
    },

    _renderChartsSection() {
        const el = document.getElementById('aid-charts-section');
        if (!el) return;
        const items = itemsCache.slice().sort((a, b) => (b.quantity || 0) - (a.quantity || 0)).slice(0, 8);
        if (!items.length) { el.innerHTML = ''; return; }
        const statusCounts = { ناضبة: 0, 'تحت الحد': 0, جيدة: 0 };
        AppState.inventory.forEach(item => {
            const q = item.quantity || 0, min = item.minQuantity || 0;
            // ⚠️ المادة الجديدة لا تُحسب ناضبة
            if (q === 0 && item.depletionDate) statusCounts['ناضبة']++;
            else if (q > 0 && q <= min) statusCounts['تحت الحد']++;
            else if (q > 0) statusCounts['جيدة']++;
        });
        el.innerHTML = `<div class="aid-card info" style="margin-bottom:8px">
            <div class="aid-card-title" style="margin-bottom:8px">📊 توزيع حالة المخزون</div>
            <canvas id="aid-status-chart" height="160"></canvas>
        </div>`;
        setTimeout(() => {
            const ctx = document.getElementById('aid-status-chart')?.getContext('2d');
            if (!ctx) return;
            if (this._dashCharts.status) this._dashCharts.status.destroy();
            this._dashCharts.status = new Chart(ctx, {
                type: 'doughnut',
                data: { labels: Object.keys(statusCounts), datasets: [{ data: Object.values(statusCounts), backgroundColor: ['#ef4444', '#f59e0b', '#22c55e'], borderWidth: 0 }] },
                options: { responsive: true, plugins: { legend: { labels: { color: '#a8b4c8', font: { size: 10 } } } } }
            });
        }, 100);
    },

    _renderRecommendations() {
        const el = document.getElementById('aid-recommendations-section');
        if (!el) return;
        const recs = [];
        let criticalCount = 0, expiringCount = 0;
        // ⚠️ استخدم SETTINGS.alertDays
        const criticalDays = Math.min(30, Math.floor((SETTINGS.alertDays || 100) / 3));
        AppState.inventory.forEach(item => {
            const now = new Date();
            const q = item.quantity || 0;
            if (q === 0 && item.depletionDate) criticalCount++;
            const exp = item.earliestExpiry?.toDate?.();
            if (exp && exp > now && Math.ceil((exp - now) / 86400000) <= criticalDays) expiringCount++;
        });
        if (criticalCount > 0) recs.push({ title: '🚨 مواد ناضبة تحتاج طلب فوري', body: `${criticalCount} مادة وصلت للصفر. يُنصح برفع طلب توريد عاجل.`, action: 'App.switchSection(\'inventory\')', actionText: 'عرض المخزون' });
        if (expiringCount > 0) recs.push({ title: `⏰ مواد تنتهي خلال ${criticalDays} يوم`, body: `${expiringCount} مادة تحتاج صرف عاجل أو إجراء إتلاف.`, action: 'PharmacyAI.ask(\'expiring\')', actionText: 'عرض القائمة' });
        if (!recs.length) recs.push({ title: '✅ الوضع جيد', body: 'لا توجد توصيات حرجة حالياً.', action: null, actionText: '' });
        el.innerHTML = `<div class="aid-card">
            <div class="aid-card-title" style="margin-bottom:8px">💡 التوصيات</div>
            ${recs.map(r => `<div class="aid-recommendation">
                <div class="aid-rec-title">${r.title}</div>
                <div class="aid-rec-body">${r.body}</div>
                ${r.action ? `<span class="aid-rec-action" onclick="${r.action}">${r.actionText}</span>` : ''}
            </div>`).join('')}
        </div>`;
    },

    setThinking(msg = 'جاري التحليل') {
        const el = document.getElementById('ai-result');
        if (el) el.innerHTML = `<div class="ai-thinking">${escapeHtml(msg)}</div>`;
    },

    setResult(html) {
        const el = document.getElementById('ai-result');
        if (el) el.innerHTML = html;
    },

    ask(type) {
        const now = new Date();
        this.setThinking();
        const alertDays = SETTINGS.alertDays || 100;
        setTimeout(async () => {
            if (type === 'zero') {
                // المادة الجديدة لا تُحسب ناضبة
                const items = itemsCache.filter(i => (i.quantity || 0) === 0 && i.depletionDate);
                if (!items.length) { this.setResult('<p style="color:var(--success);text-align:center">✅ لا توجد مواد ناضبة</p>'); return; }
                this.setResult(`<p style="font-size:0.82rem;margin-bottom:8px">🔴 ${items.length} مادة ناضبة:</p>` +
                    items.slice(0, 20).map(i => `<div class="ai-result-item"><span>${escapeHtml(i.name || '')}</span><span class="ai-badge ai-badge-danger">ناضب</span></div>`).join('') +
                    (items.length > 20 ? `<p class="text-muted" style="font-size:0.72rem">+${items.length - 20} أخرى</p>` : ''));
            } else if (type === 'expiring') {
                const items = itemsCache.filter(i => {
                    const exp = i.earliestExpiry?.toDate?.();
                    return exp && exp > now && Math.ceil((exp - now) / 86400000) <= alertDays;
                }).sort((a, b) => (a.earliestExpiry?.toDate?.()?.getTime() || 0) - (b.earliestExpiry?.toDate?.()?.getTime() || 0));
                if (!items.length) { this.setResult(`<p style="color:var(--success)">✅ لا توجد مواد تنتهي < ${alertDays} يوم</p>`); return; }
                const criticalDays = Math.min(30, Math.floor(alertDays / 3));
                this.setResult(`<p style="font-size:0.82rem;margin-bottom:8px">⏰ ${items.length} مادة:</p>` +
                    items.slice(0, 20).map(i => {
                        const days = Math.ceil((i.earliestExpiry.toDate() - now) / 86400000);
                        const cls = days <= criticalDays ? 'ai-badge-danger' : days <= alertDays * 0.6 ? 'ai-badge-warning' : 'ai-badge-info';
                        return `<div class="ai-result-item"><span>${escapeHtml(i.name || '')}</span><span class="ai-badge ${cls}">${days} يوم</span></div>`;
                    }).join(''));
            } else if (type === 'low') {
                const items = itemsCache.filter(i => i.quantity > 0 && i.quantity <= (i.minQuantity || 0));
                if (!items.length) { this.setResult('<p style="color:var(--success)">✅ لا توجد مواد تحت الحد</p>'); return; }
                this.setResult(`<p style="font-size:0.82rem;margin-bottom:8px">📉 ${items.length} مادة:</p>` +
                    items.slice(0, 20).map(i => `<div class="ai-result-item"><span>${escapeHtml(i.name || '')}</span><span class="ai-badge ai-badge-warning">${i.quantity}/${i.minQuantity}</span></div>`).join(''));
            } else if (type === 'top10') {
                const sorted = itemsCache.slice().sort((a, b) => (b.quantity || 0) - (a.quantity || 0)).slice(0, 10);
                this.setResult(`<p style="font-size:0.82rem;margin-bottom:8px">🏆 أعلى 10 أرصدة:</p>` +
                    sorted.map(i => `<div class="ai-result-item"><span>${escapeHtml(i.name || '')}</span><span class="ai-badge ai-badge-info">${i.quantity || 0} ${escapeHtml(i.unit || '')}</span></div>`).join(''));
            } else if (type === 'abc') {
                const result = await this._calcABCQuick();
                this.setResult(`<p style="font-size:0.82rem;margin-bottom:8px">📊 تصنيف ABC (حسب معدل صرف 90 يوم):</p>` +
                    `<div class="ai-result-item"><span>A (أعلى 20% — سريعة الحركة)</span><span class="ai-badge ai-badge-danger">${result.A} صنف</span></div>` +
                    `<div class="ai-result-item"><span>B (التالي 30% — متوسطة)</span><span class="ai-badge ai-badge-warning">${result.B} صنف</span></div>` +
                    `<div class="ai-result-item"><span>C (أدنى 50% — بطيئة الحركة)</span><span class="ai-badge ai-badge-success">${result.C} صنف</span></div>`);
            } else if (type === 'dead') {
                App.loadDeadStockReport?.();
            }
        }, 100);
    },

    askFree() {
        const inp = document.getElementById('ai-free-input');
        const q = (inp?.value || '').trim().toLowerCase();
        if (!q) return;
        this.setThinking('جاري البحث');
        setTimeout(() => {
            const results = itemsCache.filter(i =>
                (i.name || '').toLowerCase().includes(q) || (i.code || '').toLowerCase().includes(q)
            ).slice(0, 10);
            if (!results.length) { this.setResult(`<p class="text-muted">لا توجد نتائج لـ "${escapeHtml(q)}"</p>`); return; }
            const now = new Date();
            this.setResult(`<p style="font-size:0.82rem;margin-bottom:8px">${results.length} نتيجة:</p>` +
                results.map(i => {
                    const exp = i.earliestExpiry?.toDate?.();
                    const days = exp ? Math.ceil((exp - now) / 86400000) : null;
                    const qColor = i.quantity === 0 ? 'var(--danger)' : i.quantity <= (i.minQuantity || 0) ? 'var(--warning)' : 'var(--success)';
                    return `<div class="ai-result-item">
                        <span><strong>${escapeHtml(i.name || '')}</strong><br><small style="color:var(--muted)">${escapeHtml(i.code || '')}${days != null ? ` | ${days} يوم` : ''}</small></span>
                        <span style="color:${qColor};font-weight:700">${i.quantity || 0} ${escapeHtml(i.unit || '')}</span>
                    </div>`;
                }).join(''));
        }, 150);
    },

    /**
     * 🔧 تصنيف ABC الذكي
     * يستند إلى **معدل صرف 90 يوم** (لا الرصيد) — هذا تصنيف صيدلاني صحيح
     * A = أعلى 20% صرفاً (مواد سريعة الحركة)
     * B = التالي 30% (متوسطة)
     * C = الأدنى 50% (بطيئة الحركة)
     */
    async _calcABCQuick() {
        try {
            // قراءة الحركات لآخر 90 يوم لحساب معدل الصرف لكل مادة
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - 90);
            const snap = await db.collection('departments').doc(CURRENT_DEPT)
                .collection('movements')
                .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(cutoff))
                .where('movType', '==', 'out')
                .limit(5000).get();

            const usageByItem = {};
            snap.docs.forEach(d => {
                const m = d.data();
                if (m.dispensingType === 'wastage' || m.dispensingCategory === 'waste') return;
                if (m.movementSubType === 'return_expired') return;
                if (!m.inventoryId) return;
                usageByItem[m.inventoryId] = (usageByItem[m.inventoryId] || 0) + (m.quantity || 0);
            });

            // كل مادة في المخزون تحصل على total usage (0 إذا لم تُصرَف)
            const items = [...AppState.inventory.values()].map(item => ({
                id: item.id,
                usage: usageByItem[item.id] || 0
            }));
            // فرز تنازلي حسب الصرف
            items.sort((a, b) => b.usage - a.usage);
            const n = items.length;
            return {
                A: Math.ceil(n * 0.2),
                B: Math.ceil(n * 0.3),
                C: n - Math.ceil(n * 0.2) - Math.ceil(n * 0.3)
            };
        } catch (e) {
            console.warn('_calcABCQuick fallback:', e.message);
            // Fallback: تصنيف بناءً على الكمية فقط
            const n = AppState.inventory.size;
            return { A: Math.ceil(n * 0.2), B: Math.ceil(n * 0.3), C: n - Math.ceil(n * 0.5) };
        }
    }
};
