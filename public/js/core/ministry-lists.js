// ============================================================
// js/core/ministry-lists.js
// طبقة التعامل مع /ministryLists/{listId}/items/{code}
// ============================================================
// v6.6:
// - cache في الذاكرة لتقليل reads
// - يدعم عدة قوائم لكل قسم (main, surgical, ...)
// - يدعم التحديث السنوي (active + archived)
// ============================================================

const MinistryLists = {
    _cache: new Map(),
    _loadingPromises: new Map(),

    async getActiveList(dept = CURRENT_DEPT, listType = 'main') {
        const cacheKey = `${dept}-${listType}`;
        if (this._cache.has(cacheKey)) return this._cache.get(cacheKey);
        if (this._loadingPromises.has(cacheKey)) return this._loadingPromises.get(cacheKey);
        
        const promise = this._loadActiveList(dept, listType);
        this._loadingPromises.set(cacheKey, promise);
        try {
            const result = await promise;
            this._cache.set(cacheKey, result);
            return result;
        } finally {
            this._loadingPromises.delete(cacheKey);
        }
    },

    async _loadActiveList(dept, listType) {
        try {
            const snap = await db.collection('ministryLists')
                .where('dept', '==', dept)
                .where('listType', '==', listType)
                .where('active', '==', true)
                .limit(1)
                .get();
            
            if (snap.empty) {
                console.warn(`⚠️ لا توجد قائمة وزارية نشطة لـ ${dept}/${listType}`);
                return { listId: null, header: null, items: new Map() };
            }
            
            const headerDoc = snap.docs[0];
            const listId = headerDoc.id;
            const header = headerDoc.data();
            
            const itemsSnap = await headerDoc.ref.collection('items').get();
            const items = new Map();
            itemsSnap.forEach(d => items.set(d.id, d.data()));
            
            console.log(`✓ تم تحميل قائمة ${listId}: ${items.size} مادة`);
            return { listId, header, items };
        } catch (e) {
            console.error('فشل تحميل القائمة الوزارية:', e);
            return { listId: null, header: null, items: new Map(), error: e.message };
        }
    },

    async getItemDetails(code, dept = CURRENT_DEPT, listType = 'main') {
        const list = await this.getActiveList(dept, listType);
        return list.items.get(code) || null;
    },

    async getAllItems(dept = CURRENT_DEPT, listType = 'main') {
        const list = await this.getActiveList(dept, listType);
        return Array.from(list.items.values());
    },

    async getItemsByHierarchy(dept = CURRENT_DEPT, listType = 'main') {
        const items = await this.getAllItems(dept, listType);
        const tree = {};
        for (const item of items) {
            const sys = item.systemCode || '00';
            const sub = item.subCategoryCode || '';
            const grp = item.groupCode || '';
            if (!tree[sys]) tree[sys] = { code: sys, name: item.systemName, nameAr: item.systemNameAr, subCategories: {}, items: [] };
            if (sub) {
                if (!tree[sys].subCategories[sub]) tree[sys].subCategories[sub] = { code: sub, name: item.subCategoryName, groups: {}, items: [] };
                if (grp) {
                    if (!tree[sys].subCategories[sub].groups[grp]) tree[sys].subCategories[sub].groups[grp] = { code: grp, name: item.groupName, items: [] };
                    tree[sys].subCategories[sub].groups[grp].items.push(item);
                } else tree[sys].subCategories[sub].items.push(item);
            } else tree[sys].items.push(item);
        }
        return tree;
    },

    async search(query, dept = CURRENT_DEPT, listType = 'main') {
        if (!query || query.length < 2) return [];
        const items = await this.getAllItems(dept, listType);
        const q = query.toLowerCase();
        return items.filter(it => 
            it.code.toLowerCase().includes(q) || 
            (it.name || '').toLowerCase().includes(q)
        ).slice(0, 50);
    },

    async getAllListsForDept(dept = CURRENT_DEPT) {
        const snap = await db.collection('ministryLists')
            .where('dept', '==', dept)
            .orderBy('year', 'desc')
            .get();
        const lists = [];
        snap.forEach(d => lists.push({ id: d.id, ...d.data() }));
        return lists;
    },

    async compareYears(dept, listType, year1, year2) {
        const id1 = `${dept}-${listType}-${year1}`;
        const id2 = `${dept}-${listType}-${year2}`;
        const [snap1, snap2] = await Promise.all([
            db.collection('ministryLists').doc(id1).collection('items').get(),
            db.collection('ministryLists').doc(id2).collection('items').get(),
        ]);
        const items1 = new Map();
        const items2 = new Map();
        snap1.forEach(d => items1.set(d.id, d.data()));
        snap2.forEach(d => items2.set(d.id, d.data()));
        const added = [], removed = [], modified = [];
        for (const [code, it2] of items2) {
            const it1 = items1.get(code);
            if (!it1) added.push(it2);
            else {
                const changes = [];
                if (it1.name !== it2.name) changes.push('الاسم');
                if (it1.unit !== it2.unit) changes.push('الوحدة');
                if (it1.level !== it2.level) changes.push('المستوى');
                if ((it1.yearlyNeed||0) !== (it2.yearlyNeed||0)) changes.push('الاحتياج');
                if (changes.length) modified.push({ code, name: it2.name, changes, before: it1, after: it2 });
            }
        }
        for (const [code, it1] of items1) if (!items2.has(code)) removed.push(it1);
        return { added, removed, modified, year1, year2, dept, listType };
    },

    invalidateCache(dept = null, listType = null) {
        if (dept && listType) this._cache.delete(`${dept}-${listType}`);
        else if (dept) for (const key of this._cache.keys()) if (key.startsWith(dept + '-')) this._cache.delete(key);
        else this._cache.clear();
    },

    async getStats(dept = CURRENT_DEPT, listType = 'main') {
        const list = await this.getActiveList(dept, listType);
        if (!list.header) return null;
        return {
            listId: list.listId,
            title: list.header.title,
            year: list.header.year,
            totalItems: list.header.totalItems,
            byLevel: list.header.byLevel || {},
            bySystem: list.header.bySystem || {},
            systemsList: list.header.systemsList || [],
        };
    },
};

window.MinistryLists = MinistryLists;
