import type { Language } from "../../../core/i18n/translations";

const copy = {
  en: {
    aiImport: "AI Import",
    manual: "Manual",
    previewOnly: "Preview only — nothing has been saved yet.",
    newPreview: "New AI Preview",
    startOver: "Start over",
    operation: "Operation",
    extractMcq: "Extract MCQs",
    generateMcq: "Generate MCQs",
    enhanceMcq: "Enhance MCQs",
    extractFlashcards: "Extract Flashcards",
    generateFlashcards: "Generate Flashcards",
    enhanceFlashcards: "Enhance Flashcards",
    extractDescription: "Convert existing questions/cards into editable app-ready items.",
    generateDescription: "Create new questions/cards from the supplied lecture material.",
    enhanceDescription: "Keep existing content and add missing approved fields.",
    source: "Source",
    pdf: "PDF",
    images: "Images",
    pasteText: "Paste text",
    chooseLecture: "Target lecture",
    chooseSubject: "Main subject",
    subSubject: "Sub-subject",
    track: "Academic track",
    department: "Clinical department",
    reload: "Reload",
    noLectures: "No lectures have been registered in this exact branch yet.",
    browse: "Click to browse or drag files here",
    remove: "Remove",
    clearAll: "Clear all",
    replace: "Replace",
    maxPdf: "PDF format only, up to 50 MiB",
    imageLimits: "JPEG, PNG, or WebP · 20 MiB each · 100 MiB total · 20 images",
    textPlaceholder: "Paste lecture content, existing questions, or flashcards here…",
    characters: "characters",
    count: "Number",
    difficulty: "Difficulty",
    category: "Category",
    style: "Question style",
    mixed: "Mixed",
    easy: "Easy",
    medium: "Medium",
    hard: "Hard",
    direct: "Direct",
    understanding: "Understanding",
    clinical: "Clinical",
    generateHints: "Generate hints",
    generateExplanations: "Generate explanations",
    addMissingHints: "Add missing hints",
    addMissingExplanations: "Add missing explanations",
    focus: "Optional focus",
    focusPlaceholder: "High-yield concepts",
    extractNote: "Existing wording will be preserved. Missing fields will not be invented.",
    enhanceMcqNote: "Existing questions, options, and answers are preserved. Existing hints/explanations are not overwritten.",
    enhanceFlashcardNote: "Existing fronts and explanations are preserved. Only missing backs are generated.",
    submitExtractMcq: "Extract MCQs",
    submitGenerateMcq: "Generate MCQs",
    submitEnhanceMcq: "Enhance MCQs",
    submitExtractFlashcards: "Extract Flashcards",
    submitGenerateFlashcards: "Generate Flashcards",
    submitEnhanceFlashcards: "Enhance Flashcards",
    cancel: "Cancel",
    preparing: "Preparing source…",
    analyzing: "Analyzing with AI…",
    structuring: "Structuring results…",
    tryAgain: "Try again",
    requestFailed: "AI preview could not be completed.",
    cancelled: "AI preview cancelled.",
    results: "Review Studio",
    generated: "Generated / extracted",
    ready: "Ready",
    needsReview: "Needs review",
    skipped: "Skipped",
    selected: "Selected",
    all: "All",
    selectAllReady: "Select all ready",
    clearSelection: "Clear selection",
    search: "Search candidates",
    noCandidates: "No candidates match this view.",
    filteredEmpty: "No candidates match the current search or filter.",
    trueEmpty: "No extractable candidates were found in the source.",
    incompleteEmpty: "Processing is incomplete. Review the warnings; an empty list does not prove the source was empty.",
    selectedForImport: "selected for future import",
    importedCount: "Imported",
    imported: "Imported",
    sourceOrdinal: "Source item",
    sourceEvidence: "Source evidence",
    confidence: "AI confidence",
    extracted: "Extracted",
    generatedLabel: "Generated",
    enhanced: "Enhanced",
    edited: "Edited",
    humanEdited: "Human edited — review changes before import",
    reset: "Reset",
    reject: "Remove from review",
    undo: "Undo",
    question: "Question",
    optionA: "Option A",
    optionB: "Option B",
    optionC: "Option C",
    optionD: "Option D",
    correctAnswer: "Correct answer",
    noAnswer: "No answer selected",
    hint: "Hint",
    explanation: "Explanation",
    clinicalConcept: "Clinical concept",
    page: "Page",
    image: "Image",
    skippedItems: "items could not be converted",
    truncated: "The source contained more items than this preview can process in one request. The first supported batch was returned.",
    warnings: "Warnings",
    aiWarning: "AI warning",
    currentState: "Current state",
    status: "Status",
    readyForReview: "Ready for review",
    invalid: "Incomplete",
    sourceText: "Source text",
    warningMissingAnswer: "The source did not provide a correct answer. Review this item before import.",
    warningAmbiguousAnswer: "The source contains more than one possible answer. Review this item before import.",
    warningMissingEnhancement: "A requested enhancement field is still missing.",
    warningLowConfidence: "AI confidence is below the review threshold.",
    warningSourceUnavailable: "Source evidence is unavailable for this item.",
    warningDuplicate: "This item may duplicate another item in the preview.",
    warningIncomplete: "Source processing was incomplete; some items may still be missing.",
    warningProviderRecovery: "A recovery pass was used. Review the recovered items.",
    warningSourceInsufficient: "The source supported fewer high-quality items than requested.",
    warningReviewRequired: "Review this item before import.",
    errorImportGeneric: "The selected content could not be imported. Please review it and try again.",
    errorImportInvalid: "Some selected content is incomplete or invalid. Correct it before importing.",
    errorImportConflict: "The lecture changed during import. Refresh the review and try again.",
    errorImportNotFound: "The selected lecture could not be found.",
    errorImportUnauthorized: "You are not allowed to import content into this lecture.",
    errorImportCancelled: "The import was cancelled.",
    errorRequiredField: "Complete the required field before import.",
    errorDuplicateOptions: "Options must be distinct.",
  },
  ar: {
    aiImport: "استيراد بالذكاء الاصطناعي",
    manual: "يدوي",
    previewOnly: "معاينة فقط — لم يتم حفظ أي شيء.",
    newPreview: "معاينة جديدة",
    startOver: "بدء من جديد",
    operation: "العملية",
    extractMcq: "استخراج أسئلة MCQ",
    generateMcq: "إنشاء أسئلة MCQ",
    enhanceMcq: "تحسين أسئلة MCQ",
    extractFlashcards: "استخراج بطاقات",
    generateFlashcards: "إنشاء بطاقات",
    enhanceFlashcards: "تحسين بطاقات",
    extractDescription: "تحويل الأسئلة أو البطاقات الموجودة إلى عناصر قابلة للتعديل.",
    generateDescription: "إنشاء أسئلة أو بطاقات جديدة من مادة المحاضرة.",
    enhanceDescription: "الحفاظ على المحتوى وإضافة الحقول الناقصة المعتمدة.",
    source: "المصدر",
    pdf: "PDF",
    images: "صور",
    pasteText: "لصق النص",
    chooseLecture: "المحاضرة المستهدفة",
    chooseSubject: "المادة الرئيسية",
    subSubject: "المادة الفرعية",
    track: "مسار الدراسة",
    department: "القسم السريري",
    reload: "تحديث",
    noLectures: "لا توجد محاضرات في هذا المسار المحدد حالياً.",
    browse: "انقر للتصفح أو اسحب الملفات إلى هنا",
    remove: "إزالة",
    clearAll: "مسح الكل",
    replace: "استبدال",
    maxPdf: "ملف PDF فقط، حتى 50 ميغابايت",
    imageLimits: "JPEG أو PNG أو WebP · 20 ميغابايت للصورة · 100 ميغابايت للمجموعة · 20 صورة",
    textPlaceholder: "ألصق محتوى المحاضرة أو الأسئلة أو البطاقات هنا…",
    characters: "حرف",
    count: "العدد",
    difficulty: "الصعوبة",
    category: "الفئة",
    style: "نمط السؤال",
    mixed: "مختلط",
    easy: "سهل",
    medium: "متوسط",
    hard: "صعب",
    direct: "مباشر",
    understanding: "فهم",
    clinical: "سريري",
    generateHints: "إنشاء تلميحات",
    generateExplanations: "إنشاء شروحات",
    addMissingHints: "إضافة التلميحات الناقصة",
    addMissingExplanations: "إضافة الشروحات الناقصة",
    focus: "تركيز اختياري",
    focusPlaceholder: "المفاهيم عالية الأهمية",
    extractNote: "سيتم الحفاظ على النص الموجود ولن يتم اختلاق الحقول الناقصة.",
    enhanceMcqNote: "ستبقى الأسئلة والخيارات والإجابات كما هي ولن يتم استبدال التلميحات أو الشروحات الموجودة.",
    enhanceFlashcardNote: "ستبقى الواجهات والشروحات الموجودة كما هي وسيتم إنشاء الأجوبة الناقصة فقط.",
    submitExtractMcq: "استخراج MCQ",
    submitGenerateMcq: "إنشاء MCQ",
    submitEnhanceMcq: "تحسين MCQ",
    submitExtractFlashcards: "استخراج البطاقات",
    submitGenerateFlashcards: "إنشاء البطاقات",
    submitEnhanceFlashcards: "تحسين البطاقات",
    cancel: "إلغاء",
    preparing: "جارٍ تجهيز المصدر…",
    analyzing: "جارٍ التحليل بالذكاء الاصطناعي…",
    structuring: "جارٍ تنظيم النتائج…",
    tryAgain: "المحاولة مرة أخرى",
    requestFailed: "تعذر إكمال معاينة الذكاء الاصطناعي.",
    cancelled: "تم إلغاء المعاينة.",
    results: "استوديو المراجعة",
    generated: "تم الإنشاء / الاستخراج",
    ready: "جاهز",
    needsReview: "يحتاج مراجعة",
    skipped: "تم التخطي",
    selected: "محدد",
    all: "الكل",
    selectAllReady: "تحديد كل الجاهز",
    clearSelection: "مسح التحديد",
    search: "بحث في العناصر",
    noCandidates: "لا توجد عناصر تطابق هذا العرض.",
    filteredEmpty: "لا توجد عناصر تطابق البحث أو المرشح الحالي.",
    trueEmpty: "لم يتم العثور على عناصر قابلة للاستخراج في المصدر.",
    incompleteEmpty: "اكتملت المعالجة جزئياً. راجع التحذيرات؛ لا تعني القائمة الفارغة أن المصدر خالٍ من العناصر.",
    selectedForImport: "محدد للاستيراد مستقبلاً",
    importedCount: "مستورد",
    imported: "مستورد",
    sourceOrdinal: "عنصر المصدر",
    sourceEvidence: "دليل المصدر",
    confidence: "ثقة الذكاء الاصطناعي",
    extracted: "مستخرج",
    generatedLabel: "منشأ",
    enhanced: "محسن",
    edited: "معدل",
    humanEdited: "معدل يدوياً — راجع التغييرات قبل الاستيراد",
    reset: "إعادة ضبط",
    reject: "إزالة من المراجعة",
    undo: "تراجع",
    question: "السؤال",
    optionA: "الخيار أ",
    optionB: "الخيار ب",
    optionC: "الخيار ج",
    optionD: "الخيار د",
    correctAnswer: "الإجابة الصحيحة",
    noAnswer: "لم يتم اختيار إجابة",
    hint: "تلميح",
    explanation: "شرح",
    clinicalConcept: "المفهوم السريري",
    page: "صفحة",
    image: "صورة",
    skippedItems: "عناصر تعذر تحويلها",
    truncated: "احتوى المصدر على عناصر أكثر مما يمكن لهذه المعاينة معالجته في طلب واحد. تم إرجاع الدفعة الأولى المدعومة.",
    warnings: "تحذيرات",
    aiWarning: "تحذير الذكاء الاصطناعي",
    currentState: "الحالة الحالية",
    status: "الحالة",
    readyForReview: "جاهز للمراجعة",
    invalid: "غير مكتمل",
    sourceText: "نص المصدر",
    warningMissingAnswer: "لم يحدد المصدر إجابة صحيحة. راجع هذا العنصر قبل الاستيراد.",
    warningAmbiguousAnswer: "يحتوي المصدر على أكثر من إجابة محتملة. راجع هذا العنصر قبل الاستيراد.",
    warningMissingEnhancement: "لا يزال أحد حقول التحسين المطلوبة مفقوداً.",
    warningLowConfidence: "ثقة الذكاء الاصطناعي أقل من حد المراجعة.",
    warningSourceUnavailable: "دليل المصدر غير متاح لهذا العنصر.",
    warningDuplicate: "قد يكرر هذا العنصر عنصراً آخر في المعاينة.",
    warningIncomplete: "اكتملت معالجة المصدر جزئياً؛ قد تكون بعض العناصر مفقودة.",
    warningProviderRecovery: "تم استخدام محاولة استرداد. راجع العناصر المستردة.",
    warningSourceInsufficient: "المصدر يدعم عناصر عالية الجودة أقل من العدد المطلوب.",
    warningReviewRequired: "راجع هذا العنصر قبل الاستيراد.",
    errorImportGeneric: "تعذر استيراد المحتوى المحدد. راجعه ثم حاول مرة أخرى.",
    errorImportInvalid: "بعض العناصر المحددة ناقصة أو غير صالحة. صححها قبل الاستيراد.",
    errorImportConflict: "تغيرت المحاضرة أثناء الاستيراد. حدّث المراجعة ثم حاول مرة أخرى.",
    errorImportNotFound: "تعذر العثور على المحاضرة المحددة.",
    errorImportUnauthorized: "لا تملك صلاحية استيراد المحتوى إلى هذه المحاضرة.",
    errorImportCancelled: "تم إلغاء الاستيراد.",
    errorRequiredField: "أكمل الحقل المطلوب قبل الاستيراد.",
    errorDuplicateOptions: "يجب أن تكون الخيارات مختلفة.",
  },
} as const;

export type AITextKey = keyof typeof copy.en;

export function aiText(language: Language, key: AITextKey): string {
  return copy[language][key] ?? copy.en[key];
}

export function localizeAIWarning(language: Language, warning: string): string {
  const value = warning.trim();
  if (!value) return "";
  if (/^(?:missing_question|missing_front)$/u.test(value) || /(?:question|clinical concept) is required/iu.test(value)) {
    return aiText(language, "errorRequiredField");
  }
  if (/option [A-D] is required/iu.test(value)) return aiText(language, "errorRequiredField");
  if (/options must not be duplicates|two or more answer options are identical/iu.test(value)) {
    return aiText(language, "errorDuplicateOptions");
  }
  if (/^(?:unsupported_option_count|unreadable|unsupported_format|not_mcq|not_flashcard)$/u.test(value)) {
    return aiText(language, "warningReviewRequired");
  }
  if (/source did not explicitly establish|correct answer is missing/iu.test(value)) {
    return aiText(language, "warningMissingAnswer");
  }
  if (/multiple answers|ambiguous/iu.test(value)) return aiText(language, "warningAmbiguousAnswer");
  if (/requested (?:hint|explanation)|enhancement .*missing|no .*enhancement result/iu.test(value)) {
    return aiText(language, "warningMissingEnhancement");
  }
  if (/confidence .*(?:below|threshold)|low confidence/iu.test(value)) return aiText(language, "warningLowConfidence");
  if (/source evidence .*(?:not provided|unavailable)|missing-source/iu.test(value)) {
    return aiText(language, "warningSourceUnavailable");
  }
  if (/duplicate/iu.test(value)) return aiText(language, "warningDuplicate");
  if (/incomplete|missing source item|missing .*ordinal/iu.test(value)) return aiText(language, "warningIncomplete");
  if (/recovery|recover/iu.test(value)) return aiText(language, "warningProviderRecovery");
  if (/only \d+ .*requested|source .*insufficient/iu.test(value)) return aiText(language, "warningSourceInsufficient");
  if (/model uncertainty/iu.test(value)) return aiText(language, "warningReviewRequired");
  if (/^AI_[A-Z0-9_]+$/u.test(value) || /schema|provider malformed|markdown conversion/iu.test(value)) {
    return aiText(language, "warningReviewRequired");
  }
  return value;
}

export function localizeAIError(language: Language, error: unknown): string {
  const candidate = error as {
    code?: unknown;
    body?: { error?: { code?: unknown } };
  };
  const code = candidate?.code ?? candidate?.body?.error?.code;
  switch (code) {
    case "AI_IMPORT_INVALID_REQUEST":
    case "AI_IMPORT_INVALID_CANDIDATE":
      return aiText(language, "errorImportInvalid");
    case "AI_IMPORT_CONFLICT":
      return aiText(language, "errorImportConflict");
    case "LECTURE_NOT_FOUND":
      return aiText(language, "errorImportNotFound");
    case "AI_IMPORT_UNAUTHORIZED":
    case "FORBIDDEN":
      return aiText(language, "errorImportUnauthorized");
    case "AI_JOB_CANCELLED":
    case "ABORTED":
      return aiText(language, "errorImportCancelled");
    default:
      return aiText(language, "errorImportGeneric");
  }
}