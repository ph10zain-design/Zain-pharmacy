// ============================================================
// js/main.js — نقطة الدخول + اختصارات لوحة المفاتيح
// ============================================================

document.addEventListener('keydown', e => {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        const active = document.activeElement;
        const tag = active?.tagName;
        const isEditable = active?.isContentEditable;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !isEditable) {
            e.preventDefault();
            GlobalSearch.open();
        }
    }
    if (e.key === 'Escape') {
        GlobalSearch.close();
        document.querySelector('.modal')?.remove();
    }
    if (e.key === 'Enter' && e.ctrlKey) {
        document.querySelector('.modal .btn-primary')?.click();
    }
});
