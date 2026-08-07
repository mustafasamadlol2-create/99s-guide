/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type Language = "en" | "ar";

const translations = {
  en: {
    // Nav Bar
    library: "Library",
    schedule: "Timetable & Calendar",
    focusZone: "Focus Zone",
    settings: "Settings",
    controlCenter: "Admin Panel",
    profile: "My Profile",

    // Common UI Controls
    signOut: "Sign Out from Device",
    cancel: "Cancel",
    save: "Save",
    back: "Back",
    loading: "Please wait...",
    search: "Search content...",
    delete: "Delete",
    edit: "Edit",
    confirm: "Confirm",
    add: "Add New",

    // Welcome Screen & Authentication
    welcomeTitle: "99's Guide",
    welcomeSubtitle:
      "Interactive Study Companion for Medical Students",
    enterEmail: "Authorized Faculty Email Address",
    enterPassword: "Device Safe Password",
    enterName: "Full Medical Scholar Name",
    enterCardId: "Official Student ID Code",
    submitLogin: "Sign In as Scholar",
    submitRegister: "Initialize Student Registry",
    haveAccount: "Already registered?",
    noAccount: "First-time candidate? Authorize direct credentials",
    invalidCreds: "Incorrect account passcode or ID.",

    // Interactive Dashboard
    studyStats: "Study Progress Ledger",
    welcomeSection: "Welcome back, Specialist",
    streakLabel: "Continuous Streak Days",
    rankLabel: "Peer Ranking",
    pointsBadge: "Cumulative score points",
    greetingsMorning:
      "Good morning, future Clinician. Remember to check Dr. Al-Hamid's criteria.",
    greetingsEvening:
      "Good evening, Scholar. Commit high-yield clinical manifestos to memory tonight.",
    greetingsWeekend:
      "Enjoy your weekend review sessions. Consistency wins clerkships!",

    // Profile View
    academicActivityLogs: "Academic Activity Logs",
    verifiedLedger:
      "Verified study ledger of completed tasks, quizzes, and clinical reviews.",
    streakDescription:
      "Continuous daily streak reviewing the medical syllabus.",
    editStudentInfo: "Edit Student Info",
    selectClinicalAvatar: "Select Standard Clinical Avatar",
    syllabusCompletionStatus: "Subject Syllabus Completion Status",
    coverageRate: "Verify search coverage rates of essential clinical classes.",
    honorRollTitle: "Medical Students Honor Roll",

    // Settings Page
    settingsTitle: "Application Configuration Desk",
    settingsDesc:
      "Fine-tune UI variables, switch clinical language interfaces, or toggle display modes.",
    // Dashboard
    uniBaghdad: "BAGHDAD MEDICAL COLLEGE",
    upcomingEventAlert: "Upcoming Event Alert:",
    isScheduledOn: "is scheduled on",
    atTime: "at",
    openSchedule: "Open Schedule",
    dashboardRefreshed: "Dashboard Refreshed",
    dailyMotto: "TODAY'S MESSAGE",
    medSchool: "Med School",
    stage3: "Stage 3",
    batch99: "Batch 99",
    dailyScheduleAndTasks: "Daily Schedule & Tasks",
    appearanceTitle: "System Interface Mode",
    lightMode: "Light Beige Clinical Theme",
    darkMode: "Dark Slate-Charcoal Theme",
    systemMode: "Use System Default Settings",
    languageSelection: "Academic Localization Code",
    enDesc: "Render all pages entirely in English academic terminology.",
    arDesc: "تعريب كامل لواجهة التطبيق والمصطلحات الطبية",
    feedbackTitle: "Medical Feedback",

    // Focus View
    focusTitle: "Pomodoro Study Concentrator",
    focusDesc:
      "Block distracting indicators. Link countdown intervals to lectures to sow medical orchard pines.",
    timerModes: "🔒 ACTIVE STUDY TIME",
    restMode: "☕ REST & HYDRATE",
    initiateFocus: "Initiate Focus",
    pauseTimer: "Pause Timer",
    ambientAudio: "Ambient loop sound tracks:",
    forestFarmTitle: "My Medical Cohort Study Farm",
    forestFarmDesc:
      "Completed slots sow seedlings. Longer durations develop mighty oak & redwoods!",
    uploadMusicPrompt: "🎵 Browse Device Audio Track to play in-app:",

    // Calendar & Scheduler
    scheduleTitle: "Class Schedule",
    scheduleDesc:
      "Browse lecture hours, link exam review intervals, and write custom comments.",
    viewMonth: "Month View",
    viewWeek: "Week View",
    viewDay: "Day View",
    highlightTool: "✏️ Highlights overlay:",
    examAlert: "🔴 Exam Alert Highlight",
    subjectReview: "🟡 Fast Review Highlight",
    selectedDate: "SELECTED DATE AGENDA",
    noEvents: "🌱 No scheduled classes or custom tasks for this day.",
    addNewTask: "Plan Specific Study Task",
    taskTitlePlaceholder: "e.g., Study Parasitology Amoeba slides",
    alarmTime: "Alert alarm hour",
    chooseSubject: "Target Subject",
    chooseLecture: "Link to explicit Lecture",
    manualNotes: "Helper Study Notes",
    logAlarmBtn: "Log Timetable Alarm",
    clickComment: "✍️ Quick Day Comment (Sleeping, Gym, etc):",
    saveCommentBtn: "Pin Day Comment",

    // Control Center View
    controlTitle: "Academic Board Control Console (Admins Only)",
    controlDesc:
      "A simplified, code-free wizard for non-programmers to administer students, upload ready-made PDF materials, and configure exams.",
    studentListTab: "🎓 Student Directory & Marks Logs",
    materialsTab: "📚 Upload Faculty Lectures",
    examSettingsTab: "📅 Configure Timetable & Exams",
    emptyRoster: "No student candidates registered in the directory.",
    addStudentTitle: "Authorize New Student account",
    rosterHeaderName: "Medical Student Name",
    rosterHeaderID: "Official ID / Email",
    rosterHeaderTime: "Time Spent (Min)",
    rosterHeaderMarks: "Leaderboard Points",
    rosterHeaderLectures: "Done Lectures / Quizzes",
    rosterHeaderRole: "Permission Rating",
    promoteAdmin: "Promote Admin",
    demoteAdmin: "Revoke Admin (Demote)",
    removeStudentBtn: "Remove Student Account",
    pdfUploadNote:
      "Note: Lectures are ready-made PDF records. Students can click Open PDF on their devices, and local readers handle the rest.",
    selectSubjectSubject: "Select Core Subject:",
    selectModuleModule: "Select Module Track:",
    enterLectTitle: "Full Lecture File Title:",
    enterDocName: "Teaching Professor/Doctor Name:",
    enterPdfFileName:
      "Ready-made Lecture PDF File Name/Link (e.g. Gram_Positive_Cocci.pdf):",
    enterNotesPdfFileName:
      "Reviewer Notes PDF File Name/Link (e.g. Cocci_Short_Summaries.pdf):",
    enterLectDesc: "Mini Syllabus summary / educational objectives:",
    submitLectUpload: "Publish Faculty Lecture to Course Library",
    addQuizTitle: "Sow Multiple-Choice MCQ Quiz questions:",
    quizQuestionLabel: "Vignette Case Question:",
    quizExpectedA: "Option A:",
    quizExpectedB: "Option B:",
    quizExpectedC: "Option C:",
    quizExpectedD: "Option D:",
    quizAnswerLabel: "Correct Answer Choice:",
    quizExplanationLabel: "Detailed Clarifying Explanation:",
    submitQuizBtn: "Attach Practice Quiz to Lecture",
    addVideoTitle: "Embed YouTube Clinical Video explanation:",
    youtubeVideoUrl: "Video YouTube Direct Web link:",
    submitVideoBtn: "Link Video Lecture",
    addAnkiTitle: "Add Educational Flashcards:",
    frontTerm: "Front Term / Question:",
    backDefinition: "Back Definition / Answer:",
    submitFlashcardBtn: "Link Recall Flashcard",
    examDateTitle: "Announce Schedule & Exam Milestones:",
    examDateHour: "Event Starting Hour:",
    examDateDesc: "Short Warning / Location (Exam hall, Lecture room, etc):",
    submitExamBtn: "Publish Class Event to Student Calendars",
    rosterShowPasswords: "⚠️ Show Decrypted Passwords",
  },
  ar: {
    // Nav Bar
    library: "المكتبة الأكاديمية",
    schedule: "الجدول والتقويم الدراسي",
    focusZone: "مؤقت التركيز الفائق",
    settings: "الإعدادات",
    controlCenter: "لوحة التحكم",
    profile: "ملفي الشخصي",

    // Common UI Controls
    signOut: "تسجيل الخروج من هذا الجهاز",
    cancel: "إلغاء",
    save: "حفظ التعديلات",
    back: "الرجوع لخلف",
    loading: "تحميل اللوحات الوشيكة...",
    search: "بحث في المحتويات الأكاديمية...",
    delete: "حذف",
    edit: "تعديل",
    confirm: "تأكيد",
    add: "إضافة جديد",

    // Welcome Screen & Authentication
    welcomeTitle: "دليل الدفعة 99",
    welcomeSubtitle:
      "المساعد التعليمي الذكي لطلبة كلية الطب - جامعة بغداد (المرحلة الثالثة)",
    enterEmail: "عنوان البريد الجامعي المعتمد",
    enterPassword: "كلمة مرور آمنة للجهاز",
    enterName: "الاسم الكامل للطالب الطبي",
    enterCardId: "رمز الهوية الطلابية الرسمية",
    submitLogin: "تسجيل دخول الطالب",
    submitRegister: "تهيئة وتسجيل حساب جديد",
    haveAccount: "مسجل مسبقاً في الدفعة 99؟",
    noAccount: "طالب جديد؟ سجل معلوماتك المعتمدة الآن",
    invalidCreds: "أخطاء في هويات الدخول أو كلمة رمز المرور الكلية.",

    // Interactive Dashboard
    studyStats: "سجل الإنجاز التعليمي",
    welcomeSection: "مرحباً بك مجدداً، أيها الطبيب المقيم",
    streakLabel: "أيام الدراسة المتتالية",
    rankLabel: "ترتيبك بين زملائك",
    pointsBadge: "مجموع نقاط الإنجاز الكلي",
    greetingsMorning:
      "صباح الخير، يا طبيب المستقبل. لا تنسَ مراجعة معايير الدكتور الـحميد.",
    greetingsEvening:
      "مساء الخير، يا زميل المستقبل. ركز في دراسة المظاهر السريرية الأساسية لقرارات الليلة.",
    greetingsWeekend:
      "نتمنى لك مراجعة ممتعة نهاية هذا الأسبوع. الثبات يبني مهارة التدريب السريري!",

    // Profile View
    academicActivityLogs: "سجل الحركات الأكاديمية المتفاعلة",
    verifiedLedger:
      "دفتر الأستاذ المعتمد لقرائة المحاضرات وحل الاختبارات وتفاعلات الدفعة المعتمدة.",
    streakDescription:
      "عدد الأيام المتتالية لمطالعة مناهج كلية الطب بجامعة بغداد.",
    editStudentInfo: "تحديث بطاقة الطالب السريرية",
    selectClinicalAvatar: "اختر الرمز السريري المعتمد لملفك",
    syllabusCompletionStatus: "معدلات اكتمال المناهج والوحدات",
    coverageRate: "تحقق من معدل دراسة وفهم الأقسام النظرية والعملية بالجامعة.",
    honorRollTitle: "لوحة شرف طلبة جامعة بغداد - الدفعة 99",

    // Settings Page
    settingsTitle: "لوحة تهيئة إعدادات التطبيق الكلية",
    settingsDesc:
      "تعديل واجهات النظام، وتغيير اللغة الأكاديمية للمركز الدراسي، أو تنشيط الوضع المخصص.",
        // Dashboard
    uniBaghdad: "جامعة بغداد العريقة",
    upcomingEventAlert: "تنبيه الفعالية القادمة:",
    isScheduledOn: "مقرر في تاريخ",
    atTime: "في الساعة",
    openSchedule: "فتح الجدول",
    dashboardRefreshed: "تم تحديث لوحة التحكم",
    dailyMotto: "شعار اليوم",
    medSchool: "رابطة الأطباء",
    stage3: "المرحلة الثالثة",
    batch99: "الدفعة 99",
    dailyScheduleAndTasks: "الجدول اليومي والمهام",
    appearanceTitle: "وضع واجهة التطبيق",
    lightMode: "الوضع السريري الهادئ (بيج هادئ)",
    darkMode: "الوضع المعتم العالي (أردوازي ليلى داكن)",
    systemMode: "تلقائي حسب إعدادات الجهاز",
    languageSelection: "لغة الدراسة والتطبيق الكلية",
    enDesc: "عرض التطبيق والمصطلحات الطبية بالإنجليزية الكاملة بالكامل",
    arDesc: "تعريب كامل للواجهة لتسهيل الاستخدام والربط الأكاديمي للطلبة",
    feedbackTitle: "صندوق الملاحظات والدعم الفني لبغداد",

    // Focus View
    focusTitle: "منظم التركيز والوقت (بومودورو المعزز)",
    focusDesc:
      "امنع المشتتات الطبية والطلابية بالكامل. اربط عدادات الوقت بمحاضرة لزرع أشجار في مزرعتك الطلابية.",
    timerModes: "🔒 زمن التركيز والمطالعة الفاعل",
    restMode: "☕ استراحة قصيرة وترطيب",
    initiateFocus: "بدء جلسة التركيز المانع",
    pauseTimer: "إيقاف المؤقت مؤقتاً",
    ambientAudio: "المسارات الصوتية الخلفية المحفزة الطبيعية:",
    forestFarmTitle: "مزرعتي لدراسة الدفعة 99",
    forestFarmDesc:
      "الانتهاء من جلسات بومودورو يزرع نبتة جديدة. الجلسات الأطول تنمو إلى أشجار وقامات عملاقة!",
    uploadMusicPrompt:
      "🎵 اختر ملف موسيقى أو لوفي مخصص من جهازك لتشغيله في التطبيق:",

    // Calendar & Scheduler
    scheduleTitle: "الجدول الدراسي التفاعلي الكلي",
    scheduleDesc:
      "تصفح ساعات الجدول، واجرِ مراجعات الامتحانات، واكتب ملاحظات شخصية لحياتك اليومية.",
    viewMonth: "عرض بالشهور",
    viewWeek: "عرض بالأسابيع",
    viewDay: "عرض الأيام التفصيلي",
    highlightTool: "✏️ أداة ملامح تظليل الأيام الملونة:",
    examAlert: "🔴 تنبيه الامتحانات الفائقة",
    subjectReview: "🟡 تنبيه مراجعات المنهج الضروري",
    selectedDate: "جدول وتفاصيل اليوم المحدد والأسبوع",
    noEvents:
      "🌱 لا توجد محاضرات لبغداد أو مهام طلابية مسجلة لهذا اليوم المختار.",
    addNewTask: "تخطيط مهمة دراسية جديدة",
    taskTitlePlaceholder: "مثلاً: دراسة سلايدات الأميبا والـطفيليات الليلة",
    alarmTime: "توقيت تنبيه التذكير",
    chooseSubject: "المادة المستهدفة بالجامعة",
    chooseLecture: "ربط بمحاضرة محددة بالمكتبة",
    manualNotes: "ملاحظات إرشادية وتنبيهات الحفظ",
    logAlarmBtn: "تسجيل وحفظ تنبيه الجدول",
    clickComment: "✍️ تعليق سريع لليوم (ساعات النوم، النادي الرياضي، الخ):",
    saveCommentBtn: "تثبيت التعليق السريع لليوم",

    // Control Center View
    controlTitle: "مركز تحكم المشرفين والأكاديميين (إداريو الدفعة فقط)",
    controlDesc:
      "واجهة فائقة التبسيط معدّة خصيصاً لغير المبرمجين. لإدارة شؤون الزملاء والطلبة، ورفع ملفات الـPDF الجاهزة، وربط أسئلة المناهج التفاعلية.",
    studentListTab: "🎓 شؤون الطلبة وسجلات كلمات المرور والعلامات والإنترنت",
    materialsTab: "📚 رفع وتحديث محاضرات PDF والمناهج",
    examSettingsTab: "📅 تحديد ونشر مواعيد الامتحانات والجدول الدراسي",
    emptyRoster: "لم يسجل أي طالب في دليل الدفعة حتى الآن.",
    addStudentTitle: "تفويض حساب طالب جديد وتدشينه سلفاً",
    rosterHeaderName: "اسم الطالب الطبي بالكامل",
    rosterHeaderID: "الهوية الرسمية أو البريد الموثق",
    rosterHeaderTime: "وقت الاستخدام بالتطبيق (دقيقة)",
    rosterHeaderMarks: "إجمالي النقاط الفعالة",
    rosterHeaderLectures: "المحاضرات المكملة / الاختبارات المحلولة",
    rosterHeaderRole: "أذونات الإدارة للدفعة 99",
    promoteAdmin: "تعيين إداري (مُشرف)",
    demoteAdmin: "سحب الصلاحيات الإشرافية",
    removeStudentBtn: "حذف حساب الطالب نهائياً من الدليل",
    pdfUploadNote:
      "ملاحظة: المحاضرات تُرْفَع كطبيعة ملفات PDF مستقلة وجاهزة. يفتحها الطالب كملف PDF على جهازه، ويتولى برنامج قراءة الـPDF على جهاز الطالب الباقي بسلاسة تامة.",
    selectSubjectSubject: "اختر المادة التعليمية المطبوعة:",
    selectModuleModule: "اختر الجزء أو الوحدة الدراسية:",
    enterLectTitle: "العنوان الأكاديمي لملف المحاضرة:",
    enterDocName: "اسم الدكتور أو الأستاذ المحاضر:",
    enterPdfFileName:
      "اسم أو الرابط لملف المحاضرة الـPDF الجاهز (مثلاً Cocci_L1.pdf):",
    enterNotesPdfFileName:
      "اسم أو الرابط لملف الملاحظات والملخصات الـPDF الجاهز:",
    enterLectDesc: "وصف مختصر للوحدة وأهداف الدراسة الرئيسية:",
    submitLectUpload: "نشر المحاضرة وقرر الـPDF بالمكتبة الأكاديمية",
    addQuizTitle: "إضافة أسئلة اختيار من متعدد MCQ للمحاضرة:",
    quizQuestionLabel: "سؤال الحالة الطبية المطروحة (أعراض، فحوصات):",
    quizExpectedA: "الخيار أ:",
    quizExpectedB: "الخيار ب:",
    quizExpectedC: "الخيار ج:",
    quizExpectedD: "الخيار د:",
    quizAnswerLabel: "الخيار الصحيح الدقيق للأجوبة:",
    quizExplanationLabel: "التفسير والشرح الأكاديمي المستوفي:",
    submitQuizBtn: "ربط وحفظ الاختبار بالمحاضرة بالمكتبة",
    addVideoTitle: "تثبيت وربط شرح فيديو يوتيوب مساعد للمحاضرة:",
    youtubeVideoUrl: "الرابط المباشر من يوتيوب للفيديو المساعد:",
    submitVideoBtn: "ربط فيديو الكليبات",
    addAnkiTitle: "إضافة بطاقات فلاش كاردز Anki للمذاكرة السريعة:",
    frontTerm: "الوجه الأول للبطاقة (مفهوم / سؤال):",
    backDefinition: "الوجه الخلفي للبطاقة (الشرح / إجابة سريعة):",
    submitFlashcardBtn: "سجل بطاقة الاسترجاع السريع بقائمتها",
    examDateTitle: "الإعلان عن موعد المحاضرات والامتحانات الكبرى:",
    examDateHour: "الساعة المحددة لبدء الفعالية والحدث المحدد:",
    examDateDesc:
      "وصف تنبيهي للمكان المحدد (القاعة المحددة، القاعة الدراسية، الخ):",
    submitExamBtn: "نشر الحدث الدراسي على تقويم ومنبه الطلاب جميعاً",
    rosterShowPasswords: "⚠️ كشف ومعاينة كلمات مرور الطلبة غير المشفرة",
  },
};

export const useTranslation = (lang: Language) => {
  return {
    t: (key: keyof (typeof translations)["en"]) => {
      const dic = translations[lang] || translations["en"];
      return dic[key] || translations["en"][key] || String(key);
    },
  };
};
