# 99's Guide — Focus Hub guarded stability patch (candidate)

## مهم
- هذه حزمة إصلاح مستهدفة، **ليست إثباتاً** أن جميع مشاكل الإنتاج انتهت. المرجع المتوفر للفحص هو `99s-guide-main (49)` من 29 أكتوبر 2026 مع صور 17 نوفمبر 2026، وليس نسخة مشروعك المحلي الحالية؛ لذلك استعملنا PATCHER يتحقق من مواضع الكود ويرفض الكتابة عند اختلافها.
- الحزمة لا تغير Prisma Schema ولا نقاط الطلاب ولا Outbox ولا Weekly Challenges ولا قواعد Phase 6.
- **أبقِ** `PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED=false`.

## الملفات التي يغيّرها الـPATCHER عند نجاح التحقق
1. `server.ts`: يضيف `https://*.r2.cloudflarestorage.com` فقط إلى `media-src` في CSP ليُسمح للوسائط الموقّعة من R2 بالعمل عند تقديم HTML من Render.
2. `src/features/focus/components/FocusAudioPlanningCard.tsx`: تصحيح تسمية الصوت المشترك (ليس ملفاً محلياً)، وإظهار رسالة تساعد على تمييز فشل الوصول إلى R2 أو سياسة المتصفح.
3. `src/features/focus/components/ActiveFocusScreen.tsx`: منع فتح عدة Materials بضغطات متزامنة؛ واستقبال حالة الجلسة المؤكدة من استجابة Break؛ والإرجاع من RESOURCE_HANDOFF قبل إرسال Break جديد (في التبويبات، الخطوة الأولى ترجع إلى Study، وبعدها يمكن بدء Break).
4. `src/features/group-focus/runtime/groupFocusRealtime.ts`: يضيف مهلة 12 ثانية لمصافحة WebSocket بدلاً من الانتظار المفتوح؛ عند الفشل يعرض خطأ ويتيح إعادة الاتصال، مع مسح المهلة عند النجاح. لا تختصر هذه المهلة الزمن الذي يحتاجه Worker فعلياً إن كان معطّلاً.
5. `src/features/group-focus/GroupFocusFrontend.tsx`: استخدام نتيجة إنشاء الغرفة الموثقة من السيرفر فوراً لبدء اتصال realtime؛ مع إبقاء إعادة GET والتحقق من العضوية وتفويض WebSocket.

## التطبيق على Windows (CMD)
- انسخ `scripts/apply-focus-stability-fixes.cjs` إلى مجلد scripts في المشروع (أبقِ باقي مجلداتك كما هي).
- خذ Backup خارجي لمشروعك ويفضل Git commit قبل أي تغيير.
- من جذر المشروع شغّل:

```bat
node scripts\apply-focus-stability-fixes.cjs
```

هذا **CHECK_ONLY** ويُظهر الملفات المتوافقة من دون تعديل. إذا ظهر `ANCHOR_MISMATCH`، **لا تستبدل ملفاتك القديمة**؛ الحزمة تحتاج تكييفاً مع آخر ملفاتك.

إن نجح الفحص، شغّل:

```bat
node scripts\apply-focus-stability-fixes.cjs --apply
npm run typecheck
npm run build
```

إذا فشل typecheck/build، لا تنشر إلى الإنتاج. استعد الملفات الأصلية بواسطة:

```bat
node scripts\apply-focus-stability-fixes.cjs --rollback
```

النسخ الأصلية محفوظة أيضاً في `.focus-stability-backup/`.

## نشر واختبار مرحلي
- إذا نجح build: انشر Frontend على Cloudflare وBackend على Render، وتأكد من نسخة JavaScript الجديدة والمتصفح بدون Service Worker cache قديم.
- راقب Network → طلب ملف الصوت. إذا ظهر 403/404/CORS/CSP ما زالت هناك مشكلة في R2/أمان الاستضافة؛ تعديل CSP في `server.ts` لا يغيّر CSP الذي قد تضيفه Cloudflare Pages من إعدادات الموقع المستقلّة.
- اختبر أصوات Shared وLocal في Solo وGroup. الصوت المشترك يحتاج ملفاً موجوداً ومفعّلاً في R2؛ لا يُعالج هذا التصحيح ملفاً مفقوداً أو مكسوراً.
- Solo: إنشاء Focus / Pause / Resume / Break / End Break / PDF / Video / العودة من material / الخروج والدخول / فتح تبويبين / انتهاء المؤقت / Offline→Online. راقب أنه لا يتم منح نقاط مكررة ولا تعارض حالة الخادم.
- Group: إنشاء غرفة / الدخول كـHost وMember / الوقت من ضغط Create حتى HTTP response ثم من الانتقال إلى Room حتى أول ROOM_STATE / Reconnect / Audio / انتهاء الجلسة. إن كان HTTP create نفسه يستهلك 20–30 ثانية فافحص Render cold start وزمن Prisma؛ لا يمكن لإصلاح الواجهة اختزال انتظار السيرفر فعلياً. إذا فشلت مصافحة WebSocket بعد 12 ثانية فراجع Worker/شبكة المتصفح، بدلاً من انتظار مؤشر Connecting بلا نهاية.
- لا تُعلن نجاح Cutover قبل PASS عملي في المتصفح + سجل Render وWorker + مراقبة دقيقة للنقاط والحالات.

## ما لم يُحل بشكل مثبت بعد
- لا يوجد وصول من هذه البيئة إلى مفاتيح R2 أو حالة Supabase/Render/Worker الحية، لذا لا يمكن التحقق من 403/CORS أو قياس زمن إنشاء غرفة الإنتاج.
- نقل Focus الحي إلى D1 ليس هدف هذه الحزمة، ولا تغيّر أي feature flag خاص بـ Cutover.
- لا يغيّر هذا التعديل دلالة `RESOURCE_HANDOFF` أو سياسة احتساب وقت الدراسة؛ ذلك يحتاج اختبار سلوك المنتج قبل تغييره.

## ملاحظات أمان
- السكربت محمي بالتحقق من مطابقة نصوص محددة (anchors)؛ كل التعديلات تُراجع قبل أول كتابة. إذا كان عندك تغييرات أحدث في تلك المواضع سيتوقف دون تغيير أي ملف.
- الملفات التي لم تتغير لا تُمس.
- لا تستخدم --apply على بيانات Supabase هنا: الخيار المحلي خاص بتعديل ملفات كود المشروع، وليس مزامنة بيانات الطلاب.
