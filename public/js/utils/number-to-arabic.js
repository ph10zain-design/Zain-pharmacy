// ============================================================
// js/utils/number-to-arabic.js
// تحويل الأرقام إلى كلام عربي
// ============================================================

const NumberToArabic = {
    _ones: ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'],
    _teens: ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'],
    _tens: ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'],
    _hundreds: ['', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'],

    convert(num, appendFaqat = true) {
        if (num == null || isNaN(num)) return '';
        num = Math.abs(parseInt(num));
        if (num === 0) return appendFaqat ? 'صفر فقط' : 'صفر';
        const result = this._convertNumber(num);
        return appendFaqat ? `${result} فقط` : result;
    },

    _convertNumber(num) {
        if (num === 0) return '';
        if (num < 10) return this._ones[num];
        if (num < 20) return this._teens[num - 10];
        if (num < 100) return this._convertTens(num);
        if (num < 1000) return this._convertHundreds(num);
        if (num < 1000000) return this._convertThousands(num);
        if (num < 1000000000) return this._convertMillions(num);
        return num.toString();
    },

    _convertTens(num) {
        const tens = Math.floor(num / 10);
        const ones = num % 10;
        if (ones === 0) return this._tens[tens];
        return `${this._ones[ones]} و${this._tens[tens]}`;
    },

    _convertHundreds(num) {
        const h = Math.floor(num / 100);
        const rest = num % 100;
        if (rest === 0) return this._hundreds[h];
        return `${this._hundreds[h]} و${this._convertNumber(rest)}`;
    },

    _convertThousands(num) {
        const thousands = Math.floor(num / 1000);
        const rest = num % 1000;
        let thousandsText;
        if (thousands === 1) thousandsText = 'ألف';
        else if (thousands === 2) thousandsText = 'ألفان';
        else if (thousands >= 3 && thousands <= 10) thousandsText = `${this._convertNumber(thousands)} آلاف`;
        else thousandsText = `${this._convertNumber(thousands)} ألفاً`;
        if (rest === 0) return thousandsText;
        return `${thousandsText} و${this._convertNumber(rest)}`;
    },

    _convertMillions(num) {
        const millions = Math.floor(num / 1000000);
        const rest = num % 1000000;
        let millionsText;
        if (millions === 1) millionsText = 'مليون';
        else if (millions === 2) millionsText = 'مليونان';
        else if (millions >= 3 && millions <= 10) millionsText = `${this._convertNumber(millions)} ملايين`;
        else millionsText = `${this._convertNumber(millions)} مليوناً`;
        if (rest === 0) return millionsText;
        return `${millionsText} و${this._convertNumber(rest)}`;
    },
};

window.NumberToArabic = NumberToArabic;
