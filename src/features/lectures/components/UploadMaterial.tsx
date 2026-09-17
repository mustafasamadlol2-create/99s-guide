import { motion } from "motion/react";
import { apiClient } from "../../../core/api/apiClient";
import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect, Suspense, memo, lazy } from "react";
import { useTreeSelection } from "../../../core/hooks/useTreeSelection";
import { SubjectId } from "../../../core/types";
import {
 FileText,
 Video,
 Upload,
 CircleCheck,
 AlertCircle,
 Link,
 RefreshCcw,
 Sparkles,
 Search,
  BookOpen,
  HelpCircle,
  Trash2,
  X,
} from "lucide-react";

interface Lecture {
 id: string;
 name: string;
 mainSubject: string;
 subSubject?: string | null;
 trackMode: string;
 department?: string | null;
}

interface UploadMaterialProps {
 initialType: "PDF" | "NOTE" | "VIDEO";
 language?: "en" | "ar";
 onSuccess?: () => void;
}

type NoteUploadState = "waiting" | "uploading" | "uploaded" | "failed";

interface NoteUploadItem {
  id: string;
  file: File;
  title: string;
  state: NoteUploadState;
  error?: string;
}

export default function UploadMaterial({
 initialType,
 language = "en",
 onSuccess,
}: UploadMaterialProps) {
 const isRtl = language === "ar";

 const [type, setType] = useState<"PDF" | "NOTE" | "VIDEO">(initialType);
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

 // Form fields
 const [selectedLectureId, setSelectedLectureId] = useState("");
 const [title, setTitle] = useState("");
 const [videoUrl, setVideoUrl] = useState("");
 const [file, setFile] = useState<File | null>(null);
 const MAX_PDF_FILE_BYTES = 50 * 1024 * 1024;
  const MAX_NOTE_FILES = 10;
  const [noteQueue, setNoteQueue] = useState<NoteUploadItem[]>([]);
  const [existingNotes, setExistingNotes] = useState<any[]>([]);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);

 // Status state
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [feedback, setFeedback] = useState<{
 type: "success" | "error";
 message: string;
 } | null>(null);

 const fileInputRef = useRef<HTMLInputElement>(null);

 // Sync initialType when tab changes
 useEffect(() => {
 setType(initialType);
 setFeedback(null);
  setNoteQueue([]);
  setExistingNotes([]);
 }, [initialType]);

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

  const refreshExistingNotes = useCallback(async () => {
    if (type !== "NOTE" || !selectedLectureId) {
      setExistingNotes([]);
      return;
    }

    setIsLoadingNotes(true);
    try {
      const response = await apiClient(`/api/lectures/${encodeURIComponent(selectedLectureId)}`, {
        bypassCache: true,
        retries: 0,
        silent: true,
      });
      if (!response.ok) return;
      const data = await response.json();
      const notes = Array.isArray(data?.materials)
        ? data.materials
            .filter((material: any) => String(material?.type || "").toUpperCase() === "NOTE")
            .sort((a: any, b: any) => {
              const createdA = Date.parse(String(a?.createdAt || ""));
              const createdB = Date.parse(String(b?.createdAt || ""));
              if (Number.isFinite(createdA) && Number.isFinite(createdB) && createdA !== createdB) {
                return createdA - createdB;
              }
              return String(a?.id || "").localeCompare(String(b?.id || ""));
            })
        : [];
      setExistingNotes(notes);
    } finally {
      setIsLoadingNotes(false);
    }
  }, [selectedLectureId, type]);

  useEffect(() => {
    setNoteQueue([]);
    void refreshExistingNotes();
  }, [refreshExistingNotes]);

 const handleDragOver = (e: React.DragEvent) => {
 e.preventDefault();
 };

  const noteFileValidationError = useCallback((candidate: File): string | null => {
    if (candidate.type !== "application/pdf") {
      return isRtl ? "عذراً! يُسمح برفع ملفات PDF فقط." : "Only PDF files are supported.";
    }
    if (candidate.size > MAX_PDF_FILE_BYTES) {
      return isRtl
        ? "حجم ملف PDF يجب ألا يتجاوز 50 ميغابايت."
        : "PDF files must be 50 MB or smaller.";
    }
    return null;
  }, [isRtl]);

  const addNoteFiles = useCallback((files: File[]) => {
    const availableSlots = MAX_NOTE_FILES - existingNotes.length - noteQueue.length;
    if (files.length > availableSlots) {
      setFeedback({
        type: "error",
        message: isRtl
          ? `يمكنك اختيار ${Math.max(0, availableSlots)} ملفاً إضافياً فقط لهذه المحاضرة.`
          : `Only ${Math.max(0, availableSlots)} more note file${availableSlots === 1 ? "" : "s"} can be selected for this lecture.`,
      });
      return;
    }

    const validItems: NoteUploadItem[] = [];
    for (const candidate of files) {
      const validationError = noteFileValidationError(candidate);
      if (validationError) {
        setFeedback({ type: "error", message: validationError });
        continue;
      }
      validItems.push({
        id: `${candidate.name}-${candidate.size}-${candidate.lastModified}-${crypto.randomUUID()}`,
        file: candidate,
        title: candidate.name.replace(/\.pdf$/i, ""),
        state: "waiting",
      });
    }

    if (validItems.length > 0) {
      setNoteQueue((current) => [...current, ...validItems]);
      setFeedback(null);
    }
  }, [existingNotes.length, isRtl, noteFileValidationError, noteQueue.length]);

 const handleDrop = (e: React.DragEvent) => {
 e.preventDefault();
 if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
  if (type === "NOTE") {
  addNoteFiles(Array.from(e.dataTransfer.files));
  return;
  }
  const droppedFile = e.dataTransfer.files[0];
 if (droppedFile.type === "application/pdf") {
 if (droppedFile.size > MAX_PDF_FILE_BYTES) {
 setFile(null);
 setFeedback({
 type: "error",
 message: isRtl
 ? "حجم ملف PDF يجب ألا يتجاوز 50 ميغابايت."
 : "PDF files must be 50 MB or smaller.",
 });
 return;
 }
 setFeedback(null);
 setFile(droppedFile);
 if (!title) {
 setTitle(droppedFile.name.replace(/\.pdf$/i, ""));
 }
 } else {
 setFeedback({
 type: "error",
 message: isRtl
 ? "عذراً! يُسمح برفع ملفات PDF فقط."
 : "Only PDF files are supported.",
 });
 }
 }
 };

 const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
 if (e.target.files && e.target.files.length > 0) {
  if (type === "NOTE") {
  addNoteFiles(Array.from(e.target.files));
  e.target.value = "";
  return;
  }
 const chosenFile = e.target.files[0];
 if (chosenFile.type !== "application/pdf") {
 setFile(null);
 setFeedback({
 type: "error",
 message: isRtl ? "عذراً! يُسمح برفع ملفات PDF فقط." : "Only PDF files are supported.",
 });
 e.target.value = "";
 return;
 }
 if (chosenFile.size > MAX_PDF_FILE_BYTES) {
 setFile(null);
 setFeedback({
 type: "error",
 message: isRtl
 ? "حجم ملف PDF يجب ألا يتجاوز 50 ميغابايت."
 : "PDF files must be 50 MB or smaller.",
 });
 e.target.value = "";
 return;
 }
 setFeedback(null);
 setFile(chosenFile);
 if (!title) {
 setTitle(chosenFile.name.replace(/\.pdf$/i, ""));
 }
 }
 };

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 if (!selectedLectureId) {
 setFeedback({
 type: "error",
 message: isRtl
 ? "يرجى اختيار المحاضرة المستهدفة."
 : "Please select a lecture target first.",
 });
 return;
 }
  if (type !== "NOTE" && !title.trim()) {
 setFeedback({
 type: "error",
 message: isRtl
 ? "يرجى إدخال مسمى المادة الأكاديمية."
 : "Please enter the title.",
 });
 return;
 }

  if (type === "NOTE") {
    const pendingItems = noteQueue.filter(
      (item) => item.state === "waiting" || item.state === "failed",
    );
    if (pendingItems.length === 0) {
      setFeedback({
        type: "error",
        message: isRtl
          ? "يرجى اختيار ملف ملاحظات واحد على الأقل."
          : "Select at least one note PDF before uploading.",
      });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);
    let nextIndex = 0;
    let uploadedCount = 0;
    let failedCount = 0;

    const uploadOneNote = async (item: NoteUploadItem) => {
      setNoteQueue((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, state: "uploading", error: undefined }
            : candidate,
        ),
      );

      try {
        const formData = new FormData();
        formData.append("file", item.file);
        formData.append("title", item.title.trim() || item.file.name.replace(/\.pdf$/i, ""));
        formData.append("type", "NOTE");
        formData.append("lectureId", selectedLectureId);

        const response = await apiClient("/api/materials/upload", {
          method: "POST",
          body: formData,
          timeoutMs: 180_000,
          // A successful write whose response is lost must not be replayed.
          retries: 0,
        });

        let data: any = {};
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          data = await response.json();
        } else {
          await response.text();
        }

        if (!response.ok) {
          const message = data.code === "NOTE_LIMIT_REACHED"
            ? (isRtl
              ? "تحتوي هذه المحاضرة بالفعل على 10 ملفات ملاحظات. احذف ملفاً موجوداً قبل رفع ملف جديد."
              : "This lecture already has 10 note files. Remove an existing note before uploading another.")
            : (typeof data.error === "string" ? data.error : (
              isRtl ? `فشل رفع الملف (${response.status}).` : `Upload failed (${response.status}).`
            ));
          throw new Error(message);
        }

        uploadedCount += 1;
        setNoteQueue((current) =>
          current.map((candidate) =>
            candidate.id === item.id
              ? { ...candidate, state: "uploaded", error: undefined }
              : candidate,
          ),
        );
      } catch (error: any) {
        failedCount += 1;
        const message = typeof error?.message === "string"
          ? error.message
          : (isRtl ? "فشل رفع ملف الملاحظات." : "Note upload failed.");
        setNoteQueue((current) =>
          current.map((candidate) =>
            candidate.id === item.id
              ? { ...candidate, state: "failed", error: message }
              : candidate,
          ),
        );
      }
    };

    const worker = async () => {
      while (nextIndex < pendingItems.length) {
        const item = pendingItems[nextIndex];
        nextIndex += 1;
        await uploadOneNote(item);
      }
    };

    try {
      await Promise.all(
        Array.from(
          { length: Math.min(2, pendingItems.length) },
          () => worker(),
        ),
      );
      await refreshExistingNotes();
      setNoteQueue((current) => current.filter((item) => item.state === "failed"));
      if (uploadedCount > 0) onSuccess?.();
      setFeedback({
        type: failedCount === 0 ? "success" : "error",
        message: failedCount === 0
          ? (isRtl
            ? `تم رفع ${uploadedCount} من ملفات الملاحظات بنجاح.`
            : `${uploadedCount} note${uploadedCount === 1 ? "" : "s"} uploaded successfully.`)
          : (isRtl
            ? `تم رفع ${uploadedCount} بنجاح، وفشل ${failedCount}. يمكنك إعادة المحاولة يدوياً.`
            : `${uploadedCount} note${uploadedCount === 1 ? "" : "s"} uploaded successfully; ${failedCount} failed and can be retried.`),
      });
      if (failedCount === 0 && fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } finally {
      setIsSubmitting(false);
    }
    return;
  }

 if (type === "VIDEO") {
 if (!videoUrl.trim()) {
 setFeedback({
 type: "error",
 message: isRtl
 ? "يرجى إدخال رابط يوتيوب الطبي."
 : "Please enter the video URL.",
 });
 return;
 }

 setIsSubmitting(true);
 setFeedback(null);

 try {
 const response = await apiClient("/api/materials/video", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 title: title.trim(),
 fileUrlOrLink: videoUrl.trim(),
 type: "VIDEO",
 lectureId: selectedLectureId,
 }),
 });

 const data = await response.json();
 if (!response.ok) {
 throw new Error(data.error || "Failed to save video URL.");
 }

 setFeedback({
 type: "success",
 message: isRtl
 ? "🎉 تم ربط الفيديو التعليمي بالمحاضرة بنجاح!"
 : "🎉 Video clip linked and assigned to the study lecture successfully!",
 });
 setTitle("");
 setVideoUrl("");
 onSuccess?.();
 } catch (err: any) {
 setFeedback({ type: "error", message: err.message });
 } finally {
 setIsSubmitting(false);
 }
  } else {
  // Primary PDF replacement upload.
 if (!file) {
 setFeedback({
 type: "error",
 message: isRtl
 ? "يرجى اختيار أو سحب ملف PDF الأكاديمي."
 : "Please drop or choose a PDF document.",
 });
 return;
 }

 setIsSubmitting(true);
 setFeedback(null);

 try {
 const formData = new FormData();
 formData.append("file", file);
 formData.append("title", title.trim());
 formData.append("type", type);
 formData.append("lectureId", selectedLectureId);

 const response = await apiClient("/api/materials/upload", {
 method: "POST",
 body: formData,
 timeoutMs: 180_000,
  retries: 1,
 });

 const contentType = response.headers.get("content-type");
 let data: any = {};

 if (contentType && contentType.includes("application/json")) {
 data = await response.json();
 } else {
 const rawText = await response.text();
 
 throw new Error(
 isRtl
 ? `استجاب الخادم بخطأ غير متوقع (${response.status}). يرجى التأكد من أن الملف غير تالف ومناسب القياس.`
 : `The server responded with an unexpected payload (${response.status}). Please verify the file is not corrupted and its size doesn't exceed boundaries.`,
 );
 }

 if (!response.ok) {
 throw new Error(data.error || "Failed to upload material file.");
 }

 setFeedback({
 type: "success",
 message: isRtl
 ? "🎉 تم الحصول على الملف وربطه بالمحاضرة بنجاح!"
 : `🎉 Material PDF file (type: ${type}) has been compiled and stored successfully!`,
 });
 setTitle("");
 setFile(null);
 if (fileInputRef.current) {
 fileInputRef.current.value = "";
 }
 onSuccess?.();
 } catch (err: any) {
 setFeedback({ type: "error", message: err.message });
 } finally {
 setIsSubmitting(false);
 }
  }
 };

  const removeQueuedNote = (itemId: string) => {
    if (isSubmitting) return;
    setNoteQueue((current) => current.filter((item) => item.id !== itemId));
  };

  const updateQueuedNoteTitle = (itemId: string, nextTitle: string) => {
    setNoteQueue((current) =>
      current.map((item) => item.id === itemId ? { ...item, title: nextTitle } : item),
    );
  };

  const handleDeleteExistingNote = async (note: any) => {
    const confirmed = window.confirm(
      isRtl
        ? `هل تريد حذف ملف الملاحظات "${note.title}"؟`
        : `Delete the note "${note.title}"?`,
    );
    if (!confirmed) return;

    setDeletingNoteId(note.id);
    setFeedback(null);
    try {
      const response = await apiClient(`/api/materials/${encodeURIComponent(note.id)}`, {
        method: "DELETE",
        retries: 0,
      });
      let data: any = {};
      if ((response.headers.get("content-type") || "").includes("application/json")) {
        data = await response.json();
      }
      if (!response.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : (isRtl ? "تعذر حذف ملف الملاحظات." : "Could not delete the note."),
        );
      }
      await refreshExistingNotes();
      onSuccess?.();
      setFeedback({
        type: "success",
        message: isRtl ? "تم حذف ملف الملاحظات وتحرير خانة جديدة." : "Note deleted and one slot is available again.",
      });
    } catch (error: any) {
      setFeedback({
        type: "error",
        message: typeof error?.message === "string"
          ? error.message
          : (isRtl ? "تعذر حذف ملف الملاحظات." : "Could not delete the note."),
      });
    } finally {
      setDeletingNoteId(null);
    }
  };

  const remainingNoteSlots = Math.max(0, MAX_NOTE_FILES - existingNotes.length);
  const queueHasPendingNotes = noteQueue.some(
    (item) => item.state === "waiting" || item.state === "failed",
  );

 return (
 <div
 id={`upload_material_${type.toLowerCase()}`}
 className="space-y-section"
 >
 <div className="border-b border-neutral-100 dark:border-neutral-850 pb-3 flex items-center gap-2 group relative">
 <h3 className="text-body font-display font-semibold text-neutral-800 dark:text-white flex items-center gap-2">
 {type === "VIDEO" ? (
 <Video className="w-icon-md h-icon-md text-indigo-500" />
 ) : (
 <FileText className="w-icon-md h-icon-md text-rose-500" />
 )}
 {type === "VIDEO" &&
 (isRtl
 ? "إضافة فيديو يوتيوب تعليمي"
 : "Link Clinical Video Tutorial")}
 {type === "PDF" &&
 (isRtl ? "رفع شرائح ومحاضرات PDF" : "Upload Lecture PDF Slides")}
 {type === "NOTE" &&
 (isRtl
 ? "رفع ملخصات ومستندات دراسية"
 : "Upload Clinical Notes Document")}
 </h3>
 <HelpCircle className="w-icon-sm h-icon-sm text-neutral-500 dark:text-[#EBEBF599] cursor-help" />
 <div className="absolute top-full left-0 mt-2 w-64 p-2 bg-neutral-800/95 dark:bg-neutral-700/95 backdrop-blur-sm text-white text-xs rounded-lg shadow-elevation-3 opacity-0 pointer-events-none group-hover:opacity-80 transition-opacity z-50">
 {isRtl
 ? "تخصيص ملفات أو تدفقات مرئية لربطها بجدول المحاضرة داخل الأقسام المعنية."
 : "Mount assets directly to an existing lecture node in our custom relational LMS tree."}
 </div>
 </div>

 {feedback && (
 <motion.div
 initial={{ opacity: 0, y: -10, scale: 0.95 }}
 animate={{ opacity: 1, y: 0, scale: 1 }}
 className={`p-4 rounded-lg flex items-center gap-3 text-sm font-semibold border shadow-elevation-1 ${
 feedback.type === "success"
 ? "bg-white dark:bg-[#1C1C1E] text-emerald-600 dark:text-emerald-400 border-emerald-500/20 shadow-emerald-500/5 ring-1 ring-emerald-500/10"
 : "bg-white dark:bg-[#1C1C1E] text-rose-600 dark:text-rose-400 border-rose-500/20 shadow-rose-500/5 ring-1 ring-rose-500/10"
 }`}
 >
 {feedback.type === "success" ? (
 <div className="w-icon-xl h-icon-xl rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center shrink-0">
 <CircleCheck className="w-icon-md h-icon-md text-emerald-500" />
 </div>
 ) : (
 <div className="w-icon-xl h-icon-xl rounded-full bg-rose-50 dark:bg-rose-500/10 flex items-center justify-center shrink-0">
 <AlertCircle className="w-icon-md h-icon-md text-rose-500" />
 </div>
 )}
 <span className="flex-1">{feedback.message}</span>
 </motion.div>
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
 ? "اختر المحاضرة المستهدفة"
 : "Select Targeted Lecture Node"}
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
  {type !== "NOTE" && <div className="space-y-2 pt-2 border-t border-neutral-100 dark:border-white/[0.08]">
 <div className="flex items-center gap-2 mb-1">
 <span className="w-icon-md h-icon-md rounded-full bg-neutral-100 dark:bg-[#2C2C2E] text-xs font-semibold text-neutral-600 dark:text-[#EBEBF599] flex items-center justify-center shrink-0">
 6
 </span>
 <label className="text-subhead font-semibold text-neutral-800 dark:text-white">
 {isRtl
 ? "مسمى الملف الأكاديمي"
 : "Document / Resource Title"}
 </label>
 </div>
 <input aria-label="Input field"
 type="text"
 required
 placeholder={
 isRtl
 ? "أدخل مسمى يوضح محتويات الملف..."
 : "e.g., Clinical Sepsis Diagnostic Criteria"
 }
 value={title}
 onChange={(e) => setTitle(e.target.value)}
 className="w-full px-4 py-3 bg-white dark:bg-[#1C1C1E] border border-neutral-300 dark:border-white/[0.12] text-neutral-800 dark:text-white rounded-lg font-medium text-caption focus:ring-1 focus:ring-rose-500 outline-none"
 />
  </div>}

 {/* Conditional PDF file / Video URL field */}
 {type === "VIDEO" ? (
 <div className="space-y-2 animate-fadeIn pt-2 border-t border-neutral-100 dark:border-white/[0.08]">
 <div className="flex items-center gap-2 mb-1">
 <span className="w-icon-md h-icon-md rounded-full bg-neutral-100 dark:bg-[#2C2C2E] text-xs font-semibold text-neutral-600 dark:text-[#EBEBF599] flex items-center justify-center shrink-0">
 7
 </span>
 <label className="text-subhead font-semibold text-neutral-800 dark:text-white">
 {isRtl
 ? "رابط اليوتيوب (فيديو)"
 : "YouTube Video Stream URL"}
 </label>
 </div>
 <div className="relative">
 <Link className="w-5 h-5 text-neutral-400 dark:text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2 shrink-0 pointer-events-none z-10" />
 <input aria-label="Input field"
 type="url"
 required
 dir="ltr"
 placeholder="https://www.youtube.com/watch?v=..."
 value={videoUrl}
 onChange={(e) => setVideoUrl(e.target.value)}
 style={{ paddingLeft: "3.2rem" }}
 className="w-full py-3 pr-4 bg-white dark:bg-[#1C1C1E] border border-neutral-300 dark:border-white/[0.12] text-neutral-800 dark:text-white rounded-lg font-medium text-caption focus:ring-1 focus:ring-rose-500 outline-none text-left"
 />
  </div>
 </div>
  ) : type === "NOTE" ? (
  <div className="space-y-4 animate-fadeIn pt-2 border-t border-neutral-100 dark:border-white/[0.08]">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="text-subhead font-semibold text-neutral-800 dark:text-white">
          {isRtl ? "ملفات الملاحظات" : "Lecture Notes"}
        </p>
        <p className="text-caption text-neutral-500 dark:text-[#EBEBF599]">
          {isLoadingNotes
            ? (isRtl ? "جارٍ تحديث العدد..." : "Refreshing note count...")
            : (isRtl
              ? `${existingNotes.length} / ${MAX_NOTE_FILES} ملفات — متاح ${remainingNoteSlots}`
              : `Notes: ${existingNotes.length} / ${MAX_NOTE_FILES} · ${remainingNoteSlots} slot${remainingNoteSlots === 1 ? "" : "s"} remaining`)}
        </p>
      </div>
      <span className="rounded-full bg-purple-500/10 px-3 py-1 text-xs font-semibold text-purple-700 dark:text-purple-300">
        PDF · 50 MB max
      </span>
    </div>

    {existingNotes.length > 0 && (
      <div className="space-y-2">
        <p className="text-caption font-semibold text-neutral-700 dark:text-[#EBEBF599]">
          {isRtl ? "الملاحظات الحالية" : "Existing notes"}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {existingNotes.map((note, index) => (
            <div
              key={note.id}
              className="flex min-w-0 items-center gap-3 rounded-lg border border-neutral-200 dark:border-white/[0.12] bg-neutral-50/70 dark:bg-[#1C1C1E]/70 p-3"
            >
              <FileText className="w-icon-md h-icon-md shrink-0 text-purple-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-caption font-semibold text-neutral-800 dark:text-white">
                  {index + 1}. {note.title}
                </p>
                <p className="text-xs text-neutral-500 dark:text-[#EBEBF599]">
                  {note.createdAt ? new Date(note.createdAt).toLocaleDateString(isRtl ? "ar-IQ" : "en-US") : ""}
                </p>
              </div>
              <button
                type="button"
                aria-label={isRtl ? `حذف ${note.title}` : `Delete ${note.title}`}
                disabled={deletingNoteId === note.id || isSubmitting}
                onClick={() => void handleDeleteExistingNote(note)}
                className="min-h-10 min-w-10 shrink-0 rounded-lg text-rose-500 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingNoteId === note.id
                  ? <div className="mx-auto h-4 w-4 animate-spin rounded-full border-2 border-rose-500/30 border-t-rose-500" />
                  : <Trash2 className="mx-auto h-4 w-4" />}
              </button>
            </div>
          ))}
        </div>
      </div>
    )}

    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
      onClick={() => remainingNoteSlots > 0 && fileInputRef.current?.click()}
      className={`border-2 border-dashed border-neutral-300 dark:border-white/[0.12] rounded-lg p-5 text-center transition bg-neutral-50/50 dark:bg-[#1C1C1E]/40 ${
        remainingNoteSlots > 0
          ? "cursor-pointer hover:border-purple-500/50 hover:bg-neutral-50 dark:hover:bg-white/[0.06]"
          : "cursor-not-allowed opacity-60"
      }`}
    >
      <input
        aria-label={isRtl ? "اختيار ملفات الملاحظات" : "Choose note PDFs"}
        type="file"
        ref={fileInputRef}
        accept="application/pdf,.pdf"
        multiple
        onChange={handleFileChange}
        disabled={remainingNoteSlots === 0 || isSubmitting}
        className="hidden"
      />
      <Upload className="mx-auto mb-2 h-icon-xl w-icon-xl text-purple-500" />
      <p className="text-caption font-medium text-neutral-600 dark:text-[#EBEBF599]">
        {remainingNoteSlots > 0
          ? (isRtl ? "اسحب ملفات PDF متعددة أو انقر للتصفح" : "Drag multiple PDF files here, or click to browse")
          : (isRtl ? "تم الوصول إلى الحد الأقصى للملاحظات" : "The 10-note limit has been reached")}
      </p>
      <p className="mt-1 text-xs font-mono uppercase text-neutral-500 dark:text-[#EBEBF599]">
        {isRtl ? `المتاح: ${remainingNoteSlots}` : `${remainingNoteSlots} slot${remainingNoteSlots === 1 ? "" : "s"} available`}
      </p>
    </div>

    {noteQueue.length > 0 && (
      <div className="space-y-2">
        <p className="text-caption font-semibold text-neutral-700 dark:text-[#EBEBF599]">
          {isRtl ? "قائمة الرفع" : "Upload queue"}
        </p>
        <div className="space-y-2">
          {noteQueue.map((item, index) => (
            <div key={item.id} className="rounded-lg border border-neutral-200 dark:border-white/[0.12] p-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-1 text-xs font-mono text-neutral-500">{index + 1}</span>
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-purple-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-caption font-medium text-neutral-800 dark:text-white">{item.file.name}</p>
                  <p className="text-xs text-neutral-500 dark:text-[#EBEBF599]">
                    {(item.file.size / (1024 * 1024)).toFixed(2)} MB · {item.state === "waiting"
                      ? (isRtl ? "في الانتظار" : "Waiting")
                      : item.state === "uploading"
                        ? (isRtl ? "جارٍ الرفع" : "Uploading")
                        : item.state === "uploaded"
                          ? (isRtl ? "تم الرفع" : "Uploaded")
                          : (isRtl ? "فشل" : "Failed")}
                  </p>
                  {item.error && <p className="mt-1 text-xs text-rose-500">{item.error}</p>}
                </div>
                {item.state === "uploading" && (
                  <div className="mt-1 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-purple-500/30 border-t-purple-500" />
                )}
                {item.state !== "uploading" && item.state !== "uploaded" && (
                  <button
                    type="button"
                    aria-label={isRtl ? "إزالة الملف" : "Remove file"}
                    onClick={() => removeQueuedNote(item.id)}
                    className="min-h-9 min-w-9 shrink-0 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/[0.08]"
                  >
                    <X className="mx-auto h-4 w-4" />
                  </button>
                )}
              </div>
              <input
                aria-label={isRtl ? "عنوان ملف الملاحظات" : "Note title"}
                type="text"
                value={item.title}
                disabled={isSubmitting || item.state === "uploaded"}
                onChange={(e) => updateQueuedNoteTitle(item.id, e.target.value)}
                className="mt-2 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-caption text-neutral-800 outline-none focus:ring-1 focus:ring-purple-500 dark:border-white/[0.12] dark:bg-[#1C1C1E] dark:text-white"
              />
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
  ) : (
 <div className="space-y-2 animate-fadeIn pt-2 border-t border-neutral-100 dark:border-white/[0.08]">
 <div className="flex items-center gap-2 mb-1">
 <span className="w-icon-md h-icon-md rounded-full bg-neutral-100 dark:bg-[#2C2C2E] text-xs font-semibold text-neutral-600 dark:text-[#EBEBF599] flex items-center justify-center shrink-0">
 7
 </span>
 <label className="text-subhead font-semibold text-neutral-800 dark:text-white">
 {isRtl
 ? "ملف المحاضرة (PDF)"
 : "Slide Deck Document (PDF)"}
 </label>
 </div>

 <div
 onDragOver={handleDragOver}
 onDrop={handleDrop}
 role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }} onClick={() => fileInputRef.current?.click()}
 className="border-2 border-dashed border-neutral-300 dark:border-white/[0.12] hover:border-rose-500/50 dark:hover:border-rose-500/50 rounded-lg p-6 text-center cursor-pointer transition bg-neutral-50/50 dark:bg-[#1C1C1E]/40 hover:bg-neutral-50 dark:hover:bg-white/[0.06]"
 >
 <input aria-label="Input field"
 type="file"
 ref={fileInputRef}
 accept="application/pdf"
 onChange={handleFileChange}
 className="hidden"
 />
 <Upload className="w-icon-xl h-icon-xl mx-auto text-neutral-500 dark:text-[#EBEBF599] animate-pulse mb-2" />
 <p className="text-caption font-medium text-neutral-600 dark:text-[#EBEBF599]">
 {file
 ? file.name
 : isRtl
 ? "اسحب وأفلت مستند الـ PDF هنا، أو انقر للتصفح"
 : "Drag and drop the PDF document here, or click to browse"}
 </p>
 <p className="text-xs text-neutral-500 dark:text-[#EBEBF599] mt-1 uppercase font-mono">
 {file
 ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
  : "PDF format only, up to 50MB"}
 </p>
 </div>
 </div>
 )}
 </>
 )}
 </div>
 
 {/* Final action — belongs to the last completed material step and stays
     in normal document flow. It must never float over the upload surface. */}
  {selectedLectureId && (
  <div
   className="admin-final-action mt-6 pt-5 border-t border-neutral-200/70 dark:border-white/[0.08] animate-fadeIn flex justify-end"
   data-final-ready={Boolean(
      type === "NOTE"
        ? queueHasPendingNotes
        : title.trim() && (type === "VIDEO" ? videoUrl.trim() : file)
   )}
  >
 <button
 type="submit"
 disabled={
 isSubmitting ||
  (type !== "NOTE" && !title.trim()) ||
  (type === "NOTE" && !queueHasPendingNotes)
 }
 className={`w-full sm:w-auto px-6 py-3.5 text-base font-semibold rounded-lg text-white transition select-none flex items-center justify-center gap-2 ${
  (type === "NOTE" ? queueHasPendingNotes : title.trim()) && !isSubmitting
 ? "bg-rose-600 hover:bg-rose-500 active:bg-rose-700 shadow-elevation-1 cursor-pointer"
 : "bg-neutral-200 dark:bg-[#2C2C2E] text-neutral-500 dark:text-[#EBEBF599] cursor-not-allowed border-none shadow-none"
 }`}
 >
 {isSubmitting ? (
 <>
 <div className="w-icon-md h-icon-md rounded-full border-2 border-white/35 border-t-white animate-spin" />
 <span>{isRtl ? "جاري الرفع..." : "Uploading..."}</span>
 </>
 ) : (
 <span>
 {isRtl
  ? (type === "NOTE" ? "رفع ملفات الملاحظات" : "تسجيل المرفق الدراسي")
  : (type === "NOTE" ? "Upload Note Files" : "Register Cohort Material")}
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
