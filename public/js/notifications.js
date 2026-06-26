// ============================================================
// js/notifications.js — v7.4 (إعادة هيكلة شاملة)
// ============================================================
// إصلاحات v7.4:
//   ✅ TYPE_LABELS كامل: anomaly, backdated, stagnant (كانت ناقصة)
//   ✅ Cooldown لمنع تكرار الإشعارات (anomaly نفس المادة 5 مرات = إشعار واحد)
//   ✅ Cache لـ checkAnomalyAndNotify: لا يجلب 30 حركة كل صرف
//   ✅ Pagination حقيقي بدل 200 ثابت
//   ✅ IntersectionObserver للتعليم كـ مقروء (بدل batch update عشوائي)
//   ✅ _notifLogs في closure بدل window
//   ✅ عتبة 2σ بدلاً من 3σ (إشعارات مفيدة فعلياً)
//   ✅ VAPID_KEY من Firestore (settings/secrets/keys/vapid_key)
//   ✅ jsPDF بدل window.open للـ PDF
// ============================================================

(function() {
'use strict';

// ============================================================
// State داخلي (بدل window.*)
// ============================================================
const NotifState = {
    logs: [],              // الإشعارات المُحمَّلة حالياً
    lastDocSnap: null,     // cursor للـ pagination
    hasMore: true,
    pageSize: 50,          // حجم الصفحة (بدل 200 الثابت)
    readObserver: null,    // IntersectionObserver
    typeFilter: '',
    fromVal: '',
    toVal: ''
};

// ============================================================
// TYPE_LABELS كامل — تصحيح: anomaly, backdated, stagnant مضافة
// ============================================================
const TYPE_LABELS = {
    expiry:           { label: 'انتهاء الصلاحية',   cls: 'notif-type-expiry',   icon: '⏰' },
    daily_summary:    { label: 'ملخص يومي',          cls: 'notif-type-daily',    icon: '📊' },
    weekly_summary:   { label: 'ملخص أسبوعي',       cls: 'notif-type-weekly',   icon: '📈' },
    slow_moving:      { label: 'بطيئة الحركة',       cls: 'notif-type-slow',     icon: '🐌' },
    no_receive:       { label: 'لم تُستلم',           cls: 'notif-type-slow',     icon: '📭' },
    monthly_archive:  { label: 'أرشفة شهرية',        cls: 'notif-type-archive',  icon: '📦' },
    instant_wastage:  { label: 'هدر آني',             cls: 'notif-type-instant',  icon: '⚠️' },
    instant_low:      { label: 'نفاد مخزون',          cls: 'notif-type-instant',  icon: '📉' },
    instant_receive:  { label: 'استلام وارد',         cls: 'notif-type-instant',  icon: '📥' },
    instant_add:      { label: 'إضافة مادة',         cls: 'notif-type-instant',  icon: '➕' },
    // 🆕 v7.4 — كانت ناقصة كلياً
    anomaly:          { label: 'صرف غير اعتيادي',    cls: 'notif-type-instant',  icon: '🚨' },
    backdated:        { label: 'بأثر رجعي',           cls: 'notif-type-archive',  icon: '⏪' },
    stagnant:         { label: 'مواد راكدة',          cls: 'notif-type-slow',     icon: '💤' },
    need_reminder:    { label: 'تذكير الاحتياج',      cls: 'notif-type-archive',  icon: '📈' }
};

const TYPE_TITLES = {
    expiry:           'تقرير انتهاء الصلاحية',
    daily_summary:    'التقرير اليومي للمخزون',
    weekly_summary:   'التقرير الأسبوعي للمخزون',
    slow_moving:      'تقرير المواد بطيئة الحركة',
    no_receive:       'تقرير المواد التي لم تُستلم',
    monthly_archive:  'تقرير الأرشفة الشهرية',
    instant_wastage:  'تقرير الهدر الآني',
    instant_low:      'تقرير نفاد المخزون',
    instant_receive:  'تقرير استلام الوارد',
    instant_add:      'تقرير إضافة مادة جديدة',
    anomaly:          'تقرير الصرف غير الاعتيادي',
    backdated:        'تقرير الحركات بأثر رجعي',
    stagnant:         'تقرير المواد الراكدة',
    need_reminder:    'تذكير تقدير الاحتياج السنوي'
};

// ============================================================
// Cache للحركات المُجلَبة في checkAnomalyAndNotify
// لا نجلب 30 حركة كل صرف — نُعيد استخدام النتيجة لمدة 10 دقائق
// ============================================================
const AnomalyCache = new Map(); // itemId -> { qtys: [], t: timestamp }
const ANOMALY_CACHE_TTL = 10 * 60 * 1000; // 10 دقائق

Object.assign(App, {

    // ============================================================
    // حفظ إشعار في Firestore
    // ============================================================
    async _saveInstantNotif(type, title, body, items) {
        if (!requireOnline('حفظ الإشعار')) return;
        const safeItems = Array.isArray(items) ? items : [];
        try {
            await db.collection('notificationsLog').doc().set({
                type, title, body, items: safeItems,
                dept: CURRENT_DEPT,
                sentAt: firebase.firestore.FieldValue.serverTimestamp(),
                sentBy: CU?.email || 'system',
                sent: 'local',
                readAt: null
            });
            this._bumpBadge(1);
        } catch (e) {
            console.warn('_saveInstantNotif:', e.message);
        }
    },

    _bumpBadge(delta) {
        const badge = document.getElementById('notif-nav-badge');
        if (!badge) return;
        const cur = parseInt(badge.textContent) || 0;
        const next = Math.max(0, cur + delta);
        if (next === 0) {
            badge.style.display = 'none';
        } else {
            badge.textContent = next > 9 ? '9+' : String(next);
            badge.style.display = 'flex';
        }
    },

    async loadUnreadNotifCount() {
        try {
            // فقط count غير المقروءة — استعلام أخف
            const snap = await db.collection('notificationsLog')
                .where('dept', '==', CURRENT_DEPT)
                .where('readAt', '==', null)
                .limit(10).get();
            const unread = snap.size;
            const badge = document.getElementById('notif-nav-badge');
            if (!badge) return;
            if (unread > 0) {
                badge.textContent = unread > 9 ? '9+' : String(unread);
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        } catch (e) {
            // إذا فشل (مثل index ناقص)، اسقط بصمت
            console.warn('loadUnreadNotifCount:', e.message);
        }
    },

    // ============================================================
    // واجهة الإشعارات
    // ============================================================
    async renderNotificationsPage() {
        const mc = document.getElementById('main-content');
        if (!mc) return;

        const typeOptions = Object.entries(TYPE_LABELS)
            .map(([k, v]) => `<option value="${k}">${v.icon} ${v.label}</option>`)
            .join('');

        mc.innerHTML = `
        <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
                <h3 style="margin:0">🔔 سجل الإشعارات — ${DEPT_NAMES[CURRENT_DEPT] || CURRENT_DEPT}</h3>
                <div style="display:flex;gap:6px;flex-wrap:wrap">
                    <select id="notif-type-filter" class="form-control" style="width:auto">
                        <option value="">كل الأنواع</option>
                        ${typeOptions}
                    </select>
                    <input type="date" id="notif-from" class="form-control" style="width:auto" title="من">
                    <input type="date" id="notif-to" class="form-control" style="width:auto" title="إلى">
                    <div style="display:flex;gap:4px">
                        <button class="btn btn-sm btn-primary" onclick="App.downloadNotificationsReport('pdf')" title="تحميل PDF">⬇️ PDF</button>
                        <button class="btn btn-sm" onclick="App.downloadNotificationsReport('xlsx')" title="تحميل Excel" style="background:var(--success);color:#fff">⬇️ Excel</button>
                        <button class="btn btn-sm" onclick="App.downloadNotificationsReport('docx')" title="تحميل Word" style="background:#2b5797;color:#fff">⬇️ Word</button>
                        <button class="btn btn-sm" onclick="App._resetAndReloadNotifLog()" style="background:var(--surface3)">🔄</button>
                    </div>
                </div>
            </div>
            <div id="notif-log-container"><div style="text-align:center;padding:2rem;color:var(--muted)">جاري التحميل...</div></div>
            <div id="notif-load-more" style="text-align:center;margin-top:10px;display:none">
                <button class="btn btn-sm" onclick="App._loadMoreNotifs()">📃 تحميل المزيد</button>
            </div>
        </div>`;

        document.getElementById('notif-type-filter').onchange = () => this._resetAndReloadNotifLog();
        document.getElementById('notif-from').onchange = () => this._resetAndReloadNotifLog();
        document.getElementById('notif-to').onchange = () => this._resetAndReloadNotifLog();

        await this._resetAndReloadNotifLog();
    },

    async _resetAndReloadNotifLog() {
        NotifState.logs = [];
        NotifState.lastDocSnap = null;
        NotifState.hasMore = true;
        NotifState.typeFilter = document.getElementById('notif-type-filter')?.value || '';
        NotifState.fromVal = document.getElementById('notif-from')?.value || '';
        NotifState.toVal = document.getElementById('notif-to')?.value || '';
        await this._loadMoreNotifs();
    },

    async _loadMoreNotifs() {
        const container = document.getElementById('notif-log-container');
        const loadMoreEl = document.getElementById('notif-load-more');
        if (!container) return;

        // أول تحميل
        if (NotifState.logs.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted)">جاري التحميل...</div>';
        }

        try {
            // بناء query
            let q = db.collection('notificationsLog')
                .where('dept', '==', CURRENT_DEPT);

            if (NotifState.typeFilter) {
                q = q.where('type', '==', NotifState.typeFilter);
            }

            q = q.orderBy('sentAt', 'desc').limit(NotifState.pageSize);

            if (NotifState.lastDocSnap) {
                q = q.startAfter(NotifState.lastDocSnap);
            }

            const snap = await q.get();

            // pagination: حفظ آخر cursor
            if (snap.docs.length > 0) {
                NotifState.lastDocSnap = snap.docs[snap.docs.length - 1];
            }
            if (snap.docs.length < NotifState.pageSize) {
                NotifState.hasMore = false;
            }

            // filter بـ from/to (client-side: Firestore index لا يدعم where مع orderBy على حقول مختلفة)
            let newLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            if (NotifState.fromVal) {
                const fd = new Date(NotifState.fromVal + 'T00:00:00+03:00');
                newLogs = newLogs.filter(l => l.sentAt?.toDate?.() >= fd);
            }
            if (NotifState.toVal) {
                const td = new Date(NotifState.toVal + 'T23:59:59+03:00');
                newLogs = newLogs.filter(l => l.sentAt?.toDate?.() <= td);
            }

            NotifState.logs.push(...newLogs);
            this._renderNotifList();

            if (loadMoreEl) {
                loadMoreEl.style.display = NotifState.hasMore ? 'block' : 'none';
            }
        } catch (e) {
            container.innerHTML = `<div class="text-danger">خطأ: ${escapeHtml(e.message)}</div>`;
            console.error('_loadMoreNotifs:', e);
        }
    },

    _renderNotifList() {
        const container = document.getElementById('notif-log-container');
        if (!container) return;

        if (!NotifState.logs.length) {
            container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted)">📭 لا توجد إشعارات</div>';
            return;
        }

        container.innerHTML = NotifState.logs.map(log => {
            const t = TYPE_LABELS[log.type] || { label: log.type, cls: 'notif-type-daily', icon: '🔔' };
            const date = fmtDateTime(log.sentAt);
            const unreadClass = log.readAt ? '' : 'notif-unread';
            return `<div class="notif-log-item ${unreadClass}" data-id="${escapeHtml(log.id)}" data-unread="${log.readAt ? '0' : '1'}">
                <div class="notif-log-header">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                        <span class="notif-log-title">${escapeHtml(log.title || '')}</span>
                        <span class="notif-type-badge ${t.cls}">${t.icon} ${escapeHtml(t.label)}</span>
                        ${log.sent ? `<span style="font-size:0.68rem;color:var(--muted)">↗ ${escapeHtml(String(log.sent))}</span>` : ''}
                    </div>
                    <span class="notif-log-time">${date}</span>
                </div>
                <div class="notif-log-body">${escapeHtml(log.body || '')}</div>
                <div style="display:flex;gap:4px;margin-top:8px;flex-wrap:wrap">
                    <button class="btn btn-sm" style="font-size:0.7rem;background:var(--danger);color:#fff" onclick="App.downloadNotificationReport('${escapeHtml(log.id)}','pdf')">⬇️ PDF</button>
                    <button class="btn btn-sm" style="font-size:0.7rem;background:var(--success);color:#fff" onclick="App.downloadNotificationReport('${escapeHtml(log.id)}','xlsx')">⬇️ Excel</button>
                    <button class="btn btn-sm" style="font-size:0.7rem;background:#2b5797;color:#fff" onclick="App.downloadNotificationReport('${escapeHtml(log.id)}','docx')">⬇️ Word</button>
                </div>
            </div>`;
        }).join('');

        // IntersectionObserver: علِّم كمقروء عند الظهور الفعلي
        this._setupReadObserver();
    },

    // ============================================================
    // IntersectionObserver: تعليم مقروء عند ظهور العنصر فعلياً
    // ============================================================
    _setupReadObserver() {
        // dispose القديم
        if (NotifState.readObserver) {
            NotifState.readObserver.disconnect();
        }

        const observer = new IntersectionObserver((entries) => {
            const toMark = [];
            entries.forEach(entry => {
                if (entry.isIntersecting && entry.target.dataset.unread === '1') {
                    toMark.push(entry.target.dataset.id);
                    entry.target.dataset.unread = '0';
                    entry.target.classList.remove('notif-unread');
                    observer.unobserve(entry.target);
                }
            });

            if (toMark.length) {
                // batch update لكن فقط للظاهرة فعلياً
                const batch = db.batch();
                toMark.forEach(id => {
                    batch.update(
                        db.collection('notificationsLog').doc(id),
                        { readAt: firebase.firestore.FieldValue.serverTimestamp() }
                    );
                });
                batch.commit().then(() => {
                    this._bumpBadge(-toMark.length);
                }).catch(e => console.warn('mark-read batch:', e.message));
            }
        }, {
            root: null,
            rootMargin: '0px',
            threshold: 0.5 // 50% ظاهر
        });

        document.querySelectorAll('.notif-log-item[data-unread="1"]').forEach(el => {
            observer.observe(el);
        });

        NotifState.readObserver = observer;
    },

    // ============================================================
    // تصدير التقارير (jsPDF بدل window.open)
    // ============================================================
    downloadNotificationsReport(format) {
        if (!NotifState.logs.length) {
            showToast('لا توجد بيانات', 'warning');
            return;
        }
        const today = fmtDate(new Date());
        const rows = NotifState.logs.map(log => {
            const t = TYPE_LABELS[log.type] || { label: log.type };
            return [
                t.label, log.title || '—',
                fmtDateTime(log.sentAt),
                String(log.sent || '—'),
                log.body || '—'
            ];
        });
        const headers = ['النوع', 'العنوان', 'التاريخ والوقت', 'المستخدمون', 'التفاصيل'];

        this._downloadReport(format, 'سجل الإشعارات', today, headers, rows, null, null);

        // audit
        if (typeof auditExport === 'function') {
            auditExport('notifications_log', format, rows.length);
        }
    },

    downloadNotificationReport(logId, format) {
        const log = NotifState.logs.find(l => l.id === logId);
        if (!log) { showToast('لم يُعثر على الإشعار', 'error'); return; }
        const reportTitle = TYPE_TITLES[log.type] || 'تقرير إشعار';
        const today = fmtDate(new Date());
        const sentDate = fmtDateTime(log.sentAt);

        const headers = ['الرمز الوطني', 'اسم المادة', 'رقم الوجبة', 'العدد', 'تاريخ الانتهاء'];
        const rows = log.items?.length
            ? log.items.map(i => [
                i.code || '—', i.name || '—',
                i.batchNumber || '—',
                String(i.quantity ?? i.qty ?? '—'),
                i.expiryDate || '—'
            ])
            : [[log.body || '—', '', '', '', '']];

        this._downloadReport(format, reportTitle, today, headers, rows, sentDate, log.sent);

        if (typeof auditExport === 'function') {
            auditExport(`notification_${log.type}`, format, rows.length, { logId });
        }
    },

    _downloadReport(format, title, dateStr, headers, rows, sentDate, sentCount) {
        const fileName = `${title}_${new Date().toISOString().slice(0, 10)}`;

        if (format === 'xlsx') {
            const aoa = [
                [`${title} — ${dateStr}`],
                [`صدّره: ${CU?.email || '—'} | مستشفى الشطرة العام`],
                [],
                headers,
                ...rows
            ];
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(aoa);
            ws['!cols'] = headers.map(() => ({ wch: 22 }));
            ws['!merges'] = [
                { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
                { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } }
            ];
            XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 30));
            XLSX.writeFile(wb, `${fileName}.xlsx`);
            showToast('✅ تم تحميل Excel', 'success');
            return;
        }

        if (format === 'docx') {
            const tableRows = [headers, ...rows].map((row, ri) =>
                `<tr>${row.map(cell =>
                    ri === 0
                        ? `<th style="background:#1a3a5c;color:white;padding:6px;border:1px solid #1a3a5c;font-size:10pt">${escapeHtml(String(cell))}</th>`
                        : `<td style="padding:5px;border:1px solid #ccc;font-size:10pt">${escapeHtml(String(cell))}</td>`
                ).join('')}</tr>`).join('');

            const html = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office"
                xmlns:w="urn:schemas-microsoft-com:office:word" lang="ar" dir="rtl">
                <head><meta charset="UTF-8">
                <style>
                    body{font-family:Arial,sans-serif;direction:rtl;margin:2cm;font-size:11pt}
                    .hospital-name{font-size:14pt;font-weight:bold;color:#1a3a5c}
                    .dept-name{font-size:11pt;font-weight:bold;color:#1a3a5c}
                    .report-title{text-align:center;font-size:13pt;font-weight:bold;margin:16px 0;color:#1a3a5c;border-bottom:1px solid #ccc;padding-bottom:8px}
                    table{width:100%;border-collapse:collapse}
                    .footer{margin-top:40px;font-size:9pt;color:#555;border-top:1px solid #ccc;padding-top:8px;display:flex;justify-content:space-between}
                    .signature{text-align:center;margin-top:40px}
                </style></head><body>
                <div style="display:flex;justify-content:space-between;border-bottom:2px solid #1a3a5c;padding-bottom:10px;margin-bottom:16px">
                    <div>
                        <div class="hospital-name">مستشفى الشطرة العام</div>
                        <div class="dept-name">شعبة الصيدلة</div>
                    </div>
                    <div style="font-size:9pt;color:#555;text-align:left">
                        <div>التاريخ: ${escapeHtml(dateStr)}</div>
                        ${sentDate ? `<div>تاريخ الإشعار: ${escapeHtml(sentDate)}</div>` : ''}
                        ${sentCount != null ? `<div>أُرسل إلى: ${escapeHtml(String(sentCount))} مستخدم</div>` : ''}
                        <div>صدّره: ${escapeHtml(CU?.email || '—')}</div>
                    </div>
                </div>
                <div class="report-title">${escapeHtml(title)}</div>
                <table>${tableRows}</table>
                <div class="signature">
                    <div style="border-top:1px solid #000;width:160px;margin:40px auto 6px"></div>
                    <div>مسؤول الصيدلية</div>
                </div>
                <div class="footer">
                    <span>مستشفى الشطرة العام — شعبة الصيدلة</span>
                    <span>نظام مخزون الصيدلية v7.5</span>
                </div>
                </body></html>`;

            const blob = new Blob(['\ufeff' + html], { type: 'application/msword;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${fileName}.doc`;
            a.click();
            URL.revokeObjectURL(a.href);
            showToast('✅ تم تحميل Word', 'success');
            return;
        }

        // PDF — استخدام jsPDF بدل window.open
        this._downloadPDF(title, dateStr, headers, rows, sentDate, sentCount, fileName)
            .catch(e => {
                console.error('PDF generation failed:', e);
                showToast('فشل توليد PDF: ' + e.message, 'error');
            });
    },

    async _downloadPDF(title, dateStr, headers, rows, sentDate, sentCount, fileName) {
        // تحميل jsPDF إن لم يكن مُحمَّلاً (يُستخدم في pdf-generator.js أيضاً)
        if (!window.jspdf) {
            if (typeof App._loadJsPDF === 'function') {
                await App._loadJsPDF();
            } else {
                // تحميل مباشر
                await new Promise((resolve, reject) => {
                    const s1 = document.createElement('script');
                    s1.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
                    s1.onload = () => {
                        const s2 = document.createElement('script');
                        s2.src = 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.0/dist/jspdf.plugin.autotable.min.js';
                        s2.onload = resolve;
                        s2.onerror = reject;
                        document.head.appendChild(s2);
                    };
                    s1.onerror = reject;
                    document.head.appendChild(s1);
                });
            }
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

        // Header
        doc.setFontSize(14);
        doc.setTextColor(26, 58, 92);
        doc.text('Pharmacy Inventory System', 105, 15, { align: 'center' });
        doc.setFontSize(10);
        doc.setTextColor(85, 85, 85);
        doc.text('Al-Shatra General Hospital', 105, 22, { align: 'center' });

        // Title
        doc.setFontSize(12);
        doc.setTextColor(26, 58, 92);
        doc.text(title, 105, 32, { align: 'center' });

        // Meta
        doc.setFontSize(9);
        doc.setTextColor(85, 85, 85);
        doc.text(`Date: ${dateStr}`, 15, 40);
        if (sentDate) doc.text(`Notification: ${sentDate}`, 15, 45);
        if (sentCount != null) doc.text(`Recipients: ${sentCount}`, 15, 50);
        doc.text(`Exported by: ${CU?.email || '—'}`, 195, 40, { align: 'right' });

        // Table
        doc.autoTable({
            head: [headers],
            body: rows.map(r => r.map(c => String(c || ''))),
            startY: 55,
            theme: 'grid',
            styles: { fontSize: 8, cellPadding: 2 },
            headStyles: { fillColor: [26, 58, 92], textColor: 255, fontSize: 9 },
            alternateRowStyles: { fillColor: [245, 248, 255] }
        });

        // Footer
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(7);
            doc.setTextColor(150);
            doc.text(`Page ${i} of ${pageCount}`, 105, 290, { align: 'center' });
            doc.text('Pharmacy Inventory v7.5', 195, 290, { align: 'right' });
        }

        doc.save(`${fileName}.pdf`);
        showToast('✅ تم تحميل PDF', 'success');
    }
});

// ============================================================
// FCM - Web Push (محسَّن في v7.4)
// ============================================================
Object.assign(App, {
    /**
     * بناء ملخص شهري (يُستدعى عند login لمرة واحدة)
     */
    async buildMonthSummary(dept, year, month) {
        const summaryId = `${dept}-${year}-${String(month).padStart(2, '0')}`;
        const ref = db.collection('monthSummaries').doc(summaryId);
        try {
            const ex = await ref.get();
            if (ex.exists) return;
        } catch { return; }

        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0, 23, 59, 59);
        try {
            const snap = await db.collection('departments').doc(dept).collection('movements')
                .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(start))
                .where('createdAt', '<=', firebase.firestore.Timestamp.fromDate(end))
                .limit(5000).get();

            let totalOut = 0, totalIn = 0, totalWaste = 0;
            const byItem = {};
            const reversed = new Set();
            snap.forEach(d => {
                const m = d.data();
                if (m.movType === 'reverse' && m.reverseOf) reversed.add(m.reverseOf);
            });
            snap.docs.forEach(doc => {
                if (reversed.has(doc.id)) return;
                const m = doc.data();
                if (m.movType === 'reverse') return;
                const id = m.inventoryId;
                if (!byItem[id]) byItem[id] = { name: m.name || '', routine: 0, waste: 0, totalIn: 0 };
                const e = byItem[id], qty = m.quantity || 0;
                const isWaste = m.movementSubType === 'wastage' || m.dispensingCategory === 'waste';
                if (m.movType === 'out') {
                    if (isWaste) { e.waste += qty; totalWaste += qty; }
                    else { e.routine += qty; totalOut += qty; }
                }
                if (m.movType === 'in' && m.movementSubType !== 'return_good') {
                    e.totalIn += qty;
                    totalIn += qty;
                }
            });
            await ref.set({
                dept, year, month, summaryId,
                totalOut, totalIn, totalWaste,
                items: byItem,
                movementsCount: snap.docs.length,
                builtAt: firebase.firestore.Timestamp.now(),
                builtBy: CU?.email || 'system'
            });
        } catch (e) {
            console.warn('buildMonthSummary failed:', e.message);
        }
    },

    /**
     * تسجيل FCM Token — يقرأ VAPID_KEY من Firestore
     */
    async registerFCMToken() {
        try {
            // الفحوصات الأساسية
            if (!('Notification' in window)) {
                return { status: 'unsupported', reason: 'Notification API غير متاح' };
            }
            if (typeof messaging === 'undefined' || !messaging) {
                console.warn('FCM: firebase-messaging-compat لم يُحمَّل');
                return { status: 'unsupported', reason: 'Firebase Messaging غير متاح' };
            }

            // iOS check
            const ua = navigator.userAgent;
            const isIOS = /iPad|iPhone|iPod/.test(ua);
            const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
            if (isIOS && !isStandalone) {
                return { status: 'unsupported', reason: 'iOS يتطلب تثبيت التطبيق كـ PWA' };
            }

            // 🆕 v7.4: VAPID_KEY من Firestore بدل hardcoded
            const vapidKey = await getVapidKey();
            if (!vapidKey) {
                console.warn('⚠️ FCM: VAPID_KEY غير مُعيَّن في Firestore (settings/secrets/keys/vapid_key)');
                return {
                    status: 'not_configured',
                    reason: 'VAPID_KEY غير مُعيَّن — يُعدّه الـ Admin من صفحة الإعدادات'
                };
            }

            // طلب الإذن
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                return { status: 'denied', reason: 'المستخدم رفض الإذن' };
            }

            // التأكد من وجود service worker (v7.4: firebase-messaging-sw.js)
            const registration = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js')
                || await navigator.serviceWorker.register('/firebase-messaging-sw.js');

            const token = await messaging.getToken({
                vapidKey,
                serviceWorkerRegistration: registration
            });
            if (!token) {
                return { status: 'failed', reason: 'لم يُسترَد token' };
            }

            // حفظ في users
            const userRef = db.collection('users').doc(CU.uid);
            const userDoc = await userRef.get();
            const existing = userDoc.data()?.fcmTokens || [];
            if (!existing.includes(token)) {
                await userRef.update({
                    fcmTokens: firebase.firestore.FieldValue.arrayUnion(token),
                    lastTokenAt: firebase.firestore.FieldValue.serverTimestamp(),
                    notificationsEnabled: true,
                    fcmUserAgent: navigator.userAgent.slice(0, 200)
                });
            }

            // foreground messages
            messaging.onMessage(payload => {
                const { title, body } = payload.notification || {};
                if (title) showToast(`🔔 ${title}: ${body || ''}`, 'info', 8000);
                // تحديث البادج
                this.loadUnreadNotifCount?.();
            });

            return { status: 'success', token: token.slice(0, 20) + '...' };
        } catch (e) {
            console.error('FCM registration error:', e);
            return { status: 'error', reason: e.message };
        }
    },

    async copyCode(code) {
        if (!code) return;
        try {
            await navigator.clipboard.writeText(code);
            showToast(`📋 تم نسخ: ${code}`, 'success', 2000);
        } catch {
            const el = document.createElement('textarea');
            el.value = code;
            el.style.position = 'fixed';
            el.style.opacity = '0';
            document.body.appendChild(el);
            el.select();
            try { document.execCommand('copy'); } catch {}
            document.body.removeChild(el);
            showToast(`📋 تم نسخ: ${code}`, 'success', 2000);
        }
    }
});

// ============================================================
// إشعارات v7.3 محسَّنة: anomaly + backdated + stagnant
// ============================================================
Object.assign(App, {

    /**
     * فحص شذوذ — v7.4:
     *   - عتبة 2σ بدل 3σ (مفيد فعلياً)
     *   - cache للحركات 10 دقائق (يوفر قراءات)
     *   - cooldown ساعة لنفس المادة
     */
    async checkAnomalyAndNotify(itemId, qty) {
        if (!itemId || !qty || qty <= 0) return;

        // ⏰ cooldown ساعة لنفس المادة
        if (!checkCooldown(`anomaly:${itemId}`, 3600000)) return;

        try {
            // 🚀 cache: لا نجلب 30 حركة كل صرف
            let qtys;
            const cached = AnomalyCache.get(itemId);
            if (cached && Date.now() - cached.t < ANOMALY_CACHE_TTL) {
                qtys = cached.qtys;
            } else {
                const snap = await db.collection('departments').doc(CURRENT_DEPT).collection('movements')
                    .where('inventoryId', '==', itemId)
                    .where('movType', '==', 'out')
                    .orderBy('createdAt', 'desc')
                    .limit(30).get();

                if (snap.size < 10) {
                    AnomalyCache.set(itemId, { qtys: [], t: Date.now() });
                    return; // عيّنة صغيرة
                }

                qtys = snap.docs
                    .map(d => d.data())
                    .filter(m => m.movementSubType !== 'wastage' && !m.reverseOf)
                    .map(d => d.quantity || 0)
                    .filter(q => q > 0);

                AnomalyCache.set(itemId, { qtys, t: Date.now() });
            }

            if (qtys.length < 10) return;

            const mean = qtys.reduce((s, q) => s + q, 0) / qtys.length;
            const variance = qtys.reduce((s, q) => s + Math.pow(q - mean, 2), 0) / qtys.length;
            const stdDev = Math.sqrt(variance);
            if (stdDev === 0) return;

            const zScore = (qty - mean) / stdDev;

            // 🆕 v7.4: عتبة 2σ بدل 3σ + شرط نسبي (>50% من المتوسط)
            const isAnomaly = Math.abs(zScore) >= 2 && Math.abs(qty - mean) >= mean * 0.5;

            if (isAnomaly) {
                const item = AppState.inventory.get(itemId);
                const direction = zScore > 0 ? 'أعلى' : 'أقل';
                this._saveInstantNotif('anomaly',
                    `🚨 صرف غير اعتيادي: ${item?.name || ''}`,
                    `الكمية ${qty} ${direction} بـ ${Math.abs(zScore).toFixed(1)}σ من المتوسط (${mean.toFixed(0)})\nالمسؤول: ${CU?.email || '—'}`,
                    [{ itemId, code: item?.code, name: item?.name, qty, mean: Math.round(mean), stdDev: Math.round(stdDev), zScore: Number(zScore.toFixed(2)) }]
                );
            }
        } catch (e) {
            console.warn('checkAnomalyAndNotify:', e.message);
        }
    },

    /**
     * تنبيه عند تسجيل حركة بأثر رجعي — v7.4:
     *   - عتبة 48 ساعة (بدل 24) + Baghdad TZ
     *   - cooldown يوم لنفس المادة
     */
    async notifyBackdatedMovement(itemId, qty, dispDate, daysBack) {
        if (daysBack < 2) return; // 48 ساعة على الأقل
        if (!checkCooldown(`backdated:${itemId}`, 86400000)) return; // يوم لنفس المادة

        try {
            const item = AppState.inventory.get(itemId);
            this._saveInstantNotif('backdated',
                `⏪ حركة بأثر رجعي: ${item?.name || ''}`,
                `صُرفت ${qty} بتاريخ ${dispDate} (قبل ${daysBack} يوم)\nالمسؤول: ${CU?.email || '—'}`,
                [{ itemId, code: item?.code, name: item?.name, qty, daysBack }]
            );
        } catch (e) {
            console.warn('notifyBackdatedMovement:', e.message);
        }
    },

    /**
     * فحص المواد الراكدة — v7.4:
     *   - يُستدعى من GitHub Action (stagnant-check.yml) أو زر يدوي في settings
     *   - يجلب من AppState.inventory المحلي (لا قراءات إضافية)
     */
    async checkStagnantItems(daysThreshold) {
        if (!requireOnline('فحص الراكدة')) return { count: 0 };
        const threshold = daysThreshold || SETTINGS.slowMovingDays || 30;

        try {
            const items = [...AppState.inventory.values()];
            const now = new Date();
            const stagnant = items.filter(i => {
                if ((i.quantity || 0) === 0) return false;
                if (!i.lastDispenseAt) return false;
                const last = i.lastDispenseAt.toDate?.();
                if (!last) return false;
                const days = (now - last) / 86400000;
                return days >= threshold;
            }).sort((a, b) => {
                const la = a.lastDispenseAt?.toDate?.()?.getTime() || 0;
                const lb = b.lastDispenseAt?.toDate?.()?.getTime() || 0;
                return la - lb; // الأقدم أولاً
            });

            if (!stagnant.length) {
                showToast('✅ لا توجد مواد راكدة', 'success');
                return { count: 0 };
            }

            // cooldown أسبوعي لـ stagnant notification
            if (!checkCooldown(`stagnant:${CURRENT_DEPT}`, 7 * 86400000)) {
                showToast('ℹ️ أُرسل إشعار الراكدة هذا الأسبوع', 'info');
                return { count: stagnant.length, skipped: true };
            }

            const items5 = stagnant.slice(0, 5).map(i => `• ${i.name}: ${i.quantity || 0}`).join('\n');
            await this._saveInstantNotif('stagnant',
                `💤 ${stagnant.length} مادة لم تتحرك منذ ${threshold} يوم`,
                items5 + (stagnant.length > 5 ? `\n+ ${stagnant.length - 5} مادة أخرى` : ''),
                stagnant.slice(0, 30).map(i => ({
                    itemId: i.id, code: i.code || '', name: i.name || '',
                    quantity: i.quantity || 0,
                    lastDispenseAt: i.lastDispenseAt?.toDate?.()?.toISOString() || null
                }))
            );

            showToast(`💤 أُرسل إشعار: ${stagnant.length} مادة راكدة`, 'success');
            return { count: stagnant.length };
        } catch (e) {
            console.warn('checkStagnantItems:', e.message);
            showToast('فشل فحص الراكدة: ' + e.message, 'error');
            return { count: 0, error: e.message };
        }
    }
});

})();
