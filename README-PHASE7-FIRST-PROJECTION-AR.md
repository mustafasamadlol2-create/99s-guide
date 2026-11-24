# 99's Guide — Phase 7.4: أول مزامنة Leaderboard إلى D1

## الحالة قبل التنفيذ

- Supabase canonical Leaderboard Snapshots موجودة (MONTHLY / SEMESTER / ALL_TIME؛ 123 لكل فترة بحسب نتائج فحصك السابقة).
- Remote D1 `leaderboard_cache_snapshots` و`entries` و`current` كلها = 0.
- خمس جداول D1 موجودة ولا توجد migrations معلقة.
- Worker GET authenticated يعمل، لكن لا يثبت وحده نشر ranking-v2.
- `LEADERBOARD_D1_READ_ENABLED=false` يجب أن يبقى كذلك.

## ما الذي في الحزمة؟

`/scripts/phase7-first-projection.ts`: CLI آمن من مرحلتين. `--check` أو بدون خيارات = فحص قراءة فقط للبيانات؛ قد يكتب Worker Nonce أمنياً قصير العمر عند GET. `--apply --confirm-initial-projection` = **كتابة مقصودة**: يبني 3 Snapshots جديدة في PostgreSQL (لا يلمس StudyPointsLedgerEntry أو أرصدة الطلاب)، ثم ينشئ LeaderboardD1SyncOutbox BEGIN/CHUNK/COMMIT وينفذ إرسالها إلى D1. لا يشغّل migrations أو deletes في D1، ولا يغير `.env` أو Render flags. يقوم rebuild العادي بتنظيف Snapshots LIVE التاريخية المنتهية حسب منطق التطبيق القائم.

## 1. النشر أولاً — قبل أي كتابة

- لا تنشر `.env` أو Backup أو Payload JSON.
- تأكد أن تغييرات Phase 7.1 و7.2 و7.3 في GitHub (استخدم `git status -sb`، ثم `git add` للملفات المقصودة فقط). تأكد نجاح بناء ونشر Backend إلى Render، مع بقاء `LEADERBOARD_D1_PROJECTION_ENABLED=false` و`LEADERBOARD_D1_READ_ENABLED=false` في Render.
- اختبر `npx tsx --test tests/phase7-leaderboard-d1-contract.test.ts` و`npm run test:leaderboard`.
- انشر **Private Worker** مستقلاً من جذر المشروع باستخدام حساب Cloudflare الصحيح:

  `npm run deploy:private-worker`

- تأكد من نجاح deploy وظهور Worker الصحيح `99s-private-data-api`، وأن السر `LEADERBOARD_D1_SYNC_SECRET` ما زال مضبوطاً في Cloudflare. واجهة Pages لا تنشر Private Worker تلقائياً.
- إن لم تقدر على تحديد Worker الصحيح أو كان النشر غير مؤكد، **لا تشغّل --apply**.
- ينصح بأخذ Backup حديث من Supabase قبل توليد Snapshots الإنتاجية، وإجراء التجربة في Staging إن كانت متاحة.

## 2. نسخ السكربت واختباره

فك الملف ZIP إلى جذر المشروع مع مسار `scripts/`. لا تستبدل أي ملف موجود بالاسم نفسه دون مقارنة.

```bat
npx tsx scripts/phase7-first-projection.ts
```

النتيجة المطلوبة: `PREFLIGHT_PASS scopes=3/3`. يشترط وجود 3 Canonical LIVE Snapshots، وعدم وجود Leaderboard outbox rows، وعدم وجود Current pointers في D1، ودعم نسخة Local V2 للصفر، والاتصال بالـWorker. إذا فشل، توقف ولا تستخدم --apply.

## 3. تشغيل الكتابة المقصودة مرة واحدة

**فقط بعد نشر Worker V2 ونجاح preflight والنسخ الاحتياطي:**

```bat
npx tsx scripts/phase7-first-projection.ts --apply --confirm-initial-projection
```

يكتب Snapshots وOutbox وD1 بالفعل. لا يغير أرصدة النقاط أو المكافآت. راقب `FIRST_PROJECTION_PASS scopes=3/3`.

إذا ظهر `STOP` أو `RETRY` أو `POISON`، **لا تعاود --apply**؛ أرسل سطور الخطأ الآمنة وحالة الـOutbox فقط، واحتفظ بالبيانات.

## 4. التحقق فوراً بعد الإرسال

```bat
npx tsx scripts/phase7-leaderboard-d1-audit.ts
npx tsx scripts/phase7-leaderboard-row-parity.ts
```

نتيجة الهدف `MONTHLY / SEMESTER / ALL_TIME PASS` و`matchedScopes=3/3`. الفحص يشترط حداثة LIVE Snapshot (تقريباً 15 دقيقة)، لذا شغله فور الانتهاء. إذا تغيرت بيانات الطلاب بين الإنشاء والفحص، سنراجع الانحراف بشكل منفصل.

## 5. بعد النجاح

أبقِ مؤقتاً `LEADERBOARD_D1_READ_ENABLED=false`. لنعتمد Phase 7.5 لا بد من فحص استمرارية Projection عند تحديث النقاط واختبار Cursor/Fallback قبل تحويل Read. **لا تفعّل flags على Render إلا بالخطوة المنفصلة المعتمدة بعد نجاح هذه الجولة.**

لا ترسل أي Secret أو `.env` أو DATABASE_URL في المحادثة. يمكن مشاركة ملخص السكربت وحالة الاختبارات وOutbox فقط.
