/**
 * QuickMuteModal — direct mute overlay for Live Study Hall.
 * Reuses the same UserMute table + socket + notification infrastructure
 * as the Moderation penalty system. No duplicate backend logic.
 */
import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, MicOff, Loader2, Infinity as InfinityIcon, Clock } from "lucide-react";
import { apiClient } from "../../core/api/apiClient";
import { UserAvatar } from "../../features/profile/components/UserAvatar";
import { FormError } from "./FormError";

export interface QuickMuteTarget {
  userId: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

interface QuickMuteModalProps {
  target: QuickMuteTarget | null;
  onClose: () => void;
  onSuccess: (userId: string) => void;
}

const DURATION_UNITS = [
  { value: "minutes", label: "Minutes", factor: 1 },
  { value: "hours",   label: "Hours",   factor: 60 },
  { value: "days",    label: "Days",    factor: 1440 },
  { value: "weeks",   label: "Weeks",   factor: 10080 },
  { value: "months",  label: "Months",  factor: 43200 },
  { value: "years",   label: "Years",   factor: 525600 },
];

export const QuickMuteModal: React.FC<QuickMuteModalProps> = ({ target, onClose, onSuccess }) => {
  const [reason, setReason] = useState("");
  const [isPermanent, setIsPermanent] = useState(false);
  const [durationAmount, setDurationAmount] = useState(1);
  const [durationUnit, setDurationUnit] = useState("days");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (target) {
      setReason("");
      setIsPermanent(false);
      setDurationAmount(1);
      setDurationUnit("days");
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
    if (!target) return;
    if (!reason.trim()) { setError("Please enter a reason for the mute."); return; }

    const unit = DURATION_UNITS.find(u => u.value === durationUnit);
    const durationMinutes = isPermanent ? undefined : (durationAmount || 1) * (unit?.factor ?? 1440);

    setLoading(true);
    setError("");
    try {
      const res = await apiClient("/api/moderation/mutes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: target.userId,
          reason: reason.trim(),
          durationMinutes,
          isPermanent,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Mute failed. Please try again.");
        return;
      }
      onSuccess(target.userId);
      onClose();
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }, [target, reason, isPermanent, durationAmount, durationUnit, onSuccess, onClose]);

  return (
    <AnimatePresence>
      {target && (
        <>
          {/* Backdrop */}
          <motion.div
            key="qmute-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-0 bg-black/55 dark:bg-black/75 z-50 backdrop-blur-md"
            onClick={onClose}
          />

          {/* Centered dialog */}
          <div className="mobile-overlay-top mobile-dialog-shell fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              key="qmute-dialog"
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
                  <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200/60 dark:border-amber-500/20 flex items-center justify-center shrink-0">
                    <MicOff className="w-4.5 h-4.5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <h2 className="text-[16px] font-semibold text-neutral-900 dark:text-white tracking-tight leading-tight">
                      Mute User
                    </h2>
                    <p className="text-[12px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                      Prevents the user from posting in discussions.
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
                {/* Target user */}
                <div className="flex items-center gap-3 bg-neutral-50 dark:bg-white/[0.03] border border-neutral-100 dark:border-white/[0.06] rounded-xl px-4 py-3">
                  <UserAvatar
                    name={target.name}
                    avatarUrl={target.avatarUrl || ""}
                    className="w-10 h-10 rounded-full border border-neutral-200 dark:border-white/[0.12] shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-neutral-900 dark:text-white truncate">{target.name}</p>
                    <p className="text-[12px] text-neutral-500 dark:text-neutral-400 truncate">{target.email}</p>
                  </div>
                </div>

                {/* Reason */}
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                    Reason <span className="text-rose-500 normal-case font-normal tracking-normal">*</span>
                  </label>
                  <textarea
                    rows={2}
                    placeholder="State the reason for this mute…"
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    maxLength={300}
                    className="w-full bg-neutral-50 dark:bg-white/[0.04] border border-neutral-200 dark:border-white/[0.08] rounded-xl px-4 py-3 text-[14px] text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-600 outline-none focus-visible:ring-2 focus-visible:ring-amber-400/30 dark:focus-visible:ring-amber-500/20 focus-visible:border-amber-300 dark:focus-visible:border-amber-500/30 resize-none transition"
                  />
                  <p className="text-right text-[11px] text-neutral-400">{reason.length}/300</p>
                </div>

                {/* Duration */}
                <div className="space-y-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                    Duration
                  </p>

                  {/* Permanent toggle */}
                  <button
                    type="button"
                    onClick={() => setIsPermanent(p => !p)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all cursor-pointer ${
                      isPermanent
                        ? "border-amber-300 dark:border-amber-500/40 bg-amber-50/80 dark:bg-amber-500/10"
                        : "border-neutral-150 dark:border-white/[0.06] bg-neutral-50/50 dark:bg-white/[0.03] hover:bg-neutral-100/80 dark:hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <InfinityIcon className={`w-4 h-4 ${isPermanent ? "text-amber-500 dark:text-amber-400" : "text-neutral-400 dark:text-neutral-500"}`} />
                      <span className={`text-[14px] font-semibold ${isPermanent ? "text-amber-700 dark:text-amber-400" : "text-neutral-700 dark:text-neutral-200"}`}>
                        Permanent
                      </span>
                    </div>
                    <div
                      className={`relative rounded-full transition-colors ${isPermanent ? "bg-amber-500" : "bg-neutral-200 dark:bg-neutral-700"}`}
                      style={{ height: "22px", width: "40px" }}
                    >
                      <div className={`absolute top-0.5 w-[18px] h-[18px] bg-white rounded-full shadow-sm transition-all duration-200 ${isPermanent ? "left-[19px]" : "left-0.5"}`} />
                    </div>
                  </button>

                  {/* Timed duration picker */}
                  <AnimatePresence>
                    {!isPermanent && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.18 }}
                        className="overflow-hidden"
                      >
                        <div className="flex items-center gap-2 pt-0.5">
                          <div className="flex items-center gap-2 bg-neutral-50 dark:bg-white/[0.04] border border-neutral-200 dark:border-white/[0.08] rounded-xl px-3 py-2.5 w-28">
                            <Clock className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                            <input
                              type="number"
                              min={1}
                              value={durationAmount}
                              onChange={e => setDurationAmount(Math.max(1, parseInt(e.target.value) || 1))}
                              className="w-full bg-transparent text-[14px] text-neutral-900 dark:text-white outline-none tabular-nums"
                            />
                          </div>
                          <select
                            value={durationUnit}
                            onChange={e => setDurationUnit(e.target.value)}
                            className="flex-1 appearance-none bg-neutral-50 dark:bg-white/[0.04] border border-neutral-200 dark:border-white/[0.08] rounded-xl px-3 py-2.5 text-[14px] text-neutral-900 dark:text-white outline-none focus-visible:ring-2 focus-visible:ring-amber-400/30 dark:focus-visible:ring-amber-500/20 transition cursor-pointer"
                          >
                            {DURATION_UNITS.map(u => (
                              <option key={u.value} value={u.value}>{u.label}</option>
                            ))}
                          </select>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Error */}
                <FormError message={error} />
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
                  disabled={loading || !reason.trim()}
                  className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold text-[14px] flex items-center justify-center gap-2 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer active:scale-[0.98]"
                >
                  {loading ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Muting…</>
                  ) : (
                    <><MicOff className="w-3.5 h-3.5" /> Mute User</>
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

export default QuickMuteModal;
