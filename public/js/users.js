// ============================================================
// js/users.js — إدارة المستخدمين v6.3
// ============================================================
// 🔴 v6.8.2 (هذا الإصلاح):
// - حُذف `const KADRE_LABELS` المكرَّر (كان يرمي SyntaxError ويكسر تنفيذ
//   كل الملف → كل دوال إدارة المستخدمين كانت مفقودة وقت التشغيل)
// - KADRE_LABELS الموحَّد الآن في globals.js
// ============================================================
// تحديثات v6.3:
// - 🆕 فحص قوة كلمة المرور (8+ حروف، حروف كبيرة وصغيرة وأرقام)
// - 🆕 حماية آخر admin من الحذف/التخفيض
// - 🆕 عرض حالة Custom Claims Sync (pending/synced)
// - 🆕 إعادة تعيين كلمة المرور للمستخدم
// - 🆕 تتبع آخر دخول وعدد المحاولات الفاشلة
// - 🆕 forceLogout flag — يُجبر المستخدم على إعادة الدخول
// - الأرقام الإنجليزية في كل مكان
// ============================================================

// ⚠️ KADRE_LABELS مُعرَّف في core/globals.js
// لا تُعد التعريف هنا — ECMAScript spec يرمي SyntaxError ويبطل
// تنفيذ الملف بأكمله (كل الدوال أدناه لن تُسجَّل عالمياً)

// ============================================================
// فحص قوة كلمة المرور
// ============================================================
function checkPasswordStrength(pass) {
    if (!pass || pass.length < 8) {
        return { valid: false, reason: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' };
    }
    if (pass.length > 128) {
        return { valid: false, reason: 'كلمة المرور طويلة جداً (الحد الأقصى 128 حرف)' };
    }
    const hasUpper = /[A-Z]/.test(pass);
    const hasLower = /[a-z]/.test(pass);
    const hasDigit = /[0-9]/.test(pass);
    const hasSpace = /\s/.test(pass);

    if (hasSpace) {
        return { valid: false, reason: 'لا يجوز وجود مسافات' };
    }
    if (!hasUpper) {
        return { valid: false, reason: 'يجب أن تحتوي على حرف كبير (A-Z)' };
    }
    if (!hasLower) {
        return { valid: false, reason: 'يجب أن تحتوي على حرف صغير (a-z)' };
    }
    if (!hasDigit) {
        return { valid: false, reason: 'يجب أن تحتوي على رقم (0-9)' };
    }
    // كلمات شائعة (قائمة قصيرة)
    const common = ['password', '12345678', 'qwerty123', 'admin123', 'password1', 'iloveyou'];
    if (common.includes(pass.toLowerCase())) {
        return { valid: false, reason: 'كلمة المرور شائعة جداً — اختر أصعب' };
    }
    return { valid: true };
}

// ============================================================
// عرض قائمة المستخدمين
// ============================================================
function renderUsersModalList(users) {
    const el = document.getElementById('users-list-container');
    if (!el) return;
    const kadreLabel = (u) => KADRE_LABELS[u.role] || u.role || '';

    // حساب عدد المسؤولين الفعّالين
    const activeAdmins = users.filter(u => u.role === 'admin' && !u.disabled).length;
    const adminCountInfo = `<div style="background:var(--surface3);padding:8px;border-radius:6px;margin-bottom:8px;font-size:0.8rem">
        🔴 المسؤولون الفعّالون: <strong>${activeAdmins}</strong>
        ${activeAdmins === 1 ? ' <span style="color:var(--warning)">⚠️ آخر مسؤول — لا يمكن حذفه أو تخفيضه</span>' : ''}
    </div>`;

    el.innerHTML = adminCountInfo + `
        <table class="inventory-table">
            <thead>
                <tr>
                    <th>الاسم</th>
                    <th>البريد</th>
                    <th>الدور</th>
                    <th>الحالة</th>
                    <th title="حالة Custom Claims في Firebase Auth">Sync</th>
                    <th>آخر دخول</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>${users.map(u => {
                const syncStatus = u.claimSyncRequired === true
                    ? `<span title="ينتظر مزامنة Custom Claims (يتم تلقائياً خلال 5 دقائق)" style="color:var(--warning)">⏳ pending</span>`
                    : u.claimSyncedAt
                        ? `<span title="تمت المزامنة" style="color:var(--success)">✅ synced</span>`
                        : `<span style="color:var(--muted)">—</span>`;
                const lastLogin = u.lastLoginAt?.toDate?.()
                    ? fmtDate(u.lastLoginAt)
                    : '—';
                // 🔧 v6.8.2: failedLoginAttempts لم يعد يُحدَّث بشكل موثوق (الـ rules تمنع
                // الكتابة قبل المصادقة). نعرضه إن كان موجوداً (للسجلات القديمة) لكن لا نعتمد عليه.
                const failedAttempts = u.failedLoginAttempts || 0;
                const failedDisplay = failedAttempts > 0
                    ? ` <span title="${failedAttempts} محاولة فاشلة (سجل قديم)" style="color:var(--danger);font-size:0.7rem">⚠️ ${failedAttempts}</span>`
                    : '';
                return `<tr>
                    <td>${escapeHtml(u.name||'')}${failedDisplay}</td>
                    <td>${escapeHtml(u.email||'')}</td>
                    <td>${kadreLabel(u)}</td>
                    <td>${u.disabled?'🔴 معطّل':'🟢 مفعّل'}</td>
                    <td style="font-size:0.75rem">${syncStatus}</td>
                    <td>${lastLogin}</td>
                    <td>
                        <button class="btn btn-xs btn-primary" onclick="showEditUserModal('${escapeHtml(u.id)}')">تعديل</button>
                    </td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
}

function filterUsersModal(q, role, status) {
    const searchVal = q !== '' ? q : (document.getElementById('users-search')?.value || '');
    const roleVal = role !== '' ? role : (document.getElementById('users-role-f')?.value || '');
    const statusVal = status !== '' ? status : (document.getElementById('users-status-f')?.value || '');
    let filtered = window._allUsers || [];
    if (searchVal) filtered = filtered.filter(u => (u.name||'').includes(searchVal) || (u.email||'').includes(searchVal));
    if (roleVal) filtered = filtered.filter(u => u.role === roleVal);
    if (statusVal === 'active') filtered = filtered.filter(u => !u.disabled);
    if (statusVal === 'disabled') filtered = filtered.filter(u => u.disabled);
    renderUsersModalList(filtered);
}

// ============================================================
// إضافة مستخدم جديد
// ============================================================
function showAddUserModal() {
    const m = document.createElement('div');
    m.className = 'modal user-edit-modal';
    m.style.zIndex = '300';
    m.innerHTML = `
        <div class="modal-content">
            <button class="modal-close" onclick="this.closest('.modal').remove()">✕</button>
            <h3>➕ إضافة مستخدم جديد</h3>

            <div class="form-group">
                <label>الاسم الكامل <span style="color:var(--danger)">*</span></label>
                <input type="text" id="nu-name" class="form-control" maxlength="100" placeholder="مثل: أحمد علي محمد">
            </div>

            <div class="form-group">
                <label>البريد الإلكتروني <span style="color:var(--danger)">*</span></label>
                <input type="email" id="nu-email" class="form-control" maxlength="200" placeholder="مثل: ahmed.pharmacy@hospital.local" autocomplete="off">
                <small style="color:var(--text2);font-size:0.7rem">يمكن أن يكون بريداً وهمياً (لا يلزم استلام إيميل)</small>
            </div>

            <div class="form-group">
                <label>كلمة المرور <span style="color:var(--danger)">*</span></label>
                <div style="display:flex;gap:6px">
                    <input type="text" id="nu-pass" class="form-control" placeholder="8 أحرف على الأقل" autocomplete="off">
                    <button type="button" class="btn btn-sm" onclick="generateStrongPassword()" title="توليد كلمة قوية تلقائياً">🎲</button>
                </div>
                <small style="color:var(--text2);font-size:0.7rem">
                    📋 المتطلبات: 8+ أحرف، حرف كبير، حرف صغير، رقم<br>
                    💡 الزر 🎲 يولّد كلمة قوية تلقائياً
                </small>
                <div id="nu-pass-strength" style="margin-top:4px;font-size:0.75rem"></div>
            </div>

            <div class="form-group">
                <label>الدور <span style="color:var(--danger)">*</span></label>
                <select id="nu-role" class="form-control">
                    <option value="viewer">🔵 المشاهد — قراءة فقط</option>
                    <option value="staff">🟢 كادر المذخر — وارد/صادر/تقارير</option>
                    <option value="admin">🔴 المسؤول — صلاحيات كاملة</option>
                </select>
                <small style="color:var(--text2);font-size:0.7rem">
                    🔵 المشاهد: يقرأ المخزون والتقارير فقط<br>
                    🟢 الكادر: يضيف ويعدّل ويصرف ويستلم<br>
                    🔴 المسؤول: كل ما سبق + إدارة المستخدمين والإعدادات
                </small>
            </div>

            <div style="background:#1a2d45;padding:10px;border-radius:6px;margin:12px 0;font-size:0.8rem">
                ⏱️ <b>ملاحظة مهمة:</b> بعد إنشاء الحساب، قد يحتاج المستخدم الانتظار حتى 5 دقائق قبل أن تعمل الصلاحيات بشكل كامل (مزامنة Custom Claims تلقائية).
            </div>

            <div style="display:flex;gap:8px;margin-top:1rem">
                <button class="btn btn-success" onclick="saveNewUser()">💾 إضافة الحساب</button>
                <button class="btn" onclick="this.closest('.modal').remove()">إلغاء</button>
            </div>
            <p id="nu-err" class="text-danger" style="margin-top:8px"></p>
        </div>`;
    document.body.appendChild(m);

    // فحص قوة كلمة المرور أثناء الكتابة
    document.getElementById('nu-pass').addEventListener('input', e => {
        const result = checkPasswordStrength(e.target.value);
        const div = document.getElementById('nu-pass-strength');
        if (!e.target.value) { div.innerHTML = ''; return; }
        div.innerHTML = result.valid
            ? '<span style="color:var(--success)">✅ كلمة المرور قوية</span>'
            : `<span style="color:var(--danger)">❌ ${result.reason}</span>`;
    });
}

// ============================================================
// توليد كلمة مرور قوية
// ============================================================
function generateStrongPassword() {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // حذف I و O (لتجنب الالتباس)
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const digits = '23456789'; // حذف 0 و 1
    const special = '!@#$%';

    function pick(str) {
        const arr = new Uint32Array(1);
        crypto.getRandomValues(arr);
        return str[arr[0] % str.length];
    }

    // 12 حرفاً: 3 كبيرة، 4 صغيرة، 3 أرقام، 2 رمز
    const chars = [
        pick(upper), pick(upper), pick(upper),
        pick(lower), pick(lower), pick(lower), pick(lower),
        pick(digits), pick(digits), pick(digits),
        pick(special), pick(special)
    ];
    // خلط
    for (let i = chars.length - 1; i > 0; i--) {
        const j = new Uint32Array(1);
        crypto.getRandomValues(j);
        const k = j[0] % (i + 1);
        [chars[i], chars[k]] = [chars[k], chars[i]];
    }
    const password = chars.join('');
    const input = document.getElementById('nu-pass');
    if (input) {
        input.value = password;
        input.dispatchEvent(new Event('input'));
    }
    return password;
}

// ============================================================
// حفظ مستخدم جديد
// ============================================================
async function saveNewUser() {
    if (!isAdmin()) {
        showToast('إنشاء المستخدمين — للمسؤول فقط', 'error');
        logSecurityEvent('unauthorized_user_create');
        return;
    }
    if (!requireOnline('إضافة مستخدم')) return;

    const name = sanitizeInput(document.getElementById('nu-name')?.value, 100);
    const email = sanitizeInput(document.getElementById('nu-email')?.value, 200);
    const pass = document.getElementById('nu-pass')?.value;
    const role = document.getElementById('nu-role')?.value;
    const errEl = document.getElementById('nu-err');

    if (!name) { errEl.textContent = 'الاسم إلزامي'; return; }
    if (name.length < 2) { errEl.textContent = 'الاسم قصير جداً'; return; }
    if (!email) { errEl.textContent = 'البريد إلزامي'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errEl.textContent = 'البريد غير صالح';
        return;
    }
    if (!['admin', 'staff', 'viewer'].includes(role)) {
        errEl.textContent = 'الدور غير صالح';
        return;
    }

    // فحص قوة كلمة المرور
    const strength = checkPasswordStrength(pass);
    if (!strength.valid) {
        errEl.textContent = strength.reason;
        return;
    }

    // التحقق من البريد المكرر
    try {
        const dup = await db.collection('users').where('email', '==', email).limit(1).get();
        if (!dup.empty) {
            errEl.textContent = 'هذا البريد مستخدم مسبقاً';
            return;
        }
    } catch (e) {
        errEl.textContent = 'فشل التحقق من البريد';
        return;
    }

    // 🆕 v6.4: فحص الحسابات المحذوفة سابقاً
    const deletedAccount = await checkDeletedAccountByEmail(email);
    if (deletedAccount) {
        // إغلاق modal الإضافة وعرض dialog الاكتشاف
        document.querySelector('.user-edit-modal')?.remove();
        showDeletedAccountFoundDialog(deletedAccount, { name, email, pass, role });
        return;
    }

    try {
        // ⚠️ ملاحظة أمنية: استخدام secondary app لتجنب تسجيل خروج المسؤول الحالي
        const secondaryApp = firebase.initializeApp(firebase.app().options, 'secondary-' + Date.now());
        const secondaryAuth = secondaryApp.auth();
        let cred;
        try {
            cred = await secondaryAuth.createUserWithEmailAndPassword(email, pass);
            await secondaryAuth.signOut();
        } finally {
            await secondaryApp.delete();
        }

        // إنشاء وثيقة المستخدم
        await db.collection('users').doc(cred.user.uid).set({
            name, email, role,
            disabled: false,
            disabledAt: null, disabledBy: null,
            createdAt: firebase.firestore.Timestamp.now(),
            createdBy: CU.email,
            createdByUid: CU.uid,
            lastLoginAt: null,
            // 🔧 v6.8.2: الحقول التالية موجودة لكن لا يُكتب لها client-side
            // (rules تمنع write قبل auth، lockout عملياً غير مفعّل)
            // تبقى للسجلات القديمة وللمسؤول لو احتاج تعيينها يدوياً
            failedLoginAttempts: 0,
            lockedUntil: null,
            fcmTokens: [],
            notificationsEnabled: true,
            // 🆕 سيتم مزامنته خلال 5 دقائق عبر userSyncAgent
            claimSyncRequired: true,
            claimSyncedAt: null,
            forceLogout: false
        });

        await db.collection('auditLog').add({
            action: 'create_user',
            targetEmail: email,
            targetUid: cred.user.uid,
            role,
            by: CU.email,
            byUid: CU.uid,
            at: firebase.firestore.FieldValue.serverTimestamp()
        });

        const addModal = document.querySelector('.user-edit-modal');
        addModal?.remove();

        // عرض كلمة المرور للمسؤول مع تعليمات
        showCredentialsModal(name, email, pass, role);
    } catch (e) {
        if (e.code === 'auth/email-already-in-use') {
            errEl.textContent = 'البريد مستخدم في Firebase Auth — اتصل بمدير النظام';
        } else if (e.code === 'auth/weak-password') {
            errEl.textContent = 'كلمة المرور ضعيفة';
        } else if (e.code === 'auth/invalid-email') {
            errEl.textContent = 'البريد غير صالح';
        } else {
            errEl.textContent = 'فشل: ' + (e.message || 'خطأ غير معروف');
            console.error('saveNewUser error:', e);
        }
    }
}

// ============================================================
// عرض بيانات الحساب للمسؤول (لإعطائها للمستخدم)
// ============================================================
function showCredentialsModal(name, email, pass, role) {
    const m = document.createElement('div');
    m.className = 'modal';
    m.style.zIndex = '400';
    m.innerHTML = `
        <div class="modal-content" style="max-width:480px">
            <h3>✅ تم إنشاء حساب ${escapeHtml(name)}</h3>
            <div style="background:#1a3a1a;padding:12px;border-radius:8px;margin:1rem 0;border:2px solid var(--success)">
                <p style="margin:0 0 8px 0;font-size:0.85rem;color:var(--success)">
                    📋 <b>بيانات الحساب — انسخها وأعطها للمستخدم:</b>
                </p>
                <table style="width:100%;font-size:0.85rem">
                    <tr>
                        <td style="padding:4px 0;color:var(--text2)">الرابط:</td>
                        <td style="font-family:monospace"><code id="cred-url">https://phzain14.web.app</code></td>
                    </tr>
                    <tr>
                        <td style="padding:4px 0;color:var(--text2)">البريد:</td>
                        <td style="font-family:monospace"><code id="cred-email">${escapeHtml(email)}</code></td>
                    </tr>
                    <tr>
                        <td style="padding:4px 0;color:var(--text2)">كلمة المرور:</td>
                        <td style="font-family:monospace"><code id="cred-pass">${escapeHtml(pass)}</code></td>
                    </tr>
                    <tr>
                        <td style="padding:4px 0;color:var(--text2)">الدور:</td>
                        <td>${KADRE_LABELS[role]}</td>
                    </tr>
                </table>
            </div>
            <button class="btn btn-primary" onclick="copyCredentials('${escapeHtml(email)}', '${escapeHtml(pass)}')" style="width:100%">
                📋 نسخ البيانات للحافظة
            </button>
            <div style="background:#332a10;padding:8px 12px;border-radius:6px;margin:12px 0;font-size:0.8rem;color:var(--warning)">
                ⚠️ <b>تنبيه:</b><br>
                1. هذه كلمة المرور <b>لن تظهر مرة أخرى</b><br>
                2. اطلب من المستخدم تغييرها بعد أول دخول<br>
                3. قد يحتاج الانتظار <b>5 دقائق</b> لتفعيل الصلاحيات
            </div>
            <button class="btn btn-success" onclick="this.closest('.modal').remove();App.showUsersManager?.()" style="width:100%">
                ✅ تم — إغلاق
            </button>
        </div>`;
    document.body.appendChild(m);
}

function copyCredentials(email, pass) {
    const text = `الرابط: https://phzain14.web.app\nالبريد: ${email}\nكلمة المرور: ${pass}\n\n⚠️ غيّر كلمة المرور بعد أول دخول`;
    navigator.clipboard.writeText(text).then(() => {
        showToast('✅ تم النسخ — أرسلها للمستخدم', 'success');
    }).catch(() => {
        showToast('فشل النسخ — انسخها يدوياً', 'warning');
    });
}

// ============================================================
// تعديل مستخدم
// ============================================================
function showEditUserModal(uid) {
    const u = (window._allUsers || []).find(x => x.id === uid);
    if (!u) return;
    const isSelf = uid === CU.uid;

    // حساب المسؤولين الفعّالين
    const activeAdmins = (window._allUsers || []).filter(x => x.role === 'admin' && !x.disabled).length;
    const isLastAdmin = u.role === 'admin' && !u.disabled && activeAdmins === 1;

    const m = document.createElement('div');
    m.className = 'modal user-edit-modal';
    m.style.zIndex = '300';
    m.dataset.userId = uid;

    let warnings = '';
    if (isSelf) {
        warnings += '<div style="background:#332a10;padding:8px;border-radius:6px;margin:8px 0;font-size:0.8rem;color:var(--warning)">⚠️ هذا حسابك — لا يمكنك تعديل دورك أو تعطيل نفسك</div>';
    }
    if (isLastAdmin) {
        warnings += '<div style="background:#3b1a1a;padding:8px;border-radius:6px;margin:8px 0;font-size:0.8rem;color:var(--danger)">🔴 هذا آخر مسؤول فعّال — لا يمكن تخفيضه أو تعطيله. أنشئ مسؤولاً جديداً أولاً.</div>';
    }

    const failedAttempts = u.failedLoginAttempts || 0;
    const lockedUntilDate = u.lockedUntil?.toDate?.();
    const isLocked = lockedUntilDate && lockedUntilDate > new Date();

    m.innerHTML = `
        <div class="modal-content">
            <button class="modal-close" onclick="this.closest('.modal').remove()">✕</button>
            <h3>✏️ تعديل: ${escapeHtml(u.name||'')}</h3>
            ${warnings}

            <div class="form-group">
                <label>الاسم</label>
                <input type="text" id="eu-name" class="form-control" value="${escapeHtml(u.name||'')}" maxlength="100">
            </div>

            <div class="form-group">
                <label>الدور</label>
                <select id="eu-role" class="form-control" ${(isSelf || isLastAdmin)?'disabled':''}>
                    <option value="viewer" ${u.role==='viewer'?'selected':''}>🔵 المشاهد</option>
                    <option value="staff" ${u.role==='staff'?'selected':''}>🟢 كادر المذخر</option>
                    <option value="admin" ${u.role==='admin'?'selected':''}>🔴 المسؤول</option>
                </select>
            </div>

            <div class="form-group">
                <label>الحالة</label>
                <select id="eu-status" class="form-control" ${(isSelf || isLastAdmin)?'disabled':''}>
                    <option value="active" ${!u.disabled?'selected':''}>🟢 مفعّل</option>
                    <option value="disabled" ${u.disabled?'selected':''}>🔴 معطّل</option>
                </select>
            </div>

            ${failedAttempts > 0 || isLocked ? `
                <div style="background:#3b1a1a;padding:10px;border-radius:6px;margin:8px 0">
                    <p style="margin:0;font-size:0.8rem;color:var(--danger)">
                        ⚠️ <b>محاولات دخول فاشلة (سجل قديم):</b> ${failedAttempts}
                        ${isLocked ? `<br>🔒 مغلق حتى: ${fmtDateTime(lockedUntilDate)}` : ''}
                    </p>
                    <button class="btn btn-xs btn-warning" onclick="resetFailedLogins('${escapeHtml(uid)}')" style="margin-top:6px">
                        🔓 إعادة تعيين والفتح
                    </button>
                </div>
            ` : ''}

            <div class="form-group">
                <label>إعادة تعيين كلمة المرور (اختياري)</label>
                <div style="display:flex;gap:6px">
                    <input type="checkbox" id="eu-new-pass" style="width:auto;margin:auto 4px">
                    <label for="eu-new-pass" style="font-size:0.85rem;color:var(--text2)">
                        إرسال بريد إعادة تعيين للمستخدم
                    </label>
                </div>
                <small style="color:var(--text2);font-size:0.7rem;display:block;margin-top:4px">
                    💡 المستخدم سيحدد كلمة المرور الجديدة بنفسه عبر البريد الإلكتروني — هذا أكثر أماناً.<br>
                    سيُجبر على إعادة الدخول تلقائياً.
                </small>
            </div>

            <div style="display:flex;gap:8px;margin-top:1rem;flex-wrap:wrap">
                <button class="btn btn-success" onclick="saveEditUser('${escapeHtml(uid)}')">💾 حفظ</button>
                <button class="btn" onclick="this.closest('.modal').remove()">إلغاء</button>
                ${!isSelf && !isLastAdmin ? `<button class="btn btn-warning" onclick="forceUserLogout('${escapeHtml(uid)}')">🚪 إجبار خروج</button>` : ''}
                ${!isSelf && !isLastAdmin ? `<button class="btn btn-danger" onclick="showDeleteUserDialog('${escapeHtml(uid)}')">🗑️ حذف</button>` : ''}
            </div>
            <p id="eu-err" class="text-danger" style="margin-top:8px"></p>
        </div>`;
    document.body.appendChild(m);
}

// ============================================================
// حفظ تعديلات المستخدم
// ============================================================
async function saveEditUser(uid) {
    if (!isAdmin()) {
        showToast('تعديل المستخدمين — للمسؤول فقط', 'error');
        return;
    }
    if (!requireOnline('تعديل مستخدم')) return;

    const name = sanitizeInput(document.getElementById('eu-name')?.value, 100);
    const role = document.getElementById('eu-role')?.value;
    const disabled = document.getElementById('eu-status')?.value === 'disabled';
    // 🔧 v6.8.1: checkbox boolean بدل text password
    const sendPasswordReset = document.getElementById('eu-new-pass')?.checked === true;
    const errEl = document.getElementById('eu-err');

    // فحص: هل هذا آخر admin؟
    const currentUser = (window._allUsers || []).find(x => x.id === uid);
    if (currentUser) {
        const activeAdmins = (window._allUsers || []).filter(x => x.role === 'admin' && !x.disabled).length;
        const isLastAdmin = currentUser.role === 'admin' && !currentUser.disabled && activeAdmins === 1;
        if (isLastAdmin) {
            if (role !== 'admin') {
                errEl.textContent = '🔴 لا يمكن تخفيض آخر مسؤول. أنشئ مسؤولاً جديداً أولاً.';
                return;
            }
            if (disabled) {
                errEl.textContent = '🔴 لا يمكن تعطيل آخر مسؤول.';
                return;
            }
        }
    }

    try {
        const updates = {
            name, role, disabled,
            disabledAt: disabled ? firebase.firestore.Timestamp.now() : null,
            disabledBy: disabled ? CU.email : null,
            claimSyncRequired: true,
            claimSyncedAt: null,
            updatedAt: firebase.firestore.Timestamp.now(),
            updatedBy: CU.email
        };

        // 🔧 v6.8.1: استخدم sendPasswordResetEmail بدلاً من تخزين كلمة المرور بنص صريح
        let passwordResetRequested = false;
        if (sendPasswordReset) {
            try {
                const userDoc = await db.collection('users').doc(uid).get();
                const userEmail = userDoc.data()?.email;
                if (userEmail) {
                    await auth.sendPasswordResetEmail(userEmail);
                    passwordResetRequested = true;
                    updates.forceLogout = true;
                    updates.passwordResetEmailSentAt = firebase.firestore.FieldValue.serverTimestamp();
                    updates.passwordResetEmailSentBy = CU.email;
                }
            } catch (e) {
                console.warn('فشل إرسال بريد إعادة التعيين:', e);
                showToast('⚠️ تعذّر إرسال بريد إعادة التعيين — راجع البريد المسجَّل', 'warning', 6000);
            }
        }

        await db.collection('users').doc(uid).update(updates);

        // audit (بدون كلمة المرور)
        await db.collection('auditLog').add({
            action: 'update_user',
            targetUid: uid,
            changes: {
                name, role, disabled,
                passwordResetEmailSent: passwordResetRequested
            },
            by: CU.email,
            byUid: CU.uid,
            at: firebase.firestore.FieldValue.serverTimestamp()
        });

        const u = (window._allUsers || []).find(x => x.id === uid);
        if (u) { u.name = name; u.role = role; u.disabled = disabled; u.claimSyncRequired = true; }

        const editModal = document.querySelector(`.user-edit-modal[data-user-id="${uid}"]`);
        editModal?.remove();

        if (passwordResetRequested) {
            showToast('✅ تم التحديث — أُرسل بريد إعادة تعيين كلمة المرور للمستخدم', 'success', 8000);
        } else {
            showToast('✅ تم التحديث — قد يحتاج المستخدم 5 دقائق لتفعيل الصلاحيات الجديدة', 'success');
        }
        renderUsersModalList(window._allUsers || []);
    } catch (e) {
        errEl.textContent = 'فشل: ' + e.message;
        console.error('saveEditUser error:', e);
    }
}

// ============================================================
// إعادة تعيين محاولات الدخول الفاشلة + فتح القفل
// ============================================================
// 🔧 v6.8.2: تبقى الدالة (admin authenticated → الكتابة مسموحة)
// لكن المسار الذي يُملأ هذين الحقلين (trackFailedLogin) معطَّل لأن rules
// تمنع الكتابة قبل المصادقة. إذا حاول admin تعديل lockedUntil يدوياً (عبر
// Firestore Console مثلاً)، هذه الدالة تنظفه.
async function resetFailedLogins(uid) {
    if (!isAdmin()) return;
    if (!await App.confirmAction('إعادة تعيين محاولات الدخول وفك القفل؟')) return;
    try {
        await db.collection('users').doc(uid).update({
            failedLoginAttempts: 0,
            lockedUntil: null,
            updatedAt: firebase.firestore.Timestamp.now(),
            updatedBy: CU.email
        });
        await db.collection('auditLog').add({
            action: 'reset_failed_logins',
            targetUid: uid,
            by: CU.email, byUid: CU.uid,
            at: firebase.firestore.FieldValue.serverTimestamp()
        });
        const u = (window._allUsers || []).find(x => x.id === uid);
        if (u) { u.failedLoginAttempts = 0; u.lockedUntil = null; }
        showToast('✅ تم فك القفل', 'success');
        document.querySelector('.user-edit-modal')?.remove();
        renderUsersModalList(window._allUsers || []);
    } catch (e) {
        showToast('فشل: ' + e.message, 'error');
    }
}

// ============================================================
// إجبار خروج المستخدم (إبطال refresh tokens)
// ============================================================
async function forceUserLogout(uid) {
    if (!isAdmin()) return;
    if (!await App.confirmAction('إجبار هذا المستخدم على إعادة تسجيل الدخول؟')) return;
    try {
        await db.collection('users').doc(uid).update({
            forceLogout: true,
            claimSyncRequired: true,
            updatedAt: firebase.firestore.Timestamp.now()
        });
        await db.collection('auditLog').add({
            action: 'force_logout',
            targetUid: uid,
            by: CU.email, byUid: CU.uid,
            at: firebase.firestore.FieldValue.serverTimestamp()
        });
        showToast('✅ سيُخرج المستخدم خلال 5 دقائق', 'success');
    } catch (e) {
        showToast('فشل: ' + e.message, 'error');
    }
}

// ============================================================
// 🆕 v6.4: Hybrid Delete — تعطيل أو حذف كامل
// ============================================================
function showDeleteUserDialog(uid) {
    const u = (window._allUsers || []).find(x => x.id === uid);
    if (!u) return;

    // فحص آخر admin (لا يمكن حذفه)
    const activeAdmins = (window._allUsers || []).filter(x => x.role === 'admin' && !x.disabled).length;
    const isLastAdmin = u.role === 'admin' && !u.disabled && activeAdmins === 1;
    if (isLastAdmin) {
        showToast('🔴 لا يمكن حذف آخر مسؤول فعّال', 'error');
        return;
    }
    if (uid === CU.uid) {
        showToast('لا يمكنك حذف حسابك', 'error');
        return;
    }

    const m = document.createElement('div');
    m.className = 'modal delete-user-modal';
    m.style.zIndex = '400';
    m.innerHTML = `
        <div class="modal-content" style="max-width:480px">
            <h3>🗑️ حذف: ${escapeHtml(u.name || '')}</h3>
            <p style="color:var(--text2);font-size:0.85rem">اختر طريقة الحذف:</p>

            <div style="background:#332a10;padding:12px;border-radius:8px;margin:1rem 0;border:2px solid var(--warning)">
                <h4 style="margin:0 0 6px 0;color:var(--warning)">🟡 خيار 1: تعطيل (موصى به)</h4>
                <ul style="font-size:0.82rem;color:var(--text);margin:6px 0 8px 16px;padding:0">
                    <li>السجل التاريخي يبقى محفوظاً</li>
                    <li>لا يستطيع الدخول للتطبيق</li>
                    <li>تستطيع إعادة تفعيله لاحقاً بضغطة</li>
                    <li>عمليات الصرف والوارد القديمة تبقى مربوطة باسمه</li>
                </ul>
                <button class="btn btn-warning" style="width:100%" onclick="doDisableUser('${escapeHtml(uid)}')">
                    🟡 تعطيل الحساب
                </button>
            </div>

            <div style="background:#3b1a1a;padding:12px;border-radius:8px;margin:1rem 0;border:2px solid var(--danger)">
                <h4 style="margin:0 0 6px 0;color:var(--danger)">🔴 خيار 2: حذف كامل</h4>
                <ul style="font-size:0.82rem;color:var(--text);margin:6px 0 8px 16px;padding:0">
                    <li>الحساب يُحذف من Firebase Auth</li>
                    <li>وثيقة المستخدم تُحذف من Firestore</li>
                    <li>يستطيع التسجيل ببريده مجدداً (تحتاج إنشاء حساب جديد)</li>
                    <li>⚠️ <b>لا يمكن التراجع عن هذا الفعل</b></li>
                    <li>📋 سجل عملياته القديمة تبقى لكنها تظهر "مستخدم محذوف"</li>
                </ul>
                <button class="btn btn-danger" style="width:100%" onclick="doHardDeleteUser('${escapeHtml(uid)}')">
                    🔴 حذف كامل نهائياً
                </button>
            </div>

            <button class="btn" style="width:100%;margin-top:8px" onclick="this.closest('.modal').remove()">إلغاء</button>
        </div>`;
    document.body.appendChild(m);
}

// تعطيل (Soft Delete)
async function doDisableUser(uid) {
    if (!isAdmin()) { showToast('للمسؤول فقط', 'error'); return; }
    if (!requireOnline('تعطيل المستخدم')) return;

    const u = (window._allUsers || []).find(x => x.id === uid);
    if (!u) return;

    if (!await App.confirmAction(`تأكيد تعطيل "${u.name}"؟\n(سيبقى السجل محفوظاً)`)) return;

    try {
        await db.collection('users').doc(uid).update({
            disabled: true,
            disabledAt: firebase.firestore.Timestamp.now(),
            disabledBy: CU.email,
            disabledByUid: CU.uid,
            forceLogout: true,  // إخراج فوري
            claimSyncRequired: true,
            updatedAt: firebase.firestore.Timestamp.now()
        });

        await db.collection('auditLog').add({
            action: 'disable_user',
            targetUid: uid,
            targetEmail: u.email,
            targetName: u.name,
            by: CU.email,
            byUid: CU.uid,
            at: firebase.firestore.FieldValue.serverTimestamp()
        });

        // تحديث القائمة المحلية
        u.disabled = true;
        u.disabledAt = { toDate: () => new Date() };

        showToast(`✅ تم تعطيل ${u.name}`, 'success');
        document.querySelector('.delete-user-modal')?.remove();
        document.querySelector('.user-edit-modal')?.remove();
        renderUsersModalList(window._allUsers || []);
    } catch (e) {
        showToast('فشل التعطيل: ' + e.message, 'error');
    }
}

// حذف كامل (Hard Delete)
async function doHardDeleteUser(uid) {
    if (!isAdmin()) { showToast('للمسؤول فقط', 'error'); return; }
    if (!requireOnline('حذف المستخدم')) return;

    const u = (window._allUsers || []).find(x => x.id === uid);
    if (!u) return;

    // تأكيد مزدوج للحذف الكامل
    if (!await App.confirmAction(`⚠️ تأكيد الحذف الكامل لـ "${u.name}"؟\n\n⛔ هذا الفعل لا يمكن التراجع عنه!`)) return;
    if (!await App.confirmAction(`🔴 آخر تأكيد:\nهل أنت متأكد من حذف ${u.name} (${u.email}) نهائياً؟`)) return;

    try {
        // وضع علامة "للحذف" — userSyncAgent سيحذف من Auth
        await db.collection('users').doc(uid).update({
            pendingHardDelete: true,
            disabled: true,
            disabledAt: firebase.firestore.Timestamp.now(),
            disabledBy: CU.email,
            forceLogout: true,
            claimSyncRequired: true,
            updatedAt: firebase.firestore.Timestamp.now()
        });

        // حفظ معلومات الحساب المحذوف في مجموعة منفصلة (لاكتشاف العودة)
        await db.collection('deletedUsers').doc(uid).set({
            uid,
            email: u.email,
            name: u.name,
            lastRole: u.role,
            createdAt: u.createdAt || null,
            lastLoginAt: u.lastLoginAt || null,
            deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
            deletedBy: CU.email,
            deletedByUid: CU.uid,
            // إحصاءات سريعة
            totalLogins: u.totalLogins || 0
        });

        await db.collection('auditLog').add({
            action: 'hard_delete_user_requested',
            targetUid: uid,
            targetEmail: u.email,
            targetName: u.name,
            by: CU.email,
            byUid: CU.uid,
            at: firebase.firestore.FieldValue.serverTimestamp()
        });

        showToast(`✅ تم تسجيل طلب الحذف الكامل لـ ${u.name}.\nسيُنفَّذ خلال 5 دقائق.`, 'success', 8000);
        document.querySelector('.delete-user-modal')?.remove();
        document.querySelector('.user-edit-modal')?.remove();

        // إخفاء من القائمة المحلية فوراً
        window._allUsers = (window._allUsers || []).filter(x => x.id !== uid);
        renderUsersModalList(window._allUsers);
    } catch (e) {
        showToast('فشل تسجيل الحذف: ' + e.message, 'error');
    }
}

// ============================================================
// 🆕 v6.4: اكتشاف الحسابات المحذوفة عند إضافة جديدة
// ============================================================
async function checkDeletedAccountByEmail(email) {
    if (!email || !isAdmin()) return null;
    try {
        const snap = await db.collection('deletedUsers')
            .where('email', '==', email.toLowerCase())
            .limit(1)
            .get();
        if (snap.empty) return null;
        return { id: snap.docs[0].id, ...snap.docs[0].data() };
    } catch (e) {
        console.warn('checkDeletedAccount failed:', e.message);
        return null;
    }
}

// ============================================================
// 🆕 v6.4: Dialog اكتشاف حساب محذوف عند الإنشاء
// ============================================================
function showDeletedAccountFoundDialog(deletedAccount, newData) {
    const m = document.createElement('div');
    m.className = 'modal deleted-found-modal';
    m.style.zIndex = '450';

    const deletedDate = fmtDate(deletedAccount.deletedAt);
    const lastLoginDate = deletedAccount.lastLoginAt ? fmtDate(deletedAccount.lastLoginAt) : '—';
    const createdDate = deletedAccount.createdAt ? fmtDate(deletedAccount.createdAt) : '—';

    m.innerHTML = `
        <div class="modal-content" style="max-width:540px">
            <h3>⚠️ هذا البريد كان مستخدماً سابقاً</h3>

            <div style="background:#1a2d45;padding:14px;border-radius:8px;margin:1rem 0;border:2px solid var(--primary)">
                <h4 style="margin:0 0 8px 0">📋 معلومات الحساب القديم:</h4>
                <table style="width:100%;font-size:0.85rem">
                    <tr>
                        <td style="color:var(--text2);padding:3px 0">👤 الاسم:</td>
                        <td><strong>${escapeHtml(deletedAccount.name)}</strong></td>
                    </tr>
                    <tr>
                        <td style="color:var(--text2);padding:3px 0">📧 البريد:</td>
                        <td style="font-family:monospace">${escapeHtml(deletedAccount.email)}</td>
                    </tr>
                    <tr>
                        <td style="color:var(--text2);padding:3px 0">🎫 الدور السابق:</td>
                        <td>${KADRE_LABELS[deletedAccount.lastRole] || deletedAccount.lastRole}</td>
                    </tr>
                    <tr>
                        <td style="color:var(--text2);padding:3px 0">📅 تاريخ الإنشاء:</td>
                        <td>${createdDate}</td>
                    </tr>
                    <tr>
                        <td style="color:var(--text2);padding:3px 0">🚪 آخر دخول:</td>
                        <td>${lastLoginDate}</td>
                    </tr>
                    <tr>
                        <td style="color:var(--text2);padding:3px 0">🗑️ تاريخ الحذف:</td>
                        <td>${deletedDate}</td>
                    </tr>
                    <tr>
                        <td style="color:var(--text2);padding:3px 0">👮 حُذِف بواسطة:</td>
                        <td>${escapeHtml(deletedAccount.deletedBy || '—')}</td>
                    </tr>
                </table>
            </div>

            <p style="color:var(--text2);font-size:0.85rem">ما الذي تريد فعله؟</p>

            <div style="background:#1a3a1a;padding:12px;border-radius:8px;margin:8px 0;border:2px solid var(--success)">
                <h4 style="margin:0 0 6px 0;color:var(--success)">🔄 خيار 1: إنشاء حساب جديد بنفس البريد (موصى به)</h4>
                <ul style="font-size:0.8rem;color:var(--text);margin:6px 0 8px 16px;padding:0">
                    <li>يُنشأ حساب جديد بكلمة المرور التي أدخلتها</li>
                    <li>سيستخدم نفس البريد الإلكتروني</li>
                    <li>السجل القديم يبقى في الأرشيف (تستطيع البحث عنه)</li>
                    <li>أنسب لو الموظف عاد للعمل</li>
                </ul>
                <button class="btn btn-success" style="width:100%" id="btn-create-fresh">
                    🔄 إنشاء حساب جديد بنفس البريد
                </button>
            </div>

            <div style="background:#332a10;padding:12px;border-radius:8px;margin:8px 0">
                <h4 style="margin:0 0 6px 0;color:var(--warning)">↩️ خيار 2: إلغاء وتعديل البريد</h4>
                <p style="font-size:0.8rem;margin:6px 0">
                    لو هذا شخص آخر وليس الموظف نفسه، يستحسن استخدام بريد مختلف.
                </p>
                <button class="btn" style="width:100%" onclick="this.closest('.modal').remove()">
                    ↩️ إلغاء — سأعدّل البريد
                </button>
            </div>
        </div>`;
    document.body.appendChild(m);

    // ربط الزر مع البيانات الجديدة
    document.getElementById('btn-create-fresh').onclick = async () => {
        m.remove();
        await createUserFreshAfterDeletion(newData, deletedAccount);
    };
}

// إنشاء حساب جديد بعد التأكد من اكتشاف القديم
async function createUserFreshAfterDeletion(newData, oldDeletedRecord) {
    const { name, email, pass, role } = newData;

    try {
        const secondaryApp = firebase.initializeApp(firebase.app().options, 'secondary-' + Date.now());
        const secondaryAuth = secondaryApp.auth();
        let cred;
        try {
            cred = await secondaryAuth.createUserWithEmailAndPassword(email, pass);
            await secondaryAuth.signOut();
        } finally {
            await secondaryApp.delete();
        }

        // إنشاء وثيقة المستخدم الجديد
        await db.collection('users').doc(cred.user.uid).set({
            name, email, role,
            disabled: false,
            createdAt: firebase.firestore.Timestamp.now(),
            createdBy: CU.email,
            createdByUid: CU.uid,
            lastLoginAt: null,
            failedLoginAttempts: 0,
            lockedUntil: null,
            fcmTokens: [],
            notificationsEnabled: true,
            claimSyncRequired: true,
            claimSyncedAt: null,
            forceLogout: false,
            // 🆕 إشارة أن هذا الحساب أُنشئ بعد حذف سابق
            previouslyDeletedUid: oldDeletedRecord.uid,
            previouslyDeletedAt: oldDeletedRecord.deletedAt || null
        });

        // وضع علامة "أعيد التفعيل" على السجل القديم
        await db.collection('deletedUsers').doc(oldDeletedRecord.uid).update({
            recreatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            recreatedAs: cred.user.uid,
            recreatedBy: CU.email
        });

        await db.collection('auditLog').add({
            action: 'create_user_after_deletion',
            targetUid: cred.user.uid,
            targetEmail: email,
            previousUid: oldDeletedRecord.uid,
            role,
            by: CU.email,
            byUid: CU.uid,
            at: firebase.firestore.FieldValue.serverTimestamp()
        });

        // عرض بيانات الحساب الجديد
        showCredentialsModal(name, email, pass, role);
    } catch (e) {
        if (e.code === 'auth/email-already-in-use') {
            showToast('⚠️ البريد موجود في Firebase Auth ولم يُحذف بعد. انتظر 5 دقائق وحاول مرة أخرى.', 'error', 8000);
        } else {
            showToast('فشل: ' + e.message, 'error');
        }
    }
}
