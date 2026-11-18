# 99’s Guide — تشغيل Weekly Challenges مجاناً بواسطة GitHub Actions

هذا بديل عن Render Cron Job المدفوع. الحزمة تضيف **ملفاً واحداً فقط** إلى مسار `.github/workflows/phase6-weekly-challenges.yml`، ولا تغير ملفات التطبيق أو إعدادات D1. لا ترفع `.env` إلى GitHub.

## الإعداد

1. انسخ مجلد `.github` الموجود في هذه الحزمة إلى **جذر مشروع GitHub** (جذر `package.json`) ثم ادفع الملف إلى **الفرع الافتراضي** (عادةً `main`).
2. افتح GitHub: Repository → Settings → Secrets and variables → Actions → Repository secrets. أضف:
   - `SUPABASE_DATABASE_URL` — رابط الاتصال المعتمد في بيئة الإنتاج (احتفظ بصفته سراً).
   - `PRIVATE_DATA_WORKER_BASE_URL` — عنوان Cloudflare Private Worker.
   - `PRIVATE_DATA_SYNC_SECRET` — السر الموجود بالفعل لعمليات D1 الخاصة.
   - `DIRECT_URL` — اختياري إذا كان مختلفاً عن رابط Pooler؛ في المشروع الحالي يمكن لـ Prisma أن يرجع إلى `DATABASE_URL` إن لم يُحدد.
3. افتح Actions → `Phase 6 Weekly Challenges (Free Scheduler)` → Run workflow. اجعل `apply=false` للاختبار الأول. تحقق من السجل ومن نتيجة `123/123`.
4. بعد Backup حديث والتحقق أن التجديد الأسبوعي يعمل في بيئة آمنة، يمكن اختبار `Run workflow` مع `apply=true` في بيئة مضبوطة. لا تفعل ذلك إذا كان هناك تشغيل آخر، أو Outbox معلّق، أو اتصال غير مستقر.
5. **للتفعيل التلقائي بعد الموافقة فقط**: Settings → Secrets and variables → Actions → Variables → New repository variable: `PHASE6_AUTO_APPLY=true`. إذا لم تضفه، ستبقى جميع التشغيلات المجدولة READ_ONLY.

## الجدولة الدقيقة

`20 21 * * 0,1` بتوقيت UTC: الأحد والاثنين 21:20 UTC، أي الاثنين والثلاثاء الساعة 00:20 بتوقيت بغداد. تشغيل الاثنين هو الأساسي، والثلاثاء محاولة تعويض **غير كاتبة إن كان كل شيء متطابقاً**. GitHub قد يؤخر أو يفوّت تشغيلات Cron؛ لا تعتبر توقيت 00:20 ضماناً لحظياً.

## مهم جداً

- GitHub Actions ضمن الاستخدام المجاني المتاح لحسابك، وليس خدمة بلا حدود. راقب Usage/Billing، خصوصاً إذا كان المستودع خاصاً. ليس هناك ضمان أنك لن تدفع إذا تجاوزت الحصة مع تفعيل الفوترة.
- السكربت سيكتب بيانات canonical وقد ينتج Rewards عند `apply=true` وفق قواعد المشروع. لذلك نحتاج مراجعة idempotency وحالة Outbox مع اختبار أسبوع جديد قبل تشغيله تلقائياً.
- استخدم متغيرات Actions في GitHub (Repository Variables) لتفعيل `PHASE6_AUTO_APPLY`، لا تُضف أسراراً للنص أو المستودع.
- تركنا `PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED=false`. لا تفعله بعد تثبيت الحزمة؛ التفعيل يحتاج اعتماداً منفصلاً.
- السكربت يستخدم فهارس الحسابات النشطة؛ إذا تغيّر عدد الحسابات أثناء جولة طويلة يتوقف بدلاً من إكمال فهارس قديمة. يجب فحص سجل التشغيل ولا تعيد `--apply` بعد توقف غامض قبل مراجعة Outbox.
- تنبيه: **Cloudflare Workers Cron Trigger** خيار مجاني أيضاً، لكنه لا يشغّل سكربت Node الحالي مباشرةً. يتطلب بناء endpoint داخل Backend أو تشغيل دفعات صغيرة.
