# 99's Guide — Phase 7.2: إصلاح توافق Leaderboard D1 Projection / Outbox

## النطاق

الحزمة مأخوذة من آخر ZIP الذي أرسلته (`99s-guide-main (50)(1).zip`). تعدّل فقط:

1. `server/features/leaderboard/cacheProtocol.ts`: قبول 0 نقطة؛ `CACHE_INCOMPLETE` يعاد كمحاولة transient، بينما 409 conflict يبقى permanent.
2. `cloudflare-private-data-api/src/leaderboardCache.ts`: توحيد ranking cache version إلى `leaderboard-ranking-v2` وقبول 0 نقطة.
3. `tests/leaderboard-d1-worker.test.ts`: تغطية 0 نقطة، اتساق v2، وتحسين مسار `/tmp` على Windows.
4. `tests/phase7-leaderboard-d1-contract.test.ts`: 3 اختبارات Regression (جديد).
5. `scripts/phase7-leaderboard-d1-audit.ts`: فحص read-only محدود لـOutbox ونسخ MONTHLY/SEMESTER/ALL_TIME (جديد).

**لا تحذف Weekly Challenges ولا السجلات التاريخية. لا توجد migrations ولا عمليات كتابة DB، ولا تغيير للـflags.**

## التثبيت المحلي

فك الحزمة في جذر `C:\projects\CHECKPOINT\99s-guide-1` بحيث تتوفر `scripts\apply-phase7-step2.cjs` و`phase7-step2.payload.json`. لا تنقل مجلدات TypeScript إضافية إلى جذر المشروع.

1. خذ `git status -sb` واحفظ تغييراتك الحالية أولاً.
2. `node scripts\apply-phase7-step2.cjs`
3. النتيجة المرجوة `CHECK_PASS` وبدون `BASELINE_CHANGED`. إذا ظهر اختلاف، أوقف التثبيت وأرسل السجل.
4. `node scripts\apply-phase7-step2.cjs --apply`
5. `npm run typecheck`
6. `npm run build`
7. `npx tsx --test tests/phase7-leaderboard-d1-contract.test.ts`
8. `npm run test:leaderboard`
9. اختياري للتأكد من Worker حقيقي محلي: `npx tsx --test tests/leaderboard-d1-worker.test.ts`. قد يحتاج `wrangler` ومهاجرات D1 المحلية؛ لا تشغله على قاعدة الإنتاج.
10. `npx tsx scripts/phase7-leaderboard-d1-audit.ts` — **READ_ONLY**؛ شارك الخلاصة فقط، لا ترسل .env.

> لا تُكرر تثبيت Phase 7.1، ولا تغيّر `LEADERBOARD_D1_READ_ENABLED` أو `LEADERBOARD_D1_PROJECTION_ENABLED` بناءً على هذه الحزمة وحدها.

## النشر (بعد نجاح الفحوص)

لا تستخدم `git add .` لأن الـpayload والنسخ الاحتياطية لا يلزم نشرها. أضف ملفات الكود والاختبار والـaudit فقط:

```bat
git add server/features/leaderboard/cacheProtocol.ts cloudflare-private-data-api/src/leaderboardCache.ts tests/leaderboard-d1-worker.test.ts tests/phase7-leaderboard-d1-contract.test.ts scripts/phase7-leaderboard-d1-audit.ts
git commit -m "Phase 7.2 align leaderboard D1 projection and outbox retries"
git push origin main
```

**مهم:** Cloudflare Pages ليست بالضرورة الـPrivate Data Worker. تحقق من نشر `cloudflare-private-data-api` بإصدار `v2`؛ إذا لم تكن لديه pipeline نشر تلقائي منفصل، انشره عبر `npm run deploy:private-worker` بعد نجاح اختبارات Worker، وباستخدام حساب Cloudflare الصحيح. يُفضَّل نشر Worker أولاً إذا كان الإسقاط مفعلاً بالفعل في Render، لتجنب فشل الرسائل أثناء فرق النسخ.

لا تنفّذ `study:replay:outbox` ولا `reproject` ولا `repair` تلقائياً؛ نراجع الـaudit أولاً، خصوصاً أي صفوف `POISON` و`BLOCKED` قديمة. وجود `POISON` لا يبرر حذفها.

## التراجع

بشرط عدم تعديل الملفات بعد تطبيق هذه الحزمة:

```bat
node scripts\apply-phase7-step2.cjs --rollback
```

ثم ارفع commit تراجع منفصلاً إذا سبق نشر التعديل. لا تحذف أي بيانات أو Worker tables.

## معيار إنهاء Phase 7.2

- التوافق البرمجي واجتياز الاختبارات دون فشل.
- تقرير audit يوضح حالة Outbox والوصول إلى Worker.
- إن وُجدت نسخ READY وكانت الإسقاطات مفعلة: مقارنة D1 مع PostgreSQL دون اختلافات.
- لا نعتمد Phase 7 Cutover حتى تنجح مرحلة 7.3 بالمقارنة الحقيقية.
