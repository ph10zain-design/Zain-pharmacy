// ============================================================
// js/features/session-counter.js — عداد عمليات الجلسة
// ============================================================

const SessionCounter = {
    dispense: 0,
    receive: 0,
    returns: 0,

    inc(type) {
        if (type === 'dispense') this.dispense++;
        else if (type === 'receive') this.receive++;
        else if (type === 'return') this.returns++;
        this._update();
    },

    _update() {
        const el = document.getElementById('session-counter');
        if (!el) return;
        const total = this.dispense + this.receive + this.returns;
        if (!total) { el.style.display = 'none'; return; }
        el.style.display = 'flex';
        // بناء آمن للـ DOM بدلاً من innerHTML
        el.innerHTML = '';
        const parts = [
            { icon: '📤', val: this.dispense },
            { icon: '📥', val: this.receive },
            { icon: '↩️', val: this.returns }
        ];
        parts.forEach(p => {
            if (!p.val) return;
            const span = document.createElement('span');
            span.textContent = `${p.icon} ${p.val}`;
            el.appendChild(span);
        });
    },

    reset() {
        this.dispense = 0;
        this.receive = 0;
        this.returns = 0;
        this._update();
    }
};
