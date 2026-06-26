// ============================================================
// js/core/needs-analytics.js — تحليلات لجنة الاحتياج (مُبسَّط)
// ============================================================
// v7.1 (تبسيط جذري):
//   - حُذفت: calcSeasonalProfile، calcReorderPoint، getLeadTimeForItem،
//             getSafetyMonthsForItem، monthNameAr، monthNameArShort
//   - بقيت دالة واحدة: calcStockoutFromMovements
//
// إصلاحات:
//   🔴 المادة الجديدة: تأخذ itemCreatedAt الآن، فلا تُحسب أيام "نفاد"
//      قبل وجود المادة في النظام (كان bug يضخّم الاحتياج بـ 33%+ لكل
//      مادة جديدة).
//   🟡 حركة reverse: تُفلتر مسبقاً في ledger.js قبل التمرير. هنا
//      نتجاهلها بأمان مع توثيق صريح.
//
// الفكرة:
//   نُعيد بناء الرصيد اليومي عبر السنة من الرصيد الافتتاحي والحركات،
//   ونعدّ الأيام التي كان فيها الرصيد ≤ 0 (نفاد فعلي) فقط بعد تاريخ
//   إنشاء المادة. النتيجة: actualMonthsAvailable يعكس التوفر الحقيقي،
//   لا "النشاط" ولا "النفاد الكاذب للمواد الجديدة".
// ============================================================

(function() {
'use strict';

/**
 * يحسب أيام النفاد الفعلية لمادة عبر سنة كاملة
 * بإعادة بناء الرصيد التراكمي من الحركات.
 *
 * @param {number} openingBalance - الرصيد في 1 يناير (0 لمادة جديدة)
 * @param {Array}  movements      - حركات المادة في تلك السنة (مفلترة من reverse)
 *                                  كل حركة: { createdAt, movType, quantity }
 * @param {number} year           - السنة (مثل 2025)
 * @param {Date|firebase.firestore.Timestamp} [itemCreatedAt]
 *                                  تاريخ إنشاء المادة في النظام.
 *                                  لو > 1 يناير من year، نُهمل أيام ما قبل الإنشاء.
 * @returns {Object} {
 *   stockoutDays: Array(12),       — أيام النفاد لكل شهر
 *   actualMonthsAvailable: number, — أشهر التوفر الحقيقي 0-12 (عشري)
 *   itemExistedThisYear: boolean,  — هل وُجدت المادة في هذه السنة أصلاً
 *   itemStartDay: number,          — يوم البداية في السنة (0 لو وُجدت من قبل)
 * }
 */
function calcStockoutFromMovements(openingBalance, movements, year, itemCreatedAt) {
    // ───── فحص المُدخل ─────
    if (typeof year !== 'number' || year < 2000 || year > 2100) {
        return _emptyResult();
    }

    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const monthLengths = isLeap
        ? [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const daysInYear = isLeap ? 366 : 365;

    // ───── تحويل تاريخ ميلادي إلى يوم السنة (0..daysInYear-1) بتوقيت بغداد ─────
    function dayOfYear(dt) {
        if (!dt) return -1;
        const bdStr = dt.toLocaleDateString('en-CA', { timeZone: BAGHDAD_TZ });
        const [yStr, mStr, dStr] = bdStr.split('-');
        const dtYear = parseInt(yStr, 10);
        if (dtYear < year) return -2;  // قبل السنة المرجعية
        if (dtYear > year) return -3;  // بعد السنة المرجعية
        const month = parseInt(mStr, 10) - 1;
        const day = parseInt(dStr, 10) - 1;
        let cum = 0;
        for (let i = 0; i < month; i++) cum += monthLengths[i];
        return cum + day;
    }

    function monthOfDay(d) {
        let cum = 0;
        for (let i = 0; i < 12; i++) {
            cum += monthLengths[i];
            if (d < cum) return i;
        }
        return 11;
    }

    // ───── 🔴 إصلاح المادة الجديدة ─────
    // إذا أُنشئت المادة في منتصف السنة (أو بعدها)، أيام ما قبل الإنشاء
    // ليست "نفاد" بل "غير قابلة للتطبيق". نعدّ التوفر من تاريخ الإنشاء فقط.
    let itemStartDay = 0;
    let itemExistedThisYear = true;
    if (itemCreatedAt) {
        const startDate = itemCreatedAt.toDate ? itemCreatedAt.toDate() : itemCreatedAt;
        const idx = dayOfYear(startDate);
        if (idx === -3) {
            // المادة أُنشئت بعد هذه السنة → لم تكن موجودة
            return {
                stockoutDays: new Array(12).fill(0),
                actualMonthsAvailable: 0,
                itemExistedThisYear: false,
                itemStartDay: daysInYear
            };
        }
        if (idx >= 0) itemStartDay = idx;
        // idx === -2 يعني قبل السنة → itemStartDay = 0 (وُجدت من قبل)
    }

    // ───── فرز الحركات + تنظيف ─────
    const sorted = (movements || [])
        .filter(m => m && m.createdAt && (m.createdAt.toDate || typeof m.createdAt.toMillis === 'function'))
        .map(m => ({
            day: dayOfYear(m.createdAt.toDate()),
            movType: m.movType,
            quantity: Number(m.quantity) || 0
        }))
        .filter(m => m.day >= 0 && m.day < daysInYear)
        .sort((a, b) => a.day - b.day);

    // ───── إعادة بناء الرصيد + عدّ النفاد ─────
    const stockoutDays = new Array(12).fill(0);
    let balance = Number(openingBalance) || 0;
    let lastDay = itemStartDay;   // ابدأ من تاريخ وجود المادة

    for (const m of sorted) {
        // أيام بين آخر نقطة وحركة جديدة كانت بالرصيد الحالي
        for (let d = lastDay; d < m.day; d++) {
            if (balance <= 0) stockoutDays[monthOfDay(d)]++;
        }

        // تطبيق الحركة
        // 🟡 ملاحظة: حركات 'reverse' مفلترة قبل التمرير في ledger.js.
        //           أي حركة type غير 'in'/'out' تُتجاهل بأمان.
        if (m.movType === 'in') balance += m.quantity;
        else if (m.movType === 'out') balance -= m.quantity;

        lastDay = m.day;
    }

    // باقي السنة بعد آخر حركة
    for (let d = lastDay; d < daysInYear; d++) {
        if (balance <= 0) stockoutDays[monthOfDay(d)]++;
    }

    // ───── حساب actualMonthsAvailable ─────
    // المنطق: لكل شهر، نسبة الأيام المتوفرة من الأيام الممكنة في ذلك الشهر.
    // إذا الشهر بأكمله قبل itemStartDay → لا يُحسب أصلاً (المادة لم تكن موجودة).
    let actualMonths = 0;
    let cumStart = 0;  // أول يوم في كل شهر
    for (let i = 0; i < 12; i++) {
        const monthEnd = cumStart + monthLengths[i];

        if (monthEnd <= itemStartDay) {
            // الشهر بأكمله قبل إنشاء المادة → ساهم 0
            cumStart = monthEnd;
            continue;
        }

        const effStart = Math.max(cumStart, itemStartDay);
        const possibleDays = monthEnd - effStart;
        const availDays = possibleDays - stockoutDays[i];
        // نسبة من الشهر الكامل (نُبقي مقام ثابت = الشهر الميلادي)
        actualMonths += availDays / monthLengths[i];

        cumStart = monthEnd;
    }

    return {
        stockoutDays,
        actualMonthsAvailable: Math.round(actualMonths * 100) / 100,
        itemExistedThisYear,
        itemStartDay
    };
}

function _emptyResult() {
    return {
        stockoutDays: new Array(12).fill(0),
        actualMonthsAvailable: 12,
        itemExistedThisYear: true,
        itemStartDay: 0
    };
}

// ───── تصدير للنطاق العام ─────
window.NeedsAnalytics = { calcStockoutFromMovements };
window.calcStockoutFromMovements = calcStockoutFromMovements;

})();
