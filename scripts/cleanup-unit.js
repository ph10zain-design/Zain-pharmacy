// ============================================================
// scripts/cleanup-unit.js
// ============================================================
// يُشغَّل لمرة واحدة بعد ترقية v7.3
// يطبِّع حقل "unit" في كل المواد:
//   1. تحويل الأسماء العربية إلى Title Case الإنجليزي (حبة → Tablet)
//   2. تحويل الأحرف الصغيرة إلى Title Case (tablet → Tablet)
//   3. ملء unit من UNIT DOSE في القائمة الوزارية إن كان فارغاً
//
// للتشغيل:
//   cd scripts && npm install && node cleanup-unit.js
//   يستخدم FIREBASE_SA من Environment Variable (Application Default Credentials)
// ============================================================

const admin = require('firebase-admin');

// قراءة Firebase SA من Environment (GitHub Secrets أو ملف محلي)
let serviceAccount;
if (process.env.FIREBASE_SA) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SA);
} else {
    try {
        serviceAccount = require('./service-account.json');
    } catch (e) {
        console.error('❌ ملف service-account.json أو متغير FIREBASE_SA مطلوب');
        process.exit(1);
    }
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// خريطة التطبيع (مُتطابقة مع UNIT_ALIASES في globals.js)
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

function normalizeUnit(raw) {
    if (!raw) return null;
    const k = String(raw).trim().toLowerCase();
    return UNIT_ALIASES[k] || (raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase());
}

async function main() {
    const departments = ['pharmacy', 'medical_supplies'];
    let totalChecked = 0;
    let totalUpdated = 0;
    let totalFromMinistry = 0;

    // اقرأ القائمة الوزارية (UNIT_DOSE)
    console.log('📚 قراءة القائمة الوزارية...');
    const ministrySnap = await db.collection('ministryLists').where('active', '==', true).get();
    const ministryMap = {};
    ministrySnap.forEach(d => {
        const m = d.data();
        if (m.code && m.unitDose) {
            ministryMap[m.code] = m.unitDose;
        }
    });
    console.log(`   حُمِّل ${Object.keys(ministryMap).length} مادة من القائمة الوزارية`);

    for (const dept of departments) {
        console.log(`\n📦 معالجة قسم: ${dept}`);
        const invSnap = await db.collection('departments').doc(dept)
            .collection('inventory').get();

        const batch = db.batch();
        let batchCount = 0;

        for (const doc of invSnap.docs) {
            totalChecked++;
            const data = doc.data();
            const oldUnit = data.unit || '';
            let newUnit;

            if (!oldUnit) {
                // فارغ → ابحث في القائمة الوزارية
                if (data.code && ministryMap[data.code]) {
                    newUnit = normalizeUnit(ministryMap[data.code]);
                    totalFromMinistry++;
                } else {
                    continue;
                }
            } else {
                newUnit = normalizeUnit(oldUnit);
                if (newUnit === oldUnit) continue;
            }

            batch.update(doc.ref, { unit: newUnit });
            batchCount++;
            totalUpdated++;

            if (batchCount >= 400) {
                await batch.commit();
                console.log(`   ✅ commit دفعة من ${batchCount}`);
                batchCount = 0;
            }
        }
        if (batchCount > 0) {
            await batch.commit();
            console.log(`   ✅ commit أخير من ${batchCount}`);
        }
    }

    console.log(`\n✅ انتهى:`);
    console.log(`   فُحصت: ${totalChecked}`);
    console.log(`   تحدَّثت: ${totalUpdated}`);
    console.log(`   مُلئت من القائمة الوزارية: ${totalFromMinistry}`);
}

main().then(() => process.exit(0)).catch(e => {
    console.error('❌ خطأ:', e);
    process.exit(1);
});
