import React, { memo, useLayoutEffect, useRef, type ComponentType } from "react";
import {
  BookOpen,
  CheckSquare2,
  ChevronLeft,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  FileText,
  Stethoscope,
  Target,
  Users,
} from "lucide-react";
import type { Subject, SubjectId } from "../../../core/types";
import { getSubjectIconInfo } from "../../../core/utils/subjectIcons";

import { MODULE_VISUALS } from "../moduleVisuals";

interface ModulePlaceholderViewProps {
  subject: Subject;
  onBack: () => void;
  language: "en" | "ar";
}

type SmallIcon = ComponentType<{ className?: string }>;

type AssessmentTone = "violet" | "emerald" | "rose" | "amber" | "blue" | "cyan";

interface AssessmentItem {
  label: string;
  marks: number;
  icon: SmallIcon;
  tone: AssessmentTone;
}

interface LearningHourItem {
  label: string;
  value: string;
}

interface ModuleDetailConfig {
  title: string;
  image: string;
  placeholder: string;
  accent: string;
  accentRgb: string;
  intro: string[];
  assessments: AssessmentItem[];
  learningHours: LearningHourItem[];
  finalGoal: string;
}

function moduleIdentity(subjectId: SubjectId): Pick<ModuleDetailConfig, "image" | "placeholder" | "accent" | "accentRgb"> {
  const { image, placeholder, accent, accentRgb } = MODULE_VISUALS[subjectId];
  return { image, placeholder, accent, accentRgb };
}

const MODULE_DETAILS: Record<SubjectId, ModuleDetailConfig> = {
  CA: {
    title: "Clinical Attachment",
    ...moduleIdentity("CA"),
    intro: [
      "يُعد Clinical Attachments Module (CA) من أهم موديولات السنة الثالثة، لأنه يمثل الانتقال الفعلي من الدراسة النظرية إلى التطبيق السريري والتعامل المباشر مع المرضى. يهدف الموديول إلى تطوير قدرة الطالب على التعامل مع المريض بصورة مهنية ومنظمة، بدءاً من أخذ History بشكل صحيح، مروراً بإجراء Physical Examination، ووصولاً إلى تكوين تصور سريري أولي عن حالة المريض.",
      "خلال هذا الموديول، يبدأ الطالب بتطبيق المهارات التي تعلمها في السنوات السابقة داخل بيئة سريرية حقيقية، خصوصاً في أقسام Medicine وSurgery. كما يتدرب على كيفية التواصل مع المرضى وعائلاتهم، واحترام خصوصيتهم، وتطبيق مبادئ Medical Ethics أثناء التعامل معهم.",
      "ولا يقتصر الموديول على المعرفة النظرية، بل يتضمن تدريباً عملياً في المستشفى والـ Skill Lab، حيث يتعلم الطالب مجموعة من Clinical Skills والإجراءات الأساسية التي يحتاجها في المراحل السريرية القادمة. كما يتم توثيق جزء من تدريبه وخبرته السريرية من خلال الـ Log Book.",
    ],
    assessments: [
      { label: "Attendance & Participation", marks: 10, icon: Users, tone: "violet" },
      { label: "History Taking", marks: 10, icon: ClipboardCheck, tone: "emerald" },
      { label: "Focused History", marks: 5, icon: FileText, tone: "rose" },
      { label: "OSCE", marks: 40, icon: Users, tone: "amber" },
      { label: "MCQ Exam", marks: 30, icon: CheckSquare2, tone: "blue" },
      { label: "Practicing / Clinical Skills", marks: 5, icon: Stethoscope, tone: "cyan" },
    ],
    learningHours: [
      { label: "LGT", value: "16 h" },
      { label: "Clinical / Practical", value: "128 h" },
      { label: "Skills", value: "44 h" },
      { label: "TBL", value: "39 h" },
      { label: "SSS", value: "37 h" },
      { label: "Semester", value: "1 and 2" },
    ],
    finalGoal: "إعداد الطالب ليكون أكثر قدرة على التعامل مع المرضى وفهم المشكلات السريرية، وتطوير مهارات History Taking، Physical Examination، Communication والتفكير السريري استعداداً للمراحل السريرية المتقدمة.",
  },
  ID: {
    title: "Infectious Diseases",
    ...moduleIdentity("ID"),
    intro: [
      "يركز Infectious Diseases Module (ID) على دراسة الأمراض الناتجة عن العدوى وفهمها من منظور متكامل يجمع بين الجانب Microbiological والجانب السريري. يتعلم الطالب كيفية التعرف على أهم الـ Microorganisms المسببة للأمراض، وفهم كيفية انتقالها إلى الإنسان والآليات التي تؤدي من خلالها إلى حدوث المرض.",
      "يتناول الموديول العلاقة بين العامل المسبب والـ Host، مع دراسة الـ Pathogenesis والتغيرات التي تحدث داخل الجسم نتيجة العدوى، بالإضافة إلى التعرف على أهم Clinical Manifestations والعلامات والأعراض التي قد تظهر على المرضى.",
      "كما يتعلم الطالب كيفية اختيار وفهم الفحوصات المناسبة لتشخيص الأمراض المعدية من خلال Microbiological Investigation، وكيفية تفسير النتائج وربطها بالحالة السريرية. ويشمل الموديول أيضاً المبادئ الأساسية للعلاج، بما في ذلك العلاج الداعم والعلاج الموجه ضد العامل المسبب.",
    ],
    assessments: [
      { label: "Attendance & Participation", marks: 10, icon: Users, tone: "violet" },
      { label: "Mid-module Exam", marks: 20, icon: ClipboardCheck, tone: "emerald" },
      { label: "End Semester Exam", marks: 60, icon: FileText, tone: "amber" },
      { label: "Practical / Clinical", marks: 10, icon: Stethoscope, tone: "blue" },
    ],
    learningHours: [
      { label: "LGT", value: "120 h" },
      { label: "Clinical / Practical", value: "36 h" },
      { label: "TBL", value: "33 h" },
      { label: "Semester", value: "1 & 2" },
    ],
    finalGoal: "إعداد الطالب لفهم الأمراض المعدية من منظور سريري وميكروبيولوجي، والقدرة على التعرف على العوامل المسببة وآليات الأمراض والفحوصات التشخيصية المناسبة، مع تفسير النتائج وربطها بالحالة السريرية وفهم المبادئ الأساسية للعلاج.",
  },
  RM: {
    title: "Research Methodology",
    ...moduleIdentity("RM"),
    intro: [
      "يهدف Research Methodology Module (RM) إلى تعريف طالب الطب بالأسس العلمية التي يعتمد عليها إجراء Medical Research، وإعطائه المعرفة والمهارات الأولية التي يحتاجها حتى يتمكن من قراءة الأبحاث العلمية وفهمها والمشاركة في إعداد وتنفيذ Research Project.",
      "يتعلم الطالب خلال الموديول كيفية التفكير بطريقة علمية ومنظمة عند التعامل مع مشكلة أو سؤال طبي، وكيفية تحديد Research Question وصياغة أهداف البحث، واختيار الطريقة المناسبة لدراسة المشكلة وجمع المعلومات والبيانات المتعلقة بها.",
      "كما يركز الموديول على المبادئ الأساسية المستخدمة في Biomedical Research، وكيفية تنظيم المعلومات والبيانات وكتابة البحث بطريقة علمية، إضافةً إلى التعرف على المراحل المختلفة التي يمر بها البحث منذ تحديد المشكلة وحتى الوصول إلى النتائج وكتابة التقرير النهائي.",
      "تكمن أهمية هذا الموديول في أنه لا يهدف فقط إلى النجاح في المادة، وإنما يهيئ الطالب للمشاركة في Research Project الذي يبدأ العمل عليه بعد انتهاء الموديول ويستمر خلال السنة الثالثة والسنة الرابعة، مما يساعده على بناء أساس جيد في البحث العلمي والتفكير النقدي.",
    ],
    assessments: [
      { label: "Attendance & Participation", marks: 10, icon: Users, tone: "violet" },
      { label: "Mid-module Exam", marks: 20, icon: ClipboardCheck, tone: "cyan" },
      { label: "End Semester Exam", marks: 70, icon: FileText, tone: "blue" },
    ],
    learningHours: [
      { label: "LGT", value: "22 h" },
      { label: "TBL", value: "54 h" },
      { label: "Semester", value: "1" },
    ],
    finalGoal: "إعداد الطالب لفهم البحث الطبي، وصياغة الأسئلة البحثية، وتحليل المعلومات بشكل نقدي، والمشاركة في المشاريع البحثية، وبناء أساس قوي في التفكير العلمي والعمل القائم على الأدلة.",
  },
  NT: {
    title: "Nutrition",
    ...moduleIdentity("NT"),
    intro: [
      "يركز Nutrition, Water & Electrolytes Imbalance Module (NT) على فهم العلاقة بين التغذية وصحة الإنسان، إضافةً إلى دراسة التوازن الطبيعي للسوائل والـ Electrolytes داخل الجسم والاضطرابات التي تحدث عند اختلال هذا التوازن.",
      "يبدأ الموديول بدراسة Nutrition والـ Essential Nutrients ودور كل منها في الحفاظ على وظائف الجسم الطبيعية، ثم ينتقل إلى دراسة الاضطرابات الناتجة عن نقص أو زيادة بعض العناصر الغذائية وتأثيرها على صحة الإنسان.",
      "كما يتناول الموديول أساسيات Body Fluid Compartments وتنظيم الماء داخل الجسم، والـ Osmosis، Osmolarity، Osmotic Pressure، وكيفية المحافظة على التوازن بين الـ Intracellular Fluid والـ Extracellular Fluid.",
      "ومن الجوانب المهمة في الموديول دراسة اضطرابات الـ Electrolytes والـ Acid-Base Balance وكيفية تقييمها سريرياً، بالإضافة إلى فهم الحالات التي تؤدي إلى فقدان السوائل مثل Hypovolemia وHemorrhage وطرق التعامل معها بصورة أساسية.",
      "لذلك يجمع الموديول بين Physiology والجانب السريري، ويساعد الطالب على فهم العديد من الحالات الشائعة التي قد يواجهها مستقبلاً في المستشفى.",
    ],
    assessments: [
      { label: "Attendance & Participation", marks: 10, icon: Users, tone: "emerald" },
      { label: "Mid-module Exam", marks: 20, icon: ClipboardCheck, tone: "cyan" },
      { label: "End Semester Exam", marks: 70, icon: FileText, tone: "amber" },
    ],
    learningHours: [
      { label: "LGT", value: "37 h" },
      { label: "Practical", value: "3 h" },
      { label: "TBL", value: "12 h" },
      { label: "SSS / Electronic Lectures", value: "8 h" },
      { label: "Semester", value: "1" },
    ],
    finalGoal: "إعداد الطالب لفهم أساسيات التغذية، وتوازن الماء والكهارل، واضطرابات الـ Acid-Base Balance، وربط هذه المفاهيم بالحالات السريرية الشائعة لتكوين أساس علمي وسريري قوي.",
  },
  ImD: {
    title: "Immune Disturbances",
    ...moduleIdentity("ImD"),
    intro: [
      "يتناول Immune Disturbances Module (ImD) الاضطرابات والحالات المرضية الناتجة عن خلل في عمل الجهاز المناعي، ويساعد الطالب على فهم كيفية استجابة الجهاز المناعي للمرض وكيف يمكن أن تتحول هذه الاستجابة إلى سبب للمرض بدلاً من أن تكون وسيلة للحماية.",
      "يبدأ الموديول بدراسة Inflammation، مع التمييز بين Acute وChronic Inflammation وفهم الآليات الأساسية التي تؤدي إلى حدوثهما وتأثيرهما على الأنسجة.",
      "كما يركز على Immunodeficiency، حيث يتعرف الطالب على الحالات التي يكون فيها الجهاز المناعي غير قادر على أداء وظائفه بصورة طبيعية، وما قد ينتج عنها من زيادة القابلية للإصابة بالعدوى.",
      "ومن المواضيع المهمة أيضاً Autoimmune Diseases، حيث يتعلم الطالب كيفية حدوث فقدان الـ immune tolerance والعوامل التي قد تساهم في ظهور أمراض المناعة الذاتية، مع التعرف على تصنيفاتها وأهم مظاهرها السريرية والـ Immune-pathogenesis الخاصة بها.",
      "ويتضمن الموديول كذلك دراسة Transplant Rejection والآليات المناعية التي تؤدي إلى رفض الأعضاء المزروعة، إضافةً إلى التعرف على Immunosuppressants وكيفية استخدامها، وفهم وتفسير بعض Immunology Laboratory Reports.",
    ],
    assessments: [
      { label: "Attendance & Participation", marks: 10, icon: Users, tone: "violet" },
      { label: "Mid-module Exam", marks: 20, icon: ClipboardCheck, tone: "blue" },
      { label: "End Semester Exam", marks: 70, icon: FileText, tone: "violet" },
    ],
    learningHours: [
      { label: "LGT", value: "22 h" },
      { label: "TBL", value: "12 h" },
      { label: "Semester", value: "2" },
    ],
    finalGoal: "إعداد الطالب لفهم الاضطرابات المناعية والالتهابية من منظور سريري ومناعي متكامل، والتعرف على آليات الالتهاب ونقص المناعة وأمراض المناعة الذاتية ورفض الزرع، مع فهم دور العلاجات المثبطة للمناعة.",
  },
  PHC: {
    title: "Public Health Care",
    ...moduleIdentity("PHC"),
    intro: [
      "يركز Primary Health Care Module (PHC) على مفهوم الرعاية الصحية الأولية ودورها في الحفاظ على صحة الفرد والمجتمع، مع توسيع نظرة طالب الطب من علاج المرض فقط إلى الوقاية منه وتعزيز الصحة وتقليل عوامل الخطورة.",
      "يتعرف الطالب على المبادئ الأساسية للـ Primary Health Care وكيفية تقديم الرعاية الصحية على مستوى المجتمع، إضافةً إلى فهم دور الطبيب في الوقاية والكشف المبكر عن الأمراض ومتابعة المرضى بصورة مستمرة.",
      "كما يتناول الموديول مفهوم Family Medicine وأهمية التعامل مع المريض ضمن إطار الأسرة والمجتمع، وليس باعتباره حالة مرضية منفصلة فقط. ويتطرق أيضاً إلى Mental Health وتأثير العوامل النفسية والاجتماعية على صحة الإنسان.",
      "بالإضافة إلى ذلك، يدرس الطالب مبادئ Social Medicine وHealth Administration، مما يساعده على فهم كيفية تنظيم الخدمات الصحية والعوامل الاجتماعية التي يمكن أن تؤثر على صحة الأفراد والمجتمعات.",
      "وبذلك يمنح الموديول الطالب رؤية أوسع لدور الطبيب، بحيث لا يقتصر دوره على تشخيص وعلاج المرض، وإنما يشمل أيضاً الوقاية والتثقيف الصحي وتحسين صحة المجتمع.",
    ],
    assessments: [
      { label: "Attendance & Participation", marks: 10, icon: Users, tone: "amber" },
      { label: "Mid-module Exam", marks: 20, icon: ClipboardCheck, tone: "amber" },
      { label: "End Semester Exam", marks: 70, icon: FileText, tone: "amber" },
    ],
    learningHours: [
      { label: "LGT", value: "35 h" },
      { label: "TBL", value: "15 h" },
      { label: "Seminars", value: "6 h" },
      { label: "SSS / Electronic Lectures", value: "3 h" },
      { label: "Semester", value: "2" },
    ],
    finalGoal: "إعداد الطالب لفهم دور الرعاية الصحية الأولية في الوقاية من المرض وتعزيز الصحة، وتطوير نظرته إلى المريض ضمن إطار الأسرة والمجتمع، مع اكتساب أساس جيد في الصحة النفسية والطب الاجتماعي وإدارة الخدمات الصحية.",
  },
  SSC: {
    title: "Student Selected Components",
    ...moduleIdentity("SSC"),
    intro: [
      "يمثل Student Selected Components (SSC-3) جزءاً مختلفاً عن الموديولات التقليدية، لأنه يعطي الطالب مساحة أكبر للتعلم المستقل واختيار نشاط أو موضوع علمي والعمل عليه بصورة أكثر استقلالية.",
      "يهدف هذا الجزء إلى تطوير مهارات الطالب في Self-Directed Learning والبحث عن المعلومات من مصادر مختلفة، وتنظيمها وتحويلها إلى عمل أو تقرير علمي منظم.",
      "يمكن أن يتضمن العمل إعداد Report، كتابة Reflection، جمع المعلومات أو البيانات، أو المشاركة في Small Survey أو نشاط أكاديمي مشابه. ويُطلب من الطالب التعامل مع المهمة بصورة أكثر استقلالية، مع الالتزام بالمتطلبات المحددة للمشروع.",
      "أهمية الـ SSC لا تقتصر على المحتوى الذي يختاره الطالب، وإنما تكمن أيضاً في تطوير مهارات مهمة للطبيب مثل البحث عن المعلومات، تقييمها، تنظيمها، الكتابة العلمية، وتحمل مسؤولية التعلم الشخصي. ويُعد إكمال الـ SSC جزءاً إلزامياً من متطلبات السنة الثالثة.",
    ],
    assessments: [
      { label: "Checklist Submission", marks: 30, icon: ClipboardCheck, tone: "violet" },
      { label: "Final Written Exam / Article submission", marks: 70, icon: FileCheck2, tone: "rose" },
    ],
    learningHours: [
      { label: "LGT", value: "2 h" },
      { label: "TBL", value: "6 h" },
      { label: "SSS / Practical", value: "22 h" },
      { label: "Semester", value: "2" },
    ],
    finalGoal: "تطوير مهارات التعلم المستقل والبحث والكتابة العلمية وتحمل المسؤولية الأكاديمية، من خلال إنجاز مشروع أو نشاط علمي يختاره الطالب ويعمل عليه باستقلالية وفق المتطلبات المحددة.",
  },
};

const TONE_STYLES: Record<AssessmentTone, { rgb: string; text: string }> = {
  violet: { rgb: "139,92,246", text: "#A78BFA" },
  emerald: { rgb: "34,197,94", text: "#4ADE80" },
  rose: { rgb: "244,63,94", text: "#FB7185" },
  amber: { rgb: "245,158,11", text: "#FBBF24" },
  blue: { rgb: "59,130,246", text: "#60A5FA" },
  cyan: { rgb: "6,182,212", text: "#22D3EE" },
};

function SectionHeading({ icon: Icon, title, accent, accentRgb }: { icon: SmallIcon; title: string; accent: string; accentRgb: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border"
        style={{
          color: accent,
          borderColor: `rgba(${accentRgb},0.2)`,
          backgroundColor: `rgba(${accentRgb},0.10)`,
        }}
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-neutral-950 dark:text-white">{title}</h2>
    </div>
  );
}

function AssessmentCard({ item }: { item: AssessmentItem }) {
  const tone = TONE_STYLES[item.tone];
  const Icon = item.icon;

  return (
    <div
      className="relative flex min-h-[124px] min-w-0 items-center gap-4 overflow-hidden rounded-[20px] border px-4 py-4 shadow-[0_8px_24px_rgba(15,23,42,0.055)] dark:shadow-none sm:min-h-[146px] sm:rounded-[18px] sm:px-5 sm:py-5 sm:flex-col sm:justify-center sm:text-center"
      style={{ borderColor: `rgba(${tone.rgb},0.25)` }}
    >
      <div className="absolute inset-0 bg-[#FCFDFE] dark:bg-[#111317] sm:bg-white" />
      <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, rgba(${tone.rgb},0.14), rgba(${tone.rgb},0.025) 62%)` }} />
      <span
        className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border"
        style={{ color: tone.text, borderColor: `rgba(${tone.rgb},0.25)`, backgroundColor: `rgba(${tone.rgb},0.12)` }}
      >
        <Icon className="h-[22px] w-[22px]" />
      </span>
      <div className="relative min-w-0">
        <div className="text-[15px] font-semibold leading-[1.25] text-neutral-900 dark:text-white sm:text-[16px]">{item.label}</div>
        <div className="mt-2 text-[15px] font-semibold" style={{ color: tone.text }}>{item.marks} marks</div>
      </div>
    </div>
  );
}

export const ModulePlaceholderView = memo(function ModulePlaceholderView({ subject, onBack, language }: ModulePlaceholderViewProps) {
  const config = MODULE_DETAILS[subject.id];
  const iconInfo = getSubjectIconInfo(subject.id);
  const SubjectIcon = iconInfo.icon;
  const rootRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof window === "undefined") return;

    // Module details are rendered inside the existing app shell rather than on a
    // dedicated browser route. Reset the actual scrolling container synchronously
    // so a module always opens from its header instead of inheriting the scroll
    // position from the Modules grid (especially visible on iPhone/iPad).
    let parent: HTMLElement | null = root.parentElement;
    while (parent) {
      const { overflowY } = window.getComputedStyle(parent);
      const isScrollable = /(auto|scroll|overlay)/.test(overflowY) && parent.scrollHeight > parent.clientHeight + 1;
      if (isScrollable) {
        parent.scrollTop = 0;
        break;
      }
      parent = parent.parentElement;
    }

    const scrollingElement = document.scrollingElement;
    if (scrollingElement) scrollingElement.scrollTop = 0;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [subject.id]);

  return (
    <section
      ref={rootRef}
      className="w-full bg-[#F5F7FA] px-2 pb-6 pt-3 dark:bg-transparent sm:bg-transparent sm:px-0 sm:pb-8 sm:pt-2"
      aria-label={`${config.title} module overview`}
    >
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 rounded-xl bg-white/80 px-2 py-1.5 text-[15px] font-medium shadow-[0_1px_0_rgba(15,23,42,0.04)] active:opacity-60 dark:bg-transparent dark:shadow-none sm:mb-5 sm:bg-transparent sm:px-1 sm:py-1 sm:shadow-none"
        style={{ color: config.accent }}
      >
        <ChevronLeft className="h-5 w-5" />
        {language === "ar" ? "رجوع" : "Back"}
      </button>

      <header className="mb-5 flex items-center gap-3 px-1 sm:mb-6 sm:gap-4 sm:px-0">
        <div
          className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-[17px] border shadow-[0_8px_22px_rgba(15,23,42,0.05)] dark:shadow-none sm:h-[58px] sm:w-[58px] sm:rounded-[18px]"
          style={{
            color: config.accent,
            borderColor: `rgba(${config.accentRgb},0.32)`,
            background: `linear-gradient(145deg, rgba(${config.accentRgb},0.18), rgba(${config.accentRgb},0.06))`,
            boxShadow: `0 12px 30px rgba(${config.accentRgb},0.08)`,
          }}
        >
          <SubjectIcon className="h-7 w-7" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500 dark:text-neutral-400">{subject.id} Module</div>
          <h1 className="mt-1 break-words text-[28px] font-display font-semibold leading-[1.08] tracking-[-0.03em] text-neutral-950 dark:text-white sm:text-[38px] sm:leading-[1.05]">
            {config.title}
          </h1>
        </div>
      </header>

      <div className="space-y-3.5 sm:space-y-5">
        <section className="relative overflow-hidden rounded-[22px] border border-black/[0.055] bg-[#FCFDFE] shadow-[0_12px_30px_rgba(15,23,42,0.07)] dark:border-white/[0.075] dark:bg-[#0B0D10] dark:shadow-none sm:rounded-[24px] sm:border-black/[0.07] sm:bg-white sm:shadow-[0_10px_30px_rgba(15,23,42,0.035)]">
          <div className="pointer-events-none absolute inset-0 dark:hidden sm:hidden" style={{ background: `radial-gradient(circle at 90% 0%, rgba(${config.accentRgb},0.075), transparent 42%)` }} />
          <div className="grid grid-cols-1 lg:grid-cols-[1.12fr_0.88fr]">
            <div className="relative p-[18px] sm:p-7 lg:p-8" dir="rtl">
              <SectionHeading icon={BookOpen} title="مقدمة الموديول" accent={config.accent} accentRgb={config.accentRgb} />
              <div className="space-y-4 text-right text-[14px] font-medium leading-[1.95] text-neutral-600 dark:text-[#D4D4D8] sm:text-[15px]">
                {config.intro.map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>
            </div>

            <div
              className="relative min-h-[230px] overflow-hidden border-t border-black/[0.05] bg-[#E9EEF3] lg:min-h-full lg:border-l lg:border-t-0 dark:border-white/[0.07] dark:bg-[#101215] sm:min-h-[260px]"
              style={{
                backgroundImage: `url(${JSON.stringify(config.placeholder)})`,
                backgroundPosition: "center",
                backgroundSize: "cover",
              }}
            >
              <img
                src={config.image}
                alt=""
                loading="eager"
                decoding="async"
                fetchPriority="high"
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/28 via-transparent to-black/5" />
              <div
                className="absolute bottom-4 right-4 flex h-11 w-11 items-center justify-center rounded-full border backdrop-blur-md"
                style={{ color: config.accent, borderColor: `rgba(${config.accentRgb},0.35)`, backgroundColor: `rgba(6,8,12,0.58)` }}
              >
                <SubjectIcon className="h-5 w-5" />
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[22px] border border-black/[0.055] bg-[#FCFDFE] p-4 shadow-[0_12px_30px_rgba(15,23,42,0.065)] dark:border-white/[0.075] dark:bg-[#0B0D10] dark:shadow-none sm:rounded-[24px] sm:border-black/[0.07] sm:bg-white sm:p-5 sm:shadow-[0_10px_30px_rgba(15,23,42,0.035)]">
          <SectionHeading icon={Clock3} title="تقسيم الدرجات" accent={config.accent} accentRgb={config.accentRgb} />
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
            {config.assessments.map((item) => <AssessmentCard key={item.label} item={item} />)}
          </div>
        </section>

        <div className="grid grid-cols-1 gap-3.5 sm:gap-5 lg:grid-cols-2">
          <section className="relative overflow-hidden rounded-[22px] border border-black/[0.055] bg-[#FCFDFE] p-[18px] shadow-[0_12px_30px_rgba(15,23,42,0.065)] dark:border-white/[0.075] dark:bg-[#0B0D10] dark:shadow-none sm:rounded-[24px] sm:border-black/[0.07] sm:bg-white sm:p-6 sm:shadow-[0_10px_30px_rgba(15,23,42,0.035)]" dir="rtl">
            <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle at 90% 120%, rgba(${config.accentRgb},0.11), transparent 38%)` }} />
            <div className="relative">
              <SectionHeading icon={Target} title="الهدف النهائي" accent={config.accent} accentRgb={config.accentRgb} />
              <p className="text-right text-[14px] font-medium leading-[1.9] text-neutral-600 dark:text-[#D4D4D8] sm:text-[15px]">{config.finalGoal}</p>
            </div>
          </section>

          <section className="relative overflow-hidden rounded-[22px] border border-black/[0.055] bg-[#FCFDFE] p-[18px] shadow-[0_12px_30px_rgba(15,23,42,0.065)] dark:border-white/[0.075] dark:bg-[#0B0D10] dark:shadow-none sm:rounded-[24px] sm:border-black/[0.07] sm:bg-white sm:p-6 sm:shadow-[0_10px_30px_rgba(15,23,42,0.035)]">
            <div className="pointer-events-none absolute inset-0" style={{ background: `linear-gradient(135deg, rgba(${config.accentRgb},0.10), transparent 54%)` }} />
            <div className="relative">
              <SectionHeading icon={Clock3} title="Learning Hours" accent={config.accent} accentRgb={config.accentRgb} />
              <div className="space-y-2.5">
                {config.learningHours.map((item, index) => (
                  <div key={item.label} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 text-[14px] sm:text-[15px]">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: index % 2 === 0 ? config.accent : `rgba(${config.accentRgb},0.65)` }} />
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="whitespace-nowrap font-medium text-neutral-700 dark:text-[#E4E4E7]">{item.label}</span>
                      <span className="h-px min-w-[24px] flex-1 border-t border-dotted border-neutral-300 dark:border-white/20" />
                    </div>
                    <span className="whitespace-nowrap font-semibold text-neutral-900 dark:text-white">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
});

export default ModulePlaceholderView;
