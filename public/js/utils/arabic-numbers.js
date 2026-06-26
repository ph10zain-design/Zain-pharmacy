// ============================================================
// js/utils/arabic-numbers.js
// تحويل الكلمات العربية إلى أرقام للتحقق المزدوج في OCR
// v6.9
// ============================================================

(function() {
'use strict';

const ARABIC_NUMBERS = {
    'صفر': 0,
    'واحد': 1, 'واحده': 1, 'واحدة': 1, 'احد': 1, 'إحدى': 1, 'أحد': 1,
    'اثنان': 2, 'اثنين': 2, 'إثنان': 2, 'إثنين': 2, 'اثنتان': 2, 'اثنتين': 2, 'اثنا': 2, 'اثني': 2,
    'ثلاثة': 3, 'ثلاث': 3, 'ثلاثه': 3,
    'اربعة': 4, 'أربعة': 4, 'اربع': 4, 'أربع': 4, 'اربعه': 4,
    'خمسة': 5, 'خمس': 5, 'خمسه': 5,
    'ستة': 6, 'ست': 6, 'سته': 6,
    'سبعة': 7, 'سبع': 7, 'سبعه': 7,
    'ثمانية': 8, 'ثماني': 8, 'ثمان': 8, 'ثمانيه': 8,
    'تسعة': 9, 'تسع': 9, 'تسعه': 9,
    'عشرة': 10, 'عشر': 10, 'عشره': 10,
    'احدعشر': 11, 'إحدىعشر': 11, 'احدعش': 11,
    'اثناعشر': 12, 'إثناعشر': 12, 'اثنعش': 12,
    'ثلاثةعشر': 13, 'اربعةعشر': 14, 'خمسةعشر': 15,
    'ستةعشر': 16, 'سبعةعشر': 17, 'ثمانيةعشر': 18, 'تسعةعشر': 19,
    'عشرون': 20, 'عشرين': 20,
    'ثلاثون': 30, 'ثلاثين': 30,
    'اربعون': 40, 'أربعون': 40, 'اربعين': 40, 'أربعين': 40,
    'خمسون': 50, 'خمسين': 50,
    'ستون': 60, 'ستين': 60,
    'سبعون': 70, 'سبعين': 70,
    'ثمانون': 80, 'ثمانين': 80,
    'تسعون': 90, 'تسعين': 90,
    'مئة': 100, 'مائة': 100, 'مايه': 100, 'مية': 100, 'ميه': 100,
    'مئتان': 200, 'مئتين': 200, 'مائتان': 200, 'مائتين': 200, 'ميتين': 200,
    'ثلاثمئة': 300, 'ثلاثمائة': 300, 'ثلثمئة': 300,
    'اربعمئة': 400, 'أربعمائة': 400, 'اربعمائة': 400,
    'خمسمئة': 500, 'خمسمائة': 500,
    'ستمئة': 600, 'ستمائة': 600,
    'سبعمئة': 700, 'سبعمائة': 700,
    'ثمانمئة': 800, 'ثمانمائة': 800, 'ثمنمئة': 800,
    'تسعمئة': 900, 'تسعمائة': 900,
    'الف': 1000, 'ألف': 1000,
    'الفان': 2000, 'الفين': 2000, 'ألفين': 2000, 'ألفان': 2000,
    'الاف': 1000, 'آلاف': 1000,
    'مليون': 1000000, 'مليونان': 2000000, 'مليونين': 2000000,
    'ملايين': 1000000
};

/**
 * تطبيع النص: إزالة "ال" التعريف، "فقط"، "و"، علامات الترقيم
 */
function normalizeArabicText(text) {
    if (!text) return '';
    return String(text)
        .replace(/[.,،؟!]/g, ' ')
        .replace(/\bفقط\b/g, ' ')
        .replace(/[\u064B-\u0652]/g, '')  // إزالة الحركات
        .trim()
        .toLowerCase();
}

/**
 * تحويل جملة عربية إلى رقم
 * أمثلة:
 *   "خمسة فقط" → 5
 *   "مئة فقط" → 100
 *   "ألف ومئتين" → 1200
 *   "خمسة آلاف وثلاثمئة وخمسة وعشرون" → 5325
 */
function arabicWordsToNumber(text) {
    if (!text || typeof text !== 'string') return null;

    const cleaned = normalizeArabicText(text);
    if (!cleaned) return null;

    const words = cleaned.split(/\s+و*\s*/).filter(w => w);

    let total = 0;
    let current = 0;
    let foundAny = false;

    for (let word of words) {
        // محاولة 1: الكلمة كما هي
        let val = ARABIC_NUMBERS[word];

        // محاولة 2: بعد إزالة "ال" التعريف
        if (val === undefined && word.startsWith('ال')) {
            val = ARABIC_NUMBERS[word.substring(2)];
        }

        // محاولة 3: تجاهل الواو
        if (val === undefined && word === 'و') continue;

        if (val === undefined || val === null) continue;
        foundAny = true;

        if (val === 100) {
            current = (current || 1) * 100;
        } else if (val === 1000) {
            current = (current || 1) * 1000;
            total += current;
            current = 0;
        } else if (val === 1000000) {
            current = (current || 1) * 1000000;
            total += current;
            current = 0;
        } else if (val >= 200 && val < 1000) {
            current += val;
        } else if (val >= 2000) {
            total += val;
        } else {
            current += val;
        }
    }

    return foundAny ? (total + current) : null;
}

/**
 * التحقق من تطابق الكمية الرقمية مع الكتابة العربية
 * يعيد: { ok, parsed, error }
 */
function verifyArabicQuantity(numeric, written) {
    if (numeric == null || numeric === '') {
        return { ok: false, error: 'الرقم مفقود' };
    }
    if (!written) {
        return { ok: false, error: 'الكتابة مفقودة', parsed: null };
    }

    const parsed = arabicWordsToNumber(written);
    if (parsed === null) {
        return {
            ok: false,
            parsed: null,
            error: 'لم أتمكن من قراءة الكتابة العربية'
        };
    }

    const num = Number(numeric);
    if (parsed === num) {
        return { ok: true, parsed };
    }

    return {
        ok: false,
        parsed,
        error: `الرقم ${num} لا يطابق الكتابة "${written}" (=${parsed})`
    };
}

/**
 * تحويل الأرقام العربية الشرقية (٠-٩) إلى لاتينية (0-9)
 * أيضاً يدعم الأرقام الفارسية (۰-۹)
 */
function normalizeArabicDigits(str) {
    if (!str) return '';
    return String(str)
        .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

/**
 * تحويل رقم إلى كتابة عربية (للـ PDFs إن لزم)
 * نسخة مبسطة للأرقام حتى 999,999
 */
function numberToArabicWords(num) {
    if (num == null || isNaN(num)) return '';
    num = Math.floor(Number(num));
    if (num === 0) return 'صفر';
    if (num < 0) return 'سالب ' + numberToArabicWords(-num);

    const ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
    const tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
    const teens = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
    const hundreds = ['', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'];

    function convert999(n) {
        if (n === 0) return '';
        const parts = [];
        const h = Math.floor(n / 100);
        const t = Math.floor((n % 100) / 10);
        const o = n % 10;

        if (h > 0) parts.push(hundreds[h]);
        if (t === 1) {
            parts.push(teens[o]);
        } else {
            if (o > 0 && t > 1) parts.push(ones[o]);
            if (t > 1) parts.push(tens[t]);
            if (t === 0 && o > 0) parts.push(ones[o]);
        }
        return parts.join(' و');
    }

    if (num < 1000) return convert999(num);

    if (num < 1000000) {
        const thousands = Math.floor(num / 1000);
        const rest = num % 1000;
        let thousandsPart;
        if (thousands === 1) thousandsPart = 'ألف';
        else if (thousands === 2) thousandsPart = 'ألفان';
        else if (thousands < 11) thousandsPart = convert999(thousands) + ' آلاف';
        else thousandsPart = convert999(thousands) + ' ألف';

        if (rest === 0) return thousandsPart;
        return thousandsPart + ' و' + convert999(rest);
    }

    return num.toLocaleString('en-US') + ' (رقم كبير)';
}

// تعريض الـ API
window.ArabicNumbers = {
    arabicWordsToNumber,
    verifyArabicQuantity,
    normalizeArabicDigits,
    normalizeArabicText,
    numberToArabicWords
};

})();
