// ============================================================
// js/features/global-search.js — بحث شامل ( / للفتح )
// ============================================================

const GlobalSearch = {
    _debounceTimer: null,
    _previousFocus: null,

    open() {
        this._previousFocus = document.activeElement;
        document.getElementById('global-search-overlay')?.classList.add('active');
        setTimeout(() => document.getElementById('global-search-input')?.focus(), 200);
    },

    close() {
        document.getElementById('global-search-overlay')?.classList.remove('active');
        const inp = document.getElementById('global-search-input');
        if (inp) inp.value = '';
        const res = document.getElementById('global-search-results');
        if (res) res.innerHTML = '';
        // استعادة التركيز
        if (this._previousFocus && document.contains(this._previousFocus)) {
            try { this._previousFocus.focus(); } catch(e) {}
        }
    },

    handleKey(e) { if (e.key === 'Escape') this.close(); },

    search(query) {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => this._doSearch(query), 200);
    },

    _doSearch(query) {
        const el = document.getElementById('global-search-results');
        if (!el) return;
        const q = (query || '').trim().toLowerCase();
        if (!q) { el.innerHTML = ''; return; }
        const now = new Date();

        // بحث بالاسم والرمز
        const byNameCode = itemsCache.filter(item =>
            (item.name || '').toLowerCase().includes(q) || (item.code || '').toLowerCase().includes(q)
        );

        // بحث برقم الوجبة (يتطلب cacheBatchNumbers — يُستدعى تلقائياً في loadInventoryForDept)
        const byBatch = [];
        itemsCache.forEach(item => {
            if (!item.batches || !Array.isArray(item.batches)) return;
            const matched = item.batches.filter(b => (b.batchNumber || '').toLowerCase().includes(q));
            if (matched.length) byBatch.push({ item, matchedBatches: matched });
        });

        if (!byNameCode.length && !byBatch.length) {
            el.innerHTML = '<p class="text-muted" style="text-align:center;padding:1rem">لا توجد نتائج</p>';
            return;
        }

        let html = '';

        // نتائج رقم الوجبة
        if (byBatch.length) {
            html += `<div style="font-size:0.72rem;color:var(--primary);padding:4px 8px;border-bottom:1px solid var(--border)">🎯 نتائج رقم الوجبة</div>`;
            byBatch.slice(0, 5).forEach(({ item, matchedBatches }) => {
                const allBatches = (item.batches || []).map(b => {
                    const isMatched = matchedBatches.some(mb => mb.batchNumber === b.batchNumber);
                    const expStr = b.expiryDate?.toDate?.()?.toLocaleDateString('en-GB', { calendar: 'gregory', numberingSystem: 'latn' }) || '—';
                    return `<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:0.7rem;${isMatched ? 'color:var(--primary);font-weight:600' : 'color:var(--text2)'}">
                        <span>${isMatched ? '🎯 ' : ''}${escapeHtml(b.batchNumber || '—')}</span>
                        <span>${b.quantity != null ? b.quantity + ' ' + escapeHtml(item.unit || '') : ''}</span>
                        <span>${expStr}</span>
                    </div>`;
                }).join('');
                html += `<div class="gs-result" onclick="GlobalSearch._goToItem('${escapeHtml(item.id)}')">
                    <div style="width:100%">
                        <div class="gs-result-name">${escapeHtml(item.name || '')}</div>
                        <div class="gs-result-meta">${escapeHtml(item.code || '')} | الكمية: ${item.quantity || 0} ${escapeHtml(item.unit || '')}</div>
                        <div style="background:var(--surface3);border-radius:6px;padding:6px;margin-top:4px">
                            <div style="font-size:0.7rem;color:var(--muted);margin-bottom:4px;display:flex;justify-content:space-between"><span>رقم الوجبة</span><span>الكمية</span><span>الانتهاء</span></div>
                            ${allBatches}
                        </div>
                    </div>
                </div>`;
            });
        }

        // نتائج الاسم/الرمز
        if (byNameCode.length) {
            if (byBatch.length) html += `<div style="font-size:0.72rem;color:var(--muted);padding:4px 8px;border-bottom:1px solid var(--border)">نتائج الاسم / الرمز</div>`;
            byNameCode.slice(0, 8).forEach(item => {
                const exp = item.earliestExpiry?.toDate?.();
                const days = exp ? Math.ceil((exp - now) / 86400000) : null;
                const expColor = !days ? 'var(--muted)' : days < 0 ? 'var(--danger)' : days < (SETTINGS.alertDays || 100) ? 'var(--warning)' : 'var(--success)';
                html += `<div class="gs-result" onclick="GlobalSearch._goToItem('${escapeHtml(item.id)}')">
                    <div>
                        <div class="gs-result-name">${escapeHtml(item.name || '')}</div>
                        <div class="gs-result-meta">${escapeHtml(item.code || '')}${days != null ? ` | <span style="color:${expColor}">${days} يوم</span>` : ''}</div>
                    </div>
                    <div class="gs-result-qty">${item.quantity || 0}<div style="font-size:0.65rem;color:var(--muted)">${escapeHtml(item.unit || '')}</div></div>
                </div>`;
            });
        }

        el.innerHTML = html;
    },

    _goToItem(itemId) {
        this.close();
        App.switchSection('inventory');
        setTimeout(() => {
            const item = AppState.inventory.get(itemId);
            if (!item) return;
            const s = document.getElementById('inv-search');
            if (s) { s.value = item.name || ''; s.dispatchEvent(new Event('input')); }
            setTimeout(() => {
                const row = document.querySelector(`#inv-table tbody tr[data-id="${itemId}"]`);
                if (row) {
                    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    row.style.background = 'rgba(34,211,238,0.12)';
                    setTimeout(() => row.style.background = '', 2000);
                }
            }, 400);
        }, 300);
    }
};
