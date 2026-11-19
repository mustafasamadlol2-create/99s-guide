# 99's Guide — Phase 6: إغلاق هندسي فوري + حماية انتقال الأسبوع

هذه الحزمة **لا** تغيّر Supabase أو D1 أو Render أو GitHub تلقائياً، ولا تمنح نقاطاً. هدفها إغلاق فجوة يوم الاثنين عند تفعيل قراءة Gamification من D1: إذا أصبحت Weekly Challenges في D1 منتهية قبل وصول تجديد GitHub Actions، فإن طلب `/api/me/challenges` يستخدم قراءة Supabase القانونية لفترة الانتقال **فقط عند رمز الخطأ المحدد `PHASE6_WEEKLY_CHALLENGES_EXPIRED`**. تظل بقية أخطاء D1 مغلقة (`503`) ولا يتم تجاوزها. نقاط وتحديات الطلاب تحكمها خدمة Canonical الأصلية بنفس مفاتيح منع التكرار؛ لا يتم تكرار أي منطق مكافآت في هذا التحديث.

## التركيب

1. خذ Git commit من النسخة الحالية واختبر في Staging إن أمكن.
2. فك ZIP في جذر المشروع؛ الملفات المنسوخة هي `scripts/apply-phase6-boundary-bridge.cjs` و`scripts/phase6-boundary-payload.json` وREADME. لا تنقل محتوى الحزمة داخل مجلد TypeScript جديد.
3. `node scripts/apply-phase6-boundary-bridge.cjs` — يجب ظهور CHECK_PASS. يرفض اختلاف الـserver.ts عن الأنماط المعروفة.
4. `node scripts/apply-phase6-boundary-bridge.cjs --apply`.
5. `npm run typecheck && npm run build`.
6. `npx tsx --test tests/phase6-week-boundary.test.ts tests/gamification-challenge-periods.test.ts tests/gamification-challenge-progress.test.ts tests/gamification-challenges-route.test.ts`.
7. تشغيل فحوص READ_ONLY الحقيقية:
   `npm run gamification:d1:verify` ثم `npx tsx scripts/focus-d1-current-reconcile.ts`.
8. انشر Backend على Render **قبل** تفعيل Cutover. لا حاجة إلى Schema Migration. جرّب `/api/me/gamification` و`/api/me/achievements` و`/api/me/challenges` مع جلسة تجريبية في Staging.
9. لتفعيل D1 Cutover بشكل مراقب: غيّر `PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED=true` في **خدمة Render Backend فقط**، وليس GitHub Actions. يظل SYNC=true. أعد تشغيل الخدمة وتأكد من سلامة المحاور الثلاثة والنقاط والتحديات. لو ظهر خطأ 5xx أو قراءات غير صحيحة، عُد فوراً إلى `false` وأعد نشر الخدمة. لا تفعّل Cutover قبل نتائج هذه الفحوص.
10. GitHub Workflow المجهز سابقاً يحتفظ بـ `PHASE6_AUTO_APPLY=true` للتشغيل المجدول. يجب أن يبقى متغير CUTOVER=false داخل بيئة الـWorkflow المنفصلة.

## اختبار الانتقال إلى الأسبوع القادم الآن

`tests/phase6-week-boundary.test.ts` يحاكي بداية **2026-11-23 00:00 بغداد** بتمرير وقت محدد إلى دالة الفترات الحقيقية، ويختبر اختيار D1 الطبيعي، وقراءة Canonical فقط عند stale week، ورفض fallback في حالات D1 الأخرى. لا يغيّر وقت الجهاز ولا يكتب قاعدة البيانات ولا يحاكي فعلياً تسليم Outbox أو منح مكافآت حقيقية. لا يمكن إثبات أن GitHub schedule سيعمل فعلياً يوم الاثنين قبل حلول موعده، لكن يمكن إغلاق اختبار منطق الانتقال وحماية التطبيق الآن.

## الاسترجاع

`node scripts/apply-phase6-boundary-bridge.cjs --rollback` (يعمل فقط إذا لم تتغير الملفات التي عدّلها المثبّت بعد التطبيق). أو استخدم Git revert. **هذا يزيل حماية انتقال الأسبوع إذا كانت ما زالت مطلوبة.**

## حدود سلامة مهمة

- عند فشل Supabase خلال فترة الانتقال سيفشل الطلب بدلاً من عرض تقدم مزيف.
- هذا استثناء صريح لضمان تجربة الطالب عند تبدّل الأسبوع؛ لذلك **Cutover هنا D1-first مع Canonical fallback محدود لـWeekly Challenges أثناء انتقال الأسبوع**، وليس 100% D1-only لهذا المسار أثناء الانتقال.
- لا تجرِ أي `--apply` جديد للحسابات الـ123 حالياً؛ التطابق السابق `123/123` صحيح للأسبوع الجاري فقط.
- إن كان GitHub Actions مجدولاً ويعمل بالفعل وPHASE6_AUTO_APPLY=true، لا تضف Cron آخر أو تشغيل مصالحة متوازية.
