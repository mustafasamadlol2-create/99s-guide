# إصلاح Focus Runtime Race V3 — تعطّل الاختبار 24

## لماذا يتوقف `focus-runtime.test.ts` بعد 23 اختباراً؟

بعد إصلاح V2، إذا كان هناك طلب قديم قيد التنفيذ لقراءة D1، ثم بدأت جلسة جديدة، فالرد القديم قد يكون `session=null`. الكود السابق كان يبدأ قراءة Supabase احتياطية لهذا الرد **قبل** التأكد أن الطلب القديم لم يعد ذا صلاحية (`requestGeneration`). هذا يسبب طلب شبكة غير ضروري وقد ينتظر الاختبار طويلاً لأن المحاكاة لا تعيد رداً على الطلب الإضافي.

## ما الذي غيّرته الحزمة؟

- ملف `src/features/focus/runtime/controller.ts`: ألغِ نتيجة قراءة D1 القديمة بمجرد عودتها إذا تم تجاوز رقم طلبها، قبل أي قراءة Supabase إضافية.
- ملف `tests/focus-runtime.test.ts`: تأكد أن رد D1 القديم لا يسبب جلباً إضافياً؛ يحمي من رجوع المشكلة في التعديلات القادمة.

لا تغير الحزمة العداد نفسه، ولا حالة Focus الحالية على السيرفر، ولا قواعد البيانات أو نقاط الطلاب، ولا إعدادات Phase 6. **التحقق من الاختفاء الفعلي للرسالة وتأخير العداد يحتاج اختبار التطبيق بعد النشر.**

## خطوات Windows CMD — داخل جذر مشروع 99s-guide-1

فك ZIP بأكمله في الجذر، ثم احفظ التغييرات الحالية بوسيلة Git checkpoint قبل التعديل.

```bat
node scripts\apply-focus-runtime-race-v3.cjs
```

يجب أن ترى `CHECK_PASS files=2 ready=2 already=0`. إذا ظهر `BASELINE_CHANGED` أوقف العملية ولا تستبدل الملف يدوياً.

```bat
node scripts\apply-focus-runtime-race-v3.cjs --apply
npm run typecheck
npm run build
npx tsx --test tests/focus-runtime.test.ts
```

يجب أن يكتمل الاختبار بملخص `tests 34 / pass 34 / fail 0` ويعود CMD. ثم شغّل اختبارات Focus الثلاثة الأخرى منفردة (نجحت عندك سابقاً):

```bat
npx tsx --test tests/focus-foreground-continuity.test.ts
npx tsx --test tests/focus-solo-background-resume.test.ts
npx tsx --test tests/focus-solo-continuity.test.ts
```

بعد النجاح:

```bat
git add src/features/focus/runtime/controller.ts tests/focus-runtime.test.ts
git commit -m "Avoid stale Focus reads during resource return"
git push origin main
```

انشر Frontend على Cloudflare Pages، ثم أعد تحميل تحديث التطبيق (خصوصاً إذا ظهرت عبارة App update available). ابدأ Focus، افتح PDF/YouTube، اخرج إلى الخلفية نحو دقيقة، ثم ارجع وتحقق من استمرار حساب المدة ومن عدم ظهور رسالة الجلسة القديمة.

### التراجع

```bat
node scripts\apply-focus-runtime-race-v3.cjs --rollback
```

**مهم:** أداة التراجع لا تغيّر أي ملف إذا عدّلته بعد تطبيق V3؛ تطلب مراجعة يدوية لحماية التغييرات الجديدة. التراجع عن V3 لا يلغي V2.
