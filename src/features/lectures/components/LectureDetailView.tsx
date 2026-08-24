import { safeJsonParse } from "../../../core/utils/safeJson";
import { UserAvatar } from "../../../features/profile/components/UserAvatar";
import { apiClient } from "../../../core/api/apiClient";
import { ReportSheet, ReportTarget } from "../../../features/moderation/components/ReportSheet";
import { CommunityGuidelines } from "../../../features/moderation/components/CommunityGuidelines";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect, Suspense, memo, lazy } from "react";
import {
 Lecture,
 MCQ,
 Flashcard,
 Video,
 CommunityQuestion,
 CommunityAnswer,
 UserProgress,
 CalendarEvent,
} from "../../../core/types";
import { parseBaghdadDate } from "../../../core/utils/timezone";
import { Language } from "../../../core/i18n/translations";
import { motion, AnimatePresence } from "motion/react";
import {
 ArrowLeft,
 BookOpen,
 FileText,
 HelpCircle,
 CheckCircle,
 Send,
 ThumbsUp,
 Star,
 ExternalLink,
 ChevronLeft,
 ChevronRight,
 Layers,
 Heart,
 Trash2,
 Edit,
 Check,
 X,
 Activity,
 Calendar,
 BookMarked,
 PlayCircle,
 MessageSquare,
 MicOff,
  Brain,
  Zap,
  Gauge,
} from "lucide-react";
import { mcqs, flashcards, videos, initialQuestions } from "../../../core/constants/seedData";
import { NativeBridge } from "../../../core/device/capacitor/nativeBridge";
import { getApiBaseUrl } from "../../../core/api/api";
import { showiOSAlert } from "../../../core/device/alert";
import { VideoCard } from "./VideoCard";
import { getSubjectIconInfo } from "../../../core/utils/subjectIcons";
import { SubjectFlashcardArtwork } from "./SubjectFlashcardArtwork";

interface LectureDetailViewProps {
  isActive?: boolean;
 lecture: Lecture;
 progress: UserProgress;
 onUpdateProgress: (updates: Partial<UserProgress>) => void;
 onAddPoints: (points: number, reason: string) => void;
 onBack: () => void;
 currentUser: { id?: string; name: string; email: string; avatar: string; role?: string };
 language?: Language;
 calendarEvents?: CalendarEvent[];
 initialTab?: "pdf" | "notes" | "mcqs" | "flashcards" | "videos" | "qa";
 muteStatus?: { isMuted: boolean; isPermanent: boolean; endTime: string | null; reason: string | null } | null;
}

const resolveExternalPdfUrl = async (rawUrl: string | undefined, materialId?: string): Promise<string> => {
  let freshUrl = rawUrl || "";
  
  if (!freshUrl && materialId) {
    freshUrl = `/api/materials/pdf/${encodeURIComponent(materialId)}`;
  } else if (!freshUrl) {
    throw new Error("No PDF URL or material ID provided");
  }

  try {
    const parsed = new URL(freshUrl);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      freshUrl = parsed.pathname + parsed.search + parsed.hash;
    }
  } catch (_) {}

  const baseLink =
    freshUrl.startsWith("http") ||
    freshUrl.startsWith("/uploads/") ||
    freshUrl.startsWith("/api/materials/")
      ? freshUrl
      : `/assets/${freshUrl}`;
  let cleanLink = baseLink;

  if (cleanLink.startsWith("/")) {
    cleanLink = (getApiBaseUrl() || window.location.origin) + cleanLink;
  }

  try {
    const parsed = new URL(cleanLink);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const urlMaterialId =
      pathParts.length >= 3 &&
      pathParts[0] === "api" &&
      pathParts[1] === "materials" &&
      pathParts[2] === "pdf"
        ? decodeURIComponent(pathParts[3] || "").replace(/\.pdf$/i, "")
        : undefined;
    if (
      (urlMaterialId || materialId)
    ) {
      const targetMaterialId = urlMaterialId || materialId;
      if (!targetMaterialId) return cleanLink;
      const response = await apiClient(
        `/api/materials/pdf/${encodeURIComponent(targetMaterialId)}/external-url`,
        { silent: true, bypassCache: true },
      );
      if (response.ok) {
        const data = await response.json();
        if (typeof data?.url === "string" && data.url) {
          let resolvedUrl = data.url;
          if (resolvedUrl.startsWith("/")) {
            resolvedUrl = (getApiBaseUrl() || window.location.origin) + resolvedUrl;
          }
          return resolvedUrl;
        }
      }
    }
  } catch (_) {}

  return cleanLink;
};


const getFlashcardTheme = (subjectId?: string) => {
  const themes = {
    ID: { accent: "#14B8A6", rgb: "20,184,166" },
    NT: { accent: "#8B5CF6", rgb: "139,92,246" },
    RM: { accent: "#38BDF8", rgb: "56,189,248" },
    CA: { accent: "#FB7185", rgb: "251,113,133" },
    PHC: { accent: "#F59E0B", rgb: "245,158,11" },
    ImD: { accent: "#818CF8", rgb: "129,140,248" },
    SSC: { accent: "#94A3B8", rgb: "148,163,184" },
    DEFAULT: { accent: "#3B82F6", rgb: "59,130,246" },
  } as const;
  return themes[(subjectId as keyof typeof themes) || "DEFAULT"] || themes.DEFAULT;
};

export const LectureDetailView = function LectureDetailView({
 lecture,
 progress,
 onUpdateProgress,
 onAddPoints,
 onBack,
 currentUser,
 language = "en",
 calendarEvents = [],
 initialTab = "pdf",
 muteStatus = null,
}: LectureDetailViewProps) {
 const sessionStartRef = useRef<number>(Date.now());
  const [detailedLecture, setDetailedLecture] = useState<any>(lecture);
  const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false);

   useEffect(() => {
     let isMounted = true;
     setDetailedLecture(lecture);
     if (lecture.isDatabaseLecture) {
      setIsLoadingDetails(true);
      apiClient(`/api/lectures/${lecture.id}`)
        .then(res => res.json())
        .then(data => {
           if (isMounted && data) {
             setDetailedLecture({ ...data, isDatabaseLecture: true, title: data.name || lecture.title });
          }
        })
        .catch(() => {})
        .finally(() => {
          if (isMounted) setIsLoadingDetails(false);
        });
    } else {
      setDetailedLecture(lecture);
    }
    return () => { isMounted = false; };
  }, [lecture.id, lecture.isDatabaseLecture]);

  const isRtl = language === "ar";
  const flashcardTheme = useMemo(() => getFlashcardTheme(lecture.subjectId), [lecture.subjectId]);
  const flashcardIconInfo = useMemo(() => getSubjectIconInfo(lecture.subjectId), [lecture.subjectId]);
  const FlashcardSubjectIcon = flashcardIconInfo.icon;
  const flashcardThemeVars = useMemo(() => ({
    "--flashcard-accent": flashcardTheme.accent,
    "--flashcard-accent-rgb": flashcardTheme.rgb,
  } as React.CSSProperties), [flashcardTheme]);
  const isNativeIOS =
    NativeBridge.isNativePlatform() && NativeBridge.getPlatformName() === "ios";
  const [activeTab, setActiveTab] = useState<
 "pdf" | "notes" | "mcqs" | "flashcards" | "videos" | "qa"
  >(initialTab);

  // Search can replace the current lecture while this view remains mounted.
  // Keep the selected content tab synchronized with the new search result.
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab, lecture.id]);

 const [customFlashcards, setCustomFlashcards] = useState<any[]>([]);
 const [postMuteError, setPostMuteError] = useState<string | null>(null);

 // Formats remaining mute duration into a human-readable string
 const formatMuteRemaining = (endTime: string | null): string => {
   if (!endTime) return "";
   const remaining = new Date(endTime).getTime() - Date.now();
   if (remaining <= 0) return "expired";
   const totalMins = Math.floor(remaining / 60000);
   const days = Math.floor(totalMins / 1440);
   const hours = Math.floor((totalMins % 1440) / 60);
   const mins = totalMins % 60;
   if (days > 0) return `${days}d ${hours}h remaining`;
   if (hours > 0) return `${hours}h ${mins}m remaining`;
   return `${mins}m remaining`;
 };


 // --- Dynamic Data Resolvers for database vs pre-seeded lectures ---
 const relevantCards = useMemo(() => {
 const baseList =
  lecture.isDatabaseLecture && detailedLecture.flashcards
 ? detailedLecture.flashcards.map((f: any) => ({
 id: f.id,
 lectureId: lecture.id,
 front: f.clinicalConcept || f.front || "Concept Review Flashcard",
 back: f.explanation || f.back || "Concept Explanation Details",
 }))
 : flashcards.filter((f) => f.lectureId === lecture.id);

 const mergedMap = new Map();
 baseList.forEach((c: any) => mergedMap.set(c.id, c));
 customFlashcards.forEach((c: any) => {
 mergedMap.set(c.id, {
 id: c.id,
 lectureId: lecture.id,
 front:
 c.clinicalConcept ||
 c.front ||
 c.frontText ||
 "Concept Review Flashcard",
 back:
 c.explanation ||
 c.back ||
 c.backText ||
 "Concept Explanation Details",
 });
 });

 return Array.from(mergedMap.values());
  }, [lecture, detailedLecture, customFlashcards]);
 const getRelevantCards = useCallback(() => relevantCards, [relevantCards]);

 const relevantVideos = useMemo(() => {
  const materials = detailedLecture.materials || lecture.materials;
  if (lecture.isDatabaseLecture && materials) {
  const dbVideos = materials.filter((m: any) => m.type.toUpperCase() === "VIDEO");
 return dbVideos.map((m: any) => ({
 id: m.id,
 lectureId: lecture.id,
 title: m.title || "Lecture Video Tutorial",
 youtubeUrl: m.fileUrlOrLink,
 durationSeconds: m.durationSeconds || 118,
 description: "",
 }));
 }
 return videos.filter((v) => v.lectureId === lecture.id);
  }, [lecture, detailedLecture]);
 const getRelevantVideos = useCallback(() => relevantVideos, [relevantVideos]);

 // --- Sub-States ---
 // PDF Section
  const [pdfPage, setPdfPage] = useState(0);
  const [hasOpenedPdf, setHasOpenedPdf] = useState(() => {
  return localStorage.getItem(`uob_has_opened_pdf_${lecture.id}`) === "true";
  });

 // Database-backed materials progress states as requested
 const [hasViewedPdf, setHasViewedPdf] = useState(false);
 const [isPdfCompleted, setIsPdfCompleted] = useState(false);
 const [hasViewedNotes, setHasViewedNotes] = useState(false);
 const [isNotesCompleted, setIsNotesCompleted] = useState(false);



 // Enriched Notes Section
 const [personalNotes, setPersonalNotes] = useState("");
 const [hasOpenedNotes, setHasOpenedNotes] = useState(() => {
 return (
 localStorage.getItem(`uob_has_opened_notes_${lecture.id}`) === "true"
 );
 });

 // Sync on lecture ID changes cleanly, avoiding any accidental deletions of localStorage items
 useEffect(() => {
 setHasOpenedPdf(
 localStorage.getItem(`uob_has_opened_pdf_${lecture.id}`) === "true",
 );
 setHasOpenedNotes(
 localStorage.getItem(`uob_has_opened_notes_${lecture.id}`) === "true",
 );

 // Default states until db response
 setHasViewedPdf(
 localStorage.getItem(`uob_has_opened_pdf_${lecture.id}`) === "true",
 );
 setIsPdfCompleted(!!progress.pdfCompleted);
 setHasViewedNotes(
 localStorage.getItem(`uob_has_opened_notes_${lecture.id}`) === "true",
 );
 setIsNotesCompleted(!!progress.notesCompleted);

 if (!currentUser?.id || !lecture.id) return;

 let isMounted = true;
    const fetchProgress = async () => {
 try {
 // Fetch Main PDF progress status
 const pdfRes = await apiClient(
 `/api/progress/${currentUser.id}/pdf_${lecture.id}`,
 );
 if (pdfRes.ok) {
 const pdfData = await pdfRes.json();
 if (!isMounted) return; setHasViewedPdf(pdfData.hasViewed);
 setIsPdfCompleted(pdfData.isCompleted);
 }

 // Fetch Notes progress status
 const notesRes = await apiClient(
 `/api/progress/${currentUser.id}/notes_${lecture.id}`,
 );
 if (notesRes.ok) {
 const notesData = await notesRes.json();
 if (!isMounted) return; setHasViewedNotes(notesData.hasViewed);
 setIsNotesCompleted(notesData.isCompleted);
 }
 } catch (err) {
 
 }
 };

 fetchProgress(); return () => { isMounted = false; };
 }, [
 lecture.id,
 currentUser?.id,
 progress.pdfCompleted,
 progress.notesCompleted,
 ]);

 // Helper APIs to set hasViewed to true persistently in DB
 const triggerPdfViewed = async () => {
 setHasViewedPdf(true);
 if (!currentUser?.id) return;
 try {
 await apiClient("/api/progress/view", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 userId: currentUser.id,
 materialId: `pdf_${lecture.id}`,
 }),
 });
 } catch (err) {
 
 }
 };

  const handleOpenPdf = async () => {
    // Open a blank window synchronously for web platforms to avoid popup blockers
    let popupWindow: Window | null = null;
    if (!NativeBridge.isNativePlatform()) {
      popupWindow = window.open("about:blank", "_blank");
    }
    try {
      const pdfMaterialId = (detailedLecture.materials || lecture.materials || [])
        .find((material: any) => material.type.toUpperCase() === "PDF")?.id;
      const cleanLink = await resolveExternalPdfUrl(lecture.pdfUrl, pdfMaterialId);
      await NativeBridge.openPdfUrl(cleanLink, popupWindow);

      localStorage.setItem(
        `uob_has_opened_pdf_${lecture.id}`,
        "true",
      );
      setHasOpenedPdf(true);
      triggerPdfViewed();
    } catch (err: any) {
      if (popupWindow && !popupWindow.closed) {
        popupWindow.close();
      }
      console.error("[PDF] open failed:", err);
      showiOSAlert({
        title: "Could Not Open PDF",
        message: "We encountered an issue while trying to open this PDF. Please check your connection and try again.",
        actions: [{ label: "OK", style: "default" }]
      });
    }
  };

  const handlePdfButtonActivate = () => {
    void handleOpenPdf();
  };

  const triggerNotesViewed = async () => {
  setHasViewedNotes(true);
  if (!currentUser?.id) return;
 try {
 await apiClient("/api/progress/view", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 userId: currentUser.id,
 materialId: `notes_${lecture.id}`,
 }),
 });
  } catch (err) {

  }
  };

  const handleOpenNotes = async () => {
    let popupWindow: Window | null = null;
    if (!NativeBridge.isNativePlatform()) {
      popupWindow = window.open("about:blank", "_blank");
    }
    try {
      const notesMaterialId = (detailedLecture.materials || lecture.materials || [])
        .find((material: any) => material.type.toUpperCase() === "NOTE")?.id;
      const cleanLink = await resolveExternalPdfUrl(lecture.notesPdfUrl || "", notesMaterialId);
      await NativeBridge.openPdfUrl(cleanLink, popupWindow);

      localStorage.setItem(
        `uob_has_opened_notes_${lecture.id}`,
        "true",
      );
      setHasOpenedNotes(true);
      triggerNotesViewed();
    } catch (err: any) {
      if (popupWindow && !popupWindow.closed) {
        popupWindow.close();
      }
      console.error("[NOTES] open failed:", err);
      showiOSAlert({
        title: "Could Not Open Notes",
        message: "We encountered an issue while trying to open the notes. Please check your connection and try again.",
        actions: [{ label: "OK", style: "default" }]
      });
    }
  };

  const handleNotesButtonActivate = () => {
    void handleOpenNotes();
  };

  const handleMarkPdfCompleted = async () => {
 setIsPdfCompleted(true);
 // Standard offline/online progress synchronization via state
 onUpdateProgress({ pdfCompleted: true });
 onAddPoints(5, `Read primary lecture document: ${lecture.title}`);

 if (!currentUser?.id) return;
 try {
 await apiClient("/api/progress/complete", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 userId: currentUser.id,
 materialId: `pdf_${lecture.id}`,
 }),
 });
 } catch (err) {
 
 }
 };

 const handleMarkNotesCompleted = async () => {
 setIsNotesCompleted(true);
 // Standard offline/online progress synchronization via state
 onUpdateProgress({ notesCompleted: true });
 onAddPoints(5, `Reviewed cooperative clinical notes: ${lecture.title}`);

 if (!currentUser?.id) return;
 try {
 await apiClient("/api/progress/complete", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 userId: currentUser.id,
 materialId: `notes_${lecture.id}`,
 }),
 });
 } catch (err) {
 
 }
 };

 // MCQ Section
 const [quizSource] = useState<
 "all" | "past_year" | "ai" | "book"
 >("all");
 const [quizQuestions, setQuizQuestions] = useState<MCQ[]>([]);
 const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
 const [answersMap, setAnswersMap] = useState<{
 [key: string]: "A" | "B" | "C" | "D";
 }>({});
  const [showHint, setShowHint] = useState(false);
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizScorePct, setQuizScorePct] = useState(0);
  // Server-verified per-question results (filled only after submission).
  const [quizResults, setQuizResults] = useState<{
    [questionId: string]: {
      correct: boolean;
      correctAnswer?: "A" | "B" | "C" | "D" | null;
      explanation?: string;
    };
  }>({});

 // Flashcards Section
 const [currentCardIndex, setCurrentCardIndex] = useState(0);
 const [isFlipped, setIsFlipped] = useState(false);
 const [cardStats, setCardStats] = useState<{
    [key: string]: "easy" | "medium" | "hard";
  }>({});
  const [updatedCardStatuses, setUpdatedCardStatuses] = useState<{
    [key: string]: "easy" | "medium" | "hard";
  }>({});
 const [deckFinished, setDeckFinished] = useState(false);
 const [repeatFilter, setRepeatFilter] = useState<
 "all" | "hard" | "medium" | "easy" | null
 >(null);

  // Video Section
  const [videoWatched, setVideoWatched] = useState(progress.videoCompleted);
  const youtubeExternalOpenRef = useRef(false);

  // Close a still-present Capacitor browser sheet when iOS returns from the
  // external YouTube app, restoring the lecture card underneath it.
  useEffect(() => {
    if (!isNativeIOS) {
      return;
    }

    const restoreVideoSection = () => {
      if (!youtubeExternalOpenRef.current) return;
      youtubeExternalOpenRef.current = false;
      setActiveTab("videos");
    };
    const removeLifecycleListener = NativeBridge.addAppLifecycleListener((isActive) => {
      if (isActive) restoreVideoSection();
    });
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") restoreVideoSection();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      removeLifecycleListener();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isNativeIOS]);

  // Q&A Section
 const [lectureQuestions, setLectureQuestions] = useState<CommunityQuestion[]>(
 [],
 );
 const [newQuestionContent, setNewQuestionContent] = useState("");
 const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
 const [replyTexts, setReplyTexts] = useState<{
 [questionId: string]: string;
 }>({});
 const [likedItems, setLikedItems] = useState<string[]>([]);
 const [editingQuestionId, setEditingQuestionId] = useState<string | null>(
 null,
 );
 const [editedQuestionContent, setEditedQuestionContent] = useState("");
 const [deleteConfirmQuestionId, setDeleteConfirmQuestionId] = useState<
 string | null
 >(null);
 const [editingAnswerId, setEditingAnswerId] = useState<string | null>(null);
 const [editedAnswerContent, setEditedAnswerContent] = useState("");
 const [deleteConfirmAnswerId, setDeleteConfirmAnswerId] = useState<
 string | null
 >(null);

 // Moderation state
 const [blockedUserIds, setBlockedUserIds] = useState<Set<string>>(new Set());
 const [revealedComments, setRevealedComments] = useState<Set<string>>(new Set());
 const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
 const [reportSuccessId, setReportSuccessId] = useState<string | null>(null);
 const [showGuidelines, setShowGuidelines] = useState(false);
 const guidelinesKey = "qa_guidelines_accepted_v1";

 // selection / interactive haptic triggers on tab, question, and card transitions
 const lastActiveTabRef = useRef(activeTab);
 const lastQuestionIdxRef = useRef(currentQuestionIndex);
 const lastCardIdxRef = useRef(currentCardIndex);
 const lastIsFlippedRef = useRef(isFlipped);

 useEffect(() => {
 if (activeTab !== lastActiveTabRef.current) {
 lastActiveTabRef.current = activeTab;
 }
 }, [activeTab]);

 useEffect(() => {
 if (currentQuestionIndex !== lastQuestionIdxRef.current) {
 lastQuestionIdxRef.current = currentQuestionIndex;
 }
 }, [currentQuestionIndex]);

 useEffect(() => {
 if (currentCardIndex !== lastCardIdxRef.current) {
 lastCardIdxRef.current = currentCardIndex;
 }
 }, [currentCardIndex]);

 useEffect(() => {
 if (isFlipped !== lastIsFlippedRef.current) {
 lastIsFlippedRef.current = isFlipped;
 }
 }, [isFlipped]);

 // Dynamic fetch of user-created flashcards for this lecture
 useEffect(() => {
 const fetchCustomFlashcards = async () => {
 try {
 const res = await apiClient("/api/flashcards");
 if (res.ok) {
 const allCards = await res.json();
 const relevant = Array.isArray(allCards) ? allCards.filter(
 (c: any) => c.lectureId === lecture.id, ) : [];
 setCustomFlashcards(relevant);
 }
 } catch (err) {
 
 }
 };
 fetchCustomFlashcards();
 }, [lecture.id, activeTab]);

 
  // Fetch flashcard progress from server on mount
  useEffect(() => {
    const fetchFlashcardProgress = async () => {
      try {
        const res = await apiClient("/api/flashcards/progress");
        if (res.ok) {
          const data = await res.json();
          setCardStats(data);
        }
      } catch (err) {
      }
    };
    fetchFlashcardProgress();
  }, [lecture.id]);

  // 1. Preload local saved personal notes and Q&As specific to this lecture on boot

 useEffect(() => {
 // Load notes
 const savedNotes = localStorage.getItem(`notes_${lecture.id}`);
 if (savedNotes) {
 setPersonalNotes(savedNotes);
 } else {
 setPersonalNotes("");
 }

 // Load liked items registry
 const storedLikes = localStorage.getItem(`likes_${lecture.id}`);
 if (storedLikes) {
 try {
 setLikedItems(safeJsonParse(storedLikes, []));
 } catch (e) {
 setLikedItems([]);
 }
 } else {
 setLikedItems([]);
 }

 // Q&As are now fetched from the API (see fetchQA below)

 // Prepare quiz questions (Rule 2)
  let relevantMCQs: MCQ[] = [];
   if (lecture.isDatabaseLecture && detailedLecture.mcqs && detailedLecture.mcqs.length > 0) {
  relevantMCQs = detailedLecture.mcqs.map((m: any) => ({
  id: m.id,
  lectureId: lecture.id,
  question: m.question,
  optionA: m.optionA,
  optionB: m.optionB,
  optionC: m.optionC,
  optionD: m.optionD,
  explanation: m.explanation || m.hint || undefined,
  sourceType: "book",
  sourceRef: undefined,
  difficulty: "Medium",
  }));
 } else {
 relevantMCQs = mcqs.filter((m) => m.lectureId === lecture.id);
 }

 setQuizQuestions(relevantMCQs);

  // Reset quiz state
  setCurrentQuestionIndex(0);
  setAnswersMap({});
  setShowHint(false);
  setQuizSubmitted(false);
  setQuizResults({});

 // Reset Flashcards
 setCurrentCardIndex(0);
 setIsFlipped(false);
 setDeckFinished(false);
 setRepeatFilter(null);

 // Restore document clicked/opened states from localStorage instead of resetting to false
 setHasOpenedPdf(
 localStorage.getItem(`uob_has_opened_pdf_${lecture.id}`) === "true",
 );
 setHasOpenedNotes(
 localStorage.getItem(`uob_has_opened_notes_${lecture.id}`) === "true",
 );
  }, [lecture, detailedLecture]);

 // Flashcards self-rating
 
  // End of Session logic
  const handleEndOfSession = async (finalUpdates: Record<string, "easy" | "medium" | "hard">) => {
    setDeckFinished(true);
    setCardStats((prev) => ({ ...prev, ...finalUpdates }));
    
    try {
      await apiClient("/api/flashcards/batch-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: finalUpdates })
      });
    } catch (err) {
    }

    if (!progress.flashcardsCompleted) {
      onUpdateProgress({ flashcardsCompleted: true });
      onAddPoints(
        4,
        `Completed active Flashcard session on ${lecture.title}`,
      );
    }
    setUpdatedCardStatuses({});
  };

  const handleCardRate = (rating: "easy" | "medium" | "hard") => {
    const relevantCards = getRelevantCards();
    const baseCards =
      relevantCards.length > 0
        ? relevantCards
        : [
            {
              id: `fallback_fc_1_${lecture.id}`,
              lectureId: lecture.id,
              front:
                "What is the primary diagnostic sign for this clinical condition?",
              back: "Rapid onset swelling, erythematous boundaries, and positive local tenderness indicators.",
            },
            {
              id: `fallback_fc_2_${lecture.id}`,
              lectureId: lecture.id,
              front: "Describe the standard first-line therapeutic management.",
              back: "Immediate fluid resuscitation, baseline serum titers, and administration of empiric broad-spectrum coverage.",
            },
            {
              id: `fallback_fc_3_${lecture.id}`,
              lectureId: lecture.id,
              front:
                "What is the most critical complication if left untreated?",
              back: "Progressive systemic spread leading to severe bacteremia, clinical shock or multi-organ failure.",
            },
          ];

    const activeCards = (() => {
      if (repeatFilter === "hard") return baseCards.filter((c: any) => cardStats[c.id] === "hard");
      if (repeatFilter === "medium") return baseCards.filter((c: any) => cardStats[c.id] === "medium");
      if (repeatFilter === "easy") return baseCards.filter((c: any) => cardStats[c.id] === "easy");
      return baseCards;
    })();

    const cardId = activeCards[currentCardIndex]?.id || `fc_temp_${currentCardIndex}`;
    
    const nextUpdates = { ...updatedCardStatuses, [cardId]: rating };
    setUpdatedCardStatuses(nextUpdates);

    setIsFlipped(false);

    if (currentCardIndex < activeCards.length - 1) {
      setCurrentCardIndex(currentCardIndex + 1);
    } else {
      handleEndOfSession(nextUpdates);
    }
  };


  // Keyboard Shortcuts for Flashcards
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeTab !== "flashcards" || deckFinished) return;
      
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }
      
      if (e.code === "Space") {
        e.preventDefault();
        setIsFlipped((prev) => !prev);
      } else if (e.key === "1") {
        if (isFlipped) {
          e.preventDefault();
          handleCardRate("hard");
        }
      } else if (e.key === "2") {
        if (isFlipped) {
          e.preventDefault();
          handleCardRate("medium");
        }
      } else if (e.key === "3") {
        if (isFlipped) {
          e.preventDefault();
          handleCardRate("easy");
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (currentCardIndex > 0) {
          setCurrentCardIndex((prev) => prev - 1);
          setIsFlipped(false);
        }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const relevantCards = getRelevantCards();
        const baseCards =
          relevantCards.length > 0
            ? relevantCards
            : [
                { id: `fallback_fc_1_${lecture.id}` },
                { id: `fallback_fc_2_${lecture.id}` },
                { id: `fallback_fc_3_${lecture.id}` }
              ];
        const activeCards = (() => {
      if (repeatFilter === "hard") return baseCards.filter((c: any) => cardStats[c.id] === "hard");
      if (repeatFilter === "medium") return baseCards.filter((c: any) => cardStats[c.id] === "medium");
      if (repeatFilter === "easy") return baseCards.filter((c: any) => cardStats[c.id] === "easy");
      return baseCards;
    })();
        
        if (currentCardIndex < activeCards.length - 1) {
          setCurrentCardIndex((prev) => prev + 1);
          setIsFlipped(false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeTab, 
    isFlipped, 
    currentCardIndex, 
    deckFinished, 
    getRelevantCards, 
    handleCardRate, 
    repeatFilter, 
    cardStats, 
    lecture.id
  ]);

 // Quiz submission — grading is authoritative on the server so the correct
 // answer key is never shipped to the client before submission.
 const handleQuizSubmit = async () => {
  const total = quizQuestions.length;
  if (total === 0) return;

  const answers = quizQuestions.map((q) => ({
  id: q.id,
  answer: answersMap[q.id] || null,
  }));

  let verifiedResults: {
  [questionId: string]: {
  correct: boolean;
  correctAnswer?: "A" | "B" | "C" | "D" | null;
  explanation?: string;
  };
  } = {};

  try {
  const res = await apiClient("/api/mcqs/submit", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ answers }),
  silent: true,
  });
  if (!res.ok) throw new Error("Submission rejected by server.");

  const data = await res.json();
  const serverResults: any[] = Array.isArray(data?.results) ? data.results : [];
  verifiedResults = {};
  serverResults.forEach((r: any) => {
  if (r && typeof r.id === "string") {
  verifiedResults[r.id] = {
  correct: r.correct === true,
  correctAnswer: r.correctAnswer,
  explanation: typeof r.explanation === "string" ? r.explanation : undefined,
  };
  }
  });
  } catch {
  showiOSAlert({
  title: "Submission Failed",
  message:
  "Your answers could not be verified right now. Please check your connection and try again.",
  actions: [{ label: "OK", style: "default" }],
  });
  return;
  }

  setQuizResults(verifiedResults);

  const correctCount = quizQuestions.reduce(
  (acc, q) => acc + (verifiedResults[q.id]?.correct ? 1 : 0),
  0,
  );

  const finalScore = Math.round((correctCount / total) * 100);
  setQuizScorePct(finalScore);
  setQuizSubmitted(true);

  // Award Points
  if (!progress.quizCompleted) {
  let earnedPoints = 5;
  let reason = `Passed active MCQ module quiz for ${lecture.title} with scale ${finalScore}%`;

  if (finalScore >= 80) {
  earnedPoints += 3; // high score bonus as specified in guidelines
  reason += " (+3 High Score Honors!)";
  }

  onUpdateProgress({ quizCompleted: true, quizScore: finalScore });
  onAddPoints(earnedPoints, reason);
  }
  };

 // Extract YouTube video ID from any YouTube URL format
 const extractYouTubeId = (url: string): string | null => {
   const match = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
   return match ? match[1] : null;
 };

  // Video watching
  // - Capacitor/native iOS: preserve the existing native bridge behavior exactly.
  // - Mobile Web/PWA: launch the installed YouTube app directly via its app scheme.
  // - Desktop Web: open the normal HTTPS YouTube URL in a new tab.
  const handleWatchVideo = async (youtubeUrl: string) => {
    const cleanUrl =
      typeof youtubeUrl === "string"
        ? youtubeUrl.trim()
        : "";

    console.log("[YT TAP] handleWatchVideo ENTER", {
      youtubeUrl: cleanUrl,
      isNativeIOS,
      isNativePlatform: NativeBridge.isNativePlatform(),
      platform: NativeBridge.getPlatformName(),
    });

    if (!cleanUrl) {
      console.error("[YT TAP] YouTube URL is empty");
      return;
    }

    const videoId = extractYouTubeId(cleanUrl);

    console.log("[YT TAP] parsed videoId =", videoId);

    if (!videoId) {
      console.error("[YT TAP] Invalid YouTube URL:", cleanUrl);

      showiOSAlert({
        title: "Unable to Open Video",
        message: "This YouTube link is invalid.",
        actions: [{ label: "OK", style: "default" }],
      });

      return;
    }

    try {
      if (isNativeIOS) {
        // IMPORTANT: Do not change Capacitor/Xcode behavior.
        console.log("[YT TAP] Native iOS path selected");

        youtubeExternalOpenRef.current = true;
        await NativeBridge.openYouTubeUrl(cleanUrl);
      } else {
        console.log("[YT TAP] Web/PWA path selected");

        const userAgent = navigator.userAgent || "";
        const isIOSWeb =
          /iPad|iPhone|iPod/i.test(userAgent) ||
          (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
        const isAndroidWeb = /Android/i.test(userAgent);

        if (isIOSWeb) {
          // Avoid opening about:blank/Safari first. iOS hands this scheme
          // directly to the installed YouTube application.
          const youtubeAppUrl =
            `youtube://watch?v=${encodeURIComponent(videoId)}`;

          window.location.assign(youtubeAppUrl);
        } else if (isAndroidWeb) {
          // Ask Android to open the official YouTube package directly.
          const youtubeIntentUrl =
            `intent://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` +
            `#Intent;package=com.google.android.youtube;scheme=https;end`;

          window.location.assign(youtubeIntentUrl);
        } else {
          // Desktop Web/PWA:
          // Open YouTube exactly once in the user's normal browser.
          // Do NOT use the return value of window.open() as a popup-block test:
          // with noopener/noreferrer some browsers legitimately return null even
          // when the new tab was opened successfully, which previously caused
          // a second navigation inside the PWA.
          window.open(cleanUrl, "_blank", "noopener,noreferrer");
        }
      }
    } catch (error) {
      youtubeExternalOpenRef.current = false;

      console.error("[YT TAP] YouTube opening FAILED:", error);

      showiOSAlert({
        title: "Unable to Open YouTube",
        message:
          "The YouTube application could not be opened. Please make sure YouTube is installed and try again.",
        actions: [{ label: "OK", style: "default" }],
      });

      return;
    }

    if (!videoWatched) {
      setVideoWatched(true);
      onUpdateProgress({ videoCompleted: true });
      onAddPoints(
        3,
        `Watched medical video tutorial for ${lecture.title}`,
      );
    }
  };

 // ── Q&A: fetch from API ──────────────────────────────────────────
 const fetchQA = useCallback(async () => {
   try {
     const res = await apiClient(`/api/qa/${lecture.id}`);
     if (res.ok) setLectureQuestions(await res.json());
   } catch { /* silently ignore on network failure */ }
 }, [lecture.id]);

 useEffect(() => { fetchQA(); }, [fetchQA]);

 // ── Real-time Q&A sync via socket events dispatched from App.tsx ────────────
 useEffect(() => {
   const onQuestionCreated = (e: Event) => {
     const q = (e as CustomEvent).detail;
     if (q.lectureId !== lecture.id) return;
     setLectureQuestions((prev) =>
       prev.some((x) => x.id === q.id) ? prev : [q, ...prev]
     );
   };

   const onQuestionUpdated = (e: Event) => {
     const upd = (e as CustomEvent).detail;
     setLectureQuestions((prev) =>
       prev.map((q) =>
         q.id === upd.id
           ? {
               ...q,
               ...(upd.content !== undefined && { content: upd.content }),
               ...(upd.upvotes !== undefined && { upvotes: upd.upvotes }),
             }
           : q
       )
     );
   };

   const onQuestionDeleted = (e: Event) => {
     const { questionId } = (e as CustomEvent).detail;
     setLectureQuestions((prev) => prev.filter((q) => q.id !== questionId));
   };

   const onAnswerCreated = (e: Event) => {
     const ans = (e as CustomEvent).detail;
     setLectureQuestions((prev) =>
       prev.map((q) => {
         if (q.id !== ans.questionId) return q;
         if ((q.answers as any[]).some((a: any) => a.id === ans.id)) return q;
         return { ...q, answers: [...(q.answers as any[]), ans] };
       })
     );
   };

   const onAnswerUpdated = (e: Event) => {
     const upd = (e as CustomEvent).detail;
     setLectureQuestions((prev) =>
       prev.map((q) => {
         if (q.id !== upd.questionId) return q;
         return {
           ...q,
           answers: (q.answers as any[]).map((a: any) => {
             if (a.id === upd.id) {
               return {
                 ...a,
                 ...(upd.content !== undefined && { content: upd.content }),
                 ...(upd.upvotes !== undefined && { upvotes: upd.upvotes }),
                 ...(upd.isBest !== undefined && { isBest: upd.isBest }),
               };
             }
             // When a new best answer is set, clear isBest on all others
             if (upd.isBest === true) return { ...a, isBest: false };
             return a;
           }),
         };
       })
     );
   };

   const onAnswerDeleted = (e: Event) => {
     const { answerId, questionId } = (e as CustomEvent).detail;
     setLectureQuestions((prev) =>
       prev.map((q) =>
         q.id === questionId
           ? { ...q, answers: (q.answers as any[]).filter((a: any) => a.id !== answerId) }
           : q
       )
     );
   };

   window.addEventListener("socket-qa-question-created", onQuestionCreated);
   window.addEventListener("socket-qa-question-updated", onQuestionUpdated);
   window.addEventListener("socket-qa-question-deleted", onQuestionDeleted);
   window.addEventListener("socket-qa-answer-created", onAnswerCreated);
   window.addEventListener("socket-qa-answer-updated", onAnswerUpdated);
   window.addEventListener("socket-qa-answer-deleted", onAnswerDeleted);

   return () => {
     window.removeEventListener("socket-qa-question-created", onQuestionCreated);
     window.removeEventListener("socket-qa-question-updated", onQuestionUpdated);
     window.removeEventListener("socket-qa-question-deleted", onQuestionDeleted);
     window.removeEventListener("socket-qa-answer-created", onAnswerCreated);
     window.removeEventListener("socket-qa-answer-updated", onAnswerUpdated);
     window.removeEventListener("socket-qa-answer-deleted", onAnswerDeleted);
   };
 }, [lecture.id]);

 // Fetch blocked user IDs so we can filter Q&A content client-side
 useEffect(() => {
   apiClient("/api/blocks/ids")
     .then((r) => r.ok ? r.json() : [])
     .then((ids: string[]) => setBlockedUserIds(new Set(ids)))
     .catch(() => {});
 }, []);

 // Post Question inside Forum
 const handlePostQuestion = async (e: React.FormEvent) => {
 e.preventDefault();
 if (!newQuestionContent.trim()) return;

 // Require guidelines acceptance before first post
 if (!localStorage.getItem(guidelinesKey)) {
   setShowGuidelines(true);
   return;
 }

 try {
   const res = await apiClient(`/api/qa/${lecture.id}/questions`, {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ content: newQuestionContent.trim() }),
   });
   if (res.ok) {
     const newQ = await res.json();
     setLectureQuestions((prev) => [newQ, ...prev]);
     setNewQuestionContent("");
     onAddPoints(1, `Posted lecture clinical inquiry inside ${lecture.title} forum`);
   } else if (res.status === 403) {
     const data = await res.json().catch(() => ({}));
     const msg = data.error || (isRtl ? "أنت محظور من المشاركة في النقاشات." : "You are currently muted and cannot participate in discussions.");
     setPostMuteError(msg);
     setTimeout(() => setPostMuteError(null), 5000);
   }
 } catch { /* ignore */ }
 };

 // Edit Question content helper
 const handleEditQuestion = async (qId: string, updatedContent: string) => {
 if (!updatedContent.trim()) return;
 try {
   const res = await apiClient(`/api/qa/questions/${qId}`, {
     method: "PUT",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ content: updatedContent.trim() }),
   });
   if (res.ok) {
     setLectureQuestions((prev) =>
       prev.map((q) => q.id === qId ? { ...q, content: updatedContent.trim() } : q)
     );
   }
 } catch { /* ignore */ } finally {
   setEditingQuestionId(null);
 }
 };

 // Delete Question helper
 const handleDeleteQuestion = async (qId: string) => {
 try {
   const res = await apiClient(`/api/qa/questions/${qId}`, { method: "DELETE" });
   if (res.ok) setLectureQuestions((prev) => prev.filter((q) => q.id !== qId));
 } catch { /* ignore */ }
 };

 // Edit Answer helper
 const handleEditAnswer = async (qId: string, ansId: string, updatedContent: string) => {
 if (!updatedContent.trim()) return;
 try {
   const res = await apiClient(`/api/qa/answers/${ansId}`, {
     method: "PUT",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ content: updatedContent.trim() }),
   });
   if (res.ok) {
     setLectureQuestions((prev) =>
       prev.map((q) => q.id === qId
         ? { ...q, answers: q.answers.map((a) => a.id === ansId ? { ...a, content: updatedContent.trim() } : a) }
         : q
       )
     );
   }
 } catch { /* ignore */ } finally {
   setEditingAnswerId(null);
 }
 };

 // Delete Answer helper
 
    const handleDeleteLecture = async () => {
      showiOSAlert({
        title: isRtl ? "تأكيد حذف المحاضرة" : "Confirm Lecture Deletion",
        message: isRtl ? "هل أنت متأكد من حذف هذه المحاضرة؟ سيتم مسح كافة البيانات المرتبطة بها نهائياً." : "Are you sure you want to delete this lecture? All associated materials will be permanently removed.",
        actions: [
          { label: isRtl ? "إلغاء" : "Cancel", style: "cancel" },
          {
            label: isRtl ? "تأكيد الحذف" : "Delete",
            style: "destructive",
            onClick: async () => {
              try {
                const res = await apiClient(`/api/lectures/${lecture.id}`, { method: "DELETE" });
                if (!res.ok) throw new Error("Failed to delete lecture.");
                onBack();
              } catch (e: any) {
                showiOSAlert({ title: "Error", message: e.message, actions: [{ label: "OK", style: "cancel" }] });
              }
            }
          }
        ]
      });
    };
const handleDeleteAnswer = async (qId: string, ansId: string) => {
 try {
   const res = await apiClient(`/api/qa/answers/${ansId}`, { method: "DELETE" });
   if (res.ok) {
     setLectureQuestions((prev) =>
       prev.map((q) => q.id === qId
         ? { ...q, answers: q.answers.filter((a) => a.id !== ansId) }
         : q
       )
     );
   }
 } catch { /* ignore */ }
 };

 // Post Answer response
 const handlePostAnswer = async (questionId: string) => {
 const textContent = replyTexts[questionId] || "";
 if (!textContent.trim()) return;
 try {
   const res = await apiClient(`/api/qa/questions/${questionId}/answers`, {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ content: textContent.trim() }),
   });
   if (res.ok) {
     const newAns = await res.json();
     setLectureQuestions((prev) =>
       prev.map((q) => q.id === questionId ? { ...q, answers: [...q.answers, newAns] } : q)
     );
     setReplyTexts((prev) => ({ ...prev, [questionId]: "" }));
     onAddPoints(2, "Replied to collaborative peer clinical query");
   } else if (res.status === 403) {
     const data = await res.json().catch(() => ({}));
     const msg = data.error || (isRtl ? "أنت محظور من المشاركة في النقاشات." : "You are currently muted and cannot participate in discussions.");
     setPostMuteError(msg);
     setTimeout(() => setPostMuteError(null), 5000);
   }
 } catch { /* ignore */ }
 };

 // Deselect/Remove Best Answer helper
 const handleRemoveBestAnswer = async (qId: string, ansId: string) => {
 try {
   const res = await apiClient(`/api/qa/answers/${ansId}/best`, {
     method: "PATCH",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ isBest: false }),
   });
   if (res.ok) {
     setLectureQuestions((prev) =>
       prev.map((q) => q.id === qId
         ? { ...q, answers: q.answers.map((a) => a.id === ansId ? { ...a, isBest: false } : a) }
         : q
       )
     );
   }
 } catch { /* ignore */ }
 };

 // Upvote/Like Toggle Engine ensuring 1-like-per-student rule
 const toggleLikeItem = (itemId: string) => {
 const wasLiked = likedItems.includes(itemId);
 let nextLiked: string[];
 if (wasLiked) {
 nextLiked = likedItems.filter((id) => id !== itemId);
 } else {
 nextLiked = [...likedItems, itemId];
 }
 setLikedItems(nextLiked);
 localStorage.setItem(`likes_${lecture.id}`, JSON.stringify(nextLiked));
 return wasLiked;
 };

 // Upvote Question
 const handleUpvoteQuestion = async (qId: string) => {
 const wasLiked = toggleLikeItem(qId);
 const delta = wasLiked ? -1 : 1;
 setLectureQuestions((prev) =>
   prev.map((q) => q.id === qId ? { ...q, upvotes: Math.max(0, q.upvotes + delta) } : q)
 );
 try {
   await apiClient(`/api/qa/questions/${qId}/upvote`, {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ delta }),
   });
 } catch { /* ignore — local state already updated */ }
 };

 // Upvote Answer
 const handleUpvoteAnswer = async (qId: string, ansId: string) => {
 const wasLiked = toggleLikeItem(ansId);
 const delta = wasLiked ? -1 : 1;
 setLectureQuestions((prev) =>
   prev.map((q) => q.id === qId
     ? { ...q, answers: q.answers.map((a) => a.id === ansId ? { ...a, upvotes: Math.max(0, a.upvotes + delta) } : a) }
     : q
   )
 );
 try {
   await apiClient(`/api/qa/answers/${ansId}/upvote`, {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ delta }),
   });
 } catch { /* ignore */ }
 };

 // Highlight Best Answer (only if student belongs to this lecture thread)
 const handleSetBestAnswer = async (qId: string, ansId: string) => {
 try {
   const res = await apiClient(`/api/qa/answers/${ansId}/best`, {
     method: "PATCH",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ isBest: true }),
   });
   if (res.ok) {
     setLectureQuestions((prev) =>
       prev.map((q) => q.id === qId
         ? { ...q, answers: q.answers.map((a) => ({ ...a, isBest: a.id === ansId })) }
         : q
       )
     );
     onAddPoints(1, "Clinical answer nominated as Recommended Resolution");
   }
 } catch { /* ignore */ }
 };

 // Block a user from the Q&A forum
 const handleBlockUser = async (blockedId: string) => {
 if (!blockedId || blockedId === currentUser.id) return;
 try {
   const res = await apiClient("/api/blocks", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ blockedId }),
   });
   if (res.ok || res.status === 409) {
     setBlockedUserIds((prev) => new Set([...prev, blockedId]));
   } else {
     showiOSAlert({ title: "Block Failed", message: "Could not block this user. Please try again.", actions: [{ label: "OK", style: "cancel" }] });
   }
 } catch {
   showiOSAlert({ title: "Block Failed", message: "Network error. Please check your connection.", actions: [{ label: "OK", style: "cancel" }] });
 }
 };

 // Filter quiz questions by source
 const filteredQuizQuestions = useMemo(() => {
   return quizQuestions.filter((q) => {
     if (quizSource === "all") return true;
     return q.sourceType === quizSource;
   });
 }, [quizQuestions, quizSource]);


 return (
  <div className="lecture-detail-view space-y-6 animate-fadeIn pb-12 antialiased">
 {/* 1. Header Toolbar */}
  <div className="lecture-detail-header flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/80 dark:bg-[#1C1C1E]/80 backdrop-blur-sm p-4 sm:p-5 border border-black/[0.04] dark:border-white/[0.06] rounded-xl shadow-elevation-1 dark:shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
 <div className="flex items-center gap-3 w-full sm:w-auto -ml-1">
 <motion.button
 type="button"
 onClick={(e) => {
 e.stopPropagation();
 onBack();
 }}
 initial={{ x: isRtl ? 15 : -15, opacity: 0 }}
 animate={{ x: 0, opacity: 1 }}
 transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
 className="lecture-detail-back flex items-center gap-1 text-med-blue hover:text-med-blue dark:text-blue-400 font-medium px-2 py-2 rounded-lg transition-colors cursor-pointer/40 shrink-0"
 title={isRtl ? "رجوع" : "Back"}
 >
 {isRtl ? (
 <ChevronRight className="w-icon-md h-icon-md -mt-[1px]" />
 ) : (
 <ChevronLeft className="w-icon-md h-icon-md -mt-[1px]" />
 )}
 <span className="text-base tracking-[-0.015em] hidden xs:inline">{isRtl ? "رجوع" : "Back"}</span>
 </motion.button>
        {(currentUser?.role === 'admin' || currentUser?.role === 'owner') && (
          <button 
             type="button" 
             onClick={handleDeleteLecture} 
             className="flex items-center gap-1 text-rose-500 hover:text-rose-600 bg-rose-50 dark:bg-rose-500/10 px-3 py-1.5 rounded-lg text-sm font-semibold transition"
          >
             <Trash2 className="w-4 h-4" />
             {isRtl ? "حذف" : "Delete"}
          </button>
        )}
  <div className="flex flex-col min-w-0 pr-1">
 <div className="flex items-center gap-2 overflow-hidden">
 <span className="text-xs font-semibold font-mono text-neutral-500 dark:text-[var(--text-secondary)] bg-black/[0.04] dark:bg-white/[0.06] px-2 py-1 rounded-md shrink-0 antialiased">
 LECTURE {lecture.orderNumber}
 </span>
 <span className="text-sm font-medium text-neutral-500 dark:text-[#EBEBF599] dark:text-[var(--text-muted)] truncate min-w-0 antialiased">
 {lecture.category}
 </span>
 </div>
 <h1 className="text-lg sm:text-2xl leading-[1.25] font-display font-semibold text-neutral-900 dark:text-[var(--text-primary)] mt-1 antialiased whitespace-normal break-words [overflow-wrap:anywhere] max-w-full">
 {lecture.title}
 </h1>

 {/* In-place calendar synchronization notification badge */}
 {(() => {
 const matchedEvent = calendarEvents?.find((evt) => {
 const isLecType =
 evt.eventType === "LECTURE" || evt.type === "lecture";
 if (!isLecType) return false;
 if (evt.lectureId && evt.lectureId === lecture.id) return true;
 const evtTitle = (evt.title || "").trim().toLowerCase();
 const lecTitle = (lecture.title || "").trim().toLowerCase();
 return (
 evtTitle === lecTitle ||
 evtTitle.includes(lecTitle) ||
 lecTitle.includes(evtTitle)
 );
 });

 if (!matchedEvent) return null;

 const parsed = matchedEvent.startDateTime
 ? parseBaghdadDate(matchedEvent.startDateTime)
 : null;

 const dateStr = parsed
 ? parsed
 .locale(language === "ar" ? "ar" : "en")
 .format("MMM DD, YYYY")
 : matchedEvent.date;

 const timeStr = parsed
 ? parsed.format("hh:mm A")
 : matchedEvent.time;

 return (
 <div className="flex items-center gap-2 mt-4 text-xs font-medium text-neutral-700 dark:text-[#EBEBF599] bg-white/60 dark:bg-[#1C1C1E]/60 backdrop-blur-sm px-3 py-2 rounded-full border border-black/5 dark:border-white/[0.12] w-fit shadow-elevation-1 antialiased hover:shadow-elevation-1 transition cursor-default group/schedule">
 <div className="w-icon-md h-icon-md rounded-full bg-blue-100 dark:bg-med-blue/20 flex items-center justify-center shrink-0">
 <Calendar className="w-3 h-3 text-med-blue dark:text-blue-400 group-hover/schedule:scale-110 transition-transform" />
 </div>
 <span className="flex items-center gap-2 opacity-90">
 {isRtl ? "وقت الجلسة المجدول:" : "Scheduled Session"}
 <span className="font-semibold text-neutral-900 dark:text-white bg-black/5 dark:bg-white/[0.12] px-2 py-1 rounded-md">{dateStr} • {timeStr}</span>
 </span>
 </div>
 );
 })()}
 </div>
 </div>

 {/* Global tab shortcuts inside header */}
  <div className="lecture-tabbar relative bg-black/[0.04] dark:bg-white/[0.06] p-1 rounded-lg flex items-center select-none h-8 w-full sm:w-auto sm:min-w-[420px] shrink-0 antialiased">
 {[
 { id: "pdf", label: "PDF" },
 { id: "notes", label: "Notes" },
 { id: "mcqs", label: "MCQ" },
 { id: "flashcards", label: "Anki" },
 { id: "videos", label: "Video" },
 { id: "qa", label: "Q&A" },
 ].map((tab, index, array) => {
 const isActive = activeTab === tab.id;
 const nextIsActive =
 index < array.length - 1 && activeTab === array[index + 1].id;
 const showDivider =
 index < array.length - 1 && !isActive && !nextIsActive;

 return (
 <div
 key={tab.id}
 className="relative flex-1 flex items-center h-full"
 >
 <motion.button
 type="button"
 whileTap={{ scale: 0.95 }}
 onClick={() => {
 setActiveTab(tab.id as any);
 }}
 className={`relative rounded-lg text-sm font-medium cursor-pointer transition-colors duration-[250ms] flex-1 select-none z-10 flex items-center justify-center w-full h-full`}
 >
 {isActive && (
 <motion.div
 layoutId="activeLectureTabPill"
 className="absolute inset-0 bg-white dark:bg-neutral-700 shadow-elevation-1 border border-black/5 dark:border-white/[0.12] rounded-lg -z-10"
 transition={{
 type: "spring",
 stiffness: 400,
 damping: 40,
 mass: 1,
 }}
 />
 )}
 <span
 className={`relative text-center whitespace-nowrap transition-colors duration-[250ms] ${
 isActive
 ? "text-black dark:text-[var(--text-primary)] font-semibold"
 : "text-neutral-500 dark:text-[var(--text-secondary)] hover:text-neutral-800 dark:text-white dark:hover:text-neutral-200"
 }`}
 >
 {tab.label}
 </span>
 </motion.button>

 {showDivider && (
 <div className="absolute right-0 top-[20%] bottom-[20%] w-0 bg-black/[0.1] dark:bg-white/[0.1] z-0" />
 )}
 </div>
 );
 })}
 </div>
 </div>

   {/* 2. Workspace View Tabs Rendering */}
  <motion.div
    transition={{ type: "spring", stiffness: 500, damping: 40, mass: 1 }}
    className="bg-white dark:bg-[#1C1C1E] border border-med-beige/60 dark:border-transparent rounded-lg shadow-elevation-1 min-h-[200px] flex flex-col relative"
  >
  <AnimatePresence mode="popLayout" initial={false}>
  {/* TAB 1: ORIGINAL PDF VIEWING SLIDES - NOW A PRISTINE PDF DIRECT-CLICK LINK ENGAGE CARD */}
 {activeTab === "pdf" && (
 <motion.div
  key="pdf"
  initial={{ opacity: 0, scale: 0.98 }}
  animate={{ opacity: 1, scale: 1 }}
  exit={{ opacity: 0, scale: 0.98 }}
  transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
  className="p-8 space-y-8 flex-1 flex flex-col justify-center items-center text-center w-full"
  style={{ direction: isRtl ? "rtl" : "ltr" }}
 >
 <div className="max-w-md w-full space-y-section">
 <div className="space-y-2">
 <h2 className="text-headline font-display font-semibold text-neutral-800 dark:text-[var(--text-primary)] leading-snug whitespace-normal break-words [overflow-wrap:anywhere] max-w-full">
 {lecture.title}
 </h2>
 </div>

 {/* Central Actions: Direct Open PDF Button - NEATLY CENTERED */}
 <div className="pt-2 flex justify-center w-full">
 {!lecture.pdfUrl ? (
 <div className="flex flex-col items-center justify-center py-16 px-6 text-center w-full antialiased">
 <div className="relative mb-6">
 
 <div className="relative w-20 h-20 rounded-full bg-white dark:bg-[#1C1C1E] flex items-center justify-center ring-1 ring-black/[0.04] dark:ring-white/[0.06] shadow-elevation-1 dark:shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
 <FileText className="w-10 h-10 text-neutral-500 dark:text-[#EBEBF599] dark:text-[var(--text-muted)]" />
 </div>
 </div>
 <h3 className="font-display text-xl font-semibold text-neutral-900 dark:text-[var(--text-primary)] mb-2">
 {isRtl ? "لا توجد ملفات PDF" : "No PDF File"}
 </h3>
 <p className="text-base font-medium text-neutral-500 dark:text-[var(--text-secondary)] max-w-[280px] text-balance">
 {isRtl
 ? "لم يتم العثور على ملفات PDF رسمية لهذه المحاضرة بعد."
 : "No standard academic PDF modules are currently uploaded for this lecture."}
 </p>
 </div>
 ) : (
  <div className="flex flex-col items-center gap-4 w-full">
    <button
      type="button"
      onClick={handlePdfButtonActivate}
      className="document-open-button w-full sm:w-auto px-8 py-4 bg-med-blue text-white rounded-lg text-base font-semibold flex items-center justify-center gap-3 cursor-pointer shadow-elevation-1 antialiased"
    >
      <ExternalLink className="w-icon-sm h-icon-sm pointer-events-none" />{" "}
      {isRtl
        ? "فتح ملف المحاضرة"
        : "Open PDF Document"}
    </button>

 {(hasViewedPdf ||
 hasOpenedPdf ||
 progress.pdfCompleted) &&
 !isPdfCompleted &&
 !progress.pdfCompleted && (
 <button
 type="button"
 data-haptic="none"
 onClick={handleMarkPdfCompleted}
 className="w-full sm:w-auto px-8 py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-base font-semibold flex items-center justify-center gap-3 cursor-pointer shadow-elevation-1 hover:shadow-elevation-1 antialiased"
 >
 <CheckCircle className="w-icon-sm h-icon-sm" />{" "}
 {isRtl ? "تحديد كمكتمل" : "Mark as Completed"}
 </button>
 )}
 </div>
 )}
 </div>

 {/* Status and Ledger alert */}
 <div className="bg-black/[0.02] dark:bg-white/[0.08] border border-black/[0.04] dark:border-white/[0.04] p-4 rounded-lg max-w-xs mx-auto text-center antialiased">
 <div className="flex items-center gap-3 justify-center">
 {isPdfCompleted || progress.pdfCompleted ? (
 <>
 <CheckCircle className="w-icon-md h-icon-md text-emerald-500 shrink-0" />
 <span className="font-semibold text-sm text-emerald-700 dark:text-emerald-400">
 {isRtl ? "تمت قراءتها ومراجعتها" : "Completed & Read"}
 </span>
 </>
 ) : (
 <>
 <div className="w-2 h-2 rounded-full bg-med-gold shrink-0 shadow-elevation-1"></div>
 <span className="font-semibold text-sm text-[#9A3412] dark:text-[#f97316]">
 {isRtl ? "غير مقروءة" : "Unread"}
 </span>
 </>
 )}
 </div>
 </div>
 </div>
 </motion.div>
 )}

 {/* TAB 2: ENRICHED STUDENT/AI NOTES - REORGANIZED TO MATCH PDF STYLE EXACTLY WITH PURPLE COLOR ACCENTS */}
 {activeTab === "notes" && (
 <motion.div
  key="notes"
  initial={{ opacity: 0, scale: 0.98 }}
  animate={{ opacity: 1, scale: 1 }}
  exit={{ opacity: 0, scale: 0.98 }}
  transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
  className="p-8 space-y-8 flex-1 flex flex-col justify-center items-center text-center w-full"
  style={{ direction: isRtl ? "rtl" : "ltr" }}
 >
 <div className="max-w-md w-full space-y-section">
 <div className="space-y-2">
 <h2 className="text-headline font-display font-semibold text-neutral-800 dark:text-[var(--text-primary)] leading-snug whitespace-normal break-words [overflow-wrap:anywhere] max-w-full">
 {lecture.title}
 </h2>
 </div>

 {/* Central Direct Click-to-Open Notes Action Button - NEATLY CENTERED */}
 <div className="pt-2 flex justify-center w-full">
 {!lecture.notesPdfUrl ? (
 <div className="flex flex-col items-center justify-center py-16 px-6 text-center w-full antialiased">
 <div className="relative mb-6">
 
 <div className="relative w-20 h-20 rounded-full bg-white dark:bg-[#1C1C1E] flex items-center justify-center ring-1 ring-black/[0.04] dark:ring-white/[0.06] shadow-elevation-1 dark:shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
 <BookMarked className="w-10 h-10 text-neutral-500 dark:text-[#EBEBF599] dark:text-[var(--text-muted)]" />
 </div>
 </div>
 <h3 className="font-display text-xl font-semibold text-neutral-900 dark:text-[var(--text-primary)] mb-2">
 {isRtl ? "لا توجد ملخصات معتمدة" : "No Summary Notes"}
 </h3>
 <p className="text-base font-medium text-neutral-500 dark:text-[var(--text-secondary)] max-w-[280px] text-balance">
 {isRtl
 ? "لم يتم العثور على ملخصات أو ملاحظات معتمدة لهذه المحاضرة."
 : "No high-yield summary notes are currently uploaded for this lecture."}
 </p>
 </div>
 ) : (
  <div className="flex flex-col items-center gap-4 w-full">
    <button
      type="button"
      onClick={handleNotesButtonActivate}
      className="document-open-button w-full sm:w-auto px-8 py-4 bg-purple-500 text-white rounded-lg text-base font-semibold flex items-center justify-center gap-3 cursor-pointer shadow-elevation-1 antialiased"
    >
      <ExternalLink className="w-icon-sm h-icon-sm pointer-events-none" />{" "}
      {isRtl
        ? "فتح ملف الملاحظات والملخصات"
        : "Open Review Notes"}
    </button>

 {(hasViewedNotes ||
 hasOpenedNotes ||
 progress.notesCompleted) &&
 !isNotesCompleted &&
 !progress.notesCompleted && (
 <button
 type="button"
 data-haptic="none"
 onClick={handleMarkNotesCompleted}
 className="w-full sm:w-auto px-8 py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-base font-semibold flex items-center justify-center gap-3 cursor-pointer shadow-elevation-1 hover:shadow-elevation-1 antialiased"
 >
 <CheckCircle className="w-icon-sm h-icon-sm" />{" "}
 {isRtl ? "تحديد كمكتمل" : "Mark as Completed"}
 </button>
 )}
 </div>
 )}
 </div>

 {/* Status and Ledger alert */}
 <div className="bg-black/[0.02] dark:bg-white/[0.08] border border-black/[0.04] dark:border-white/[0.04] p-4 rounded-lg max-w-xs mx-auto text-center antialiased">
 <div className="flex items-center gap-3 justify-center">
 {isNotesCompleted || progress.notesCompleted ? (
 <>
 <CheckCircle className="w-icon-md h-icon-md text-emerald-500 shrink-0" />
 <span className="font-semibold text-sm text-emerald-700 dark:text-emerald-400">
 {isRtl
 ? "تمت قراءتها ومراجعتها"
 : "Completed & Reviewed"}
 </span>
 </>
 ) : (
 <>
 <div className="w-2 h-2 rounded-full bg-purple-500 shrink-0 shadow-elevation-1"></div>
 <span className="font-semibold text-sm text-[#9A3412] dark:text-[#f97316]">
 {isRtl ? "غير مقروءة" : "Unread"}
 </span>
 </>
 )}
 </div>
 </div>
 </div>
 </motion.div>
 )}

 {/* TAB 3: MCQ SYSTEM (TEST ZONE) */}
 {activeTab === "mcqs" && (
 <motion.div
 key="mcqs"
initial={{ opacity: 0, scale: 0.98 }}
  animate={{ opacity: 1, scale: 1 }}
  exit={{ opacity: 0, scale: 0.98 }}
 transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
 className="quiz-tab-panel p-6 space-y-section flex-1 flex flex-col justify-between w-full"
 >
 {filteredQuizQuestions.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-16 px-6 text-center w-full antialiased">
 <div className="relative mb-6">
 
 <div className="relative w-20 h-20 rounded-full bg-white dark:bg-[#1C1C1E] flex items-center justify-center ring-1 ring-black/[0.04] dark:ring-white/[0.06] shadow-elevation-1 dark:shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
 <HelpCircle className="w-10 h-10 text-neutral-500 dark:text-[#EBEBF599] dark:text-[var(--text-muted)]" />
 </div>
 </div>
 <h3 className="font-display text-xl font-semibold text-neutral-900 dark:text-[var(--text-primary)] mb-2">
 {isRtl ? "لا توجد أسئلة MCQ" : "No MCQs Available"}
 </h3>
 <p className="text-base font-medium text-neutral-500 dark:text-[var(--text-secondary)] max-w-[280px] text-balance">
 {isRtl
 ? "لا توجد أسئلة خيارات متعددة لهذه المحاضرة بعد."
 : "No MCQs available for this lecture yet."}
 </p>
 </div>
 ) : !quizSubmitted ? (
 // Quiz Active State (One question per screen as requested)
 <div className="flex flex-col">
 <div className="space-y-4">
 {/* Subject and progress metrics */}
 <div className="flex justify-between items-center text-caption text-neutral-500 dark:text-[#EBEBF599]">
 <span className="font-semibold text-med-blue uppercase font-mono bg-blue-50 px-3 py-1 rounded-sm border border-blue-100 dark:bg-[#2C2C2E]">
 Question {currentQuestionIndex + 1} of{" "}
 {filteredQuizQuestions.length}
 </span>
 </div>

 {/* Question Box */}
 <div className="p-5 sm:p-6 bg-neutral-55 border border-neutral-200 dark:border-white/[0.12] dark:bg-[#1C1C1E] rounded-md shadow-elevation-1 font-medium">
 <h3 className="text-caption sm:text-body font-sans text-neutral-805 dark:text-white font-semibold">
 {filteredQuizQuestions[currentQuestionIndex].question}
 </h3>
 </div>

 {/* Options Radio Grid */}
 <div className="grid grid-cols-1 gap-3 pt-2">
 {(["A", "B", "C", "D"] as const).map((optionKey) => {
 const optionText =
 filteredQuizQuestions[currentQuestionIndex][
 `option${optionKey}` as keyof MCQ
 ];
 const isSelected =
 answersMap[
 filteredQuizQuestions[currentQuestionIndex].id
 ] === optionKey;

 return (
 <button
 key={optionKey}
 type="button"
 onClick={() => {
 setAnswersMap({
 ...answersMap,
 [filteredQuizQuestions[currentQuestionIndex]
 .id]: optionKey,
 });
 }}
 className={`quiz-option w-full p-4 text-left text-caption rounded-lg border transition flex items-center gap-3 cursor-pointer ${
 isSelected
 ? "bg-blue-50/70 border-blue-500 text-blue-900 dark:text-blue-300 font-semibold shadow-elevation-1 dark:bg-blue-900/30 dark:border-blue-500/50"
 : "bg-white border-med-beige/60 hover:bg-neutral-50/50 text-neutral-700 dark:bg-[#1C1C1E] dark:border-white/[0.12] dark:text-[var(--text-secondary)]"
 }`}
 >
 <span
 className={`w-icon-lg h-icon-lg rounded-lg text-caption font-semibold font-mono flex items-center justify-center shrink-0 border ${
 isSelected
 ? "bg-med-blue text-white border-blue-600"
 : "bg-neutral-50 border-neutral-200 text-neutral-500 dark:bg-[#2C2C2E] dark:border-white/[0.15]"
 }`}
 >
 {optionKey}
 </span>
 <span className="font-sans font-medium">
 {optionText}
 </span>
 </button>
 );
 })}
 </div>
 </div>

 {/* Actions Row */}
 <div className="quiz-actions-row border-t border-med-cream pt-4 mt-5 flex justify-between items-center flex-wrap gap-2 dark:border-white/[0.12]">
 <div className="quiz-actions-group flex gap-2">
 <button
 type="button"
 disabled={currentQuestionIndex === 0}
 onClick={() => {
 setCurrentQuestionIndex(currentQuestionIndex - 1);
 setShowHint(false);
 }}
 className="quiz-nav-btn h-btn px-6 py-2 text-caption font-semibold rounded-md border border-neutral-200 dark:border-white/[0.12] text-neutral-600 dark:text-[var(--text-secondary)] hover:bg-neutral-50 dark:hover:bg-white/[0.12] disabled:opacity-50 cursor-pointer transition-colors"
 >
 {isRtl ? "السابق" : "Previous"}
 </button>
 <button
 type="button"
 onClick={() => setShowHint(!showHint)}
 className={`quiz-nav-btn h-btn px-6 py-2 text-caption font-semibold rounded-md border cursor-pointer flex items-center gap-2 transition ${
 showHint
 ? "bg-[#FF9500]/15 border-[#FF9500]/30 text-[#FF9500]"
 : "bg-[#FF9500]/10 hover:bg-[#FF9500]/15 border-[#FF9500]/25 text-[#FF9500]"
 }`}
 >
 <HelpCircle className="quiz-nav-btn-icon w-icon-sm h-icon-sm text-[#FF9500]" />
 {showHint
 ? isRtl
 ? "إخفاء التلميح السريري"
 : "Hide Hint"
 : isRtl
 ? "عرض تلميح تشخيصي"
 : "Reveal Hint"}
 </button>
 </div>

 <button
 type="button"
 onClick={() => {
 if (
 currentQuestionIndex <
 filteredQuizQuestions.length - 1
 ) {
 setCurrentQuestionIndex(currentQuestionIndex + 1);
 setShowHint(false);
 } else {
 handleQuizSubmit();
 }
 }}
 className="quiz-nav-btn quiz-nav-btn-next px-5 py-2 text-caption bg-[#007AFF] hover:bg-[#007AFF]/90 text-white font-semibold rounded-full shadow-elevation-1 min-w-[124px] cursor-pointer transition duration-155"
 >
 {currentQuestionIndex === filteredQuizQuestions.length - 1
 ? isRtl
 ? "تسليم الإجابات ✓"
 : "Submit Answers ✓"
 : isRtl
 ? "التالي ➔"
 : "Next Question ➔"}
 </button>
 </div>

 {/* Hint slide down */}
 {showHint && (
 <div className="mt-4 overflow-hidden liquid-glass-thick rounded-xl shadow-elevation-3 ring-1 ring-black/5 animate-fadeIn">
 {/* iOS Notification Header */}
 <div className="flex items-center justify-between px-4 py-3 bg-neutral-100/50 dark:bg-[#2C2C2E]/80 border-b border-[#E5E5EA] dark:border-[#2C2C2E]/40">
 <div className="flex items-center gap-2">
 {/* iOS Mini App Icon Container */}
 <div className="w-icon-md h-icon-md rounded-md bg-[#E5563C] flex items-center justify-center text-white shadow-elevation-1">
 <Activity className="w-icon-sm h-icon-sm stroke-[2.5]" />
 </div>
 <span className="font-sans font-semibold text-caption text-[#1c1c1e] dark:text-[var(--text-secondary)] uppercase">
 {isRtl
 ? "المستشار السريري البغدادي"
 : "THE HINT"}
 </span>
 </div>
 <span className="text-caption font-sans text-neutral-500 dark:text-[#EBEBF599] dark:text-[var(--text-muted)] font-medium">
 {isRtl ? "الآن" : "now"}
 </span>
 </div>

 {/* iOS Notification Content Body */}
 <div className="p-4 flex gap-3 text-left">
 <div className="w-2 rounded-full bg-gradient-to-b from-[#FF9500] to-[#FFCC00] shrink-0" />
 <div className="space-y-1 text-left flex-1">
 <p className="font-sans text-caption text-neutral-700 dark:text-[var(--text-secondary)] font-normal">
 {filteredQuizQuestions[currentQuestionIndex]?.explanation
 ? filteredQuizQuestions[currentQuestionIndex].explanation
 : isRtl
 ? "فكر بعناية في الخيارات المتاحة."
 : "Think carefully about the available options."}
 </p>
 </div>
 </div>
 </div>
 )}
 </div>
 ) : (
 // Quiz Results State (Colorcoded green/red, review modes)
 <div className="space-y-section">
 <div className="text-center py-6 bg-med-bg/40 dark:bg-[#2C2C2E] border border-med-beige/60 dark:border-white/[0.12] rounded-lg p-card-padding">
 <div className="w-12 h-12 bg-gradient-to-tr from-amber-500 to-yellow-400 text-neutral-950 rounded-full flex items-center justify-center text-headline mx-auto shadow-elevation-1 mb-2">
 {quizScorePct}%
 </div>
 <h3 className="font-display font-semibold text-neutral-800 dark:text-white text-body">
 MCQ Performance Score
 </h3>
 <p className="text-secondary-label mt-1">
 {quizScorePct >= 80
 ? "★ Excellent medical diagnostic accuracy. High Score Honors gained!"
 : "Comprehensive review recommended. Feel free to re-test below."}
 </p>

  <button
  onClick={() => {
  setAnswersMap({});
  setQuizSubmitted(false);
  setCurrentQuestionIndex(0);
  setQuizResults({});
  }}
  className="mt-4 px-4 py-2 bg-neutral-900 text-[#D5C7B5] font-semibold text-caption rounded-lg hover:bg-neutral-800 transition cursor-pointer"
  >
 Retake Medical Quiz
 </button>
 </div>

 {/* Review Mode: Color-coded Green/Red list of options */}
 <div className="space-y-4">
 <h4 className="font-semibold text-caption uppercase text-neutral-500 dark:text-[#EBEBF599]">
 Clinical Verification Log:
 </h4>
  {quizQuestions.map((q, idx) => {
  const selected = answersMap[q.id];
  const verified = quizResults[q.id];
  const correct = verified?.correctAnswer ?? q.correctAnswer;
  const isCorrect = verified ? verified.correct : selected === correct;

 const getOptionStyle = (
 optKey: "A" | "B" | "C" | "D",
 ) => {
 if (optKey === correct) {
 return "p-3 rounded-lg border bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 border-emerald-500/30 font-semibold flex items-center justify-between transition-colors shadow-elevation-0 dark:bg-emerald-950/20";
 }
 if (selected === optKey) {
 return "p-3 rounded-lg border bg-rose-500/10 text-rose-800 dark:text-rose-400 border-rose-500/30 font-semibold flex items-center justify-between transition-colors shadow-elevation-0 dark:bg-rose-500/15 dark:border-rose-500/30";
 }
 return "p-3 rounded-lg border border-neutral-100 dark:border-white/[0.12] bg-neutral-50/20 dark:bg-[#1C1C1E]/10 text-neutral-600 dark:text-[var(--text-secondary)] transition-colors";
 };

 const renderOptionContent = (
 optKey: "A" | "B" | "C" | "D",
 text: string,
 ) => {
 const isUserSelected = selected === optKey;
 const isAnsCorrect = optKey === correct;

 return (
 <div className="flex items-center justify-between w-full gap-2 text-left">
 <span className="">
 {optKey}: {text}
 </span>
 {isAnsCorrect && (
 <span className="text-caption bg-emerald-500 text-white dark:bg-emerald-950 dark:text-emerald-400 font-semibold px-2 py-1 rounded-sm uppercase shrink-0">
 {isRtl ? "الإجابة الصحيحة" : "Correct"}
 </span>
 )}
 {!isAnsCorrect && isUserSelected && (
 <span className="text-caption bg-rose-500 text-white dark:bg-rose-500/10 dark:text-rose-400 font-semibold px-2 py-1 rounded-sm uppercase shrink-0">
 {isRtl ? "إجابتك الخاطئة" : "Your Answer"}
 </span>
 )}
 </div>
 );
 };

 return (
 <div
 key={q.id}
 className={`p-4 rounded-md border ${
 isCorrect
 ? "bg-emerald-50/80 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-500/30 text-emerald-900 dark:text-emerald-200"
 : "bg-rose-50/80 dark:bg-rose-900/20 border-rose-200 dark:border-rose-500/30 text-rose-900 dark:text-rose-200"
 }`}
 >
 <div className="flex justify-between items-start gap-4">
 <span
 className={`text-caption font-semibold uppercase px-2 py-1 rounded-sm ${
 isCorrect
 ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300"
 : "bg-rose-100 dark:bg-rose-500/20 text-rose-800 dark:text-rose-300"
 }`}
 >
 Question {idx + 1}:{" "}
 {isCorrect ? "CORRECT ✓" : "INCORRECT ✗"}
 </span>
 </div>

 <p className="text-caption font-semibold text-neutral-800 dark:text-white mt-2 font-sans">
 {q.question}
 </p>

 <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4 text-caption">
 <div className={getOptionStyle("A")}>
 {renderOptionContent("A", q.optionA)}
 </div>
 <div className={getOptionStyle("B")}>
 {renderOptionContent("B", q.optionB)}
 </div>
 <div className={getOptionStyle("C")}>
 {renderOptionContent("C", q.optionC)}
 </div>
 <div className={getOptionStyle("D")}>
 {renderOptionContent("D", q.optionD)}
 </div>
 </div>

 <div className="mt-3 pt-3 border-t border-black/5 dark:border-white/[0.12] text-caption bg-white/40 dark:bg-[#1C1C1E]/40 p-3 rounded-lg font-sans text-neutral-700 dark:text-[#EBEBF599]">
  <span className="font-semibold text-neutral-900 dark:text-white">
  {isRtl ? "الشرح:" : "Explanation:"}
  </span>{" "}
  {verified?.explanation || q.explanation}
  </div>
 </div>
 );
 })}
 </div>
 </div>
 )}
 </motion.div>
 )}

 {/* TAB 4: FLASHCARD SYSTEM (REPETITION INTERACTIVE) */}
 {activeTab === "flashcards" && (
 <motion.div
 key="flashcards"
initial={{ opacity: 0, scale: 0.98 }}
  animate={{ opacity: 1, scale: 1 }}
  exit={{ opacity: 0, scale: 0.98 }}
 transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
 className="flex-1 flex flex-col justify-between w-full"
 >
 {(() => {
 const relevantCards = getRelevantCards();
 if (relevantCards.length === 0) {
 return (
 <div className="flex flex-col items-center justify-center py-16 px-6 text-center w-full min-h-[300px] antialiased">
 <div className="relative mb-6">
 
 <div className="relative w-20 h-20 rounded-full bg-white dark:bg-[#1C1C1E] flex items-center justify-center ring-1 ring-black/[0.04] dark:ring-white/[0.06] shadow-elevation-1 dark:shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
 <Layers className="w-10 h-10 text-neutral-500 dark:text-[#EBEBF599] dark:text-[var(--text-muted)]" />
 </div>
 </div>
 <h3 className="font-display text-xl font-semibold text-neutral-900 dark:text-[var(--text-primary)] mb-2">
 {isRtl
 ? "لا توجد بطاقات استذكار"
 : "No Flashcards Available"}
 </h3>
 <p className="text-base font-medium text-neutral-500 dark:text-[var(--text-secondary)] max-w-[280px] text-balance">
 {isRtl
 ? "لا توجد بطاقات استذكار (فلاش كاردز) لهذه المحاضرة بعد."
 : "No flashcards available for this lecture yet."}
 </p>
 </div>
 );
 }

 const baseCards = relevantCards; const activeCards = (() => {
      if (repeatFilter === "hard") return baseCards.filter((c: any) => cardStats[c.id] === "hard");
      if (repeatFilter === "medium") return baseCards.filter((c: any) => cardStats[c.id] === "medium");
      if (repeatFilter === "easy") return baseCards.filter((c: any) => cardStats[c.id] === "easy");
      return baseCards;
    })(); 

  if (deckFinished) {
    const studyTimeMinutes = Math.max(1, Math.round((Date.now() - sessionStartRef.current) / 60000));
    const totalReviewed = baseCards.length;
    const easyCards = baseCards.filter((c) => cardStats[c.id] === "easy");
    const hardCards = baseCards.filter((c) => cardStats[c.id] === "hard");
    const mediumCards = baseCards.filter((c) => cardStats[c.id] === "medium");
    
    return (
      <div
        className="p-4 sm:p-8 space-y-section flex-1 flex flex-col justify-center items-center animate-fadeIn w-full"
        style={{ direction: isRtl ? "rtl" : "ltr" }}
      >
        <div className="max-w-[400px] w-full space-y-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
              className="w-16 h-16 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center shadow-sm border border-emerald-500/20"
            >
              <CheckCircle className="w-8 h-8" />
            </motion.div>
            <div className="space-y-1">
              <h3 className="text-xl font-sans font-semibold tracking-tight text-neutral-900 dark:text-white">
                {isRtl ? "اكتملت الجلسة" : "Session Complete"}
              </h3>
              <p className="text-sm text-neutral-500 dark:text-[#EBEBF599]">
                {isRtl ? "عمل رائع! لقد راجعت جميع البطاقات." : "Great work! You've reviewed all cards."}
              </p>
            </div>
          </div>

          {/* Premium Session Summary */}
          <motion.div 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.4 }}
            className="bg-white dark:bg-[#1C1C1E] border border-black/5 dark:border-white/[0.08] rounded-2xl p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.2)] space-y-5"
          >
            <div className="grid grid-cols-2 divide-x divide-neutral-100 dark:divide-neutral-800 text-center">
              <div className="flex flex-col items-center">
                <span className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-white">{totalReviewed}</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">{isRtl ? "بطاقات" : "Cards"}</span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-2xl font-semibold tracking-tight text-emerald-500">100%</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">{isRtl ? "إكمال" : "Done"}</span>
              </div>
            </div>

            <div className="pt-4 border-t border-neutral-100 dark:border-white/[0.08]">
              <div className="flex gap-1 h-1.5 rounded-full overflow-hidden mb-3">
                {hardCards.length > 0 && <div style={{ width: `${(hardCards.length / totalReviewed) * 100}%` }} className="bg-rose-500"></div>}
                {mediumCards.length > 0 && <div style={{ width: `${(mediumCards.length / totalReviewed) * 100}%` }} className="bg-amber-500"></div>}
                {easyCards.length > 0 && <div style={{ width: `${(easyCards.length / totalReviewed) * 100}%` }} className="bg-emerald-500"></div>}
                {hardCards.length === 0 && mediumCards.length === 0 && easyCards.length === 0 && <div className="w-full h-full bg-emerald-500"></div>}
              </div>
              <div className="flex justify-between px-1 text-[11px] font-semibold tracking-wide">
                <span className="text-rose-500 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-rose-500"></div> {hardCards.length} {isRtl ? "صعب" : "Hard"}</span>
                <span className="text-amber-500 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div> {mediumCards.length} {isRtl ? "متوسط" : "Med"}</span>
                <span className="text-emerald-500 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> {easyCards.length} {isRtl ? "سهل" : "Easy"}</span>
              </div>
            </div>
          </motion.div>

          <div className="space-y-3 pt-2 text-left w-full">
            {/* Repeat Hard Only Button (Red) */}
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                if (hardCards.length > 0) {
                  setRepeatFilter("hard");
                  setCurrentCardIndex(0);
                  setIsFlipped(false);
                  setDeckFinished(false);
                }
              }}
              disabled={hardCards.length === 0}
              className={`w-full py-3.5 px-4 rounded-xl text-[13px] font-semibold transition-all duration-300 flex items-center justify-between border ${
                hardCards.length > 0
                  ? "bg-rose-50/50 dark:bg-rose-500/10 hover:bg-rose-50 dark:hover:bg-rose-500/20 border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 cursor-pointer shadow-sm"
                  : "bg-neutral-50/50 dark:bg-neutral-900/30 border-neutral-200/50 dark:border-white/[0.06] text-neutral-500 dark:text-neutral-600 opacity-60 cursor-not-allowed"
              }`}
            >
              <span className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${hardCards.length > 0 ? "bg-rose-500" : "bg-neutral-300 dark:bg-neutral-700"}`} />
                {isRtl ? "تكرار البطاقات الصعبة" : "Repeat Hard cards"}
              </span>
              {hardCards.length > 0 && (
                <span className="bg-rose-100 dark:bg-rose-500/20 px-2.5 py-0.5 rounded-md font-mono text-[11px] font-bold">
                  {hardCards.length}
                </span>
              )}
            </motion.button>

            {/* Repeat Medium Only Button (Yellow) */}
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                if (mediumCards.length > 0) {
                  setRepeatFilter("medium");
                  setCurrentCardIndex(0);
                  setIsFlipped(false);
                  setDeckFinished(false);
                }
              }}
              disabled={mediumCards.length === 0}
              className={`w-full py-3.5 px-4 rounded-xl text-[13px] font-semibold transition-all duration-300 flex items-center justify-between border ${
                mediumCards.length > 0
                  ? "bg-amber-50/50 dark:bg-amber-500/10 hover:bg-amber-50 dark:hover:bg-amber-500/20 border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 cursor-pointer shadow-sm"
                  : "bg-neutral-50/50 dark:bg-neutral-900/30 border-neutral-200/50 dark:border-white/[0.06] text-neutral-500 dark:text-neutral-600 opacity-60 cursor-not-allowed"
              }`}
            >
              <span className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${mediumCards.length > 0 ? "bg-amber-500" : "bg-neutral-300 dark:bg-neutral-700"}`} />
                {isRtl ? "تكرار البطاقات المتوسطة" : "Repeat Medium cards"}
              </span>
              {mediumCards.length > 0 && (
                <span className="bg-amber-100 dark:bg-amber-500/20 px-2.5 py-0.5 rounded-md font-mono text-[11px] font-bold">
                  {mediumCards.length}
                </span>
              )}
            </motion.button>

            {/* Repeat Easy Only Button (Green/Emerald) */}
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                if (easyCards.length > 0) {
                  setRepeatFilter("easy");
                  setCurrentCardIndex(0);
                  setIsFlipped(false);
                  setDeckFinished(false);
                }
              }}
              disabled={easyCards.length === 0}
              className={`w-full py-3.5 px-4 rounded-xl text-[13px] font-semibold transition-all duration-300 flex items-center justify-between border ${
                easyCards.length > 0
                  ? "bg-emerald-50/50 dark:bg-emerald-500/10 hover:bg-emerald-50 dark:hover:bg-emerald-500/20 border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 cursor-pointer shadow-sm"
                  : "bg-neutral-50/50 dark:bg-neutral-900/30 border-neutral-200/50 dark:border-white/[0.06] text-neutral-500 dark:text-neutral-600 opacity-60 cursor-not-allowed"
              }`}
            >
              <span className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${easyCards.length > 0 ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-700"}`} />
                {isRtl ? "تكرار البطاقات السهلة" : "Repeat Easy cards"}
              </span>
              {easyCards.length > 0 && (
                <span className="bg-emerald-100 dark:bg-emerald-500/20 px-2.5 py-0.5 rounded-md font-mono text-[11px] font-bold">
                  {easyCards.length}
                </span>
              )}
            </motion.button>
          </div>

        </div>
      </div>
    );
  }

 return (
 <div className="p-6 space-y-section flex-1 flex flex-col justify-between">
 <div className="space-y-4 max-w-4xl mx-auto w-full text-center">
        {repeatFilter && (repeatFilter === "hard" || repeatFilter === "medium" || repeatFilter === "easy") && (
          <span className="text-caption font-semibold font-mono text-orange-600 bg-orange-50 px-3 py-1 rounded-full border border-orange-100 uppercase inline-block mb-1">
            {repeatFilter === "hard" ? (isRtl ? "مراجعة البطاقات الصعبة فقط 🛑" : "Reviewing Hard concepts only 🛑") : repeatFilter === "medium" ? (isRtl ? "مراجعة البطاقات المتوسطة فقط ⚠️" : "Reviewing Medium concepts only ⚠️") : (isRtl ? "مراجعة البطاقات السهلة فقط ✅" : "Reviewing Easy concepts only ✅")}
          </span>
        )}
        {/* FLIP CARD CONTAINER */}
 <div
 onClick={() => setIsFlipped(!isFlipped)}
 style={flashcardThemeVars}
 className={`relative w-full max-w-[860px] mx-auto min-h-[410px] sm:min-h-[460px] rounded-[26px] border px-7 sm:px-10 py-7 sm:py-8 flex flex-col justify-between items-center cursor-pointer select-none antialiased overflow-hidden ${
 isFlipped
 ? "bg-[#222225] dark:bg-[#222225] border-black/[0.08] dark:border-white/[0.10] text-white shadow-[0_22px_55px_rgba(0,0,0,0.26)]"
 : "bg-[#FCFCFD] dark:bg-[#222225] border-black/[0.07] dark:border-white/[0.10] text-neutral-800 dark:text-white shadow-[0_20px_48px_rgba(0,0,0,0.12)] dark:shadow-[0_22px_55px_rgba(0,0,0,0.26)]"
 }`}
 >
  <div className="pointer-events-none absolute inset-0 overflow-hidden">
    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(var(--flashcard-accent-rgb),0.38)] to-transparent" />
    <div className="absolute inset-y-0 right-0 w-[46%] bg-gradient-to-l from-[rgba(var(--flashcard-accent-rgb),0.055)] to-transparent dark:from-[rgba(var(--flashcard-accent-rgb),0.065)]" />
    <SubjectFlashcardArtwork
      subjectId={lecture.subjectId}
      rgb={flashcardTheme.rgb}
      className="absolute right-0 top-1/2 -translate-y-1/2 w-[42%] min-w-[270px] max-w-[390px] opacity-80 dark:opacity-85"
    />
    <div className="absolute left-8 right-8 bottom-20 h-px bg-gradient-to-r from-transparent via-white/[0.05] to-transparent dark:via-white/[0.06]" />
  </div>
 <AnimatePresence mode="wait" initial={false}>
 {!isFlipped ? (
            <motion.div
              key="flashcard-question"
              initial={{ opacity: 0, y: 7, filter: "blur(3px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -5, filter: "blur(2px)" }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="relative z-10 w-full min-h-[calc(410px-56px)] sm:min-h-[calc(460px-64px)] flex flex-col justify-between items-center"
            >
              <div className="relative z-10 w-full flex justify-between items-center">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center border" style={{ backgroundColor: `rgba(${flashcardTheme.rgb}, 0.10)`, borderColor: `rgba(${flashcardTheme.rgb}, 0.22)` }}>
                    <FlashcardSubjectIcon className="w-4.5 h-4.5" style={{ color: flashcardTheme.accent }} />
                  </div>
                  <span className="text-xs font-bold tracking-wider uppercase" style={{ color: flashcardTheme.accent }}>
                    {isRtl ? "مفهوم طبي سريري" : "CLINICAL CONCEPT"}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-16 sm:w-24 h-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden relative">
                    <motion.div
                      className="absolute top-0 left-0 h-full w-full origin-left rounded-full"
                      style={{ backgroundColor: flashcardTheme.accent }}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: (currentCardIndex + 1) / activeCards.length }}
                      transition={{ duration: 0.3, ease: "easeOut" }}
                    />
                  </div>
                  <div className="text-xs font-medium font-mono text-neutral-500 dark:text-[#EBEBF599]">
                    {currentCardIndex + 1}/{activeCards.length}
                  </div>
                </div>
              </div>

              <div className="relative z-10 flex-1 flex items-center justify-center w-full py-7">
                <h3 className="max-w-2xl text-3xl sm:text-[2.65rem] lg:text-[3rem] font-semibold tracking-tight text-center text-balance text-neutral-900 dark:text-white leading-[1.18]">
                  {activeCards[currentCardIndex]?.front}
                </h3>
              </div>

              <div className="relative z-10 w-full flex flex-col items-center gap-3 pb-1">
                <Activity className="w-5 h-5" style={{ color: flashcardTheme.accent }} />
                <p className="text-xs sm:text-sm font-medium text-neutral-500 dark:text-[#EBEBF599] uppercase tracking-wider">
                  {isRtl ? "انقر لإظهار التفسير (أو Space)" : "Tap to reveal explanation (Space)"}
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="flashcard-explanation"
              initial={{ opacity: 0, y: 7, filter: "blur(3px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -5, filter: "blur(2px)" }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="relative z-10 w-full min-h-[calc(410px-56px)] sm:min-h-[calc(460px-64px)] flex flex-col justify-between items-center"
            >
              <div className="w-full flex justify-between items-center">
                <span className="text-xs font-bold tracking-wider uppercase" style={{ color: flashcardTheme.accent }}>
                  {isRtl ? "تفسير علمي" : "EXPLANATION"}
                </span>
                <div className="flex items-center gap-3">
                  <div className="w-16 sm:w-24 h-1.5 bg-white/10 rounded-full overflow-hidden relative">
                    <motion.div
                      className="absolute top-0 left-0 h-full w-full origin-left rounded-full"
                      style={{ backgroundColor: flashcardTheme.accent }}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: (currentCardIndex + 1) / activeCards.length }}
                      transition={{ duration: 0.3, ease: "easeOut" }}
                    />
                  </div>
                  <div className="text-xs font-medium font-mono text-white/50">
                    {currentCardIndex + 1}/{activeCards.length}
                  </div>
                </div>
              </div>

              <div className="relative z-10 flex-1 flex flex-col items-center justify-center w-full py-5">
                <div className="max-w-2xl text-lg sm:text-2xl font-medium text-center text-neutral-100 leading-[1.55] text-balance">
                  {activeCards[currentCardIndex]?.back}
                </div>
              </div>
            </motion.div>
          )}
 </AnimatePresence>
        </div>

 {/* Repetition rating buttons — space is always reserved to keep the entire page perfectly stable when the card flips */}
 <div
 aria-hidden={!isFlipped}
 className={`mt-6 min-h-[142px] space-y-3 antialiased transition-opacity duration-150 ${isFlipped ? "opacity-100 visible" : "opacity-0 invisible pointer-events-none"}`}
 >
 <p className="text-xs font-bold tracking-wider text-neutral-500 dark:text-[#EBEBF599] uppercase text-center mb-1">
                {isRtl
                  ? "كيف كان مستوى تذكّرك للمفهوم؟"
                  : "How easily did you recall this?"}
              </p>
              <div 
                role="group" 
                aria-label="Rate your recall"
                className="grid grid-cols-3 gap-2 bg-neutral-100/80 dark:bg-neutral-800/50 p-1.5 rounded-2xl border border-black/5 dark:border-white/[0.08] backdrop-blur-sm shadow-inner w-full sm:max-w-md mx-auto"
              >
                <motion.button
                  onClick={() => {
                    handleCardRate("hard");
                  }}
                  className="group relative flex flex-col items-center justify-center gap-2 py-4 px-2 rounded-xl bg-white dark:bg-[#1C1C1E] shadow-[0_1px_3px_rgba(0,0,0,0.1)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.4)] border border-black/5 dark:border-white/[0.08] hover:border-rose-200 dark:hover:border-rose-500/30 transition-all duration-300 focus:outline-none"
                  aria-label="Hard"
                >
                  <div className="absolute inset-0 bg-gradient-to-b from-rose-50/50 to-rose-100/50 dark:from-rose-500/10 dark:to-rose-500/5 opacity-0 group-hover:opacity-100 rounded-xl transition-opacity duration-300" />
                  <div className="relative z-10 w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-500/20 flex items-center justify-center text-rose-600 dark:text-rose-400 group-hover:scale-110 transition-transform duration-300">
                    <Brain className="w-5 h-5" />
                  </div>
                  <div className="relative z-10 flex items-center gap-1.5 text-[13px] font-semibold tracking-wide text-rose-600 dark:text-rose-400">
                    <span>{isRtl ? "صعب" : "Hard"}</span>
                    <span className="hidden sm:inline-flex items-center justify-center w-4 h-4 rounded border border-rose-600/30 dark:border-rose-400/30 text-[10px] opacity-70">1</span>
                  </div>
                </motion.button>
                
                <motion.button
                  onClick={() => {
                    handleCardRate("medium");
                  }}
                  className="group relative flex flex-col items-center justify-center gap-2 py-4 px-2 rounded-xl bg-white dark:bg-[#1C1C1E] shadow-[0_1px_3px_rgba(0,0,0,0.1)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.4)] border border-black/5 dark:border-white/[0.08] hover:border-amber-200 dark:hover:border-amber-500/30 transition-all duration-300 focus:outline-none"
                  aria-label="Medium"
                >
                  <div className="absolute inset-0 bg-gradient-to-b from-amber-50/50 to-amber-100/50 dark:from-amber-500/10 dark:to-amber-500/5 opacity-0 group-hover:opacity-100 rounded-xl transition-opacity duration-300" />
                  <div className="relative z-10 w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400 group-hover:scale-110 transition-transform duration-300">
                    <Gauge className="w-5 h-5" />
                  </div>
                  <div className="relative z-10 flex items-center gap-1.5 text-[13px] font-semibold tracking-wide text-amber-600 dark:text-amber-400">
                    <span>{isRtl ? "متوسط" : "Medium"}</span>
                    <span className="hidden sm:inline-flex items-center justify-center w-4 h-4 rounded border border-amber-600/30 dark:border-amber-400/30 text-[10px] opacity-70">2</span>
                  </div>
                </motion.button>
                
                <motion.button
                  onClick={() => {
                    handleCardRate("easy");
                  }}
                  className="group relative flex flex-col items-center justify-center gap-2 py-4 px-2 rounded-xl bg-white dark:bg-[#1C1C1E] shadow-[0_1px_3px_rgba(0,0,0,0.1)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.4)] border border-black/5 dark:border-white/[0.08] hover:border-emerald-200 dark:hover:border-emerald-500/30 transition-all duration-300 focus:outline-none"
                  aria-label="Easy"
                >
                  <div className="absolute inset-0 bg-gradient-to-b from-emerald-50/50 to-emerald-100/50 dark:from-emerald-500/10 dark:to-emerald-500/5 opacity-0 group-hover:opacity-100 rounded-xl transition-opacity duration-300" />
                  <div className="relative z-10 w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform duration-300">
                    <Zap className="w-5 h-5" />
                  </div>
                  <div className="relative z-10 flex items-center gap-1.5 text-[13px] font-semibold tracking-wide text-emerald-600 dark:text-emerald-400">
                    <span>{isRtl ? "سهل" : "Easy"}</span>
                    <span className="hidden sm:inline-flex items-center justify-center w-4 h-4 rounded border border-emerald-600/30 dark:border-emerald-400/30 text-[10px] opacity-70">3</span>
                  </div>
                </motion.button>
              </div>
            </div>
 </div>

 {/* Paging */}
 <div className="border-t border-neutral-100 pt-5 mt-5 flex justify-between items-center text-caption dark:border-white/[0.12]">
 <span className="text-neutral-550 font-semibold font-mono text-caption">
 Card {currentCardIndex + 1} of {activeCards.length}
 </span>
 {progress.flashcardsCompleted && (
 <span className="text-caption font-semibold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full flex items-center gap-1 border border-emerald-100/50">
 ✓ {isRtl ? "مكتمل" : "Completed"}
 </span>
 )}
 </div>
 </div>
 );
 })()}
 </motion.div>
 )}

 {/* TAB 5: VIDEO LINKS (CURATED DIRECT LINKS) */}
 {activeTab === "videos" && (
 <motion.div
 key="videos"
initial={{ opacity: 0, scale: 0.98 }}
  animate={{ opacity: 1, scale: 1 }}
  exit={{ opacity: 0, scale: 0.98 }}
 transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
 className="p-6 space-y-section flex-1 flex flex-col justify-between w-full"
 >
 <div className="space-y-4">
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
 {getRelevantVideos().length === 0 ? (
 <div className="col-span-1 sm:col-span-2 flex flex-col items-center justify-center py-16 px-6 text-center w-full antialiased">
 <div className="relative mb-6">
 
 <div className="relative w-20 h-20 rounded-full bg-white dark:bg-[#1C1C1E] flex items-center justify-center ring-1 ring-black/[0.04] dark:ring-white/[0.06] shadow-elevation-1 dark:shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
 <PlayCircle className="w-10 h-10 text-neutral-500 dark:text-[#EBEBF599] dark:text-[var(--text-muted)]" />
 </div>
 </div>
 <h3 className="font-display text-xl font-semibold text-neutral-900 dark:text-[var(--text-primary)] mb-2">
 {isRtl ? "لا توجد فيديوهات مضافة" : "No Videos Added"}
 </h3>
 <p className="text-base font-medium text-neutral-500 dark:text-[var(--text-secondary)] max-w-[280px] text-balance">
 {isRtl
 ? "لم يقم مسؤول الكلية بإضافة تسجيلات فيديو لهذه المحاضرة بعد."
 : "No standard tutorial video links have been registered for this dynamic lecture."}
 </p>
 </div>
 ) : (
 getRelevantVideos().map((video) => {
              const videoId = video.youtubeUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?]+)/)?.[1];
              return <VideoCard key={video.id} video={video} videoId={videoId} onWatch={handleWatchVideo} />;
            })
 )}
 </div>
 </div>
 </motion.div>
 )}

 {/* TAB 6: STUDENT-TO-STUDENT Q&A BOARDS */}
 {activeTab === "qa" && (
 <motion.div
 key="qa"
initial={{ opacity: 0, scale: 0.98 }}
  animate={{ opacity: 1, scale: 1 }}
  exit={{ opacity: 0, scale: 0.98 }}
 transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }}
 className="p-6 space-y-section flex-1 flex flex-col justify-between w-full"
 style={{ direction: isRtl ? "rtl" : "ltr" }}
 >
 <div className="space-y-section">
 {/* Question creation form */}
 {muteStatus?.isMuted ? (
 /* ── Muted banner: replaces question form ── */
 <div className="bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200/60 dark:border-rose-800/30 p-5 sm:p-6 rounded-lg antialiased shadow-elevation-1">
   <div className="flex items-start gap-4">
     <div className="shrink-0 w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center">
       <MicOff className="w-5 h-5 text-rose-600 dark:text-rose-400" />
     </div>
     <div className="flex-1 min-w-0">
       <p className="text-subhead font-semibold text-rose-800 dark:text-rose-300 mb-1">
         {isRtl ? "لا يمكنك المشاركة حالياً" : "Participation Restricted"}
       </p>
       <p className="text-caption font-medium text-rose-700 dark:text-rose-400 leading-relaxed">
         {isRtl
           ? "أنت محظور حالياً ولا يمكنك نشر الأسئلة أو الردود في النقاشات."
           : "You are currently muted and cannot post questions or replies in discussions."}
       </p>
       {muteStatus.reason && (
         <p className="mt-2 text-caption text-rose-600 dark:text-rose-500">
           <span className="font-semibold">{isRtl ? "السبب:" : "Reason:"}</span>{" "}
           {muteStatus.reason}
         </p>
       )}
       <p className="mt-1 text-caption text-rose-600 dark:text-rose-500">
         {muteStatus.isPermanent
           ? (isRtl ? "🔴 هذا الكتم دائم." : "🔴 This mute is permanent.")
           : muteStatus.endTime
             ? `⏱ ${formatMuteRemaining(muteStatus.endTime)} — ${isRtl ? "ينتهي في:" : "Expires:"} ${new Date(muteStatus.endTime).toLocaleString()}`
             : ""}
       </p>
     </div>
   </div>
 </div>
 ) : (
 <form
 onSubmit={handlePostQuestion}
 className="bg-neutral-50/50 dark:bg-white/[0.08] border border-neutral-200/50 dark:border-white/[0.12] p-5 sm:p-6 rounded-lg space-y-4 antialiased shadow-elevation-1"
 >
 <label className="text-subhead font-semibold text-neutral-800 dark:text-white dark:text-[var(--text-secondary)] flex items-center gap-2">
 <MessageSquare className="w-icon-sm h-icon-sm text-med-gold" />
 {isRtl
 ? "اسأل زملائك سؤالاً طبيّاً / سريريّاً ملحّاً"
 : "Ask a Clinical Question to your Peers"}
 </label>
 <div className="relative">
 <input aria-label="Input field"
 type="text"
 value={newQuestionContent}
 onChange={(e) => setNewQuestionContent(e.target.value)}
 placeholder={
 isRtl
 ? "طرح استفسار أو لغز تشخيصي..."
 : "Ask about details that you didn't understand..."
 }
 className="w-full pl-5 pr-12 py-4 text-base bg-white dark:bg-[#2C2C2E] dark:text-[var(--text-primary)] border border-neutral-300/60 dark:border-white/[0.15]/60 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-med-blue focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950 focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10 font-medium transition placeholder:text-neutral-500 dark:text-[#EBEBF599] shadow-elevation-1"
 />
 <button
 type="submit"
 className="absolute right-2 top-1/2 -translate-y-1/2 p-3 bg-med-gold hover:bg-med-gold text-white rounded-lg cursor-pointer flex items-center justify-center shadow-elevation-1"
 >
 <Send className="w-icon-sm h-icon-sm" />
 </button>
 </div>
 {postMuteError && (
   <p className="text-caption font-medium text-rose-600 dark:text-rose-400 flex items-center gap-2">
     <MicOff className="w-3.5 h-3.5 shrink-0" />{postMuteError}
   </p>
 )}
 </form>
 )}

 {/* Questions List */}
 <div className="space-y-4">
 <h3 className="text-sm uppercase font-semibold text-neutral-500 dark:text-[#EBEBF599] dark:text-[var(--text-muted)]">
 {isRtl
 ? "منتديات النقاش السريري التفاعلية:"
 : "Collaborative Clinical Forums:"}
 </h3>

 {lectureQuestions.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-16 px-6 text-center w-full antialiased border border-dashed border-neutral-200 dark:border-white/[0.12] rounded-xl bg-neutral-50/50 dark:bg-white/[0.08] mt-4">
 <div className="relative mb-6">
 
 <div className="relative w-20 h-20 rounded-full bg-white dark:bg-[#1C1C1E] flex items-center justify-center ring-1 ring-black/[0.04] dark:ring-white/[0.06] shadow-elevation-1 dark:shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
 <MessageSquare className="w-10 h-10 text-neutral-500 dark:text-[#EBEBF599] dark:text-[var(--text-muted)]" />
 </div>
 </div>
 <h3 className="font-display text-xl font-semibold text-neutral-900 dark:text-[var(--text-primary)] mb-2">
 {isRtl ? "لا توجد نقاشات" : "No Discussions Yet"}
 </h3>
 <p className="text-base font-medium text-neutral-500 dark:text-[var(--text-secondary)] max-w-[280px] text-balance">
 {isRtl
 ? "لا توجد نقاشات مفتوحة بعد حول هذا الفصل الدراسي. كن أول من يبدأ بالاستكشاف والمساءلة!"
 : "No open discussion threads on this topic yet. Be the first to initiate research!"}
 </p>
 </div>
 ) : (
 lectureQuestions.map((q) => {
 const isExpanded = activeQuestionId === q.id;
 const questionLiked = likedItems.includes(q.id);
 const isEditing = editingQuestionId === q.id;
 const isQBlocked = (q.isBlocked || blockedUserIds.has(q.user_id)) && q.user_id !== currentUser.id;

 if (isQBlocked && !revealedComments.has(q.id)) {
   return (
     <div key={q.id} className="p-3 border border-neutral-100 dark:border-white/[0.08] rounded-md bg-neutral-50 dark:bg-[#2C2C2E]/40 flex items-center justify-between gap-3">
       <p className="text-caption text-neutral-400 dark:text-neutral-600 italic">Content from a blocked user</p>
       <button
         type="button"
         onClick={() => setRevealedComments((prev) => new Set([...prev, q.id]))}
         className="text-caption text-med-blue dark:text-blue-400 font-semibold hover:underline cursor-pointer shrink-0"
       >
         Show anyway
       </button>
     </div>
   );
 }

 return (
 <div
 key={q.id}
 className="p-4 border border-neutral-100 dark:border-white/[0.12] rounded-md bg-white dark:bg-[#2C2C2E] shadow-elevation-1 space-y-3 text-left"
 >
 {/* Question Header Card */}
  <div className="lecture-qa-question-header flex justify-between items-start gap-3">
  <div className="lecture-qa-author flex items-center gap-3 min-w-0">
                          <UserAvatar 
                            name={q.userName} 
                            avatarUrl={q.userAvatar} 
                            className="w-8 h-8 rounded-full border border-neutral-100 dark:border-white/[0.12] shrink-0 select-none pointer-events-none"
                          />
 <div>
  <div className="lecture-qa-actions flex items-center gap-2">
 <span className="text-caption font-semibold text-neutral-800 dark:text-white dark:text-[var(--text-secondary)]">
 {q.userName}
 </span>
 {(q.user_id === currentUser.id ||
 q.user_id === "current_u") && (
 <span className="text-caption bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400 px-2 py-1 rounded-md font-semibold">
 {isRtl ? "سؤالي" : "My Thread"}
 </span>
 )}
 </div>
 <span className="text-caption text-neutral-500 dark:text-[#EBEBF599] dark:text-[var(--text-muted)]">
 {new Date(q.createdAt).toLocaleDateString()}
 </span>
 </div>
 </div>

 <div className="flex items-center gap-2">
 {/* Question owner utilities */}
 {(q.user_id === currentUser.id ||
 q.user_id === "current_u") &&
 !isEditing &&
 (deleteConfirmQuestionId === q.id ? (
 <div className="flex items-center gap-2 bg-rose-50 dark:bg-rose-950/30 px-2 py-1 rounded-lg border border-rose-100 dark:border-rose-900/30">
 <span className="text-caption text-rose-700 dark:text-rose-455 font-semibold shrink-0">
 {isRtl ? "تأكيد الحذف؟" : "Sure?"}
 </span>
 <button
 type="button"
 onClick={() => {
 handleDeleteQuestion(q.id);
 setDeleteConfirmQuestionId(null);
 }}
 className="text-caption px-2 py-1 rounded-sm bg-rose-600 text-white font-semibold hover:bg-rose-700 transition cursor-pointer"
 >
 {isRtl ? "نعم" : "Yes"}
 </button>
 <button
 type="button"
 onClick={() =>
 setDeleteConfirmQuestionId(null)
 }
 className="text-caption px-2 py-1 rounded-sm bg-neutral-200 dark:bg-[#2C2C2E] text-neutral-700 dark:text-[var(--text-secondary)] font-semibold hover:bg-neutral-300 transition cursor-pointer"
 >
 {isRtl ? "لا" : "No"}
 </button>
 </div>
 ) : (
 <div className="flex items-center gap-2 mr-1">
 <button
 type="button"
 onClick={() => {
 setEditingQuestionId(q.id);
 setEditedQuestionContent(q.content);
 }}
 className="p-1 px-2 hover:bg-neutral-100 dark:hover:bg-white/[0.12] rounded-lg text-neutral-500 dark:text-[#EBEBF599] hover:text-med-blue dark:hover:text-blue-400 transition-colors cursor-pointer"
 title="Edit Thread"
 >
 <Edit className="w-icon-sm h-icon-sm" />
 </button>
 <button
 type="button"
 onClick={() =>
 setDeleteConfirmQuestionId(q.id)
 }
 className="p-1 px-2 hover:bg-neutral-100 dark:hover:bg-white/[0.12] rounded-lg text-neutral-500 dark:text-[#EBEBF599] hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
 title="Delete Thread"
 >
 <Trash2 className="w-icon-sm h-icon-sm" />
 </button>

 </div>
 ))}

                      {/* Report / Block — shown for other users' questions, outside the own-question guard */}
                      {q.user_id !== currentUser.id && !isEditing && (
                        <>
                          {/* Report question */}
                          <button
                            type="button"
                            onClick={() => setReportTarget({
                              commentId: q.id,
                              commentType: "question",
                              commentContent: q.content,
                              reportedUserId: q.user_id,
                              lectureId: lecture.id,
                            })}
                            className={`p-1 px-2 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors cursor-pointer ${reportSuccessId === q.id ? "text-emerald-500" : "text-neutral-500 hover:text-rose-600 dark:hover:text-rose-400"}`}
                            title="Report Content"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-icon-sm h-icon-sm"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                          </button>
                          {/* Block question author */}
                          {!blockedUserIds.has(q.user_id) && (
                            <button
                              type="button"
                              onClick={() => showiOSAlert({
                                title: "Block User",
                                message: "Block this user? You will no longer see their posts and replies.",
                                actions: [
                                  { label: "Cancel", style: "cancel" },
                                  { label: "Block", style: "destructive", onClick: () => handleBlockUser(q.user_id) },
                                ],
                              })}
                              className="p-1 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg text-neutral-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                              title="Block User"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-icon-sm h-icon-sm"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>
                            </button>
                          )}
                        </>
                      )}

 {/* iOS Style Like Button for Questions */}
 <motion.button
 whileTap={{ scale: 0.85 }}
 onClick={() => handleUpvoteQuestion(q.id)}
 className={`text-caption font-mono flex items-center gap-1 px-3 py-1 border rounded-full transition cursor-pointer ${
 questionLiked
 ? "text-rose-600 bg-rose-50 border-rose-200 dark:bg-rose-950/20 dark:border-rose-900/50"
 : "text-neutral-500 hover:text-rose-600 dark:text-[var(--text-secondary)] bg-neutral-50 hover:bg-neutral-100 border-neutral-200 dark:bg-[#2C2C2E]/40 dark:border-white/[0.12]"
 }`}
 >
 <Heart className={`w-icon-sm h-icon-sm ${questionLiked ? "fill-rose-500 text-rose-500" : ""}`} />
 <span className="font-semibold leading-none">
 {q.upvotes}
 </span>
 </motion.button>
 </div>
 </div>

 {/* Question Content body */}
 {isEditing ? (
 <div className="bg-neutral-50 dark:bg-neutral-850 p-3 rounded-lg border border-neutral-200 dark:border-white/[0.12] space-y-2 mt-1">
 <textarea aria-label="Text area"
 rows={2}
 value={editedQuestionContent}
 onChange={(e) =>
 setEditedQuestionContent(e.target.value)
 }
 className="w-full text-caption p-2 bg-white dark:bg-[#2C2C2E] dark:text-[var(--text-primary)] border border-neutral-250 dark:border-white/[0.12] rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-med-blue focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950 focus:border-amber-500"
 />
 <div className="flex justify-end gap-2">
 <button
 type="button"
 onClick={() => setEditingQuestionId(null)}
 className="px-3 py-1 text-caption rounded-sm bg-neutral-200 dark:bg-[#2C2C2E] text-neutral-700 dark:text-[var(--text-secondary)] font-semibold hover:bg-neutral-300 dark:hover:bg-white/[0.18] transition cursor-pointer flex items-center gap-1"
 >
 <X className="w-3 h-3" />{" "}
 {isRtl ? "إلغاء" : "Cancel"}
 </button>
 <button
 type="button"
 onClick={() =>
 handleEditQuestion(
 q.id,
 editedQuestionContent,
 )
 }
 className="px-3 py-1 text-caption rounded-sm bg-med-gold text-white font-semibold hover:bg-amber-700 transition cursor-pointer flex items-center gap-1"
 >
 <Check className="w-3 h-3" />{" "}
 {isRtl ? "حفظ" : "Save"}
 </button>
 </div>
 </div>
 ) : (
 <p className="font-sans text-caption text-neutral-700 dark:text-[var(--text-secondary)] font-normal">
 {q.content}
 </p>
 )}

 {/* Collapsible replies thread */}
 <div>
 <button
 onClick={() =>
 setActiveQuestionId(isExpanded ? null : q.id)
 }
 className="text-caption text-med-gold dark:text-amber-400 font-semibold hover:underline cursor-pointer flex items-center gap-1 mt-2"
 >
 {isExpanded
 ? isRtl
 ? "إخفاء الردود العلمية"
 : "Hide Replies"
 : `${isRtl ? "عرض الردود الطبية" : "View Replies"} (${q.answers.length})`}
 </button>

 {isExpanded && (
 <div className="mt-4 pt-4 border-t border-neutral-100 dark:border-white/[0.12] space-y-4 animate-fadeIn">
 {/* Answers thread */}
 <div className="space-y-4 pl-3 border-l-2 border-amber-500/30 dark:border-white/[0.12]">
 {q.answers.map((ans) => {
 const answerLiked = likedItems.includes(
 ans.id,
 );
 const isAnsBlocked = (ans.isBlocked || blockedUserIds.has(ans.userId)) && ans.userId !== currentUser.id;
 if (isAnsBlocked && !revealedComments.has(ans.id)) {
   return (
     <div key={ans.id} className="p-3 border border-neutral-100 dark:border-white/[0.08] rounded-md bg-neutral-50 dark:bg-[#2C2C2E]/40 flex items-center justify-between gap-3">
       <p className="text-caption text-neutral-400 dark:text-neutral-600 italic">Reply from a blocked user</p>
       <button
         type="button"
         onClick={() => setRevealedComments((prev) => new Set([...prev, ans.id]))}
         className="text-caption text-med-blue dark:text-blue-400 font-semibold hover:underline cursor-pointer shrink-0"
       >
         Show anyway
       </button>
     </div>
   );
 }
 return (
 <div
 key={ans.id}
 className={`p-4 rounded-md border text-left transition duration-fast relative ${
 ans.isBest
 ? "bg-emerald-50/40 dark:bg-emerald-950/15 border-emerald-200 dark:border-emerald-900/30 shadow-elevation-1"
 : "bg-neutral-50/50 dark:bg-[#2C2C2E]/25 border-neutral-100 dark:border-white/[0.10] shadow-elevation-0"
 }`}
 >
 {/* Header row with inline alignment */}
  <div className="lecture-qa-answer-header flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-100 dark:border-white/[0.06] pb-3 mb-3">
 <div className="lecture-qa-author flex items-center gap-2 flex-wrap min-w-0">
                          <UserAvatar 
                            name={ans.userName} 
                            avatarUrl={ans.userAvatar} 
                            className="w-icon-lg h-icon-lg rounded-full border border-neutral-100 dark:border-white/[0.12] shrink-0 select-none pointer-events-none"
                          />
 <span className="text-caption font-semibold text-[#1E293B] dark:text-[var(--text-secondary)]">
 {ans.userName}
 </span>

 {/* Balanced Recommended badge */}
 {ans.isBest && (
 <span className="text-caption font-semibold text-emerald-800 bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-950/60 px-2 py-1 rounded-lg flex items-center gap-1">
 <Star className="w-3 h-3 fill-emerald-600 text-emerald-600" />{" "}
 {isRtl
 ? "الإجابة الطبية المعتمدة"
 : "Best Answer Selected"}
 </span>
 )}
 </div>

  <div className="lecture-qa-actions flex items-center gap-2">
 {/* Edit / Delete actions for the reply author */}
 {(ans.userId === currentUser.id ||
 ans.userId === "current_u") &&
 (deleteConfirmAnswerId ===
 ans.id ? (
 <div className="flex items-center gap-1 bg-rose-50 dark:bg-rose-500/15 dark:border-rose-500/30 px-2 py-1 rounded-lg border border-rose-100 dark:border-rose-900/30">
 <span className="text-caption text-rose-700 dark:text-rose-400 font-semibold">
 {isRtl ? "حذف؟" : "Sure?"}
 </span>
 <button
 type="button"
 onClick={() => {
 handleDeleteAnswer(
 q.id,
 ans.id,
 );
 setDeleteConfirmAnswerId(
 null,
 );
 }}
 className="text-caption px-2 py-1 rounded-sm bg-rose-600 text-white font-semibold hover:bg-rose-700 transition cursor-pointer"
 >
 {isRtl ? "نعم" : "Yes"}
 </button>
 <button
 type="button"
 onClick={() =>
 setDeleteConfirmAnswerId(
 null,
 )
 }
 className="text-caption px-2 py-1 rounded-sm bg-neutral-200 dark:bg-[#2C2C2E] text-neutral-700 dark:text-[var(--text-secondary)] font-semibold hover:bg-neutral-300 transition cursor-pointer"
 >
 {isRtl ? "لا" : "No"}
 </button>
 </div>
 ) : (
 <div className="flex items-center gap-2 mr-1">
 <button
 type="button"
 onClick={() => {
 setEditingAnswerId(
 ans.id,
 );
 setEditedAnswerContent(
 ans.content,
 );
 }}
 className="p-1 hover:bg-neutral-100 dark:hover:bg-white/[0.12] rounded-lg text-neutral-500 dark:text-[#EBEBF599] hover:text-med-blue dark:hover:text-blue-400 transition-colors cursor-pointer"
 title="Edit Reply"
 >
 <Edit className="w-icon-sm h-icon-sm" />
 </button>
 <button
 type="button"
 onClick={() =>
 setDeleteConfirmAnswerId(
 ans.id,
 )
 }
 className="p-1 hover:bg-neutral-100 dark:hover:bg-white/[0.12] rounded-lg text-neutral-500 dark:text-[#EBEBF599] hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
 title="Delete Reply"
 >
 <Trash2 className="w-icon-sm h-icon-sm" />
 </button>

 </div>
 ))}

                              {/* Report / Block — shown for other users' answers, outside the own-answer guard */}
                              {ans.userId !== currentUser.id && (
                                <>
                                  {/* Report answer */}
                                  <button
                                    type="button"
                                    onClick={() => setReportTarget({
                                      commentId: ans.id,
                                      commentType: "answer",
                                      commentContent: ans.content,
                                      reportedUserId: ans.userId,
                                      lectureId: lecture.id,
                                    })}
                                    className={`p-1 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors cursor-pointer ${reportSuccessId === ans.id ? "text-emerald-500" : "text-neutral-500 hover:text-rose-600 dark:hover:text-rose-400"}`}
                                    title="Report Content"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-icon-sm h-icon-sm"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                                  </button>
                                  {/* Block answer author */}
                                  {!blockedUserIds.has(ans.userId) && (
                                    <button
                                      type="button"
                                      onClick={() => showiOSAlert({
                                        title: "Block User",
                                        message: "Block this user? You will no longer see their posts and replies.",
                                        actions: [
                                          { label: "Cancel", style: "cancel" },
                                          { label: "Block", style: "destructive", onClick: () => handleBlockUser(ans.userId) },
                                        ],
                                      })}
                                      className="p-1 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg text-neutral-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                                      title="Block User"
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-icon-sm h-icon-sm"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>
                                    </button>
                                  )}
                                </>
                              )}

 {/* Heart Upvote button inline */}
 <motion.button
 whileTap={{ scale: 0.8 }}
 onClick={() =>
 handleUpvoteAnswer(q.id, ans.id)
 }
 className={`text-caption font-mono flex items-center gap-1 px-3 py-1 rounded-full border transition cursor-pointer ${
 answerLiked
 ? "text-rose-600 bg-rose-50 border-rose-200 dark:bg-rose-500/15 dark:border-rose-500/30 dark:border-rose-900/50"
 : "text-neutral-500 hover:text-rose-600 dark:text-[var(--text-secondary)] bg-neutral-100/50 hover:bg-neutral-100 dark:bg-[#2C2C2E] dark:border-white/[0.15]"
 }`}
 >
 <Heart className={`w-3 h-3 ${answerLiked ? "fill-rose-500 text-rose-500" : ""}`} />
 <span className="font-semibold">
 {ans.upvotes}
 </span>
 </motion.button>

 {/* ONLY Question Thread Owner gets Best Answer Actions */}
 {(q.user_id === currentUser.id ||
 q.user_id === "current_u") && (
 <motion.button
 whileTap={{ scale: 0.93 }}
 onClick={() => {
 if (ans.isBest) {
 handleRemoveBestAnswer(
 q.id,
 ans.id,
 );
 } else {
 handleSetBestAnswer(
 q.id,
 ans.id,
 );
 }
 }}
 className={`text-caption px-3 py-1 rounded-full border font-semibold transition cursor-pointer flex items-center gap-1 ${
 ans.isBest
 ? "bg-rose-600 hover:bg-rose-700 text-white border-transparent"
 : "bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-400"
 }`}
 >
 {ans.isBest
 ? isRtl
 ? "إزالة الاعتماد"
 : "Deselect Best"
 : isRtl
 ? "اعتماد كأفضل"
 : "Mark as Best"}
 </motion.button>
 )}
 </div>
 </div>

 {editingAnswerId === ans.id ? (
 <div className="space-y-2 mt-2">
 <textarea aria-label="Text area"
 value={editedAnswerContent}
 onChange={(e) =>
 setEditedAnswerContent(
 e.target.value,
 )
 }
 rows={2}
 className="w-full p-3 text-caption bg-white dark:bg-[#2C2C2E] dark:text-[var(--text-secondary)] border border-neutral-200 dark:border-white/[0.12] rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-med-blue focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950 focus:border-amber-500/80 font-medium font-sans"
 />
 <div className="flex justify-end gap-2">
 <button
 type="button"
 onClick={() =>
 setEditingAnswerId(null)
 }
 className="px-3 py-1 text-caption rounded-sm bg-neutral-100 dark:bg-[#2C2C2E] text-neutral-600 dark:text-[var(--text-secondary)] font-semibold hover:bg-neutral-200 dark:hover:bg-neutral-750 transition cursor-pointer flex items-center gap-1"
 >
 <X className="w-3 h-3" />{" "}
 {isRtl ? "إلغاء" : "Cancel"}
 </button>
 <button
 type="button"
 onClick={() =>
 handleEditAnswer(
 q.id,
 ans.id,
 editedAnswerContent,
 )
 }
 className="px-3 py-1 text-caption rounded-sm bg-med-gold text-white font-semibold hover:bg-amber-700 transition cursor-pointer flex items-center gap-1"
 >
 <Check className="w-3 h-3" />{" "}
 {isRtl ? "حفظ" : "Save"}
 </button>
 </div>
 </div>
 ) : (
 <p className="mt-1 font-sans text-caption text-neutral-700 dark:text-[var(--text-secondary)] font-normal">
 {ans.content}
 </p>
 )}
 </div>
 );
 })}
 </div>

 {/* Write answer reply */}
 <div className="pt-2 border-t border-neutral-50 dark:border-white/[0.12]">
 {muteStatus?.isMuted ? (
   <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200/50 dark:border-rose-800/30">
     <MicOff className="w-4 h-4 shrink-0 text-rose-500 dark:text-rose-400" />
     <p className="text-caption font-medium text-rose-700 dark:text-rose-400">
       {isRtl ? "أنت محظور من الرد" : "You are muted and cannot reply"}
       {muteStatus.isPermanent
         ? ` (${isRtl ? "دائم" : "permanent"})`
         : muteStatus.endTime
           ? ` — ${formatMuteRemaining(muteStatus.endTime)}`
           : ""}
     </p>
   </div>
 ) : (
  <div className="lecture-qa-reply flex gap-2">
 <input aria-label="Input field"
 type="text"
 value={replyTexts[q.id] || ""}
 onChange={(e) =>
 setReplyTexts((prev) => ({
 ...prev,
 [q.id]: e.target.value,
 }))
 }
 placeholder={
 isRtl
 ? "قدم حلاً سريرياً مقتضباً أو شرحاً للتشخيص الفارق..."
 : "Provide clinical resolution based on exam keys or lectures..."
 }
 className="flex-1 px-4 py-2 text-caption bg-neutral-50 dark:bg-[#1C1C1E] border border-neutral-200 dark:border-white/[0.12] dark:text-[var(--text-secondary)] rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-med-blue focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950 focus:border-amber-500/80 transition font-medium"
 />
 <button
 onClick={() => handlePostAnswer(q.id)}
 className="px-4 py-2 bg-neutral-900 hover:bg-neutral-850 dark:bg-med-gold dark:hover:bg-amber-700 text-white rounded-lg text-caption font-semibold cursor-pointer transition-colors"
 >
 {isRtl ? "إرسال الرد" : "Reply"}
 </button>
 </div>
 )}
 </div>
 </div>
 )}
 </div>
 </div>
 );
 })
 )}
 </div>
 </div>
   </motion.div>
  )}
  </AnimatePresence>



  {/* Report sheet — bottom-sheet modal for submitting Q&A reports */}
  <ReportSheet
    target={reportTarget}
    onClose={() => setReportTarget(null)}
    onSuccess={() => {
      if (reportTarget) {
        setReportSuccessId(reportTarget.commentId);
        setTimeout(() => setReportSuccessId(null), 3000);
      }
      setReportTarget(null);
    }}
  />

  {/* Community Guidelines modal — shown before first Q&A post */}
  <CommunityGuidelines
    open={showGuidelines}
    onAgree={() => {
      localStorage.setItem(guidelinesKey, "1");
      setShowGuidelines(false);
    }}
  />
  </motion.div>
  </div>
  );
};

export default memo(LectureDetailView);
