// ============================================================
// js/features/screen-lock.js — v7.5 (Hardened)
// ============================================================
// 🔴 إصلاحات v7.5 #11:
//   - حد أقصى 3 محاولات خاطئة → signOut تلقائي
//   - حفظ حالة القفل في sessionStorage (يصمد بين تبويبات نفس الجلسة)
//   - تأخير بين المحاولات الخاطئة (1-3-5 ثانية) لمنع brute-force محلي
//
// ⚠️ ملاحظة أمنية: هذا قفل واجهة فقط، ليس قفل أمان حقيقي.
//    Firebase session ما زالت نشطة → DevTools/Console يتجاوزانه.
//    للحماية الحقيقية: قلِّل sessionTimeout في Firebase Auth.
// ============================================================

const ScreenLock = {
    _timer: null,
    _warnTimer: null,
    _timeout: 30 * 60 * 1000,
    _warnBefore: 2 * 60 * 1000,
    _locked: false,
    _listenersAttached: false,
    _failedAttempts: 0,
    _maxAttempts: 3,
    _lastFailAt: 0,
    _SS_KEY: 'pharmacy_screenlock_v75',

    init() {
        if (!this._listenersAttached) {
            ['click', 'touchstart', 'keydown', 'scroll'].forEach(e =>
                document.addEventListener(e, () => this.resetTimer(), { passive: true })
            );
            this._listenersAttached = true;
        }
        // 🔴 v7.5 #11: استعادة حالة القفل من sessionStorage
        // (إن أُغلق التبويب وفُتح مجدداً ضمن نفس الجلسة → يبقى مقفولاً)
        try {
            if (sessionStorage.getItem(this._SS_KEY) === 'locked') {
                // أعد القفل عند تحميل الصفحة بعد انتظار حتى تجهز DOM
                setTimeout(() => this.lock(), 500);
                return;
            }
        } catch {}
        this.resetTimer();
    },

    resetTimer() {
        if (this._locked) return;
        clearTimeout(this._timer);
        clearTimeout(this._warnTimer);
        this._warnTimer = setTimeout(() => {
            if (!this._locked) showToast('⏰ ستُقفل الجلسة خلال دقيقتين بسبب عدم النشاط', 'warning');
        }, this._timeout - this._warnBefore);
        this._timer = setTimeout(() => this.lock(), this._timeout);
    },

    lock() {
        if (!CU) return;
        this._locked = true;
        this._failedAttempts = 0;
        clearTimeout(this._warnTimer);
        // 🔴 v7.5 #11: حفظ حالة القفل في sessionStorage
        try { sessionStorage.setItem(this._SS_KEY, 'locked'); } catch {}
        const el = document.getElementById('screen-lock');
        if (!el) return;
        const ne = document.getElementById('lock-user-name');
        if (ne) ne.textContent = CU.name || CU.email || '';
        el.classList.add('active');
        setTimeout(() => document.getElementById('lock-password')?.focus(), 300);
    },

    async unlock() {
        const pw = document.getElementById('lock-password')?.value || '';
        const errEl = document.getElementById('lock-error');
        if (!pw) return;
        
        // 🔴 v7.5 #11: تأخير متصاعد بين المحاولات (1s → 3s → 5s)
        const minDelay = this._failedAttempts === 0 ? 0 :
                         this._failedAttempts === 1 ? 1000 :
                         this._failedAttempts === 2 ? 3000 : 5000;
        const sinceLastFail = Date.now() - this._lastFailAt;
        if (sinceLastFail < minDelay) {
            if (errEl) {
                errEl.style.display = 'block';
                errEl.textContent = `⏳ انتظر ${Math.ceil((minDelay - sinceLastFail) / 1000)} ثوانٍ`;
            }
            return;
        }
        
        const currentUser = firebase.auth().currentUser;
        if (!currentUser) {
            showToast('انتهت جلستك — أعد تسجيل الدخول', 'warning');
            this.signOutAndLock();
            return;
        }
        try {
            const credential = firebase.auth.EmailAuthProvider.credential(CU.email, pw);
            await currentUser.reauthenticateWithCredential(credential);
            // ✅ نجاح
            this._locked = false;
            this._failedAttempts = 0;
            this._lastFailAt = 0;
            try { sessionStorage.removeItem(this._SS_KEY); } catch {}
            document.getElementById('screen-lock')?.classList.remove('active');
            document.getElementById('lock-password').value = '';
            if (errEl) errEl.style.display = 'none';
            this.resetTimer();
        } catch (e) {
            this._failedAttempts++;
            this._lastFailAt = Date.now();
            
            // 🔴 v7.5 #11: حد المحاولات → signOut تلقائي
            if (this._failedAttempts >= this._maxAttempts) {
                if (errEl) {
                    errEl.style.display = 'block';
                    errEl.textContent = `❌ تم تجاوز ${this._maxAttempts} محاولات — تسجيل الخروج...`;
                }
                // سجل الحادثة
                try {
                    await db.collection('auditLog').add({
                        action: 'screenlock_max_attempts',
                        targetUid: CU.uid,
                        targetEmail: CU.email,
                        byUid: CU.uid,
                        by: CU.email,
                        at: firebase.firestore.FieldValue.serverTimestamp()
                    });
                } catch (logErr) {
                    console.warn('audit screenlock_max_attempts:', logErr.message);
                }
                setTimeout(() => this.signOutAndLock(), 1500);
                return;
            }
            
            if (errEl) {
                errEl.style.display = 'block';
                errEl.textContent = `❌ كلمة مرور خاطئة (${this._failedAttempts}/${this._maxAttempts})`;
            }
            document.getElementById('lock-password').value = '';
        }
    },

    signOutAndLock() {
        try { sessionStorage.removeItem(this._SS_KEY); } catch {}
        firebase.auth().signOut();
        document.getElementById('screen-lock')?.classList.remove('active');
        this._locked = false;
        this._failedAttempts = 0;
    }
};
