// ============================================================
// js/auth.js — v6.8.2
// ============================================================
// 🔴 v6.8.2 (هذا الإصلاح):
// - حُذف فحص "قفل الحساب بعد 5 محاولات" وكل الكتابات قبل المصادقة
//   السبب: firestore.rules تشترط isAuth() لقراءة/كتابة /users، لكن
//   trackFailedLogin والفحص الاستباقي كانا يعملان قبل تسجيل الدخول
//   → كل المحاولات تفشل بـ permission-denied (مُبتلَع في catch صامت)
//   → الميزة كانت "أمناً مزيفاً" لا تعمل أبداً
// - الحماية الفعلية: Firebase Auth يقفل الحساب تلقائياً عبر
//   auth/too-many-requests بعد محاولات متكررة (هذا يعمل)
// - للقفل الدائم: المسؤول يُعطّل الحساب يدوياً عبر إدارة المستخدمين
//   (disabled=true) — هذا يعمل لأن admin مصادَق
// - 🔧 #offline-block يُدار عبر ConnectionMonitor (لا navigator.onLine المُهمَل)
// ============================================================

const SESSION_TIMEOUT_HOURS = 12;

// ============================================================
// تسجيل الدخول
// ============================================================
async function doLogin() {
    const email = sanitizeInput(document.getElementById('auth-email').value, 200).toLowerCase();
    const pass = document.getElementById('auth-pass').value;  // لا sanitize للـ password
    const remember = document.getElementById('remember-me').checked;
    const errEl = document.getElementById('auth-err');
    const btn = document.querySelector('#login-screen button[onclick="doLogin()"]')
              || document.getElementById('btn-login');

    errEl.style.display = 'none';

    // الفحوصات الأولية
    if (!email || !pass) {
        errEl.textContent = 'البريد وكلمة المرور إلزاميان';
        errEl.style.display = 'block';
        return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errEl.textContent = 'البريد الإلكتروني غير صالح';
        errEl.style.display = 'block';
        return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'جاري الدخول...'; }

    // ============================================================
    // 🔧 v6.8.2: حُذف الفحص الاستباقي للقفل لأنه كان يفشل بصمت
    // الفحوصات الحقيقية تحدث في onAuthStateChanged بعد المصادقة:
    //  - disabled === true → خروج فوري
    //  - forceLogout === true → خروج فوري
    // أما الحماية ضد المحاولات المتكررة فمسؤولية Firebase Auth (auth/too-many-requests)
    // ============================================================

    try {
        const persistence = remember
            ? firebase.auth.Auth.Persistence.LOCAL
            : firebase.auth.Auth.Persistence.SESSION;
        await auth.setPersistence(persistence);
        await auth.signInWithEmailAndPassword(email, pass);
        // ✅ نجاح — onAuthStateChanged يكمل العملية
    } catch (e) {
        // 🔧 v6.8.2: لم نعد ندعو trackFailedLogin (كان معطَّلاً وصامتاً)
        // Firebase Auth نفسه يفرض limit تلقائياً بـ auth/too-many-requests

        // رسائل خطأ آمنة (بدون كشف وجود/عدم وجود البريد)
        if (e.code === 'auth/wrong-password' ||
            e.code === 'auth/user-not-found' ||
            e.code === 'auth/invalid-credential' ||
            e.code === 'auth/invalid-email') {
            errEl.textContent = '❌ البريد أو كلمة المرور غير صحيحة';
        } else if (e.code === 'auth/too-many-requests') {
            // هذا هو القفل الفعلي من Firebase Auth (يعمل بعكس النسخة القديمة)
            errEl.textContent = '⏳ محاولات كثيرة فاشلة من جهازك — انتظر دقائق وحاول مرة أخرى، أو راجع المسؤول';
        } else if (e.code === 'auth/user-disabled') {
            errEl.textContent = '🔴 حسابك معطّل — راجع المسؤول';
        } else if (e.code === 'auth/network-request-failed') {
            errEl.textContent = '📡 تعذّر الاتصال — تحقق من الإنترنت';
        } else {
            errEl.textContent = 'فشل الدخول — حاول مرة أخرى';
            console.error('Login error:', e.code, e.message);
        }
        errEl.style.display = 'block';
        if (btn) { btn.disabled = false; btn.textContent = 'دخول'; }
    }
}

// ============================================================
// 🔧 v6.8.2: trackFailedLogin محذوف — كان يكتب /users قبل auth → permission-denied
// ============================================================

// ============================================================
// 🆕 إعادة تعيين عداد الفشل عند الدخول الناجح
// 🔧 v6.8.2: تبقى الدالة لتنظيف الحقول إن كان admin عيّنها يدوياً عبر Firestore Console
//   (كانت تُعيّن آلياً قديماً قبل ما اكتشفنا أن trackFailedLogin معطَّل)
// ============================================================
async function resetFailedLoginsOnSuccess(uid) {
    try {
        const ref = db.collection('users').doc(uid);
        const snap = await ref.get();
        const data = snap.data();
        if (data?.failedLoginAttempts > 0 || data?.lockedUntil) {
            await ref.update({
                failedLoginAttempts: 0,
                lockedUntil: null
            });
        }
    } catch (e) {
        console.warn('resetFailedLoginsOnSuccess failed:', e.message);
    }
}

// ============================================================
// نسيت كلمة المرور — يرسل بريد إعادة تعيين
// ============================================================
async function doForgotPassword() {
    const email = document.getElementById('auth-email').value.trim().toLowerCase();
    const errEl = document.getElementById('auth-err');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errEl.textContent = 'أدخل بريدك الإلكتروني في الحقل أعلاه أولاً';
        errEl.style.display = 'block';
        return;
    }
    try {
        await auth.sendPasswordResetEmail(email);
        showToast('✅ إن كان البريد مسجَّلاً، سيُرسَل رابط إعادة التعيين', 'success', 8000);

        // 🔴 v7.5 #24: لا silent catch؛ تسجيل لتشخيص فشل audit
        // ملاحظة: لو المستخدم غير مصادَق، rules ترفض → نسجل بدون رفع الخطأ
        // (لأن سنّ "اكشف ما إذا كان البريد موجوداً" أهم من نجاح audit)
        await db.collection('auditLog').add({
            action: 'password_reset_requested',
            targetEmail: email,
            userAgent: navigator.userAgent.slice(0, 200),
            at: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(e => console.warn('audit password_reset_requested:', e.message));
    } catch (e) {
        // لا نكشف ما إذا كان البريد موجوداً أم لا
        showToast('✅ إن كان البريد مسجَّلاً، سيُرسَل رابط إعادة التعيين', 'success', 8000);
    }
}

// ============================================================
// onAuthStateChanged — يُستدعى عند الدخول/الخروج/تغيير المستخدم
// ============================================================
auth.onAuthStateChanged(async user => {
    if (user) {
        let userData;
        try {
            const uDoc = await db.collection('users').doc(user.uid).get();
            if (!uDoc.exists) {
                console.warn('User document not found in Firestore');
                await auth.signOut();
                showToast('🔴 حسابك غير مكتمل — راجع المسؤول', 'error');
                return;
            }
            userData = uDoc.data();
        } catch (e) {
            console.error('Failed to fetch user document:', e);
            await auth.signOut();
            showToast('فشل تحميل بيانات الحساب', 'error');
            return;
        }

        // 🆕 فحص disabled (بعد الدخول) — هذا يعمل لأن user مصادَق الآن
        if (userData.disabled === true) {
            await auth.signOut();
            showToast('🔴 حسابك معطّل — راجع المسؤول', 'error');
            return;
        }

        // 🆕 فحص forceLogout (admin طلب إخراج هذا المستخدم)
        // 🔴 v7.5 #19: sync-claims يمسح forceLogout بعد revokeRefreshTokens
        //    لذا الحلقة اللانهائية محلولة من جذرها (لا نحتاج فعل شيء هنا)
        if (userData.forceLogout === true) {
            console.log('forceLogout detected → signing out. sync-claims will clear flag.');
            await auth.signOut();
            showToast('🚪 المسؤول طلب إعادة تسجيل دخولك — حاول مرة أخرى', 'warning', 8000);
            return;
        }

        // 🆕 فحص Custom Claims موجودة
        let claimsReady = true;
        try {
            const tokenResult = await user.getIdTokenResult();
            if (!tokenResult.claims.role) {
                claimsReady = false;
                // 🔧 v6.8.1: أظهر شاشة تحضير حقيقية بدل واجهة مكسورة
                document.getElementById('login-screen').innerHTML = `
                    <div class="login-card" style="text-align:center">
                        <div style="font-size:3rem;margin-bottom:1rem">⏳</div>
                        <h2 style="margin-bottom:0.5rem">جارٍ تحضير حسابك</h2>
                        <p style="color:var(--muted);font-size:0.9rem;margin-bottom:1.5rem">
                            هذه أول مرة تدخل — صلاحياتك تُهيَّأ في الخلفية.<br>
                            هذا يستغرق عادةً أقل من 5 دقائق.
                        </p>
                        <div style="background:var(--surface2);padding:0.75rem;border-radius:var(--radius-sm);font-size:0.82rem;color:var(--text2)">
                            ستُحدَّث الصفحة تلقائياً عند الاكتمال
                        </div>
                        <button class="btn btn-sm" style="margin-top:1rem" onclick="auth.signOut()">إلغاء وتسجيل خروج</button>
                    </div>`;
                document.getElementById('login-screen').style.display = 'flex';
                // فحص دوري كل 30 ثانية
                window._claimsCheckInterval = setInterval(async () => {
                    try {
                        const t = await user.getIdToken(true);
                        const tr = await user.getIdTokenResult();
                        if (tr.claims.role) {
                            clearInterval(window._claimsCheckInterval);
                            location.reload();
                        }
                    } catch (e) {
                        // 🔴 v7.5 #24: لا silent catch؛ تسجيل لتشخيص لاحق
                        console.warn('claims check failed:', e.message);
                    }
                }, 30000);
                return;
            }
        } catch (e) {
            // 🔴 v7.5 #24: تسجيل الخطأ بدل ابتلاعه
            console.warn('getIdTokenResult failed:', e.message);
        }

        // ✅ تنظيف الحقول القديمة + تحديث آخر دخول
        await resetFailedLoginsOnSuccess(user.uid);
        await db.collection('users').doc(user.uid).update({
            lastLoginAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastLoginUserAgent: navigator.userAgent.slice(0, 200)
        }).catch(e => console.warn('update lastLoginAt:', e.message));

        // 🔴 v7.5 #24: تسجيل byUid لمنع انتحال الهوية في auditLog (الـ rules ترفض غير ذلك)
        await db.collection('auditLog').add({
            action: 'login_success',
            targetUid: user.uid,
            targetEmail: user.email,
            byUid: user.uid,
            by: user.email,
            at: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(e => console.warn('audit login_success:', e.message));

        CU = {
            uid: user.uid,
            email: user.email,
            name: userData.name || user.email.split('@')[0],
            role: userData.role || 'viewer',
            kadre: KADRE_LABELS[userData.role] || '🔵 مشاهد'
        };

        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-header').style.display = 'flex';
        document.getElementById('main-content').style.display = 'block';
        document.getElementById('bottom-nav').style.display = 'flex';
        document.getElementById('user-info').textContent = `${CU.name} | ${CU.kadre}`;

        // ============================================================
        // 🆕 Token Refresh + Session Timeout
        // ============================================================
        if (window._tokenRefreshInterval) clearInterval(window._tokenRefreshInterval);
        if (window._sessionTimeoutTimer) clearTimeout(window._sessionTimeoutTimer);

        // تجديد token كل 50 دقيقة (قبل انتهاء الـ 1 ساعة)
        window._tokenRefreshInterval = setInterval(() => {
            firebase.auth().currentUser?.getIdToken(true).then(() => {}).catch(async (e) => {
                console.warn('Token refresh failed:', e.code);
                clearInterval(window._tokenRefreshInterval);
                // إذا الـ refresh token تم إبطاله من admin → إخراج فوري
                if (e.code === 'auth/user-token-expired' || e.code === 'auth/user-disabled') {
                    showToast('انتهت جلستك — يُرجى إعادة الدخول', 'warning', 8000);
                    await firebase.auth().signOut();
                }
            });
        }, 50 * 60 * 1000);

        // 🆕 Session Timeout — إخراج تلقائي بعد عدم نشاط لـ SESSION_TIMEOUT_HOURS
        // 🔧 v6.8.1: يُعاد ضبطه عند نشاط المستخدم (لا ينتهي فجأة وسط عملية)
        window._lastActivityTime = Date.now();
        const resetSessionTimer = () => {
            window._lastActivityTime = Date.now();
            if (window._sessionTimeoutTimer) clearTimeout(window._sessionTimeoutTimer);
            window._sessionTimeoutTimer = setTimeout(async () => {
                const idleMs = Date.now() - window._lastActivityTime;
                // فحص حقيقي: لو فعلاً مرت المدة بدون نشاط
                if (idleMs >= SESSION_TIMEOUT_HOURS * 60 * 60 * 1000) {
                    showToast(`⏰ انتهت جلستك (لا نشاط ${SESSION_TIMEOUT_HOURS} ساعة) — يُرجى إعادة الدخول`, 'warning', 10000);
                    setTimeout(async () => await firebase.auth().signOut(), 3000);
                }
            }, SESSION_TIMEOUT_HOURS * 60 * 60 * 1000);
        };
        resetSessionTimer();

        // تتبع نشاط المستخدم - throttled لتقليل الـ overhead
        let _activityThrottle = 0;
        const trackActivity = () => {
            const now = Date.now();
            if (now - _activityThrottle < 30000) return; // كل 30 ثانية على الأكثر
            _activityThrottle = now;
            resetSessionTimer();
        };
        ['click', 'keydown', 'touchstart', 'scroll'].forEach(ev => {
            window.addEventListener(ev, trackActivity, { passive: true });
        });

        // ============================================================
        // تحميل التطبيق
        // ============================================================
        await App.loadSettings();
        ScreenLock.init();
        setTimeout(() => {
            InternalNotif.init();
            App.checkOnboarding?.();
            const now = new Date();
            // 🔧 v6.8: توقيت بغداد
            const _bdS = new Intl.DateTimeFormat('en-CA', { timeZone: BAGHDAD_TZ }).format(now);
            const _bdM = parseInt(_bdS.slice(5,7)) - 1; // 0-based
            const _bdY = parseInt(_bdS.slice(0,4));
            const lm = _bdM === 0 ? 12 : _bdM;
            const ly = _bdM === 0 ? _bdY - 1 : _bdY;
            App.buildMonthSummary?.(CURRENT_DEPT, ly, lm).catch(() => {});
            App.registerFCMToken?.().catch(() => {});
        }, 1500);
        await loadInventoryForDept(CURRENT_DEPT);
        App.loadUnreadNotifCount().catch(() => {});
        App.switchSection('dashboard');
    } else {
        // ============================================================
        // المستخدم غير مسجَّل دخول
        // ============================================================
        CU = null;
        lastDispenseTime = {};

        if (window._tokenRefreshInterval) {
            clearInterval(window._tokenRefreshInterval);
            window._tokenRefreshInterval = null;
        }
        if (window._sessionTimeoutTimer) {
            clearTimeout(window._sessionTimeoutTimer);
            window._sessionTimeoutTimer = null;
        }

        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('app-header').style.display = 'none';
        document.getElementById('main-content').style.display = 'none';
        document.getElementById('bottom-nav').style.display = 'none';

        if (window._invUnsub) { window._invUnsub(); window._invUnsub = null; }
        AppState.inventory.clear();
        AppState.loaded = false;
        AppState._batchesCached = false;
        itemsCache = [];
        MovementsCache.clear();

        // إفراغ حقول الدخول (أمان)
        const passInput = document.getElementById('auth-pass');
        if (passInput) passInput.value = '';
    }
});

// ============================================================
// 🔧 v6.8.2: #offline-block يُدار عبر ConnectionMonitor (لا navigator.onLine)
// كان: navigator.onLine listener (غير موثوق + مزدوج مع ConnectionMonitor's bar)
// الآن: ConnectionMonitor.onStatusChange يُدير الـ block + الـ bar معاً
// ============================================================
function _wireOfflineBlock() {
    if (!window.ConnectionMonitor) {
        // Fallback إن لم يُحمَّل ConnectionMonitor بعد
        window.addEventListener('online', () => document.getElementById('offline-block')?.classList.remove('show'));
        window.addEventListener('offline', () => document.getElementById('offline-block')?.classList.add('show'));
        if (!navigator.onLine) document.getElementById('offline-block')?.classList.add('show');
        return;
    }
    ConnectionMonitor.onStatusChange((status) => {
        const block = document.getElementById('offline-block');
        if (!block) return;
        if (status === 'disconnected') block.classList.add('show');
        else block.classList.remove('show');
    });
}
// نُسجّل الـ wire بعد DOMContentLoaded ليضمن ConnectionMonitor جاهز
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wireOfflineBlock);
} else {
    _wireOfflineBlock();
}

// ============================================================
// تسجيل Service Worker للـ PWA install support
// الـ SW network-only (لا cache) - لا يخالف online-only
// ============================================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('[SW] تسجيل ناجح، scope:', reg.scope))
            .catch(err => console.warn('[SW] فشل التسجيل:', err.message));
    });
}
