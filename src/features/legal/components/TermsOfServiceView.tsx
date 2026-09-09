import React, { memo } from "react";
import { useReliableLegalScroll } from "../useReliableLegalScroll";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import type { Language } from "../../../core/i18n/translations";

interface TermsOfServiceViewProps { onBack: () => void; language?: Language; }
const TermsOfServiceView = ({ onBack, language = "en" }: TermsOfServiceViewProps) => {
  const scrollRef = useReliableLegalScroll();
  const ar = language === "ar";
  const BackIcon = ar ? ChevronRight : ChevronLeft;
  const sections = ar ? [
    ["قبول الشروط", "باستخدام دليل 99 أو الوصول إليه، فإنك توافق على شروط الخدمة هذه. إذا لم توافق عليها، فيجب التوقف عن استخدام التطبيق."],
    ["الغرض التعليمي", "هذا التطبيق مخصص للأغراض الأكاديمية والتعليمية فقط، ويهدف إلى مساعدة الطلبة على تنظيم المواد الدراسية ومراجعتها وتعلمها."],
    ["مسؤوليات المستخدم واستخدام الحساب", "أنت مسؤول عن الحفاظ على سرية بيانات حسابك، وتوافق على استخدام الخدمة بصورة قانونية وعدم نشر محتوى ضار أو انتهاك حقوق النشر أو مضايقة المستخدمين الآخرين."],
    ["الأنشطة المحظورة", "يُحظر محاولة الوصول غير المصرح به إلى بنية التطبيق أو جمع البيانات آليًا بصورة مخالفة أو نشر مواد غير قانونية أو مسيئة. وقد تؤدي المخالفات الجسيمة إلى إيقاف الحساب."],
    ["الملكية الفكرية", "تصميمات المنصة الأصلية وبنيتها البرمجية وشيفرتها المصدرية ملك لدليل 99. أما المحتوى الذي يرفعه المستخدمون فتظل ملكيته لأصحابه."],
    ["إخلاء مسؤولية التعليم الطبي", "رغم احتواء المنصة على موارد للتعليم الطبي، فهي ليست أداة تشخيص. لا يجوز استخدام المحتوى لعلاج المرضى أو لاتخاذ قرارات سريرية."],
    ["حدود المسؤولية وتوفر الخدمة", "تُقدم الخدمة كما هي دون ضمان استمراريتها دون انقطاع. لا نتحمل مسؤولية النتائج الأكاديمية أو فقدان البيانات الناتج عن عوامل خارجة عن السيطرة، ونحتفظ بحق تطوير الخدمة أو تعديلها عند الحاجة."],
    ["تغييرات الشروط والتواصل", "قد نحدّث هذه الشروط دوريًا. استمرار استخدام التطبيق يعني قبول الشروط المحدثة. للاستفسارات القانونية تواصل معنا عبر 99sguide.support@gmail.com."],
  ] : [
    ["Acceptance of Terms", "By accessing or using 99's Guide, you agree to be bound by these Terms of Service. If you do not agree, you must cease use of the application."],
    ["Educational Purpose", "This application is built strictly for academic and educational purposes. It is a study tool designed for students to organize, review, and learn academic materials."],
    ["User Responsibilities & Account Usage", "You are responsible for maintaining the confidentiality of your account credentials. You agree to use the service legally and not to distribute malicious content, violate copyrights, or harass other users."],
    ["Prohibited Activities", "Unauthorized access attempts, abusive automated data collection, or distribution of illegal or offensive materials are prohibited and may result in account suspension."],
    ["Intellectual Property", "All original platform designs, software architecture, and source code are the intellectual property of 99's Guide. Content uploaded by users remains the intellectual property of its respective owners."],
    ["Medical Education Disclaimer", "Despite containing medical education resources, this platform is not a diagnostic tool. The content within must not be used to treat patients or make clinical decisions."],
    ["Limitation of Liability & Service Availability", "The service is provided as is. We are not liable for academic outcomes or interruptions outside our reasonable control, and we may improve or modify the service when necessary."],
    ["Changes to Terms & Contact Information", "We may update these terms periodically. Continued use of the application constitutes acceptance of updated terms. For legal inquiries, contact 99sguide.support@gmail.com."],
  ];
  return <div ref={scrollRef} dir={ar ? "rtl" : "ltr"} className="legal-page-scroll h-full w-full bg-[#F8F9FC] dark:bg-[#000000] overflow-y-auto" style={{WebkitOverflowScrolling:"touch",overscrollBehaviorY:"contain",touchAction:"pan-y"}}>
    <div className="legal-page-header sticky top-0 z-40 bg-white/90 dark:bg-[#1C1C1E]/92 backdrop-blur-md border-b border-black/5 dark:border-white/[0.12] px-4 py-3 flex items-center shadow-sm"><button onClick={onBack} aria-label={ar?"رجوع":"Back"} className={`${ar?"-mr-2":"-ml-2"} p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-white/10 text-neutral-600 dark:text-neutral-300`}><BackIcon className="w-6 h-6"/></button><h1 className={`${ar?"mr-2":"ml-2"} text-lg font-semibold text-neutral-900 dark:text-white flex items-center gap-2`}><FileText className="w-5 h-5 text-indigo-500"/>{ar?"شروط الخدمة":"Terms of Service"}</h1></div>
    <div className="legal-page-content max-w-2xl mx-auto px-4 py-6 text-neutral-800 dark:text-neutral-200"><section className="bg-white dark:bg-[#1C1C1E] p-6 rounded-xl border border-neutral-200/50 dark:border-white/10 shadow-sm space-y-4 text-sm leading-relaxed"><p className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">{ar?"آخر تحديث: أغسطس 2026":"Last Updated: August 2026"}</p>{sections.map(([title,body])=><React.Fragment key={title}><h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">{title}</h2><p>{body}</p></React.Fragment>)}</section></div>
  </div>;
};
export default memo(TermsOfServiceView);
