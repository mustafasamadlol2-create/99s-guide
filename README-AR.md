# تشخيص اتصال GitHub Actions مع Supabase — Phase 6

## لماذا فشل التشغيل رقم 2؟
سجل GitHub يؤكد نجاح تثبيت الحزم و`prisma generate`، لكنه فشل عند أول استعلام `load_active_accounts` مع `PrismaClientInitializationError reason=unknown`؛ لا يكفي لتحديد خطأ كلمة المرور مقابل رفض الشبكة.

## ما تضيفه الحزمة
- `scripts/phase6-github-supabase-preflight.cjs`: فحص **قراءة فقط**، يتحقق من بنية `SUPABASE_DATABASE_URL` ثم DNS ثم اتصال TCP ثم اتصال Prisma وقراءة حساب واحد. لا يطبع عنوان الاتصال الكامل أو اسم المستخدم أو كلمة المرور أو عنوان الشبكة أو SQL أو رسالة قاعدة البيانات الخام.
- `.github/workflows/phase6-weekly-challenges.yml`: إضافة خطوة فحص قبل Run bounded weekly reconciliation، مع الحفاظ على الجدولة والأسرار و`apply=false` الافتراضي و`CUTOVER=false`.

## التطبيق
1. انسخ الملفين إلى نفس المسارات داخل جذر مشروع `99s-guide-1`، مع Git checkpoint. لا ترفع `.env` إلى GitHub.
2. من CMD:
```
git add .github/workflows/phase6-weekly-challenges.yml scripts/phase6-github-supabase-preflight.cjs
git commit -m "Diagnose Phase6 GitHub Supabase connectivity safely"
git push origin main
```
3. GitHub → Actions → Phase 6 Weekly Challenges → Run workflow → `apply=false`.
4. افتح Step `Diagnose Supabase access safely (READ_ONLY)`، وأرسل **الكود فقط** من أحد النتائج:
   - `DB_URL_MALFORMED` / `DB_URL_MISSING_COMPONENT` → أصلح القيمة المخزنة في GitHub Secret (لا ترسلها هنا).
   - `DB_DNS_FAILED` / `DB_TCP_UNREACHABLE` → استخدم Session Pooler IPv4-compatible من Supabase (غالباً 5432)، أو تحقق من Network Restrictions. لا تغيّر المنفذ عشوائياً.
   - `DB_AUTH_FAILED` → تحقق من مستخدم الـPooler وكلمة مرور قاعدة البيانات وقيمة الـSecret، مع مراعاة ترميز الرموز الخاصة في كلمة المرور داخل URL.
   - `DB_ACCESS_DENIED` → الحساب لا يمتلك صلاحية قراءة الجداول.
   - `PRISMA_CONNECT_AND_USER_READ PASS` → الاتصال صحيح؛ راجع عندها اختلاف ما يراه سكربت Phase 6 في بيئة GitHub.

## أمان التشغيل
- لا تفعّل `PHASE6_AUTO_APPLY`، ولا تختَر `apply=true` قبل نجاح القراءة والتحقق من تجديد الأسبوع في بيئة آمنة.
- اترك `PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED=false`.
- هذا اختبار GitHub للاتصال وليس إصلاحاً مؤكداً لقيمة Secret؛ يستحيل معرفة صحتها من الصورة لأن GitHub يخفيها.
- تشغيل أول فحص حي بعد `prisma generate` يحتاج أن تكون متغيرات الاتصال وسلسلة PostgreSQL مستخدمة فعلاً وصحيحة.
