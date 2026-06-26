// ============================================================
// js/features/pdf-generator.js
// توليد PDF يطابق ورقة الطلبية الحكومية (0212587)
// ============================================================
// v6.8:
// - 🔧 تواريخ PDF: ar-IQ (أرقام عربية) → en-GB + Baghdad (أرقام لاتينية)
// - نفس قاعدة المشروع: English-only numerals 0-9
// v6.7:
// - يستخدم jsPDF + jsPDF-AutoTable (CDN)
// - يطابق layout الورقة: header + جدول + توقيعات
// - دعم العربية RTL
// - عرض quantityWords في عمود "الكمية كتابة"
// ============================================================

Object.assign(App, {

    // ========== توليد PDF لطلبية واحدة ==========
    async printDocumentPDF(documentNo) {
        if (!window.jspdf) {
            await this._loadJsPDF();
        }
        
        try {
            // جلب البيانات
            const refSnap = await db.collection('departments').doc(CURRENT_DEPT)
                .collection('documentRefs').doc(documentNo).get();
            if (!refSnap.exists) throw new Error('الطلبية غير موجودة');
            const ref = refSnap.data();
            
            const movsSnap = await db.collection('departments').doc(CURRENT_DEPT)
                .collection('movements')
                .where('documentNo', '==', documentNo)
                .where('movType', '==', 'out')
                .get();
            
            const movs = movsSnap.docs.map(d => d.data())
                .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
            
            if (movs.length === 0) throw new Error('لا توجد مواد في هذه الطلبية');
            
            // معلومات من أول حركة (مصدر الحقيقة)
            const firstMov = movs[0];
            const docDate = firstMov.documentDate?.toDate?.() || ref.createdAt?.toDate?.();
            const destination = firstMov.destination;
            
            // توليد PDF
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4',
                putOnlyUsedFonts: true,
            });
            
            // ✅ إضافة خط عربي
            await this._addArabicFont(doc);
            doc.setR2L(true);
            doc.setFont('Amiri');
            
            // ===== Header =====
            doc.setFontSize(14);
            doc.text('وزارة الصحة', 105, 15, { align: 'center' });
            doc.setFontSize(11);
            doc.text('دائرة صحة ذي قار', 105, 22, { align: 'center' });
            doc.text('مستشفى الشطرة العام', 105, 28, { align: 'center' });
            
            // خط فاصل
            doc.setLineWidth(0.5);
            doc.line(15, 32, 195, 32);
            
            // معلومات الطلبية
            doc.setFontSize(10);
            const headerY = 40;
            doc.text(`رقم الطلبية: ${documentNo}`, 195, headerY, { align: 'right' });
            doc.text(`التاريخ: ${docDate ? docDate.toLocaleDateString('en-GB', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit', numberingSystem: 'latn' }) : '—'}`, 15, headerY, { align: 'left' });
            
            const destText = `إلى: ${destination?.main || '—'}${destination?.sub ? ' - ' + destination.sub : ''}`;
            doc.text(destText, 195, headerY + 7, { align: 'right' });
            
            // ===== الجدول =====
            const tableData = movs.map((m, idx) => [
                idx + 1,
                m.name || '—',
                m.quantity || 0,
                m.quantityWords || '',
                this._formatExpiry(m),
                this._formatBatchNumbers(m),
                m.notes || '',
            ]);
            
            doc.autoTable({
                startY: headerY + 15,
                head: [['ت', 'اسم المادة', 'الكمية', 'الكمية كتابة', 'تاريخ النفاذ', 'رقم الوجبة', 'الملاحظات']],
                body: tableData,
                styles: { 
                    font: 'Amiri', 
                    fontSize: 9, 
                    halign: 'center',
                    cellPadding: 2,
                },
                headStyles: { 
                    fillColor: [30, 58, 138], 
                    textColor: 255,
                    halign: 'center',
                    fontStyle: 'bold',
                },
                columnStyles: {
                    0: { cellWidth: 10 },
                    1: { cellWidth: 45 },
                    2: { cellWidth: 18 },
                    3: { cellWidth: 35 },
                    4: { cellWidth: 22 },
                    5: { cellWidth: 25 },
                    6: { cellWidth: 25 },
                },
                didDrawPage: (data) => {
                    // Footer مع رقم الصفحة
                    const pageCount = doc.internal.getNumberOfPages();
                    doc.setFontSize(8);
                    doc.text(`صفحة ${data.pageNumber} من ${pageCount}`, 105, 287, { align: 'center' });
                },
            });
            
            // ===== التوقيعات =====
            const finalY = doc.lastAutoTable.finalY + 15;
            doc.setFontSize(10);
            doc.setLineWidth(0.3);
            
            // 4 توقيعات في صف واحد
            const sigY = finalY + 20;
            const signatures = [
                { label: 'المستلم', x: 175 },
                { label: 'المسلم', x: 130 },
                { label: 'الصيدلاني', x: 85 },
                { label: 'مدير المستشفى', x: 35 },
            ];
            signatures.forEach(sig => {
                doc.line(sig.x - 18, sigY, sig.x + 18, sigY);
                doc.text(sig.label, sig.x, sig.y + 5);
                doc.text(sig.label, sig.x, sigY + 6, { align: 'center' });
            });
            
            // معلومات الإصدار (في الأسفل)
            doc.setFontSize(7);
            doc.setTextColor(150);
            doc.text(
                `صدر من نظام مخزون الصيدلية v6.8 — ${fmtDateTime(new Date())} — ${ref.createdBy || ''}`,
                105, 280, { align: 'center' }
            );
            
            // ===== تنزيل =====
            const filename = `طلبية_${documentNo}_${docDate ? docDate.toLocaleDateString('en-GB', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit', numberingSystem: 'latn' }).replace(/\//g,'-') : 'date'}.pdf`;
            doc.save(filename);
            
            showToast(`✅ تم توليد ${filename}`, 'success', 4000);
            
            // Audit log
            try {
                await db.collection('auditLog').add({
                    action: 'document_pdf_generated',
                    documentNo,
                    dept: CURRENT_DEPT,
                    by: CU.email,
                    byUid: CU.uid,
                    at: firebase.firestore.FieldValue.serverTimestamp(),
                });
            } catch (e) { /* ignore */ }
            
        } catch (e) {
            console.error('PDF generation failed:', e);
            showToast(`فشل توليد PDF: ${e.message}`, 'error', 5000);
        }
    },

    // ========== تحميل jsPDF من CDN ==========
    _loadJsPDF() {
        return new Promise((resolve, reject) => {
            if (window.jspdf?.jsPDF) return resolve();
            
            showToast('⏳ تحميل مكتبة PDF...', 'info', 2000);
            
            const script1 = document.createElement('script');
            script1.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
            script1.onload = () => {
                const script2 = document.createElement('script');
                script2.src = 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.0/dist/jspdf.plugin.autotable.min.js';
                script2.onload = () => resolve();
                script2.onerror = () => reject(new Error('فشل تحميل jsPDF-AutoTable'));
                document.head.appendChild(script2);
            };
            script1.onerror = () => reject(new Error('فشل تحميل jsPDF'));
            document.head.appendChild(script1);
        });
    },

    // ========== إضافة خط عربي (Amiri) ==========
    // 🔧 v6.8.1: تحميل فعلي للخط من CDN — كانت الدالة فارغة وتنتج PDF بلا عربية!
    // يُحمَّل مرة واحدة ويُخزَّن في cache للاستخدامات اللاحقة
    async _addArabicFont(doc) {
        try {
            // cache الخط في النطاق العام بعد التحميل الأول
            if (!window._amiriFontBase64) {
                showToast('⏳ تحميل الخط العربي (مرة واحدة فقط)...', 'info', 3000);
                // Amiri Regular من Google Fonts via jsdelivr
                const fontUrl = 'https://cdn.jsdelivr.net/gh/aliftype/amiri@1.000/amiri-regular.ttf';
                const res = await fetch(fontUrl);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const buf = await res.arrayBuffer();
                // تحويل لـ base64
                const bytes = new Uint8Array(buf);
                let binary = '';
                const chunkSize = 0x8000;
                for (let i = 0; i < bytes.length; i += chunkSize) {
                    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
                }
                window._amiriFontBase64 = btoa(binary);
            }
            // إضافة الخط لـ jsPDF
            doc.addFileToVFS('Amiri-Regular.ttf', window._amiriFontBase64);
            doc.addFont('Amiri-Regular.ttf', 'Amiri', 'normal');
        } catch (e) {
            console.error('فشل تحميل خط Amiri:', e);
            // fallback: استخدم الخط الافتراضي + setR2L (دعم عربي محدود)
            showToast('⚠️ تعذّر تحميل الخط العربي - PDF قد لا يعرض العربية بشكل صحيح', 'warning', 5000);
        }
    },

    _formatExpiry(m) {
        if (m.batches && m.batches.length > 0) {
            const dates = m.batches
                .map(b => b.expiryDate?.toDate?.())
                .filter(d => d)
                .map(d => d.toLocaleDateString('en-GB', { timeZone: 'Asia/Baghdad', year: '2-digit', month: '2-digit', day: '2-digit', numberingSystem: 'latn' }));
            if (dates.length === 0) return '—';
            if (dates.length === 1) return dates[0];
            return dates.join(' / ');
        }
        const d = m.expiryDate?.toDate?.();
        return d ? d.toLocaleDateString('en-GB', { timeZone: 'Asia/Baghdad', year: '2-digit', month: '2-digit', day: '2-digit', numberingSystem: 'latn' }) : '—';
    },

    _formatBatchNumbers(m) {
        if (m.batches && m.batches.length > 0) {
            return m.batches.map(b => b.batchNumber).join(' / ');
        }
        return m.batchNumber || '—';
    },
});
