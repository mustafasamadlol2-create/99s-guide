import { apiClient } from "../../../core/api/apiClient";
import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect, Suspense, memo, lazy } from "react";
import { useTreeSelection } from "../../../core/hooks/useTreeSelection";
import { SubjectId } from "../../../core/types";
import {
 Layers,
 CircleCheck,
 AlertCircle,
 Sparkles,
 FolderPlus,
 Calendar,
 Clock,
 Plus, HelpCircle,
} from "lucide-react";
import { formatToBaghdadISO } from "../../../core/utils/timezone";

interface CreateLectureProps {
 onLectureCreated?: () => void;
 language?: "en" | "ar";
}

export default function CreateLecture({
 onLectureCreated,
 language = "en",
}: CreateLectureProps) {
 const isRtl = language === "ar";

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

 const [lectureName, setLectureName] = useState(() => localStorage.getItem("draft_lecture_title") || "");
  useEffect(() => { localStorage.setItem("draft_lecture_title", lectureName); }, [lectureName]);
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [feedback, setFeedback] = useState<{
 type: "success" | "error";
 message: string;
 } | null>(null);

 // Calendar scheduling parameters
 const [shouldSchedule, setShouldSchedule] = useState(false);
 const [scheduleDate, setScheduleDate] = useState(() => {
 const today = new Date();
 return today.toISOString().split("T")[0];
 });
 const [scheduleStartTime, setScheduleStartTime] = useState("09:00");
 const [scheduleEndTime, setScheduleEndTime] = useState("10:00");
 const [scheduleGroups, setScheduleGroups] = useState<string[]>(["ALL"]);
 const [sendNotification, setSendNotification] = useState(true);

 const toggleGroup = (group: string) => {
 if (group === "ALL") {
 setScheduleGroups(["ALL"]);
 } else {
 let next = scheduleGroups.filter((g) => g !== "ALL");
 if (next.includes(group)) {
 next = next.filter((g) => g !== group);
 if (next.length === 0) next = ["ALL"];
 setScheduleGroups(next);
 } else {
 setScheduleGroups([...next, group]);
 }
 }
 };

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 if (!mainSubject || !trackMode || !lectureName.trim()) {
 setFeedback({
 type: "error",
 message: isRtl
 ? "يرجى إدخال اسم المحاضرة وتحديد الخيارات المطلوبة."
 : "Please enter the lecture name and select all required fields.",
 });
 return;
 }

 if (requiresDepartmentSelection && !department) {
 setFeedback({
 type: "error",
 message: isRtl ? "يرجى تحديد القسم." : "Please select a department.",
 });
 return;
 }

 setIsSubmitting(true);
 setFeedback(null);

 try {
 // 1. Create the lecture
 const response = await apiClient("/api/lectures", {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 },
 body: JSON.stringify({
 name: lectureName.trim(),
 mainSubject,
 subSubject,
 trackMode,
 department,
 }),
 });

 if (!response.ok) {
 const data = await response.json();
 throw new Error(
 data.error || "Failed to register the lecture in the database.",
 );
 }

 const createdLecture = await response.json();

 let scheduleMessage = "";

 // 2. Schedule on the calendar if the user checked the checkbox
 if (
 shouldSchedule &&
 scheduleDate &&
 scheduleStartTime &&
 scheduleEndTime
 ) {
 const startIso = `${scheduleDate}T${scheduleStartTime}:00`;
 const endIso = `${scheduleDate}T${scheduleEndTime}:00`;

 const calResponse = await apiClient("/api/calendar/events", {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 },
 body: JSON.stringify({
 title: lectureName.trim(),
 eventType: "LECTURE",
 startDateTime: formatToBaghdadISO(startIso),
 endDateTime: formatToBaghdadISO(endIso),
 targetGroups: scheduleGroups,
 sendNotification: sendNotification,
 }),
 });

 if (!calResponse.ok) {
 const calData = await calResponse.json();
 
 scheduleMessage = isRtl
 ? " (تنبيه: سجلت المحاضرة ولكن تعذرت الجدولة في التقويم بسبب تداخل الأوقات أو خطأ)"
 : " (Note: Lecture created, but calendar placement failed due to overlap check or validation)";
 } else {
 scheduleMessage = isRtl
 ? " وظهورها في التقويم الدراسي للدفعة!"
 : " and cleanly scheduled on the student planner schedule!";
 }
 }

 setFeedback({
 type: "success",
 message: isRtl
 ? `🎉 تمت إضافة المحاضرة بنجاح${scheduleMessage}`
 : `🎉 New lecture registered successfully${scheduleMessage}`,
 });

 setLectureName("");
    localStorage.removeItem("draft_lecture_title");
 setMainSubject(null);
 setShouldSchedule(false);

 if (onLectureCreated) {
 onLectureCreated();
 }
 } catch (err: any) {
 
 setFeedback({
 type: "error",
 message: err.message || "An unexpected error occurred.",
 });
 } finally {
 setIsSubmitting(false);
 }
 };

 return (
 <div id="create_lecture_form" className="flex flex-col h-full space-y-5">
 <div className="border-b border-neutral-100 dark:border-neutral-850 pb-3 flex items-center gap-2 group relative">
 <h3 className="text-body font-display font-semibold text-neutral-800 dark:text-white flex items-center gap-2">
 <FolderPlus className="w-icon-md h-icon-md text-rose-500" />
 {isRtl
 ? "إنشاء محتوى محاضرة جديد"
 : "Establish New Lecture Container"}
 </h3>
 <HelpCircle className="w-icon-sm h-icon-sm text-neutral-500 dark:text-[#EBEBF599] cursor-help" />
 <div className="absolute top-full left-0 mt-2 w-64 p-2 bg-neutral-800/95 dark:bg-neutral-700/95 backdrop-blur-sm text-white text-xs rounded-lg shadow-elevation-3 opacity-0 pointer-events-none group-hover:opacity-80 transition-opacity z-50">
 {isRtl
 ? "إنشاء كائن مرجعي لتصنيف الملفات والأسئلة والبطاقات الطبية داخل الشجرة الأكاديمية الهرمية."
 : "Spawn a directory anchor in the hierarchical system to store PDFs, clinical notes, video streams, MCQs, and flashcards."}
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

 <form onSubmit={handleSubmit} className="flex-1 flex flex-col space-y-5">
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

 {/* Step 5: Lecture Container Name */}
 {canProceedToLecture && (
 <div className="bg-white dark:bg-[#1C1C1E]/40 p-4 sm:p-5 rounded-lg border border-black/5 dark:border-white/[0.12] shadow-elevation-1 space-y-4 animate-fadeIn">
 <div className="space-y-2">
 <div className="flex items-center gap-2 mb-1">
 <span className="w-icon-md h-icon-md rounded-full bg-neutral-100 dark:bg-[#2C2C2E] text-xs font-semibold text-neutral-600 dark:text-[#EBEBF599] flex items-center justify-center shrink-0">
 5
 </span>
 <label className="text-subhead font-semibold text-neutral-800 dark:text-white">
 {isRtl ? "اسم المحاضرة" : "Presentation title"}
 </label>
 </div>
 <input aria-label="Input field"
 type="text"
 required
 placeholder={
 isRtl
 ? "أدخل اسم المحاضرة الطبي التفصيلي..."
 : "Enter full scientific presentation title..."
 }
 value={lectureName}
 onChange={(e) => setLectureName(e.target.value)}
 className="w-full px-4 py-3 bg-white dark:bg-[#1C1C1E] border border-neutral-300 dark:border-white/[0.12] text-neutral-800 dark:text-white rounded-lg font-medium text-caption focus:ring-1 focus:ring-rose-500 focus:border-rose-500 placeholder-neutral-400 dark:placeholder-neutral-600 outline-none"
 />
 </div>

 {/* In-place Schedule Synchronization option */}
 <div className="bg-neutral-50 dark:bg-[#1C1C1E]/40 p-4 border border-neutral-200 dark:border-white/[0.10] rounded-md space-y-3">
 <div className="flex items-center gap-2">
 <input aria-label="Input field"
 type="checkbox"
 id="shouldScheduleCheckbox"
 checked={shouldSchedule}
 onChange={(e) => setShouldSchedule(e.target.checked)}
 className="w-icon-sm h-icon-sm text-rose-600 accent-rose-600 focus:ring-rose-500 rounded-sm border-neutral-300 cursor-pointer"
 />
 <label
 htmlFor="shouldScheduleCheckbox"
 className="text-subhead font-semibold text-neutral-700 dark:text-[#EBEBF599] cursor-pointer select-none flex items-center gap-2"
 >
 <Calendar className="w-icon-sm h-icon-sm text-rose-500 shrink-0" />
 {isRtl
 ? "جدولة هذه المحاضرة في التقويم الدراسي للدفعة تلقائياً؟"
 : "Automatically schedule this lecture on the academic planner?"}
 </label>
 </div>

 {shouldSchedule && (
 <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 pl-6 border-l-2 border-rose-500/50 animate-fadeIn">
 <div className="space-y-1">
 <label className="text-subhead font-semibold text-neutral-500 dark:text-[#EBEBF599]">
 {isRtl ? "تاريخ إلقاء المحاضرة" : "Scheduled Date"}
 </label>
 <input aria-label="Input field"
 type="date"
 value={scheduleDate}
 onChange={(e) => setScheduleDate(e.target.value)}
 className="w-full text-caption px-3 py-2 bg-white dark:bg-[#1C1C1E] border border-neutral-200 dark:border-white/[0.12] rounded-lg outline-none"
 required={shouldSchedule}
 />
 </div>

 <div className="grid grid-cols-2 gap-2">
 <div className="space-y-1">
 <label className="text-subhead font-semibold text-neutral-500 dark:text-[#EBEBF599]">
 {isRtl ? "وقت البدء" : "Start Time"}
 </label>
 <input aria-label="Input field"
 type="time"
 value={scheduleStartTime}
 onChange={(e) => setScheduleStartTime(e.target.value)}
 className="w-full text-caption px-3 py-2 bg-white dark:bg-[#1C1C1E] border border-neutral-200 dark:border-white/[0.12] rounded-lg outline-none"
 required={shouldSchedule}
 />
 </div>
 <div className="space-y-1">
 <label className="text-subhead font-semibold text-neutral-500 dark:text-[#EBEBF599]">
 {isRtl ? "وقت الانتهاء" : "End Time"}
 </label>
 <input aria-label="Input field"
 type="time"
 value={scheduleEndTime}
 onChange={(e) => setScheduleEndTime(e.target.value)}
 className="w-full text-caption px-3 py-2 bg-white dark:bg-[#1C1C1E] border border-neutral-200 dark:border-white/[0.12] rounded-lg outline-none"
 required={shouldSchedule}
 />
 </div>
 </div>

 <div className="md:col-span-2 space-y-2 pt-1">
 <label className="text-subhead font-semibold text-neutral-500 dark:text-[#EBEBF599]">
 {isRtl
 ? "المجموعات المستهدفة بالدفعة"
 : "Target Academic Groups"}
 </label>
 <div className="flex flex-wrap gap-2">
 {["ALL", "A", "B", "C", "D"].map((g) => {
 const isSelected = scheduleGroups.includes(g);
 return (
 <button
 key={g}
 type="button"
 onClick={() => toggleGroup(g)}
 className={`px-3 py-1 text-caption font-semibold rounded-lg border transition cursor-pointer ${
 isSelected
 ? "bg-rose-500 border-rose-500 text-white"
 : "bg-white dark:bg-[#000000]/20 border-neutral-200 dark:border-white/[0.12] text-neutral-600 dark:text-[#EBEBF599] hover:bg-neutral-50"
 }`}
 >
 {isRtl && g === "ALL" ? "الكل (ALL)" : g}
 </button>
 );
 })}
 </div>
 </div>

 {/* Send Notification option */}
 <div
 role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }} onClick={() => setSendNotification(!sendNotification)}
 className="md:col-span-2 flex items-center justify-between cursor-pointer pt-3 pb-1 border-t border-neutral-100 dark:border-white/[0.12]/65 mt-2 select-none"
 >
 <div className="text-caption font-semibold text-neutral-600 dark:text-neutral-350">
 {isRtl
 ? "إرسال إشعار فوري للطلاب المشتركين عن هذه المحاضرة؟"
 : "Send push notification about this lecture immediately?"}
 </div>
 <div
 className={`w-12 h-6 flex items-center rounded-full transition-colors duration-300 ${
 sendNotification ? "bg-violet-600" : "bg-neutral-300 dark:bg-neutral-600"
 }`}
 >
 <div
 className={`w-icon-sm h-icon-sm bg-white rounded-full shadow-elevation-1 transform transition-transform duration-300 ${
 sendNotification ? "translate-x-6" : "translate-x-1"
 }`}
 />
 </div>
 </div>
 </div>
 )}
 </div>
 </div>
 )}

 {/* Action Controls */}
 <div className="fixed bottom-6 ltr:right-6 rtl:left-6 md:bottom-10 md:ltr:right-10 md:rtl:left-10 z-[100] animate-fadeIn flex justify-end">
 <button
 type="submit"
 disabled={
 isSubmitting || !canProceedToLecture || !lectureName.trim()
 }
 className={`px-6 py-4 text-base font-semibold rounded-lg shadow-elevation-3 text-white transition select-none cursor-pointer flex items-center justify-center gap-2 ${
 canProceedToLecture && lectureName.trim() && !isSubmitting
 ? "bg-rose-600 hover:bg-rose-500 shadow-rose-500/30"
 : "bg-neutral-200 dark:bg-[#2C2C2E] text-neutral-500 dark:text-[#EBEBF599] cursor-not-allowed border-none shadow-elevation-0"
 }`}
 >
 {isSubmitting ? (
 <>
 <div className="w-icon-sm h-icon-sm rounded-full border-2 border-white/35 border-t-white animate-spin" />
 <span>{isRtl ? "جاري الإنشاء..." : "Saving..."}</span>
 </>
 ) : (
 <span>
 {isRtl
 ? "إنشاء كائن محاضرة جديد"
 : "Register Lecture Container"}
 </span>
 )}
 </button>
 </div>
 </form>
 </div>
 );
}
