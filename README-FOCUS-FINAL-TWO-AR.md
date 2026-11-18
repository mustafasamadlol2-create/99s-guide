# 99’s Guide — Solo Focus: Last Two Issues (18 Nov 2026)

هذا التحديث يعالج مشكلتين فقط: استمرار المؤقت وعرض Resume بعد End. لا يتضمن تغييرات لـAudio أوGroup Focus أوPrisma أوGamification.

## التثبيت على Windows CMD

1. فك ZIP **في جذر المشروع** `C:\projects\CHECKPOINT\99s-guide-1`. يجب أن يصبح لديك `scripts\apply-focus-final-two.cjs` و`focus-final-two.payload.json`، وليس مجلدًا متداخلًا.
2. أنشئ Git Commit أو Backup.
3. تحقق: `node scripts\apply-focus-final-two.cjs` — يجب أن يظهر CHECK_PASS. عند BASELINE_CHANGED لا تطبّق التحديث بالقوة.
4. طبّق: `node scripts\apply-focus-final-two.cjs --apply`. يحفظ الأصل **خارج المشروع** في مجلد شقيق حتى لا يسبب 92 خطأ TypeScript كما في السابق.
5. فحوص: `npm run typecheck` ثم `npm run build` ثم `npx tsx --test tests/focus-solo-continuity.test.ts tests/focus-solo-background-resume.test.ts tests/focus-timer.test.ts tests/focus-handoff-unit.test.ts tests/focus-active-model.test.ts`.
6. هذه الحزمة تعدّل Frontend/Runtime فقط؛ بعد نجاح الفحوص انشر Frontend على Cloudflare Pages في **Staging أولاً**. **لا يلزم تحديث Render بسبب هذه الحزمة وحدها** إذا كان Backend السابق قد نُشر بالفعل. لا توجد Database Migration.
7. في Staging: ابدأ 25 دقيقة؛ افتح PDF أوYouTube واتركه 40–60 ثانية؛ ارجع مباشرة من دون الضغط على Return؛ تأكد أن الوقت نقص بمقدار الغياب، ثم استخدم End، وارجع للصفحة الرئيسية وأعد فتح Focus Hub عدة مرات: يجب ألا يعرض Resume لنفس الجلسة المنتهية.

### تفاصيل التنفيذ

- `RESOURCE_HANDOFF` يظل حالة سيرفر حقيقية تحسب وقت الدراسة؛ تعمل ticks للواجهة كل ثانية أثناء فتح المصدر. `PAUSED` فقط يوقف العد.
- إزالة `Resource opened / Return to Focus` كشرط يدوي. عند العودة للواجهة يُعاد `ACTIVE` تلقائيا بالـAPI، دون افتعال نجاح إن فشل الاتصال. عند إغلاق التطبيق بالكامل لا تعمل JavaScript في الخلفية، لكن توقيت السيرفر يحفظ الاستمرارية ويصحح الواجهة عند إعادة الفتح.
- إلغاء النسخة المحلية المكررة من Current Session: زر Resume يستند إلى حالة Runtime الموثّقة من السيرفر فقط، لا إلى استجابة قديمة من تحميل الخطة.
- Test-only: `tests/focus-solo-background-resume.test.ts`.

### الاسترجاع

`node scripts\apply-focus-final-two.cjs --rollback`

لن يكتب سكربت الاسترجاع فوق ملف عدلته بعد تطبيق الحزمة دون تدخلك. أبقِ `PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED=false`.

### نتائج التحقق هنا

- TypeScript كامل (على الكود السابق مع تصحيحات الـ46): **0 Errors**.
- الاختبارات المستهدفة: **31/31 PASS** (عبر محوّل TypeScript محلي على Linux).
- توجد اختباران قديمان في prompt11 عن interruption لا ينجحان في هذه البيئة حتى على نسخة controller قبل التعديل، ولم يُعتمد نجاحهما.
- لا يوجد اتصال هنا بسيرفر Render/Supabase/Cloudflare الإنتاجي؛ لا يمكن ضمان الأداء الفعلي بدون الاختبارات أعلاه.
