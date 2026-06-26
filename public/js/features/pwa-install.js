// ============================================================
// js/features/pwa-install.js — Install Prompt للتطبيق
// ============================================================
// v6.5:
// - يستمع لـ beforeinstallprompt
// - يعرض بانر "ثبّت التطبيق" بعد دخول المستخدم
// - يخفي البانر بعد التثبيت أو الرفض
// - حفظ التفضيل في sessionStorage
// ============================================================

const PWAInstall = {
    deferredPrompt: null,
    bannerShown: false,

    init() {
        // التقاط حدث الـ install
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            // عرض البانر بعد 30 ثانية من بدء استخدام التطبيق
            setTimeout(() => this.maybeShowBanner(), 30000);
        });

        // عند التثبيت الناجح
        window.addEventListener('appinstalled', () => {
            this.hideBanner();
            this.deferredPrompt = null;
            try {
                showToast('✅ تم تثبيت التطبيق بنجاح!', 'success', 5000);
            } catch (e) {}
            try {
                if (typeof CU !== 'undefined' && CU && db) {
                    db.collection('auditLog').add({
                        action: 'pwa_installed',
                        targetUid: CU.uid,
                        targetEmail: CU.email,
                        userAgent: navigator.userAgent.slice(0, 200),
                        at: firebase.firestore.FieldValue.serverTimestamp()
                    }).catch(() => {});
                }
            } catch (e) {}
        });

        // اكتشاف ما إذا التطبيق مُثبَّت بالفعل
        if (window.matchMedia('(display-mode: standalone)').matches ||
            window.navigator.standalone === true) {
            document.documentElement.classList.add('pwa-installed');
        }
    },

    maybeShowBanner() {
        // لا نعرض إذا:
        // - مُثبَّت بالفعل
        // - رفض المستخدم اليوم
        // - لا يوجد deferredPrompt
        if (this.bannerShown) return;
        if (!this.deferredPrompt) return;
        if (document.documentElement.classList.contains('pwa-installed')) return;

        const dismissed = sessionStorage.getItem('pwa_install_dismissed');
        if (dismissed && (Date.now() - parseInt(dismissed)) < 24 * 60 * 60 * 1000) return;

        this.showBanner();
    },

    showBanner() {
        this.bannerShown = true;
        const banner = document.createElement('div');
        banner.id = 'pwa-install-banner';
        banner.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 16px;
            right: 16px;
            background: linear-gradient(135deg, #1e3a8a, #1e40af);
            color: white;
            padding: 16px;
            border-radius: 12px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.4);
            z-index: 9999;
            display: flex;
            gap: 12px;
            align-items: center;
            animation: slideUp 0.3s ease-out;
            max-width: 500px;
            margin: 0 auto;
        `;

        banner.innerHTML = `
            <div style="font-size:2rem;flex-shrink:0">📱</div>
            <div style="flex:1;min-width:0">
                <div style="font-weight:bold;font-size:0.95rem;margin-bottom:2px">ثبّت التطبيق على جهازك</div>
                <div style="font-size:0.8rem;opacity:0.9">دخول أسرع، يعمل كتطبيق حقيقي</div>
            </div>
            <button id="pwa-install-btn" style="
                background: white;
                color: #1e40af;
                border: none;
                padding: 8px 14px;
                border-radius: 8px;
                font-weight: bold;
                cursor: pointer;
                font-size: 0.85rem;
                flex-shrink: 0;
            ">تثبيت</button>
            <button id="pwa-dismiss-btn" style="
                background: rgba(255,255,255,0.15);
                color: white;
                border: none;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                cursor: pointer;
                font-size: 1rem;
                flex-shrink: 0;
            " title="لاحقاً">✕</button>
        `;

        document.body.appendChild(banner);

        // إضافة animation
        if (!document.getElementById('pwa-install-style')) {
            const style = document.createElement('style');
            style.id = 'pwa-install-style';
            style.textContent = `
                @keyframes slideUp {
                    from { transform: translateY(100%); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
                @media (max-width: 480px) {
                    #pwa-install-banner { bottom: 70px !important; }
                }
            `;
            document.head.appendChild(style);
        }

        document.getElementById('pwa-install-btn').onclick = () => this.triggerInstall();
        document.getElementById('pwa-dismiss-btn').onclick = () => this.dismissBanner();
    },

    async triggerInstall() {
        if (!this.deferredPrompt) {
            // iOS Safari لا يدعم beforeinstallprompt
            this.showIOSInstructions();
            return;
        }
        this.deferredPrompt.prompt();
        try {
            const result = await this.deferredPrompt.userChoice;
            if (result.outcome === 'accepted') {
                this.hideBanner();
            }
        } catch (e) {
            console.warn('PWA install error:', e);
        }
        this.deferredPrompt = null;
    },

    dismissBanner() {
        sessionStorage.setItem('pwa_install_dismissed', String(Date.now()));
        this.hideBanner();
    },

    hideBanner() {
        const banner = document.getElementById('pwa-install-banner');
        if (banner) {
            banner.style.transition = 'transform 0.3s, opacity 0.3s';
            banner.style.transform = 'translateY(150%)';
            banner.style.opacity = '0';
            setTimeout(() => banner.remove(), 300);
        }
        this.bannerShown = false;
    },

    showIOSInstructions() {
        const m = document.createElement('div');
        m.className = 'modal';
        m.style.zIndex = '9999';
        m.innerHTML = `
            <div class="modal-content" style="max-width:400px">
                <button class="modal-close" onclick="this.closest('.modal').remove()">✕</button>
                <h3>📱 تثبيت على iPhone/iPad</h3>
                <ol style="padding-right:20px;line-height:1.8;font-size:0.9rem">
                    <li>اضغط زر المشاركة <strong>⎙</strong> في Safari</li>
                    <li>اختر <strong>"إضافة إلى الشاشة الرئيسية"</strong></li>
                    <li>اضغط <strong>"إضافة"</strong></li>
                    <li>ستجد أيقونة التطبيق على الشاشة الرئيسية</li>
                </ol>
                <button class="btn btn-primary" style="width:100%" onclick="this.closest('.modal').remove()">حسناً</button>
            </div>`;
        document.body.appendChild(m);
        this.dismissBanner();
    },

    // عرض البانر يدوياً (من الإعدادات)
    showManually() {
        sessionStorage.removeItem('pwa_install_dismissed');
        if (this.deferredPrompt) {
            this.showBanner();
        } else {
            // قد يكون iOS أو مُثبَّت بالفعل
            if (document.documentElement.classList.contains('pwa-installed')) {
                showToast('✅ التطبيق مُثبَّت بالفعل', 'success');
            } else {
                this.showIOSInstructions();
            }
        }
    }
};

// تشغيل تلقائي عند تحميل الصفحة
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => PWAInstall.init());
} else {
    PWAInstall.init();
}
