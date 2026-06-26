// ============================================================
// js/utils/audit-export.js — v7.5
// ============================================================
// تسجيل كل عملية تصدير في auditLog + إضافة watermark في Excel
// 
// إصلاحات v7.5:
//   #9 حماية من Excel Formula Injection (CSV injection)
//      أي خلية تبدأ بـ = + - @ TAB CR → نضع ' في البداية ليجبر Excel
//      على معاملتها كنص
//   #12 إصلاح خطأ مطبعي (sheetName || sheetName) → (sheetName || 'Report')
// ============================================================

/**
 * يسجّل عملية تصدير في auditLog
 */
async function auditExport(reportName, format, rowCount, extra = {}) {
    try {
        if (!CU) return;
        await db.collection('auditLog').add({
            action: 'report_export',
            reportName,
            format,
            rowCount: rowCount || 0,
            dept: CURRENT_DEPT || null,
            extra: extra || {},
            by: CU.email || 'unknown',
            byUid: CU.uid,
            byRole: CU.role || 'unknown',
            at: firebase.firestore.FieldValue.serverTimestamp(),
            userAgent: navigator.userAgent.slice(0, 120)
        });
    } catch (e) {
        console.warn('auditExport فشل:', e.message);
    }
}

/**
 * صف الـ watermark في رأس الـ Excel/Word
 */
function exportWatermark(reportName) {
    const now = new Date().toLocaleString('en-GB', {
        timeZone: 'Asia/Baghdad',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
    });
    return [
        `${reportName} — صدّره: ${CU?.email || 'مجهول'} (${CU?.role || '—'}) | ${now} | مستشفى الشطرة العام`
    ];
}

/**
 * 🆕 v7.5 #9: حماية من Excel/CSV Formula Injection
 * 
 * المشكلة: لو أدخل مستخدم في حقل ملاحظة قيمة مثل:
 *   =cmd|'/c calc'!A1
 *   =HYPERLINK("http://evil.com", "Click")
 *   +SUM(A1:A100)
 * عند فتح المُصدَّر في Excel على جهاز آخر، يُنفَّذ كصيغة (سرقة بيانات، تنفيذ أوامر).
 * 
 * الحل: أي خلية تبدأ بأحد الأحرف الخطرة → نضع ' في البداية.
 * Excel يعامل ' كـ "هذا نص حرفي، لا تفسّره كصيغة" ولا تظهر ' للمستخدم.
 */
function sanitizeExcelCell(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    let s = String(value);
    // إزالة HTML tags وdecode entities (السلوك القديم)
    s = s.replace(/<[^>]*>/g, '')
         .replace(/&nbsp;/g, ' ')
         .replace(/&amp;/g, '&')
         .replace(/&lt;/g, '<')
         .replace(/&gt;/g, '>')
         .replace(/&quot;/g, '"')
         .replace(/&#039;/g, "'")
         .replace(/&#x?[0-9a-f]+;?/gi, '') // باقي الـ numeric entities
         .trim();
    // 🔴 v7.5: الحماية من Formula Injection
    if (s.length > 0) {
        const first = s.charAt(0);
        // = + - @ TAB(0x09) CR(0x0d) → كلها بدايات صيغ Excel/CSV
        if (first === '=' || first === '+' || first === '-' ||
            first === '@' || first === '\t' || first === '\r') {
            s = "'" + s;
        }
    }
    return s;
}

/**
 * Helper موحَّد: تصدير Excel مع watermark + audit + حماية Formula Injection
 */
async function exportXlsxAudited(opts) {
    const { filename, reportName, sheetName, headers, rows, columnWidths, extra } = opts;
    if (typeof XLSX === 'undefined') {
        showToast('XLSX غير محملة', 'error');
        return false;
    }
    if (!Array.isArray(rows) || !rows.length) {
        showToast('لا بيانات للتصدير', 'warning');
        return false;
    }

    try {
        // 🔴 v7.5: تنظيف كل خلية ضد Formula Injection
        const cleanRows = rows.map(r => r.map(sanitizeExcelCell));
        // العناوين أيضاً (احتمالية ضعيفة لكن defense-in-depth)
        const cleanHeaders = headers.map(sanitizeExcelCell);

        const wb = XLSX.utils.book_new();
        const aoa = [
            exportWatermark(reportName),
            [],
            cleanHeaders,
            ...cleanRows
        ];
        const ws = XLSX.utils.aoa_to_sheet(aoa);

        // عرض الأعمدة
        if (Array.isArray(columnWidths)) {
            ws['!cols'] = columnWidths.map(w => ({ wch: w }));
        } else {
            ws['!cols'] = cleanHeaders.map(() => ({ wch: 18 }));
        }

        // دمج خلية الـ watermark على عرض الأعمدة
        ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: cleanHeaders.length - 1 } }];

        // 🔴 v7.5 #12: إصلاح خطأ مطبعي
        // كان: (sheetName || sheetName).slice(0, 30) ← لا منطق
        // الآن: (sheetName || 'Report').slice(0, 30)
        XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'Report').slice(0, 30));
        XLSX.writeFile(wb, `${filename}.xlsx`);

        // تسجيل في auditLog
        auditExport(reportName, 'xlsx', cleanRows.length, extra);

        showToast(`✅ صُدِّرت ${cleanRows.length} صف`, 'success');
        return true;
    } catch (e) {
        console.error('exportXlsxAudited:', e);
        showToast('فشل التصدير: ' + e.message, 'error');
        return false;
    }
}

// التصدير للنطاق العام
window.auditExport = auditExport;
window.exportWatermark = exportWatermark;
window.exportXlsxAudited = exportXlsxAudited;
window.sanitizeExcelCell = sanitizeExcelCell;
