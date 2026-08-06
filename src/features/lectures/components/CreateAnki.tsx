import { apiClient } from "../../../core/api/apiClient";
import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect, Suspense, memo, lazy } from "react";
import { useTreeSelection } from "../../../core/hooks/useTreeSelection";
import { SubjectId } from "../../../core/types";
import {
 Sparkles,
 CircleCheck,
 AlertCircle,
 RefreshCcw,
 Layers,
 Search, HelpCircle,
} from "lucide-react";

interface Lecture {
 id: string;
 name: string;
 mainSubject: string;
 subSubject?: string | null;
 trackMode: string;
 department?: string | null;
}

interface CreateAnkiProps {
 language?: "en" | "ar";
 onSuccess?: () => void;
}

export default function CreateAnki({ language = "en", onSuccess }: CreateAnkiProps) {
 const isRtl = language === "ar";

 const [lectures, setLectures] = useState<Lecture[]>([]);
 const [isLoadingLectures, setIsLoadingLectures] = useState(false);

 // Tree path selection
 const {
 mainSubject,
 subSubject,
 trackMode,
 department,
 setMainSubject,
 setSubSubject,
 setTrackMode,
 setDepartment,
 subSubjectOptions,
 trackModeOptions,
 departmentOptions,
 requiresDepartmentSelection,
 canProceedToLecture,
 treeConfig,
 } = useTreeSelection();

 // Form Fields
 const [selectedLectureId, setSelectedLectureId] = useState("");
 const [clinicalConcept, setClinicalConcept] = useState("");
 const [explanation, setExplanation] = useState("");

 // Status state
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [feedback, setFeedback] = useState<{
 type: "success" | "error";
 message: string;
 } | null>(null);

 // Fetch lectures for the SPECIFIC chosen tree path
 const fetchLecturesForPath = async () => {
 if (!canProceedToLecture) {
 setLectures([]);
 setSelectedLectureId("");
 return;
 }

 setIsLoadingLectures(true);
 try {
 const params = new URLSearchParams();
 if (mainSubject) params.append("mainSubject", mainSubject);
 if (subSubject) params.append("subSubject", subSubject);
 if (trackMode) params.append("trackMode", trackMode);
 if (department) params.append("department", department);

 const res = await apiClient(`/api/lectures?${params.toString()}`);
 if (res.ok) {
 const data = await res.json();
 setLectures(data);
 if (data.length > 0) {
 setSelectedLectureId(data[0].id);
 } else {
 setSelectedLectureId("");
 }
 }
 } catch (err) {
 
 } finally {
 setIsLoadingLectures(false);
 }
 };

 // Re-fetch whenever selected path completes
 useEffect(() => {
 fetchLecturesForPath();
 }, [mainSubject, subSubject, trackMode, department, canProceedToLecture]);

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 if (!selectedLectureId) {
 setFeedback({
 type: "error",
 message: isRtl
 ? "يرجى اختيار المحاضرة المستهدفة."
 : "Please choose an associated study lecture.",
 });
 return;
 }
 if (!clinicalConcept.trim() || !explanation.trim()) {
 setFeedback({
 type: "error",
 message: isRtl
 ? "يرجى ملء المفهوم السريري والشرح بالكامل."
 : "Both the clinical concept and explanatory text must be entered.",
 });
 return;
 }

 setIsSubmitting(true);
 setFeedback(null);

 try {
 const response = await apiClient("/api/flashcards", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 clinicalConcept: clinicalConcept.trim(),
 explanation: explanation.trim(),
 lectureId: selectedLectureId,
 }),
 });

 const data = await response.json();
 if (!response.ok) {
 throw new Error(data.error || "Failed to create flashcard record.");
 }

 setFeedback({
 type: "success",
 message: isRtl
 ? "🎉 تم إنشاء بطاقة أنكي الطبية بنجاح وإلحاقها بمسار المذاكرة البصرية التفاعلية!"
 : "🎉 Medical Anki flashcard drafted and appended successfully to the study node!",
 });

 setClinicalConcept("");
 setExplanation("");
 onSuccess?.();
 } catch (err: any) {
 setFeedback({ type: "error", message: err.message });
 } finally {
 setIsSubmitting(false);
 }
 };

 return (
 <div id="create_anki_form" className="space-y-section">
 <div className="border-b border-neutral-100 dark:border-neutral-850 pb-3 flex items-center gap-2 group relative">
 <h3 className="text-body font-display font-semibold text-neutral-800 dark:text-white flex items-center gap-2">
 <Layers className="w-icon-md h-icon-md text-rose-500" />
 {isRtl
 ? "إضافة بطاقة تذكر طبي (أنكي)"
 : "Forge Clinical Anki Flashcard"}
 </h3>
 <HelpCircle className="w-icon-sm h-icon-sm text-neutral-500 dark:text-[#EBEBF599] cursor-help" />
 <div className="absolute top-full left-0 mt-2 w-64 p-2 bg-neutral-800/95 dark:bg-neutral-700/95 backdrop-blur-sm text-white text-xs rounded-lg shadow-elevation-3 opacity-0 pointer-events-none group-hover:opacity-80 transition-opacity z-50">
 {isRtl
 ? "إنشاء محتوى تذكر متباعد سريع (Anki Spaced Repetition) لربط المفهوم السريري بالتفسير."
 : "Formulate spaced repetition flashcards covering high-yield medical triggers and diagnosis pearls."}
 </div>
 </div>

 {feedback && (
 <div
 className={`p-4 rounded-md flex items-start gap-3 text-caption animate-fadeIn ${
 feedback.type === "success"
 ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/40"
 : "bg-rose-50 dark:bg-rose-950/20 text-rose-800 dark:text-rose-400 border border-rose-100 dark:border-rose-900/40"
 }`}
 >
 {feedback.type === "success" ? (
 <CircleCheck className="w-icon-sm h-icon-sm text-emerald-500 shrink-0 mt-1" />
 ) : (
 <AlertCircle className="w-icon-sm h-icon-sm text-rose-500 shrink-0 mt-1" />
 )}
 <span>{feedback.message}</span>
 </div>
 )}

 <div className="space-y-section">
 {/* Step 1: Main Subject Selection */}
 <div className="bg-white dark:bg-[#1C1C1E]/40 p-4 sm:p-5 rounded-lg border border-black/5 dark:border-white/[0.12] shadow-elevation-1 space-y-3">
 <div className="flex items-center gap-2 mb-1">
 <span className="w-icon-md h-icon-md rounded-full bg-neutral-100 dark:bg-[#2C2C2E] text-xs font-semibold text-neutral-600 dark:text-[#EBEBF599] flex items-center justify-center shrink-0">
 1
 </span>
 <label className="text-subhead font-semibold text-neutral-800 dark:text-white">
 {isRtl ? "المادة الرئيسية" : "Main subject"}
 </label>
 </div>
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
 {(Object.keys(treeConfig) as SubjectId[]).map((subjId) => {
 const active = mainSubject === subjId;
 return (
 <button
 key={subjId}
 type="button"
 onClick={() => setMainSubject(subjId)}
 className={`px-3 py-2 rounded-lg border text-caption font-semibold transition text-center flex flex-col items-center justify-center gap-1 ${
 active
 ? "bg-rose-500 border-rose-600 text-white shadow-elevation-1 ring-1 ring-rose-500/20 scale-[1.02]"
 : "bg-white dark:bg-[#1C1C1E] border-neutral-200 dark:border-white/[0.12] text-neutral-700 dark:text-[#EBEBF599] hover:bg-neutral-50 dark:hover:bg-neutral-850"
 }`}
 >
 <span className="font-mono text-caption">{subjId}</span>
 <span className="text-caption font-medium opacity-80">
 {treeConfig[subjId].name}
 </span>
 </button>
 );
 })}
 </div>
 </div>

 {/* Conditional Step 2: Sub-subject Selection */}
 {mainSubject && treeConfig[mainSubject].subSubjects && (
 <div className="bg-white dark:bg-[#1C1C1E]/40 p-4 sm:p-5 rounded-lg border border-black/5 dark:border-white/[0.12] shadow-elevation-1 space-y-3 animate-fadeIn">
 <div className="flex items-center gap-2 mb-1">
 <span className="w-icon-md h-icon-md rounded-full bg-neutral-100 dark:bg-[#2C2C2E] text-xs font-semibold text-neutral-600 dark:text-[#EBEBF599] flex items-center justify-center shrink-0">
 2
 </span>
 <label className="text-subhead font-semibold text-neutral-800 dark:text-white">
 {isRtl ? "المادة الفرعية" : "Sub-subject dimension"}
 </label>
 </div>
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
 {subSubjectOptions.map((sub) => {
 const active = subSubject === sub;
 return (
 <button
 key={sub}
 type="button"
 onClick={() => setSubSubject(sub)}
 className={`px-3 py-2 text-caption font-semibold rounded-lg border text-center transition ${
 active
 ? "bg-rose-500 border-rose-600 text-white shadow-elevation-1 scale-[1.02]"
 : "bg-white dark:bg-[#1C1C1E] border-neutral-200 dark:border-white/[0.12] text-neutral-700 dark:text-[#EBEBF599] hover:bg-neutral-50 dark:hover:bg-neutral-850"
 }`}
 >
 {sub}
 </button>
 );
 })}
 </div>
 </div>
 )}

 {/* Step 3: Track Mode Selection */}
 {mainSubject &&
 (!treeConfig[mainSubject].subSubjects || subSubject) && (
 <div className="bg-white dark:bg-[#1C1C1E]/40 p-4 sm:p-5 rounded-lg border border-black/5 dark:border-white/[0.12] shadow-elevation-1 space-y-3 animate-fadeIn">
 <div className="flex items-center gap-2 mb-1">
 <span className="w-icon-md h-icon-md rounded-full bg-neutral-100 dark:bg-[#2C2C2E] text-xs font-semibold text-neutral-600 dark:text-[#EBEBF599] flex items-center justify-center shrink-0">
 3
 </span>
 <label className="text-subhead font-semibold text-neutral-800 dark:text-white">
 {isRtl ? "مسار الدراسة" : "Academic track"}
 </label>
 </div>
 <div className="flex gap-2">
 {trackModeOptions.map((track) => {
 const active = trackMode === track;
 return (
 <button
 key={track}
 type="button"
 onClick={() => setTrackMode(track)}
 className={`px-4 py-2 text-caption font-semibold rounded-lg border transition flex-1 text-center ${
 active
 ? "bg-rose-500 border-rose-600 text-white shadow-elevation-1 scale-[1.02]"
 : "bg-white dark:bg-[#1C1C1E] border-neutral-200 dark:border-white/[0.12] text-neutral-700 dark:text-[#EBEBF599] hover:bg-neutral-50 dark:hover:bg-neutral-850"
 }`}
 >
 {track}
 </button>
 );
 })}
 </div>
 </div>
 )}

 {/* Step 4: Department Selection */}
 {mainSubject && trackMode && (
 <div className="bg-white dark:bg-[#1C1C1E]/40 p-4 sm:p-5 rounded-lg border border-black/5 dark:border-white/[0.12] shadow-elevation-1 space-y-3 animate-fadeIn">
 <div className="flex items-center gap-2 mb-1">
 <span className="w-icon-md h-icon-md rounded-full bg-neutral-100 dark:bg-[#2C2C2E] text-xs font-semibold text-neutral-600 dark:text-[#EBEBF599] flex items-center justify-center shrink-0">
 4
 </span>
 <label className="text-subhead font-semibold text-neutral-800 dark:text-white">
 {isRtl
 ? "القسم الأكاديمي المختص"
 : "Clinical department"}
 </label>
 </div>
 {requiresDepartmentSelection ? (
 <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
 {departmentOptions.map((dept) => {
 const active = department === dept;
 return (
 <button
 key={dept}
 type="button"
 onClick={() => setDepartment(dept)}
 className={`px-3 py-2 text-caption font-medium rounded-lg border text-center transition ${
 active
 ? "bg-rose-500 border-rose-600 text-white shadow-elevation-1 scale-[1.02]"
 : "bg-white dark:bg-[#1C1C1E] border-neutral-200 dark:border-white/[0.12] text-neutral-700 dark:text-[#EBEBF599] hover:bg-neutral-50 dark:hover:bg-neutral-850"
 }`}
 >
 {dept}
 </button>
 );
 })}
 </div>
 ) : (
 <div className="p-3 bg-neutral-50 dark:bg-neutral-850 border border-neutral-200/50 dark:border-white/[0.12] text-neutral-500 dark:text-[#EBEBF599] text-caption rounded-lg flex items-center gap-2">
 <Sparkles className="w-icon-sm h-icon-sm text-rose-400 shrink-0" />
 <span>
 {isRtl
 ? "لا ينطبق إعداد القسم لهذه المادة. يتم تخطي هذا الإجراء والتحويل للمحاضرة مباشرة."
 : "No specific department requirement mapped for this node. Selection is automatically skipped."}
 </span>
 </div>
 )}
 </div>
 )}

 {/* ONCE TREE PATH IS FULLY SELECTED */}
 {canProceedToLecture && (
 <form
 onSubmit={handleSubmit}
 className="flex-1 flex flex-col space-y-5 animate-fadeIn"
 >
 <div className="bg-white dark:bg-[#1C1C1E]/40 p-4 sm:p-5 rounded-lg border border-black/5 dark:border-white/[0.12] shadow-elevation-1 space-y-4">
 {/* Lecture Dropdown selector for the selected path */}
 <div className="space-y-2">
 <div className="flex items-center justify-between mb-1">
 <div className="flex items-center gap-2">
 <span className="w-icon-md h-icon-md rounded-full bg-neutral-100 dark:bg-[#2C2C2E] text-xs font-semibold text-neutral-600 dark:text-[#EBEBF599] flex items-center justify-center shrink-0">
 5
 </span>
 <label className="text-subhead font-semibold text-neutral-800 dark:text-white">
 {isRtl
 ? "المحاضرة المرفقة بالبطاقة"
 : "Select Associated Lecture"}
 </label>
 </div>
 <button
 type="button"
 onClick={fetchLecturesForPath}
 className="text-body font-semibold text-rose-500 hover:text-rose-400 flex items-center gap-1 font-mono bg-transparent border-none cursor-pointer"
 >
 <RefreshCcw className={`w-3 h-3 ${isLoadingLectures ? "animate-spin" : ""}`} />
 {isRtl ? "تحديث" : "Reload"}
 </button>
 </div>

 {isLoadingLectures ? (
 <div className="h-12 w-full bg-neutral-100 dark:bg-neutral-850 animate-pulse rounded-lg" />
 ) : lectures.length === 0 ? (
 <div className="p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-150 dark:border-amber-900/50 text-amber-800 dark:text-amber-400 text-caption rounded-lg flex items-center gap-2">
 <AlertCircle className="w-icon-md h-icon-md text-med-gold shrink-0" />
 <span>
 {isRtl
 ? "🚨 لا توجد محاضرات مصنفة في هذا المسار حالياً. برجاء إنشاء محاضرة أولاً!"
 : "No lectures have been registered in this exact branch yet."}
 </span>
 </div>
 ) : (
 <select
 value={selectedLectureId}
 onChange={(e) => setSelectedLectureId(e.target.value)}
 className="w-full px-4 py-3 bg-white dark:bg-[#1C1C1E] border border-neutral-300 dark:border-white/[0.12] text-neutral-800 dark:text-white rounded-lg font-medium text-caption outline-none focus:ring-1 focus:ring-rose-500"
 >
 {lectures.map((l) => (
 <option key={l.id} value={l.id}>
 {l.name}
 </option>
 ))}
 </select>
 )}
 </div>

 {/* ONLY RENDER THE FORMS IF A VALID LECTURE WAS SELECTIONABLE */}
 {selectedLectureId && (
 <>
 {/* Card Front: Clinical Concept */}
 <div className="space-y-2 pt-2 border-t border-neutral-100 dark:border-white/[0.08]">
 <div className="flex items-center gap-2 mb-1">
 <span className="w-icon-md h-icon-md rounded-full bg-neutral-100 dark:bg-[#2C2C2E] text-xs font-semibold text-neutral-600 dark:text-[#EBEBF599] flex items-center justify-center shrink-0">
 6
 </span>
 <label className="text-subhead font-semibold text-neutral-800 dark:text-white">
 {isRtl
 ? "المفهوم السريري أو السؤال (الوجه الأمامي)"
 : "Clinical Prompt / Concept Cue (Card Front)"}
 </label>
 </div>
 <input aria-label="Input field"
 type="text"
 required
 placeholder={
 isRtl
 ? "مثال: مظهر العقد البلورية في داء النقرس..."
 : "e.g., Clinical triad of Normal Pressure Hydrocephalus (NPH)..."
 }
 value={clinicalConcept}
 onChange={(e) => setClinicalConcept(e.target.value)}
 className="w-full px-4 py-3 bg-white dark:bg-[#1C1C1E] border border-neutral-300 dark:border-white/[0.12] text-neutral-800 dark:text-white rounded-lg font-medium text-caption focus:ring-1 focus:ring-rose-500 outline-none"
 />
 </div>

 {/* Card Back: Explanation/Answer */}
 <div className="space-y-2 pt-2 border-t border-neutral-100 dark:border-white/[0.08]">
 <div className="flex items-center gap-2 mb-1">
 <span className="w-icon-md h-icon-md rounded-full bg-neutral-100 dark:bg-[#2C2C2E] text-xs font-semibold text-neutral-600 dark:text-[#EBEBF599] flex items-center justify-center shrink-0">
 7
 </span>
 <label className="text-subhead font-semibold text-neutral-800 dark:text-white">
 {isRtl
 ? "التفسير أو الإجابة (الوجه الخلفي)"
 : "Deduction / Medical Explanation (Card Back)"}
 </label>
 </div>
 <textarea aria-label="Text area"
 required
 rows={4}
 placeholder={
 isRtl
 ? "أدخل تفاصيل الإجابة أو المعايير التشخيصية الكاملة..."
 : "e.g., Wet, wobbly, and wacky: Urinary incontinence, gait ataxia, and cognitive decline."
 }
 value={explanation}
 onChange={(e) => setExplanation(e.target.value)}
 className="w-full px-4 py-3 bg-white dark:bg-[#1C1C1E] border border-neutral-300 dark:border-white/[0.12] text-neutral-800 dark:text-white rounded-lg font-medium text-caption focus:ring-1 focus:ring-rose-500 outline-none"
 />
 </div>
 </>
 )}
 </div>
 
 {/* Act Controls */}
 {selectedLectureId && (
 <div className="fixed bottom-6 ltr:right-6 rtl:left-6 md:bottom-10 md:ltr:right-10 md:rtl:left-10 z-[100] animate-fadeIn flex justify-end">
 <button
 type="submit"
 disabled={
 isSubmitting ||
 !clinicalConcept.trim() ||
 !explanation.trim()
 }
 className={`px-6 py-4 text-base font-semibold rounded-lg shadow-elevation-3 text-white transition select-none cursor-pointer flex items-center justify-center gap-2 ${
 clinicalConcept.trim() &&
 explanation.trim() &&
 !isSubmitting
 ? "bg-rose-600 hover:bg-rose-500 shadow-rose-500/30"
 : "bg-neutral-200 dark:bg-[#2C2C2E] text-neutral-500 dark:text-[#EBEBF599] cursor-not-allowed border-none shadow-elevation-0"
 }`}
 >
 {isSubmitting ? (
 <>
 <div className="w-icon-md h-icon-md rounded-full border-2 border-white/35 border-t-white animate-spin" />
 <span>{isRtl ? "جاري الحفظ..." : "Saving..."}</span>
 </>
 ) : (
 <span>
 {isRtl ? "تسجيل البطاقة الطبية" : "Register Flashcard"}
 </span>
 )}
 </button>
 </div>
 )}
 </form>
 )}
 </div>
 </div>
 );
}
