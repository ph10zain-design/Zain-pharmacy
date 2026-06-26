// ============================================================
// js/features/gemini-vision.js
// عميل Gemini Vision API الآمن - لـ OCR من المتصفح مباشرة
// v6.9
// ============================================================

(function() {
'use strict';

const GeminiVision = {
    _apiKey: null,             // يُحمَّل من Firestore، لا يُحفَظ خارج الذاكرة
    _keyLoadedAt: 0,           // وقت آخر تحميل (refresh كل ساعة)
    _lastCallAt: 0,            // rate limiting (5 ثوانٍ بين الاستدعاءات)
    _model: 'gemini-2.5-flash',
    _endpoint: 'https://generativelanguage.googleapis.com/v1beta',

    /**
     * تحميل المفتاح من Firestore (مع cache في الذاكرة لساعة)
     */
    async _ensureKey() {
        const oneHour = 60 * 60 * 1000;
        if (this._apiKey && (Date.now() - this._keyLoadedAt) < oneHour) {
            return this._apiKey;
        }

        if (typeof isStaff !== 'function' || !isStaff()) {
            throw new Error('الميزة متاحة للصيادلة فقط');
        }

        try {
            const doc = await db.collection('settings').doc('secrets')
                .collection('keys').doc('gemini').get();

            if (!doc.exists) {
                throw new Error('مفتاح Gemini غير مُهيَّأ. يجب على المسؤول إضافته من الإعدادات → مفاتيح API');
            }

            const key = doc.data().value;
            if (!key || typeof key !== 'string' || !key.startsWith('AIza') || key.length < 30) {
                throw new Error('المفتاح المخزَّن غير صحيح. مفتاح Gemini يبدأ بـ "AIza"');
            }

            this._apiKey = key;
            this._keyLoadedAt = Date.now();
            return key;
        } catch (e) {
            this._apiKey = null;
            throw e;
        }
    },

    /**
     * تحويل File إلى base64 (بدون data: prefix)
     */
    async _fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result;
                const idx = dataUrl.indexOf(',');
                resolve({
                    base64: dataUrl.substring(idx + 1),
                    mimeType: file.type || 'image/jpeg'
                });
            };
            reader.onerror = () => reject(new Error('فشل قراءة الصورة'));
            reader.readAsDataURL(file);
        });
    },

    /**
     * ضغط الصورة إن كانت كبيرة
     */
    async _compressIfLarge(file, maxSizeMB = 4) {
        if (file.size <= maxSizeMB * 1024 * 1024) return file;

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const maxDim = 1600;
                let { width, height } = img;
                if (width > maxDim || height > maxDim) {
                    const ratio = Math.min(maxDim / width, maxDim / height);
                    width = Math.floor(width * ratio);
                    height = Math.floor(height * ratio);
                }
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                canvas.toBlob(blob => {
                    if (!blob) return reject(new Error('فشل ضغط الصورة'));
                    resolve(blob);
                }, 'image/jpeg', 0.85);
            };
            img.onerror = () => reject(new Error('فشل تحميل الصورة'));
            img.src = URL.createObjectURL(file);
        });
    },

    /**
     * استدعاء Gemini Vision API
     * @param {File|Blob} imageFile - الصورة
     * @param {string} prompt - التعليمات
     * @returns {Promise<Object>} JSON من النموذج
     */
    async analyzeImage(imageFile, prompt) {
        // 1. Rate limit
        const since = Date.now() - this._lastCallAt;
        if (since < 5000) {
            const wait = Math.ceil((5000 - since) / 1000);
            throw new Error(`انتظر ${wait} ثانية قبل المحاولة التالية`);
        }

        // 2. تحقق الحجم
        if (imageFile.size > 15 * 1024 * 1024) {
            throw new Error('الصورة كبيرة جداً (الحد 15 ميغا)');
        }

        // 3. ضغط إن لزم
        const file = await this._compressIfLarge(imageFile);

        // 4. تحميل المفتاح
        const apiKey = await this._ensureKey();
        this._lastCallAt = Date.now();

        // 5. تحويل لـ base64
        const { base64, mimeType } = await this._fileToBase64(file);

        // 6. استدعاء API
        const url = `${this._endpoint}/models/${this._model}:generateContent?key=${apiKey}`;
        const body = {
            contents: [{
                parts: [
                    { text: prompt },
                    { inline_data: { mime_type: mimeType, data: base64 } }
                ]
            }],
            generationConfig: {
                temperature: 0.1,
                topP: 0.95,
                maxOutputTokens: 8192,
                responseMimeType: 'application/json'
            }
        };

        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        } catch (e) {
            throw new Error('فشل الاتصال بـ Gemini. تأكد من الإنترنت.');
        }

        if (!response.ok) {
            let errMsg = `Gemini API error: ${response.status}`;
            try {
                const errData = await response.json();
                errMsg = errData?.error?.message || errMsg;
            } catch {}

            if (response.status === 400) {
                throw new Error('طلب غير صحيح للـ API. ' + errMsg);
            }
            if (response.status === 401 || response.status === 403) {
                this._apiKey = null;
                throw new Error('المفتاح غير صحيح أو منتهي. راجع الإعدادات.');
            }
            if (response.status === 429) {
                throw new Error('تجاوزت الحصة اليومية لـ Gemini (1500 طلب/يوم). انتظر للغد.');
            }
            if (response.status >= 500) {
                throw new Error('خادم Gemini غير متاح حالياً. حاول بعد دقائق.');
            }
            throw new Error(errMsg);
        }

        const data = await response.json();
        const textPart = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!textPart) {
            const finishReason = data?.candidates?.[0]?.finishReason;
            if (finishReason === 'SAFETY') {
                throw new Error('الصورة رُفضت من Gemini لأسباب أمان');
            }
            throw new Error('Gemini لم يُرجع نتيجة. حاول بصورة أوضح.');
        }

        // 7. تحليل JSON
        try {
            return JSON.parse(textPart);
        } catch (e) {
            // محاولة استخراج JSON من نص يحوي markdown
            const match = textPart.match(/\{[\s\S]*\}/);
            if (match) {
                try {
                    return JSON.parse(match[0]);
                } catch {}
            }
            console.error('Failed to parse Gemini response:', textPart);
            throw new Error('Gemini أرجع نتيجة غير صالحة. حاول بصورة أوضح.');
        }
    },

    /**
     * حذف المفتاح من الذاكرة (عند تسجيل الخروج)
     */
    clearKey() {
        this._apiKey = null;
        this._keyLoadedAt = 0;
    },

    /**
     * فحص ما إذا كان المفتاح مُهيَّأ
     */
    async isConfigured() {
        try {
            await this._ensureKey();
            return true;
        } catch {
            return false;
        }
    }
};

window.GeminiVision = GeminiVision;

})();
