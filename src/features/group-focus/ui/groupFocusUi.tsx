import type { ComponentPropsWithoutRef, ReactNode } from "react";

export type GroupFocusLanguage = "en" | "ar";

export const groupFocusCopy = {
  en: {
    title: "Group focus",
    subtitle: "A quiet room. A clear plan. A little more follow-through.",
    createRoom: "Create a room",
    joinRoom: "Join a room",
    myRooms: "Your rooms",
    publicRooms: "Open rooms",
    publicRoomsSubtitle: "Find a quiet place to study alongside others.",
    loadMore: "Load more",
    loadingMore: "Loading more…",
    loading: "Loading rooms",
    retry: "Try again",
    myRoomsLoadError: "Your rooms could not be loaded.",
    publicRoomsLoadError: "Open rooms could not be loaded.",
    roomLoadError: "This room could not be loaded.",
    emptyMine: "Your next focused hour starts here.",
    emptyMineHelp: "Create a room for your study group, or join an open room.",
    emptyPublic: "No open rooms right now.",
    emptyPublicHelp: "You can create a room, or check back in a little while.",
    roomName: "Room name",
    roomNamePlaceholder: "For example, Renal physiology review",
    visibility: "Who can join",
    public: "Open to everyone",
    private: "Invite only",
    mode: "Study format",
    sharedLecture: "Study one shared lecture",
    studyTogether: "Study independently together",
    sharedLectureDescription: "Everyone works from the same lecture.",
    studyTogetherDescription: "Bring your own material; keep the same rhythm.",
    lecture: "Shared lecture",
    optionalLecture: "Your lecture (optional)",
    chooseLecture: "Choose a lecture",
    lecturesLoadError: "The lecture catalog could not be loaded.",
    selectedLectureUnavailable: "Selected lecture is not in the available catalog.",
    changeLecture: "Change my lecture",
    savingLecture: "Saving lecture…",
    yourStudyLecture: "Your study lecture",
    noneSelected: "No lecture selected",
    inviteLink: "Room invitation",
    inviteHelp: "Share this invitation only with people you want in the room.",
    rotateInvite: "Create a new invitation",
    rotatingInvite: "Creating invitation…",
    copyInvite: "Copy invitation",
    shareInvite: "Share invitation",
    working: "Working…",
    timeUnavailable: "Confirmed time is not available yet.",
    durationHoursFormat: "hours : minutes : seconds",
    durationMinutesFormat: "minutes : seconds",
    focusLength: "Focus length",
    breakLength: "Break length",
    rounds: "Focus rounds",
    participants: "Room size",
    minutes: "minutes",
    people: "people",
    create: "Create room",
    creating: "Creating room…",
    inviteCode: "Room link or invite code",
    invitePlaceholder: "Paste a room link or code",
    joinHelp: "Enter an open room link or a private invitation code to continue.",
    join: "Continue to room",
    joining: "Joining…",
    selectMode: "Choose a study format",
    createError: "The room could not be created. Please try again.",
    joinError: "We could not join that room. Check the link or code and try again.",
    participantsCount: "participants",
    full: "Full",
    closed: "Closed",
    lobby: "Lobby",
    session: "Focus session",
    terminal: "Session ended",
    room: "Room",
    roomPlan: "Room plan",
    sharedFocus: "Shared focus",
    connection: "Connection",
    connected: "Connected",
    connecting: "Connecting",
    reconnecting: "Reconnecting",
    disconnected: "Disconnected",
    connectionError: "Connection needs attention",
    retryConnection: "Reconnect",
    waitingForHost: "The room is ready when the host is.",
    waitingForState: "Waiting for the room’s confirmed state…",
    requestRoomState: "Request confirmed room state",
    requestingRoomState: "Requesting room state…",
    start: "Start focus",
    starting: "Starting…",
    pause: "Pause",
    resume: "Resume",
    leave: "Leave room",
    closeRoom: "Close room",
    closeConfirmTitle: "End this room?",
    closeConfirmText: "Everyone will leave this room and the session will end.",
    confirmEnd: "End room",
    cancel: "Keep room open",
    host: "Host",
    member: "Member",
    you: "You",
    liveParticipants: "Room presence",
    presenceHelp: "This live list includes members reconnecting after a temporary drop.",
    presenceEmpty: "No participants are connected yet.",
    peopleHere: "Active members",
    focus: "Focus",
    break: "Break",
    countdown: "Starting soon",
    paused: "Paused",
    completed: "Complete",
    waiting: "Waiting",
    unknownState: "Room state unavailable",
    round: "Round",
    of: "of",
    minutesShort: "min",
    summaryTitle: "Your focus, verified",
    summarySubtitle: "A calm record of the time you spent in this room.",
    verifiedTime: "Verified focus time",
    completedRounds: "Rounds completed",
    plannedRounds: "Rounds planned",
    endedReason: "Session ended",
    completedReason: "Plan completed",
    hostClosedReason: "Room ended by host",
    roomClosedReason: "Room closed",
    idleReason: "Room closed after inactivity",
    roundDetails: "Verified time by round",
    backToRooms: "Back to group focus",
    summaryLoading: "Preparing your session summary",
    summaryError: "Your summary is not available yet.",
    retrySummary: "Check again",
    noRounds: "No verified focus time was recorded for this session.",
    roomStatus: "Room status",
    open: "Open",
    privateRoom: "Invite only",
    sharedLectureMode: "Shared lecture",
    minuteCount: "min",
    accessibleTimer: "Remaining session time",
  },
  ar: {
    title: "تركيز جماعي",
    subtitle: "غرفة هادئة، خطة واضحة، والتزام أسهل.",
    createRoom: "إنشاء غرفة",
    joinRoom: "الانضمام إلى غرفة",
    myRooms: "غرفك",
    publicRooms: "غرف مفتوحة",
    publicRoomsSubtitle: "اعثر على مساحة هادئة للدراسة مع الآخرين.",
    loadMore: "تحميل المزيد",
    loadingMore: "جارٍ تحميل المزيد…",
    loading: "جارٍ تحميل الغرف",
    retry: "إعادة المحاولة",
    myRoomsLoadError: "تعذر تحميل غرفك.",
    publicRoomsLoadError: "تعذر تحميل الغرف المفتوحة.",
    roomLoadError: "تعذر تحميل هذه الغرفة.",
    emptyMine: "ابدأ ساعة تركيزك القادمة من هنا.",
    emptyMineHelp: "أنشئ غرفة لمجموعة الدراسة أو انضم إلى غرفة مفتوحة.",
    emptyPublic: "لا توجد غرف مفتوحة الآن.",
    emptyPublicHelp: "يمكنك إنشاء غرفة أو العودة بعد قليل.",
    roomName: "اسم الغرفة",
    roomNamePlaceholder: "مثال: مراجعة وظائف الكلى",
    visibility: "من يمكنه الانضمام",
    public: "مفتوحة للجميع",
    private: "بالدعوة فقط",
    mode: "طريقة الدراسة",
    sharedLecture: "دراسة محاضرة مشتركة",
    studyTogether: "دراسة مستقلة معًا",
    sharedLectureDescription: "يدرس الجميع من المحاضرة نفسها.",
    studyTogetherDescription: "اختر موادك وشارك الآخرين إيقاع الدراسة.",
    lecture: "المحاضرة المشتركة",
    optionalLecture: "محاضرتك (اختياري)",
    chooseLecture: "اختر محاضرة",
    lecturesLoadError: "تعذر تحميل قائمة المحاضرات.",
    selectedLectureUnavailable: "المحاضرة المختارة غير متاحة في القائمة.",
    changeLecture: "تغيير محاضرتي",
    savingLecture: "جارٍ حفظ المحاضرة…",
    yourStudyLecture: "محاضرتك الدراسية",
    noneSelected: "لم يتم اختيار محاضرة",
    inviteLink: "دعوة الغرفة",
    inviteHelp: "شارك هذه الدعوة مع الأشخاص الذين تريدهم في الغرفة فقط.",
    rotateInvite: "إنشاء دعوة جديدة",
    rotatingInvite: "جارٍ إنشاء الدعوة…",
    copyInvite: "نسخ الدعوة",
    shareInvite: "مشاركة الدعوة",
    working: "جارٍ التنفيذ…",
    timeUnavailable: "الوقت المؤكد غير متاح بعد.",
    durationHoursFormat: "ساعات : دقائق : ثوانٍ",
    durationMinutesFormat: "دقائق : ثوانٍ",
    focusLength: "مدة التركيز",
    breakLength: "مدة الاستراحة",
    rounds: "جولات التركيز",
    participants: "سعة الغرفة",
    minutes: "دقيقة",
    people: "أشخاص",
    create: "إنشاء الغرفة",
    creating: "جارٍ إنشاء الغرفة…",
    inviteCode: "رابط الغرفة أو رمز الدعوة",
    invitePlaceholder: "الصق رابط الغرفة أو رمزها",
    joinHelp: "أدخل رابط غرفة مفتوحة أو رمز دعوة خاص للمتابعة.",
    join: "متابعة إلى الغرفة",
    joining: "جارٍ الانضمام…",
    selectMode: "اختر طريقة الدراسة",
    createError: "تعذر إنشاء الغرفة. حاول مرة أخرى.",
    joinError: "تعذر الانضمام. تحقق من الرابط أو الرمز وحاول مرة أخرى.",
    participantsCount: "مشاركين",
    full: "مكتملة",
    closed: "مغلقة",
    lobby: "الردهة",
    session: "جلسة تركيز",
    terminal: "انتهت الجلسة",
    room: "الغرفة",
    roomPlan: "خطة الغرفة",
    sharedFocus: "تركيز مشترك",
    connection: "الاتصال",
    connected: "متصل",
    connecting: "جارٍ الاتصال",
    reconnecting: "جارٍ إعادة الاتصال",
    disconnected: "غير متصل",
    connectionError: "الاتصال يحتاج إلى انتباه",
    retryConnection: "إعادة الاتصال",
    waitingForHost: "الغرفة جاهزة عندما يكون المضيف مستعدًا.",
    waitingForState: "بانتظار تأكيد حالة الغرفة…",
    requestRoomState: "طلب حالة الغرفة المؤكدة",
    requestingRoomState: "جارٍ طلب حالة الغرفة…",
    start: "بدء التركيز",
    starting: "جارٍ البدء…",
    pause: "إيقاف مؤقت",
    resume: "استئناف",
    leave: "مغادرة الغرفة",
    closeRoom: "إغلاق الغرفة",
    closeConfirmTitle: "هل تريد إنهاء الغرفة؟",
    closeConfirmText: "سيغادر الجميع هذه الغرفة وستنتهي الجلسة.",
    confirmEnd: "إنهاء الغرفة",
    cancel: "إبقاء الغرفة",
    host: "المضيف",
    member: "عضو",
    you: "أنت",
    liveParticipants: "الحضور في الغرفة",
    presenceHelp: "تتضمن هذه القائمة المباشرة الأعضاء الذين يعيدون الاتصال بعد انقطاع مؤقت.",
    presenceEmpty: "لا يوجد مشاركون متصلون حتى الآن.",
    peopleHere: "الأعضاء النشطون",
    focus: "تركيز",
    break: "استراحة",
    countdown: "تبدأ قريبًا",
    paused: "متوقفة مؤقتًا",
    completed: "مكتملة",
    waiting: "بانتظار البدء",
    unknownState: "حالة الغرفة غير متاحة",
    round: "الجولة",
    of: "من",
    minutesShort: "د",
    summaryTitle: "تركيزك الموثّق",
    summarySubtitle: "سجل هادئ للوقت الذي قضيته في هذه الغرفة.",
    verifiedTime: "وقت التركيز الموثّق",
    completedRounds: "الجولات المكتملة",
    plannedRounds: "الجولات المخططة",
    endedReason: "انتهت الجلسة",
    completedReason: "اكتملت الخطة",
    hostClosedReason: "أنهى المضيف الغرفة",
    roomClosedReason: "أُغلقت الغرفة",
    idleReason: "أُغلقت الغرفة بعد عدم النشاط",
    roundDetails: "الوقت الموثّق حسب الجولة",
    backToRooms: "العودة إلى التركيز الجماعي",
    summaryLoading: "جارٍ تجهيز ملخص جلستك",
    summaryError: "الملخص غير متاح الآن.",
    retrySummary: "تحقق مرة أخرى",
    noRounds: "لم يُسجل وقت تركيز موثّق لهذه الجلسة.",
    roomStatus: "حالة الغرفة",
    open: "مفتوحة",
    privateRoom: "بالدعوة فقط",
    sharedLectureMode: "محاضرة مشتركة",
    minuteCount: "د",
    accessibleTimer: "الوقت المتبقي في الجلسة",
  },
} as const;

export type GroupFocusCopyKey = keyof typeof groupFocusCopy.en;

export function useGroupFocusCopy(language: GroupFocusLanguage) {
  const copy = groupFocusCopy[language];
  return {
    copy,
    isRtl: language === "ar",
    t: (key: GroupFocusCopyKey) => copy[key],
  };
}

export function GroupFocusShell({
  language,
  children,
  className = "",
}: {
  language: GroupFocusLanguage;
  children: ReactNode;
  className?: string;
}) {
  const { isRtl } = useGroupFocusCopy(language);
  return (
    <main
      dir={isRtl ? "rtl" : "ltr"}
      lang={language}
      data-group-focus-shell="true"
      className={`min-h-[100dvh] bg-[#f3f5f1] text-[#22312f] ${className}`}
    >
      <style>{`
        @media (prefers-reduced-motion: reduce) {
          [data-group-focus-shell="true"] *,
          [data-group-focus-shell="true"] *::before,
          [data-group-focus-shell="true"] *::after {
            animation-duration: 1ms !important;
            animation-iteration-count: 1 !important;
            scroll-behavior: auto !important;
            transition-duration: 1ms !important;
            transition-delay: 0ms !important;
          }
        }
      `}</style>
      {children}
    </main>
  );
}

export function GroupFocusPageHeader({
  language,
  eyebrow,
  title,
  description,
  action,
}: {
  language: GroupFocusLanguage;
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header dir={language === "ar" ? "rtl" : "ltr"} className="flex flex-col gap-5 border-b border-[#dce3dd] pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {eyebrow && (
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#63827b]">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-3xl font-semibold tracking-[-0.04em] text-[#203330] sm:text-[2.65rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-3 max-w-xl text-sm leading-6 text-[#657672] sm:text-base">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function GroupFocusButton({
  children,
  onClick,
  variant = "primary",
  disabled = false,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  const variants = {
    primary: "bg-[#285c52] text-white hover:bg-[#214d45]",
    secondary: "border border-[#cbd8d1] bg-[#f8faf7] text-[#29463f] hover:bg-[#eaf1ec]",
    quiet: "text-[#45645d] hover:bg-[#e6ede8]",
    danger: "bg-[#a5453c] text-white hover:bg-[#923b34]",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#39796b] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f3f5f1] disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function GroupFocusError({
  message,
  onRetry,
  retryLabel,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div role="alert" className="rounded-2xl border border-[#e6c9bd] bg-[#fff5ef] p-4 text-sm text-[#81483b]">
      <p>{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 min-h-11 rounded-lg px-3 font-semibold underline decoration-[#bc8b78] underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a35d49]"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function GroupFocusSkeleton({ rows = 2, label }: { rows?: number; label: string }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="h-28 animate-pulse motion-reduce:animate-none rounded-2xl border border-[#e2e8e2] bg-[#e9eee9]"
        />
      ))}
    </div>
  );
}

export function GroupFocusPanel({
  title,
  children,
  className = "",
  ...sectionProps
}: {
  title?: string;
  children: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<"section">, "title" | "children" | "className">) {
  return (
    <section {...sectionProps} className={`rounded-[1.4rem] border border-[#dfe7e0] bg-[#fbfcf9] p-5 shadow-[0_12px_35px_rgba(35,65,55,0.045)] sm:p-6 ${className}`}>
      {title && <h2 className="mb-4 text-sm font-semibold text-[#38534c]">{title}</h2>}
      {children}
    </section>
  );
}