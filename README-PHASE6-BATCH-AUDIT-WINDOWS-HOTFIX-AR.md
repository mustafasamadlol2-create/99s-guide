# Phase 6 — Windows Batch Audit Hotfix

## ما الذي تغير؟

نسخة الـlauncher السابقة كانت تنفذ `cmd.exe /c npx tsx "C:\...\file.ts"`، فكان CMD يمرّر علامتي الاقتباس كجزء من اسم الملف ويظهر `ERR_MODULE_NOT_FOUND`.

الإصدار الجديد يُشغّل Node.js وواجهة tsx مباشرةً بدون CMD وبدون علامات اقتباس مصطنعة. لا يغيّر سكربت المصالحة ولا أي بيانات في Supabase أو D1.

## التركيب

استبدل فقط `scripts/phase6-safe-batch-audit.cjs`. لا تعدّل أي ملف آخر.

## الأوامر على Windows CMD من جذر المشروع

```bat
node scripts/phase6-safe-batch-audit.cjs --from=26 --to=123 --batch-size=5 --dry-run
node scripts/phase6-safe-batch-audit.cjs --from=26 --to=123 --batch-size=5 --timeout-seconds=180
```

بعد توقف لاحق فقط، إذا كانت الـcheckpoint قد أُنشئت بعد دفعة ناجحة، شغّل:

```bat
node scripts/phase6-safe-batch-audit.cjs --resume --to=123
```

يمكن إعادة فحص 1–123 بعد اكتمال فحص باقي الحسابات، لكن الفحص للقراءة فقط، وسيُظهر الاختلافات غير المعالجة.

- `PASS accounts 26–30` تعني أن الفحص نجح، **وليس** أن بيانات الحسابات متطابقة.
- `Mismatches=N` هو عدد الحسابات المختلفة ضمن تلك الدفعة.
- `STOP` يعني توقف الفحص؛ لا تعِد تشغيله بـ`--apply` تلقائياً.
- أبقِ `PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED=false`.
- إن عاد خطأ `P1017` أو `D1_GET_NETWORK` فهو انقطاع منفصل ولا يعالجه تغيير طريقة إطلاق السكربت.
