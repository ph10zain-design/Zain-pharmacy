// ============================================================
// js/features/ocr-dispense.js
// OCR لورقة "قائمة تجهيز من المذخر" - يستخرج المواد + يطابق المخزون
// v6.9
// ============================================================

(function() {
'use strict';

const OCRDispense = {
    _state: null,

    /**
     * فتح نافذة OCR للصرف
     * @param {Function} onConfirm - callback عند التأكيد، يستقبل (items, docInfo)
     */
    async open(onConfirm) {
        if (typeof isStaff !== 'function' || !isStaff()) {
            showToast('غير مسموح', 'error');
            return;
        }
        if (typeof requireOnline === 'function' && !await requireOnline()) return;

        // التحقق من توفر المفتاح
        const configured = await GeminiVision.isConfigured().catch(() => false);
        if (!configured) {
            showToast('مفتاح Gemini غير مُهيَّأ - راجع المسؤول', 'error', 5000);
            return;
        }

        this._state = { file: null, extracted: null, matched: null, onConfirm };
        this._renderModal();
    },

    _renderModal() {
        const old = document.getElementById('ocr-dispense-modal');
        if (old) old.remove();

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'ocr-dispense-modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:750px;max-height:92vh;overflow-y:auto">
                <button class="modal-close" onclick="document.getElementById('ocr-dispense-modal').remove()">✕</button>
                <h3 style="margin:0 0 4px">📷 قراءة ورقة الصرف</h3>
                <p style="font-size:0.78rem;color:var(--text2);margin-bottom:10px">
                    صوِّر "قائمة تجهيز الأدوية والمستلزمات الطبية من المذخر" — النتيجة في 5-10 ثوانٍ
                </p>

                <div id="ocr-d-step1">
                    <div style="background:var(--surface2);padding:10px;border-radius:6px;margin-bottom:10px">
                        <label style="font-size:0.85rem;display:block;margin-bottom:4px">
                            📷 ارفع/التقط صورة الورقة
                        </label>
                        <input type="file" id="ocr-d-file" accept="image/*" capture="environment"
                            style="width:100%;padding:6px;background:var(--surface3);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.85rem">
                    </div>
                    <div id="ocr-d-preview" style="display:none;text-align:center;margin-bottom:10px">
                        <img id="ocr-d-image" style="max-width:100%;max-height:300px;border-radius:8px;border:2px solid var(--border)">
                    </div>
                    <button class="btn btn-primary" id="ocr-d-analyze" style="width:100%" disabled>
                        🔍 تحليل الصورة
                    </button>
                </div>

                <div id="ocr-d-loading" style="display:none;text-align:center;padding:40px">
                    <div style="font-size:3rem;animation:spin 1s linear infinite">⏳</div>
                    <p style="color:var(--primary);margin-top:12px;font-weight:600">جارٍ التحليل بواسطة Gemini Vision</p>
                    <p style="color:var(--muted);font-size:0.78rem;margin-top:4px">5-10 ثوانٍ تقريباً</p>
                </div>

                <div id="ocr-d-result" style="display:none">
                    <div id="ocr-d-header" style="background:var(--surface2);padding:10px;border-radius:6px;margin-bottom:10px;font-size:0.85rem"></div>
                    <h4 style="margin:8px 0">المواد المُستخرَجة</h4>
                    <div id="ocr-d-items"></div>
                    <div id="ocr-d-warnings" style="margin:8px 0"></div>
                    <div style="display:flex;gap:8px;margin-top:12px">
                        <button class="btn btn-success" id="ocr-d-confirm" style="flex:1">
                            ✓ تأكيد ونقل لجدول الصرف
                        </button>
                        <button class="btn" onclick="document.getElementById('ocr-dispense-modal').remove()" style="background:var(--surface3)">
                            إلغاء
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        this._attachHandlers();
    },

    _attachHandlers() {
        const fileInput = document.getElementById('ocr-d-file');
        const analyzeBtn = document.getElementById('ocr-d-analyze');

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            this._state.file = file;

            const reader = new FileReader();
            reader.onload = (ev) => {
                document.getElementById('ocr-d-image').src = ev.target.result;
                document.getElementById('ocr-d-preview').style.display = 'block';
                analyzeBtn.disabled = false;
            };
            reader.readAsDataURL(file);
        });

        analyzeBtn.onclick = () => this._analyze();
        document.getElementById('ocr-d-confirm').onclick = () => this._confirm();
    },

    async _loadMinistryListSample() {
        // جلب أسماء معتمدة من القوائم الوزارية للقسم الحالي
        try {
            const dept = CURRENT_DEPT;
            const listsSnap = await db.collection('ministryLists')
                .where('dept', '==', dept).limit(5).get();

            const names = [];
            for (const listDoc of listsSnap.docs) {
                const itemsSnap = await listDoc.ref.collection('items').limit(100).get();
                itemsSnap.forEach(d => {
                    const data = d.data();
                    if (data.name) names.push({ code: data.code, name: data.name, unit: data.unit });
                });
                if (names.length >= 200) break;
            }
            return names;
        } catch (e) {
            console.warn('Failed to load ministry lists:', e);
            return [];
        }
    },

    async _buildPrompt() {
        // 1. القوائم الوزارية = المرجع الرسمي للأسماء المعتمدة
        const ministryNames = await this._loadMinistryListSample();

        // 2. المخزون الفعلي = للمطابقة المباشرة
        const inv = Array.from(AppState.inventory.values())
            .filter(it => (it.quantity || 0) > 0)
            .sort((a, b) => (b.quantity || 0) - (a.quantity || 0))
            .slice(0, 80);

        // دمج المصدرين (القائمة الوزارية أولاً، ثم المخزون)
        const allNames = new Map();
        ministryNames.forEach(m => {
            allNames.set((m.name || '').toLowerCase(), {
                code: m.code, name: m.name, unit: m.unit, source: 'ministry'
            });
        });
        inv.forEach(i => {
            const k = (i.name || '').toLowerCase();
            if (!allNames.has(k)) {
                allNames.set(k, { code: i.code, name: i.name, unit: i.unit, source: 'inventory' });
            }
        });

        const hint = Array.from(allNames.values()).slice(0, 150)
            .map(i => `- ${i.code || ''} | ${i.name || ''} | ${i.unit || ''}`)
            .join('\n');

        return `أنت مساعد قراءة دقيق لورقة حكومية عراقية:
"قائمة تجهيز الأدوية والمستلزمات الطبية من المذخر"

بنية الورقة:
- محافظة ذي قار / دائرة صحة ذي قار / مستشفى الشطرة العام
- "إلى:" الجهة المستلمة (مثل: صيدلية الطوارئ، التمريض، صالة العمليات، المختبر، الأشعة، إلخ)
- رقم الورقة (7 أرقام مثل 0212582) في الأعلى يسار
- التاريخ (مثل 11/05/2026)
- جدول من 15 سطر بالأعمدة:
  ت | اسم المادة | الكمية رقماً | الكمية كتابة | تاريخ النفاذ | رقم الوجبة | الملاحظات

استخرج JSON بهذا الشكل بالضبط (لا تضف نصاً قبله أو بعده):
{
  "documentNo": "0212582",
  "date": "2026-05-11",
  "destination": "صيدلية الطوارئ",
  "items": [
    {
      "lineNumber": 1,
      "name": "Rabies Immunoglobulin",
      "quantityNumeric": 100,
      "quantityWritten": "مئة فقط",
      "expiryDate": "2027-05",
      "batchNumber": "PI00724286"
    }
  ]
}

قواعد صارمة:
1. **الأرقام كلها إنجليزية لاتينية (0-9) فقط** - إذا رأيت ٠-٩ عربية، حوِّلها إلى 0-9
2. **الأسماء بالـ INN الإنجليزي** - يجب أن تُطابق الأسماء المعتمدة في القائمة الوزارية أدناه
3. **الكمية رقماً عدد فقط** (100 وليس "١٠٠"، ولا "100 كبسول")
4. **الكمية كتابةً نص عربي كما هو** ("مئة فقط"، "خمسة فقط") - للتحقق المزدوج
5. **تاريخ النفاذ بصيغة YYYY-MM** أو YYYY-MM-DD - بأرقام لاتينية:
   - "7.5.27" = "2027-05-07"
   - "5.27" = "2027-05"
   - "5/2027" = "2027-05"
6. **رقم الوجبة كما هو** بحروف لاتينية وأرقام لاتينية (PI00724286, RV40024)
7. لو حقل غير واضح أو فارغ، استخدم null
8. **لا تخترع بيانات** - اترك null بدلاً من التخمين
9. أرجع 15 سطر كحد أقصى (سقف الورقة)

📋 **الأسماء المعتمدة من القائمة الوزارية والمخزون** (طابق معها - لا تخترع أسماء):
${hint}`;
    },

    async _analyze() {
        document.getElementById('ocr-d-step1').style.display = 'none';
        document.getElementById('ocr-d-loading').style.display = 'block';

        try {
            const prompt = await this._buildPrompt();
            const result = await GeminiVision.analyzeImage(this._state.file, prompt);

            // التحقق من البنية
            if (!result || !Array.isArray(result.items)) {
                throw new Error('النتيجة من Gemini ليس بها قائمة مواد صالحة');
            }

            this._state.extracted = result;
            this._renderResult(result);
        } catch (e) {
            console.error('OCR analyze error:', e);
            document.getElementById('ocr-d-loading').style.display = 'none';
            document.getElementById('ocr-d-step1').style.display = 'block';
            showToast(`فشل التحليل: ${e.message}`, 'error', 5000);
        }
    },

    _renderResult(result) {
        document.getElementById('ocr-d-loading').style.display = 'none';
        document.getElementById('ocr-d-result').style.display = 'block';

        // Header
        document.getElementById('ocr-d-header').innerHTML = `
            <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:0.85rem">
                <strong>رقم الورقة:</strong>
                <span style="font-family:monospace">${escapeHtml(result.documentNo || '—')}</span>
                <strong>التاريخ:</strong>
                <span>${escapeHtml(result.date || '—')}</span>
                <strong>المستلم:</strong>
                <span>${escapeHtml(result.destination || '—')}</span>
                <strong>عدد المواد:</strong>
                <span>${result.items.length}</span>
            </div>
        `;

        // معالجة كل سطر
        const inv = Array.from(AppState.inventory.values());
        const matched = result.items.map(line => {
            const m = this._fuzzyMatch(line.name, inv);
            const qty = ArabicNumbers.verifyArabicQuantity(line.quantityNumeric, line.quantityWritten);
            return { ...line, matched: m, qtyCheck: qty };
        });
        this._state.matched = matched;

        // Render items
        const itemsDiv = document.getElementById('ocr-d-items');
        itemsDiv.innerHTML = matched.map((row, i) => {
            const item = row.matched?.item;
            let statusIcon = '✗', statusColor = '#f87171', statusText = 'لم تُطابَق';
            if (row.matched?.confidence === 'exact_code') { statusIcon = '✓'; statusColor = '#4ade80'; statusText = 'مطابق بالرمز'; }
            else if (row.matched?.confidence === 'exact_name') { statusIcon = '✓'; statusColor = '#4ade80'; statusText = 'مطابق بالاسم 100%'; }
            else if (row.matched?.confidence === 'partial') { statusIcon = '~'; statusColor = '#fb923c'; statusText = 'مطابق جزئياً'; }
            else if (row.matched?.confidence === 'fuzzy') { statusIcon = '?'; statusColor = '#fb923c'; statusText = 'مطابقة ضعيفة - راجع!'; }

            const qtyOk = row.qtyCheck.ok;
            const qtyMsg = qtyOk
                ? '<span style="color:#4ade80">✓ رقم/كتابة متطابقان</span>'
                : `<span style="color:#f87171">⚠️ ${escapeHtml(row.qtyCheck.error || 'عدم تطابق')}</span>`;

            const available = item?.quantity || 0;
            const insufficient = item && row.quantityNumeric > available;
            const cc = ColdChain.isColdChain(item);

            return `
                <div style="background:var(--surface2);padding:10px;border-radius:6px;margin:6px 0;border-right:3px solid ${statusColor}">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                        <div style="flex:1">
                            <div>
                                <strong>${row.lineNumber}. ${escapeHtml(row.name || '?')}</strong>
                                ${cc ? ColdChain.renderBadge(item) : ''}
                            </div>
                            <div style="font-size:0.78rem;color:var(--text2);margin-top:2px">
                                <strong>${row.quantityNumeric}</strong> × (${escapeHtml(row.quantityWritten || '—')})
                            </div>
                            <div style="font-size:0.72rem;color:var(--muted);margin-top:2px">
                                ${row.batchNumber ? `دفعة: ${escapeHtml(row.batchNumber)}` : ''}
                                ${row.expiryDate ? ` · ينتهي: ${escapeHtml(row.expiryDate)}` : ''}
                            </div>
                        </div>
                        <span style="color:${statusColor};font-weight:bold;font-size:0.74rem;white-space:nowrap">
                            ${statusIcon} ${statusText}
                        </span>
                    </div>
                    ${item ? `
                        <div style="font-size:0.72rem;margin-top:6px;padding:6px;background:var(--surface3);border-radius:4px">
                            → <strong>${escapeHtml(item.name)}</strong>
                            <span style="color:var(--muted)">| الرصيد: ${available}</span>
                            ${insufficient ? ` <span style="color:#f87171;font-weight:bold">⚠️ الكمية أكبر من الرصيد!</span>` : ''}
                        </div>
                    ` : ''}
                    <div style="font-size:0.72rem;margin-top:4px">${qtyMsg}</div>
                </div>
            `;
        }).join('');

        // التحذيرات العامة
        const warnings = [];
        if (!result.documentNo || !/^\d{4,10}$/.test(result.documentNo)) {
            warnings.push('رقم الورقة غير واضح أو غير صحيح');
        }
        if (!result.destination) {
            warnings.push('الجهة المستلمة غير واضحة');
        }
        const unmatched = matched.filter(r => !r.matched?.item).length;
        if (unmatched > 0) warnings.push(`${unmatched} مادة لم تُطابَق مع المخزون`);
        const qtyMismatches = matched.filter(r => !r.qtyCheck.ok).length;
        if (qtyMismatches > 0) warnings.push(`${qtyMismatches} سطر فيها عدم تطابق رقم/كتابة`);
        const insuffs = matched.filter(r => r.matched?.item && r.quantityNumeric > (r.matched.item.quantity || 0)).length;
        if (insuffs > 0) warnings.push(`${insuffs} مادة كميتها المطلوبة أكبر من الرصيد`);

        document.getElementById('ocr-d-warnings').innerHTML = warnings.length > 0
            ? `<div style="background:rgba(251,146,60,0.1);padding:8px;border-radius:6px;border:1px solid #fb923c;font-size:0.78rem;color:#fb923c">
                <strong>⚠️ تنبيهات تستحق المراجعة:</strong><br>
                ${warnings.map(w => `• ${w}`).join('<br>')}
            </div>`
            : '';
    },

    _fuzzyMatch(name, inventory) {
        if (!name || !inventory.length) return null;
        const norm = String(name).toLowerCase().trim();
        if (!norm) return null;

        // 1. مطابقة بالرمز إن كان الاسم يحوي رمز وطني
        const codeMatch = norm.match(/\d{2}-[a-z\d]{3}-\d{3}/i);
        if (codeMatch) {
            const found = inventory.find(i => i.code?.toLowerCase() === codeMatch[0].toLowerCase());
            if (found) return { item: found, confidence: 'exact_code' };
        }

        // 2. مطابقة كاملة بالاسم
        let found = inventory.find(i => (i.name || '').toLowerCase() === norm);
        if (found) return { item: found, confidence: 'exact_name' };

        // 3. يحوي (substring match)
        found = inventory.find(i => {
            const iname = (i.name || '').toLowerCase();
            if (!iname) return false;
            return iname.includes(norm) || (norm.length >= 5 && norm.includes(iname));
        });
        if (found) return { item: found, confidence: 'partial' };

        // 4. أول كلمتين
        const firstWords = norm.split(/[\s,\-/]+/).slice(0, 2).join(' ');
        if (firstWords.length >= 4) {
            found = inventory.find(i => {
                const iname = (i.name || '').toLowerCase();
                return iname.startsWith(firstWords) || firstWords.startsWith(iname.split(' ').slice(0, 2).join(' '));
            });
            if (found) return { item: found, confidence: 'fuzzy' };
        }

        return null;
    },

    _confirm() {
        const matched = this._state.matched || [];
        const valid = matched.filter(r => r.matched?.item);

        if (valid.length === 0) {
            showToast('لا توجد مواد متطابقة للنقل', 'warning');
            return;
        }

        // التحذير إذا فيه عدم تطابق رقم/كتابة
        const mismatched = valid.filter(r => !r.qtyCheck.ok);
        if (mismatched.length > 0) {
            if (!confirm(`⚠️ ${mismatched.length} مادة فيها عدم تطابق بين الرقم والكتابة العربية. هل تريد المتابعة؟`)) {
                return;
            }
        }

        // نقل المواد المتطابقة
        const itemsToAdd = valid.map(r => ({
            itemId: r.matched.item.id,
            qty: r.quantityNumeric,
            extractedExpiry: r.expiryDate || null,
            extractedBatch: r.batchNumber || null,
            extractedWritten: r.quantityWritten || null
        }));

        const docInfo = {
            documentNo: this._state.extracted.documentNo,
            date: this._state.extracted.date,
            destination: this._state.extracted.destination
        };

        document.getElementById('ocr-dispense-modal').remove();

        if (this._state.onConfirm) {
            this._state.onConfirm(itemsToAdd, docInfo);
        }
    }
};

window.OCRDispense = OCRDispense;

})();
