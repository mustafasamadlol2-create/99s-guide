# 99's Guide — Phase 7.1: Public Leaderboard Contract (Manual Patch)

**المصدر:** `99s-guide-main (50)(1).zip` المرفق بتاريخ 22 نوفمبر 2026.
**حجم التغيير:** 6 ملفات موجودة + 1 اختبار جديد. بدون قاعدة بيانات أو مفاتيح سرية.

## السبب
- الواجهة حالياً تعتمد Monthly / Semester / All Time.
- API `/api/leaderboards/availability` ما زال يعرض WEEKLY.
- يمكن للطالب أن يطلب `/api/leaderboards/WEEKLY` و`/api/me/leaderboard-rank?scope=WEEKLY` مباشرة.
- تم إبقاء دعم المواسم التاريخية WEEKLY داخل النظام: لا نعدّل جدول LeaderboardSeason ولا Weekly Challenges.

## التثبيت على Windows / CMD
1. خذ نقطة رجوع `git status -sb` و`git diff`، واحفظ عملك الحالي.
2. فك هذه الحزمة **في جذر المشروع** `C:\projects\CHECKPOINT\99s-guide-1` مع الاحتفاظ بالمسارات.
   فك الحزمة لا يستبدل ملفات التطبيق مباشرة؛ التعديلات داخل `phase7-step1-payload`.
3. نفّذ:

```bat
node scripts\apply-phase7-step1.cjs
```

إذا ظهرت `CHECK_PASS files=7 ready=7 already=0`:

```bat
node scripts\apply-phase7-step1.cjs --apply
npm run typecheck
npm run build
npx tsx --test tests/phase7-public-leaderboard-scopes.test.ts
npm run test:leaderboard
```

**مهم:** لا ترفع التعديل إلى الإنتاج إذا فشل أي اختبار. الملف `tests/leaderboard-d1-worker.test.ts` بحاجة إلى Worker محلي وقد يحتاج إلى إعدادات؛ لا تعتبر عدم تشغيله دليلاً على اجتياز D1.

## مراجعة قبل Git

```bat
git diff -- server/features/leaderboard/types.ts server/features/leaderboard/periods.ts server/routes/leaderboards.ts src/features/gamification/types.ts src/features/gamification/LeaderboardView.tsx tests/leaderboard.test.ts
git status -sb
```

إذا نجحت الفحوص، ارفع **فقط** الملفات المطلوبة:

```bat
git add server/features/leaderboard/types.ts server/features/leaderboard/periods.ts server/routes/leaderboards.ts src/features/gamification/types.ts src/features/gamification/LeaderboardView.tsx tests/leaderboard.test.ts tests/phase7-public-leaderboard-scopes.test.ts
git commit -m "Phase 7.1 retire public weekly leaderboard scope"
git push origin main
```

تأكد من نشر Backend على Render وFrontend على Cloudflare إذا كان النشر تلقائياً مرتبطاً بالفرع `main`.

## التراجع المحلّي

```bat
node scripts\apply-phase7-step1.cjs --rollback
```

**لا تفعل الآن**:
- `LEADERBOARD_D1_READ_ENABLED=true`
- `LEADERBOARD_D1_PROJECTION_ENABLED=true`
- أي Backfill أو قاعدة بيانات أو Migration.

## بعد نجاح المرحلة 7.1
المرحلة 7.2 هي فحص Outbox وD1 Snapshot parity لأوقات Monthly / Semester / All Time، ثم تمكين Projection بعد اختبار مراقب. مفتاح Gamification Cutover **مستقل تماماً** عن أعلام Leaderboard.
