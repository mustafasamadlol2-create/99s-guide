import { useEffect } from "react";
import type { Language } from "./translations";

/**
 * Compatibility localization for legacy UI that still contains literal English
 * labels. The map is deliberately exact-match only so user-generated content,
 * lecture titles and medical material are never translated or mutated.
 *
 * New UI should still use the normal i18n helpers; this bridge guarantees that
 * older/lazy/admin screens participate in the Arabic experience while they are
 * progressively migrated to keyed translations.
 */
const ARABIC_UI_TEXT: Record<string, string> = {
  "99's Guide": "دليل 99",
  "99's Guide • Bulletin": "دليل 99 • الإشعارات",
  "99's Guide • Version 1.0.0": "دليل 99 • الإصدار 1.0.0",
  "Academic Group": "المجموعة الدراسية",
  "Account summary": "ملخص الحساب",
  "Active": "نشط",
  "Additional details": "تفاصيل إضافية",
  "Adjust Photo": "ضبط الصورة",
  "Admin": "مشرف",
  "Administrator": "المشرف",
  "All Admins": "جميع المشرفين",
  "All Types": "جميع الأنواع",
  "All clear": "لا توجد مخالفات",
  "All users can currently post in discussions.": "يمكن لجميع المستخدمين المشاركة في المناقشات حاليًا.",
  "Also delete the offending comment": "حذف التعليق المخالف أيضًا",
  "Anki": "بطاقات أنكي",
  "Applying…": "جارٍ التطبيق…",
  "Approve + Penalize": "قبول البلاغ وتطبيق العقوبة",
  "Approve Report": "قبول البلاغ",
  "Auto": "تلقائي",
  "Auto-generated system event": "حدث أنشأه النظام تلقائيًا",
  "Away": "غير متصل",
  "Back to Login Portal": "العودة إلى تسجيل الدخول",
  "Ban": "حظر",
  "Ban User": "حظر المستخدم",
  "Banned": "محظور",
  "Banned Users": "المستخدمون المحظورون",
  "Banning…": "جارٍ الحظر…",
  "Blocked Users": "المستخدمون المحظورون",
  "Branch: Summer Clerkships": "الفرع: التدريب الصيفي",
  "Cancel": "إلغاء",
  "Cancel and Return": "إلغاء والعودة",
  "Cancel and Return to Sign In": "إلغاء والعودة إلى تسجيل الدخول",
  "Center your face inside the frame": "ضع وجهك داخل الإطار",
  "Change Duration": "تغيير المدة",
  "Check Your Student Inbox": "تحقق من بريدك الجامعي",
  "Check your inbox": "تحقق من بريدك الوارد",
  "Choose Photo": "اختيار صورة",
  "Choose how you want to update it": "اختر طريقة التحديث",
  "Choose your email": "اختر بريدك الإلكتروني",
  "Clear": "مسح",
  "Clear filters": "مسح عوامل التصفية",
  "Clear signature": "مسح التوقيع",
  "Clinical Verification Log:": "سجل التحقق الأكاديمي:",
  "Comment being reported": "التعليق المُبلّغ عنه",
  "Community Guidelines": "إرشادات المجتمع",
  "Complete Registration": "إكمال التسجيل",
  "Complete Your Profile": "أكمل ملفك الشخصي",
  "Completing Registration...": "جارٍ إكمال التسجيل...",
  "Contact Support": "التواصل مع الدعم",
  "Content from a blocked user": "محتوى من مستخدم محظور",
  "Continue": "متابعة",
  "Create account": "إنشاء حساب",
  "Creating…": "جارٍ الإنشاء…",
  "Credits": "الوحدات",
  "Digital Signature": "التوقيع الرقمي",
  "Disciplinary Summary": "ملخص الإجراءات الإدارية",
  "Duration": "المدة",
  "Edit Profile": "تعديل الملف الشخصي",
  "English": "الإنجليزية",
  "Entire Day": "طوال اليوم",
  "Expired / lifted": "منتهي / مرفوع",
  "First action:": "أول إجراء:",
  "Forgot Password?": "نسيت كلمة المرور؟",
  "From Date": "من تاريخ",
  "Full Name": "الاسم الكامل",
  "Group A": "المجموعة A",
  "Group B": "المجموعة B",
  "Group C": "المجموعة C",
  "Group D": "المجموعة D",
  "Group E": "المجموعة E",
  "Guide": "الدليل",
  "Help us keep discussions safe and respectful.": "ساعدنا في إبقاء المناقشات آمنة ومحترمة.",
  "Hours": "الساعات",
  "I Agree — Enter the Forum": "أوافق — دخول المنتدى",
  "Last action:": "آخر إجراء:",
  "Lecture:": "المحاضرة:",
  "Lectures": "المحاضرات",
  "Loading…": "جارٍ التحميل…",
  "MCQ Performance Score": "نتيجة أسئلة الاختيار المتعدد",
  "Medical Disclaimer": "إخلاء المسؤولية الطبية",
  "Moderation History": "سجل الإشراف",
  "Moderation:": "الإشراف:",
  "Mute": "كتم",
  "Mute User": "كتم المستخدم",
  "Muted": "مكتوم",
  "Muted Users": "المستخدمون المكتومون",
  "Muting…": "جارٍ الكتم…",
  "My Reports": "بلاغاتي",
  "No accounts are currently suspended.": "لا توجد حسابات موقوفة حاليًا.",
  "No active peers found": "لا يوجد زملاء نشطون حاليًا",
  "No banned users": "لا يوجد مستخدمون محظورون",
  "No blocked users": "لا يوجد مستخدمون محظورون",
  "No events scheduled for this day": "لا توجد أحداث مجدولة لهذا اليوم",
  "No moderation actions recorded.": "لا توجد إجراءات إشراف مسجلة.",
  "No muted users": "لا يوجد مستخدمون مكتومون",
  "No permanent penalties": "لا توجد عقوبات دائمة",
  "No records found": "لا توجد سجلات",
  "No reports yet": "لا توجد بلاغات بعد",
  "No results found": "لا توجد نتائج",
  "Notes": "الملاحظات",
  "OR CONNECT WITH": "أو تابع باستخدام",
  "Owner": "المالك",
  "Password Successfully Updated": "تم تحديث كلمة المرور بنجاح",
  "Penalty Level": "مستوى العقوبة",
  "Permanent": "دائم",
  "Permanent Ban on record": "يوجد حظر دائم مسجل",
  "Permanent Mute on record": "يوجد كتم دائم مسجل",
  "Permanent only": "الدائم فقط",
  "Please read before participating": "يرجى القراءة قبل المشاركة",
  "Prevents the user from posting in discussions.": "يمنع المستخدم من النشر في المناقشات.",
  "Privacy & Medical Integrity": "الخصوصية والنزاهة الطبية",
  "Privacy Policy": "سياسة الخصوصية",
  "Profile Photo": "صورة الملف الشخصي",
  "Profile Picture": "الصورة الشخصية",
  "Reason": "السبب",
  "Reason for report": "سبب البلاغ",
  "Reason:": "السبب:",
  "Recent Searches": "عمليات البحث الأخيرة",
  "Redraw": "إعادة الرسم",
  "Redraw Signature": "إعادة رسم التوقيع",
  "Refresh": "تحديث",
  "Register Account": "إنشاء الحساب",
  "Reload Application": "إعادة تحميل التطبيق",
  "Remove Photo": "إزالة الصورة",
  "Reply from a blocked user": "رد من مستخدم محظور",
  "Report Comment": "الإبلاغ عن التعليق",
  "Reported Content": "المحتوى المُبلّغ عنه",
  "Reported User": "المستخدم المُبلّغ عنه",
  "Reporter": "مقدّم البلاغ",
  "Required for audit log": "مطلوب لسجل التدقيق",
  "Resetting account for": "إعادة ضبط الحساب لـ",
  "Results": "النتائج",
  "Retake Medical Quiz": "إعادة الاختبار الطبي",
  "Return to Portal Login": "العودة إلى تسجيل الدخول",
  "Save": "حفظ",
  "Search for anything": "ابحث عن أي شيء",
  "Secure Academic Access": "دخول أكاديمي آمن",
  "Secure Password Reset": "إعادة تعيين آمنة لكلمة المرور",
  "Send Recovery Link": "إرسال رابط الاسترداد",
  "Sending…": "جارٍ الإرسال…",
  "Show anyway": "إظهار على أي حال",
  "Sign Here": "وقّع هنا",
  "Sign In": "تسجيل الدخول",
  "Sign In to Dashboard": "الدخول إلى التطبيق",
  "Sign In to Your Dashboard": "تسجيل الدخول إلى حسابك",
  "Sign Out": "تسجيل الخروج",
  "Signature": "التوقيع",
  "Signing you in to your dashboard…": "جارٍ تسجيل دخولك…",
  "Skip for now": "تخطي الآن",
  "Something went wrong": "حدث خطأ غير متوقع",
  "Student": "طالب",
  "Submit Report": "إرسال البلاغ",
  "Submitting…": "جارٍ الإرسال…",
  "Support & Help Center": "مركز الدعم والمساعدة",
  "Suspended": "موقوف",
  "Sync": "مزامنة",
  "System": "النظام",
  "Take Photo": "التقاط صورة",
  "Target User ID": "معرّف المستخدم المستهدف",
  "Terms of Service": "شروط الخدمة",
  "This will suspend the account immediately.": "سيؤدي هذا إلى إيقاف الحساب فورًا.",
  "Timeline": "الخط الزمني",
  "To Date": "إلى تاريخ",
  "Understood": "مفهوم",
  "Update Password": "تحديث كلمة المرور",
  "Updating password…": "جارٍ تحديث كلمة المرور…",
  "Use my Apple email": "استخدام بريد Apple",
  "Use my university email": "استخدام بريدي الجامعي",
  "Version: 1.0.0": "الإصدار: 1.0.0",
  "Video": "فيديو",
  "Watch": "مشاهدة",
  "Welcome back": "مرحبًا بعودتك",
  "Your Medical Study Guide": "دليلك الدراسي الطبي",
  "Accountability:": "المسؤولية:",
  "Action Detail": "تفاصيل الإجراء",
  "Action Type": "نوع الإجراء",
  "Acceptance:": "الموافقة:",
  "Apple may provide a private relay address to protect your email. This is normal and expected.": "قد توفر Apple عنوان بريد خاصًا لحماية بريدك الحقيقي، وهذا سلوك طبيعي ومتوقع.",
  "Can I change my academic group?": "هل يمكنني تغيير مجموعتي الدراسية؟",
  "Data Collection:": "جمع البيانات:",
  "Data Sharing:": "مشاركة البيانات:",
  "Deletion:": "حذف البيانات:",
  "Each reset is cryptographically verified to protect medical data integrity.": "يتم التحقق من كل عملية إعادة تعيين بصورة آمنة لحماية بياناتك.",
  "Exclusive to Medical Students. Passwords encrypted. Multi-device syncing enabled locally.": "مخصص لطلبة الطب. كلمات المرور محمية، والمزامنة بين الأجهزة مدعومة.",
  "How do I reset my password?": "كيف أعيد تعيين كلمة المرور؟",
  "Is my progress saved offline?": "هل يُحفظ تقدمي دون اتصال؟",
  "Last Updated: August 2026": "آخر تحديث: أغسطس 2026",
  "Med Portal Recovery": "استعادة حساب دليل 99",
  "No reports yet": "لا توجد بلاغات بعد",
  "Privacy &amp; Medical Integrity": "الخصوصية والنزاهة الطبية",
  "Returning to login in 8 seconds": "سيتم الرجوع إلى تسجيل الدخول خلال 8 ثوانٍ",
  "The application is intended exclusively for education and study. It must never be used for diagnosis or replace professional medical advice.": "التطبيق مخصص حصريًا للتعليم والدراسة، ولا يجوز استخدامه للتشخيص أو بديلًا عن الاستشارة الطبية المهنية.",
  "User Content:": "محتوى المستخدم:",
  "Usage:": "الاستخدام:",
  "Verifying…": "جارٍ التحقق…",
  "We encountered an unexpected error. Please refresh the application to continue.": "حدث خطأ غير متوقع. يرجى إعادة تحميل التطبيق للمتابعة.",
  "Welcome to 99&apos;s Guide. Please verify your details and upload a photo.": "مرحبًا بك في دليل 99. يرجى التحقق من بياناتك وإضافة صورة شخصية.",
  "You can update your group later in settings.": "يمكنك تغيير مجموعتك لاحقًا من الإعدادات.",
  "Your credentials have been securely refreshed. You can now sign in with your new password.": "تم تحديث بيانات الدخول بأمان. يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.",

  // Legal pages
  "Data Collection": "جمع البيانات",
  "Authentication & Sign-In": "المصادقة وتسجيل الدخول",
  "Stored Data & Uploaded Files": "البيانات المخزنة والملفات المرفوعة",
  "Cookies and Sessions": "ملفات تعريف الارتباط والجلسات",
  "Offline Storage": "التخزين دون اتصال",
  "Push Notifications": "الإشعارات الفورية",
  "Hosting & Third-Party Services": "الاستضافة وخدمات الأطراف الثالثة",
  "Security": "الأمان",
  "Data Retention & Account Deletion": "الاحتفاظ بالبيانات وحذف الحساب",
  "User Rights & Contact": "حقوق المستخدم والتواصل",
  "Frequently Asked Questions": "الأسئلة الشائعة",
  "Account Assistance & Deletion": "مساعدة الحساب وحذفه",
  "How to Report Bugs": "كيفية الإبلاغ عن الأخطاء",
  "Response Time": "وقت الاستجابة",
  "Acceptance of Terms": "قبول الشروط",
  "Educational Purpose": "الغرض التعليمي",
  "User Responsibilities & Account Usage": "مسؤوليات المستخدم واستخدام الحساب",
  "Prohibited Activities": "الأنشطة المحظورة",
  "Intellectual Property": "الملكية الفكرية",
  "Medical Education Disclaimer": "إخلاء مسؤولية التعليم الطبي",
  "Limitation of Liability & Service Availability": "حدود المسؤولية وتوفر الخدمة",
  "Changes to Terms & Contact Information": "تغييرات الشروط ومعلومات التواصل",
  "Educational Purposes Only": "لأغراض تعليمية فقط",
  "Not Medical Advice": "ليس نصيحة طبية",
  "Not a Replacement for Physicians": "لا يُعد بديلًا عن الطبيب",
  "User Responsibility": "مسؤولية المستخدم",

  // Frequently visible sentence-level legacy copy
  "Reports you submit will appear here so you can track their status.": "ستظهر البلاغات التي ترسلها هنا لتتمكن من متابعة حالتها.",
  "You haven't blocked anyone. Users you block will appear here.": "لم تحظر أي مستخدم بعد. سيظهر المستخدمون المحظورون هنا.",
  "Do not share your account credentials. You are responsible for all activities that occur under your account.": "لا تشارك بيانات تسجيل الدخول الخاصة بك. أنت مسؤول عن جميع الأنشطة التي تتم عبر حسابك.",
  "You can request a password reset from the login screen.": "يمكنك طلب إعادة تعيين كلمة المرور من شاشة تسجيل الدخول.",
  "Progress syncs automatically when you regain internet connectivity.": "تتم مزامنة تقدمك تلقائيًا عند عودة الاتصال بالإنترنت.",
  "Yes, you can update your profile information in the Profile tab.": "نعم، يمكنك تحديث معلوماتك من صفحة الملف الشخصي.",
  "Our technical support team aims to respond to all inquiries within 48-72 business hours.": "نسعى للرد على جميع استفسارات الدعم خلال 48–72 ساعة عمل.",
  "We collect your name, email, and academic group for authentication and app functionality.": "نجمع اسمك وبريدك الإلكتروني ومجموعتك الدراسية لتسجيل الدخول وتشغيل ميزات التطبيق.",
  "We do not sell or share your personal data with third-party marketers.": "لا نبيع بياناتك الشخصية ولا نشاركها مع جهات تسويقية خارجية.",
  "You can permanently delete your account and all associated data from the Settings screen at any time.": "يمكنك حذف حسابك وجميع البيانات المرتبطة به نهائيًا من الإعدادات في أي وقت.",
  "We reserve the right to remove any content and revoke access for users who violate these terms.": "نحتفظ بحق إزالة المحتوى وسحب الوصول من المستخدمين الذين يخالفون هذه الشروط.",
};

const REVERSE_ARABIC_UI_TEXT = Object.fromEntries(
  Object.entries(ARABIC_UI_TEXT).map(([en, ar]) => [ar, en]),
) as Record<string, string>;

const LOCALIZABLE_ATTRIBUTES = ["placeholder", "title", "aria-label"] as const;
let mutationGuard = false;

function translateExact(value: string, language: Language): string {
  const trimmed = value.trim();
  if (!trimmed) return value;
  const translated =
    language === "ar" ? ARABIC_UI_TEXT[trimmed] : REVERSE_ARABIC_UI_TEXT[trimmed];
  if (!translated) return value;
  const start = value.indexOf(trimmed);
  return `${value.slice(0, start)}${translated}${value.slice(start + trimmed.length)}`;
}

function localizeNode(node: Node, language: Language) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent;
    if (text) {
      const next = translateExact(text, language);
      if (next !== text) node.textContent = next;
    }
    return;
  }

  if (!(node instanceof HTMLElement)) return;
  if (node.matches("script, style, [data-no-auto-localize='true']")) return;

  for (const attr of LOCALIZABLE_ATTRIBUTES) {
    const value = node.getAttribute(attr);
    if (!value) continue;
    const next = translateExact(value, language);
    if (next !== value) node.setAttribute(attr, next);
  }

  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let textNode: Node | null = walker.nextNode();
  while (textNode) {
    const parent = textNode.parentElement;
    if (!parent?.closest("[data-no-auto-localize='true'], script, style")) {
      const text = textNode.textContent;
      if (text) {
        const next = translateExact(text, language);
        if (next !== text) textNode.textContent = next;
      }
    }
    textNode = walker.nextNode();
  }

  node.querySelectorAll<HTMLElement>("[placeholder], [title], [aria-label]").forEach((el) => {
    if (el.closest("[data-no-auto-localize='true']")) return;
    for (const attr of LOCALIZABLE_ATTRIBUTES) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const next = translateExact(value, language);
      if (next !== value) el.setAttribute(attr, next);
    }
  });
}

/**
 * Enables full Arabic coverage for legacy/lazy screens without touching
 * user-generated text. Exact-match translation makes the bridge reversible and
 * safe when the language switches back to English.
 */
export function useLegacyArabicUiLocalization(language: Language) {
  useEffect(() => {
    if (typeof document === "undefined") return;

    const apply = (node: Node = document.body) => {
      if (mutationGuard) return;
      mutationGuard = true;
      try {
        localizeNode(node, language);
      } finally {
        mutationGuard = false;
      }
    };

    apply();

    const observer = new MutationObserver((mutations) => {
      if (mutationGuard) return;
      mutationGuard = true;
      try {
        for (const mutation of mutations) {
          if (mutation.type === "characterData") {
            localizeNode(mutation.target, language);
            continue;
          }
          if (mutation.type === "attributes") {
            localizeNode(mutation.target, language);
            continue;
          }
          mutation.addedNodes.forEach((node) => localizeNode(node, language));
        }
      } finally {
        mutationGuard = false;
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...LOCALIZABLE_ATTRIBUTES],
    });

    return () => observer.disconnect();
  }, [language]);
}
