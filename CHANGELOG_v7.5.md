# CHANGELOG v7.5 — إصلاحات شاملة لـ 24 نقطة حرجة

**التاريخ**: 23 يونيو 2026  
**الإصدار السابق**: v7.4  
**سياق النشر**: بداية فارغة 2026، لا بيانات تاريخية، لا حاجة لهجرة

---

## 🔴 إصلاحات معمارية حرجة (Critical Architecture)

### #1. مزامنة Custom Claims (كانت مفقودة كلياً)

**المشكلة في v7.4**: الكود يُشير في 6 مواقع إلى `claimSyncRequired:true` و`auth.js` ينتظر `tokenResult.claims.role`، لكن **لا يوجد أي سكربت ينفّذ `admin.auth().setCustomUserClaims()`**. النتيجة: المستخدم الجديد عالق في شاشة "تحضير حسابك" للأبد.

**الإصلاح**:
- `scripts/sync-claims.js` — سكربت جديد يقرأ كل مستخدم بـ `claimSyncRequired:true`، يضع claims على Firebase Auth، يستدعي `revokeRefreshTokens` لإجبار token refresh، ويُحدّث Firestore.
- `.github/workflows/sync-claims.yml` — يعمل كل 5 دقائق + يدوياً عبر `workflow_dispatch`.
- **يحل أيضاً #19** (forceLogout loop): يمسح `forceLogout` بعد revoke.

**ما يحتاجه عند النشر**: إضافة `FIREBASE_SA` secret في GitHub repo (service account JSON).

---

### #2. بناء yearSummaries (كان وعداً فارغاً في v7.4)

**المشكلة في v7.4**: CHANGELOG ادّعى "80% توفير قراءات" بقراءة من `/yearSummaries/{dept}-{year}`، لكن لا يوجد كود يكتب لها. كل تقرير يدخل المسار الاحتياطي (20K حركة).

**الإصلاح**:
- `scripts/build-year-summary.js` — يجمّع كل حركات السنة بصفحات (2000/صفحة)، يحسب opening/closing من `balanceSnapshots`، يحفظ في `/yearSummaries/{dept}-{year}`.
- `.github/workflows/build-year-summary.yml`:
  - 1 يناير 4 صباحاً بغداد → يبني السنة السابقة كاملة
  - كل أربعاء 4 صباحاً → يحدّث السنة الحالية (running total)
  - يدوياً عبر `workflow_dispatch` مع `target_year` parameter

**لـ 2026 الجديد**: ليس بحاجة لشيء على الفور (لا بيانات سابقة). أول تشغيل تلقائي مفيد سيكون في يناير 2027 (لبناء ملخص 2026).

---

### #3. حذف التعارض في firestore.rules

**المشكلة في v7.4**: نفس المسار `/settings/secrets/keys/{...}` معرَّف مرتين في الـ rules — السطور 106-109 (`isStaff` read) و190-193 (`isAuth` read). Firestore يأخذ الاتحاد → **أي مستخدم مسجَّل دخول (حتى viewer) يستطيع قراءة Gemini API key، VAPID key، Telegram bot token**.

**الإصلاح**: `firestore.rules` أُعيدت كتابتها من الصفر بقاعدة واحدة فقط لـ `/settings/secrets/keys/{secretName}` تسمح القراءة لـ `isStaff()` فقط. القواعد الأخرى (`/settings/general`, `/settings/{docId}`) منفصلة ولا تتعارض.

---

### #4. منع رفع المستخدم لصلاحيات نفسه

**المشكلة في v7.4**: قاعدة `/users/{uid}` تسمح `allow update: if isAuth() && request.auth.uid == uid` بدون فلتر حقول. المستخدم يستطيع من Console:
```js
db.collection('users').doc(MY_UID).update({ disabled: false, role: 'admin' });
```

**الإصلاح**: helper جديد `userSelfUpdateSafe()` يحظر تعديل أي من هذه الحقول من المستخدم نفسه:
- `role`, `disabled`, `forceLogout`
- `claimSyncRequired`, `claimSyncedAt`, `claimSyncedRole`, `claimSyncedDisabled`
- `createdBy`, `createdByUid`, `createdAt`
- `disabledAt`, `disabledBy`
- `failedLoginAttempts`, `lockedUntil`
- `pendingHardDelete`

الـ admin يستطيع تعديل كل شيء (مسار منفصل في الـ rule).

---

## 🔴 إصلاحات أمنية (Security)

### #5. OTP بـ `crypto.getRandomValues` بدل `Math.random`

**المشكلة**: `Math.random()` قابل للتنبؤ. OTPs كانت قابلة لتخمين تقريبي + الـ OTP نفسه هو doc ID (enumerable).

**الإصلاح**:
- `settings.js:354` (Telegram link OTP 6 أرقام) — استخدام `crypto.getRandomValues(new Uint32Array(1))[0] % 900000`
- `telegram-notifier.js:141` (Telegram pairing OTP 6 أحرف) — استخدام `crypto.getRandomValues(new Uint8Array(6))` مع abc محدودة `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (بدون O/0/I/1 للوضوح)

---

### #6. CSP محسَّن (إصلاح جزئي مع توثيق المتبقي)

**المشكلة الأصلية**: CSP يستخدم `'unsafe-inline'` للـ scripts والـ styles → أي XSS يُنفّذ JavaScript كاملاً.

**الإصلاح في v7.5**:
- ✅ أُضيف `base-uri 'self'` (يمنع `<base>` tag hijacking)
- ✅ أُضيف `form-action 'self'`
- ✅ أُضيف `frame-src 'none'`
- ✅ أُضيف `upgrade-insecure-requests` (HTTP → HTTPS تلقائياً)

**ما لم يُحَل** (يحتاج refactor كبير في v7.6):
- ⚠️ `'unsafe-inline'` ما زالت موجودة. إزالتها تتطلب تحويل المئات من `onclick="..."` و`oninput="..."` و`onkeydown="..."` إلى `addEventListener`.
- هذا عمل ~50-100 ساعة. مرشح لـ v7.6.

---

### #9. حماية من Excel/CSV Formula Injection

**المشكلة**: `audit-export.js` لا ينظّف خلايا تبدأ بـ `= + - @ TAB CR`. مستخدم يدخل في ملاحظة `=cmd|'/c calc'!A1` → عند تصدير لـ Excel وفتحه على جهاز آخر يُنفَّذ كأمر.

**الإصلاح**: دالة جديدة `sanitizeExcelCell()` تضع `'` في بداية أي خلية تبدأ بحرف خطر. Excel يتعامل مع `'` كـ "هذا نص حرفي، لا تفسّره صيغة". تُطبَّق على كل خلية في كل تصدير `exportXlsxAudited`.

---

### #11. Screen Lock مُحسَّن (لكن ليس حماية حقيقية)

**المشكلة**: الـ lock مجرد CSS overlay، Firebase session ما زالت نشطة، DevTools يتجاوزانه.

**الإصلاح في v7.5** (تحسينات، ليس حلاً كاملاً):
- ✅ حد أقصى 3 محاولات خاطئة → `signOut()` تلقائي
- ✅ تأخير متصاعد بين المحاولات (0→1→3→5 ثواني)
- ✅ حفظ حالة القفل في `sessionStorage` — يصمد بين تبويبات نفس الجلسة
- ✅ تسجيل في `auditLog` عند بلوغ الحد الأقصى

**ما لم يُحَل** (طبيعة المعمار): DevTools/Console ما زال يتجاوز الـ lock. للحماية الحقيقية: قلِّل `sessionTimeout` في Firebase Auth.

---

## 🟠 إصلاحات بيانات وموثوقية (Data Integrity & Reliability)

### #7. Cooldowns مستمرة عبر reload (localStorage)

**المشكلة في v7.4**: `_notifCooldowns` في الذاكرة فقط. reload = مسح cooldowns = تكرار الإشعارات.

**الإصلاح**: `core/utils.js` يحفظ كل تحديث للـ cooldowns في `localStorage` (مفتاح: `pharmacy_notif_cooldowns_v75`). محاط بـ try/catch لـ private mode.

---

### #8. الاحتفاظ بـ auditLog 7 سنوات للأحداث الحرجة

**المشكلة في v7.4**: `cleanup-otps.js` يحذف كل auditLog أقدم من سنة. مخالف لمتطلبات MOH العراقية (5-10 سنوات).

**الإصلاح في `scripts/cleanup-otps.js`**: حذف انتقائي:
- **الإجرائية (1 سنة)**: `login_success`, `report_export`, `cleanup_run`, `failed_login_attempt`
- **الحرجة (7 سنوات)**: `dispense`, `wastage`, `receive`, `add_item`, `dispense_document_created`, `create_user`, `update_user`, `delete_user`, `hard_delete_user`, `api_key_updated`, `password_reset_requested`, `claims_sync_run`, `year_summary_built`, `monthly_snapshot`

ينفّذ الحذف لكل `action` على حدة لتجنُّب الحاجة لـ composite index.

---

### #10. Race Condition في استلام دفعة مكررة

**المشكلة في v7.4**: `inventory.js:792` يفحص duplicate batch خارج الـ transaction. بين الفحص والـ commit، مستخدم آخر قد يضيف نفس الـ batch.

**الإصلاح**: استخدام `deterministicBatchId = ${safeBatchNum}__${expHash}` كـ doc ID للدفعة. داخل الـ transaction:
- `tx.get(deterministicBatchId)` يفحص الوجود ذرّياً
- إذا موجود (نفس رقم الدفعة، نفس انتهاء) → دمج (زيادة الكمية + `lastTopUpAt`)
- إذا غير موجود → `tx.set` ينشئ جديدة

النتيجة: لا dual batches بنفس الرقم والانتهاء. FEFO يظل دقيقاً.

---

### #16. حلّ تصادم Document IDs

**المشكلة في v7.4**: `code.replace(/[\/\\\.\#\$\[\]]/g, '_').slice(0, 100)` يجعل `01.234` و `01_234` يُنتجان نفس `safeDocId`. مستخدم لا يفهم لماذا "الرمز موجود".

**الإصلاح في `inventory.js:177`**:
- regex أوسع: يشمل spaces، tabs، newlines، zero-width chars
- دمج `_` متكررة، إزالة من البداية/النهاية
- **فحص field-level على `code`** قبل الـ transaction → يكتشف التصادمات الحقيقية
- خطأ منفصل `DOCID_COLLISION` مع رسالة واضحة: "عدّل الرمز قليلاً"

---

### #17. حساب `daysBack` بـ Baghdad TZ

**المشكلة في v7.4**: `Math.floor((new Date() - dispDateObj) / 86400000)` بدون توقيت بغداد. حركة في 1 صباحاً بغداد + dispDate أمس → 0 أيام بـ UTC لكن 1 يوم بـ Baghdad TZ.

**الإصلاح في `inventory.js:643`**: استخدام `isMovementBackdated(mockMov, 48)` الموجود في `utils.js` (محسوب بـ Asia/Baghdad).

---

### #18. `serverTimestamp` داخل receive transaction

**المشكلة في v7.4**: `lastReceivedAt: firebase.firestore.Timestamp.now()` و `receivedDate: ...Timestamp.now()` تستخدم وقت العميل. ساعة العميل خاطئة → بيانات خاطئة.

**الإصلاح في `inventory.js`**: تحويل لـ `firebase.firestore.FieldValue.serverTimestamp()`. كذلك في `add_item` (السطور 187+).

---

### #19. forceLogout يُمسَح تلقائياً

**المشكلة في v7.4**: بعد admin يضع `forceLogout: true`، المستخدم يخرج، يعود يدخل، يخرج مجدداً للأبد (لا أحد يمسح الـ flag).

**الإصلاح**: `sync-claims.js` يمسح `forceLogout: false` بعد `revokeRefreshTokens`. السيناريو:
1. admin → `forceLogout: true` + `claimSyncRequired: true` (الـ users.js يضعهما معاً)
2. sync-claims (كل 5 دقائق) → revoke + claim sync + clear forceLogout
3. المستخدم → سُحب refresh token، يجب re-login، forceLogout=false → لا حلقة

---

## 🟡 إصلاحات أداء وكاش (Performance & Caching)

### #20. تحذير عند بلوغ HARD_LIMIT

**المشكلة في v7.4**: `report-cache.js` يحدّ بـ 20000 (movements) و 5000 (dispense rate) بدون أي تحذير. بيانات صامتة مفقودة في التقارير.

**الإصلاح في `report-cache.js`**:
- إذا `snap.size >= HARD_LIMIT_MOVEMENTS` → `console.warn` + `showToast` ظاهر للمستخدم
- إذا `snap.size >= HARD_LIMIT_DISPENSE` → نفس الشيء (warning toast)
- يُضاف `data._hitLimit = true` للمستهلك (يستطيع التحقق برمجياً)

---

### #21. ReportCache.invalidateAfterMovement

**المشكلة في v7.4**: بعد صرف/استلام، `MovementsCache` و `LedgerCacheV2` تُمسَح، لكن **`ReportCache` لا**. النتيجة: تقارير قديمة 5 دقائق.

**الإصلاح**:
- `report-cache.js` — دالة جديدة `ReportCache.invalidateAfterMovement(dept)` تمسح prefixes: `ys:`, `myc:`, `dr90:` للقسم
- `inventory.js` (dispense, receive, wastage) — تستدعيها بعد كل commit
- `multi-batch-dispense.js` — تستدعيها بعد commit الطلبية الكبيرة

---

### #22. فحص قبلي لحد Firestore 500-op/transaction

**المشكلة في v7.4**: `multi-batch-dispense.js` يدخل transaction لـ 60+ مادة قد تتجاوز 500 op → الطلبية كاملة ترفض.

**الإصلاح في `multi-batch-dispense.js:551`**: حساب تقديري للـ ops قبل بدء الـ transaction:
```
ops ≈ items×2 + sum(batches×2) + items + 3
```
إذا تجاوز 450 (هامش أمان 50) → رسالة واضحة: "قسّم القائمة على 2-3 طلبيات أصغر".

---

## 🟢 إصلاحات صغيرة (Minor Fixes)

### #12. إصلاح خطأ مطبعي في `audit-export.js`

`(sheetName || sheetName).slice(0, 30)` → `(sheetName || 'Report').slice(0, 30)`

---

### #13. حذف Indexes مكررة

في `firestore.indexes.json` كانت توجد indexes مكررة (`auditLog` بـ `action+at` و `telegramQueue` بـ `status+createdAt`). الـ `firebase deploy` كان يفشل أحياناً. الـ JSON أُعيدت كتابته من الصفر بدون تكرار.

---

### #14. تحديث SW_VERSION

`public/sw.js`: `SW_VERSION = 'v7.1'` → `v7.5`. كان يمنع إعادة تثبيت SW عند الترقية.

---

### #15. firebase-messaging-sw.js في no-cache headers

`firebase.json`: أُضيف header `/firebase-messaging-sw.js` لمنع تخزين متصفح. كان فقط `/sw.js` موجوداً. تحديث `firebase-messaging-sw.js` لم يكن يصل المتصفحات.

تم أيضاً تشديد headers الأخرى:
- `Cross-Origin-Opener-Policy: same-origin` (إضافة)
- `Permissions-Policy` أضيف `interest-cohort=()` (يعطّل FLoC)

---

### #23. تعليمات SRI (Subresource Integrity)

**كان مطلوباً**: إضافة `integrity="sha384-..."` لكل CDN script.

**ما لم نُنجزه**: حساب hashes فعلية يتطلب الوصول لـ `www.gstatic.com` و `cdn.jsdelivr.net` (ممنوع في بيئة العمل).

**ما قدّمناه بدلاً**:
- `scripts/compute-sri.sh` — سكربت bash يحسب hashes ويُخرج الـ attributes جاهزة للنسخ
- شرح واضح في `index.html` (تعليق فوق `<script>` tags)

**خطوة منك بعد تنزيل v7.5**: 
```bash
bash scripts/compute-sri.sh
# انسخ الـ output → ضع integrity في index.html → deploy
```

⚠️ **مهم**: SRI hashes يجب تحديثها كلما حدّثت نسخة مكتبة في CDN URL. (أو استخدم npm + bundling في v7.6).

---

### #24. تسجيل بدل ابتلاع الأخطاء (الحرجة فقط)

**المشكلة**: 20 `catch(() => {})` صامت في الـ codebase. الأهم منها:

**أُصلح في v7.5**:
- `auth.js:127` (password_reset audit) → `catch(e => console.warn('audit password_reset_requested:', e.message))`
- `auth.js:213` (lastLoginAt update) → نفس النمط
- `auth.js:218` (login_success audit) → نفس + إضافة `byUid: user.uid` (مطلوب من rules الجديدة)
- `inventory.js:646` (recalcEarliestExpiry) → تسجيل (consistency)
- `inventory.js:625` (addToSupplyQueue) → تسجيل (purchasing flow)
- `multi-batch-dispense.js` (recalc batch) → تسجيل

**لم يُغيَّر** (صامت بقصد، لأن الفشل غير حرج):
- PWA install prompt
- نُسخ FCM token (لا تؤثر على workflow)
- ConnectionMonitor.check
- cacheBatchNumbers (warming)
- _saveInstantNotif (الإشعارات اللحظية - فشلها ليس حرجاً)

---

## 📋 خطوات النشر (Deployment Steps)

### المتطلبات الجديدة

#### 1. GitHub Secrets
- **`FIREBASE_SA`** — Service Account JSON من Firebase Console → Project Settings → Service accounts → Generate new private key. هذا الـ secret يجب أن يكون موجوداً ليعمل sync-claims و build-year-summary.

#### 2. الـ Workflows الجديدة
- `.github/workflows/sync-claims.yml` — يعمل كل 5 دقائق (cron: `*/5 * * * *`)
- `.github/workflows/build-year-summary.yml` — يناير 1 + كل أربعاء

#### 3. الـ Rules + Indexes
```bash
firebase deploy --only firestore:rules,firestore:indexes
```

#### 4. الـ Hosting
```bash
firebase deploy --only hosting
```

#### 5. SRI (اختياري لكن موصى به)
```bash
bash scripts/compute-sri.sh
# ضع الـ integrity attributes في public/index.html ثم:
firebase deploy --only hosting
```

### اختبارات بعد النشر

| اختبار | كيف تتأكد |
|--------|-----------|
| sync-claims يعمل | أنشئ مستخدماً جديداً → انتظر 5 دقائق → افحص أنه يدخل بدون شاشة "تحضير" |
| forceLogout cycle | admin يضع forceLogout=true → المستخدم يخرج → بعد 5 دقائق يدخل بدون مشاكل |
| Rules ضد escalation | كـ viewer، جرّب `db.collection('users').doc(MY_UID).update({role:'admin'})` → يجب أن يفشل |
| Rules ضد قراءة المفاتيح | كـ viewer، جرّب `db.collection('settings').doc('secrets').collection('keys').doc('gemini').get()` → يجب أن يفشل |
| Cache invalidation | افتح تقرير → اصرف مادة → افتح التقرير → الحركة الجديدة موجودة فوراً |
| Excel injection | أدخل في حقل ملاحظة `=cmd|'/c calc'!A1` → صدّر Excel → الخلية تظهر كنص حرفي |

---

## 📊 إحصائيات v7.5

- **ملفات معدَّلة**: 14
- **ملفات جديدة**: 4 (sync-claims.js, build-year-summary.js, 2 workflows + compute-sri.sh)
- **أسطر مضافة**: ~1200
- **أسطر محذوفة**: ~150
- **اختراقات أمنية مُغلقة**: 4 (#3 مفاتيح API, #4 escalation, #5 OTP, #9 Excel)
- **مشاكل بيانات مُغلقة**: 5 (#10 race, #16 collision, #17 TZ, #18 timestamp, #21 cache)

---

## 🚫 ما لم يُحَل في v7.5 (مُخطَّط لـ v7.6)

1. **CSP `'unsafe-inline'`** — يتطلب تحويل ~300+ inline event handler. خطة v7.6.
2. **Screen Lock حقيقي** — يتطلب re-architecture كامل (مثلاً Wrap كل DOM في dom shadow + re-encrypt local state). v7.7+
3. **SRI hashes تلقائية** — يتطلب إضافة build step (npm + bundler). v7.6.
4. **Rate limiting على Telegram bot** — البوت خارج هذا الـ repo. يحتاج إضافة هناك.
5. **Sentry/error tracking** — جميع `console.warn` المُضافة في v7.5 محلية. إضافة Sentry/error tracking في v7.6.

---

## 🙏 شكر

إذا واجهت أي مشكلة في النشر أو سلوك غير متوقع، افحص:
1. **Console** (DevTools → Console) — كل `console.warn` المُضافة في v7.5 ستظهر هنا
2. **Firestore Console → auditLog** — كل عملية مهمة مسجلة الآن
3. **GitHub Actions → Workflows** — تحقق أن `sync-claims` يعمل كل 5 دقائق

— v7.5 — 23 يونيو 2026
