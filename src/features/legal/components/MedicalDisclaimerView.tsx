import React, { memo } from "react";
import { useReliableLegalScroll } from "../useReliableLegalScroll";
import { ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import type { Language } from "../../../core/i18n/translations";
interface MedicalDisclaimerViewProps { onBack: () => void; language?: Language; }
const MedicalDisclaimerView = ({ onBack, language="en" }: MedicalDisclaimerViewProps) => {
 const scrollRef=useReliableLegalScroll(); const ar=language==="ar"; const BackIcon=ar?ChevronRight:ChevronLeft;
 const sections=ar?[
  ["لأغراض تعليمية فقط","هذا التطبيق مخصص حصريًا للأغراض التعليمية والأكاديمية. المواد والبطاقات والملاحظات وأدوات متابعة التقدم داخله مصممة لمساعدة طلبة الطب في دراستهم."],
  ["ليس نصيحة طبية","محتوى التطبيق لا يُعد نصيحة أو تشخيصًا أو علاجًا طبيًا مهنيًا، ولا يجوز استخدامه بديلًا عن الحكم الطبي المختص."],
  ["لا يُعد بديلًا عن الطبيب","هذا البرنامج لا يحل محل استشارة الأطباء أو مقدمي الرعاية الصحية المؤهلين. يجب على المرضى الرجوع إلى طبيب مختص بشأن أي حالة صحية."],
  ["مسؤولية المستخدم","يبقى المستخدم مسؤولًا عن أي قرار أو تصرف سريري يتخذه. لا يتحمل منشئو دليل 99 أو مطوروه أو القائمون عليه مسؤولية القرارات الطبية التي يتخذها المستخدم بالاعتماد على التطبيق."],
 ]:[
  ["Educational Purposes Only","This application is intended solely for educational and academic purposes. The materials, flashcards, notes, and progress trackers are designed to assist medical students in their studies."],
  ["Not Medical Advice","The content within this application does not constitute professional medical advice, diagnosis, or treatment and must not replace professional medical judgment."],
  ["Not a Replacement for Physicians","This software is not a replacement for consultation with qualified healthcare professionals. Patients should always seek the advice of a physician regarding a medical condition."],
  ["User Responsibility","Users remain responsible for their clinical decisions and actions. The creators and maintainers of 99's Guide accept no liability for medical decisions made by users based on the application."],
 ];
 return <div ref={scrollRef} dir={ar?"rtl":"ltr"} className="legal-page-scroll h-full w-full bg-[#F8F9FC] dark:bg-[#000000] overflow-y-auto" style={{WebkitOverflowScrolling:"touch",overscrollBehaviorY:"contain",touchAction:"pan-y"}}><div className="legal-page-header sticky top-0 z-40 bg-white/90 dark:bg-[#1C1C1E]/92 backdrop-blur-md border-b border-black/5 dark:border-white/[0.12] px-4 py-3 flex items-center shadow-sm"><button onClick={onBack} aria-label={ar?"رجوع":"Back"} className={`${ar?"-mr-2":"-ml-2"} p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-white/10 text-neutral-600 dark:text-neutral-300`}><BackIcon className="w-6 h-6"/></button><h1 className={`${ar?"mr-2":"ml-2"} text-lg font-semibold text-neutral-900 dark:text-white flex items-center gap-2`}><AlertTriangle className="w-5 h-5 text-indigo-500"/>{ar?"إخلاء المسؤولية الطبية":"Medical Disclaimer"}</h1></div><div className="legal-page-content max-w-2xl mx-auto px-4 py-6 text-neutral-800 dark:text-neutral-200"><section className="bg-white dark:bg-[#1C1C1E] p-6 rounded-xl border border-neutral-200/50 dark:border-white/10 shadow-sm space-y-4 text-sm leading-relaxed"><p className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">{ar?"آخر تحديث: أغسطس 2026":"Last Updated: August 2026"}</p>{sections.map(([title,body])=><React.Fragment key={title}><h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">{title}</h2><p>{body}</p></React.Fragment>)}</section></div></div>;
};
export default memo(MedicalDisclaimerView);
