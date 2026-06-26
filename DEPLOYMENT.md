# دليل النشر (DEPLOYMENT.md) — v7.5

دليل عملي مختصر لإعداد النشر التلقائي. الإعداد لمرة واحدة (~15 دقيقة). بعدها كل نشر = 5 ضغطات من أي جهاز.

---

## 📋 ما الذي ستحصل عليه

- نشر بضغطة من الموبايل (GitHub app) أو من الـ laptop (المتصفح)
- نفس الإجراء على الجهازين، لا فرق
- audit trail تلقائي في GitHub Actions
- لا حاجة لتشغيل `firebase deploy` يدوياً على أي جهاز
- Service Account محفوظ في GitHub Secrets، ليس على أي laptop

---

## 🛠 الإعداد لمرة واحدة (15 دقيقة)

### الخطوة 1: إنشاء Service Account في Firebase

من **الموبايل** أو **laptop**، افتح:
**https://console.firebase.google.com**

ثم:
1. اختر مشروع **phzain14**
2. الترس ⚙️ (أعلى يسار) → **Project settings**
3. تبويب **Service accounts**
4. مرّر للأسفل → اضغط **Generate new private key**
5. تأكيد → سيتنزّل ملف JSON على الجهاز (احفظه مؤقتاً)

### الخطوة 2: إضافة الصلاحيات اللازمة

من **https://console.cloud.google.com/iam-admin/iam?project=phzain14**:

1. ابحث عن Service Account الذي أنشأته (سيظهر باسم مثل `firebase-adminsdk-xxxxx@phzain14.iam.gserviceaccount.com`)
2. اضغط ✏️ (تعديل)
3. **ADD ANOTHER ROLE** → أضف كل هذه:
   - `Firebase Hosting Admin`
   - `Firebase Rules Admin`
   - `Cloud Datastore Index Admin`
   - `Firebase Authentication Admin` (لـ sync-claims)
   - `Cloud Datastore User`
4. **SAVE**

> ⚠️ إذا الـ SA الذي أنشأته في الخطوة 1 لا يظهر في IAM، انتظر دقيقة وحدّث الصفحة.

### الخطوة 3: إضافة الـ Secret إلى GitHub

من **github.com/USERNAME/phzain-pharmacy** (استبدل بالـ repo الخاص بك):

1. **Settings** (أعلى الـ repo)
2. القائمة اليسرى → **Secrets and variables** → **Actions**
3. اضغط **New repository secret**
4. **Name**: `FIREBASE_SA`
5. **Secret**: افتح ملف JSON الذي حمَّلته، انسخ **كل المحتوى** والصقه هنا
6. **Add secret**

> ✅ ملف الـ JSON لم يعد بحاجة له على الجهاز. احذفه (مهم — أمان).

### الخطوة 4: تأكد من وجود `.firebaserc`

يجب أن يكون موجوداً في root الـ repo بهذا المحتوى:
```json
{
  "projects": {
    "default": "phzain14"
  }
}
```

موجود في v7.5 zip الذي أرسلته. لو فُقد، أنشئه.

### الخطوة 5: Push كل ملفات v7.5 إلى الـ repo

من الـ laptop عبر GitHub Desktop:
1. انسخ كل محتوى v7.5 إلى مجلد الـ repo (أو افتح zip وانسخ)
2. GitHub Desktop سيكتشف التغييرات
3. Commit message: `v7.5 — 24 fixes + auto-deploy workflow`
4. **Push origin**

---

## 🚀 النشر — كل مرة بعد ذلك

### من الموبايل (GitHub app):

1. افتح GitHub app
2. اختر الـ repo
3. تبويب **Actions** (الترس أسفل الشاشة أو القائمة العلوية)
4. اختر workflow **"🚀 نشر إلى الإنتاج"**
5. زر **Run workflow** (أعلى يمين)
6. **target**: اختر ما تريد نشره:
   - `hosting` — التطبيق فقط (الأكثر شيوعاً)
   - `rules` — Firestore rules + indexes فقط
   - `all` — كل شيء
7. **confirm**: اكتب بالضبط `نشر`
8. اضغط **Run workflow**

### من الـ laptop (المتصفح):

نفس الإجراء عبر **github.com** في Chrome/Firefox. الواجهة متطابقة تماماً.

### متابعة التقدم:

- بعد الضغط على Run، ستظهر workflow run جديد في القائمة
- اضغط عليه لمتابعة الـ logs مباشرة
- ⏱️ المدة المتوقعة: **60-90 ثانية للـ hosting**، **5-10 دقائق للـ indexes** (لكن indexes تبدأ البناء في الخلفية، الـ workflow يكتمل قبل ذلك)

### إذا فشل النشر:

اضغط على الـ run الفاشل → افتح step الذي فشل → اقرأ الـ error log. الأسباب الشائعة:

| الخطأ | السبب | الحل |
|------|------|------|
| `FIREBASE_SA secret not found` | لم تُضف الـ secret | راجع الخطوة 3 |
| `Permission denied on hosting` | الـ SA يفتقر صلاحية | راجع الخطوة 2، أضف Firebase Hosting Admin |
| `Permission denied on rules` | نفس السبب | أضف Firebase Rules Admin |
| `Indexes deploy timed out` | indexes كبيرة | غير حقيقي — الـ workflow ينجح، indexes تكمل البناء في الخلفية |
| `Confirm field doesn't match` | كتبت غير "نشر" بالضبط | اكتب بالضبط `نشر` بدون مسافات ولا فواصل |

---

## 🔧 صيانة دورية

### Service Account Key — إعادة التدوير (روتيري كل 90 يوم)

أمنياً، الـ SA keys يجب تجديدها بانتظام:

1. Firebase Console → Service Accounts → Generate new private key
2. GitHub → Settings → Secrets → `FIREBASE_SA` → **Update**
3. Firebase Console → Service Accounts → Manage all service account keys → احذف القديم

ضع تذكيراً في الموبايل كل 3 شهور.

### مراقبة GitHub Actions Logs

من الموبايل بشكل دوري:
- GitHub app → Notifications → استلم تنبيهات تلقائية لكل run فاشل
- استعرض Actions tab شهرياً للتأكد أن sync-claims يعمل بانتظام

---

## 📝 تذكّر هذا

| النشاط | الجهاز المناسب |
|--------|----------------|
| كتابة كود جديد | Laptop (VSCode + GitHub Desktop) |
| تعديل سريع (rules، نص، ثابت) | Laptop أو موبايل (GitHub web edit) |
| Commit + Push | Laptop عبر GitHub Desktop |
| تشغيل النشر | **أي جهاز** — Workflow Dispatch |
| مراقبة logs | **أي جهاز** |
| إصلاحات طارئة في المستشفى | موبايل — push من غيت hub web edit ثم run workflow |

---

## ⚠️ ما يحتاج تدخّل يدوي (مرة واحدة، خارج النشر)

هذه ليست في الـ workflow، تُعمل يدوياً عند الحاجة:

### إضافة VAPID Key (للإشعارات FCM)

من التطبيق نفسه بعد أول نشر:
1. ادخل كـ admin
2. الإعدادات → 🆕 v7.4 → VAPID Key
3. الصق المفتاح من Firebase Console → Project settings → Cloud Messaging → Web Push certificates

### إضافة Gemini API Key

نفس المكان في الإعدادات. المفتاح من https://aistudio.google.com/app/apikey

### إضافة Telegram Bot Token (إذا تريد إشعارات Telegram)

نفس المكان، يُحفظ في `/settings/secrets/keys/telegram_bot`

---

## 🚨 سيناريوهات طوارئ

### "نشرت شيئاً خاطئاً وصيدلية متوقفة"

من الموبايل:
1. Firebase Console → Hosting → Release history
2. اعثر على آخر release ناجح
3. اضغط ⋮ → **Rollback**
4. خلال 30 ثانية، الإصدار القديم يعود

> 💡 هذا الزر يحلّ 99% من حالات الـ deploy خاطئ. اعرف مكانه قبل أن تحتاجه.

### "rules خاطئة وأحد لا يستطيع الدخول"

من الموبايل:
1. Firebase Console → Firestore → Rules
2. تبويب **History**
3. اختر النسخة الأخيرة الجيدة
4. **Publish**

### "sync-claims توقف عن العمل"

من الموبايل:
1. GitHub Actions → 🔐 Sync Custom Claims
2. اقرأ آخر run الفاشل
3. لو SA expired: أعد إنشاء key وحدّث الـ secret

---

## ❌ ما هذا الـ workflow لا يعمله

كن صريحاً مع نفسك: هذا الإعداد بسيط. ما **لا** يعمله:

| غير مُتاح | لو احتجته لاحقاً |
|-----------|---------------------|
| Auto-deploy على push | أضف trigger `on: push` (لا أنصح) |
| Preview channels (تجربة قبل الإنتاج) | workflow منفصل + `firebase hosting:channel:deploy` |
| Tests آلية قبل النشر | Jest + Firebase emulator (مرشّح v7.6) |
| Rollback تلقائي عند فشل | يحتاج monitoring + scripting إضافي |
| Multi-environment (dev/staging/prod) | يحتاج Firebase projects متعددة |
| Slack/Telegram notifications | أضف خطوة curl في نهاية الـ workflow |
| SRI hashes تلقائية | شغّل `scripts/compute-sri.sh` يدوياً عند تحديث مكتبات |
| Database backup قبل deploy rules | يحتاج Cloud Storage + سكربت |

كل هذه قابلة للإضافة لاحقاً. لكنها ليست ضرورية للإطلاق.

---

— v7.5 | يونيو 2026
