# 99’s Guide — Solo Focus: definitive state-race patch (18 Nov 2026)

هذا **إصلاح موجه لمشكلتين** بعد التحديث السابق، وليس تغييراً للصوت أو Group Focus أو النقاط.

## التعديلات

1. **خطأ `This Focus Session is not in resource handoff`:** تم توحيد محاولة العودة من Handoff بين فتح المصادر، وعودة المتصفح من الخلفية، ومراقبة الواجهة، باستخدام Single-Flight. الرد المكرر لا يظهر Toast أحمر، ولا يُعتبر نجاحاً إلا بعد فحص الحالة الأساسية في Supabase. تبقى `RESOURCE_HANDOFF` قابلة لاحتساب الوقت. 
2. **سلاسة العدّاد:** يستمر تحديث الساعة أثناء استعلامات `MUTATING` و`RECONCILING`، ولا تتوقف واجهة العدّاد ثم تقفز عند انتهاء الطلب. `PAUSED` وحدها توقف وقت الدراسة. يستخدم المؤقت Monotonic Clock ولا يمنح نقاطاً من الواجهة.
3. **Resume بعد End:** تم إضافة قراءة `GET /api/focus/sessions/current?canonical=1` ذات ملكية المستخدم لتأكيد الحالة من Supabase في Focus Hub عند تحميله أو ضغط Resume، بدلاً من الاعتماد على نسخة D1 التي قد تتأخر في الوصول. كما تمنع ذاكرة Runtime المؤقتة إعادة جلسة انتهت فعلياً من نفس الـID.
4. لا تغيير على Audio أو Group أو Weekly Challenges أو قواعد المكافآت أو أي Schema/Migration.

## التطبيق (Windows CMD)

هذه الحزمة تتكون من ملفات بيانات Base64 وInstaller. **لا تنسخ ملفات TypeScript بنسخ متداخلة**؛ حتى لا يتكرر خطأ TypeScript السابق.

1. خذ Git Commit أو نسخة احتياطية قبل التطبيق.
2. فك ZIP في جذر `C:\projects\CHECKPOINT\99s-guide-1` لكي يكون لديك:
   - `scripts\apply-solo-focus-race-guard.cjs`
   - `focus-solo-race-guard.payload.json`
   - `SOLO-FOCUS-RACE-GUARD.review.patch`
3. فحص بلا كتابة: `node scripts\apply-solo-focus-race-guard.cjs`
4. يجب `CHECK_PASS total=10 ready=10`. إذا ظهر `BASELINE_CHANGED` **لا تُجبر التطبيق**؛ أرسل ZIP من الملفات المعدلة الحالية للمراجعة.
5. تثبيت: `node scripts\apply-solo-focus-race-guard.cjs --apply`. ينشئ نسخة أصلية خارج المشروع باسم `99s-guide-focus-race-backup-...`.
6. الاختبارات:
   ```bat
   npm run typecheck
   npx tsc --noEmit -p tsconfig.cloudflare-main.json
   npm run build
   npx tsx --test tests/focus-runtime.test.ts tests/focus-session-read-routing.test.ts tests/focus-api-client.test.ts tests/focus-solo-continuity.test.ts tests/focus-solo-background-resume.test.ts tests/focus-timer.test.ts tests/focus-handoff-unit.test.ts tests/focus-active-model.test.ts tests/focus-route-invalidation.test.ts
   ```
7. **انشر Backend على Render أولاً**، ثم Frontend على Cloudflare Pages في **Staging**. هذا الإصلاح يحتوي تعديل Endpoint في Backend، فلا يكفي نشر Frontend فقط.
8. التراجع إذا لزم، شريطة أنك لم تعدل الملفات بعد التطبيق: `node scripts\apply-solo-focus-race-guard.cjs --rollback`، ثم أعد نشر النسخ القديمة من Backend وFrontend. لا يلزم Migration.

## معايير قبول الاختبار في Staging

- ابدأ Solo Focus لمدة 25 دقيقة. افتح PDF ثم YouTube مرتين مع إغلاق وفتح تبويب التطبيق. لا ينبغي ظهور `not in resource handoff` أو شاشة رجوع يدوية. يجب أن ينقص العداد بما يعادل وقت الدراسة الفعلي، وليس القفز بسبب طلب شبكة.
- اضغط End Focus ثم ادخل Focus Hub، وحدث الصفحة، وكرر الدخول من تبويب آخر. يجب ألا يظهر Resume للجلسة المنتهية ولا `This session is no longer current` عند الضغط عليه.
- شغّل Pause وتأكد أن التوقيت يتوقف فعلاً. أعِد التشغيل بعد ذلك. وتأكد أن النقاط لا تتكرر.
- في حال حدوث خطأ جديد، سجّل Request path / HTTP status / response code بعد حذف الأسرار، وسجلات Render المقابلة.

## نتائج التحقق لدى المساعد

- فحص TypeScript للمشروع: **0 errors**؛ وفحص Cloudflare Main Worker: **0 errors**.
- اختبارات Focus/API/controller/read routing: **87/87 PASS** (بمحوّل TS محلي). تتضمن اختبارات جديدة لـD1 stale بعد End، single-flight handoff، تأكيد ACTIVE من Supabase، وسلاسة العدّاد أثناء MUTATING.
- لم يتسن اختبار اتصال Supabase أو Render أو R2 الحي، أو تنفيذ Build إنتاج فعلي على جهاز Windows من هنا. فحوصك الحية ضرورية قبل إعلان نجاح نهائي.
- `PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED` يجب أن يبقى `false`، كما اتفقنا.
