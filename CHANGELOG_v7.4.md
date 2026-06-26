# 📋 CHANGELOG v7.4 — مخزون الصيدلية

## التاريخ: يونيو 2026

## نوع الإصدار: 🔧 إصلاحات حرجة (Notifications + Reports)

---

## 🔴 الإصلاحات الحرجة

### 1. FCM Background Service Worker (كان مفقوداً!)
- **المشكلة**: `firebase-messaging-sw.js` لم يكن موجوداً → إشعارات FCM في الخلفية مكسورة كلياً
- **الحل**: إنشاء `public/firebase-messaging-sw.js` كامل مع:
  - دعم RTL/Arabic
  - tag لمنع تكرار الإشعارات
  - notificationclick handler يفتح التطبيق

### 2. توحيد Architecture اشتراك Telegram
- **المشكلة**: 3 مصادر متعارضة:
  - `telegram-notifier.js` يستخدم `/users.telegramEnabled`
  - `daily-summary.js` يستخدم `/telegramUsers.subscribeDaily`
  - `need-estimation-reminder.yml` يستخدم `/telegramUsers.subscribeReminders`
  - **النتيجة**: لا أحد يستلم الإشعارات الدورية فعلياً
- **الحل**: توحيد كل شيء على `/users` collection:
  - حقول جديدة: `subscribeDaily`, `subscribeWeekly`, `subscribeReminders`
  - حذف `/telegramUsers` كلياً
  - تحديث: `daily-summary.js`, `weekly-summary.js`, `need-estimation-reminder.yml`

### 3. UI للاشتراك في الإعدادات (كان غائباً)
- **الحل**: 3 checkboxes في صفحة الإعدادات:
  - 📊 ملخص يومي
  - 📈 ملخص أسبوعي
  - 📈 تذكيرات تقدير الاحتياج
- زر "حفظ التفضيلات" + زر "فك ربط Telegram"

### 4. VAPID Key من Firestore (لا hardcoded)
- **الحل**: VAPID_KEY يُخزَّن في `/settings/secrets/keys/vapid_key`
- UI في الإعدادات للـ admin (مثل Gemini Key)
- caching محلي + clearVapidKeyCache على التحديث

---

## 📊 إصلاحات التقارير (الرياضية)

### 5. renderTurnoverReport — كان رياضياً خاطئاً
- **قبل**: `avgStock = item.quantity` (الرصيد الحالي فقط)
- **بعد (v7.4)**: `avgStock = (openingBalance + closingBalance) / 2`
- يقرأ من `yearSummaries` (وثيقة واحدة لا 20K حركة)

### 6. renderGapReport — منطق خاطئ
- **قبل**: يقارن الرصيد بالصرف السابق
- **بعد (v7.4)**: يقارن بالاحتياج المرفوع `/yearlyNeeds/{currentYear+2}`
- مع fallback لـ `{currentYear+1}` إن لم يوجد
- رسالة واضحة إن لم توجد قائمة احتياج

### 7. renderExceededNeedReport — مفتاح خاطئ
- **قبل**: يقرأ `/yearlyNeeds/{currentYear}` بشكل غير دقيق
- **بعد (v7.4)**: مُوثَّق صراحة:
  - "في السنة 2026، الاحتياج المنفّذ = `/yearlyNeeds/2026` (الذي رُفع 2024)"

### 8. renderYoYCompareReport — YTD normalization
- **قبل**: يقارن 6 أشهر من السنة الحالية مع 12 شهر من السنة السابقة (مضلّل)
- **بعد (v7.4)**:
  - يحسب `dayOfYear` للسنة الحالية
  - يطبِّع السنة السابقة لنفس الفترة: `qtyYTD = full * dayOfYear / 365`
  - عرض 3 أعمدة: السابقة YTD، الحالية، السابقة كاملة
  - رسالة `ℹ️` للمستخدم حين تكون المقارنة جزئية

### 9. renderABCReport — division by zero
- **قبل**: إن `total === 0` → NaN في كل الـ pcts
- **بعد (v7.4)**: فحص + رسالة واضحة "لا توجد حركات صرف في {year}"

### 10. renderTopWasteReport — تصنيف منفصل
- **قبل**: مادة دُفِعت 0 + هُدر 100 → wasteRate=100% (لكن لا يميَّز عن مادة 50/50)
- **بعد (v7.4)**: تصنيفان:
  - **هدر بدون صرف** (waste-only): يُعرض أولاً بلون أحمر — يدل على إدارة سيئة للوارد
  - **هدر مع صرف**: ترتيب حسب النسبة
  - Toast warning بعدد مواد waste-only

### 11. renderDaysOfSupplyReport — 3 معدلات للموسمية
- **قبل**: معدل 90 يوم فقط (يتأثر بمواسم استثنائية مثل العمليات السيزونية)
- **بعد (v7.4)**: 3 معدلات:
  - `r30`: آخر 30 يوم (الأحدث)
  - `r90`: آخر 90 يوم (المعدل)
  - `conservative = max(r30, r90)`: المحافظ (للتنبؤ الآمن)

### 12. renderBackdatedReport — 48 ساعة + Baghdad TZ
- **قبل**: عتبة 24 ساعة + بدون tz → false positives (إدخال صباح اليوم التالي يُعدّ "بأثر رجعي")
- **بعد (v7.4)**: دالة `isMovementBackdated(m, 48)`:
  - عتبة 48 ساعة
  - حساب daysBack بـ Baghdad TZ
  - نتيجة `{ isBackdated, daysBack }`

### 13. fetchMovementsForYear — كارثة قراءات Firestore
- **قبل**: 7 تقارير × 20K حركة = 140K قراءة/زيارة → يستنزف 50K/يوم quota في ساعتين
- **بعد (v7.4)**:
  - `ReportCache` (TTL 5 دقائق، LRU 30) مشترك بين التبويبات
  - `fetchYearSummary(dept, year)` — وثيقة واحدة بدل 20K
  - `fetchMovementsForYearCached` — cache آلي
  - **النتيجة**: ~80% توفير قراءات

---

## 🔔 إصلاحات الإشعارات

### 14. TYPE_LABELS كامل
- **قبل**: ينقصها `anomaly`, `backdated`, `stagnant` → تُعرض بـ icon افتراضي
- **بعد (v7.4)**: TYPE_LABELS فيها كل الأنواع الـ 14

### 15. Cooldowns لمنع تكرار الإشعارات
- **قبل**: 5 صرف لنفس المادة = 5 إشعارات شذوذ
- **بعد (v7.4)**:
  - `anomaly`: ساعة لنفس المادة
  - `backdated`: يوم لنفس المادة
  - `stagnant`: أسبوع لنفس القسم
- `checkCooldown(key, ttlMs)` helper في utils.js

### 16. Anomaly cache + عتبة 2σ
- **قبل**: 3σ صارمة جداً (الإشعارات نادرة جداً)
- **بعد (v7.4)**:
  - 2σ + شرط نسبي (>50% من المتوسط) → فعّال فعلياً
  - cache 10 دقائق للحركات (لا يجلب 30 حركة كل صرف)

### 17. IntersectionObserver للتعليم كمقروء
- **قبل**: كل 200 إشعار عند فتح الصفحة → batch update 200 doc
- **بعد (v7.4)**:
  - مراقبة `data-unread="1"` بـ IntersectionObserver
  - threshold 0.5 (الإشعار ظاهر فعلاً)
  - batch update فقط للظاهرة → توفير writes

### 18. Pagination حقيقي للإشعارات
- **قبل**: حد 200 ثابت
- **بعد (v7.4)**:
  - `NotifState` يحتوي على `lastDocSnap` cursor
  - زر "تحميل المزيد" يُحمَّل 50 إضافي
  - hasMore يخفي الزر عند الانتهاء

### 19. InternalNotif sessionStorage
- **قبل**: dismissed banners تعود بعد كل refresh
- **بعد (v7.4)**:
  - sessionStorage `pharmacy_dismissed_notifs`
  - memoization (لا حساب 2500 iteration كل مرة)
  - `invalidate()` + `clearDismissed()` methods

### 20. window._notifLogs → closure
- **قبل**: global pollution
- **بعد (v7.4)**: `NotifState` closure داخل IIFE

### 21. PDF بـ jsPDF بدلاً من window.open
- **قبل**: window.open يفتح نافذة جديدة بـ HTML → المستخدم يحفظ يدوياً
- **بعد (v7.4)**: jsPDF + autoTable → ملف PDF مباشر

### 22. checkStagnantItems يُستدعى فعلياً
- **قبل**: دالة معرَّفة لكن لا يستدعيها أي شيء
- **بعد (v7.4)**: مصدران:
  - زر يدوي في صفحة الإعدادات (للأدمن)
  - GitHub Action `stagnant-check.yml` (كل أحد 9 صباحاً بغداد)

### 23. تنظيف OTPs تلقائياً
- **قبل**: OTPs تتراكم للأبد
- **بعد (v7.4)**: `cleanup-otps.yml` يومي 3 صباحاً يحذف:
  - OTPs منتهية الصلاحية
  - telegramQueue (sent/failed >7 أيام)
  - notificationsLog (>90 يوم)
  - auditLog (>1 سنة)

---

## 🆕 ميزات جديدة

### 24. تقرير "توفر الأولوية الاستيرادية"
- متطلب وزاري عراقي: A1 ≥ 95%، A2 ≥ 90%، A ≥ 80%
- يُحسب نسبة المواد المتوفرة (qty>0) من كل فئة
- يعرض قائمة منفصلة لـ A1/A2 المفقودة (الحرجة)

### 25. تجميع التبويبات في 4 مجموعات
- **قبل**: 22 تبويب في صف واحد → صعب التنقل
- **بعد (v7.4)**:
  - 📊 نظرة (لوحة + سجل + عاملون + بأثر رجعي)
  - 🔄 الحركة (مشتريات + دائرة + جهات + دوران)
  - ⚠️ تنبيهات (مفقودة + قريبة النفاذ + قريبة الانتهاء + بطيئة + جديدة + هدر)
  - 🔬 تحليل (مدى الأمان + ABC + فجوة + تجاوز + YoY + توفر الأولوية + سنوية + جرد + هدر)

### 26. حفظ آخر تبويب + مجموعة
- sessionStorage يحفظ آخر تبويب + مجموعة
- عند العودة لصفحة التقارير → يعود لنفس التبويب

### 27. Audit Log لكل تصدير
- متطلب لمستشفى حكومي
- `auditExport(reportName, format, rowCount, extra)` يكتب في `/auditLog`:
  - من صدّر؟
  - ما التقرير؟
  - متى؟
  - كم صف؟
- watermark في رأس كل Excel: "صدّره: X | التاريخ | المستشفى"

### 28. exportXlsxAudited موحَّد
- تنظيف HTML من الخلايا (regex)
- watermark + audit log في عملية واحدة
- يُستخدم في كل التقارير

---

## 🗂️ ملفات جديدة

### Frontend
- `public/firebase-messaging-sw.js` ← FCM background SW
- `public/js/core/report-cache.js` ← ReportCache + helpers
- `public/js/utils/audit-export.js` ← auditExport + exportXlsxAudited

### Backend (Scripts)
- `scripts/stagnant-check.js` ← فحص الراكدة الأسبوعي
- `scripts/cleanup-otps.js` ← التنظيف اليومي

### GitHub Workflows
- `.github/workflows/stagnant-check.yml`
- `.github/workflows/cleanup-otps.yml`

---

## 🔧 ملفات معدَّلة (Frontend)

- `public/index.html` ← تحميل الملفات الجديدة + رقم v7.4
- `public/css/app.css` ← أنماط `notif-unread`
- `public/js/core/utils.js` ← `isMovementBackdated`, `checkCooldown`, `getVapidKey`
- `public/js/notifications.js` ← إعادة كتابة كاملة (~700 سطر)
- `public/js/settings.js` ← UI الإشعارات + VAPID + Stagnant button
- `public/js/dashboard.js` ← حذف `switchReportsTab` مكرر + `buildTopAlerts` يستخدم InternalNotif
- `public/js/features/internal-notif.js` ← sessionStorage + memoization
- `public/js/features/telegram-notifier.js` ← توحيد `/users` + new prefs API
- `public/js/features/reports-v73.js` ← `switchReportsTab` واحد + yearSummaries + audit
- `public/js/features/reports-v73-ledger.js` ← fallback `m.importPriority` + audit
- `public/js/features/reports-v73-advanced.js` ← كل الإصلاحات الرياضية + تقرير جديد

## 🔧 ملفات معدَّلة (Backend)

- `scripts/daily-summary.js` ← قراءة من `/users` + log في notificationsLog
- `scripts/weekly-summary.js` ← نفس
- `scripts/package.json` ← v7.4 + scripts جديدة
- `.github/workflows/need-estimation-reminder.yml` ← قراءة من `/users`

## 🔧 ملفات معدَّلة (Firebase Config)

- `firestore.rules` ← حذف `/telegramUsers` + إضافة `/telegramOTPs` + `/settings/secrets/keys/{keyName}`
- `firestore.indexes.json` ← حذف telegramUsers + إضافة users.subscribeXxx + notificationsLog indexes

---

## 🚀 خطوات النشر

### 1. النشر بترتيب صحيح (مهم جداً)
```bash
# الـ indexes أولاً (وإلا failed-precondition errors)
firebase deploy --only firestore:indexes

# انتظر بضع دقائق للـ index build

# ثم القواعد
firebase deploy --only firestore:rules

# ثم الـ hosting
firebase deploy --only hosting
```

### 2. إعداد VAPID Key (مطلوب لـ FCM)
1. Firebase Console → Project Settings → Cloud Messaging
2. Web Push certificates → Generate key pair
3. انسخ الـ key الناتج (يبدأ بـ `B...`)
4. ادخل التطبيق → الإعدادات (كـ admin)
5. الصق VAPID Key → احفظ

### 3. هجرة Telegram (يدوي مرة واحدة)
- إذا كان لديك بيانات في `/telegramUsers` collection، احذفها يدوياً من Firebase Console
- المستخدمون سيحتاجون لإعادة ضبط تفضيلاتهم من صفحة الإعدادات

### 4. GitHub Secrets المطلوبة
- `FIREBASE_SA` (Service Account JSON)
- `TELEGRAM_BOT_TOKEN` (من @BotFather)

---

## 📊 أثر الإصلاحات

| المقياس | قبل v7.4 | بعد v7.4 |
|---------|----------|----------|
| قراءات Firestore لفتح صفحة التقارير | 100K-140K | 20K-30K |
| FCM background notifications | ❌ معطلة | ✅ تعمل |
| إشعارات Telegram الدورية | ❌ لا تصل | ✅ تصل |
| Anomaly detection | 🟡 شبه معطل (3σ) | ✅ فعّال (2σ + 50%) |
| Stagnant check | ❌ لا يُستدعى | ✅ أسبوعي + يدوي |
| OTPs cleanup | ❌ تتراكم | ✅ يومي |
| Audit للتصدير | ❌ غير موجود | ✅ في كل تصدير |
| دقة Turnover | ❌ خاطئ | ✅ (open+close)/2 |
| دقة YoY | ❌ مضلل | ✅ YTD مطبَّع |
| تكرار الإشعارات | ❌ بدون cooldown | ✅ cooldowns ذكية |

---

## ⚠️ ملاحظات الـ Backward Compatibility

1. **`/telegramUsers`** لم يعد يُستخدم — لا breakage لأن لا أحد يقرأ منها بعد v7.4
2. **رسائل خطأ في console** بعد النشر: قد ترى محاولات قراءة من `telegramUsers` من Workflows القديمة لو لم تحدّث الـ workflows. الحل: نشر الكل دفعة واحدة.
3. **VAPID_KEY**: إذا لم تُعدّه، FCM لن يعمل لكن التطبيق سيشتغل بدونها (no breakage).

---

*— Pharmacy Inventory v7.4 — مستشفى الشطرة العام*
