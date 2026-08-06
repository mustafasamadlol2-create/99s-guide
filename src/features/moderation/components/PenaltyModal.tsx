/**
 * PenaltyModal — full-page admin overlay for approving a report with a chosen penalty.
 * Level 1: Delete Comment only
 * Level 2: Mute User (with duration picker)
 * Level 3: Ban User (with duration picker)
 */
import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  X, Trash2, MicOff, ShieldOff, Loader2, ChevronDown,
  AlertTriangle, CheckCircle, Gavel, Clock, Infinity as InfinityIcon,
} from "lucide-react";
import { apiClient } from "../../../core/api/apiClient";

export interface PenaltyTarget {
  reportId: string;
  commentId: string;
  commentType: "question" | "answer";
  commentContent: string;
  reportedUserName: string;
  reportedUserId: string;
}

interface PenaltyModalProps {
  target: PenaltyTarget | null;
  onClose: () => void;
  onSuccess: () => void;
}

const LEVELS = [
  {
    id: "delete" as const,
    label: "Delete Comment",
    sublabel: "Remove the offending content only. No further action against the user.",
    Icon: Trash2,
    color: "text-rose-600 dark:text-rose-400",
    activeBg: "bg-rose-50 dark:bg-rose-500/[0.12]",
    activeBorder: "border-rose-300 dark:border-rose-500/50",
    activeRing: "ring-rose-500/20",
    dot: "bg-rose-500",
    btnClass: "bg-rose-500 hover:bg-rose-600 active:bg-rose-700",
    hasDuration: false,
  },
  {
    id: "mute" as const,
    label: "Mute User",
    sublabel: "Prevent the user from posting questions or answers for a set duration.",
    Icon: MicOff,
    color: "text-amber-600 dark:text-amber-400",
    activeBg: "bg-amber-50 dark:bg-amber-500/[0.12]",
    activeBorder: "border-amber-300 dark:border-amber-500/50",
    activeRing: "ring-amber-500/20",
    dot: "bg-amber-500",
    btnClass: "bg-amber-500 hover:bg-amber-600 active:bg-amber-700",
    hasDuration: true,
  },
  {
    id: "ban" as const,
    label: "Ban User",
    sublabel: "Suspend the account entirely. The user cannot log in until the ban is lifted.",
    Icon: ShieldOff,
    color: "text-neutral-800 dark:text-neutral-100",
    activeBg: "bg-neutral-100 dark:bg-white/[0.08]",
    activeBorder: "border-neutral-400 dark:border-white/30",
    activeRing: "ring-neutral-400/20",
    dot: "bg-neutral-700 dark:bg-white",
    btnClass: "bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 dark:text-neutral-900",
    hasDuration: true,
  },
];

const DURATION_UNITS = [
  { value: "minutes", label: "Minutes",  factor: 1 },
  { value: "hours",   label: "Hours",    factor: 60 },
  { value: "days",    label: "Days",     factor: 1440 },
  { value: "weeks",   label: "Weeks",    factor: 10080 },
  { value: "months",  label: "Months",   factor: 43200 },
  { value: "years",   label: "Years",    factor: 525600 },
];

export const PenaltyModal: React.FC<PenaltyModalProps> = ({ target, onClose, onSuccess }) => {
  const [level, setLevel]                   = useState<"delete" | "mute" | "ban">("delete");
  const [reason, setReason]                 = useState("");
  const [isPermanent, setIsPermanent]       = useState(false);
  const [durationAmount, setDurationAmount] = useState(1);
  const [durationUnit, setDurationUnit]     = useState("days");
  const [alsoDelete, setAlsoDelete]         = useState(false);
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState("");

  useEffect(() => {
    if (target) {
      setLevel("delete");
      setReason("");
      setIsPermanent(false);
      setDurationAmount(1);
      setDurationUnit("days");
      setAlsoDelete(false);
      setError("");
      setLoading(false);
    }
  }, [target]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (target) window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [target, onClose]);

  // Lock body scroll when open
  useEffect(() => {
    if (target) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
  }, [target]);

  const handleSubmit = useCallback(async () => {
    if (!target) return;
    if (!reason.trim()) { setError("Please enter a reason for this action."); return; }

    const unit = DURATION_UNITS.find(u => u.value === durationUnit);
    const durationMinutes = isPermanent ? undefined : (durationAmount || 1) * (unit?.factor ?? 1440);

    setLoading(true);
    setError("");
    try {
      const res = await apiClient(`/api/reports/${target.reportId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          penaltyType: level,
          reason: reason.trim(),
          durationMinutes,
          isPermanent: isPermanent || level === "delete",
          alsoDeleteComment: level !== "delete" ? alsoDelete : false,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Action failed. Please try again.");
        return;
      }
      onSuccess();
      onClose();
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }, [target, level, reason, isPermanent, durationAmount, durationUnit, alsoDelete, onSuccess, onClose]);

  const currentLevel = LEVELS.find(l => l.id === level)!;

  return (
    <AnimatePresence>
      {target && (
        <>
          {/* Backdrop */}
          <motion.div
            key="penalty-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-0 z-50 bg-black/60 dark:bg-black/75 backdrop-blur-md"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            key="penalty-panel"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.85 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className="pointer-events-auto w-full max-w-lg max-h-[90dvh] flex flex-col bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-2xl border border-neutral-200/60 dark:border-white/[0.09] overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* ── Header ── */}
              <div className="flex items-start justify-between px-6 pt-6 pb-5 border-b border-neutral-100 dark:border-white/[0.08] flex-shrink-0">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 w-9 h-9 rounded-xl bg-rose-50 dark:bg-rose-500/10 flex items-center justify-center shrink-0">
                    <Gavel className="w-4.5 h-4.5 text-rose-600 dark:text-rose-400" />
                  </div>
                  <div>
                    <h2 className="text-[17px] font-semibold tracking-tight text-neutral-900 dark:text-white leading-snug">
                      Approve Report
                    </h2>
                    <p className="text-[13px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                      Apply a penalty to{" "}
                      <span className="font-semibold text-neutral-700 dark:text-neutral-200">
                        {target.reportedUserName}
                      </span>
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="mt-0.5 shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-white/[0.08] text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-white/[0.14] transition-colors cursor-pointer"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* ── Scrollable body ── */}
              <div
                className="flex-1 overflow-y-auto px-6 py-5 space-y-5"
                style={{ WebkitOverflowScrolling: "touch" }}
              >
                {/* Reported content preview */}
                <div className="bg-neutral-50 dark:bg-[#2C2C2E] rounded-xl p-4 border border-neutral-200/70 dark:border-white/[0.08]">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 dark:text-neutral-500 mb-2">
                    Reported {target.commentType}
                  </p>
                  <p className="text-[13px] leading-relaxed text-neutral-600 dark:text-neutral-300 italic line-clamp-3">
                    "{target.commentContent}"
                  </p>
                </div>

                {/* Penalty level selector */}
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-400 dark:text-neutral-500">
                    Penalty Level
                  </p>
                  <div className="space-y-2">
                    {LEVELS.map((l) => {
                      const active = level === l.id;
                      return (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => setLevel(l.id)}
                          className={`w-full flex items-start gap-3.5 px-4 py-3.5 rounded-xl border text-left transition-all duration-150 cursor-pointer ${
                            active
                              ? `${l.activeBg} ${l.activeBorder} ring-2 ${l.activeRing}`
                              : "border-neutral-200/70 dark:border-white/[0.08] bg-white dark:bg-[#2C2C2E] hover:border-neutral-300 dark:hover:border-white/20"
                          }`}
                        >
                          <div className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                            active ? `${l.activeBg} border ${l.activeBorder}` : "bg-neutral-100 dark:bg-white/[0.07]"
                          }`}>
                            <l.Icon className={`w-4 h-4 ${active ? l.color : "text-neutral-400 dark:text-neutral-500"}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-[14px] font-semibold leading-tight ${active ? l.color : "text-neutral-800 dark:text-white"}`}>
                              {l.label}
                            </p>
                            <p className="text-[12px] text-neutral-500 dark:text-neutral-400 mt-0.5 leading-relaxed">
                              {l.sublabel}
                            </p>
                          </div>
                          {/* Radio indicator */}
                          <div className={`mt-1 w-4.5 h-4.5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                            active ? `${l.activeBorder} border-2` : "border-neutral-300 dark:border-white/20"
                          }`}>
                            {active && <div className={`w-2 h-2 rounded-full ${l.dot}`} />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Duration picker — mute / ban only */}
                {currentLevel.hasDuration && (
                  <div className="space-y-3">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-400 dark:text-neutral-500">
                      Duration
                    </p>

                    {/* Permanent toggle */}
                    <button
                      type="button"
                      onClick={() => setIsPermanent(p => !p)}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all cursor-pointer ${
                        isPermanent
                          ? "border-rose-300 dark:border-rose-500/50 bg-rose-50 dark:bg-rose-500/10 ring-2 ring-rose-500/15"
                          : "border-neutral-200/70 dark:border-white/[0.08] bg-white dark:bg-[#2C2C2E] hover:border-neutral-300 dark:hover:border-white/20"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <InfinityIcon className={`w-4 h-4 ${isPermanent ? "text-rose-600 dark:text-rose-400" : "text-neutral-400"}`} />
                        <span className={`text-[14px] font-semibold ${isPermanent ? "text-rose-700 dark:text-rose-400" : "text-neutral-700 dark:text-neutral-200"}`}>
                          Permanent
                        </span>
                      </div>
                      {/* Toggle switch */}
                      <div className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${isPermanent ? "bg-rose-500" : "bg-neutral-300 dark:bg-neutral-600"}`}>
                        <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200 ${isPermanent ? "translate-x-5.5 left-0.5" : "left-0.5"}`} />
                      </div>
                    </button>

                    {/* Duration fields */}
                    {!isPermanent && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex gap-2"
                      >
                        <input
                          type="number"
                          min={1}
                          value={durationAmount}
                          onChange={e => setDurationAmount(Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-24 bg-white dark:bg-[#2C2C2E] border border-neutral-200 dark:border-white/[0.12] rounded-xl px-3 py-2.5 text-[15px] text-neutral-900 dark:text-white outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 transition"
                        />
                        <div className="relative flex-1">
                          <select
                            value={durationUnit}
                            onChange={e => setDurationUnit(e.target.value)}
                            className="w-full appearance-none bg-white dark:bg-[#2C2C2E] border border-neutral-200 dark:border-white/[0.12] rounded-xl px-3 py-2.5 text-[15px] text-neutral-900 dark:text-white outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 transition pr-9 cursor-pointer"
                          >
                            {DURATION_UNITS.map(u => (
                              <option key={u.value} value={u.value}>{u.label}</option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none" />
                        </div>
                      </motion.div>
                    )}

                    {/* Also delete comment */}
                    <label className="flex items-center gap-3 px-1 cursor-pointer select-none">
                      <div
                        onClick={() => setAlsoDelete(v => !v)}
                        className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all cursor-pointer ${
                          alsoDelete
                            ? "bg-rose-500 border-rose-500"
                            : "border-neutral-300 dark:border-white/20 bg-white dark:bg-[#2C2C2E]"
                        }`}
                      >
                        {alsoDelete && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                      </div>
                      <span className="text-[13px] text-neutral-700 dark:text-neutral-300">
                        Also delete the offending comment
                      </span>
                    </label>
                  </div>
                )}

                {/* Reason */}
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-400 dark:text-neutral-500">
                    Reason <span className="text-rose-500 normal-case text-[12px] font-normal tracking-normal ml-1">(required)</span>
                  </p>
                  <textarea
                    rows={3}
                    placeholder="Enter the reason for this enforcement action…"
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    maxLength={300}
                    className="w-full bg-white dark:bg-[#2C2C2E] border border-neutral-200 dark:border-white/[0.12] rounded-xl px-4 py-3 text-[14px] leading-relaxed text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-600 outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 resize-none transition"
                  />
                  <div className="flex items-center justify-between px-0.5">
                    <p className="text-[11px] text-neutral-400">Required for audit log</p>
                    <p className={`text-[11px] tabular-nums ${reason.length >= 280 ? "text-rose-500" : "text-neutral-400"}`}>
                      {reason.length}/300
                    </p>
                  </div>
                </div>

                {/* Error */}
                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-xl px-4 py-3 flex items-start gap-2.5"
                    >
                      <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                      <p className="text-[13px] text-rose-700 dark:text-rose-400 leading-snug">{error}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* ── Footer ── */}
              <div className="flex-shrink-0 px-6 py-4 border-t border-neutral-100 dark:border-white/[0.08] flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="flex-1 py-3 rounded-xl font-semibold text-[14px] text-neutral-700 dark:text-neutral-300 bg-neutral-100 dark:bg-white/[0.08] hover:bg-neutral-200 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={loading || !reason.trim()}
                  className={`flex-[2] py-3 rounded-xl font-semibold text-[14px] text-white flex items-center justify-center gap-2 shadow-sm transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${currentLevel.btnClass}`}
                >
                  {loading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Applying…</>
                  ) : (
                    <><Clock className="w-4 h-4" /> Apply {currentLevel.label}</>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default PenaltyModal;
