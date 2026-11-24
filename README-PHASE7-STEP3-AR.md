# 99s Guide — Phase 7.3: Leaderboard PostgreSQL ↔ D1 Row Parity

هذه حزمة فحص **قراءة بيانات الأعمال فقط**. أُنشئت اعتماداً على ZIP المشروع الأخير `99s-guide-main (50)(1).zip` مع واجهات Phase 7.2 التي ثُبّتت على جهازك. **لا تُجري أي Backfill أو Queue أو Snapshot Build أو Migration أو تعديل للنقاط.** طلبات GET إلى Cloudflare Worker قد تُسجّل Nonce قصيرة العمر للحماية من إعادة الإرسال، ولا تمس ترتيب أو رصيد الطلاب.

الملفات داخل الحزمة:

- `scripts/phase7-leaderboard-row-parity.ts` — يتحقق من 3 نطاقات: MONTHLY, SEMESTER, ALL_TIME؛ يقارن كل حساب وسطر (rank, tieSize, score, levelSnapshot)، وبصمة Snapshot وChecksum والـChunks والـCurrent Pointer، ويتأكد من حداثة LIVE Snapshot قبل اعتماد D1 Read.
- `tests/phase7-leaderboard-row-parity.test.ts` — أربع اختبارات محلية للـrow parity، دون اتصال بالشبكة أو قاعدة البيانات.
- `README-PHASE7-STEP3-AR.md`.

## لماذا لا يعتبر Phase 7.2 مغلقاً بالكامل بعد؟

في آخر فحص أرسلته:

- `projection=false, reads=false, workerConfigured=false` **في البيئة المحلية التي شغلت الفحص**. لا يمكن استنتاج قيم Render الإنتاجية من هذه النتيجة.
- `Outbox counts {}`: لم تظهر أوامر Leaderboard D1 projection في قاعدة البيانات المفحوصة.
- Snapshots من PostgreSQL تضم 123 طالباً لكل فترة، لكنها LIVE قديمة أكثر من حد حداثة القراءة (15 دقيقة)، لذلك لا تكفي وحدها لإجازة Cutover.
- فحوص 7.2 البرمجية نجحت: 3/3 contract؛ 19 passed و4 skipped في Leaderboard. نحتاج أيضاً نتيجة `typecheck` و`build` منك إن لم تُشغَّلا في هذه الجولة.

## التثبيت (دون استبدال أي ملف إنتاجي)

افتح ZIP داخل جذر مشروعك مع المحافظة على مسارات `scripts/` و`tests/`؛ ليس هناك مثبّت لأن الحزمة لا تستبدل ملفات قديمة.

```bat
npx tsx --test tests/phase7-leaderboard-row-parity.test.ts
npm run typecheck
npm run build
```

النتيجة المتوقعة لاختبارات الوحدة `4 PASS, 0 FAIL`.

## قبل فحص D1 الحقيقي — تجهيز الخدمة خطوة بخطوة

1. أبقِ `LEADERBOARD_D1_READ_ENABLED=false`؛ ممنوع تغييرها إلى true بناء على الفحص وحده.
2. تحقّق أن Worker المستقل `cloudflare-private-data-api` يحتوي كود Phase 7.2 (`leaderboard-ranking-v2`) ومخطط جداول D1 الخاص بالـLeaderboard (`0002_leaderboard_cache.sql`) **في البيئة المستهدفة**. تغيير Cloudflare Pages وحده لا ينشر هذا Worker. إذا كانت هناك Migration غير مطبّقة فافحصها وخذ نسخة احتياطية قبل تطبيقها. لا تُشغّل Migration غير مراجعة.
3. Cloudflare Worker Secret باسم `LEADERBOARD_D1_SYNC_SECRET`. ضعه Secret، واجعل **القيمة نفسها** في إعدادات Render Backend أو البيئة المحلية التي ستجري منها الفحص، ولا تنشرها في Git. هذا السر مستقل عن `PRIVATE_DATA_SYNC_SECRET`.
4. يجب أن يتوفر URL صحيحة في أحد `LEADERBOARD_D1_WORKER_URL` أو `PRIVATE_DATA_WORKER_BASE_URL`. لا تستخدم URL الخاصة بCloudflare Pages بدلاً من Worker.
5. أثناء تهيئة الربط اترك `LEADERBOARD_D1_PROJECTION_ENABLED=false` حتى التحقق من نسخة Worker وSecret وSchema على Staging. بمجرد أن تصبح البنية جاهزة وتجتاز الفحوص، يُختبر تفعيل Projection في Staging أولاً. هذا العلم يسبب عمليات Outbox كتابة عند إنشاء Snapshots جديدة، لذا لا تفعّله عشوائياً في الإنتاج.
6. بعد تفعيل Projection واكتمال Snapshot جديدة أو تنفيذ Canary معتمد، نفّذ أمر الفحص التالي من بيئة فيها كلا اتصال Supabase وWorker. إذا كانت الـSnapshot قديمة أو D1 فارغة، سيظهر NOT_APPROVED: هذا متوقع قبل الإسقاط.

```bat
npx tsx scripts/phase7-leaderboard-row-parity.ts
```

لا يطبع عناوين Worker أو أسراراً أو IDs للطلاب؛ يعرض عدد الاختلافات فقط. عند `CONFIG_BLOCKED` لا تُكرر الأمر؛ أصلح إعدادات الاتصال أولاً. عند `D1_UNAVAILABLE_OR_INVALID` افحص Deployment والـSecret والجداول، وليس قواعد النقاط.

توقع `matchedScopes=3/3`, `blockedOutbox=0`, `PARITY_PASS` قبل مناقشة D1 Reads. حتى مع نجاح هذا الفحص، يجب اختبار الصفحات والـCursor والـFallback وظروف تغير النقاط بعد إنشاء Snapshot؛ فالصفحة الأولى والـOwn Rank في نسخة الكود الحالية ما زالت تستعمل PostgreSQL. إنجاز 7.3 وحده لا يكفي لـ`LEADERBOARD_D1_READ_ENABLED=true`.

## Git (بعد نجاح الفحوص المحلية فقط)

```bat
git add scripts/phase7-leaderboard-row-parity.ts tests/phase7-leaderboard-row-parity.test.ts
git commit -m "Phase 7.3 add read-only leaderboard D1 row parity gate"
git push origin main
```

هذا لا يغيّر بيانات الإنتاج أو Feature Flags. لا تضف `.env` أو ملفات الـPayload/Backups إلى Git.

## معايير الإغلاق

- ✅ اختبارات 7.2 الجديدة 3/3، Leaderboard 19 PASS, 4 SKIP, 0 FAIL (طبقاً لسجل المستخدم).
- ⏳ Typecheck + Build لآخر تعديلات المشروع، إن لم يكن تم تشغيلهما في هذه الجولة.
- ⏳ Worker v2 + secret + schema والمزامنة مجرّبة في البيئة الصحيحة.
- ⏳ 7.3 parity لكل سطر في الفترات الثلاث مع Snapshot حية.
- ⛔ D1 read Cutover يظل OFF حتى المراحل التالية.
