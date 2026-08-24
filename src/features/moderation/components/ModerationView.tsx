/**
 * ModerationView — admin panel for reviewing reported Q&A content.
 * Placed as a sub-tab inside ControlCenterView.
 */
import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Flag, Loader2, AlertCircle, CheckCheck, X, RefreshCw, Gavel } from "lucide-react";
import { apiClient } from "../../../core/api/apiClient";
import { PenaltyModal, PenaltyTarget } from "./PenaltyModal";

interface AdminReport {
  id: string;
  reason: string;
  description: string | null;
  status: string;
  createdAt: string;
  commentContent: string;
  commentType: string;
  commentId: string;
  count: number;
  reporter: { id: string; name: string; email: string };
  reportedUser: { id: string; name: string; email: string };
  lectureName: string | null;
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  Pending:  { label: "Pending",  className: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400" },
  Approved: { label: "Approved", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400" },
  Resolved: { label: "Resolved", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400" },
  Rejected: { label: "Rejected", className: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400" },
};

interface ModerationViewProps {
  language?: string;
}

export const ModerationView: React.FC<ModerationViewProps> = () => {
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("Pending");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [penaltyTarget, setPenaltyTarget] = useState<PenaltyTarget | null>(null);

  const showFeedback = useCallback((msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 3500);
  }, []);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiClient(`/api/reports?status=${statusFilter}`);
      if (!res.ok) throw new Error();
      setReports(await res.json());
    } catch {
      setError("Failed to load reports. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  // Refresh when a new report arrives in real time
  useEffect(() => {
    const handler = () => fetchReports();
    window.addEventListener("socket-report-created", handler);
    return () => window.removeEventListener("socket-report-created", handler);
  }, [fetchReports]);

  const handlePenaltySuccess = useCallback(() => {
    setReports((prev) => prev.filter((r) => r.id !== penaltyTarget?.reportId));
    showFeedback("✅ Penalty applied and report resolved.");
  }, [penaltyTarget, showFeedback]);

  const handleDismiss = useCallback(async (reportId: string) => {
    setActionLoading(reportId + ":dismiss");
    try {
      const res = await apiClient(`/api/reports/${reportId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Rejected" }),
      });
      if (!res.ok) throw new Error();
      setReports((prev) => prev.map((r) => r.id === reportId ? { ...r, status: "Rejected" } : r));
      showFeedback("Report dismissed.");
    } catch {
      showFeedback("❌ Action failed. Please try again.");
    } finally {
      setActionLoading(null);
    }
  }, [showFeedback]);


  const FILTERS = ["Pending", "Approved", "Rejected", "All"];

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Header */}
      <div className="border-b border-neutral-100 dark:border-white/[0.12] pb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Flag className="w-4 h-4 text-rose-500" />
          <h3 className="text-headline font-display font-semibold text-neutral-800 dark:text-white">
            Reported Content
          </h3>
        </div>
        <button
          onClick={fetchReports}
          className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/[0.08] text-neutral-500 transition-colors cursor-pointer"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Feedback toast */}
      <AnimatePresence>
        {feedback && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="p-3 rounded-lg border bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/50 text-caption font-semibold text-center"
          >
            {feedback}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all cursor-pointer ${
              statusFilter === f
                ? "bg-neutral-900 dark:bg-white text-white dark:text-neutral-900"
                : "bg-neutral-100 dark:bg-white/[0.06] text-neutral-600 dark:text-[#EBEBF599] hover:bg-neutral-200 dark:hover:bg-white/[0.12]"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12 gap-2">
          <Loader2 className="w-5 h-5 text-neutral-400 animate-spin" />
          <span className="text-[14px] text-neutral-500">Loading…</span>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <p className="text-[14px] text-rose-700 dark:text-rose-400">{error}</p>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && reports.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <CheckCheck className="w-8 h-8 text-emerald-400" />
          <p className="text-[15px] font-semibold text-neutral-700 dark:text-white">All clear</p>
          <p className="text-[13px] text-neutral-500">No {statusFilter !== "All" ? statusFilter.toLowerCase() : ""} reports found.</p>
        </div>
      )}

      {/* Reports list */}
      {!loading && !error && reports.length > 0 && (
        <div className="space-y-3">
          {reports.map((report) => {
            const badge = STATUS_BADGE[report.status] ?? STATUS_BADGE.Pending;
            const isActing = actionLoading?.startsWith(report.id);
            return (
              <div
                key={report.id}
                className="bg-white dark:bg-[#1C1C1E] border border-neutral-200/50 dark:border-white/[0.08] rounded-xl p-4 space-y-3 shadow-sm"
              >
                {/* Status + count */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-[12px] font-semibold px-2.5 py-1 rounded-full ${badge.className}`}>
                      {badge.label}
                    </span>
                    {report.count > 1 && (
                      <span className="text-[12px] font-semibold px-2.5 py-1 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400">
                        {report.count} reports
                      </span>
                    )}
                  </div>
                  <span className="text-[12px] text-neutral-400 font-mono">
                    {new Date(report.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>

                {/* Participants */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-neutral-50 dark:bg-[#2C2C2E] rounded-lg px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-0.5">Reporter</p>
                    <p className="text-[13px] text-neutral-800 dark:text-white font-medium truncate">{report.reporter.name}</p>
                    <p className="text-[11px] text-neutral-500 truncate">{report.reporter.email}</p>
                  </div>
                  <div className="bg-neutral-50 dark:bg-[#2C2C2E] rounded-lg px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-0.5">Reported User</p>
                    <p className="text-[13px] text-neutral-800 dark:text-white font-medium truncate">{report.reportedUser.name}</p>
                    <p className="text-[11px] text-neutral-500 truncate">{report.reportedUser.email}</p>
                  </div>
                </div>

                {/* Lecture */}
                {report.lectureName && (
                  <p className="text-[13px] text-neutral-500 dark:text-[#EBEBF599]">
                    <span className="font-semibold">Lecture:</span> {report.lectureName}
                  </p>
                )}

                {/* Comment */}
                <div className="bg-neutral-50 dark:bg-[#2C2C2E] rounded-lg px-3 py-2 border border-neutral-100 dark:border-white/[0.06]">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1 flex items-center gap-1.5">
                    <span className="capitalize">{report.commentType}</span> content
                  </p>
                  <p className="text-[13px] text-neutral-700 dark:text-[#EBEBF5CC]">{report.commentContent}</p>
                </div>

                {/* Reason + description */}
                <div>
                  <p className="text-[13px] font-semibold text-neutral-700 dark:text-[#EBEBF5CC]">
                    Reason: <span className="font-normal">{report.reason}</span>
                  </p>
                  {report.description && (
                    <p className="text-[13px] text-neutral-500 dark:text-[#EBEBF599] mt-0.5 italic">
                      "{report.description}"
                    </p>
                  )}
                </div>

                {/* Actions */}
                {report.status === "Pending" && (
                  <div className="flex items-center gap-2 pt-1 border-t border-neutral-100 dark:border-white/[0.08]">
                    <button
                      onClick={() => handleDismiss(report.id)}
                      disabled={!!isActing}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-white/[0.06] text-neutral-600 dark:text-[#EBEBF599] text-[13px] font-semibold hover:bg-neutral-200 dark:hover:bg-white/[0.12] transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {actionLoading === report.id + ":dismiss" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                      Dismiss
                    </button>
                    <button
                      onClick={() => setPenaltyTarget({
                        reportId: report.id,
                        commentId: report.commentId,
                        commentType: report.commentType as "question" | "answer",
                        commentContent: report.commentContent,
                        reportedUserName: report.reportedUser.name,
                        reportedUserId: report.reportedUser.id,
                      })}
                      disabled={!!isActing}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 text-[13px] font-semibold hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-colors disabled:opacity-50 cursor-pointer ml-auto"
                    >
                      <Gavel className="w-3.5 h-3.5" />
                      Approve + Penalize
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    <PenaltyModal
        target={penaltyTarget}
        onClose={() => setPenaltyTarget(null)}
        onSuccess={handlePenaltySuccess}
      />
    </div>
  );
};

export default ModerationView;
