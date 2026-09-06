/**
 * ReportSheet — full-page centered overlay for reporting a Q&A comment.
 * Modern, minimal, professional. Smooth scale+fade animation.
 */
import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, TriangleAlert, Loader2, CheckCircle2 } from "lucide-react";
import { apiClient } from "../../../core/api/apiClient";

export type ReportTarget = {
  commentId: string;
  commentType: "question" | "answer";
  commentContent: string;
  reportedUserId: string;
  lectureId: string;
};

interface ReportSheetProps {
  target: ReportTarget | null;
  onClose: () => void;
  onSuccess: () => void;
}

const REASONS = [
  "Spam",
  "Harassment / Abuse",
  "Hate Speech",
  "False Information",
  "Inappropriate Content",
  "Off-topic",
  "Other",
];

export const ReportSheet: React.FC<ReportSheetProps> = ({ target, onClose, onSuccess }) => {
  const [selectedReason, setSelectedReason] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (target) {
      setSelectedReason("");
      setDescription("");
      setError("");
      setLoading(false);
    }
  }, [target]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (target) window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [target, onClose]);

  const handleSubmit = useCallback(async () => {
    if (!target || !selectedReason) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiClient("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportedUserId: target.reportedUserId,
          lectureId: target.lectureId,
          commentId: target.commentId,
          commentType: target.commentType,
          commentContent: target.commentContent.slice(0, 500),
          reason: selectedReason,
          description: selectedReason === "Other" ? description.trim() : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to submit report. Please try again.");
        return;
      }
      onSuccess();
      onClose();
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [target, selectedReason, description, onClose, onSuccess]);

  return (
    <AnimatePresence>
      {target && (
        <>
          {/* Backdrop */}
          <motion.div
            key="report-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-0 bg-black/50 dark:bg-black/70 z-50 backdrop-blur-md"
            onClick={onClose}
          />

          {/* Centered dialog */}
          <div className="mobile-overlay-top mobile-dialog-shell fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              key="report-dialog"
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.8 }}
              className="mobile-dialog-panel pointer-events-auto w-full max-w-md bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-2xl border border-neutral-200/60 dark:border-white/[0.08] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between px-6 pt-6 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/20 flex items-center justify-center shrink-0">
                    <TriangleAlert className="w-4.5 h-4.5 text-rose-500" />
                  </div>
                  <div>
                    <h2 className="text-[16px] font-semibold text-neutral-900 dark:text-white tracking-tight leading-tight">
                      Report Comment
                    </h2>
                    <p className="text-[12px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                      Help us keep discussions safe and respectful.
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="ml-4 p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/[0.08] text-neutral-400 hover:text-neutral-600 dark:hover:text-white transition-colors cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Divider */}
              <div className="h-px bg-neutral-100 dark:bg-white/[0.06] mx-6" />

              {/* Body */}
              <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
                {/* Comment preview */}
                <div className="bg-neutral-50 dark:bg-white/[0.04] border border-neutral-100 dark:border-white/[0.06] rounded-xl px-4 py-3">
                  <p className="text-[11px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider mb-1.5">
                    Comment being reported
                  </p>
                  <p className="text-[13px] text-neutral-600 dark:text-neutral-300 leading-relaxed line-clamp-3">
                    {target.commentContent}
                  </p>
                </div>

                {/* Reason selector */}
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                    Reason for report
                  </p>
                  <div className="space-y-1.5">
                    {REASONS.map((reason) => (
                      <button
                        key={reason}
                        type="button"
                        onClick={() => setSelectedReason(reason)}
                        className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl border text-left transition-all duration-150 cursor-pointer ${
                          selectedReason === reason
                            ? "border-rose-300 dark:border-rose-500/40 bg-rose-50/80 dark:bg-rose-500/10"
                            : "border-neutral-150 dark:border-white/[0.06] bg-neutral-50/50 dark:bg-white/[0.03] hover:bg-neutral-100/80 dark:hover:bg-white/[0.06]"
                        }`}
                      >
                        <span className={`text-[14px] font-medium ${
                          selectedReason === reason
                            ? "text-rose-700 dark:text-rose-400"
                            : "text-neutral-700 dark:text-neutral-200"
                        }`}>{reason}</span>
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                          selectedReason === reason
                            ? "border-rose-500 bg-rose-500"
                            : "border-neutral-300 dark:border-white/20"
                        }`}>
                          {selectedReason === reason && (
                            <div className="w-1.5 h-1.5 rounded-full bg-white" />
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Optional description for "Other" */}
                <AnimatePresence>
                  {selectedReason === "Other" && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.18 }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                          Additional details
                        </p>
                        <textarea
                          aria-label="Additional details"
                          rows={3}
                          placeholder="Describe the issue…"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          maxLength={500}
                          className="w-full bg-neutral-50 dark:bg-white/[0.04] border border-neutral-200 dark:border-white/[0.08] rounded-xl px-4 py-3 text-[14px] text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-600 outline-none focus-visible:ring-2 focus-visible:ring-rose-400/40 focus-visible:border-rose-300 dark:focus-visible:border-rose-500/40 resize-none transition"
                        />
                        <p className="text-right text-[11px] text-neutral-400">{description.length}/500</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Error */}
                {error && (
                  <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200/60 dark:border-rose-500/25 rounded-xl px-4 py-3">
                    <p className="text-[13px] text-rose-700 dark:text-rose-400">{error}</p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-neutral-100 dark:border-white/[0.06] flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 rounded-xl border border-neutral-200 dark:border-white/[0.1] text-neutral-700 dark:text-neutral-300 font-medium text-[14px] hover:bg-neutral-50 dark:hover:bg-white/[0.05] transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!selectedReason || loading}
                  className="flex-1 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-semibold text-[14px] flex items-center justify-center gap-2 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer active:scale-[0.98]"
                >
                  {loading ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Submitting…</>
                  ) : (
                    <><CheckCircle2 className="w-3.5 h-3.5" /> Submit Report</>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};

export default ReportSheet;
