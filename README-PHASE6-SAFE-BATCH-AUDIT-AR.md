# 99's Guide — Phase 6 read-only, resumable batch audit

سبب هذه الأداة: فحص 123 حساباً دفعة واحدة علّق اتصالات Supabase وCloudflare، وانتهى بخطأ P1017 وD1_GET_NETWORK للحساب 27. هذا الملف لا يغيّر قاعدة البيانات ولا يحل انقطاع الشبكة؛ فقط يقلل مدة الاتصال ويمنع ضياع نتيجة الفحص عند التوقف.

ضع `scripts/phase6-safe-batch-audit.cjs` داخل مشروعك كما هو. لا تستبدل السكربت `phase6-gamification-weekly-reconcile.ts` الحالي.

من CMD داخل جذر المشروع:

```bat
node scripts/phase6-safe-batch-audit.cjs --from=26 --to=123 --batch-size=5 --dry-run
node scripts/phase6-safe-batch-audit.cjs --from=26 --to=123 --batch-size=5 --timeout-seconds=180
```

يجب البدء من الحساب 26، لا 27: في السجل الأخير انقطع Supabase أثناء الحصول على تفاصيل Achievements للحساب 26، وقد تكون القراءة ناقصة. نجاح الحسابات 1–25 لا يعني أنها متطابقة؛ معظمها لديها اختلاف Week rollover، والحساب 23 لديه اختلاف نقاط إضافي.

إذا توقف الفحص بسبب الشبكة، أصلح الاتصال/وضع نوم الكمبيوتر، ثم شغّل:

```bat
node scripts/phase6-safe-batch-audit.cjs --resume --to=123
```

لإعادة تدقيق **كل 123 حساباً من البداية** (وهو الأصح قبل إعلان الاستعداد للـCutover):

```bat
node scripts/phase6-safe-batch-audit.cjs --from=1 --to=123 --batch-size=5 --timeout-seconds=180
```

الأداة تشغّل عملية Prisma جديدة لكل دفعة 5 حسابات، وتغلقها بعد الدفعة. لها مهلة 180 ثانية لكل دفعة؛ عند تجاوزها توقف عملية التشغيل الحالية بدلاً من الانتظار ساعات. توقف فوراً عند فشل فحص الحساب، أو ظهور سجلات تفيد أن قراءات Achievements سقطت إلى بيانات ناقصة. تحفظ checkpoint محلياً فقط باسم `.phase6-readonly-audit-checkpoint.json`، دون معلومات الطلاب أو أسرار قاعدة البيانات.

تتحقق الأداة من ثبات أسبوع Challenges وعدد الحسابات بين الدفعات، لتجنب جمع نتائج من فترتين مختلفتين. إذا تغيّر الأسبوع أو عدد الحسابات، أعد الفحص من البداية.

**لا تشغّل** `--apply` أو `gamification:d1:backfill` أثناء هذا الفحص. ولا تحوّل `PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED` إلى `true` بعد اكتمال الفحص وحده. إصلاح تجدد Weekly Challenges بصورة آلية واختبار مزامنة البيانات المتغيرة ما زالا مطلوبين. ولا علاقة لهذا بالـWeekly Leaderboard الذي سبق إلغاؤه.

للتأكد من أساس الشبكة على Windows PowerShell:

```powershell
Test-NetConnection aws-0-eu-central-1.pooler.supabase.com -Port 5432
```

هذا الاختبار يؤكد إمكانية الاتصال بالمنفذ وقت تنفيذه فقط؛ لا يثبت توفر Supabase أو ثبات الشبكة بشكل دائم.
