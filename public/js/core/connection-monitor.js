// ============================================================
// js/core/connection-monitor.js
// نظام مراقبة الاتصال الحقيقي بـ Firebase (لا navigator.onLine فقط)
// ============================================================
// v6.6:
// - فحص فعلي بـ Firestore (ليس فقط حالة الشبكة)
// - شريط حالة دائم في الأعلى
// - timeout على العمليات (لا تبقى معلقة للأبد)
// - تحديث كل 15 ثانية + قبل كل كتابة حساسة
// ============================================================

const ConnectionMonitor = {
    _status: 'unknown',          // 'connected' | 'slow' | 'disconnected' | 'unknown'
    _lastCheck: 0,
    _lastLatency: null,
    _checkInterval: null,
    _listeners: [],
    
    // ========== فحص اتصال فعلي بـ Firestore ==========
    async check(timeoutMs = 5000) {
        const t0 = performance.now();
        
        // 1. فحص الشبكة المحلية أولاً (سريع)
        if (!navigator.onLine) {
            this._setStatus('disconnected', null);
            return false;
        }
        
        // 🔧 v6.8.1: لا تفحص قبل تسجيل الدخول — الـ rules ستمنع القراءة
        // ونتيجة فاشلة تخدع ConnectionMonitor كأنه offline
        if (!firebase.auth().currentUser) {
            this._setStatus('unknown', null);
            return true; // افتراضياً نسمح بمتابعة الدخول
        }
        
        // 2. فحص فعلي بـ Firestore (ping خفيف)
        try {
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('timeout')), timeoutMs)
            );
            // 🔧 v6.8.1: نستخدم وثيقة المستخدم نفسه (صغيرة + مسموحة دائماً للقارئ المسجَّل)
            const uid = firebase.auth().currentUser.uid;
            const pingPromise = db.collection('users').doc(uid).get();
            await Promise.race([pingPromise, timeoutPromise]);
            
            const latency = Math.round(performance.now() - t0);
            this._lastLatency = latency;
            
            // تصنيف:
            if (latency < 1500) this._setStatus('connected', latency);
            else if (latency < 4000) this._setStatus('slow', latency);
            else this._setStatus('slow', latency);
            
            return true;
        } catch (e) {
            this._setStatus('disconnected', null);
            return false;
        }
    },
    
    _setStatus(status, latency) {
        const changed = this._status !== status;
        this._status = status;
        this._lastCheck = Date.now();
        if (latency !== null) this._lastLatency = latency;
        
        this._updateUI();
        
        if (changed) {
            this._listeners.forEach(fn => { try { fn(status, latency); } catch(e) { console.error(e); } });
        }
    },
    
    onStatusChange(fn) {
        this._listeners.push(fn);
    },
    
    getStatus() {
        return { 
            status: this._status, 
            latency: this._lastLatency,
            lastCheck: this._lastCheck,
            isConnected: this._status === 'connected' || this._status === 'slow',
        };
    },
    
    // ========== التحقق قبل عملية حساسة ==========
    async requireConnection(operationName = 'العملية') {
        // إذا الفحص الأخير حديث (آخر 10 ثوانٍ) وكان متصلاً، استخدمه
        const now = Date.now();
        if (this._status === 'connected' && (now - this._lastCheck) < 10000) {
            return true;
        }
        
        // فحص جديد
        showToast(`⏳ التحقق من الاتصال قبل ${operationName}...`, 'info', 2000);
        const ok = await this.check(3000);
        
        if (!ok) {
            showToast(
                `❌ لا يوجد اتصال موثوق بالخادم — تعذّر ${operationName}\n` +
                `سيُحفظ ما أدخلت كمسودة محلياً للحفاظ على البيانات`, 
                'error', 
                7000
            );
            return false;
        }
        
        if (this._status === 'slow') {
            const proceed = await App.confirmAction?.(
                `⚠️ الاتصال بطيء (${this._lastLatency}ms). ` +
                `قد تستغرق العملية وقتاً أطول. متابعة؟`
            );
            if (!proceed) return false;
        }
        
        return true;
    },
    
    // ========== شريط حالة الاتصال ==========
    _updateUI() {
        let bar = document.getElementById('connection-status-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'connection-status-bar';
            bar.style.cssText = `
                position: fixed; top: 0; left: 0; right: 0;
                z-index: 9999; padding: 4px 8px;
                font-size: 0.75rem; text-align: center;
                font-family: 'IBM Plex Sans Arabic', sans-serif;
                transition: all 0.3s; transform: translateY(-100%);
                box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            `;
            document.body.appendChild(bar);
        }
        
        let bg, text, show;
        switch (this._status) {
            case 'connected':
                bg = '#10b981'; text = `🟢 متصل (${this._lastLatency}ms)`; show = false;
                break;
            case 'slow':
                bg = '#f59e0b'; text = `🟡 اتصال بطيء (${this._lastLatency}ms) — احذر فقدان البيانات`; show = true;
                break;
            case 'disconnected':
                bg = '#ef4444'; text = `🔴 لا يوجد اتصال — لا تدخل بيانات حتى يعود الاتصال`; show = true;
                break;
            default:
                bg = '#6b7280'; text = '⚪ يتحقق...'; show = false;
        }
        
        bar.style.background = bg;
        bar.style.color = 'white';
        bar.textContent = text;
        bar.style.transform = show ? 'translateY(0)' : 'translateY(-100%)';
    },
    
    // ========== بدء التشغيل ==========
    start() {
        // 🔧 v6.8.1: فحص أولي فقط لو المستخدم مسجَّل
        if (firebase.auth().currentUser) {
            this.check();
        }
        
        // ✅ v6.8.1: فحص كل 60 ثانية (بدلاً من 30) لتوفير ~14,400 read/يوم لكل مستخدم
        // 20 مستخدم × 14,400 = 288,000 read يوفَّر/يوم
        if (this._checkInterval) clearInterval(this._checkInterval);
        this._checkInterval = setInterval(() => {
            // فقط لو المستخدم مسجَّل (لتفادي permission-denied)
            if (firebase.auth().currentUser) {
                this.check();
            }
        }, 60000);
        
        // ربط أحداث المتصفح
        window.addEventListener('online', () => {
            console.log('navigator.online detected → re-checking');
            if (firebase.auth().currentUser) this.check();
        });
        window.addEventListener('offline', () => {
            console.log('navigator.offline detected');
            this._setStatus('disconnected', null);
        });
        
        // فحص عند العودة لـ tab بعد فترة
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && (Date.now() - this._lastCheck > 60000) && firebase.auth().currentUser) {
                this.check();
            }
        });
    },
    
    stop() {
        if (this._checkInterval) {
            clearInterval(this._checkInterval);
            this._checkInterval = null;
        }
    },
};

window.ConnectionMonitor = ConnectionMonitor;
