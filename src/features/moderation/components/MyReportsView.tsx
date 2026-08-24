/**
 * MyReportsView — profile sub-page listing the user's submitted reports.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "motion/react";
import { ChevronLeft, Flag, Loader2, AlertCircle, CheckCircle2, XCircle, Clock } from "lucide-react";
import { apiClient } from "../../../core/api/apiClient";

interface MyReport {
  id: string;
  reason: string;
  lectureName: string | null;
  status: string;
  createdAt: string;
  commentContent: string;
}

interface MyReportsViewProps {
  onBack: () => void;
}

const STATUS_BADGE: Record<string, { label: string; badgeClass: string; Icon: React.FC<{ className?: string }> }> = {
  Pending:  { label: "Pending",  badgeClass: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",   Icon: (p) => <Clock {...p} /> },
  Approved: { label: "Approved", badgeClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400", Icon: (p) => <CheckCircle2 {...p} /> },
  Rejected: { label: "Rejected", badgeClass: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",       Icon: (p) => <XCircle {...p} /> },
};

export const MyReportsView: React.FC<MyReportsViewProps> = ({ onBack }) => {
  const [reports, setReports] = useState<MyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reportsRef = useRef<MyReport[]>([]);
  reportsRef.current = reports;

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiClient("/api/reports/mine");
      if (!res.ok) throw new Error();
      setReports(await res.json());
    } catch {
      setError("Failed to load reports. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  // Real-time status updates via socket bridge
  useEffect(() => {
    const handler = (e: Event) => {
      const { id, status } = (e as CustomEvent<{ id: string; status: string }>).detail;
      setReports((prev) => prev.map((r) => r.id === id ? { ...r, status } : r));
    };
    window.addEventListener("socket-report-status-updated", handler);
    return () => window.removeEventListener("socket-report-status-updated", handler);
  }, []);

  return (
    <motion.div
      key="my-reports-view"
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ type: "spring", stiffness: 400, damping: 38 }}
      className="w-full max-w-2xl mx-auto pb-24 pt-4 px-4 sm:px-6 animate-fadeIn"
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-white/[0.08] text-neutral-600 dark:text-[#EBEBF599] transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-[20px] font-semibold text-neutral-900 dark:text-white tracking-tight">
          My Reports
        </h1>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="w-7 h-7 text-neutral-400 animate-spin" />
          <p className="text-[14px] text-neutral-500">Loading…</p>
        </div>
      )}

      {!loading && error && (
        <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <p className="text-[14px] text-rose-700 dark:text-rose-400">{error}</p>
        </div>
      )}

      {!loading && !error && reports.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <div className="w-14 h-14 rounded-2xl bg-neutral-100 dark:bg-white/[0.06] flex items-center justify-center">
            <Flag className="w-6 h-6 text-neutral-400" />
          </div>
          <p className="text-[16px] font-semibold text-neutral-700 dark:text-white">No reports yet</p>
          <p className="text-[14px] text-neutral-500 dark:text-[#EBEBF599] max-w-xs">
            Reports you submit will appear here so you can track their status.
          </p>
        </div>
      )}

      {!loading && !error && reports.length > 0 && (
        <div className="space-y-3">
          {reports.map((report) => {
            const badge = STATUS_BADGE[report.status] ?? STATUS_BADGE.Pending;
            const { Icon } = badge;
            return (
              <div
                key={report.id}
                className="bg-white/70 dark:bg-[#1C1C1E]/60 backdrop-blur-sm rounded-2xl border border-neutral-200/50 dark:border-white/[0.06] shadow-sm p-4 space-y-3"
              >
                {/* Top row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="text-[15px] font-semibold text-neutral-900 dark:text-white">
                      {report.reason}
                    </p>
                    {report.lectureName && (
                      <p className="text-[13px] text-neutral-500 dark:text-[#EBEBF599]">
                        {report.lectureName}
                      </p>
                    )}
                  </div>
                  <span className={`text-[12px] font-semibold px-2.5 py-1 rounded-full shrink-0 flex items-center gap-1 ${badge.badgeClass}`}>
                    <Icon className="w-3 h-3 shrink-0" />
                    {badge.label}
                  </span>
                </div>

                {/* Comment preview */}
                <div className="bg-neutral-50 dark:bg-[#2C2C2E] rounded-xl px-3 py-2 border border-neutral-100 dark:border-white/[0.06]">
                  <p className="text-[13px] text-neutral-600 dark:text-[#EBEBF599] line-clamp-2 italic">
                    "{report.commentContent}"
                  </p>
                </div>

                {/* Date */}
                <p className="text-[12px] text-neutral-400 dark:text-neutral-600">
                  Submitted on{" "}
                  {new Date(report.createdAt).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
};

export default MyReportsView;
