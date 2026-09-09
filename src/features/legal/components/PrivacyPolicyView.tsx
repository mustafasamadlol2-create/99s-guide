import React, { memo } from "react";
import { useReliableLegalScroll } from "../useReliableLegalScroll";
import { ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import type { Language } from "../../../core/i18n/translations";

interface PrivacyPolicyViewProps {
  onBack: () => void;
  language?: Language;
}

const PrivacyPolicyView = ({ onBack, language = "en" }: PrivacyPolicyViewProps) => {
  const scrollRef = useReliableLegalScroll();
  const ar = language === "ar";
  const BackIcon = ar ? ChevronRight : ChevronLeft;

  const sections = ar
    ? [
        ["جمع البيانات", "نجمع فقط البيانات اللازمة لتقديم خدماتنا التعليمية: الاسم الكامل، البريد الإلكتروني، المجموعة الدراسية (A–E)، ومعلومات الحساب التي تقدمها. ولتشغيل لوحة المتابعة الشخصية، نخزن أيضًا نشاط الدراسة مثل تقدم المحاضرات ونتائج الاختبارات ومراجعات البطاقات التعليمية والنقاط وسلسلة أيام الدراسة ووقت الدراسة وأحداث التقويم التي تنشئها، إضافة إلى الأسئلة والإجابات والتصويتات التي تنشرها في مجتمع الدراسة. تُستخدم هذه البيانات حصريًا لميزات التطبيق التعليمية ولا تُباع أو تُشارك مع جهات تسويقية خارجية."],
        ["المصادقة وتسجيل الدخول", "يقتصر الوصول على طلبة كلية الطب بجامعة بغداد والحسابات التي يعتمدها مشغّل التطبيق صراحةً، مثل حسابات مراجعة متجر التطبيقات. عند تسجيل الدخول باستخدام Google نستلم فقط معلومات الملف الأساسية التي توافق على مشاركتها، مثل الاسم والبريد الإلكتروني والصورة. لا نستلم كلمة مرور Google ولا نخزنها، ونلتزم بمتطلبات Google OAuth. أما كلمات المرور المنشأة داخل التطبيق فتُحفظ بعد تشفيرها بخوارزمية تجزئة أحادية الاتجاه قوية."],
        ["البيانات المخزنة والملفات المرفوعة", "تُخزن المواد الأكاديمية المشتركة على المنصة بصورة آمنة وتُستخدم فقط لتقديم المحتوى التعليمي داخل التطبيق. تبقى ملكية المحتوى الذي تنشره لك أو لصاحبه، ولا نستخدمه لأغراض خارجية غير مصرح بها أو لوساطة البيانات."],
        ["ملفات تعريف الارتباط والجلسات", "نستخدم ملف جلسة أساسيًا وآمنًا من نوع httpOnly للإبقاء على تسجيل دخولك، وعددًا محدودًا من مفاتيح التخزين المحلي لحفظ تفضيلاتك والمحتوى المؤقت. لا نستخدم ملفات تتبع خارجية أو معرّفات إعلانية."],
        ["التخزين دون اتصال", "لدعم الدراسة دون اتصال، قد يخزن التطبيق محتوى المحاضرات وفهارس المواد وتقدمك محليًا على جهازك باستخدام IndexedDB والتخزين المحلي. وفي نسخة iOS الأصلية تُحفظ رموز المصادقة في التخزين الآمن للنظام والمدعوم بـKeychain. تبقى هذه البيانات على جهازك وتُزال عند حذف التطبيق أو حسابك."],
        ["الإشعارات الفورية", "بعد موافقتك، نجمع رمز إشعارات الجهاز لإرسال التنبيهات التي تختار استلامها. يمكنك تغيير إعدادات الإشعارات في أي وقت من صفحة الإعدادات، وتُحذف الرموز عند حذف حسابك."],
        ["الاستضافة وخدمات الأطراف الثالثة", "تتم استضافة خادم التطبيق وقاعدة البيانات لدى مزودات سحابية تجارية. نعتمد على خدمات خارجية بالحد الأدنى اللازم لتشغيل التطبيق، مثل Google لتسجيل الدخول وYouTube لعرض الفيديوهات وخدمة بريد إلكتروني للتحقق من الحساب واستعادة كلمة المرور. لا يحصل أي مزود إلا على البيانات اللازمة لأداء وظيفته."],
        ["الأمان", "نطبق إجراءات أمان معيارية لحماية معلوماتك، منها HTTPS وكلمات المرور المجزأة وتحديد معدل طلبات المصادقة والتحقق من المدخلات وتقييد الوصول بالبريد الجامعي. لا يوجد نظام آمن بصورة مطلقة، لكننا نعمل على حماية بياناتك من الوصول أو التعديل أو الإتلاف غير المصرح به."],
        ["الاحتفاظ بالبيانات وحذف الحساب", "نحتفظ ببياناتك ما دام حسابك فعالًا. يمكنك حذف بياناتك بالكامل في أي وقت من الإعدادات عبر قسم «منطقة الخطر»، ثم تأكيد حذف الحساب. يؤدي ذلك إلى إزالة الحساب والسجلات المرتبطة به من الخادم ومسح البيانات المحلية على جهازك."],
        ["حقوق المستخدم والتواصل", "يحق لك الوصول إلى بياناتك الشخصية وتصحيحها أو حذفها في أي وقت. للاستفسارات المتعلقة بالخصوصية يمكنك التواصل معنا عبر 99sguide.support@gmail.com."],
      ]
    : [
        ["Data Collection", "We collect only the data required to provide our educational services: your full name, email address, academic group (A–E), and the account information you provide. To power your personal dashboard we also store study activity such as lecture progress, quiz scores, flashcard reviews, academic points, streaks, study time, and calendar events you create, along with any questions, answers, or votes you post in the study community. This data is used exclusively for the educational features of the application and is never sold or shared with third-party marketers."],
        ["Authentication & Sign-In", "Access is restricted to Baghdad University Medical College students and to accounts explicitly approved by the operator (for example, app store review accounts). When you sign in with Google, we receive only the basic profile information you authorize (name, email, and avatar). We never receive or store your Google password, and we strictly follow Google OAuth requirements. Passwords created within the app are encrypted with a strong one-way hash before storage."],
        ["Stored Data & Uploaded Files", "Academic materials shared on the platform are stored securely and are used only to deliver the educational content of the application. You retain ownership of the content you post, and we do not use it for unauthorized external purposes or data brokering."],
        ["Cookies and Sessions", "We use an essential, secure (httpOnly) session cookie to keep you signed in and a small number of local-storage keys to save your preferences and cached content. We do not use third-party tracking cookies or advertising identifiers."],
        ["Offline Storage", "To support offline study, the app may store lecture content, subject catalogs, and your progress locally on your device (IndexedDB and local storage). On iOS native builds, authentication tokens are stored in the platform's secure storage (Keychain-backed). This data stays on your device and is cleared when you delete the app or your account."],
        ["Push Notifications", "With your permission, we collect a device push token so we can deliver notifications you opt into. Notification settings can be changed at any time from the Settings screen, and tokens are removed when you delete your account."],
        ["Hosting & Third-Party Services", "The application backend and database are hosted by commercial cloud providers. We rely on third parties only where needed to operate the service, such as Google for sign-in, YouTube for embedded lecture videos, and an email service for verification and password recovery. Each provider receives only the minimum data needed for its function."],
        ["Security", "We apply industry-standard measures to protect your information, including HTTPS transport, hashed passwords, rate-limiting on authentication endpoints, input validation, and an institutional email access gate. No system is completely secure, but we work to keep your data safe against unauthorized access, alteration, or destruction."],
        ["Data Retention & Account Deletion", "We retain your data for as long as your account is active. You have the right to fully erase your data at any time from the Settings screen. This permanently removes your account and associated records from the server and clears locally stored data on your device."],
        ["User Rights & Contact", "You have the right to access, rectify, or erase your personal data at any time. For privacy-related inquiries, please contact us at 99sguide.support@gmail.com."],
      ];

  return (
    <div ref={scrollRef} dir={ar ? "rtl" : "ltr"} className="legal-page-scroll h-full w-full bg-[#F8F9FC] dark:bg-[#000000] overflow-y-auto" style={{ WebkitOverflowScrolling: "touch", overscrollBehaviorY: "contain", touchAction: "pan-y" }}>
      <div className="legal-page-header sticky top-0 z-40 bg-white/90 dark:bg-[#1C1C1E]/92 backdrop-blur-md border-b border-black/5 dark:border-white/[0.12] px-4 py-3 flex items-center shadow-sm">
        <button onClick={onBack} aria-label={ar ? "رجوع" : "Back"} className={`${ar ? "-mr-2" : "-ml-2"} p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-white/10 transition-colors text-neutral-600 dark:text-neutral-300`}><BackIcon className="w-6 h-6" /></button>
        <h1 className={`${ar ? "mr-2" : "ml-2"} text-lg font-semibold text-neutral-900 dark:text-white flex items-center gap-2`}><ShieldCheck className="w-5 h-5 text-indigo-500" />{ar ? "سياسة الخصوصية" : "Privacy Policy"}</h1>
      </div>
      <div className="legal-page-content max-w-2xl mx-auto px-4 py-6 text-neutral-800 dark:text-neutral-200">
        <section className="bg-white dark:bg-[#1C1C1E] p-6 rounded-xl border border-neutral-200/50 dark:border-white/10 shadow-sm space-y-4 text-sm leading-relaxed">
          <p className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">{ar ? "آخر تحديث: أغسطس 2026" : "Last Updated: August 2026"}</p>
          {sections.map(([title, body]) => <React.Fragment key={title}><h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">{title}</h2><p>{body}</p></React.Fragment>)}
        </section>
      </div>
    </div>
  );
};

export default memo(PrivacyPolicyView);
