# Phase 6 — D1 Delivery Audit + Better Failure Reporting

**الحالة:** تشخيص آمن للقراءة فقط. لا يعالج تلقائياً انتهاء معاملات Prisma؛ ولا يمنح مكافآت أو يغير قواعد البيانات.

## الملفات

- `scripts/phase6-outbox-revision-d1-audit.ts` (جديد)
- `scripts/phase6-gamification-weekly-reconcile.ts` (نسخة v4؛ استبدله فقط إذا كانت لديك نسخة v3 السابقة دون تغييرات محلية إضافية)

## بعد النسخ

تأكد أن `PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED=false`، وأن `.env` المحلي يوجّه إلى Worker وSupabase الصحيحين.

### افحص Revision 36 مباشرةً دون Refresh أو Canonical Summary

```bat
npx tsx scripts/phase6-outbox-revision-d1-audit.ts --outbox-id=36
```

- `DELIVERY_OK`: وصول revision 36 على الأقل إلى D1 وصلاحية أسبوع الـChallenges الحالي. **ليس** اختبار تطابق النقاط والإنجازات.
- `DELIVERY_MISMATCH`: ناقش نتيجته قبل أي `--apply` جديد.
- `FAILED`: يظهر نوع الخطأ؛ لا تطبع المفاتيح السرية.

### إذا أردت إعادة اختبار الحساب الثاني كاملاً

```bat
npx tsx scripts/phase6-gamification-weekly-reconcile.ts --start-at=2 --max-accounts=1
```

v4 يحاول إعادة استعلام قائمة الحسابات عند الانقطاع المؤقت، ويطبع مرحلة فشل الإعداد المبكر (`load_active_accounts` أو `d1_preflight`) بدل `aborted (FAILED)` المجرد. لم يعدّل سير عمل كتابة التحديات.

**لا تنفّذ `--apply` أو Backfill بمجرد ظهور أخطاء `P2028`**. هذا الرمز مرتبط بمعاملات Prisma ويحتاج فحص مهلة الـtransaction وحالة Supabase/Pooler إن استمر.

## شروط الانتقال إلى Cutover

- إتمام `gamification:d1:verify` والتأكد من تطابق كامل الحسابات والنقاط والإنجازات.
- التأكد من آلية آمنة تلقائية لتجديد Weekly Challenges إذا كانت مستخدمة.
- اختبار MCQ وFocus وEngagement من الواجهة.

لم تُجرَ اتصالات ببيئة المستخدم أو اختبارات تكامل فعلية في الإنتاج؛ السكربتات فُحصت صياغياً فقط.
