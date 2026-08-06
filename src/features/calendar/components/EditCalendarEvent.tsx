import React, { useState, useEffect, useRef } from "react";
import {
  ArrowLeft,
  Calendar,
  Clock,
  Users,
  Save,
  AlertCircle,
  CircleCheck,
  Loader2,
  Tag,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { CalendarEvent } from "../../../core/types";
import { apiClient } from "../../../core/api/apiClient";
import { formatToBaghdadISO, parseBaghdadDate } from "../../../core/utils/timezone";

interface EditCalendarEventProps {
  event: CalendarEvent;
  language?: "en" | "ar";
  onSave: (updatedEvent: CalendarEvent) => void;
  onBack: () => void;
}

const GROUPS = ["A", "B", "C", "D", "ALL"];
const EVENT_TYPES = [
  { value: "LECTURE", label: "Lecture", labelAr: "محاضرة" },
  { value: "QUIZ", label: "Daily Quiz", labelAr: "امتحان يومي" },
  { value: "EXAM", label: "Important Exam", labelAr: "امتحان رئيسي" },
  { value: "HOLIDAY", label: "Holiday", labelAr: "عطلة" },
];

const TYPE_COLORS: Record<string, string> = {
  LECTURE: "blue",
  QUIZ: "amber",
  EXAM: "rose",
  HOLIDAY: "emerald",
};

function toLocalDatetimeString(iso: string | Date | undefined): string {
  if (!iso) return "";
  try {
    const d = parseBaghdadDate(iso as string);
    if (!d.isValid()) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.year()}-${pad(d.month() + 1)}-${pad(d.date())}T${pad(d.hour())}:${pad(d.minute())}`;
  } catch {
    return "";
  }
}

export default function EditCalendarEvent({
  event,
  language = "en",
  onSave,
  onBack,
}: EditCalendarEventProps) {
  const isRtl = language === "ar";

  const [title, setTitle] = useState(event.title || "");
  const [eventType, setEventType] = useState<string>(
    (event.eventType || event.type || "LECTURE").toUpperCase()
  );
  const [startDateTime, setStartDateTime] = useState(() =>
    toLocalDatetimeString(event.startDateTime)
  );
  const [endDateTime, setEndDateTime] = useState(() =>
    toLocalDatetimeString(event.endDateTime)
  );
  const [selectedGroups, setSelectedGroups] = useState<string[]>(
    event.targetGroups && event.targetGroups.length > 0
      ? event.targetGroups
      : ["ALL"]
  );

  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => titleRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, []);

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
      setSelectedGroups(updated.length === 0 ? ["ALL"] : updated);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!title.trim()) {
      setFeedback({ type: "error", message: isRtl ? "العنوان مطلوب." : "Title is required." });
      return;
    }
    if (!startDateTime || !endDateTime) {
      setFeedback({
        type: "error",
        message: isRtl
          ? "يرجى تحديد تاريخ ووقت البدء والانتهاء."
          : "Start and end date/time are required.",
      });
      return;
    }
    if (selectedGroups.length === 0) {
      setFeedback({
        type: "error",
        message: isRtl ? "يرجى تحديد مجموعة واحدة على الأقل." : "Select at least one target group.",
      });
      return;
    }

    setIsSaving(true);
    try {
      const response = await apiClient(`/api/calendar/events/${event.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          eventType,
          startDateTime: formatToBaghdadISO(startDateTime),
          endDateTime: formatToBaghdadISO(endDateTime),
          targetGroups: selectedGroups,
          isPinned: event.isPinned ?? false,
          isCompleted: event.isCompleted ?? false,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Update failed.");
      }

      setFeedback({
        type: "success",
        message: isRtl
          ? "✅ تم تحديث الفعالية بنجاح!"
          : "✅ Event updated successfully!",
      });

      setTimeout(() => {
        onSave(data);
      }, 800);
    } catch (err: any) {
      setFeedback({
        type: "error",
        message: err.message || (isRtl ? "حدث خطأ أثناء الحفظ." : "An error occurred while saving."),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const color = TYPE_COLORS[eventType] || "rose";

  const colorMap: Record<string, { ring: string; bg: string; text: string; badge: string }> = {
    blue: {
      ring: "focus:ring-blue-500/30 focus:border-blue-500/60",
      bg: "bg-blue-500/5 border-blue-500/15",
      text: "text-blue-600 dark:text-blue-400",
      badge: "bg-blue-100/70 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    },
    amber: {
      ring: "focus:ring-amber-500/30 focus:border-amber-500/60",
      bg: "bg-amber-500/5 border-amber-500/15",
      text: "text-amber-600 dark:text-amber-400",
      badge: "bg-amber-100/70 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    },
    rose: {
      ring: "focus:ring-rose-500/30 focus:border-rose-500/60",
      bg: "bg-rose-500/5 border-rose-500/15",
      text: "text-rose-600 dark:text-rose-400",
      badge: "bg-rose-100/70 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
    },
    emerald: {
      ring: "focus:ring-emerald-500/30 focus:border-emerald-500/60",
      bg: "bg-emerald-500/5 border-emerald-500/15",
      text: "text-emerald-600 dark:text-emerald-400",
      badge: "bg-emerald-100/70 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
    },
  };

  const c = colorMap[color];
  const inputBase =
    "w-full text-caption px-4 py-3 bg-neutral-50 dark:bg-[#1C1C1E] border border-neutral-200 dark:border-white/[0.12] rounded-lg transition duration-fast outline-none focus:ring-2 text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-600";

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className="h-screen bg-neutral-50 dark:bg-[#111113] flex flex-col overflow-hidden"
    >
      {/* Sticky Header */}
      <div className="sticky top-0 z-30 bg-neutral-50/90 dark:bg-[#111113]/90 backdrop-blur-md border-b border-neutral-200/60 dark:border-white/[0.08] flex-shrink-0">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-white/[0.08] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-white/[0.14] transition duration-150"
            aria-label="Back"
          >
            <ArrowLeft className="w-[18px] h-[18px]" />
          </button>

          <div className="flex-1 min-w-0">
            <h1 className="text-body font-semibold text-neutral-900 dark:text-white truncate">
              {isRtl ? "تعديل الفعالية" : "Edit Event"}
            </h1>
            <p className="text-caption text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
              {event.title}
            </p>
          </div>

          <span className={`shrink-0 text-caption font-semibold uppercase px-3 py-1 rounded-full ${c.badge}`}>
            {eventType}
          </span>
        </div>
      </div>

      {/* Scrollable Body */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ WebkitOverflowScrolling: "touch", overscrollBehaviorY: "contain" }}
      >
        <div className="max-w-2xl mx-auto px-4 py-6">
          <form onSubmit={handleSave} className="space-y-5">

            {/* Feedback */}
            <AnimatePresence mode="wait">
              {feedback && (
                <motion.div
                  key={feedback.type}
                  initial={{ opacity: 0, y: -8, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: "auto" }}
                  exit={{ opacity: 0, y: -4, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className={`px-4 py-3 rounded-lg flex items-center gap-3 text-caption border ${
                    feedback.type === "success"
                      ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/40"
                      : "bg-rose-50 dark:bg-rose-950/20 text-rose-800 dark:text-rose-400 border-rose-100 dark:border-rose-900/40"
                  }`}
                >
                  {feedback.type === "success" ? (
                    <CircleCheck className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0" />
                  )}
                  <span>{feedback.message}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Event Type */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-subhead font-semibold text-neutral-700 dark:text-neutral-300">
                <Tag className="w-4 h-4 text-neutral-400" />
                {isRtl ? "نوع الفعالية" : "Event Type"}
              </label>
              <div className="flex flex-wrap gap-2">
                {EVENT_TYPES.map((et) => {
                  const isSelected = eventType === et.value;
                  const etColor = TYPE_COLORS[et.value];
                  const etC = colorMap[etColor];
                  return (
                    <button
                      key={et.value}
                      type="button"
                      onClick={() => setEventType(et.value)}
                      className={`px-4 py-2 rounded-lg text-caption font-semibold border transition duration-150 ${
                        isSelected
                          ? `${etC.badge} border-current shadow-sm`
                          : "bg-neutral-100 dark:bg-white/[0.06] text-neutral-500 dark:text-neutral-400 border-transparent hover:border-neutral-200 dark:hover:border-white/[0.12]"
                      }`}
                    >
                      {isRtl ? et.labelAr : et.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Title */}
            <div className="space-y-2">
              <label className="text-subhead font-semibold text-neutral-700 dark:text-neutral-300">
                {isRtl ? "عنوان الفعالية" : "Event Title"}
              </label>
              <input
                ref={titleRef}
                aria-label="Event title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={isRtl ? "عنوان الفعالية..." : "Event title..."}
                className={`${inputBase} ${c.ring} text-body font-medium`}
                required
              />
            </div>

            {/* Dates */}
            {eventType === "HOLIDAY" ? (
              <div className={`space-y-2 p-4 border rounded-lg ${c.bg}`}>
                <label className={`flex items-center gap-2 text-subhead font-semibold ${c.text}`}>
                  <Calendar className="w-4 h-4" />
                  {isRtl ? "تاريخ العطلة" : "Holiday Date"}
                </label>
                <input
                  aria-label="Holiday date"
                  type="date"
                  value={startDateTime ? startDateTime.split("T")[0] : ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) {
                      setStartDateTime(`${v}T00:00`);
                      setEndDateTime(`${v}T23:59`);
                    } else {
                      setStartDateTime("");
                      setEndDateTime("");
                    }
                  }}
                  className={`${inputBase} ${c.ring}`}
                  required
                />
              </div>
            ) : (
              <div className={`p-4 border rounded-lg space-y-4 ${c.bg}`}>
                <p className={`text-caption font-semibold flex items-center gap-2 ${c.text}`}>
                  <Clock className="w-4 h-4" />
                  {isRtl ? "التوقيت" : "Schedule"}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-caption text-neutral-500 dark:text-neutral-400">
                      {isRtl ? "وقت البدء" : "Start"}
                    </label>
                    <input
                      aria-label="Start date and time"
                      type="datetime-local"
                      value={startDateTime}
                      onChange={(e) => {
                        setStartDateTime(e.target.value);
                        if (e.target.value) {
                          const d = new Date(e.target.value);
                          if (!isNaN(d.getTime())) {
                            const end = new Date(d.getTime() + 60 * 60 * 1000);
                            const pad = (n: number) => String(n).padStart(2, "0");
                            setEndDateTime(
                              `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`
                            );
                          }
                        }
                      }}
                      className={`${inputBase} ${c.ring}`}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-caption text-neutral-500 dark:text-neutral-400">
                      {isRtl ? "وقت الانتهاء" : "End"}
                    </label>
                    <input
                      aria-label="End date and time"
                      type="datetime-local"
                      value={endDateTime}
                      onChange={(e) => setEndDateTime(e.target.value)}
                      className={`${inputBase} ${c.ring}`}
                      required
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Target Groups */}
            {eventType !== "HOLIDAY" && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-subhead font-semibold text-neutral-700 dark:text-neutral-300">
                  <Users className="w-4 h-4 text-neutral-400" />
                  {isRtl ? "المجموعات المستهدفة" : "Target Groups"}
                </label>
                <div className="flex flex-wrap items-center bg-neutral-100 dark:bg-[#2C2C2E]/80 p-1 rounded-lg border border-black/5 dark:border-white/[0.10] gap-1">
                  {GROUPS.map((g) => {
                    const isSelected = selectedGroups.includes(g);
                    return (
                      <button
                        key={g}
                        type="button"
                        onClick={() => handleGroupToggle(g)}
                        className={`relative px-4 py-2 rounded-lg text-caption font-semibold cursor-pointer transition duration-150 flex-1 min-w-[60px] text-center ${
                          isSelected
                            ? "bg-white dark:bg-neutral-700 text-rose-600 dark:text-rose-400 shadow-sm border border-black/5 dark:border-white/[0.12]"
                            : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 border border-transparent"
                        }`}
                      >
                        {isRtl && g === "ALL" ? "الكل" : g}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Save button */}
            <div className="pt-2 pb-8">
              <button
                type="submit"
                disabled={isSaving}
                className="w-full flex items-center justify-center gap-2.5 px-6 py-3.5 bg-rose-600 hover:bg-rose-500 disabled:bg-rose-600/50 text-white font-semibold text-body rounded-lg shadow-sm transition duration-150 cursor-pointer"
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                ) : (
                  <Save className="w-4 h-4 shrink-0" />
                )}
                <span>
                  {isSaving
                    ? isRtl ? "جاري الحفظ..." : "Saving..."
                    : isRtl ? "حفظ التعديلات" : "Save Changes"}
                </span>
              </button>
            </div>

          </form>
        </div>
      </div>
    </motion.div>
  );
}
