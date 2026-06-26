// ============================================================
// js/features/ocr-reader.js
// قراءة رقم الطلبية من صورة الورقة الحكومية بـ Tesseract.js
// ============================================================
// v6.7:
// - يحمّل Tesseract.js من CDN عند الطلب فقط (lazy load)
// - يدعم العربية والإنجليزية والأرقام
// - يستخرج رقم الطلبية (نمط: 7 أرقام مثل 0212587)
// - الصور لا تُحفظ في Firebase Storage (Free Tier!) — تُعالج في الذاكرة فقط
// - يقترح الرقم للمستخدم - الموافقة النهائية له
// ============================================================

const OCRReader = {
    _tesseractLoaded: false,
    _worker: null,
    
    // ========== تحميل Tesseract.js عند الطلب ==========
    async _loadTesseract() {
        if (this._tesseractLoaded && this._worker) return this._worker;
        
        return new Promise((resolve, reject) => {
            if (window.Tesseract) {
                this._tesseractLoaded = true;
                this._createWorker().then(resolve).catch(reject);
                return;
            }
            
            showToast('⏳ تحميل OCR (12 MB)... قد يستغرق دقيقة', 'info', 3000);
            
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.4/dist/tesseract.min.js';
            script.onload = async () => {
                this._tesseractLoaded = true;
                try {
                    const worker = await this._createWorker();
                    resolve(worker);
                } catch (e) { reject(e); }
            };
            script.onerror = () => reject(new Error('فشل تحميل Tesseract.js'));
            document.head.appendChild(script);
        });
    },
    
    async _createWorker() {
        if (this._worker) return this._worker;
        // تحميل اللغات: العربية + الإنجليزية (للأرقام)
        this._worker = await Tesseract.createWorker(['ara', 'eng']);
        return this._worker;
    },

    // ========== فتح نافذة OCR + اختيار صورة ==========
    async openOCRDialog(onResult) {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'ocr-modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:500px">
                <button class="modal-close" onclick="document.getElementById('ocr-modal').remove()">✕</button>
                <h3>📷 قراءة رقم الطلبية من الصورة</h3>
                <p class="text-muted" style="font-size:0.82rem">
                    التقط صورة واضحة للزاوية العلوية اليمنى من ورقة الطلبية
                    (حيث يوجد الرقم المطبوع)
                </p>
                
                <div style="margin:12px 0">
                    <input type="file" id="ocr-file" accept="image/*" capture="environment" 
                        class="form-control" style="padding:8px">
                </div>
                
                <div id="ocr-preview" style="display:none;margin:8px 0;text-align:center">
                    <img id="ocr-image" style="max-width:100%;max-height:200px;border-radius:6px">
                </div>
                
                <div id="ocr-progress" style="display:none;margin:8px 0">
                    <div style="background:#0f1c30;border-radius:6px;height:24px;overflow:hidden">
                        <div id="ocr-progress-bar" style="background:var(--primary);height:100%;width:0%;transition:width 0.3s"></div>
                    </div>
                    <div id="ocr-progress-text" style="text-align:center;font-size:0.8rem;margin-top:4px;color:var(--muted)"></div>
                </div>
                
                <div id="ocr-result" style="display:none;margin:8px 0;padding:8px;background:#0f1c30;border-radius:6px">
                    <strong>الأرقام المُكتشفة:</strong>
                    <div id="ocr-numbers" style="margin-top:6px"></div>
                </div>
                
                <div id="ocr-error" style="color:var(--danger);font-size:0.85rem;margin-top:8px"></div>
                
                <div style="display:flex;gap:8px;margin-top:12px">
                    <button class="btn btn-primary" id="ocr-process-btn" style="flex:1" disabled>
                        🔍 قراءة الصورة
                    </button>
                    <button class="btn" onclick="document.getElementById('ocr-modal').remove()" 
                        style="background:var(--muted);color:#0f172a">إلغاء</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        let selectedFile = null;
        
        document.getElementById('ocr-file').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            // التحقق من الحجم (max 10MB)
            if (file.size > 10 * 1024 * 1024) {
                document.getElementById('ocr-error').textContent = 'الصورة كبيرة جداً (الحد الأقصى 10 ميغا)';
                return;
            }
            
            selectedFile = file;
            const url = URL.createObjectURL(file);
            document.getElementById('ocr-image').src = url;
            document.getElementById('ocr-preview').style.display = 'block';
            document.getElementById('ocr-process-btn').disabled = false;
        });
        
        document.getElementById('ocr-process-btn').onclick = async () => {
            if (!selectedFile) return;
            
            document.getElementById('ocr-process-btn').disabled = true;
            document.getElementById('ocr-error').textContent = '';
            document.getElementById('ocr-progress').style.display = 'block';
            
            try {
                const result = await this.recognizeImage(selectedFile, (progress) => {
                    document.getElementById('ocr-progress-bar').style.width = `${progress.progress * 100}%`;
                    document.getElementById('ocr-progress-text').textContent = 
                        progress.status === 'recognizing text' ? `قراءة: ${Math.round(progress.progress * 100)}%` :
                        progress.status === 'loading tesseract core' ? 'تحميل OCR...' :
                        progress.status === 'initializing tesseract' ? 'تهيئة...' :
                        progress.status === 'loading language traineddata' ? 'تحميل اللغات...' :
                        progress.status === 'initializing api' ? 'بدء...' :
                        progress.status;
                });
                
                // استخراج الأرقام المحتملة (7 أرقام متتالية)
                const text = result.text;
                console.log('OCR result:', text);
                
                const numbers = this._extractDocumentNumbers(text);
                
                if (numbers.length === 0) {
                    document.getElementById('ocr-error').textContent = 'لم يُعثر على رقم طلبية صالح في الصورة';
                    document.getElementById('ocr-process-btn').disabled = false;
                    document.getElementById('ocr-progress').style.display = 'none';
                    return;
                }
                
                // عرض النتائج
                document.getElementById('ocr-result').style.display = 'block';
                document.getElementById('ocr-numbers').innerHTML = numbers.map(n => `
                    <button class="btn btn-sm" style="margin:2px;font-family:monospace;font-size:1.05rem" 
                        onclick="App._selectOCRNumber('${n}')">
                        ${n}
                    </button>
                `).join('');
                
                this._ocrCallback = onResult;
                
            } catch (e) {
                console.error(e);
                document.getElementById('ocr-error').textContent = `فشل: ${e.message}`;
                document.getElementById('ocr-process-btn').disabled = false;
                document.getElementById('ocr-progress').style.display = 'none';
            }
        };
    },

    // ========== استخراج أرقام الطلبيات المحتملة ==========
    _extractDocumentNumbers(text) {
        // نمط أرقام الطلبيات: 7 أرقام متتالية مثل 0212587
        // مع إمكانية وجود مسافات أو شرطات بسيطة
        const cleanText = text.replace(/[٠١٢٣٤٥٦٧٨٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
        const matches = cleanText.match(/\b\d{4,10}\b/g) || [];
        
        // فلتر: تركيز على الأرقام بطول 7 (الأكثر شيوعاً للطلبيات)
        const sorted = [...new Set(matches)].sort((a, b) => {
            // الأولوية للأرقام بطول 7
            const diff7 = Math.abs(a.length - 7) - Math.abs(b.length - 7);
            if (diff7 !== 0) return diff7;
            return a.localeCompare(b);
        });
        
        return sorted.slice(0, 5); // أعلى 5 احتمالات
    },

    // ========== المعالجة الأساسية للصورة ==========
    async recognizeImage(imageFile, progressCallback) {
        const worker = await this._loadTesseract();
        
        // ⚠️ الصورة تُعالج في الذاكرة فقط، لا تُحفظ في Firebase Storage
        if (progressCallback) {
            worker.setProgressHandler?.(progressCallback);
        }
        
        const result = await worker.recognize(imageFile);
        return { text: result.data.text, confidence: result.data.confidence };
    },

    _ocrCallback: null,
    
    // ========== تحرير Worker ==========
    async terminate() {
        if (this._worker) {
            await this._worker.terminate();
            this._worker = null;
            this._tesseractLoaded = false;
        }
    },
};

// إضافة الـ handler للاختيار
Object.assign(App, {
    _selectOCRNumber(number) {
        document.getElementById('ocr-modal')?.remove();
        if (OCRReader._ocrCallback) {
            OCRReader._ocrCallback(number);
            OCRReader._ocrCallback = null;
        } else {
            // افتراضي: نضع في حقل رقم الطلبية إن وُجد
            const docNoInput = document.getElementById('dd-doc-no');
            if (docNoInput) {
                docNoInput.value = number;
                docNoInput.dispatchEvent(new Event('input'));
                showToast(`✓ تم اختيار ${number}`, 'success');
            }
        }
    },
    
    // ========== فتح OCR من نموذج الصرف ==========
    openOCRForDocNo() {
        OCRReader.openOCRDialog((number) => {
            const docNoInput = document.getElementById('dd-doc-no');
            if (docNoInput) {
                docNoInput.value = number;
                docNoInput.dispatchEvent(new Event('input'));
                showToast(`✓ تم استخراج: ${number}`, 'success');
            }
        });
    },
});

window.OCRReader = OCRReader;
