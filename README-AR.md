# 99's Guide — Focus TS typecheck repair (guarded, non-destructive)

## مصدر هذه الحزمة
سجل المستخدم 17 Nov 2026: تطبيق حزمة Focus نجح على 5 ملفات، و`npm run build` نجح، بينما `npm run typecheck` أبلغ عن 56 TypeScript errors موزعة على 12 ملفاً. النسخة البرمجية المتاحة هنا هي baseline أقدم؛ لا تتوفر نسخة source الحالية كاملة.

**هذه الحزمة لا تدّعي إصلاح جميع أخطاء TypeScript.** إنما تصلح النقطتين اللتين أمكن تحديدهما بثقة من الملفات المتوفرة:

1. خطأ `TS2367` في `src/features/group-focus/runtime/groupFocusRealtime.ts` داخل catch الخاص بإعادة الاتصال: يستخدم `isRuntimeTerminal()` لقراءة الحالة الحالية بعد await، مما يحافظ على منع reconnect عند TERMINAL دون فحص TypeScript خاطئ للتضييق القديم.
2. فصل فحص Cloudflare Workers عن فحص Frontend/Backend TypeScript العام: استبعاد `cloudflare-main-worker.ts` من **فحص التطبيق العام فقط**، وإنشاء `tsconfig.cloudflare-main.json` لعمل **فحص مستقل** باستخدام `cloudflare-group-focus-worker/worker-configuration.d.ts` و`strict`.

لا تغيّر هذه الحزمة أي API أو Feature Flag أو DB أو Points أو Rewards أو Outbox أو Deploy أو Runtime worker configuration.

## خطوات التطبيق (Windows CMD)
1. خذ Git commit / نسخة احتياطية. وضع السكربت المرفق في `scripts/apply-focus-tscheck-hotfix.cjs` من جذر مشروعك.
2. تأكد أنك طبقت مسبقاً حزمة Focus Hub Stability؛ لأن Anchor التعديل يعتمد على نسخة runtime تلك.
3. افحص دون كتابة:
   ```bat
   node scripts\apply-focus-tscheck-hotfix.cjs
   ```
   إذا ظهر `ANCHOR_MISMATCH` أو `EXISTS`، لا تشغل `--apply`؛ لا تستبدل ملفاتك الحالية بملفات قديمة.
4. نفّذ التعديل المحلي:
   ```bat
   node scripts\apply-focus-tscheck-hotfix.cjs --apply
   ```
5. نفّذ **الاختبارين**؛ لا تعتبر النجاح إن فشل أي منهما:
   ```bat
   npm run typecheck
   npx tsc --noEmit -p tsconfig.cloudflare-main.json
   npm run build
   ```
6. إذا فشل أي اختبار فلا تنشر للبيئة الحية. إذا أردت الرجوع عن هذا التعديل **فقط**:
   ```bat
   node scripts\apply-focus-tscheck-hotfix.cjs --rollback
   ```
   النسخ الأصلية محفوظة في `.focus-tscheck-backup/` ولا تمس `.focus-stability-backup/` السابقة.

## ما الذي سيبقى؟
أخطاء أخرى سجلت في `scripts/focus-d1-current-reconcile.ts`, `scripts/gamification-d1-phase6.ts`, `scripts/phase6-gamification-weekly-reconcile.ts`, `server.ts`, `server/features/gamification/achievementRead.ts`, `server/features/study-points/*`, `tests/gamification-challenges-route.test.ts`. لا يمكن تعديلها بأمان من أرقام الأسطر دون نسخة source الحالية.

غالباً سيتبقى نحو 46 خطأ في الفحص العام إذا كان Worker منفصلاً بالكامل والفحص المستقل للـWorker ناجحاً؛ العدد ليس مضموناً. `npm run build` ينجح دون تنفيذ typecheck، فلا يعوّض فشل `npm run typecheck`.

**مطلوب لإغلاق هذه الأخطاء نهائياً:** إرسال ZIP من نسخة المشروع المحلية الحالية مع استبعاد `node_modules`, `dist`, `.env`, `.dev.vars`, أسرار وملفات backup، حتى يمكن اختبار التصحيحات على الشيفرة الفعلية وليس baseline أقدم.

## الاختبارات التي أُجريت
- `node --check` للـpatcher: PASS
- CHECK_ONLY على نسخة المرجع: PASS
- APPLY وIdempotent Recheck: PASS
- ROLLBACK ومطابقة ملفات المرجع الأصلية: PASS
- JSON parse لملفي tsconfig: PASS
- فحص TypeScript الكامل: NOT RUN (الاعتمادات الحالية للمشروع غير متوفرة هنا)
- فحص Render, Cloudflare, Supabase, R2: NOT RUN

`PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED=false` يبقى كما هو.
