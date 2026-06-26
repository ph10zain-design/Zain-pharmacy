// ============================================================
// js/dashboard.js — v7.3 (إعادة الهيكلة)
// ============================================================
// التغييرات:
//   - حُذف: تبعيات return_expired و return_good (الإرجاع المحذوف)
//   - أُضيف: تبويبات تقارير جديدة (سجل الحركات الشامل، حالة المخزون، التخطيط، الجهات)
//   - أُضيف: switchReportsTab و switchHomeTab (كانتا في ledger.js المحذوف)
//   - أُضيف: لوحة المؤشرات (TopAlerts) — نظرة سريعة على كل التنبيهات
//
// v6.8.2: month bucketing بـ Baghdad TZ
// ============================================================

Object.assign(App, {
    renderDashboardPage() {
        const dept = CURRENT_DEPT;
        const deptName = DEPT_NAMES[dept] || dept;
        const container = document.getElementById('main-content');
        container.innerHTML = `<div id="internal-banners"></div>
            <div class="kpi-row">
                <div class="kpi-card"><strong>📦 المواد</strong><h2 id="dash-total-items">-</h2></div>
                <div class="kpi-card" style="background:#332a10"><strong>⚠️ قارب النفاد</strong><h2 style="color:var(--warning)" id="dash-low">-</h2></div>
                <div class="kpi-card" style="background:#331a1a"><strong>🔴 نفد</strong><h2 style="color:var(--danger)" id="dash-out">-</h2></div>
                <div class="kpi-card" style="background:#2a1a33"><strong>📤 صُرف هذا الشهر</strong><h2 style="color:#a78bfa" id="dash-dispensed-month">-</h2></div>
                <div class="kpi-card" style="background:#1f3a2a"><strong>📥 وارد هذا الشهر</strong><h2 style="color:var(--success)" id="dash-received-month">-</h2></div>
                <div class="kpi-card" style="background:#3a2010"><strong>♻️ هدر هذا الشهر</strong><h2 style="color:var(--danger)" id="dash-waste-month">-</h2></div>
            </div>
            <div id="dash-top-alerts"></div>
            <div class="card"><h3>📊 ${deptName} — توزيع الكميات</h3><canvas id="dash-chart-quantities" height="180"></canvas></div>
            <div class="card"><h3>📈 الحركة آخر 6 أشهر</h3><canvas id="dash-chart-monthly" height="180"></canvas></div>
            <div class="card"><h3>🏆 أكثر 5 مواد صرفاً (آخر 30 يوم)</h3><canvas id="chart-top5" height="180"></canvas></div>`;

        InternalNotif?.renderBanners?.('internal-banners');
        this.buildDashboardData(dept);
        this.buildTopAlerts(dept);
    },

    _baghdadNow() {
        const s = new Intl.DateTimeFormat('en-CA', { timeZone: BAGHDAD_TZ }).format(new Date());
        const [y, m, d] = s.split('-').map(Number);
        return { year: y, month: m - 1, date: d };
    },

    _baghdadYearMonth(date) {
        if (!date) return null;
        const bdStr = date.toLocaleDateString('en-CA', { timeZone: BAGHDAD_TZ });
        return {
            year: parseInt(bdStr.slice(0, 4), 10),
            month: parseInt(bdStr.slice(5, 7), 10) - 1
        };
    },

    async buildDashboardData(dept) {
        const _bd = this._baghdadNow();
        const thisMonthStart = new Date(_bd.year, _bd.month, 1);
        const sixMonthsAgo = new Date(_bd.year, _bd.month - 5, 1);

        try {
            const [monthSnap, sixMSnap, top30Snap] = await Promise.all([
                db.collection('departments').doc(dept).collection('movements')
                    .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(thisMonthStart))
                    .limit(2000).get(),
                db.collection('departments').doc(dept).collection('movements')
                    .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(sixMonthsAgo))
                    .limit(5000).get(),
                db.collection('departments').doc(dept).collection('movements')
                    .where('movType', '==', 'out')
                    .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(new Date(Date.now() - 30 * 86400000)))
                    .limit(2000).get()
            ]);

            // 🆕 v7.3: حُذف return_expired و return_good من المنطق
            let monthOut = 0, monthIn = 0, monthWaste = 0;
            monthSnap.docs.forEach(d => {
                const m = d.data();
                if (m.movType === 'reverse') return; // تجاهل حركات الإلغاء
                const isWaste = m.movementSubType === 'wastage' || m.dispensingCategory === 'waste';
                if (m.movType === 'out') {
                    if (isWaste) monthWaste += m.quantity || 0;
                    else monthOut += m.quantity || 0;
                }
                if (m.movType === 'in') monthIn += m.quantity || 0;
            });
            document.getElementById('dash-dispensed-month').textContent = fmtNum(monthOut);
            document.getElementById('dash-received-month').textContent = fmtNum(monthIn);
            document.getElementById('dash-waste-month').textContent = fmtNum(monthWaste);

            const items = [...AppState.inventory.values()];
            document.getElementById('dash-total-items').textContent = fmtNum(items.length);
            document.getElementById('dash-out').textContent = fmtNum(items.filter(i => (i.quantity||0)===0 && i.depletionDate).length);
            document.getElementById('dash-low').textContent = fmtNum(items.filter(i => (i.quantity||0)>0 && (i.quantity||0)<=(i.minQuantity||0)).length);

            // مخطط آخر 6 أشهر
            const labels = [];
            const monthlyOut = Array(6).fill(0), monthlyIn = Array(6).fill(0), monthlyWaste = Array(6).fill(0);
            for (let i = 5; i >= 0; i--) {
                const d = new Date(_bd.year, _bd.month - i, 1);
                labels.push(d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short' }));
            }

            const agoYear = sixMonthsAgo.getFullYear();
            const agoMonth = sixMonthsAgo.getMonth();
            sixMSnap.docs.forEach(d => {
                const m = d.data();
                if (m.movType === 'reverse') return;
                const md = m.createdAt?.toDate?.();
                if (!md) return;
                const bd = this._baghdadYearMonth(md);
                if (!bd) return;
                const idx = (bd.year - agoYear) * 12 + (bd.month - agoMonth);
                if (idx < 0 || idx >= 6) return;
                const isWaste = m.movementSubType === 'wastage' || m.dispensingCategory === 'waste';
                if (m.movType === 'out') {
                    if (isWaste) monthlyWaste[idx] += m.quantity || 0;
                    else monthlyOut[idx] += m.quantity || 0;
                }
                if (m.movType === 'in') monthlyIn[idx] += m.quantity || 0;
            });

            new Chart(document.getElementById('dash-chart-monthly'), {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        { label: 'صرف', data: monthlyOut, borderColor: '#22d3ee', backgroundColor: 'rgba(34,211,238,0.1)', tension: 0.3 },
                        { label: 'وارد', data: monthlyIn, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', tension: 0.3 },
                        { label: 'هدر', data: monthlyWaste, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', tension: 0.3 }
                    ]
                },
                options: {
                    responsive: true,
                    plugins: { legend: { labels: { color: '#e1e7f0' } } },
                    scales: { x: { ticks: { color: '#9aa6b8' } }, y: { ticks: { color: '#9aa6b8' } } }
                }
            });

            const sortedItems = [...items].sort((a, b) => (b.quantity || 0) - (a.quantity || 0)).slice(0, 10);
            new Chart(document.getElementById('dash-chart-quantities'), {
                type: 'bar',
                data: {
                    labels: sortedItems.map(i => (i.name || '').slice(0, 20)),
                    datasets: [{ label: 'الكمية', data: sortedItems.map(i => i.quantity || 0), backgroundColor: '#22d3ee' }]
                },
                options: {
                    indexAxis: 'y',
                    plugins: { legend: { display: false } },
                    scales: { x: { ticks: { color: '#9aa6b8' } }, y: { ticks: { color: '#9aa6b8' } } }
                }
            });

            const top5Map = {};
            top30Snap.docs.forEach(d => {
                const m = d.data();
                if (m.movType === 'reverse') return;
                const isWaste = m.movementSubType === 'wastage' || m.dispensingCategory === 'waste';
                if (isWaste) return;
                if (!top5Map[m.inventoryId]) top5Map[m.inventoryId] = { name: m.name || '—', qty: 0 };
                top5Map[m.inventoryId].qty += m.quantity || 0;
            });
            const top5 = Object.values(top5Map).sort((a, b) => b.qty - a.qty).slice(0, 5);
            new Chart(document.getElementById('chart-top5'), {
                type: 'bar',
                data: {
                    labels: top5.map(t => t.name.slice(0, 18)),
                    datasets: [{ label: 'الكمية المصروفة', data: top5.map(t => t.qty), backgroundColor: '#a78bfa' }]
                },
                options: {
                    indexAxis: 'y',
                    plugins: { legend: { display: false } },
                    scales: { x: { ticks: { color: '#9aa6b8' } }, y: { ticks: { color: '#9aa6b8' } } }
                }
            });
        } catch(e) {
            console.error('buildDashboardData:', e);
            showToast('فشل تحميل الداشبورد: ' + handleFirestoreError(e, 'dashboard'), 'error');
        }
    },

    // ============================================================
    // 🆕 v7.4: buildTopAlerts صار wrapper بسيط لـ InternalNotif
    // (التنبيهات الـ 4 السابقة تُحسَب الآن في InternalNotif.compute مع cache)
    // ============================================================
    buildTopAlerts(dept) {
        // فقط نضمن أن banners تظهر — InternalNotif.renderBanners يتولى البقية
        const el = document.getElementById('dash-top-alerts');
        if (!el) return;

        // إن لم يوجد InternalNotif (تطبيق قديم)، فلتر يدوي
        if (typeof InternalNotif === 'undefined' || typeof InternalNotif.compute !== 'function') {
            el.innerHTML = '';
            return;
        }

        const notifs = InternalNotif.compute();
        if (!notifs.length) {
            el.innerHTML = `<div class="card" style="text-align:center;color:var(--success);padding:14px">
                <strong>✅ لا تنبيهات حرجة حالياً</strong>
            </div>`;
            return;
        }

        // عرض كـ شبكة سريعة مع routing مباشر للتقارير
        const colors = {
            danger: 'var(--danger)',
            warning: 'var(--warning)',
            info: 'var(--primary)'
        };

        el.innerHTML = `<div class="card" style="padding:10px 12px">
            <h4 style="margin:0 0 8px;font-size:0.88rem">⚡ تنبيهات سريعة</h4>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px">
                ${notifs.map((n, i) => `<div style="background:var(--surface2);padding:8px;border-radius:var(--radius-sm);border-right:3px solid ${colors[n.level] || 'var(--primary)'};cursor:pointer" data-alert-idx="${i}">
                    <div style="font-size:1.4rem">${n.icon}</div>
                    <div style="font-size:0.7rem;color:var(--muted)">${escapeHtml(n.text.replace(/\d+ مادة /, ''))}</div>
                    <div style="font-size:1.1rem;font-weight:700;color:${colors[n.level] || 'var(--primary)'}">${(n.text.match(/^\d+/) || ['?'])[0]}</div>
                </div>`).join('')}
            </div>
        </div>`;

        // ربط الـ actions
        el.querySelectorAll('[data-alert-idx]').forEach(div => {
            div.onclick = () => {
                const idx = parseInt(div.dataset.alertIdx);
                const action = notifs[idx]?.action;
                if (typeof action === 'function') action();
            };
        });
    },

    // ============================================================
    // 🆕 v7.4: renderReportsPage — تبويبات مجمَّعة في 4 مجموعات + حفظ آخر تبويب
    // ============================================================
    async renderReportsPage() {
        // 🆕 v7.4: مجموعات منطقية بدل 22 تبويب في صف واحد
        const GROUPS = [
            { id: 'overview', label: '📊 نظرة', tabs: [
                { id: 'warehouse',    label: '📊 لوحة المخزن' },
                { id: 'ledger',       label: '📜 سجل الحركات' },
                { id: 'users',        label: '👤 العاملون' },
                { id: 'backdated',    label: '⏰ بأثر رجعي' }
            ]},
            { id: 'flow', label: '🔄 الحركة', tabs: [
                { id: 'purchases',    label: '🛒 المشتريات' },
                { id: 'circle',       label: '📥 تجهيز الدائرة' },
                { id: 'destinations', label: '👥 الجهات' },
                { id: 'turnover',     label: '🔄 الدوران' }
            ]},
            { id: 'alerts', label: '⚠️ تنبيهات', tabs: [
                { id: 'out-of-stock', label: '📭 المفقودة' },
                { id: 'low-stock',    label: '🔻 قريبة النفاذ' },
                { id: 'near-expiry',  label: '⏰ قريبة الانتهاء' },
                { id: 'slow-moving',  label: '🐌 بطيئة الحركة' },
                { id: 'new-no-mov',   label: '🆕 جديدة بلا حركة' },
                { id: 'top-waste',    label: '📉 أعلى هدر' }
            ]},
            { id: 'analysis', label: '🔬 تحليل', tabs: [
                { id: 'days-of-supply', label: '📊 مدى الأمان' },
                { id: 'abc',            label: '🔺 ABC/Pareto' },
                { id: 'gap',            label: '⚖️ الفجوة' },
                { id: 'exceeded',       label: '⚠️ تجاوز الحاجة' },
                { id: 'yoy-compare',    label: '📈 YoY' },
                { id: 'priority-coverage', label: '🎯 توفر الأولوية' },
                { id: 'annual',         label: '📋 السنوية' },
                { id: 'count',          label: '📦 الجرد' },
                { id: 'waste',          label: '📉 الهدر' }
            ]}
        ];

        // استرجاع آخر مجموعة وتبويب من sessionStorage
        let activeGroup, activeTab;
        try {
            activeGroup = sessionStorage.getItem('reports_active_group') || 'overview';
            activeTab = sessionStorage.getItem('reports_active_tab') || 'warehouse';
        } catch {
            activeGroup = 'overview';
            activeTab = 'warehouse';
        }
        // تحقق أن activeTab موجود في activeGroup
        const groupObj = GROUPS.find(g => g.id === activeGroup) || GROUPS[0];
        if (!groupObj.tabs.find(t => t.id === activeTab)) {
            activeTab = groupObj.tabs[0].id;
        }

        const groupBtns = GROUPS.map(g => `
            <button class="tab-btn ${g.id === activeGroup ? 'active' : ''}"
                    data-group="${g.id}" onclick="App._switchReportGroup('${g.id}')">${g.label}</button>
        `).join('');

        document.getElementById('main-content').innerHTML = `
            <div class="card">
                <!-- المجموعات الرئيسية (4 أزرار كبيرة) -->
                <div class="tab-bar" id="reports-groups" style="margin-bottom:6px">${groupBtns}</div>
                <!-- التبويبات الفرعية (تتغير حسب المجموعة) -->
                <div class="tab-bar" id="reports-tabs" style="flex-wrap:wrap;font-size:0.82rem"></div>
                <div id="reports-tab-content" style="margin-top:10px"></div>
            </div>`;

        // حفظ المجموعات في عضو ذاكرة عشان لا نُعيد التعريف
        window.__reportGroups = GROUPS;

        this._switchReportGroup(activeGroup, activeTab);
    },

    /**
     * تبديل مجموعة + عرض تبويبها الافتراضي (أو محدد)
     */
    _switchReportGroup(groupId, specificTab) {
        const GROUPS = window.__reportGroups || [];
        const group = GROUPS.find(g => g.id === groupId);
        if (!group) return;

        // active class للمجموعات
        document.querySelectorAll('#reports-groups .tab-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.group === groupId);
        });

        // التبويبات الفرعية
        const tabId = specificTab || group.tabs[0].id;
        const tabsContainer = document.getElementById('reports-tabs');
        if (tabsContainer) {
            tabsContainer.innerHTML = group.tabs.map(t => `
                <button class="tab-btn ${t.id === tabId ? 'active' : ''}"
                        id="reports-tab-${t.id}"
                        onclick="switchReportsTab('${t.id}')">${t.label}</button>
            `).join('');
        }

        try {
            sessionStorage.setItem('reports_active_group', groupId);
            sessionStorage.setItem('reports_active_tab', tabId);
        } catch {}

        // تحميل التبويب
        if (typeof switchReportsTab === 'function') switchReportsTab(tabId);
    },

    // ============================================================
    // 🆕 v7.3: renderHomePage مع tabs (KPI فقط، حُذف tabs السجل والمشتريات)
    // ============================================================
    async renderHomePage() {
        const container = document.getElementById('main-content');
        if (!container) return;
        container.innerHTML = `<div id="home-content"></div>`;
        document.getElementById('home-content').innerHTML = '<div id="kpi-section"></div>';
        // الصفحة الرئيسية الآن = داشبورد فقط (السجل والمشتريات انتقلا للتقارير)
        return this.renderDashboardPage();
    },

    destroyCharts() {
        // مرجع آمن: في حالة Chart.js مفقود
        if (typeof Chart === 'undefined') return;
        try {
            Object.values(Chart.instances || {}).forEach(c => c.destroy?.());
        } catch (e) { /* ignore */ }
    }
});

// ============================================================
// 🆕 v7.4: switchReportsTab مُعرَّفة فقط في reports-v73.js
// (كان هناك تعريف مكرر هنا — حُذف لمنع التعارض في ترتيب التحميل)
// ============================================================

// ============================================================
// 🆕 v7.3: switchHomeTab المُبسَّط (لا tabs بعد الآن)
// نُبقي على الدالة لأن بعض الكود القديم قد يستدعيها
// ============================================================
window.switchHomeTab = function(tab) {
    // الصفحة الرئيسية الآن = داشبورد فقط
    App.renderDashboardPage?.();
};
