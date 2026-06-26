// ============================================================
// js/core/globals.js — المتغيرات والثوابت العامة
// ============================================================
// v7.3 (إعادة الهيكلة الكبرى):
//   - حُذف: 'المختبر' من DESTINATIONS
//   - حُذف: SETTINGS.sources لم تتغير لكن مصادر الإرجاع حُذفت
//   - أُضيف: LedgerCacheV2 (نُقل من ledger.js المحذوف)
//   - أُضيف: REPORTS_CACHE_TTL لإعدادات الكاش
//
// v7.2: KADRE_LABELS موحَّد + UNIT_ALIASES موسَّع
// v6.6.1: SETTINGS.sources = 3 مصادر فقط
// ============================================================

let CURRENT_DEPT = 'pharmacy';
let CU = null;
const RATE_LIMIT_MS = 3000;
let lastDispenseTime = {};
const MovementsCache = new Map();

const LEDGER_PAGE_SIZE = 100;
let _invScrollY = 0;

const AppState = {
    inventory: new Map(),
    loaded: false,
    dept: null,
    lastSync: null,
    _batchesCached: false,
    activeCount: null
};

let itemsCache = [];
let needsDataCache = [];

// ============================================================
// 🆕 v7.3: LedgerCacheV2 — مُنقل من ledger.js
// TTL=120s + MaxEntries=20 (LRU eviction)
// ============================================================
const LedgerCacheV2 = {
    _store: new Map(),
    _ttl: 120 * 1000, // 2 minutes
    _maxEntries: 20,

    get(key) {
        const entry = this._store.get(key);
        if (!entry) return null;
        if (Date.now() - entry.t > this._ttl) {
            this._store.delete(key);
            return null;
        }
        // LRU: move to end
        this._store.delete(key);
        this._store.set(key, entry);
        return entry.data;
    },

    set(key, data) {
        // LRU eviction
        if (this._store.size >= this._maxEntries) {
            const firstKey = this._store.keys().next().value;
            this._store.delete(firstKey);
        }
        this._store.set(key, { data, t: Date.now() });
    },

    clear() {
        this._store.clear();
    },

    delete(key) {
        this._store.delete(key);
    }
};

const SETTINGS = {
    alertDays: 100,
    slowMovingDays: 30,
    sources: ['تجهيز دائرة', 'مشتريات', 'افتتاحي']
};

const DEPT_NAMES = {
    pharmacy: '💊 الأدوية',
    medical_supplies: '🩺 المستلزمات الطبية'
};

// 🆕 v7.3: حُذف 'المختبر' من قائمة الجهات
const DESTINATIONS = {
    'الصيدلة': ['صيدلية الطوارئ', 'الصيدلية الداخلية الصباحي', 'الصيدلية الاستشارية الصباحي', 'الصيدلية الداخلية الخفر', 'الصيدلية الاستشارية الخفر'],
    'التمريض': 'text',
    'صالة العمليات': null,
    'الأشعة': null,
    'المفراس': null,
    'الرنين': null,
    'مصرف الدم': null
};

// KADRE_LABELS موحَّد — لا يُكرَّر في users.js
const KADRE_LABELS = {
    admin: '🔴 المسؤول',
    staff: '🟢 كادر المذخر',
    viewer: '🔵 مشاهد'
};

const BAGHDAD_TZ = 'Asia/Baghdad';

const UNIT_ALIASES = {
    'tablet':'Tablet','tab':'Tablet','tabs':'Tablet','حبة':'Tablet','قرص':'Tablet','حب':'Tablet',
    'vial':'Vial','فيال':'Vial','قنينة':'Vial',
    'ampoule':'Ampoule','amp':'Ampoule','امبول':'Ampoule','أمبول':'Ampoule',
    'bottle':'Bottle','btl':'Bottle','زجاجة':'Bottle',
    'capsule':'Capsule','cap':'Capsule','كبسول':'Capsule',
    'bag':'Bag','كيس':'Bag',
    'piece':'Piece','pcs':'Piece','قطعة':'Piece',
    'tube':'Tube','أنبوب':'Tube',
    'sachet':'Sachet','ساشيه':'Sachet',
    'spray':'Spray','بخاخ':'Spray',
    'suppository':'Suppository','sup':'Suppository','تحميلة':'Suppository','لبوس':'Suppository',
    'powder':'Powder','مسحوق':'Powder','بودرة':'Powder',
    'kit':'Kit','جهاز':'Kit',
    'drop':'Drop','drops':'Drop','قطرة':'Drop','قطرات':'Drop',
    'aerosol':'Aerosol','ايروسول':'Aerosol','إيروسول':'Aerosol',
    'pfs':'PFS','syringe':'PFS','حقنة':'PFS','prefilled':'PFS',
    'cream':'Cream','كريم':'Cream',
    'ointment':'Ointment','مرهم':'Ointment',
    'gel':'Gel','جل':'Gel','جيل':'Gel',
    'syrup':'Syrup','شراب':'Syrup','سيرب':'Syrup',
    'inhaler':'Inhaler','مستنشق':'Inhaler',
    'lozenge':'Lozenge','مستحلب':'Lozenge'
};

const App = {};
