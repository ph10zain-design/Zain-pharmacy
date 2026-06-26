// ============================================================
// js/core/draft-manager.js
// نظام حفظ المسودات لمنع فقدان البيانات
// ============================================================
// v6.6:
// - يحفظ كل تغيير في النماذج تلقائياً في sessionStorage
// - يستعيد المسودة عند فتح النموذج مرة أخرى
// - يعرض إشعاراً للمستخدم بوجود مسودة
// - يُمسح عند الحفظ الناجح أو الإلغاء الصريح
// - sessionStorage (وليس localStorage) → يُمسح عند إغلاق التبويب
//   مما يحافظ على فلسفة Online-Only لكن يحمي من فقدان عابر
// ============================================================

const DraftManager = {
    PREFIX: 'zain-draft-',
    
    // ========== حفظ مسودة ==========
    save(formId, data) {
        try {
            const key = this.PREFIX + formId;
            const payload = {
                data,
                savedAt: Date.now(),
                user: CU?.email || 'unknown',
                dept: CURRENT_DEPT,
            };
            sessionStorage.setItem(key, JSON.stringify(payload));
            return true;
        } catch (e) {
            console.warn('فشل حفظ المسودة:', e);
            return false;
        }
    },
    
    // ========== تحميل مسودة ==========
    load(formId) {
        try {
            const key = this.PREFIX + formId;
            const raw = sessionStorage.getItem(key);
            if (!raw) return null;
            const payload = JSON.parse(raw);
            
            // ✅ فلتر: نفس المستخدم + نفس القسم
            if (payload.user !== (CU?.email || 'unknown')) return null;
            if (payload.dept !== CURRENT_DEPT) return null;
            
            // ✅ فلتر: ليست قديمة (أكثر من 4 ساعات)
            if (Date.now() - payload.savedAt > 4 * 60 * 60 * 1000) {
                this.clear(formId);
                return null;
            }
            
            return payload.data;
        } catch (e) {
            console.warn('فشل تحميل المسودة:', e);
            return null;
        }
    },
    
    // ========== مسح مسودة ==========
    clear(formId) {
        try {
            sessionStorage.removeItem(this.PREFIX + formId);
        } catch (e) { /* ignore */ }
    },
    
    // ========== فحص وجود مسودة ==========
    has(formId) {
        return this.load(formId) !== null;
    },
    
    // ========== عمر المسودة بدقائق ==========
    getAge(formId) {
        try {
            const raw = sessionStorage.getItem(this.PREFIX + formId);
            if (!raw) return null;
            const payload = JSON.parse(raw);
            return Math.floor((Date.now() - payload.savedAt) / 60000);
        } catch { return null; }
    },
    
    // ========== مساعد للنماذج: ربط حفظ تلقائي ==========
    // مثال: DraftManager.attachAutoSave('dispense-doc', () => ({ items: state.items, ... }))
    attachAutoSave(formId, getDataFn, debounceMs = 1500) {
        let timer = null;
        const save = () => {
            try {
                const data = getDataFn();
                if (data) this.save(formId, data);
            } catch (e) {
                console.warn('autoSave failed:', e);
            }
        };
        
        return {
            triggerSave: () => {
                if (timer) clearTimeout(timer);
                timer = setTimeout(save, debounceMs);
            },
            saveNow: save,
            stop: () => { if (timer) clearTimeout(timer); }
        };
    },
    
    // ========== عرض إشعار وجود مسودة ==========
    promptRestore(formId, label = 'النموذج') {
        const age = this.getAge(formId);
        if (age === null) return false;
        
        const ageText = age < 1 ? 'الآن' : age < 60 ? `قبل ${age} دقيقة` : `قبل ${Math.floor(age/60)} ساعة`;
        return confirm(
            `💾 وُجدت مسودة محفوظة لـ ${label}\n` +
            `محفوظة ${ageText}\n\n` +
            `هل تريد استعادتها؟\n` +
            `(إلغاء = البدء من جديد + مسح المسودة)`
        );
    },
    
    // ========== مسح كل المسودات (تسجيل خروج) ==========
    clearAll() {
        try {
            const keys = [];
            for (let i = 0; i < sessionStorage.length; i++) {
                const k = sessionStorage.key(i);
                if (k && k.startsWith(this.PREFIX)) keys.push(k);
            }
            keys.forEach(k => sessionStorage.removeItem(k));
        } catch (e) { /* ignore */ }
    },
    
    // ========== قائمة كل المسودات (للتشخيص) ==========
    listAll() {
        const drafts = [];
        try {
            for (let i = 0; i < sessionStorage.length; i++) {
                const k = sessionStorage.key(i);
                if (k && k.startsWith(this.PREFIX)) {
                    const formId = k.replace(this.PREFIX, '');
                    drafts.push({
                        formId,
                        age: this.getAge(formId),
                        size: sessionStorage.getItem(k).length,
                    });
                }
            }
        } catch (e) { /* ignore */ }
        return drafts;
    },
};

window.DraftManager = DraftManager;
