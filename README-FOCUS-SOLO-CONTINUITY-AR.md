# 99’s Guide — Solo Focus Continuity Fix (18 November 2026)

هذه الحزمة مخصصة للإصدار الأخير الذي بُني على `99s-guide-1(1).zip` مع حزمة `Focus-Final-Repair-TypeScript-46-Errors` السابقة. **لا تمس Audio أو Group Focus أو نقاط المستخدمين أو ملفات `.env`.**

## المشاكل المستهدفة

1. `PLANNED_SESSIONS_COMPLETE` عند محاولة بدء أول محاضرة مكتملة بينما توجد محاضرات أخرى في الخطة: يبدأ السيرفر أول عنصر لديه جلسات غير مكتملة، دون حذف التاريخ أو تجاوز عدد الجلسات. إذا اكتملت **كل** الخطة، تنشئ الواجهة خطة دورة جديدة وتبدأها (بنقرة المستخدم على Start Focus فقط).
2. `This session is no longer current`: إذا فتح المستخدم رابطاً قديماً وهناك جلسة أخرى مؤكدة على السيرفر، يتم الانتقال إلى رابط الجلسة الحالية. إذا لم توجد جلسة حالية فلن نخترع جلسة؛ زر العودة يبقى متاحاً.
3. رسالة `Post-Focus actions are available only for completed Sessions`: استعلام فحص الرابط القديم أصبح صامتاً، لأن الاستجابة `409` قد تكون طبيعية؛ لا يتم إخفاء أخطاء بدء الجلسة أو إنهائها.
4. **PDF / YouTube**: حالة `RESOURCE_HANDOFF` كانت تستمر في حساب الوقت في السيرفر أصلاً، لكن العداد في الواجهة كان يتوقف ظاهرياً. صار العد المرئي يستمر أثناء وجود مصدر خارجي، بينما حالة `PAUSED` وحدها توقفه. لا نعطي إشارة إتمام أو نقاطاً إلا بعد تحقق السيرفر وعملية `Complete` الصحيحة. يجب العودة من وضع Handoff قبل إنهاء الجلسة.
5. حماية `idempotency`: عندما يختار السيرفر المحاضرة التالية، يسجل ID المحاضرة التي طلبها العميل في حدث بدء الجلسة (نوع الحدث موجود سابقاً، فقط توسعة آمنة للـpayload). عند فقدان الاستجابة وإعادة المحاولة بنفس المفتاح ترجع الجلسة نفسها، ولا تُنشأ جلسة ثانية.

## تطبيق محمي

- خذ Backup أو Git Commit قبل البدء.
- فك ZIP **بكامل محتوياته** داخل جذر `C:\projects\CHECKPOINT\99s-guide-1`.
- نفّذ:

```bat
node scripts\apply-focus-solo-continuity.cjs
```

يجب أن تظهر `CHECK_PASS`. إذا ظهرت `BASELINE_CHANGED` **لا تجبر الاستبدال**؛ أرسل أحدث ملفاتك حتى ندمجها دون فقدان تغييرات الإنتاج.

بعد نجاح الفحص:

```bat
node scripts\apply-focus-solo-continuity.cjs --apply
npm run typecheck
npx tsc --noEmit -p tsconfig.cloudflare-main.json
npm run build
npx tsx --test tests/focus-solo-continuity.test.ts tests/focus-timer.test.ts tests/focus-active-model.test.ts
```

في حال الحاجة للاسترجاع (قبل التعديل اليدوي على الملفات الجديدة):

```bat
node scripts\apply-focus-solo-continuity.cjs --rollback
```

## اختبارات فعلية قبل الإنتاج

- خطة محاضرات 1 و2 و3: إذا كانت الأولى مكتملة، يبدأ **الثانية**، لا يظهر `PLANNED_SESSIONS_COMPLETE`.
- عندما تنتهي جميع جلسات جميع المحاضرات، يؤدي الضغط على Start Focus إلى إنشاء **دورة جديدة** مع إبقاء التاريخ السابق.
- افتح PDF وانتقل إلى تبويب آخر؛ انتظر ثم ارجع: لا ينخفض معدل التقدم في السيرفر ولا يتوقف عداد الدراسة. جرّب YouTube بنفس الطريقة.
- أعد فتح رابط جلسة قديمة أثناء وجود جلسة حالية؛ ينتقل للجلسة الحالية. إذا لا توجد جلسة حالية، يظهر مسار العودة الآمن دون Toast غير مناسب.
- تحقق من Pause/Resume/Complete؛ لا يوجد إكمال أو نقاط مكررة. جرّب فقدان الاتصال بعد Start ثم إعادة المحاولة.
- افحص Focus Overview History وD1 focus session reconciliation، وتأكد من استمرار `CUTOVER_ENABLED=false`.

## ما تم التحقق منه في بيئة الإصلاح

- نجح **25 من 25** اختبار Unit أساسي متعلق بوقت Focus واختيار العنصر والـHandoff والـStudy Events schema.
- نجح فحص صياغة TypeScript للملفات المتأثرة. **لم يكتمل فحص TypeScript الشامل في بيئة Linux** بسبب كِبر المشروع وتعليق `tsc`، ولا يمكن هنا اختبار قاعدة Supabase الحية أو محاكاة Safari/Capacitor/WebView الحقيقي. عند المستخدم على Windows يجب التأكد من نجاح `npm run typecheck` و`npm run build` والاختبار العملي.
- أضيف اختبار PostgreSQL تكاملي مشروط ببيئة اختبار منفصلة (`tests/focus-postgres-integration.test.ts`) للتحقق من تقدم المحاضرات وإعادة المحاولة الآمنة؛ لا تشغله على Production.

## النشر

طبّق التحديث على بيئة Staging، **Backend على Render أولاً** (لأن Event schema وطريقة اختيار الجلسة تغيّرت) ثم Frontend على Cloudflare Pages. لا يلزم Database Migration لهذه الحزمة. اختبر قبل Production، وأبقِ قيم `PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED=false` وأي Cutover خاص بـFocus D1 كما هي، دون تفعيل.
