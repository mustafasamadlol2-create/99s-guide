import { apiClient } from "../../../core/api/apiClient";
import React, { useState, useEffect } from 'react';
import {
 Calendar,
 Clock,
 Plus,
 Users,
 Bell,
 AlertCircle,
 CircleCheck,
 Trash2, HelpCircle,
 Pencil,
} from "lucide-react";
import { CalendarEvent } from "../../../core/types";
import { formatToBaghdadISO, parseBaghdadDate } from "../../../core/utils/timezone";
import { showiOSAlert } from "../../../core/device/alert";

interface ManageCalendarProps {
 language?: "en" | "ar";
 onEventCreated?: () => void;
 events?: CalendarEvent[];
 onDeleteEvent?: (eventId: string) => Promise<void> | void;
 onEditEvent?: (event: CalendarEvent) => void;
}

export default function ManageCalendar({
 language = "en",
 onEventCreated,
 events = [],
 onDeleteEvent,
 onEditEvent,
}: ManageCalendarProps) {
 const isRtl = language === "ar";

 const [title, setTitle] = useState(() => localStorage.getItem("draft_calendar_title") || "");
  useEffect(() => { localStorage.setItem("draft_calendar_title", title); }, [title]);
 const [eventType, setEventType] = useState<"LECTURE" | "QUIZ" | "EXAM" | "HOLIDAY">(
 "LECTURE",
 );
 const [startDateTime, setStartDateTime] = useState(() => localStorage.getItem("draft_calendar_start") || "");
  useEffect(() => { localStorage.setItem("draft_calendar_start", startDateTime); }, [startDateTime]);
 const [endDateTime, setEndDateTime] = useState(() => localStorage.getItem("draft_calendar_end") || "");
  useEffect(() => { localStorage.setItem("draft_calendar_end", endDateTime); }, [endDateTime]);
 const [selectedGroups, setSelectedGroups] = useState<string[]>(["ALL"]);

 // Holidays always apply to every group — auto-reset when switching to HOLIDAY
 useEffect(() => {
  if (eventType === "HOLIDAY") {
   setSelectedGroups(["ALL"]);
  }
 }, [eventType]);

 const [sendNotification, setSendNotification] = useState<boolean>(true);
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [feedback, setFeedback] = useState<{
 type: "success" | "error";
 message: string;
 } | null>(null);

 // Database-enrolled lectures list for selective bidirectional synchronization
 const [dbLectures, setDbLectures] = useState<any[]>([]);
 const [selectedLectureId, setSelectedLectureId] = useState<string>("");

 useEffect(() => {
 const loadLectures = async () => {
 try {
 const response = await apiClient("/api/lectures");
 if (response.ok) {
 const data = await response.json();
 setDbLectures(data);
 }
 } catch (err) {}
 };
 loadLectures();

    const handleFocus = () => loadLectures();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") handleFocus();
    };
    window.addEventListener("focus", handleFocus);
    window.addEventListener("visibilitychange", handleVisibility);

    const handleCalendarSocket = () => loadLectures();
    window.addEventListener("socket-calendar-updated", handleCalendarSocket);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("socket-calendar-updated", handleCalendarSocket);
    };
 }, []);

 const groupsList = ["A", "B", "C", "D", "ALL"];

 const handleGroupToggle = (group: string) => {
 if (group === "ALL") {
 setSelectedGroups(["ALL"]);
 } else {
 let updated = selectedGroups.filter((g) => g !== "ALL");
 if (updated.includes(group)) {
 updated = updated.filter((g) => g !== group);
 } else {
 updated.push(group);
 }
 if (updated.length === 0) {
 updated = ["ALL"];
 }
 setSelectedGroups(updated);
 }
 };

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 setFeedback(null);

 if (!title.trim() || !startDateTime || !endDateTime) {
 setFeedback({
 type: "error",
 message: isRtl
 ? "يرجى إكمال الحقول المطلوبة (العنوان ووقت البدء والانتهاء)."
 : "Please enter event title, start and end date/time.",
 });
 return;
 }

 if (selectedGroups.length === 0) {
 setFeedback({
 type: "error",
 message: isRtl
 ? "يرجى تحديد مجموعة مستهدفة واحدة على الأقل."
 : "Please select at least one target group.",
 });
 return;
 }

 setIsSubmitting(true);

 try {
 const response = await apiClient("/api/calendar/events", {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 },
 body: JSON.stringify({
 title: title.trim(),
 eventType,
 startDateTime: formatToBaghdadISO(startDateTime),
 endDateTime: formatToBaghdadISO(endDateTime),
 targetGroups: eventType === "HOLIDAY" ? ["ALL"] : selectedGroups,
 sendNotification,
 }),
 });

 const data = await response.json();

 if (!response.ok) {
 throw new Error(
 data.error || "Failed to schedule event due to server validation.",
 );
 }

 setFeedback({
 type: "success",
 message: isRtl
 ? "🎉 تم جدولة الفعالية الجديدة في التقويم الأكاديمي بنجاح!"
 : "🎉 Calendar event has been successfully scheduled and recorded!",
 });

 // Reset form variables is removed so the user can clean/manage fields manually as requested:
 // "dont clean calendar , i make that manualy"

 if (onEventCreated) {
 onEventCreated();
 }
 } catch (err: any) {
 const errMsg =
 err.message ||
 (isRtl
 ? "حدث خطأ أثناء الاتصال بالخادم."
 : "An error occurred during network transmission.");
 setFeedback({
 type: "error",
 message: errMsg,
 });
 } finally {
 setIsSubmitting(false);
 }
 };

 return (
 <div
 id="manage_calendar_form_container"
 className="space-y-section max-w-2xl mx-auto"
 >
 <div className="border-b border-neutral-100 dark:border-white/[0.12] pb-3 flex items-center gap-2 group relative">
 <h3 className="text-headline font-display font-semibold text-neutral-800 dark:text-white flex items-center gap-2">
 <Calendar className="w-icon-md h-icon-md text-rose-500 shrink-0" />
 {isRtl ? "إدارة التقويم والجدول الزمني" : "Manage Academic Calendar"}
 </h3>
 <HelpCircle className="w-icon-sm h-icon-sm text-neutral-500 dark:text-[#EBEBF599] cursor-help shrink-0" />
 <div className="absolute top-full left-0 mt-2 w-64 p-2 bg-neutral-800/95 dark:bg-neutral-700/95 backdrop-blur-sm text-white text-xs rounded-lg shadow-elevation-3 opacity-0 pointer-events-none group-hover:opacity-80 transition-opacity z-50">
 {isRtl
 ? "أضف فعاليات جديدة مثل المحاضرات، الامتحانات اليومية، والتسهيم الأكاديمي مع التحقق من تداخل المجموعات."
 : "Register lectures, daily exams, and main exams with automatic target group overlap collision checking."}
 </div>
 </div>

  {feedback && (
  <div
  id="calendar_form_feedback"
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

 <form onSubmit={handleSubmit} className="space-y-4">
 {/* Linked Registered Academic Lecture (Optional select) */}
 {eventType === "LECTURE" && dbLectures.length > 0 && (
 <div className="space-y-2 p-4 bg-rose-500/5 dark:bg-[rgba(253,164,175,0.05)] border border-rose-500/10 dark:border-rose-500/20 rounded-md animate-fadeIn">
 <label className="text-subhead font-semibold text-rose-700 dark:text-rose-400 flex items-center gap-2">
 <Calendar className="w-icon-sm h-icon-sm text-rose-500 shrink-0" />
 {isRtl
 ? "ربط بـ محاضرة أكاديمية مسجلة في قاعدة البيانات"
 : "Sync / Link to Existing Registered Lecture"}
 </label>
 <select
 value={selectedLectureId}
 onChange={(e) => {
 const val = e.target.value;
 setSelectedLectureId(val);
 if (val) {
 const matched = dbLectures.find((l) => l.id === val);
 if (matched) {
 setTitle(matched.name);
 }
 }
 }}
 className="w-full text-caption px-4 py-3 bg-white dark:bg-[#1C1C1E] border border-neutral-250 dark:border-white/[0.12] rounded-lg focus:ring-1 focus:ring-rose-500 transition"
 >
 <option value="">
 {isRtl
 ? "-- حدد محاضرة من القائمة لملء الحقول وتنسيقها --"
 : "-- Choose a registered lecture to auto-fill title --"}
 </option>
 {dbLectures.map((l) => (
 <option key={l.id} value={l.id}>
 {l.mainSubject}: {l.name}
 </option>
 ))}
 </select>
 <div className="text-caption text-neutral-500 dark:text-[#EBEBF599]">
 {isRtl
 ? "عند اختيار محاضرة، سيتم مطابقة العنوان وتوقيت المحاضرة تلقائياً داخل جدول المذاكرة والتقويم."
 : "Matching title will bind this schedule slot to the selected lecture across all views."}
 </div>
 </div>
 )}

 {/* Event Title */}
 <div className="space-y-2">
 <label className="text-subhead font-semibold text-neutral-700 dark:text-[#EBEBF599]">
 {isRtl ? "عنوان الفعالية الأكاديمية" : "Event Title"}
 </label>
 <input aria-label="Input field"
 type="text"
 value={title}
 onChange={(e) => setTitle(e.target.value)}
 placeholder={
 isRtl
 ? "مثال: محاضرة علم الأمراض الكامنة أو تداخل الأدوية"
 : eventType === "HOLIDAY" ? "e.g. Weekend, National Holiday, Emergency Closure" : "e.g. Pathology Lectures, Pharmacology Exam..."
 }
 className="w-full text-caption px-4 py-3 bg-neutral-50 dark:bg-[#1C1C1E] border border-neutral-200 dark:border-white/[0.12] rounded-lg focus:ring-1 focus:ring-rose-500 transition duration-fast"
 required
 />
 </div>

 {/* Event Type & Start/End Dates */}
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <div className="space-y-2">
 <label className="text-subhead font-semibold text-neutral-700 dark:text-[#EBEBF599]">
 {isRtl ? "تصنيف الفعالية ونوعها" : "Event Type"}
 </label>
 <select
 value={eventType}
 onChange={(e) => setEventType(e.target.value as any)}
 className="w-full text-caption px-4 py-3 bg-neutral-50 dark:bg-[#1C1C1E] border border-neutral-200 dark:border-white/[0.12] rounded-lg focus:ring-1 focus:ring-rose-500 transition duration-fast"
 >
 <option value="LECTURE">
 {isRtl ? "إلقاء محاضرة (Lecture)" : "Lecture"}
 </option>
 <option value="QUIZ">
 {isRtl ? "امتحان يومي قصير (Daily Quiz)" : "Daily Quiz"}
 </option>
 <option value="EXAM">
 {isRtl ? "امتحان عام رئيسي (Important Exam)" : "Important Exam"}
 </option>
 <option value="HOLIDAY">
 {isRtl ? "عطلة (Holiday)" : "Holiday"}
 </option>
 </select>
 </div>

 {eventType !== "HOLIDAY" && (
 <div className="space-y-2">
 <label className="text-subhead font-semibold text-neutral-700 dark:text-[#EBEBF599]">
 {isRtl ? "المجموعات المستهدفة بالدفعة" : "Target Groups"}
 </label>
 <div className="flex flex-wrap items-center bg-neutral-100 dark:bg-[#2C2C2E]/80 p-1 rounded-lg border border-black/5 dark:border-white/[0.12] gap-1">
 {groupsList.map((g) => {
 const isSelected = selectedGroups.includes(g);
 return (
 <button
 key={g}
 type="button"
 onClick={() => handleGroupToggle(g)}
 className={`relative px-4 py-2 rounded-lg text-caption font-medium cursor-pointer transition duration-200 flex-1 min-w-[60px] text-center ${
 isSelected
 ? "bg-white dark:bg-neutral-700 text-rose-600 dark:text-rose-400 shadow-elevation-1 border border-black/5 dark:border-white/[0.12]"
 : "text-neutral-600 dark:text-[#EBEBF599] hover:text-neutral-900 dark:hover:text-neutral-200 border border-transparent"
 }`}
 >
 {isRtl && g === "ALL" ? "الكل (ALL)" : g}
 </button>
 );
 })}
 </div>
 </div>
 )}
 </div>

 <div className="flex flex-col md:flex-row gap-4 bg-white dark:bg-[#1C1C1E]/40 p-4 rounded-lg border border-black/5 dark:border-white/[0.12] shadow-elevation-1">
 {eventType === "HOLIDAY" ? (
 <div className="flex-1 space-y-2 animate-fadeIn">
 <label className="text-subhead font-semibold text-neutral-700 dark:text-[#EBEBF599] flex items-center gap-2">
 <Calendar className="w-icon-sm h-icon-sm text-emerald-500 shrink-0" />
 {isRtl ? "تاريخ العطلة" : "Holiday Date"}
 </label>
 <input aria-label="Input field"
 type="date"
 value={startDateTime ? startDateTime.split('T')[0] : ''}
 onChange={(e) => {
 const val = e.target.value;
 if (val) {
 setStartDateTime(`${val}T00:00`);
 setEndDateTime(`${val}T23:59`);
 } else {
 setStartDateTime('');
 setEndDateTime('');
 }
 }}
 className="w-full text-caption px-4 py-3 bg-neutral-50 dark:bg-[#2C2C2E]/80 border border-neutral-200 dark:border-white/[0.12] rounded-lg focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 transition duration-fast"
 required
 />
 </div>
 ) : (
 <>
 {/* Start Date & Time */}
 <div className="flex-1 space-y-2 animate-fadeIn">
 <label className="text-subhead font-semibold text-neutral-700 dark:text-[#EBEBF599] flex items-center gap-2">
 <Clock className="w-icon-sm h-icon-sm text-rose-500 shrink-0" />
 {isRtl ? "تاريخ ووقت بدء الفعالية" : "Event Start Date & Time"}
 </label>
 <input aria-label="Input field"
 type="datetime-local"
 value={startDateTime}
 onChange={(e) => {
 const val = e.target.value;
 setStartDateTime(val);
 if (val) {
 const d = new Date(val);
 if (!isNaN(d.getTime())) {
 const defaultEnd = new Date(d.getTime() + 60 * 60 * 1000);
 const pad = (num: number) => String(num).padStart(2, "0");
 const localStr = `${defaultEnd.getFullYear()}-${pad(defaultEnd.getMonth() + 1)}-${pad(defaultEnd.getDate())}T${pad(defaultEnd.getHours())}:${pad(defaultEnd.getMinutes())}`;
 setEndDateTime(localStr);
 }
 }
 }}
 className="w-full text-caption px-4 py-3 bg-neutral-50 dark:bg-[#2C2C2E]/80 border border-neutral-200 dark:border-white/[0.12] rounded-lg focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500/50 transition duration-fast"
 required
 />
 </div>

 {/* Divider */}
 <div className="hidden md:block w-px bg-black/5 dark:bg-white/[0.08] my-2"></div>
 <div className="md:hidden h-px w-full bg-black/5 dark:bg-white/[0.08]"></div>

 {/* End Date & Time */}
 <div className="flex-1 space-y-2 animate-fadeIn">
 <label className="text-subhead font-semibold text-neutral-700 dark:text-[#EBEBF599] flex items-center gap-2">
 <Clock className="w-icon-sm h-icon-sm text-emerald-500 shrink-0" />
 {isRtl ? "تاريخ ووقت نهاية الفعالية" : "Event End Date & Time"}
 </label>
 <input aria-label="Input field"
 type="datetime-local"
 value={endDateTime}
 onChange={(e) => setEndDateTime(e.target.value)}
 className="w-full text-caption px-4 py-3 bg-neutral-50 dark:bg-[#2C2C2E]/80 border border-neutral-200 dark:border-white/[0.12] rounded-lg focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 transition duration-fast"
 required
 />
 </div>
 </>
 )}
 </div>

 {/* Real-time Notification Toggle */}
 <div
 id="notification_toggle_wrapper"
 role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }} onClick={() => setSendNotification(!sendNotification)}
 className="flex items-center justify-between cursor-pointer py-3 px-4 bg-white dark:bg-[#1C1C1E]/40 rounded-lg border border-black/5 dark:border-white/[0.12] shadow-elevation-1 select-none"
 >
 <div className="flex items-center gap-3 pr-4">
 <div className="shrink-0 w-icon-xl h-icon-xl rounded-full bg-rose-50 dark:bg-rose-500/10 flex items-center justify-center">
 <Bell className="w-icon-sm h-icon-sm text-rose-500" />
 </div>
 <span className="text-sm font-medium text-neutral-800 dark:text-white">
 {isRtl
 ? "إرسال تنبيه فوري وبث الإشعارات لجميع الطلبة المتواجدين حالياً بالدفعة"
 : "Send real-time notification to students upon creation"}
 </span>
 </div>
 <div
 className={`shrink-0 w-12 h-6 flex items-center rounded-full transition-colors duration-300 ${
 sendNotification ? "bg-emerald-500" : "bg-neutral-200 dark:bg-neutral-700"
 }`}
 >
 <div
 className={`w-icon-md h-icon-md bg-white rounded-full shadow-elevation-1 transform transition-transform duration-300 ${
 sendNotification ? (isRtl ? "-translate-x-[22px]" : "translate-x-[22px]") : (isRtl ? "-translate-x-[2px]" : "translate-x-[2px]")
 }`}
 />
 </div>
 </div>

 {/* Submit */}
 <button
 type="submit"
 disabled={isSubmitting}
 className="w-full px-4 py-3 bg-rose-600 hover:bg-rose-500 disabled:bg-rose-600/50 transition duration-200 cursor-pointer text-white text-body font-semibold font-semibold rounded-lg flex items-center justify-center gap-2 shadow-elevation-1"
 >
 <Plus className="w-icon-sm h-icon-sm shrink-0" />
 <span>
 {isSubmitting
 ? isRtl
 ? "جاري الحفظ والجدولة..."
 : "Scheduling Event..."
 : isRtl
 ? "جدولة وإدراج الفعالية بالقسم الأكاديمي"
 : "Schedule New Event"}
 </span>
 </button>
 </form>

 {/* Existing Calendar Events Table/List */}
 <div className="border-t border-neutral-100 dark:border-white/[0.12] pt-6 mt-8 space-y-4">
 <div>
 <h3 className="text-body font-semibold text-neutral-800 dark:text-white uppercase flex items-center gap-2 text-rose-500">
 <Calendar className="w-icon-sm h-icon-sm text-rose-500 shrink-0" />
 {isRtl
 ? "الفعاليات والامتحانات النشطة بالتقويم"
 : "Active Scheduled Calendar Events"}
 </h3>
 <p className="text-caption text-neutral-500 dark:text-[#EBEBF599] mt-1 text-left">
 {isRtl
 ? "يمكنك مراجعة جميع الفعاليات الحالية والامتحانات المجدولة للدفعة وحذفها بشكل نهائي من هنا."
 : "Review and permanently remove any active lectures, quizzes, or final exams."}
 </p>
 </div>

 {events.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-16 px-6 text-center w-full border border-dashed border-neutral-200 dark:border-white/[0.12] rounded-lg bg-neutral-50/50 dark:bg-transparent mt-4">
 <div className="relative mb-6">
 
 <div className="relative w-16 h-header rounded-full bg-white dark:bg-[#2C2C2E] flex items-center justify-center ring-1 ring-neutral-900/5 dark:ring-white/10 shadow-elevation-3">
 <Calendar className="w-icon-lg h-icon-lg text-neutral-500 dark:text-[#EBEBF599]" />
 </div>
 </div>
 <h3 className="font-display text-headline text-neutral-900 dark:text-white mb-2">
 {isRtl ? "لا توجد فعاليات أكاديمية" : "No Academic Events"}
 </h3>
 <p className="text-secondary-label text-neutral-500 dark:text-[#EBEBF599] max-w-[280px]">
 {isRtl
 ? "لا توجد فعاليات أكاديمية مسجلة حالياً."
 : "No active academic events found in the ledger."}
 </p>
 </div>
 ) : (
 <div className="space-y-3 max-h-96 overflow-y-auto pr-1 overscroll-y-contain">
 {[...events]
 .sort((a, b) => {
 const dateA = a.startDateTime
 ? new Date(a.startDateTime).getTime()
 : 0;
 const dateB = b.startDateTime
 ? new Date(b.startDateTime).getTime()
 : 0;
 return dateB - dateA; // Descending order (newest/latest on top)
 })
 .map((evt) => {
 const typeUpper = (
 evt.eventType ||
 evt.type ||
 ""
 ).toUpperCase();
 const isLecture =
 typeUpper === "LECTURE" ||
 typeUpper === "CLASS" ||
 typeUpper === "LECTURES";
 const isQuiz =
 typeUpper === "QUIZ" || typeUpper === "DAILY EXAM";
 const isExam =
 typeUpper === "EXAM" || typeUpper === "IMPORTANT EXAM";
 const isHoliday = 
 typeUpper === "HOLIDAY";

 let typeBadgeColor =
 "bg-blue-100/60 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
 let arabicType = "محاضرة";
 if (isQuiz) {
 typeBadgeColor =
 "bg-amber-100/60 text-amber-850 dark:bg-amber-900/30 dark:text-amber-300";
 arabicType = "امتحان يومي";
 } else if (isExam) {
 typeBadgeColor =
 "bg-rose-100/60 text-rose-850 dark:bg-rose-900/30 dark:text-rose-300";
 arabicType = "امتحان رئيسي";
 } else if (isHoliday) {
 typeBadgeColor = "bg-emerald-100/60 text-emerald-850 dark:bg-emerald-900/30 dark:text-emerald-300";
 arabicType = "عطلة";
 }

 // Parse display date/time
 let displayDate = evt.date || "";
 let displayTime = evt.time || "10:00";
 if (evt.startDateTime) {
 const dObj = parseBaghdadDate(evt.startDateTime);
 displayDate = dObj.format("MMM D, YYYY"); // e.g. Jun 8, 2026
 if (language === "ar") {
 displayDate = dObj.locale("ar").format("D MMM YYYY");
 }
 
 const startStr = dObj.format("hh:mm A");

 let endStr = "";
 if (evt.endDateTime) {
 const endObj = parseBaghdadDate(evt.endDateTime);
 endStr = endObj.format("hh:mm A");
 }
 displayTime = endStr ? `${startStr} - ${endStr}` : startStr;
 }

 return (
 <div
 key={evt.id}
 className="p-4 bg-neutral-50 dark:bg-[#1C1C1E]/60 border border-neutral-150 dark:border-white/[0.10] rounded-md flex items-center justify-between gap-4 group hover:border-rose-500/30 hover:bg-neutral-100/30 transition duration-fast"
 >
 <div className="flex-1 min-w-0 space-y-2 text-left">
 <div className="flex items-center gap-2 flex-wrap">
 <span
 className={`text-caption font-semibold uppercase px-2 py-1 rounded-full ${typeBadgeColor}`}
 >
 {isRtl ? arabicType : typeUpper}
 </span>

 {/* Target Groups */}
 {(evt.targetGroups || ["ALL"]).map((g) => (
 <span
 key={g}
 className="bg-neutral-200/60 dark:bg-[#2C2C2E] text-neutral-500 dark:text-[#EBEBF599] rounded-sm px-2 py-1 text-caption font-semibold font-mono"
 >
 {isRtl && g === "ALL" ? "الكل (ALL)" : `Group ${g}`}
 </span>
 ))}
 </div>

 <h4 className="text-caption sm:text-body font-semibold text-neutral-800 dark:text-white truncate line-clamp-1 block">
 {evt.title}
 </h4>

 <div className="flex items-center gap-4 text-caption text-neutral-500 dark:text-[#EBEBF599] font-mono">
 <span className="flex items-center gap-1">
 <Calendar className="w-icon-sm h-icon-sm text-neutral-500 dark:text-[#EBEBF599]" />
 {displayDate}
 </span>
 <span className="flex items-center gap-1">
 <Clock className="w-icon-sm h-icon-sm text-neutral-500 dark:text-[#EBEBF599]" />
 {displayTime}
 </span>
 </div>
 </div>

 <div className="flex items-center gap-1 shrink-0 self-center">
 {onEditEvent && (
   <button
   type="button"
   onClick={() => onEditEvent(evt)}
   className="p-3 bg-neutral-100 dark:bg-neutral-850 text-neutral-500 dark:text-[#EBEBF599] hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/20 rounded-lg cursor-pointer transition"
   title={isRtl ? "تعديل الفعالية" : "Edit Event"}
   >
   <Pencil className="w-icon-sm h-icon-sm" />
   </button>
 )}
 <button
 type="button"
 onClick={() => {
 showiOSAlert({
 title: isRtl ? "حذف الفعالية" : "Delete Event",
 message: isRtl
 ? "هل أنت متأكد من حذف هذه الفعالية نهائياً؟"
 : "Are you sure you want to permanently remove this event from the academic database?",
 actions: [
 {
 label: isRtl ? "إلغاء" : "Cancel",
 style: "cancel",
 },
 {
 label: isRtl ? "حذف" : "Delete",
 style: "destructive",
 onClick: async () => {
 if (onDeleteEvent) {
 try {
 await onDeleteEvent(evt.id);
 if (onEventCreated) {
 onEventCreated(); // refresh academic parent components instantly
 }
 } catch (e) {
 
 }
 }
 },
 },
 ],
 });
 }}
 className="p-3 bg-neutral-100 dark:bg-neutral-850 text-neutral-500 dark:text-[#EBEBF599] hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg cursor-pointer transition"
 title={isRtl ? "حذف الفعالية" : "Remove Event"}
 >
 <Trash2 className="w-icon-sm h-icon-sm" />
 </button>
 </div>
 </div>
 );
 })}
 </div>
 )}
 </div>
 </div>
 );
}
