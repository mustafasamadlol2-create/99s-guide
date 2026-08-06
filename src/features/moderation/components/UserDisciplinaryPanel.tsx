/**
 * UserDisciplinaryPanel — displays a complete disciplinary record for one user.
 * Rendered as a slide-in panel triggered from UserRoleManagement.
 * All data is sourced exclusively from ModerationHistory — no duplicate data.
 */
import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  X, ShieldOff, MicOff, Trash2, Flag, CheckCircle, XCircle,
  Clock, Infinity as InfinityIcon, AlertTriangle, Shield, RefreshCw, Calendar,
  ChevronRight,
} from "lucide-react";
import { apiClient } from "../../../core/api/apiClient";
import { UserAvatar } from "../../profile/components/UserAvatar";

// ─── Types ────────────────────────────────────────────────────────────────────

interface HistoryRecord {
  id: string;
  actionType: string;
  adminId: string;
  reason: string | null;
  isPermanent: boolean;
  duration: number | null;
  createdAt: string;
  expiresAt: string | null;
  admin: { id: string; name: string; email: string };
}

interface DisciplinarySummary {
  totalActions: number;
  approvedReports: number;
  rejectedReports: number;
  deletedQuestions: number;
  deletedAnswers: number;
  muteCount: number;
  banCount: number;
  firstActionAt: string | null;
  lastActionAt: string | null;
  hasPermanentMute: boolean;
  hasPermanentBan: boolean;
  riskLevel: string;
}

interface DisciplinaryData {
  records: HistoryRecord[];
  summary: DisciplinarySummary;
}

interface TargetUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  avatar?: string;
}

interface UserDisciplinaryPanelProps {
  user: TargetUser | null;
  onClose: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  APPROVE_REPORT:  "Approve Report",
  REJECT_REPORT:   "Reject Report",
  DELETE_QUESTION: "Delete Question",
  DELETE_ANSWER:   "Delete Answer",
  DELETE_REPLY:    "Delete Reply",
  MUTE_USER:       "Mute",
  REMOVE_MUTE:     "Remove Mute",
  UPDATE_MUTE:     "Update Mute",
  EXTEND_MUTE:     "Extend Mute",
  REDUCE_MUTE:     "Reduce Mute",
  PERMANENT_MUTE:  "Permanent Mute",
  BAN_USER:        "Ban",
  REMOVE_BAN:      "Remove Ban",
  UPDATE_BAN:      "Update Ban",
  EXTEND_BAN:      "Extend Ban",
  REDUCE_BAN:      "Reduce Ban",
  PERMANENT_BAN:   "Permanent Ban",
  MUTE_EXPIRED:    "Mute Expired",
  BAN_EXPIRED:     "Ban Expired",
};

const RISK_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "No Violations": { bg: "bg-emerald-50 dark:bg-emerald-500/10", text: "text-emerald-700 dark:text-emerald-400", border: "border-emerald-200 dark:border-emerald-500/25" },
  "Low Risk":      { bg: "bg-sky-50 dark:bg-sky-500/10",         text: "text-sky-700 dark:text-sky-400",         border: "border-sky-200 dark:border-sky-500/25" },
  "Medium Risk":   { bg: "bg-amber-50 dark:bg-amber-500/10",     text: "text-amber-700 dark:text-amber-400",     border: "border-amber-200 dark:border-amber-500/25" },
  "High Risk":     { bg: "bg-orange-50 dark:bg-orange-500/10",   text: "text-orange-700 dark:text-orange-400",   border: "border-orange-200 dark:border-orange-500/25" },
  "Repeat Offender":{ bg: "bg-red-50 dark:bg-red-500/10",        text: "text-red-700 dark:text-red-400",         border: "border-red-200 dark:border-red-500/25" },
};

const ACTION_ICONS: Record<string, React.ElementType> = {
  APPROVE_REPORT:  CheckCircle,
  REJECT_REPORT:   XCircle,
  DELETE_QUESTION: Trash2,
  DELETE_ANSWER:   Trash2,
  DELETE_REPLY:    Trash2,
  MUTE_USER:       MicOff,
  REMOVE_MUTE:     MicOff,
  UPDATE_MUTE:     MicOff,
  EXTEND_MUTE:     MicOff,
  REDUCE_MUTE:     MicOff,
  PERMANENT_MUTE:  MicOff,
  BAN_USER:        ShieldOff,
  REMOVE_BAN:      Shield,
  UPDATE_BAN:      ShieldOff,
  EXTEND_BAN:      ShieldOff,
  REDUCE_BAN:      Shield,
  PERMANENT_BAN:   ShieldOff,
  MUTE_EXPIRED:    Clock,
  BAN_EXPIRED:     Clock,
};

const ACTION_COLORS: Record<string, string> = {
  APPROVE_REPORT:  "text-emerald-600 dark:text-emerald-400",
  REJECT_REPORT:   "text-neutral-500 dark:text-neutral-400",
  DELETE_QUESTION: "text-rose-600 dark:text-rose-400",
  DELETE_ANSWER:   "text-rose-600 dark:text-rose-400",
  DELETE_REPLY:    "text-rose-600 dark:text-rose-400",
  MUTE_USER:       "text-amber-600 dark:text-amber-400",
  REMOVE_MUTE:     "text-sky-600 dark:text-sky-400",
  UPDATE_MUTE:     "text-amber-600 dark:text-amber-400",
  EXTEND_MUTE:     "text-orange-600 dark:text-orange-400",
  REDUCE_MUTE:     "text-sky-600 dark:text-sky-400",
  PERMANENT_MUTE:  "text-orange-600 dark:text-orange-400",
  BAN_USER:        "text-red-600 dark:text-red-400",
  REMOVE_BAN:      "text-sky-600 dark:text-sky-400",
  UPDATE_BAN:      "text-red-600 dark:text-red-400",
  EXTEND_BAN:      "text-red-700 dark:text-red-300",
  REDUCE_BAN:      "text-sky-600 dark:text-sky-400",
  PERMANENT_BAN:   "text-red-700 dark:text-red-300",
  MUTE_EXPIRED:    "text-neutral-500 dark:text-neutral-400",
  BAN_EXPIRED:     "text-neutral-500 dark:text-neutral-400",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function fmtDuration(min: number | null, perm: boolean) {
  if (perm) return "Permanent";
  if (!min) return null;
  if (min < 60)   return `${min}m`;
  if (min < 1440) return `${Math.round(min / 60)}h`;
  if (min < 10080)return `${Math.round(min / 1440)}d`;
  return `${Math.round(min / 10080)}w`;
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

const Stat: React.FC<{ label: string; value: number | string; accent?: string }> = ({ label, value, accent }) => (
  <div className="bg-neutral-50 dark:bg-white/[0.03] border border-neutral-100 dark:border-white/[0.05] rounded-xl px-3 py-3 text-center">
    <p className={`text-[20px] font-bold tabular-nums leading-tight ${accent ?? "text-neutral-900 dark:text-white"}`}>{value}</p>
    <p className="text-[10px] text-neutral-500 dark:text-neutral-400 mt-0.5 leading-tight">{label}</p>
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

const UserDisciplinaryPanel: React.FC<UserDisciplinaryPanelProps> = ({ user, onClose }) => {
  const [data, setData]       = useState<DisciplinaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  useEffect(() => {
    if (!user) { setData(null); return; }
    setLoading(true);
    setError("");
    setData(null);
    apiClient(`/api/moderation/history/user/${user.id}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setData)
      .catch(() => setError("Failed to load disciplinary record."))
      .finally(() => setLoading(false));
  }, [user?.id]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (user) window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [user, onClose]);

  const risk    = data?.summary.riskLevel ?? "No Violations";
  const riskStyle = RISK_COLORS[risk] ?? RISK_COLORS["No Violations"];
  const s = data?.summary;

  return (
    <AnimatePresence>
      {user && (
        <>
          {/* Backdrop */}
          <motion.div
            key="disc-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 dark:bg-black/55 z-40 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            key="disc-panel"
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-lg bg-white dark:bg-[#1C1C1E] border-l border-neutral-200 dark:border-white/[0.08] shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="shrink-0 border-b border-neutral-100 dark:border-white/[0.06] px-6 py-4 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <UserAvatar
                  name={user.name}
                  avatarUrl={user.avatarUrl || user.avatar || ""}
                  className="w-10 h-10 rounded-full border border-neutral-200 dark:border-white/[0.1] shrink-0"
                />
                <div>
                  <h3 className="text-[15px] font-semibold text-neutral-900 dark:text-white leading-tight">{user.name || "Unknown"}</h3>
                  <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5">{user.email}</p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/[0.08] text-neutral-400 transition-colors cursor-pointer mt-0.5">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {loading && (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-5 h-5 text-neutral-400 animate-spin" />
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 px-4 py-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl">
                  <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                  <p className="text-[13px] text-rose-700 dark:text-rose-400">{error}</p>
                </div>
              )}

              {data && (
                <>
                  {/* Risk Level */}
                  <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${riskStyle.bg} ${riskStyle.border}`}>
                    <AlertTriangle className={`w-4 h-4 shrink-0 ${riskStyle.text}`} />
                    <div>
                      <p className={`text-[13px] font-bold ${riskStyle.text}`}>{risk}</p>
                      <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                        Based on {s!.totalActions} moderation action{s!.totalActions !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>

                  {/* Stat grid */}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 dark:text-neutral-500 mb-2">Disciplinary Summary</p>
                    <div className="grid grid-cols-3 gap-2">
                      <Stat label="Approved Reports" value={s!.approvedReports} accent={s!.approvedReports > 0 ? "text-rose-600 dark:text-rose-400" : undefined} />
                      <Stat label="Rejected Reports" value={s!.rejectedReports} />
                      <Stat label="Total Actions"    value={s!.totalActions} />
                      <Stat label="Deleted Questions" value={s!.deletedQuestions} accent={s!.deletedQuestions > 0 ? "text-rose-600 dark:text-rose-400" : undefined} />
                      <Stat label="Deleted Answers"  value={s!.deletedAnswers} accent={s!.deletedAnswers > 0 ? "text-rose-600 dark:text-rose-400" : undefined} />
                      <Stat label="Mutes"            value={s!.muteCount} accent={s!.muteCount > 0 ? "text-amber-600 dark:text-amber-400" : undefined} />
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <Stat label="Bans" value={s!.banCount} accent={s!.banCount > 0 ? "text-red-600 dark:text-red-400" : undefined} />
                      <div className="bg-neutral-50 dark:bg-white/[0.03] border border-neutral-100 dark:border-white/[0.05] rounded-xl px-3 py-3">
                        {s!.hasPermanentMute && (
                          <p className="text-[11px] font-semibold text-orange-600 dark:text-orange-400 flex items-center gap-1">
                            <InfinityIcon className="w-3 h-3" /> Permanent Mute on record
                          </p>
                        )}
                        {s!.hasPermanentBan && (
                          <p className="text-[11px] font-semibold text-red-600 dark:text-red-400 flex items-center gap-1 mt-0.5">
                            <InfinityIcon className="w-3 h-3" /> Permanent Ban on record
                          </p>
                        )}
                        {!s!.hasPermanentMute && !s!.hasPermanentBan && (
                          <p className="text-[11px] text-neutral-400 dark:text-neutral-500">No permanent penalties</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* First / Last action */}
                  {(s!.firstActionAt || s!.lastActionAt) && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 dark:text-neutral-500">Timeline</p>
                      {s!.firstActionAt && (
                        <div className="flex items-center gap-2 text-[12px]">
                          <Calendar className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                          <span className="text-neutral-500 dark:text-neutral-400">First action:</span>
                          <span className="text-neutral-800 dark:text-neutral-200">{fmtDate(s!.firstActionAt)}</span>
                        </div>
                      )}
                      {s!.lastActionAt && (
                        <div className="flex items-center gap-2 text-[12px]">
                          <Calendar className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                          <span className="text-neutral-500 dark:text-neutral-400">Last action:</span>
                          <span className="text-neutral-800 dark:text-neutral-200">{fmtDate(s!.lastActionAt)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Chronological timeline */}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 dark:text-neutral-500 mb-3">
                      Action History ({data.records.length})
                    </p>

                    {data.records.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 py-8">
                        <Shield className="w-8 h-8 text-neutral-300 dark:text-neutral-600" />
                        <p className="text-[13px] text-neutral-500 dark:text-neutral-400">No moderation actions recorded.</p>
                      </div>
                    ) : (
                      <div className="relative">
                        {/* Vertical line */}
                        <div className="absolute left-[15px] top-2 bottom-2 w-px bg-neutral-200 dark:bg-white/[0.08]" />

                        <div className="space-y-0">
                          {data.records.map((record, idx) => {
                            const Icon = ACTION_ICONS[record.actionType] ?? Flag;
                            const color = ACTION_COLORS[record.actionType] ?? "text-neutral-500";
                            const label = ACTION_LABELS[record.actionType] ?? record.actionType;
                            const dur   = fmtDuration(record.duration, record.isPermanent);

                            return (
                              <div key={record.id} className="relative flex gap-4 pl-10 pb-4">
                                {/* Icon dot */}
                                <div className={`absolute left-0 w-[30px] h-[30px] rounded-full bg-white dark:bg-[#1C1C1E] border-2 ${idx === 0 ? "border-neutral-400 dark:border-neutral-500" : "border-neutral-200 dark:border-white/[0.12]"} flex items-center justify-center shrink-0 z-10`}>
                                  <Icon className={`w-3 h-3 ${color}`} />
                                </div>

                                <div className="flex-1 min-w-0 pt-0.5">
                                  <div className="flex items-start justify-between gap-2">
                                    <p className={`text-[12px] font-semibold leading-tight ${color}`}>{label}</p>
                                    {record.isPermanent && (
                                      <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200/60 dark:border-red-500/20 px-1.5 py-0.5 rounded shrink-0">
                                        <InfinityIcon className="w-2.5 h-2.5" /> PERM
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5">{fmt(record.createdAt)}</p>
                                  {record.reason && (
                                    <p className="text-[11px] text-neutral-600 dark:text-neutral-300 mt-1 leading-relaxed line-clamp-2">{record.reason}</p>
                                  )}
                                  <div className="flex items-center gap-3 mt-1">
                                    {dur && (
                                      <span className="text-[10px] text-neutral-500 dark:text-neutral-400 flex items-center gap-0.5">
                                        <Clock className="w-2.5 h-2.5" /> {dur}
                                      </span>
                                    )}
                                    <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
                                      by {record.admin?.name || "Admin"}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default UserDisciplinaryPanel;
