import { apiClient } from "../../../core/api/apiClient";
import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect, Suspense, memo, lazy } from "react";
import { Bell, Send, HelpCircle, CircleCheck } from "lucide-react";
import { Language } from "../../../core/i18n/translations";
import { FormError } from "../../../components/ui/FormError";

interface SendNotificationProps {
 language: Language;
}

export default function SendNotification({ language }: SendNotificationProps) {
 const isRtl = language === "ar";
 const [recipient, setRecipient] = useState("All Students");
 const [title, setTitle] = useState(() => localStorage.getItem("draft_notif_title") || "");
  useEffect(() => { localStorage.setItem("draft_notif_title", title); }, [title]);
 const [message, setMessage] = useState(() => localStorage.getItem("draft_notif_message") || "");
  useEffect(() => { localStorage.setItem("draft_notif_message", message); }, [message]);
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [feedback, setFeedback] = useState<{
 type: "success" | "error";
 text: string;
 } | null>(null);

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 if (!title.trim() || !message.trim()) return;

 setIsSubmitting(true);
 setFeedback(null);

 // Map the UI recipient label to the backend targetGroup value:
 // "All Students" → omit targetGroup (global broadcast); "Group X" → "X"
 const targetGroup =
  recipient === "All Students"
   ? undefined
   : recipient.replace("Group ", "").trim();

 try {
 const response = await apiClient("/api/notifications", {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 },
 body: JSON.stringify({
 title: title.trim(),
 message: message.trim(),
 isSystem: true,
 ...(targetGroup ? { targetGroup } : {}),
 }),
 });

 if (response.ok) {
 setFeedback({
 type: "success",
 text: isRtl
 ? "✅ تم إرسال الإشعار وبثه لجميع المستخدمين بنجاح!"
 : "✅ Notification sent & broadcasted to all users successfully!",
 });
 setTitle("");
 setMessage("");
 localStorage.removeItem("draft_notif_title");
 localStorage.removeItem("draft_notif_message");
 } else {
 const errorData = await response.json().catch(() => ({}));
 throw new Error(errorData.error || "Failed to send notification");
 }
 } catch (err: any) {
 setFeedback({
 type: "error",
 text: isRtl
 ? `❌ فشل إرسال الإشعار: ${err.message}`
 : `❌ Failed to send notification: ${err.message}`,
 });
 } finally {
 setIsSubmitting(false);
 }
 };

 return (
 <div
 id="send_notification_card"
 className="max-w-2xl bg-white dark:bg-[#1C1C1E]/40 border border-black/5 dark:border-white/[0.12] shadow-elevation-1 rounded-lg p-5 space-y-4"
 >
 <div className="border-b border-neutral-100 dark:border-white/[0.08] pb-3 flex items-center gap-2 group relative">
 <h3 className="text-base font-semibold text-neutral-800 dark:text-white flex items-center gap-2">
 <Bell className="w-icon-md h-icon-md text-rose-500 shrink-0" />
 {isRtl ? "إرسال إشعار عام للنظام" : "Send System-Wide Notification"}
 </h3>
 <HelpCircle className="w-icon-sm h-icon-sm text-neutral-500 dark:text-[#EBEBF599] cursor-help shrink-0" />
 <div className="absolute top-full left-0 mt-2 w-64 p-2 bg-neutral-800/95 dark:bg-neutral-700/95 backdrop-blur-sm text-white text-xs rounded-lg shadow-elevation-3 opacity-0 pointer-events-none group-hover:opacity-80 transition-opacity z-50">
 {isRtl
 ? "سيتم بث هذا الإشعار بشكل فوري لجميع المستخدمين المتصلين بالمنصة وحفظه بشكل دائم."
 : "This alert will be broadcast in real-time to all connected users and saved for history."}
 </div>
 </div>

  {feedback?.type === "success" && (
  <div className="p-4 rounded-xl flex items-start gap-3 text-caption bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/40">
  <CircleCheck className="w-icon-sm h-icon-sm text-emerald-500 shrink-0 mt-1" />
  <span>{feedback.text}</span>
  </div>
  )}
  <FormError message={feedback?.type === "error" ? feedback.text : null} />

 <form onSubmit={handleSubmit} className="space-y-4 pt-1">
 <div className="space-y-1.5">
 <label className="block text-subhead font-semibold text-neutral-800 dark:text-white">
 {isRtl ? "المستلمون" : "Recipients"}
 </label>
 <div className="flex flex-wrap gap-1 p-1 bg-neutral-100 dark:bg-[#2C2C2E]/80 rounded-lg">
 {["All Students", "Group A", "Group B", "Group C", "Group D"].map((option) => {
 const active = recipient === option;
 const label = isRtl
 ? option === "All Students"
 ? "الجميع"
 : option.replace("Group ", "مجموعة ")
 : option;
 
 return (
 <button
 key={option}
 type="button"
 onClick={() => setRecipient(option)}
 className={`flex-1 min-w-[80px] px-3 py-2 text-xs font-medium rounded-lg transition ${
 active 
 ? "bg-white dark:bg-[#1C1C1E] text-neutral-900 dark:text-white shadow-elevation-1 ring-1 ring-black/5 dark:ring-white/10" 
 : "text-neutral-600 dark:text-[#EBEBF599] hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-neutral-200/50 dark:hover:bg-white/[0.18]/50"
 }`}
 >
 {label}
 </button>
 );
 })}
 </div>
 </div>

 <div className="space-y-1.5">
 <label className="block text-subhead font-semibold text-neutral-800 dark:text-white">
 {isRtl ? "عنوان الإشعار" : "Notification Title"}
 </label>
 <input aria-label="Input field"
 id="notification_title_input"
 type="text"
 required
 value={title}
 onChange={(e) => setTitle(e.target.value)}
 placeholder={
 isRtl
 ? "مثال: تحديث عاجل للجدول الدراسي"
 : "e.g., Urgent Reschedule Notification"
 }
 className="w-full px-4 py-3 bg-white dark:bg-[#1C1C1E] border border-neutral-300 dark:border-white/[0.12] text-neutral-800 dark:text-white rounded-lg text-caption focus:ring-1 focus:ring-rose-500"
 />
 </div>

 <div className="space-y-1.5">
 <label className="block text-subhead font-semibold text-neutral-800 dark:text-white">
 {isRtl ? "مضمون الإشعار" : "Message Body"}
 </label>
 <div className="relative">
 <textarea aria-label="Text area"
 id="notification_message_textarea"
 required
 rows={3}
 value={message}
 onChange={(e) => setMessage(e.target.value)}
 placeholder={
 isRtl
 ? "اكتب تفاصيل الإعلان هنا..."
 : "Type the announcement context here..."
 }
 className="w-full px-4 py-3 pb-8 bg-white dark:bg-[#1C1C1E] border border-neutral-300 dark:border-white/[0.12] text-neutral-800 dark:text-white rounded-lg text-caption resize-y min-h-[100px] focus:ring-1 focus:ring-rose-500"
 />
 <div
 className={`absolute bottom-4 ${
 isRtl ? "left-4" : "right-4"
 } text-xs font-mono font-medium pointer-events-none ${
 message.length > 800 ? "text-med-gold" : "text-neutral-500 dark:text-[#EBEBF599]"
 }`}
 >
 {message.length}
 </div>
 </div>
 </div>

 <div className="pt-4">
 <button
 id="submit_notification_btn"
 type="submit"
 disabled={isSubmitting || !title.trim() || !message.trim()}
 className={`w-full py-4 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition shadow-elevation-1 ${
 isSubmitting || !title.trim() || !message.trim()
 ? "bg-neutral-100 dark:bg-[#2C2C2E] text-neutral-500 dark:text-[#EBEBF599] cursor-not-allowed shadow-elevation-0"
 : "bg-rose-600 hover:bg-rose-500 text-white  cursor-pointer"
 }`}
 >
 {isSubmitting ? (
 <div className="w-icon-sm h-icon-sm rounded-full border-2 border-current border-t-transparent animate-spin" />
 ) : (
 <Send className="w-icon-sm h-icon-sm" />
 )}
 {isSubmitting
 ? isRtl
 ? "جاري البث..."
 : "Broadcasting..."
 : isRtl
 ? "بث الإشعار"
 : "Broadcast Notification"}
 </button>
 </div>
 </form>
 </div>
 );
}
