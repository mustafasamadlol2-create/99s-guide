# 99's Guide — Phase 6 Read Stability Hotfix (v3)

## لماذا؟

أظهرت سجلات 16 نوفمبر 2026:
- الحساب 1 صار متطابقاً بعد المزامنة.
- الحساب 2 أُرسلت مهمة GamificationSnapshot (revision 36)، لكن تأكيد تسليمها لم يظهر بعد في السجل.
- الحساب 3 فشل في read_D1 قبل أي تعديل له.
- إعادة فحص الحساب 2 واجهت Prisma P2028 أثناء compare_canonical_summary.

هذه النسخة **لا تعالج تجدد التحديات أسبوعياً تلقائياً** ولا تثبت أن D1 سليم في الإنتاج. هدفها السماح بتشخيص قراءات مؤقتة دون إعادة الكتابة أو المخاطرة بالمكافآت.

## الملفات
- استبدل **فقط**: `scripts/phase6-gamification-weekly-reconcile.ts`
- لا يوجد SQL migration ولا إعادة نشر Render أو Cloudflare مطلوبة للسكربت المحلي.

## التغيير
- محاولة قراءة D1 ثلاث مرات عند أخطاء الشبكة/مهلة الاتصال/HTTP 408 أو 429 أو 5xx.
- إعادة قراءة Supabase فقط عند أخطاء مؤقتة منها `P2028`.
- لا إعادة تلقائية لـ `buildCanonicalGamificationD1Snapshot` (لأنها قد تمنح مكافآت)، ولا لـ `enqueuePrivateD1Projection`.
- إظهار كود D1 مثل `D1_HTTP_503` أو `D1_GET_TIMEOUT` بدلاً من `UNCLASSIFIED`.
- إظهار عدد الحسابات التي جرى فحصها فعلياً. توقف عند أول فشل، حتى في الوضع القراءة فقط.

## كيف تستخدمه الآن؟

**أبقِ CUTOVER=false. لا تكرر --apply للحساب 2 قبل أن يؤكد الفحص عدم وجود مَهمة معلقة.**

1. افحص الحسابين 2 و3 قراءة فقط:

```bat
npx tsx scripts/phase6-gamification-weekly-reconcile.ts --start-at=2 --max-accounts=2
```

2. إذا ظهر `failed=0`، والحساب 2 لم يعد مختلفاً (`divergent observed` للحساب 2 = صفر) بينما الحساب 3 لا يزال مختلفاً، وبعد أخذ Backup، نفّذ للحساب 3 فقط:

```bat
npx tsx scripts/phase6-gamification-weekly-reconcile.ts --start-at=3 --max-accounts=1 --apply --confirm-apply --max=1
```

3. بعد أن ينتهي Render Outbox Drainer من إرسال التحديث، افحص حساب 3:

```bat
npx tsx scripts/phase6-gamification-weekly-reconcile.ts --start-at=3 --max-accounts=1
```

4. إذا فشل أي فحص أو ظهر P2028 بعد ثلاث محاولات: لا تشغّل --apply. تحقق من اتصالات Supabase وسجلات Render وحالة Outbox. لا ترفع مهلة كل معاملات الإنتاج أو تزيل قيود القاعدة عشوائياً.

5. لا تشغّل `npm run gamification:d1:backfill` ولا تفعّل `PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED=true` لحين التأكد من جميع الحسابات والآلية التلقائية لتجدد Challenges.

## تنبيه
هذه الأدوات مرتبطة بـ Weekly Challenges الداخلية، وهي مختلفة عن Weekly Leaderboard الذي أُلغي من واجهة التطبيق. إذا كانت Challenges الأسبوعية ألغيت أيضاً، أوقف المصالحة وراجع تعريفات Challenges بدل إنشاء أسبوع جديد.

## حدود التحقق
تم فحص صياغة TypeScript وسلامة ZIP محلياً. لم تُجرَ اتصالات بقاعدة بيانات المستخدم أو Worker الإنتاجي، لذلك لم يتم تأكيد نجاح المزامنة الفعلية.
