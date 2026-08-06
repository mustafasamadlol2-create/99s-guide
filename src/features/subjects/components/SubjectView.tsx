import { apiClient } from "../../../core/api/apiClient";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
} from "react";
import {
  Subject,
  Lecture,
  UserProgress,
  SubjectId,
  CalendarEvent,
} from "../../../core/types";
import {
  ArrowLeft,
  BookOpen,
  CircleCheck,
  ChevronRight,
  ChevronLeft,
  Activity,
  Book,
  Home,
  GraduationCap,
  Bug,
  Apple,
  ClipboardList,
  Hospital,
  Users,
  Presentation,
  Sparkles,
  FileText,
  HelpCircle,
  Film,
  Dna,
  ShieldPlus,
  Leaf,
  Microscope,
  Scissors,
  Heart,
  FlaskConical,
  MessageSquare,
  ClipboardCheck,
  Calendar,
  Share2,
  Copy,
  ExternalLink,
  Bookmark,
} from "lucide-react";
import { getSubjectIconInfo } from "../../../core/utils/subjectIcons";
import { Language } from "../../../core/i18n/translations";
import { motion, AnimatePresence } from "motion/react";
import { useIsTouchDevice } from "../../../core/hooks/useIsTouchDevice";
import { useDeviceProfile } from "../../../core/hooks/useDeviceProfile";
import { usePullToRefresh } from "../../../core/hooks/usePullToRefresh";
import { LectureListItem } from "../../../features/lectures/components/LectureListItem";
import { SwipeActionItem } from "../../../components/ui/SwipeActionItem";
import { ContextMenu } from "../../../components/ui/ContextMenu";
import { ListSkeleton } from "../../../components/ui/Skeleton";
import { HapticFeedback } from "../../../core/device/haptic";

// Department categories inside each Theory and Practical track
const DEPARTMENTS = [
  {
    id: "Microbiology" as const,
    name: "Microbiology",
    nameAr: "علم الأحياء الدقيقة",
    icon: Microscope,
    bg: "bg-cyan-50 dark:bg-[rgba(165,243,252,0.15)] text-cyan-600 dark:text-[rgba(165,243,252,1)]",
    badge: "MICRO",
  },
  {
    id: "Medicine" as const,
    name: "Medicine",
    nameAr: "الطب الباطني",
    icon: Hospital,
    bg: "bg-rose-50 dark:bg-[rgba(253,164,175,0.15)] text-rose-600 dark:text-[rgba(253,164,175,1)]",
    badge: "MED",
  },
  {
    id: "Community Medicine" as const,
    name: "Community Medicine",
    nameAr: "طب المجتمع",
    icon: Users,
    bg: "bg-amber-50 dark:bg-[rgba(253,230,138,0.15)] text-med-gold dark:text-[rgba(253,230,138,1)]",
    badge: "COMM",
  },
];

// Subcategory mapping for all 7 main subjects
const SUB_SUBJECT_MAP: Record<SubjectId, string[]> = {
  ID: ["Bacteriology", "Parasitology", "Virology", "Mycology"],
  NT: [],
  RM: [],
  CA: [],
  PHC: [],
  ImD: [],
  SSC: [],
};

const mapDbLectureToFrontend = (dbL: any, index: number): Lecture => ({
  id: dbL.id,
  moduleId: dbL.mainSubject + "_" + (dbL.subSubject || "general"),
  subjectId: dbL.mainSubject,
  title: dbL.name,
  doctorName: dbL.department || "Medical Staff",
  pdfUrl:
    dbL.materials?.find((m: any) => m.type.toUpperCase() === "PDF")?.fileUrlOrLink || "",
  notesPdfUrl:
    dbL.materials?.find((m: any) => m.type.toUpperCase() === "NOTE")?.fileUrlOrLink || "",
  orderNumber: index + 1,
  type: dbL.trackMode as "Theory" | "Practical",
  category: dbL.subSubject || "",
  description: "Database Registered Course Material Module.",
  pages: [],
  notesPages: [],
  isDatabaseLecture: true,
  materials: dbL.materials || [],
  mcqs: dbL.mcqs || [],
  flashcards: dbL.flashcards || [],
});

// Faculty physicians list
const getDoctorForSubject = (subjectId: SubjectId, index: number): string => {
  const doctors: Record<SubjectId, string[]> = {
    ID: [
      "Prof. Dr. Adil Al-Husaini",
      "Dr. Maysaloon Al-Raji",
      "Dr. Raed Al-Lami",
      "Dr. Jamil Al-Saeed",
    ],
    NT: [
      "Prof. Dr. Tariq Al-Safi",
      "Dr. Hiba Al-Duri",
      "Dr. Majid Al-Mawed",
      "Dr. Sana Al-Khafaji",
    ],
    RM: [
      "Dr. Fatima Abdul-Zahra",
      "Prof. Dr. Karim Jafar",
      "Dr. Layla Al-Shammari",
      "Dr. Omar Al-Tikriti",
    ],
    CA: [
      "Dr. Jafar Al-Fadhli",
      "Prof. Dr. Mazin Al-Hashimi",
      "Dr. Ali Al-Saadi",
      "Dr. Zainab Al-Rawi",
    ],
    PHC: [
      "Dr. Salma Mahmood",
      "Prof. Dr. Hasan Al-Sadr",
      "Dr. Ahmed Al-Mousawi",
      "Dr. Nadia Al-Bayaty",
    ],
    ImD: [
      "Dr. Hussain Al-Sadr",
      "Prof. Dr. Khalid Al-Obeidi",
      "Dr. Rania Al-Attar",
      "Dr. Bashir Al-Jawad",
    ],
    SSC: [
      "Prof. Dr. Mazin Al-Hashimi",
      "Dr. Mustafa Al-Rubaie",
      "Dr. Hala Al-Saadi",
      "Dr. Firas Al-Naimi",
    ],
  };
  const list = doctors[subjectId] || ["Medical Staff"];
  return list[index % list.length];
};

interface SubjectViewProps {
  isActive?: boolean;
  key?: any;
  subject: Subject;
  progress: UserProgress[];
  onBack: () => void;
  onSelectLecture: (lecture: Lecture, tab?: "pdf" | "notes" | "mcqs" | "flashcards" | "videos" | "qa") => void;
  language?: Language;
  calendarEvents?: CalendarEvent[];
  dbLectures?: any[];
  deepLinkedLecture?: any;
}

export const SubjectView = function SubjectView({
  subject,
  progress,
  onBack,
  onSelectLecture,
  language = "en",
  calendarEvents = [],
  dbLectures = [],
  deepLinkedLecture,
}: SubjectViewProps) {
  const isRtl = language === "ar";
  const isTouchDevice = useIsTouchDevice();
  const device = useDeviceProfile();

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [nativeToast, setNativeToast] = useState<{
    title: string;
    description: string;
  } | null>(null);

  const showHapticToast = useCallback((title: string, description: string) => {
    if (!isMountedRef.current) return;
    setNativeToast({ title, description });
    HapticFeedback.notification("success");
    setTimeout(() => {
      if (isMountedRef.current) {
        setNativeToast(null);
      }
    }, 2800);
  }, []);

  // Implement Pull To Refresh
  const handlePullRefresh = useCallback(async () => {
    // Simulated elite medical database resync
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (!isMountedRef.current) return;
    showHapticToast(
      isRtl ? "تم تحديث المنهج" : "Medical Registry Synced",
      isRtl
        ? "تمت مزامنة محاضر وأسئلة البورد الخاصة بك."
        : "All clinical directories, MCQ banks, and flashcard stacks synced.",
    );
  }, [isRtl, showHapticToast]);

  const { pullY, isRefreshing, containerRef } = usePullToRefresh({
    onRefresh: handlePullRefresh,
    triggerHeight: 75,
  });

  // States representing current drill down level
  const [activeSubSubject, setActiveSubSubject] = useState<string | null>(
    () => {
      if (deepLinkedLecture && deepLinkedLecture.category) {
        return deepLinkedLecture.category;
      }
      if (subject.id === "ID") {
        return null;
      }
      const items: Record<string, { en: string; ar: string }> = {
        ID: {
          en: "Infectious Diseases",
          ar: "الأمراض الانتقالية وعلم الأحياء",
        },
        NT: { en: "Clinical Nutrition", ar: "التغذية السريرية" },
        RM: {
          en: "Research Methodology & Biostatistics",
          ar: "مناهج البحث والتحليل",
        },
        CA: {
          en: "Clinical Anatomy & Bedside Clerkship",
          ar: "التشريح والتدريب السريري",
        },
        PHC: {
          en: "Primary Health Care & Preventive Medicine",
          ar: "الرعاية الصحية الأولية والوقائية",
        },
        ImD: {
          en: "Clinical Immunology & Autoimmune Diseases",
          ar: "علم المناعة السريرية والأمراض",
        },
        SSC: {
          en: "Surgical Skills & Life Support",
          ar: "المهارات الجراحية والدعم الحياتي",
        },
      };
      const activeItem = items[subject.id];
      if (activeItem) {
        return isRtl ? activeItem.ar : activeItem.en;
      }
      return isRtl ? "دراسة عامة" : "General Outline";
    },
  );
  const [activeTrack, setActiveTrack] = useState<"Theory" | "Practical" | null>(
    () => {
      if (deepLinkedLecture && deepLinkedLecture.type) {
        return deepLinkedLecture.type as any;
      }
      return null;
    },
  );
  const [activeDepartment, setActiveDepartment] = useState<string | null>(
    () => {
      if (
        deepLinkedLecture &&
        deepLinkedLecture.doctorName &&
        deepLinkedLecture.doctorName !== "Medical Staff"
      ) {
        return deepLinkedLecture.doctorName;
      }
      return null;
    },
  );

  useEffect(() => {
    if (deepLinkedLecture) {
      if (deepLinkedLecture.category)
        setActiveSubSubject(deepLinkedLecture.category);
      if (deepLinkedLecture.type) setActiveTrack(deepLinkedLecture.type as any);
      if (
        deepLinkedLecture.doctorName &&
        deepLinkedLecture.doctorName !== "Medical Staff"
      ) {
        setActiveDepartment(deepLinkedLecture.doctorName);
      } else {
        setActiveDepartment(null);
      }
    }
  }, [deepLinkedLecture]);

  // Derive lectures statically without unnecessary API fetches

  const subjectDbLectures = useMemo(() => {
    return dbLectures.filter((l: any) => l.mainSubject === subject.id);
  }, [dbLectures, subject.id]);

  // Filter subjectDbLectures to get active ones matching current selection
  const filteredDbLectures = useMemo(() => {
    if (!activeSubSubject || !activeTrack) return [];

    return subjectDbLectures.filter((dbL) => {
      // Match track (trackMode)
      let expectedTrack = activeTrack;
      if (
        activeTrack === "Practical" &&
        ["RM", "PHC", "ImD", "SSC"].includes(subject.id)
      ) {
        expectedTrack = "TBL" as any;
      }
      if (dbL.trackMode !== expectedTrack) return false;

      // Match subSubject
      const subLower = activeSubSubject.toLowerCase();
      const dbSubLower = (dbL.subSubject || "").toLowerCase();
      const isDefaultSub = subject.id !== "ID";

      if (!isDefaultSub) {
        if (dbSubLower !== subLower) return false;
      }

      // Match department
      if (activeDepartment) {
        if (dbL.department !== activeDepartment) return false;
      }

      return true;
    });
  }, [subjectDbLectures, activeSubSubject, activeTrack, activeDepartment]);

  const mappedDbLectures = useMemo(() => {
    return filteredDbLectures.map((dbL, index) =>
      mapDbLectureToFrontend(dbL, index),
    );
  }, [filteredDbLectures]);

  // Dynamically compute the departments list for the current screen
  const getDepartmentsList = useCallback((
    subSubject: string | null,
    track: "Theory" | "Practical" | null,
  ) => {
    if (!subSubject || !track) {
      return DEPARTMENTS;
    }

    // 1. NT (Clinical Nutrition)
    if (subject.id === "NT") {
      let list = DEPARTMENTS.map((dept) => {
        if (dept.id === "Microbiology") {
          return {
            id: "Biochemistery" as any,
            name: "Biochemistery",
            nameAr: "الكيمياء الحيوية السريرية",
            icon: FlaskConical,
            badge: "BIOC",
            bg: "bg-indigo-50 dark:bg-[rgba(199,210,254,0.15)] text-indigo-600 dark:text-[rgba(199,210,254,1)]",
          };
        }
        return dept;
      });

      if (track === "Theory") {
        list = [
          ...list,
          {
            id: "Physiology" as any,
            name: "Physiology",
            nameAr: "علم وظائف الأعضاء",
            icon: Heart,
            badge: "PHYS",
            bg: "bg-rose-50 dark:bg-[rgba(253,164,175,0.15)] text-rose-600 dark:text-[rgba(253,164,175,1)]",
          },
          {
            id: "Surgery" as any,
            name: "Surgery",
            nameAr: "الجراحة",
            icon: Scissors,
            badge: "SURG",
            bg: "bg-emerald-50 dark:bg-[rgba(94,234,212,0.15)] text-emerald-600 dark:text-[rgba(94,234,212,1)]",
          },
          {
            id: "IEL" as any,
            name: "IEL",
            nameAr: "التعليم اللامنهجي واللغات",
            icon: GraduationCap,
            badge: "IEL",
            bg: "bg-neutral-50 dark:bg-[rgba(203,213,225,0.15)] text-neutral-600 dark:text-[#EBEBF599] dark:text-[rgba(203,213,225,1)]",
          },
        ];
      } else if (track === "Practical") {
        list = [
          ...list,
          {
            id: "Surgery" as any,
            name: "Surgery",
            nameAr: "الجراحة السريرية",
            icon: Scissors,
            badge: "SURG",
            bg: "bg-emerald-50 dark:bg-[rgba(94,234,212,0.15)] text-emerald-600 dark:text-[rgba(94,234,212,1)]",
          },
        ];
      }
      return list;
    }

    // 2. CA (Clinical Anatomy)
    if (subject.id === "CA" && track === "Practical") {
      let list = DEPARTMENTS.map((dept) => {
        if (dept.id === "Microbiology") {
          return {
            id: "Surgery" as any,
            name: "Surgery",
            nameAr: "الجراحة السريرية",
            icon: Scissors,
            badge: "SURG",
            bg: "bg-emerald-50 dark:bg-[rgba(94,234,212,0.15)] text-emerald-600 dark:text-[rgba(94,234,212,1)]",
          };
        }
        if (dept.id === "Community Medicine") {
          return {
            id: "Communication Skills" as any,
            name: "Communication Skills",
            nameAr: "مهارات التواصل",
            icon: MessageSquare,
            badge: "COMM_SKILLS",
            bg: "bg-violet-50 dark:bg-[rgba(196,181,253,0.15)] text-violet-600 dark:text-[rgba(196,181,253,1)]",
          };
        }
        return dept;
      });

      list = [
        ...list,
        {
          id: "Practical Skills Lab" as any,
          name: "Practical Skills Lab",
          nameAr: "مختبر المهارات العملية",
          icon: ClipboardCheck,
          badge: "PSL",
          bg: "bg-teal-50 dark:bg-[rgba(94,234,212,0.15)] text-teal-600 dark:text-[rgba(94,234,212,1)]",
        },
      ];
      return list;
    }

    // 3. ImD (Clinical Immunology)
    if (subject.id === "ImD") {
      let list = [...DEPARTMENTS];
      list = list.filter((dept) => dept.id !== "Community Medicine");
      return list;
    }

    // 4. Default ID logic
    if (subject.id === "ID") {
      let list = [...DEPARTMENTS];

      // 1- inside the ID then inside the Bacteriology then inside Practical, change Community Medicine to Surgery
      if (subSubject === "Bacteriology" && track === "Practical") {
        list = list.map((dept) => {
          if (dept.id === "Community Medicine") {
            return {
              ...dept,
              name: "Surgery",
              nameAr: "الجراحة السريرية",
              icon: Scissors,
              badge: "SURG",
              bg: "bg-emerald-50 dark:bg-[rgba(94,234,212,0.15)] text-emerald-600 dark:text-[rgba(94,234,212,1)]",
            };
          }
          return dept;
        });
      }

      // 2- inside ID then inside Parasitology then inside Theory, add Surgery
      if (subSubject === "Parasitology" && track === "Theory") {
        if (!list.some((d) => (d.id as string) === "Surgery")) {
          list = [
            ...list,
            {
              id: "Surgery" as any,
              name: "Surgery",
              nameAr: "الجراحة السريرية",
              icon: Scissors,
              bg: "bg-emerald-50 dark:bg-[rgba(94,234,212,0.15)] text-emerald-600 dark:text-[rgba(94,234,212,1)]",
              badge: "SURG",
            },
          ];
        }
      }

      // 3- inside ID then inside Parasitology then inside Practical, remove Medicine
      if (subSubject === "Parasitology" && track === "Practical") {
        list = list.filter((dept) => dept.id !== "Medicine");
      }

      // 4- inside ID then inside Virology then inside Practical, remove Community Medicine
      if (subSubject === "Virology" && track === "Practical") {
        list = list.filter((dept) => dept.id !== "Community Medicine");
      }

      // 5- inside ID then inside Mycology then inside Theory, remove Community Medicine
      if (subSubject === "Mycology" && track === "Theory") {
        list = list.filter((dept) => dept.id !== "Community Medicine");
      }

      // 6- inside ID then inside Mycology then inside Practical, remove all
      if (subSubject === "Mycology" && track === "Practical") {
        list = [];
      }

      return list;
    }

    return DEPARTMENTS;
  }, [subject.id]);

  const shouldBypass =
    subject.id === "RM" ||
    (subject.id === "CA" && activeTrack === "Theory") ||
    (subject.id === "ID" &&
      activeSubSubject === "Mycology" &&
      activeTrack === "Practical") ||
    (subject.id === "PHC" &&
      (activeTrack === "Theory" || activeTrack === "Practical")) ||
    (subject.id === "SSC" &&
      (activeTrack === "Theory" || activeTrack === "Practical"));

  const info = useMemo(() => getSubjectIconInfo(subject.id), [subject.id]);
  const ParentIcon = info.icon;

  // Retrieve sub-subjects for this subject
  const subSubjects = useMemo(() => SUB_SUBJECT_MAP[subject.id] || ["General Outline"], [subject.id]);

  // Robust dynamic lecture matching/generator engine to guarantee non-empty states
  const getLecturesForHierarchy = useCallback((
    subSub: string,
    track: "Theory" | "Practical",
    dept: string | null = null,
  ): Lecture[] => {
    return subjectDbLectures
      .filter((dbL) => {
        let expectedTrack = track;
        if (
          track === "Practical" &&
          ["RM", "PHC", "ImD", "SSC"].includes(subject.id)
        ) {
          expectedTrack = "TBL" as any;
        }
        if (dbL.trackMode !== expectedTrack) return false;

        const subLower = subSub.toLowerCase();
        const dbSubLower = (dbL.subSubject || "").toLowerCase();
        const isDefaultSub = subject.id !== "ID";

        if (!isDefaultSub) {
          if (dbSubLower !== subLower) return false;
        }

        if (dept) {
          if (dbL.department !== dept) return false;
        }

        return true;
      })
      .map((dbL, index) => mapDbLectureToFrontend(dbL, index));
  }, [subjectDbLectures, subject.id]);

  const progressMap = useMemo(() => {
    const map = new Map<string, UserProgress>();
    progress.forEach((p) => {
      map.set(p.lectureId, p);
    });
    return map;
  }, [progress]);

  // Interactive progress statistics for the currently visible list
  const getLectureCompletionStats = useCallback((lectId: string) => {
    const p = progressMap.get(lectId);
    return {
      pdf: p?.pdfCompleted || false,
      notes: p?.notesCompleted || false,
      video: p?.videoCompleted || false,
      flash: p?.flashcardsCompleted || false,
      quiz: p?.quizCompleted || false,
      score: p?.quizScore || 0,
    };
  }, [progressMap]);

  const getLectureScorePercent = useCallback((lecture: Lecture, stats: any) => {
    let available = 0;
    let done = 0;
    
    if (lecture.materials?.some((m: any) => m.type.toUpperCase() === "PDF")) {
      available++;
      if (stats.pdf) done++;
    }
    if (lecture.materials?.some((m: any) => m.type.toUpperCase() === "NOTE")) {
      available++;
      if (stats.notes) done++;
    }
    if (lecture.materials?.some((m: any) => m.type === "VIDEO")) {
      available++;
      if (stats.video) done++;
    }
    if (lecture.mcqs && lecture.mcqs.length > 0) {
      available++;
      if (stats.quiz) done++;
    }
    if (lecture.flashcards && lecture.flashcards.length > 0) {
      available++;
      if (stats.flash) done++;
    }
    
    if (available === 0) {
      return (stats.pdf || stats.notes || stats.video || stats.quiz || stats.flash) ? 100 : 0;
    }
    
    return Math.floor((done / available) * 100);
  }, []);

  // Handle Breadcrumb navigating back to Level 1, 2, or 3
  const handleNavBack = useCallback(() => {
    if (activeDepartment !== null) {
      setActiveDepartment(null);
    } else if (activeTrack !== null) {
      setActiveTrack(null);
    } else if (activeSubSubject !== null) {
      if (subject.id !== "ID") {
        onBack();
      } else {
        setActiveSubSubject(null);
      }
    } else {
      onBack();
    }
  }, [activeDepartment, activeTrack, activeSubSubject, subject.id, onBack]);

  const lectureCountsBySubSubject = useMemo(() => {
    const counts: Record<string, { theory: number; practical: number }> = {};
    for (const subName of subSubjects) {
      counts[subName] = {
        theory: getLecturesForHierarchy(subName, "Theory").length,
        practical: getLecturesForHierarchy(subName, "Practical").length,
      };
    }
    return counts;
  }, [subSubjects, getLecturesForHierarchy]);

  const baseCardClassName = `ios-staggered-card macos-interactive relative group flex flex-col justify-between w-full h-full min-h-[160px] p-5 bg-white dark:bg-[#1C1C1E] rounded-xl text-left cursor-pointer select-none overflow-hidden shadow-elevation-1 ring-1 ring-black/[0.03] dark:ring-white/10 transition duration-normal ease-[cubic-bezier(0.22,1,0.36,1)] hover:shadow-elevation-3 dark:hover:shadow-elevation-3 hover:ring-black/[0.08] dark:hover:ring-white/[0.1] ${!isTouchDevice ? "cursor-pointer" : ""}`;
  
  const baseCardStyle: React.CSSProperties = useMemo(() => ({
    WebkitBackfaceVisibility: "hidden",
    backfaceVisibility: "hidden",
    WebkitTransform: "translate3d(0,0,0)",
    transform: "translate3d(0,0,0)",
    willChange: "transform, opacity",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
  }), []);

  return (
    <div
      ref={containerRef}
      className="space-y-section pb-12 pr-1 relative"
      style={{ transform: `translate3d(0, ${pullY}px, 0)`, transition: pullY === 0 ? "transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)" : "none" }}
    >
      {/* Embedded rotating iOS spinner that reveals itself when pulling from top boundary */}
      {pullY > 10 && (
        <div className="absolute top-1 left-1/2 -translate-x-1/2 flex flex-col items-center justify-center gap-1 z-[60] pointer-events-none">
          <div
            className={`w-icon-lg h-icon-lg border-[2.5px] border-neutral-400 dark:border-neutral-500 border-t-transparent rounded-full ${isRefreshing ? "animate-spin" : ""}`}
            style={{
              transform: isRefreshing ? undefined : `rotate(${pullY * 4}deg)`,
              opacity: Math.min(1, pullY / 60),
            }}
          />
        </div>
      )}

      {/* Apple-style Large Navigation Header */}
      <div className="mb-8 pt-3">
        <div className="flex items-center gap-1 mb-4 -ml-2">
          <button
            onClick={handleNavBack}
            className="flex items-center gap-1 text-med-blue hover:text-med-blue dark:text-blue-400 font-medium px-2 py-2 rounded-lg transition-colors cursor-pointer/40"
            title={isRtl ? "رجوع" : "Back"}
            aria-label={isRtl ? "رجوع" : "Back"}
          >
            <ArrowLeft className="w-icon-md h-icon-md -mt-[1px]" />
            <span className="text-base tracking-[-0.015em]">
              {isRtl ? "رجوع" : "Back"}
            </span>
          </button>

          {/* Direct Home Library access instead of Breadcrumbs bar icon */}
          <button
            onClick={() => {
              setActiveDepartment(null);
              setActiveTrack(null);
              setActiveSubSubject(null);
              onBack();
            }}
            className="ml-auto text-neutral-500 dark:text-[#EBEBF599] disabled:opacity-50 hover:bg-neutral-900/5 dark:hover:bg-white/[0.12] p-3 rounded-full transition-colors cursor-pointer"
            title="Syllabus Library Root"
            aria-label="Home"
          >
            <Home className="w-6 h-6 sm:w-7 sm:h-7 text-neutral-500 dark:text-[var(--text-secondary)]" />
          </button>
        </div>

        <div className="flex flex-col pl-2 px-2">
          <span
            className={`text-xs font-semibold uppercase mb-2 shadow-elevation-1 px-2 py-1 rounded-md inline-block max-w-fit ${info.bg} ${info.text} border border-black/5 dark:border-white/[0.12] antialiased`}
          >
            {info.badge}
          </span>
          <h1 className="text-[34px] leading-[1.1] tracking-[-0.03em] font-display font-semibold text-neutral-900 dark:text-[var(--text-primary)] mt-1 antialiased">
            {activeDepartment ||
              (activeTrack === "Practical" &&
              ["RM", "PHC", "ImD", "SSC"].includes(subject.id)
                ? "TBL"
                : activeTrack) ||
              activeSubSubject ||
              subject.name}
          </h1>
          {/* Redesigned interactive breadcrumb navigation (Apple Files style) */}
          <div className="text-neutral-500 dark:text-[var(--text-secondary)] font-medium text-base mt-2 flex items-center flex-wrap gap-1 -ml-2 antialiased">
            <button
              onClick={() => {
                if (activeSubSubject) {
                  setActiveSubSubject(null);
                  setActiveTrack(null);
                  setActiveDepartment(null);
                }
              }}
              className={`px-3 py-1 rounded-lg transition-colors duration-200/40 ${
                activeSubSubject
                  ? "hover:bg-neutral-900/5 dark:hover:bg-white/[0.12] hover:text-neutral-900 dark:text-white dark:hover:text-neutral-100 cursor-pointer "
                  : "text-neutral-900 dark:text-[var(--text-primary)] font-semibold cursor-default"
              }`}
            >
              {subject.name}
            </button>
            {activeSubSubject && (
              <>
                <ChevronRight className="w-icon-sm h-icon-sm opacity-40 mx-0 flex-shrink-0" />
                <button
                  onClick={() => {
                    if (activeTrack) {
                      setActiveTrack(null);
                      setActiveDepartment(null);
                    }
                  }}
                  className={`px-3 py-1 rounded-lg transition-colors duration-200/40 ${
                    activeTrack
                      ? "hover:bg-neutral-900/5 dark:hover:bg-white/[0.12] hover:text-neutral-900 dark:text-white dark:hover:text-neutral-100 cursor-pointer "
                      : "text-neutral-900 dark:text-[var(--text-primary)] font-semibold cursor-default"
                  }`}
                >
                  {activeSubSubject}
                </button>
              </>
            )}
            {activeTrack && (
              <>
                <ChevronRight className="w-icon-sm h-icon-sm opacity-40 mx-0 flex-shrink-0" />
                <button
                  onClick={() => {
                    if (activeDepartment) {
                      setActiveDepartment(null);
                    }
                  }}
                  className={`px-3 py-1 rounded-lg transition-colors duration-200/40 ${
                    activeDepartment
                      ? "hover:bg-neutral-900/5 dark:hover:bg-white/[0.12] hover:text-neutral-900 dark:text-white dark:hover:text-neutral-100 cursor-pointer "
                      : "text-neutral-900 dark:text-[var(--text-primary)] font-semibold cursor-default"
                  }`}
                >
                  {["RM", "PHC", "ImD", "SSC"].includes(subject.id) &&
                  activeTrack === "Practical"
                    ? "TBL"
                    : isRtl
                      ? activeTrack === "Theory"
                        ? "نظري"
                        : "عملي"
                      : activeTrack}
                </button>
              </>
            )}
            {activeDepartment && (
              <>
                <ChevronRight className="w-icon-sm h-icon-sm opacity-40 mx-0 flex-shrink-0" />
                <span className="px-3 py-1 text-neutral-900 dark:text-[var(--text-primary)] font-semibold cursor-default">
                  {activeDepartment}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Advanced Animated Navigation Panels */}
      <AnimatePresence mode="wait">
        {/* LEVEL 2: Sub-Subjects Selection Cards Grid */}
        {activeSubSubject === null && (
          <motion.div
            key="level-2-sub-subjects"
            initial={{ opacity: 1, y: 0 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 1, y: 0 }}
            transition={{ duration: 0 }}
            className="space-y-4"
          >
            <div
              key={`subsubjects-${subject.id}`}
              className={`grid ${device.gridCols.library} ${device.spacing}`}
            >
              {subSubjects.map((subName) => {
                const subCode = subName.slice(0, 3).toUpperCase();

                // Use precomputed lecture counts
                const theoryLecs = lectureCountsBySubSubject[subName]?.theory || 0;
                const practicalLecs = lectureCountsBySubSubject[subName]?.practical || 0;
                const totalLecs = theoryLecs + practicalLecs;

                // Determine icon for the sub-subject. For ID (Infectious Diseases), use specific medical/scientific icons.
                let SubIcon = ParentIcon;
                if (subject.id === "ID") {
                  if (subName === "Bacteriology") SubIcon = Dna;
                  else if (subName === "Parasitology") SubIcon = Bug;
                  else if (subName === "Virology") SubIcon = Microscope;
                  else if (subName === "Mycology") SubIcon = Leaf;
                }

                return (
                  <button
                    key={subName}
                    type="button"
                    onClick={() => setActiveSubSubject(subName)}
                    className={baseCardClassName}
                    style={baseCardStyle}
                  >
                    {/* Ambient glowing radial background */}
                    

                    <div className="flex justify-between items-start gap-3 w-full relative z-10 pointer-events-none">
                      <div
                        className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${info.bg} ${info.text} shadow-elevation-1 ring-1 ring-black/[0.04] dark:ring-white/[0.06] bg-opacity-80 backdrop-blur-sm`}
                      >
                        <SubIcon className="w-icon-md h-icon-md" />
                      </div>
                      <span className="text-xs font-semibold font-mono px-3 py-1 bg-black/[0.03] dark:bg-white/[0.08] rounded-lg text-neutral-600 dark:text-[var(--text-secondary)] ring-1 ring-black/[0.04] dark:ring-white/[0.06] antialiased">
                        {subject.id}-{subCode}
                      </span>
                    </div>

                    <div className="mt-5 relative z-10 pointer-events-none flex-1 flex flex-col justify-end">
                      <h3 className="font-display font-semibold text-neutral-900 dark:text-[var(--text-primary)] text-base leading-[1.25] text-balance group-hover:text-neutral-800 dark:text-white dark:group-hover:text-[var(--text-primary)] transition-colors duration-[350ms] antialiased">
                        {subName}
                      </h3>

                      <div className="mt-3 flex justify-between items-center text-sm font-medium text-neutral-500 dark:text-[var(--text-secondary)] w-full antialiased">
                        <span className="flex items-center gap-2 opacity-80">
                          <BookOpen className="w-icon-sm h-icon-sm text-neutral-500 dark:text-[#EBEBF599] dark:text-[var(--text-muted)]" />{" "}
                          {totalLecs} {isRtl ? "محاضرة" : "lecs"}
                        </span>
                        {(theoryLecs > 0 || practicalLecs > 0) && (
                          <div className="flex gap-2 opacity-70">
                            {theoryLecs > 0 && (
                              <span className="bg-black/[0.04] dark:bg-white/[0.06] px-2 py-1 rounded-md text-xs font-semibold">
                                T:{theoryLecs}
                              </span>
                            )}
                            {practicalLecs > 0 && (
                              <span className="bg-black/[0.04] dark:bg-white/[0.06] px-2 py-1 rounded-md text-xs font-semibold">
                                P:{practicalLecs}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* LEVEL 3: Theory vs Practical Selection Screen */}
        {activeSubSubject !== null && activeTrack === null && (
          <motion.div
            key="level-3-mode-selection"
            initial={{ opacity: 1, y: 0 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 1, y: 0 }}
            transition={{ duration: 0 }}
            className="space-y-4"
          >
            {/* Exactly two rectangular cards designed with the parent subject's size, shape, and color parameters */}
            <div
              key={`tracks-${subject.id}-${activeSubSubject}`}
              className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-1"
            >
              {/* Theory Selection Card */}
              <button
                type="button"
                onClick={() => setActiveTrack("Theory")}
                className={baseCardClassName}
                style={baseCardStyle}
              >
                {/* Ambient glowing radial background */}
                

                <div className="flex justify-between items-start gap-3 w-full relative z-10 pointer-events-none">
                  <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 bg-blue-50 dark:bg-[rgba(191,219,254,0.15)] text-med-blue dark:text-[rgba(191,219,254,1)] shadow-elevation-1 ring-1 ring-black/[0.04] dark:ring-white/[0.06] bg-opacity-80 backdrop-blur-sm">
                    <Book className="w-icon-md h-icon-md" />
                  </div>
                  <span className="text-xs font-semibold font-mono px-3 py-1 bg-black/[0.03] dark:bg-white/[0.08] rounded-lg text-neutral-600 dark:text-[var(--text-secondary)] ring-1 ring-black/[0.04] dark:ring-white/[0.06] antialiased">
                    THEORY
                  </span>
                </div>

                <div className="mt-5 relative z-10 pointer-events-none flex-1 flex flex-col justify-end">
                  <div className="mt-3 flex justify-between items-center text-sm font-medium text-neutral-500 dark:text-[var(--text-secondary)] w-full antialiased">
                    <span className="flex items-center gap-2 opacity-80">
                      <Book className="w-icon-sm h-icon-sm text-neutral-500 dark:text-[#EBEBF599] dark:text-[var(--text-muted)]" />{" "}
                      {
                        getLecturesForHierarchy(activeSubSubject, "Theory")
                          .length
                      }{" "}
                      {isRtl ? "محاضرة نظرية" : "Core modules"}
                    </span>
                  </div>
                </div>
              </button>

              {/* Practical Selection Card */}
              <button
                type="button"
                onClick={() => setActiveTrack("Practical")}
                className={baseCardClassName}
                style={baseCardStyle}
              >
                {/* Ambient glowing radial background */}
                

                <div className="flex justify-between items-start gap-3 w-full relative z-10 pointer-events-none">
                  <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 bg-emerald-50 dark:bg-[rgba(94,234,212,0.15)] text-emerald-600 dark:text-[rgba(94,234,212,1)] shadow-elevation-1 ring-1 ring-black/[0.04] dark:ring-white/[0.06] bg-opacity-80 backdrop-blur-sm">
                    <Activity className="w-icon-md h-icon-md" />
                  </div>
                  <span className="text-xs font-semibold font-mono px-3 py-1 bg-black/[0.03] dark:bg-white/[0.08] rounded-lg text-neutral-600 dark:text-[var(--text-secondary)] ring-1 ring-black/[0.04] dark:ring-white/[0.06] antialiased">
                    {["RM", "PHC", "ImD", "SSC"].includes(subject.id)
                      ? "TBL"
                      : "PRACTICAL"}
                  </span>
                </div>

                <div className="mt-5 relative z-10 pointer-events-none flex-1 flex flex-col justify-end">
                  <div className="mt-3 flex justify-between items-center text-sm font-medium text-neutral-500 dark:text-[var(--text-secondary)] w-full antialiased">
                    <span className="flex items-center gap-2 opacity-80">
                      <Activity className="w-icon-sm h-icon-sm text-neutral-500 dark:text-[#EBEBF599] dark:text-[var(--text-muted)]" />{" "}
                      {
                        getLecturesForHierarchy(activeSubSubject, "Practical")
                          .length
                      }{" "}
                      {["RM", "PHC", "ImD", "SSC"].includes(subject.id)
                        ? isRtl
                          ? "محاضرة TBL"
                          : "TBL modules"
                        : isRtl
                          ? "محاضرة عملية"
                          : "Clinical kits"}
                    </span>
                  </div>
                </div>
              </button>
            </div>
          </motion.div>
        )}

        {/* LEVEL 3.5: Department Selection Screen */}
        {activeSubSubject !== null &&
          activeTrack !== null &&
          activeDepartment === null &&
          !shouldBypass && (
            <motion.div
              key="level-3-5-department-selection"
              initial={{ opacity: 1, y: 0 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 1, y: 0 }}
              transition={{ duration: 0 }}
              className="space-y-4"
            >
              {/* Dynamic rectangular cards with the same design as sub-subjects */}
              <div
                key={`depts-${subject.id}-${activeSubSubject}-${activeTrack}`}
                className={`grid ${device.gridCols.library} ${device.spacing}`}
              >
                {getDepartmentsList(activeSubSubject, activeTrack).map(
                  (dept) => {
                    const totalLecs = getLecturesForHierarchy(
                      activeSubSubject,
                      activeTrack,
                      dept.id,
                    ).length;
                    const DeptIcon = dept.icon;

                    return (
                      <button
                        key={dept.id}
                        type="button"
                        onClick={() => setActiveDepartment(dept.id)}
                        className={baseCardClassName}
                        style={baseCardStyle}
                      >
                        {/* Ambient glowing radial background */}
                        

                        <div className="flex justify-between items-start gap-3 w-full relative z-10 pointer-events-none">
                          <div
                            className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${dept.bg} text-neutral-700 dark:text-[var(--text-secondary)] shadow-elevation-1 ring-1 ring-black/[0.04] dark:ring-white/[0.06] bg-opacity-80 backdrop-blur-sm`}
                          >
                            <DeptIcon className="w-icon-md h-icon-md text-neutral-600 dark:text-[var(--text-secondary)]" />
                          </div>
                          <span className="text-xs font-semibold font-mono px-3 py-1 bg-black/[0.03] dark:bg-white/[0.08] rounded-lg text-neutral-600 dark:text-[var(--text-secondary)] ring-1 ring-black/[0.04] dark:ring-white/[0.06] antialiased">
                            {dept.badge}
                          </span>
                        </div>

                        <div className="mt-5 relative z-10 pointer-events-none flex-1 flex flex-col justify-end">
                          <h3 className="font-display font-semibold text-neutral-900 dark:text-[var(--text-primary)] text-base leading-[1.25] text-balance group-hover:text-neutral-800 dark:text-white dark:group-hover:text-[var(--text-primary)] transition-colors duration-[350ms] antialiased">
                            {isRtl ? dept.nameAr : dept.name}
                          </h3>

                          <div className="mt-3 flex justify-between items-center text-sm font-medium text-neutral-500 dark:text-[var(--text-secondary)] w-full antialiased">
                            <span className="flex items-center gap-2 opacity-80">
                              <BookOpen className="w-icon-sm h-icon-sm text-neutral-500 dark:text-[#EBEBF599] dark:text-[var(--text-muted)]" />{" "}
                              {totalLecs} {isRtl ? "محاضرة" : "lecs"}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  },
                )}
              </div>
            </motion.div>
          )}

        {/* LEVEL 4: Playlist Lectures in list design */}
        {activeSubSubject !== null &&
          activeTrack !== null &&
          (activeDepartment !== null || shouldBypass) && (
            <motion.div
              key="level-4-lecture-list"
              initial={{ opacity: 1, y: 0 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 1, y: 0 }}
              transition={{ duration: 0 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-end border-b border-black/[0.06] dark:border-white/[0.08] pb-3 mb-3 px-2 antialiased">
                <span className="text-xs font-semibold text-neutral-500 dark:text-[#EBEBF599] dark:text-[var(--text-muted)] uppercase pointer-events-none select-none font-mono">
                  {isRtl ? "المحاضرات" : "SYLLABUS LECTURES"}
                </span>
              </div>

              {/* Render playlist list items style */}
              <div className="space-y-4">
                {/* Dynamic database lectures listing */}
                {mappedDbLectures.length > 0 && (
                  <div
                    key={`lecs-${subject.id}-${activeSubSubject}-${activeTrack}-${activeDepartment}`}
                    className="space-y-4 w-full"
                  >
                    {mappedDbLectures.map((lecture) => {
                      const legProgress = getLectureCompletionStats(lecture.id);
                      const complPct = getLectureScorePercent(lecture, legProgress);

                      return (
                        <div
                          key={lecture.id}
                          className="ios-list-item-virtualized"
                        >
                          <LectureListItem
                            lecture={lecture}
                            activeTrack={activeTrack}
                            activeSubSubject={activeSubSubject}
                            activeDepartment={activeDepartment}
                            isRtl={isRtl}
                            isTouchDevice={isTouchDevice}
                            calendarEvents={calendarEvents}
                            legProgress={legProgress}
                            complPct={complPct}
                            onSelectLecture={onSelectLecture}
                            showHapticToast={showHapticToast}
                            subjectName={subject.name}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* User Friendly Dropdown Fallback Empty State (Rules 2 & 3) */}
                {mappedDbLectures.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 px-6 text-center antialiased">

                    <h4 className="font-display text-2xl font-semibold text-neutral-900 dark:text-[var(--text-primary)] mb-2">
                      {isRtl
                        ? "لا توجد محاضرات متاحة"
                        : "No Lectures Available"}
                    </h4>
                  </div>
                )}
              </div>
            </motion.div>
          )}
      </AnimatePresence>

      <AnimatePresence>
        {nativeToast && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
            className="fixed left-1/2 -translate-x-1/2 z-[150] w-[calc(100%-32px)] max-w-sm"
            style={{ top: "calc(16px + env(safe-area-inset-top, 0px))" }}
          >
            <div className="bg-[#1C1C1E]/95 dark:bg-[#2C2C2E]/95 text-white p-4 rounded-md shadow-elevation-3 border border-white/10 flex items-center gap-3 backdrop-blur-sm">
              <div className="w-avatar-sm h-avatar-sm rounded-full bg-med-blue/10 text-blue-400 flex items-center justify-center shrink-0">
                <Sparkles className="w-icon-sm h-icon-sm" />
              </div>
              <div className="flex-1 text-left">
                <h5 className="text-caption font-semibold leading-none text-white">
                  {nativeToast.title}
                </h5>
                <p className="text-caption text-neutral-500 dark:text-[#EBEBF599] mt-1 font-medium">
                  {nativeToast.description}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default memo(SubjectView);
