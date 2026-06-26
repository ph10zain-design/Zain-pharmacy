// ============================================================
// js/features/cold-chain.js
// دعم Cold-chain للمواد البيولوجية واللقاحات
// v6.9
// ============================================================

(function() {
'use strict';

// قائمة المواد المعروفة cold-chain (أنماط بحث)
const COLD_CHAIN_PATTERNS = {
    refrigerated: [
        // اللقاحات
        /\bvaccine\b/i, /\bvac\b/i, /\bvacc\b/i,
        /rabies vaccine/i, /tetanus toxoid/i, /\bTT\b/,
        /hepatitis [ab] vaccine/i, /MMR/i, /BCG/i,
        /polio vaccine/i, /\bIPV\b/, /\bOPV\b/,
        /pneumococcal/i, /meningococcal/i, /influenza vaccine/i,
        /HPV vaccine/i, /rotavirus/i,

        // الأنسولين
        /\binsulin\b/i, /lantus/i, /levemir/i, /humalog/i, /novorapid/i,

        // Biologics و الـ Immunoglobulins
        /immunoglobulin/i, /\bIg\b/i, /\bIVIG\b/i, /\bATS\b/,
        /erythropoietin/i, /epoetin/i, /darbepoetin/i,
        /interferon/i, /filgrastim/i, /\bG-CSF\b/,
        /albumin/i,

        // الهرمونات
        /oxytocin/i, /calcitonin/i, /\bACTH\b/,
        /growth hormone/i, /somatropin/i,
        /follitropin/i, /\bFSH\b/, /\bLH\b/, /\bHCG\b/,

        // الـ Antibodies
        /rituximab/i, /trastuzumab/i, /bevacizumab/i,
        /infliximab/i, /adalimumab/i,

        // أخرى حساسة للحرارة
        /enoxaparin/i, /heparin sodium/i,
        /streptokinase/i, /alteplase/i
    ],
    frozen: [
        /\bfrozen\b/i,
        /fresh frozen plasma/i, /\bFFP\b/,
        /cryoprecipitate/i,
        /BCG vaccine/i  // بعض اللقاحات تتطلب تجميد
    ]
};

const ColdChain = {

    /**
     * فحص ما إذا كانت المادة cold-chain
     */
    isColdChain(item) {
        return !!(item?.coldChain?.required);
    },

    /**
     * فحص نوع التبريد
     */
    getStorageType(item) {
        if (!this.isColdChain(item)) return null;
        return item.coldChain.type || 'refrigerated';
    },

    /**
     * الحصول على درجة الحرارة المطلوبة
     */
    getTempRange(item) {
        if (!this.isColdChain(item)) return null;
        const cc = item.coldChain;
        return {
            min: cc.minC ?? (cc.type === 'frozen' ? -25 : 2),
            max: cc.maxC ?? (cc.type === 'frozen' ? -15 : 8),
            type: cc.type || 'refrigerated'
        };
    },

    /**
     * توليد HTML للأيقونة
     */
    renderBadge(item, size = 'normal') {
        if (!this.isColdChain(item)) return '';
        const type = this.getStorageType(item);
        const range = this.getTempRange(item);

        const icon = type === 'frozen' ? '❄️' : '🧊';
        const label = type === 'frozen'
            ? `مجمَّد ${range.min}°C إلى ${range.max}°C`
            : `مبرَّد ${range.min}°C إلى ${range.max}°C`;

        const fontSize = size === 'large' ? '1.1rem' : '0.85rem';

        return `<span title="${label}" style="font-size:${fontSize}">${icon}</span>`;
    },

    /**
     * توليد تنبيه عند الاستلام
     */
    showReceiveAlert(item, onAccept) {
        if (!this.isColdChain(item)) {
            if (onAccept) onAccept();
            return;
        }

        const range = this.getTempRange(item);
        const type = this.getStorageType(item);
        const icon = type === 'frozen' ? '❄️' : '🧊';

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'cc-receive-alert';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:500px;border:2px solid #818cf8">
                <h3 style="color:#818cf8;margin:0 0 8px">${icon} تنبيه Cold-Chain</h3>
                <p style="font-size:0.9rem;line-height:1.6">
                    <strong>${escapeHtml(item.name)}</strong> مادة ${type === 'frozen' ? 'مجمَّدة' : 'مبرَّدة'}
                    تتطلب التخزين بدرجة <strong>${range.min}°C إلى ${range.max}°C</strong>.
                </p>
                <div style="background:rgba(129,140,248,0.1);padding:10px;border-radius:6px;margin:10px 0;font-size:0.85rem">
                    <strong>تأكد من:</strong>
                    <ul style="margin:6px 0;padding-right:20px">
                        <li>نقلها إلى الثلاجة/المجمدة <strong>فوراً</strong> (خلال 30 دقيقة)</li>
                        <li>عدم تعرضها للحرارة أثناء النقل</li>
                        <li>التحقق من سلامة العبوة وعدم ذوبانها/تجمدها بشكل خاطئ</li>
                        <li>تسجيل وقت الاستلام لتتبع cold-chain</li>
                    </ul>
                </div>
                <div style="display:flex;gap:8px;margin-top:12px">
                    <button id="cc-receive-confirm" class="btn btn-primary" style="flex:1">
                        ✓ موافق وتم النقل
                    </button>
                    <button id="cc-receive-cancel" class="btn">إلغاء</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('cc-receive-confirm').onclick = () => {
            modal.remove();
            if (onAccept) onAccept();
        };
        document.getElementById('cc-receive-cancel').onclick = () => modal.remove();
    },

    /**
     * توليد تنبيه عند الصرف
     */
    showDispenseAlert(item, onAccept) {
        if (!this.isColdChain(item)) {
            if (onAccept) onAccept();
            return;
        }

        const type = this.getStorageType(item);
        const icon = type === 'frozen' ? '❄️' : '🧊';

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'cc-dispense-alert';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:500px;border:2px solid #818cf8">
                <h3 style="color:#818cf8;margin:0 0 8px">${icon} تنبيه Cold-Chain - صرف</h3>
                <p style="font-size:0.9rem;line-height:1.6">
                    <strong>${escapeHtml(item.name)}</strong> ${type === 'frozen' ? 'مجمَّدة' : 'مبرَّدة'}.
                </p>
                <div style="background:rgba(129,140,248,0.1);padding:10px;border-radius:6px;margin:10px 0;font-size:0.85rem">
                    <strong>تعليمات النقل للجهة المستلمة:</strong>
                    <ul style="margin:6px 0;padding-right:20px">
                        <li>استخدم <strong>حقيبة عازلة مع ${type === 'frozen' ? 'ثلج جاف' : 'ثلج/كمادات تبريد'}</strong></li>
                        <li>التسليم يجب أن يكون <strong>مباشراً</strong> (لا تخزين في درجة الغرفة)</li>
                        <li>أبلغ المستلم بطبيعة المادة ومتطلبات تخزينها</li>
                        <li>تأكد من وجود ثلاجة/مجمدة عاملة في الجهة المستلمة</li>
                    </ul>
                </div>
                <div style="display:flex;gap:8px;margin-top:12px">
                    <button id="cc-dispense-confirm" class="btn btn-primary" style="flex:1">
                        ✓ متابعة الصرف
                    </button>
                    <button id="cc-dispense-cancel" class="btn">إلغاء</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('cc-dispense-confirm').onclick = () => {
            modal.remove();
            if (onAccept) onAccept();
        };
        document.getElementById('cc-dispense-cancel').onclick = () => modal.remove();
    },

    /**
     * نموذج HTML لتعديل cold-chain
     * يُضاف في نموذج تعديل المادة
     */
    renderEditForm(item) {
        const cc = item?.coldChain || {};
        const enabled = !!cc.required;
        const type = cc.type || 'refrigerated';

        return `
            <details ${enabled ? 'open' : ''} style="margin-top:10px;border:1px solid var(--border);border-radius:6px;padding:8px">
                <summary style="cursor:pointer;font-weight:600;font-size:0.85rem">
                    🧊 متطلبات التخزين (Cold-Chain)
                </summary>
                <div style="margin-top:8px">
                    <label style="display:flex;align-items:center;gap:6px;font-size:0.85rem">
                        <input type="checkbox" id="cc-required" ${enabled ? 'checked' : ''}>
                        <span>هذه المادة تحتاج تبريد/تجميد (Cold-Chain)</span>
                    </label>

                    <div id="cc-details" style="margin-top:8px;${enabled ? '' : 'display:none'}">
                        <div style="margin:6px 0;font-size:0.8rem">
                            <label>
                                <input type="radio" name="cc-type" value="refrigerated" ${type === 'refrigerated' ? 'checked' : ''}>
                                <span>🧊 مبرَّد (2-8°C) - الأنسولين، اللقاحات، Biologics</span>
                            </label>
                        </div>
                        <div style="margin:6px 0;font-size:0.8rem">
                            <label>
                                <input type="radio" name="cc-type" value="frozen" ${type === 'frozen' ? 'checked' : ''}>
                                <span>❄️ مجمَّد (-15 إلى -25°C) - بلازما، FFP</span>
                            </label>
                        </div>
                        <div style="margin-top:8px">
                            <label style="font-size:0.78rem;color:var(--text2)">ملاحظات (اختياري)</label>
                            <input type="text" id="cc-notes" class="form-control" placeholder="مثلاً: يحفظ في الثلاجة الرئيسية"
                                value="${escapeHtml(cc.notes || '')}" maxlength="200">
                        </div>
                    </div>
                </div>
            </details>
            <script>
                (function(){
                    const cb = document.getElementById('cc-required');
                    if (cb) {
                        cb.addEventListener('change', () => {
                            const det = document.getElementById('cc-details');
                            if (det) det.style.display = cb.checked ? 'block' : 'none';
                        });
                    }
                })();
            </script>
        `;
    },

    /**
     * قراءة قيمة cold-chain من النموذج
     */
    readFormValue() {
        const required = document.getElementById('cc-required')?.checked || false;
        if (!required) return null;

        const typeEl = document.querySelector('input[name="cc-type"]:checked');
        const type = typeEl?.value || 'refrigerated';
        const notes = document.getElementById('cc-notes')?.value?.trim() || '';

        const result = {
            required: true,
            type,
            notes: notes || null
        };

        if (type === 'frozen') {
            result.minC = -25;
            result.maxC = -15;
        } else {
            result.minC = 2;
            result.maxC = 8;
        }

        return result;
    },

    /**
     * اقتراح تلقائي للمواد cold-chain من المخزون الحالي
     * تُستخدم مرة واحدة في الإعدادات لتحويل المواد الموجودة
     */
    async suggestColdChainForInventory(dept) {
        const inv = await db.collection(`departments/${dept}/inventory`).get();
        const suggestions = [];

        inv.forEach(d => {
            const item = d.data();
            if (item.coldChain?.required) return;  // محدَّد سابقاً

            const name = item.name || '';
            let matched = null;

            // فحص أنماط refrigerated
            for (const pattern of COLD_CHAIN_PATTERNS.refrigerated) {
                if (pattern.test(name)) {
                    matched = { type: 'refrigerated', minC: 2, maxC: 8 };
                    break;
                }
            }

            // فحص أنماط frozen
            if (!matched) {
                for (const pattern of COLD_CHAIN_PATTERNS.frozen) {
                    if (pattern.test(name)) {
                        matched = { type: 'frozen', minC: -25, maxC: -15 };
                        break;
                    }
                }
            }

            if (matched) {
                suggestions.push({
                    itemId: d.id,
                    code: item.code,
                    name: item.name,
                    proposed: matched
                });
            }
        });

        return suggestions;
    },

    /**
     * تطبيق الاقتراحات دفعة واحدة
     */
    async applyColdChainSuggestions(dept, suggestions) {
        const batch = db.batch();
        let count = 0;

        for (const sug of suggestions) {
            if (!sug.accept) continue;
            const ref = db.collection(`departments/${dept}/inventory`).doc(sug.itemId);
            batch.update(ref, {
                coldChain: {
                    required: true,
                    type: sug.proposed.type,
                    minC: sug.proposed.minC,
                    maxC: sug.proposed.maxC,
                    addedAt: firebase.firestore.Timestamp.now(),
                    addedBy: CU?.uid || 'system'
                }
            });
            count++;

            // commit كل 400 لتجنب حدود batch
            if (count % 400 === 0) {
                await batch.commit();
            }
        }

        if (count % 400 !== 0) {
            await batch.commit();
        }

        return count;
    },

    /**
     * فتح واجهة الاقتراح التلقائي
     */
    async openSuggestionDialog() {
        if (!isAdmin()) {
            showToast('متاح للمسؤولين فقط', 'error');
            return;
        }

        const dept = CURRENT_DEPT;
        showToast('جارٍ فحص المخزون...', 'info');

        let suggestions;
        try {
            suggestions = await this.suggestColdChainForInventory(dept);
        } catch (e) {
            showToast(`فشل: ${e.message}`, 'error');
            return;
        }

        if (suggestions.length === 0) {
            showToast('لا توجد مقترحات جديدة', 'info');
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'cc-suggest-modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:700px;max-height:90vh;overflow-y:auto">
                <button class="modal-close" onclick="document.getElementById('cc-suggest-modal').remove()">✕</button>
                <h3>🧊 اقتراح مواد Cold-Chain</h3>
                <p style="font-size:0.85rem;color:var(--text2)">
                    تم اكتشاف <strong>${suggestions.length}</strong> مادة تبدو أنها تحتاج تبريد/تجميد بناء على اسمها.
                    راجع كل مادة وحدد الموافقة قبل التطبيق.
                </p>
                <div style="margin:10px 0">
                    <button class="btn btn-sm" onclick="document.querySelectorAll('.cc-sug-cb').forEach(cb => cb.checked = true)">✓ تحديد الكل</button>
                    <button class="btn btn-sm" onclick="document.querySelectorAll('.cc-sug-cb').forEach(cb => cb.checked = false)">إلغاء التحديد</button>
                </div>
                <div style="max-height:400px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:6px">
                    ${suggestions.map((s, i) => `
                        <div style="display:flex;align-items:center;gap:8px;padding:6px;border-bottom:1px solid var(--border);font-size:0.82rem">
                            <input type="checkbox" class="cc-sug-cb" data-idx="${i}" checked>
                            <span style="font-size:1.1rem">${s.proposed.type === 'frozen' ? '❄️' : '🧊'}</span>
                            <div style="flex:1">
                                <strong>${escapeHtml(s.name)}</strong>
                                ${s.code ? `<span style="font-family:monospace;font-size:0.7rem;color:var(--muted);margin-right:6px">${escapeHtml(s.code)}</span>` : ''}
                                <div style="font-size:0.7rem;color:var(--text2)">
                                    ${s.proposed.type === 'frozen' ? 'مجمَّد' : 'مبرَّد'}: ${s.proposed.minC}°C إلى ${s.proposed.maxC}°C
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div style="display:flex;gap:8px;margin-top:12px">
                    <button id="cc-sug-apply" class="btn btn-success" style="flex:1">
                        ✓ تطبيق المحددة
                    </button>
                    <button class="btn" onclick="document.getElementById('cc-suggest-modal').remove()">إلغاء</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('cc-sug-apply').onclick = async () => {
            const checked = Array.from(document.querySelectorAll('.cc-sug-cb:checked'))
                .map(cb => parseInt(cb.dataset.idx));

            if (checked.length === 0) {
                showToast('لم تختر أي مادة', 'warning');
                return;
            }

            const toApply = checked.map(i => ({ ...suggestions[i], accept: true }));

            try {
                const count = await this.applyColdChainSuggestions(dept, toApply);
                showToast(`✓ تم تطبيق Cold-Chain على ${count} مادة`, 'success');
                document.getElementById('cc-suggest-modal').remove();
            } catch (e) {
                showToast(`فشل: ${e.message}`, 'error');
            }
        };
    }
};

window.ColdChain = ColdChain;

})();
