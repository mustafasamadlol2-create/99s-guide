# Phase 6 — مصالحة آمنة لحساب واحد بعد إصلاح Outbox Sequence

## ما ثبت من السجلات
- Focus: `divergent accounts=0` و `PASS` بعد إصلاح Sequence. لا حاجة لإعادة تشغيل إصلاح Focus.
- Phase 6: جميع الحسابات الـ123 موجودة في PG وD1؛ الاختلاف الحالي ظاهر في `challenge.week rollover` و`challenge.period expired` لكل الحسابات.
- آخر Verify لا يعرض اختلاف Points، حتى للحساب رقم 23 الذي اختلف سابقاً.

## تنبيه مهم بشأن Weekly
- **Weekly Leaderboard** الذي أُزيل من الواجهة ليس هو **Weekly Challenges** الذي لا يزال موجوداً في كود Backend.
- إذا كان القرار هو إلغاء Weekly Challenges أيضاً وليس الترتيب الأسبوعي فقط، **لا تشغّل --apply**. عندها يجب تعديل تصميم Phase 6 وChallenge rules/Routes قبل أي ترحيل.
- السكربت لا يُنشئ ترتيباً أسبوعياً، لكنه عند `--apply` يمكن أن ينعش التحديات الحالية ويمنح مكافأة مستحقة، ثم يضيف Snapshot إلى Outbox.

## 1. استبدل السكربت فقط
ضع `scripts/phase6-gamification-weekly-reconcile.ts` في نفس مساره بالمشروع الحالي. لا تستبدل ملفات Backend/Frontend ولا تنفذ Migration أو D1 reset.

## 2. اقرأ حساباً واحداً أولاً (لا كتابة)

```bash
npx tsx scripts/phase6-gamification-weekly-reconcile.ts --start-at=1 --max-accounts=1
```

## 3. إذا كانت Weekly Challenges مقصودة وبقي Cutover=false
خذ نسخة احتياطية من Supabase، وتأكد من أن Outbox Sequence تم إصلاحها وأن Render Drainer يعمل. بعدها نفّذ **حساباً واحداً فقط**:

```bash
npx tsx scripts/phase6-gamification-weekly-reconcile.ts --start-at=1 --max-accounts=1 --apply --confirm-apply --max=1
```

الاختلاف عن السكربت السابق: `--max-accounts=1` يحدد **عدد الحسابات التي تُفحص**، بينما `--max=1` يحدد عدد المهام الناجحة فقط؛ فإذا فشل حساب، لن يواصل السكربت المحاولة على 122 حساباً.

- إذا ظهر `FAILED at canonical_challenge_refresh (P2010...)` أو `FAILED at enqueue_projection (...)` توقف؛ لا تنفذ دفعات أخرى.
- إذا ظهر `snapshot queued`، افحص Outbox/Render حتى يصل التحديث إلى D1، ثم أعد قراءة الحساب الأول **دون --apply**.
- لا تتوقع أن يصبح `123/123 OK` بعد إصلاح حساب واحد؛ باقي الحسابات ما زالت تحتاج معالجة.

## 4. بعد إصلاح السبب والتجربة الناجحة
لا تعلن Cutover ناجحاً بمجرد إصلاح أسبوع واحد. يلزم نظام تحديث دوري تلقائي أو تصميم يوقف الاعتماد على التحديات الأسبوعية، واختبار التزامن بعد منح نقاط حقيقية.

## إبقاء إعدادات Render الحالية

```env
PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED=false
```

تغيير `SYNC_ENABLED` ليس مطلوباً لهذه التجربة اليدوية، لأنها تكتب Outbox مباشرة عند تفعيل `--apply`.
