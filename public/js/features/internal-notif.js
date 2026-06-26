// ============================================================
// js/features/internal-notif.js — v7.4
// ============================================================
// إصلاحات v7.4:
//   ✅ _dismissed يحفظ في sessionStorage (لا تعود banners بعد refresh)
//   ✅ memoization: compute() لا تحسب 2500 iteration كل مرة
//   ✅ تكامل مع dashboard.buildTopAlerts (تنسيق موحَّد، لا تكرار)
//   ✅ إعادة الحساب فقط عند تغير AppState
// ============================================================

const InternalNotif = {
    _dismissedKey: 'pharmacy_dismissed_notifs',
    _cacheKey: null,        // مفتاح للتحقق من تغير state
    _cacheResult: null,     // النتيجة المُخزَّنة

    /**
     * استرجاع dismissed من sessionStorage
     */
    _getDismissed() {
        try {
            const raw = sessionStorage.getItem(this._dismissedKey);
            if (!raw) return new Set();
            return new Set(JSON.parse(raw));
        } catch {
            return new Set();
        }
    },

    /**
     * حفظ dismissed في sessionStorage
     */
    _saveDismissed(set) {
        try {
            sessionStorage.setItem(this._dismissedKey, JSON.stringify([...set]));
        } catch (e) {
            console.warn('saveDismissed:', e.message);
        }
    },

    /**
     * حساب التنبيهات — مع memoization
     */
    compute() {
        // مفتاح cache: عدد المخزون + آخر تحديث للـ state
        const items = [...AppState.inventory.values()];
        const cacheKey = `${items.length}:${AppState.lastSync || 0}:${SETTINGS.alertDays || 100}`;

        if (this._cacheKey === cacheKey && this._cacheResult) {
            // إعادة استخدام النتيجة + إعادة فلترة dismissed
            const dismissed = this._getDismissed();
            return this._cacheResult.filter(n => !dismissed.has(n.id));
        }

        const now = new Date();
        const alertDays = SETTINGS.alertDays || 100;
        const slowDays = SETTINGS.slowMovingDays || 30;
        let depleted = 0, expiringSoon = 0, lowStock = 0, slowMoving = 0, newNoMov = 0;

        items.forEach(item => {
            const q = item.quantity || 0;
            const min = item.minQuantity || 0;
            const exp = item.earliestExpiry?.toDate?.();
            const last = item.lastDispenseAt?.toDate?.();

            // المادة الجديدة (qty=0 + لا depletionDate) لا تُحسب كناضبة
            if (q === 0 && item.depletionDate) {
                depleted++;
            } else if (q > 0 && q <= min) {
                lowStock++;
            }
            if (exp && exp > now && Math.ceil((exp - now) / 86400000) <= alertDays) {
                expiringSoon++;
            }
            // بطيئة الحركة
            if (q > 0 && last) {
                const days = Math.ceil((now - last) / 86400000);
                if (days >= slowDays) slowMoving++;
            }
            // جديدة بلا حركة
            if (q > 0 && !last && !item.depletionDate) {
                newNoMov++;
            }
        });

        const notifs = [];
        if (depleted > 0) {
            notifs.push({
                id: 'depleted',
                icon: '🔴',
                text: `${depleted} مادة ناضبة`,
                level: 'danger',
                action: () => typeof PharmacyAI !== 'undefined' && PharmacyAI.ask('zero')
            });
        }
        if (expiringSoon > 0) {
            notifs.push({
                id: 'expiring',
                icon: '⚠️',
                text: `${expiringSoon} مادة تنتهي < ${alertDays} يوم`,
                level: 'danger',
                action: () => typeof PharmacyAI !== 'undefined' && PharmacyAI.ask('expiring')
            });
        }
        if (lowStock > 0) {
            notifs.push({
                id: 'lowstock',
                icon: '📉',
                text: `${lowStock} مادة تحت الحد`,
                level: 'warning',
                action: () => App.switchSection('inventory')
            });
        }
        if (slowMoving > 0) {
            notifs.push({
                id: 'slow',
                icon: '🐌',
                text: `${slowMoving} مادة بطيئة الحركة`,
                level: 'info',
                action: () => App.switchSection('reports').then(() => setTimeout(() => switchReportsTab('slow-moving'), 100))
            });
        }
        if (newNoMov > 0) {
            notifs.push({
                id: 'new-no-mov',
                icon: '🆕',
                text: `${newNoMov} مادة جديدة بلا حركة`,
                level: 'info',
                action: () => App.switchSection('reports').then(() => setTimeout(() => switchReportsTab('new-no-mov'), 100))
            });
        }

        // حفظ في cache
        this._cacheKey = cacheKey;
        this._cacheResult = notifs;

        // فلترة dismissed
        const dismissed = this._getDismissed();
        return notifs.filter(n => !dismissed.has(n.id));
    },

    /**
     * تحديث البادج على زر AI
     */
    updateBadge() {
        const notifs = this.compute();
        const btn = document.querySelector('[data-section="ai"]');
        if (!btn) return;
        btn.style.position = 'relative';
        btn.querySelectorAll('.ai-notif-badge').forEach(b => b.remove());
        if (notifs.length) {
            const b = document.createElement('span');
            b.className = 'notif-badge ai-notif-badge';
            b.textContent = notifs.length;
            btn.appendChild(b);
        }
    },

    /**
     * عرض الـ banners
     */
    renderBanners(containerId) {
        const el = document.getElementById(containerId);
        if (!el) return;
        const notifs = this.compute();
        if (!notifs.length) {
            el.innerHTML = '';
            return;
        }

        // حفظ الـ actions في data attributes بدل closure (آمن من XSS)
        window.__internalNotifActions = {};
        notifs.forEach(n => { window.__internalNotifActions[n.id] = n.action; });

        el.innerHTML = notifs.map(n => `
        <div class="notif-banner ${n.level}" data-notif-id="${escapeHtml(n.id)}">
            <span>${n.icon} ${escapeHtml(n.text)}</span>
            <button class="notif-dismiss" data-dismiss-id="${escapeHtml(n.id)}">✕</button>
        </div>`).join('');

        // event delegation
        el.querySelectorAll('.notif-banner').forEach(banner => {
            banner.onclick = (e) => {
                if (e.target.classList.contains('notif-dismiss')) return;
                const id = banner.dataset.notifId;
                InternalNotif._handleClick(id);
            };
        });
        el.querySelectorAll('.notif-dismiss').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                InternalNotif.dismiss(btn.dataset.dismissId);
            };
        });
    },

    _handleClick(id) {
        const action = window.__internalNotifActions?.[id];
        if (typeof action === 'function') {
            App.switchSection('ai');
            setTimeout(() => action(), 200);
        }
    },

    dismiss(id) {
        const dismissed = this._getDismissed();
        dismissed.add(id);
        this._saveDismissed(dismissed);
        this.updateBadge();
        // إعادة عرض البانرات
        ['internal-banners', 'ai-notif-banners'].forEach(cid => {
            const el = document.getElementById(cid);
            if (el) this.renderBanners(cid);
        });
    },

    /**
     * إبطال الـ cache (يُستدعى عند تحديث AppState)
     */
    invalidate() {
        this._cacheKey = null;
        this._cacheResult = null;
    },

    /**
     * مسح كل dismissed (للـ admin من الإعدادات)
     */
    clearDismissed() {
        try {
            sessionStorage.removeItem(this._dismissedKey);
        } catch {}
        this.invalidate();
        this.updateBadge();
    },

    init() {
        this.updateBadge();
    }
};

window.InternalNotif = InternalNotif;
