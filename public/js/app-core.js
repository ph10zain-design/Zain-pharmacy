// ============================================================
// js/app-core.js — App methods الأساسية
// ============================================================

Object.assign(App, {
    async confirmAction(message) {
        return new Promise(resolve => {
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.innerHTML = `<div class="modal-content" style="text-align:center"><h3>⚠️ تأكيد</h3><p>${escapeHtml(message)}</p><div style="display:flex;gap:10px;justify-content:center;margin-top:1rem"><button class="btn btn-danger" id="confirm-yes">نعم، متأكد</button><button class="btn" id="confirm-no">إلغاء</button></div></div>`;
            document.body.appendChild(modal);
            document.getElementById('confirm-yes').onclick = () => { modal.remove(); resolve(true); };
            document.getElementById('confirm-no').onclick = () => { modal.remove(); resolve(false); };
        });
    },

    async loadSettings() {
        try {
            const doc = await db.collection('settings').doc('general').get();
            if (doc.exists) {
                const s = doc.data();
                if (s.alertDays) SETTINGS.alertDays = s.alertDays;
                if (s.slowMovingDays) SETTINGS.slowMovingDays = s.slowMovingDays;
                // v7.1: تم حذف needsWeights و leadTimeByPriority و seasonalityThreshold
                //       (تبسيط حساب الاحتياج → كمية الرفع = المصروف للأقسام لسنة كاملة)
            }
        } catch (e) { console.warn('تعذّر تحميل الإعدادات:', e); }
    },

    destroyCharts() {
        // 🔧 v6.8.1: pattern مرن - نجد كل canvas في DOM فيه Chart مرتبط
        // لا حاجة للقائمة الثابتة (تنسى عند إضافة chart جديد → memory leak)
        document.querySelectorAll('canvas').forEach(canvas => {
            try {
                const chart = Chart.getChart(canvas);
                if (chart) chart.destroy();
            } catch (e) { /* ignore */ }
        });
        // تدمير charts خاصة بـ feature modules
        if (this._yoyChart)  { this._yoyChart.destroy();  this._yoyChart = null; }
        if (PharmacyAI?._dashCharts) { 
            Object.values(PharmacyAI._dashCharts).forEach(c => { try { c?.destroy?.(); } catch(e){} }); 
            PharmacyAI._dashCharts = {}; 
        }
        PharmacyAI && (PharmacyAI._dashboardLoaded = false);
    },

    switchSection(section) {
        const mainContent = document.getElementById('main-content');

        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        const btn = document.querySelector(`[data-section="${section}"]`);
        if (btn) btn.classList.add('active');
        const titles = { dashboard: '📊 الرئيسية', inventory: '📦 المخزون', cards: '🃏 البطاقات', reports: '📋 التقارير', needs: '📈 تقدير الحاجة', settings: '⚙️ الإعدادات', ai: '🤖 AI', notifications: '🔔 الإشعارات' };
        document.getElementById('section-title').textContent = titles[section] || section;
        this.destroyCharts();

        const finish = () => {};

        if (section === 'dashboard') { this.renderDashboardPage(); finish(); }
        else if (section === 'reports') { this.renderReportsPage(); finish(); }
        else if (section === 'inventory') {
            if (!AppState.loaded || AppState.dept !== CURRENT_DEPT) {
                loadInventoryForDept(CURRENT_DEPT).then(() => { this.renderInventoryPage(); finish(); });
            } else { this.renderInventoryPage(); finish(); }
        } else if (section === 'cards') {
            // 🆕 v7.3: صفحة البطاقات
            if (!AppState.loaded || AppState.dept !== CURRENT_DEPT) {
                loadInventoryForDept(CURRENT_DEPT).then(() => { StockCardView?.renderPage?.(); finish(); });
            } else { StockCardView?.renderPage?.(); finish(); }
        } else if (section === 'needs') { this.renderNeedsPage(); finish(); }
        else if (section === 'ai') {
            PharmacyAI.renderPage();
            finish();
        }
        else if (section === 'settings') { this.renderSettingsPage(); finish(); }
        else if (section === 'notifications') { this.renderNotificationsPage(); finish(); }

        // Promise للوافقة مع await
        return Promise.resolve();
    },
});
