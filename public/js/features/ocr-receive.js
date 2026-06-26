// ============================================================
// js/features/ocr-receive.js
// OCR لورقة استلام من دائرة الصحة (الوارد للمذخر)
// v6.9
// ============================================================

(function() {
'use strict';

const OCRReceive = {
    _state: null,

    /**
     * فتح نافذة OCR للاستلام
     * @param {Function} onConfirm - callback يستقبل (items, headerInfo)
     */
    async open(onConfirm) {
        if (typeof isStaff !== 'function' || !isStaff()) {
            showToast('غير مسموح', 'error');
            return;
        }
        if (typeof requireOnline === 'function' && !await requireOnline()) return;

        const configured = await GeminiVision.isConfigured().catch(() => false);
        if (!configured) {
            showToast('مفتاح Gemini غير مُهيَّأ - راجع المسؤول', 'error', 5000);
            return;
        }

        this._state = { file: null, extracted: null, items: null, onConfirm };
        this._renderModal();
    },

    _renderModal() {
        const old = document.getElementById('ocr-receive-modal');
        if (old) old.remove();

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'ocr-receive-modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:750px;max-height:92vh;overflow-y:auto">
                <button class="modal-close" onclick="document.getElementById('ocr-receive-modal').remove()">✕</button>
                <h3 style="margin:0 0 4px">📷 قراءة ورقة الاستلام</h3>
                <p style="font-size:0.78rem;color:var(--text2);margin-bottom:10px">
                    صوِّر ورقة استلام من دائرة الصحة — النتيجة في 5-10 ثوانٍ
                </p>

                <div id="ocr-r-step1">
                    <div style="background:var(--surface2);padding:10px;border-radius:6px;margin-bottom:10px">
                        <label style="font-size:0.85rem;display:block;margin-bottom:4px">
                            📷 ارفع/التقط صورة الورقة
                        </label>
                        <input type="file" id="ocr-r-file" accept="image/*" capture="environment"
                            style="width:100%;padding:6px;background:var(--surface3);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.85rem">
                    </div>
                    <div id="ocr-r-preview" style="display:none;text-align:center;margin-bottom:10px">
                        <img id="ocr-r-image" style="max-width:100%;max-height:300px;border-radius:8px;border:2px solid var(--border)">
                    </div>
                    <button class="btn btn-primary" id="ocr-r-analyze" style="width:100%" disabled>
                        🔍 تحليل الصورة
                    </button>
                </div>

                <div id="ocr-r-loading" style="display:none;text-align:center;padding:40px">
                    <div style="font-size:3rem">⏳</div>
                    <p style="color:var(--primary);margin-top:12px;font-weight:600">جارٍ التحليل بواسطة Gemini Vision</p>
                    <p style="color:var(--muted);font-size:0.78rem;margin-top:4px">5-10 ثوانٍ تقريباً</p>
                </div>

                <div id="ocr-r-result" style="display:none">
                    <div id="ocr-r-header" style="background:var(--surface2);padding:10px;border-radius:6px;margin-bottom:10px;font-size:0.85rem"></div>
                    <h4 style="margin:8px 0">المواد المُستخرَجة</h4>
                    <div id="ocr-r-items"></div>
                    <div id="ocr-r-warnings" style="margin:8px 0"></div>
                    <div style="display:flex;gap:8px;margin-top:12px">
                        <button class="btn btn-success" id="ocr-r-confirm" style="flex:1">
                            ✓ تأكيد ومتابعة التسجيل
                        </button>
                        <button class="btn" onclick="document.getElementById('ocr-receive-modal').remove()" style="background:var(--surface3)">
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
        document.getElementById('ocr-r-file').addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            this._state.file = file;

            const reader = new FileReader();
            reader.onload = (ev) => {
                document.getElementById('ocr-r-image').src = ev.target.result;
                document.getElementById('ocr-r-preview').style.display = 'block';
                document.getElementById('ocr-r-analyze').disabled = false;
            };
            reader.readAsDataURL(file);
        });

        document.getElementById('ocr-r-analyze').onclick = () => this._analyze();
        document.getElementById('ocr-r-confirm').onclick = () => this._confirm();
    },

    async _loadMinistryListSample() {
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
        const ministryNames = await this._loadMinistryListSample();
        const inv = Array.from(AppState.inventory.values()).slice(0, 80);

        const allNames = new Map();
        ministryNames.forEach(m => {
            allNames.set((m.name || '').toLowerCase(), {
                code: m.code, name: m.name, unit: m.unit
            });
        });
        inv.forEach(i => {
            const k = (i.name || '').toLowerCase();
            if (!allNames.has(k)) {
                allNames.set(k, { code: i.code, name: i.name, unit: i.unit });
            }
        });

        const hint = Array.from(allNames.values()).slice(0, 150)
            .map(i => `- ${i.code || ''} | ${i.name || ''} | ${i.unit || ''}`)
            .join('\n');

        return `أنت مساعد قراءة دقيق لورقة حكومية عراقية:
ورقة استلام من دائرة صحة ذي قار (تجهيز دائرة) أو فاتورة شراء.

استخرج JSON بهذا الشكل (لا تضف نصاً قبله أو بعده):
{
  "documentNo": "رقم الوثيقة (إن وُجد)",
  "date": "2026-05-11",
  "source": "تجهيز دائرة | مشتريات",
  "supplier": "اسم الشركة المورِّدة إن كان شراء (أو null)",
  "items": [
    {
      "lineNumber": 1,
      "name": "اسم المادة بالـ INN كاملاً",
      "code": "الرمز الوطني بصيغة XX-XXX-XXX إن وُجد",
      "quantity": 1000,
      "unit": "Tablet | Vial | Ampoule | Capsule | Bottle | Tube | Sachet | ...",
      "batchNumber": "رقم الدفعة",
      "expiryDate": "2027-05",
      "manufacturer": "اسم الشركة المصنعة إن وُجد"
    }
  ]
}

قواعد صارمة:
1. **الأرقام كلها إنجليزية لاتينية (0-9) فقط** - حوِّل أي ٠-٩ عربية إلى 0-9
2. **الأسماء بالـ INN الإنجليزي** - يجب أن تطابق الأسماء المعتمدة في القائمة الوزارية أدناه
3. **الكمية عدد فقط** (لا تشمل الوحدة): 1000 وليس "1000 كبسول"
4. **الوحدة منفصلة** في حقل unit
5. **تاريخ الانتهاء بصيغة YYYY-MM** أو YYYY-MM-DD - بأرقام لاتينية:
   - "7.5.27" = "2027-05-07"
   - "5.27" = "2027-05"
6. **الرمز الوطني بصيغة XX-XXX-XXX** (مثل 06-AA0-001)
7. **رقم الدفعة كما هو** بكامل الحروف والأرقام (PI00724286, B-2024-001)
8. لو حقل غير واضح أو فارغ، استخدم null - **لا تخترع**

📋 **الأسماء المعتمدة من القائمة الوزارية والمخزون** (طابق معها - لا تخترع أسماء):
${hint}`;
    },

    async _analyze() {
        document.getElementById('ocr-r-step1').style.display = 'none';
        document.getElementById('ocr-r-loading').style.display = 'block';

        try {
            const prompt = await this._buildPrompt();
            const result = await GeminiVision.analyzeImage(this._state.file, prompt);

            if (!result || !Array.isArray(result.items)) {
                throw new Error('النتيجة من Gemini ليس بها قائمة مواد صالحة');
            }

            this._state.extracted = result;
            this._renderResult(result);
        } catch (e) {
            console.error('OCR receive error:', e);
            document.getElementById('ocr-r-loading').style.display = 'none';
            document.getElementById('ocr-r-step1').style.display = 'block';
            showToast(`فشل التحليل: ${e.message}`, 'error', 5000);
        }
    },

    _renderResult(result) {
        document.getElementById('ocr-r-loading').style.display = 'none';
        document.getElementById('ocr-r-result').style.display = 'block';

        document.getElementById('ocr-r-header').innerHTML = `
            <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:0.85rem">
                <strong>رقم الوثيقة:</strong>
                <span style="font-family:monospace">${escapeHtml(result.documentNo || '—')}</span>
                <strong>التاريخ:</strong>
                <span>${escapeHtml(result.date || '—')}</span>
                <strong>المصدر:</strong>
                <span>${escapeHtml(result.source || '—')}</span>
                ${result.supplier ? `<strong>المورد:</strong><span>${escapeHtml(result.supplier)}</span>` : ''}
                <strong>عدد المواد:</strong>
                <span>${result.items.length}</span>
            </div>
        `;

        const inv = Array.from(AppState.inventory.values());
        const items = result.items.map(line => {
            let matched = null;

            // 1. مطابقة بالرمز الوطني
            if (line.code) {
                const m = inv.find(i => (i.code || '').toLowerCase() === line.code.toLowerCase());
                if (m) matched = { item: m, confidence: 'exact_code' };
            }
            // 2. مطابقة بالاسم الكامل
            if (!matched && line.name) {
                const m = inv.find(i => (i.name || '').toLowerCase() === line.name.toLowerCase());
                if (m) matched = { item: m, confidence: 'exact_name' };
            }
            // 3. مطابقة جزئية
            if (!matched && line.name) {
                const norm = line.name.toLowerCase();
                const m = inv.find(i => {
                    const iname = (i.name || '').toLowerCase();
                    if (!iname) return false;
                    return iname.includes(norm) || (norm.length >= 5 && norm.includes(iname));
                });
                if (m) matched = { item: m, confidence: 'partial' };
            }

            return { ...line, matched };
        });
        this._state.items = items;

        document.getElementById('ocr-r-items').innerHTML = items.map((row, i) => {
            const item = row.matched?.item;
            let statusIcon = '🆕', statusColor = '#818cf8', statusText = 'مادة جديدة (ستُضاف)';
            if (row.matched?.confidence === 'exact_code') {
                statusIcon = '✓'; statusColor = '#4ade80'; statusText = 'مطابق بالرمز';
            } else if (row.matched?.confidence === 'exact_name') {
                statusIcon = '✓'; statusColor = '#4ade80'; statusText = 'مطابق بالاسم';
            } else if (row.matched?.confidence === 'partial') {
                statusIcon = '~'; statusColor = '#fb923c'; statusText = 'مطابق جزئياً - راجع';
            }

            const cc = ColdChain.isColdChain(item);

            return `
                <div style="background:var(--surface2);padding:10px;border-radius:6px;margin:6px 0;border-right:3px solid ${statusColor}">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                        <div style="flex:1">
                            <div>
                                <strong>${row.lineNumber}. ${escapeHtml(row.name || '?')}</strong>
                                ${cc ? ColdChain.renderBadge(item) : ''}
                                ${row.code ? `<span style="font-family:monospace;font-size:0.7rem;color:var(--muted);margin-right:6px">${escapeHtml(row.code)}</span>` : ''}
                            </div>
                            <div style="font-size:0.78rem;color:var(--text2);margin-top:2px">
                                <strong>${row.quantity || '?'}</strong> ${escapeHtml(row.unit || '')}
                            </div>
                            <div style="font-size:0.72rem;color:var(--muted);margin-top:2px">
                                ${row.batchNumber ? `دفعة: ${escapeHtml(row.batchNumber)}` : ''}
                                ${row.expiryDate ? ` · ينتهي: ${escapeHtml(row.expiryDate)}` : ''}
                                ${row.manufacturer ? ` · ${escapeHtml(row.manufacturer)}` : ''}
                            </div>
                        </div>
                        <span style="color:${statusColor};font-weight:bold;font-size:0.74rem;white-space:nowrap">
                            ${statusIcon} ${statusText}
                        </span>
                    </div>
                    ${item ? `
                        <div style="font-size:0.72rem;margin-top:6px;padding:6px;background:var(--surface3);border-radius:4px">
                            → <strong>${escapeHtml(item.name)}</strong>
                            <span style="color:var(--muted)">| الرصيد الحالي: ${item.quantity || 0}</span>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        const warnings = [];
        if (!result.documentNo) warnings.push('رقم الوثيقة مفقود');
        if (!result.source) warnings.push('المصدر غير محدد (تجهيز دائرة / مشتريات)');
        const newItems = items.filter(r => !r.matched?.item).length;
        if (newItems > 0) warnings.push(`${newItems} مادة جديدة - ستحتاج إنشاءها في المخزون`);
        const missingExpiry = items.filter(r => !r.expiryDate).length;
        if (missingExpiry > 0) warnings.push(`${missingExpiry} مادة بدون تاريخ انتهاء واضح`);
        const missingBatch = items.filter(r => !r.batchNumber).length;
        if (missingBatch > 0) warnings.push(`${missingBatch} مادة بدون رقم دفعة`);

        document.getElementById('ocr-r-warnings').innerHTML = warnings.length > 0
            ? `<div style="background:rgba(251,146,60,0.1);padding:8px;border-radius:6px;border:1px solid #fb923c;font-size:0.78rem;color:#fb923c">
                <strong>⚠️ ملاحظات تستحق المراجعة:</strong><br>
                ${warnings.map(w => `• ${w}`).join('<br>')}
            </div>`
            : '';
    },

    _confirm() {
        const items = this._state.items || [];
        if (items.length === 0) {
            showToast('لا توجد مواد', 'warning');
            return;
        }

        document.getElementById('ocr-receive-modal').remove();
        if (this._state.onConfirm) {
            this._state.onConfirm(items, this._state.extracted);
        }
    }
};

window.OCRReceive = OCRReceive;

})();
