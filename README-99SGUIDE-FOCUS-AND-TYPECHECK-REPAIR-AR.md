# 99's Guide — Focus Hub + TypeScript safe repair (2026-11-17)

**المصدر:** أحدث ZIP رفعه صاحب المشروع `99s-guide-1(1).zip`. هذه حزمة تغيير ملفات فقط؛ لا تحتوي مشروعاً جديداً ولا بيانات الطلاب.

## ماذا أصلحنا؟

- تصحيح جميع أخطاء TypeScript الـ46 المبلّغ عنها دون تعطيل TypeScript أو `skipLibCheck` إضافي، ودون تخفيض متطلبات الأنواع. معالجة معاني أنواع Prisma في سكربتات Focus D1 وGamification D1 وWeekly Reconciliation، وحقول التقدّم في `server.ts`، وحالات نجاح/فشل Lecture Completion.
- إزالة صادرات متروكة قديمة لحدود نقاط أُلغيت ضمن Points V2؛ تبقى نقاط V2 `LEDGER_ONLY` وبدون Daily Caps وفق الكود الأصلي. **لم تتغير مبالغ المكافآت أو حدّها أو بياناتها.**
- جعل بناء Gamification D1 Snapshot يتوقف عند تعذّر قراءة Achievements بدلاً من تخزين بيانات ناقصة. تبقى صفحات Overview قادرة على التعامل مع تعذر قراءة إنجازات اختيارية كما كانت.
- تقليل تأخير اتصال Group Focus: واجهة الإنتاج لم تعد ترسل سلسلة فحوص جاهزية HTTP قبل فتح WebSocket، لأن Backend أصدر Capability مرتبطة بالغرفة بالفعل. المصادقة والتحقق من WebSocket يبقيان كما هما. وظيفة فحص الجاهزية ما زالت متاحة لمن يستدعيها صراحةً أو للتشخيص.
- رفض Group Worker Origin يحتوي بيانات مستخدم/كلمة مرور أو Query String بدلاً من التخطي الصامت لعنوان غير آمن.
- تحديث اختبارات قديمة لعنوان Worker الحالي `/group-focus/...`، ولـPoints V2 (`LEDGER_ONLY` و`MASTERY`)، ولـGroup schema وJSON limit الحالي 2 MiB، دون تعديل قواعد النقاط أو توسيع صلاحيات السيرفر.

## نتائج الاختبارات في بيئة المراجعة

- TypeScript العام: **PASS / 0 errors** — فحص `tsc --noEmit` باستخدام TypeScript المرفق مع مشروعك.
- TypeScript الخاص بـCloudflare Main Worker: **PASS / 0 errors**.
- Focus + Group + Gamification + Study Points: **122/122 PASS** على Runner محلي يترجم TypeScript فقط.
- اختبارات Focus/Group الثابتة الإضافية: **20/20 PASS**.
- لم نشغّل `npm run build` كاملاً في بيئة Linux هنا: ملف `node_modules` الوارد في ZIP يحتوي binaries خاصة بـWindows (`@esbuild/win32-x64`)، ولا يوجد اتصال NPM لتحميل النسخة المناسبة. **يجب تشغيل Build على جهازك Windows** بعد الدمج.
- لم تُنفّذ اختبارات Live على Render أو Supabase أو Cloudflare D1/R2، ولا يمكن بهذه الاختبارات وحدها تأكيد أن الصوت يعمل لكل الملفات أو أن الاتصال الفعلي أصبح فورياً.

## طريقة التطبيق على Windows

1. خذ Git checkpoint أو نسخة احتياطية من الملفات المعدلة داخل مشروعك الحالي. **لا تضع ملفات `.env` داخل أي ZIP أو Git commit.**
2. فكّ ZIP **داخل جذر المشروع** `C:\projects\CHECKPOINT\99s-guide-1`، بحيث يصبح `server.ts` و`src\...` و`scripts\...` في مساراتها مباشرةً (لا تنشئ مجلداً متداخلاً).
3. افتح CMD من جذر المشروع ونفّذ:

```bat
npm run typecheck
npx tsc --noEmit -p tsconfig.cloudflare-main.json
npm run build
npx tsx --test tests/focus-audio-engine.test.ts tests/focus-audio-shared-sounds.test.ts tests/focus-handoff-unit.test.ts tests/group-focus-realtime-client.test.ts
npx tsx --test tests/gamification-challenges-route.test.ts tests/gamification-metrics.test.ts tests/study-points-balance.test.ts
```

4. إن فشل أي أمر: **لا تنشر**؛ احتفظ بالسجل الكامل، وراجع الـGit diff بدلاً من تشغيل Migration أو Backfill.
5. إن نجح: انشر Backend وFrontend على بيئة اختبار أولاً. لأن تغيير Group Focus من الواجهة، يجب نشر كود الواجهة؛ ولأن مسار Gamification تغير، يجب نشر Backend. اختبر عمداً:
   - Solo: إنشاء Session، فتح PDF وفيديو، الرجوع من Resource Handoff، Break، Pause/Resume، الانتقال بين محاضرتين.
   - صوت: ملف MP3 محلي سليم + Shared R2 Sound عبر Preview في Solo وGroup. إذا فشل، راقب طلب MP3 في Network؛ `403`/`404` أو CSP أو decode error يكشف السبب الواقعي.
   - Group: إنشاء الغرفة، أول WebSocket CONNECT، reconnect، الانقطاع والعودة، العدّ التنازلي، عضوية الغرفة. قِس وقت إنشاء الغرفة ووقت التأكيد منفصلين؛ بطء Render/Supabase قد يبقى خارج الواجهة.
   - تحقق أن نقاط الإنجاز Focus/Group تُمنح مرة واحدة وأن `Weekly Challenges` باقية وWeekly Leaderboard محذوفة.

## إعدادات السلامة

```env
PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED=false
```

**لا تغيّر هذه القيمة** قبل اختبارات Cutover الرسمية. لم تتضمن الحزمة أي SQL أو Migration أو إعادة backfill أو تحديث Outbox مباشر، ولم تُعالج بيانات حسابات الإنتاج.

## الاسترجاع

استخدم Git لإعادة الملفات العشرين إلى الـcheckpoint الذي أنشأته قبل الدمج. لا تستخدم `git reset --hard` إذا كانت لديك تغييرات أحدث تريد الاحتفاظ بها. يمكن أيضاً استرجاع هذه الملفات من ZIP الأصلي المرفوع (نفس المسارات).

## قيود مهمة

نجاح TypeScript والاختبارات المحلية لا يثبت اختفاء مشاكل Focus في البيئة الحقيقية. إصلاح صوت R2 يعتمد على صحة الملفات والروابط الموقعة وصلاحيات الوصول وإعدادات CSP الفعلية، وهي لا يمكن التحقق منها دون اتصال نشر حقيقي. إذا لم ينجح Audio/Materials/Group في اختبار الإنتاج، أبقِ الإصلاح في بيئة الاختبار وشارك Console + Network/Render logs بعد إزالة التوكنات والأسرار.
