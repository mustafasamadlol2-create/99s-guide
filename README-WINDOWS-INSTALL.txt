99s Guide — Phase 6 Weekly Rollover Runner (Windows)

سبب الخطأ: ملف scripts/phase6-weekly-rollover-runner.cjs لم يكن موجودا داخل جذر مشروعك.

التثبيت:
1) افتح C:\projects\CHECKPOINT\99s-guide-1
2) فك هذا ZIP داخل نفس المجلد (Extract Here)، مع الحفاظ على بنية المجلد scripts/ .
3) يجب أن يصبح المسار:
   C:\projects\CHECKPOINT\99s-guide-1\scripts\phase6-weekly-rollover-runner.cjs
4) في CMD من جذر المشروع نفذ:
   dir scripts\phase6-weekly-rollover-runner.cjs
   node --check scripts\phase6-weekly-rollover-runner.cjs

فحص فقط، بلا كتابة:
node scripts/phase6-weekly-rollover-runner.cjs --from=11 --to=123 --batch-size=2 --timeout-seconds=180

هام: لا تنفذ --apply إلى أن تتأكد أن باقي تحديثات حزمة Auto Rollover تم دمجها، وعمل Backup، وأن SYNC=true وCUTOVER=false، وأن الفحص اكتمل. الأمر --apply يمكنه تحديث Canonical Challenges والمكافآت.

بديل دون الحاجة للـRunner (قراءة فقط، يعمل بملف Batch Audit المثبت سابقا):
node scripts/phase6-safe-batch-audit.cjs --from=11 --to=123 --batch-size=5 --timeout-seconds=180

ملاحظة: هذه الحزمة تتضمن Runner فقط؛ ولا تثبت بقية تغييرات Backend المطلوبة للجدولة الآمنة.
