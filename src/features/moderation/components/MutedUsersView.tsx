/**
 * MutedUsersView — admin panel listing all currently muted users.
 * Supports: Remove Mute, Extend, Shorten, Convert to Permanent.
 */
import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { MicOff, Loader2, AlertCircle, CheckCheck, RefreshCw, ChevronDown, Infinity as InfinityIcon, Clock, Bell } from "lucide-react";
import { apiClient } from "../../../core/api/apiClient";
import { UserAvatar } from "../../profile/components/UserAvatar";
import { SwipeActionItem } from "../../../components/ui/SwipeActionItem";

interface MutedUser {
  id: string;
  userId: string;
  name: string;
  email: string;
  avatar: string;
  reason: string;
  startTime: string;
  endTime: string | null;
  isPermanent: boolean;
  createdAt: string;
}

const DURATION_UNITS = [
  { value: "minutes", label: "Minutes", factor: 1 },
  { value: "hours",   label: "Hours",   factor: 60 },
  { value: "days",    label: "Days",    factor: 1440 },
  { value: "weeks",   label: "Weeks",   factor: 10080 },
  { value: "months",  label: "Months",  factor: 43200 },
  { value: "years",   label: "Years",   factor: 525600 },
];

function formatRemaining(endTime: string | null, isPermanent: boolean): string {
  if (isPermanent) return "Permanent";
  if (!endTime) return "Unknown";
  const ms = new Date(endTime).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m remaining`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h remaining`;
  const d = Math.floor(h / 24);
  return `${d}d remaining`;
}

export const MutedUsersView: React.FC = () => {
  const [users, setUsers] = useState<MutedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState(1);
  const [editUnit, setEditUnit] = useState("days");

  const showFeedback = useCallback((msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 3500);
  }, []);

  const fetchMutes = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiClient("/api/moderation/mutes");
      if (!res.ok) throw new Error();
      setUsers(await res.json());
    } catch {
      setError("Failed to load muted users. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMutes(); }, [fetchMutes]);

  // Re-fetch whenever the server broadcasts a mute list change
  useEffect(() => {
    const handler = () => fetchMutes();
    window.addEventListener("socket-mute-list-updated", handler);
    return () => window.removeEventListener("socket-mute-list-updated", handler);
  }, [fetchMutes]);

  const handleRemove = useCallback(async (userId: string) => {
    setActionLoading(userId + ":remove");
    try {
      const res = await apiClient(`/api/moderation/mutes/${userId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setUsers(prev => prev.filter(u => u.userId !== userId));
      showFeedback("✅ Mute removed successfully.");
    } catch {
      showFeedback("❌ Failed to remove mute.");
    } finally {
      setActionLoading(null);
    }
  }, [showFeedback]);

  const handleMakePermanent = useCallback(async (userId: string) => {
    setActionLoading(userId + ":permanent");
    try {
      const res = await apiClient(`/api/moderation/mutes/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPermanent: true }),
      });
      if (!res.ok) throw new Error();
      setUsers(prev => prev.map(u => u.userId === userId ? { ...u, isPermanent: true, endTime: null } : u));
      showFeedback("✅ Mute converted to permanent.");
    } catch {
      showFeedback("❌ Action failed.");
    } finally {
      setActionLoading(null);
    }
  }, [showFeedback]);

  const handleSendNotification = useCallback(async (userId: string) => {
    setActionLoading(userId + ":notify");
    try {
      const res = await apiClient(`/api/moderation/mutes/${userId}/notify`, { method: "POST" });
      if (!res.ok) throw new Error();
      showFeedback("✅ Notification sent successfully.");
    } catch {
      showFeedback("❌ Failed to send notification.");
    } finally {
      setActionLoading(null);
    }
  }, [showFeedback]);

  const handleUpdateDuration = useCallback(async (userId: string) => {
    const unit = DURATION_UNITS.find(u => u.value === editUnit);
    const durationMinutes = (editAmount || 1) * (unit?.factor || 1440);
    setActionLoading(userId + ":update");
    try {
      const res = await apiClient(`/api/moderation/mutes/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durationMinutes, isPermanent: false }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setUsers(prev => prev.map(u => u.userId === userId ? { ...u, endTime: data.endTime, isPermanent: false } : u));
      setEditingId(null);
      showFeedback("✅ Duration updated.");
    } catch {
      showFeedback("❌ Failed to update duration.");
    } finally {
      setActionLoading(null);
    }
  }, [editAmount, editUnit, showFeedback]);

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Header */}
      <div className="border-b border-neutral-100 dark:border-white/[0.12] pb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MicOff className="w-4 h-4 text-amber-500" />
          <h3 className="text-headline font-display font-semibold text-neutral-800 dark:text-white">
            Muted Users
          </h3>
        </div>
        <button onClick={fetchMutes} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/[0.08] text-neutral-500 transition-colors cursor-pointer" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Feedback */}
      <AnimatePresence>
        {feedback && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="p-3 rounded-lg border bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/50 text-caption font-semibold text-center">
            {feedback}
          </motion.div>
        )}
      </AnimatePresence>

      {loading && (
        <div className="flex items-center justify-center py-12 gap-2">
          <Loader2 className="w-5 h-5 text-neutral-400 animate-spin" />
          <span className="text-[14px] text-neutral-500">Loading…</span>
        </div>
      )}

      {!loading && error && (
        <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <p className="text-[14px] text-rose-700 dark:text-rose-400">{error}</p>
        </div>
      )}

      {!loading && !error && users.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <CheckCheck className="w-8 h-8 text-emerald-400" />
          <p className="text-[15px] font-semibold text-neutral-700 dark:text-white">No muted users</p>
          <p className="text-[13px] text-neutral-500">All users can currently post in discussions.</p>
        </div>
      )}

      {!loading && !error && users.length > 0 && (
        <div className="space-y-3">
          {users.map(user => {
            const isActing = actionLoading?.startsWith(user.userId);
            const isEditing = editingId === user.userId;
            return (
              <SwipeActionItem
                key={user.userId}
                keyId={`muted-${user.userId}`}
                disabled={!!isActing || isEditing}
                className="rounded-xl"
                actions={[
                  {
                    label: "Unmute",
                    icon: <CheckCheck className="w-5 h-5" />,
                    bgClass: "bg-emerald-500 dark:bg-emerald-600",
                    onClick: () => handleRemove(user.userId),
                  },
                ]}
              >
              <div className="bg-white dark:bg-[#1C1C1E] border border-neutral-200/50 dark:border-white/[0.08] rounded-xl p-4 space-y-3 shadow-sm">
                {/* User row */}
                <div className="flex items-center gap-3">
                  <UserAvatar name={user.name} avatarUrl={user.avatar} className="w-10 h-10 rounded-full border border-neutral-200 dark:border-white/[0.12] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[14px] font-semibold text-neutral-900 dark:text-white truncate">{user.name}</p>
                      {user.isPermanent && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400">
                          <InfinityIcon className="w-3 h-3" /> Permanent
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-neutral-500 dark:text-[#EBEBF599] truncate">{user.email}</p>
                  </div>
                  <div className="flex items-center gap-1 text-[12px] text-amber-600 dark:text-amber-400 font-medium shrink-0">
                    <Clock className="w-3.5 h-3.5" />
                    {formatRemaining(user.endTime, user.isPermanent)}
                  </div>
                </div>

                {/* Reason */}
                <div className="bg-neutral-50 dark:bg-[#2C2C2E] rounded-lg px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-0.5">Reason</p>
                  <p className="text-[13px] text-neutral-700 dark:text-[#EBEBF5CC]">{user.reason}</p>
                </div>

                {/* Muted since */}
                <p className="text-[12px] text-neutral-400">
                  Muted since {new Date(user.startTime).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </p>

                {/* Duration editor */}
                {isEditing && (
                  <div className="duration-editor-row flex items-center gap-2 pt-1">
                    <input type="number" min={1} value={editAmount} onChange={e => setEditAmount(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-20 bg-white dark:bg-[#2C2C2E] border border-neutral-200 dark:border-white/[0.12] rounded-lg px-2 py-1.5 text-[13px] text-neutral-900 dark:text-white outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40" />
                    <div className="relative flex-1">
                      <select value={editUnit} onChange={e => setEditUnit(e.target.value)}
                        className="w-full appearance-none bg-white dark:bg-[#2C2C2E] border border-neutral-200 dark:border-white/[0.12] rounded-lg px-2 py-1.5 text-[13px] text-neutral-900 dark:text-white outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40 cursor-pointer">
                        {DURATION_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-neutral-400 pointer-events-none" />
                    </div>
                    <button onClick={() => handleUpdateDuration(user.userId)} disabled={!!isActing}
                      className="px-3 py-1.5 rounded-lg bg-blue-500 text-white text-[13px] font-semibold hover:bg-blue-600 transition-colors disabled:opacity-50 cursor-pointer">
                      {actionLoading === user.userId + ":update" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Set"}
                    </button>
                    <button onClick={() => setEditingId(null)} className="px-3 py-1.5 rounded-lg bg-neutral-100 dark:bg-white/[0.06] text-neutral-600 dark:text-neutral-400 text-[13px] font-semibold hover:bg-neutral-200 transition-colors cursor-pointer">
                      Cancel
                    </button>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 pt-1 border-t border-neutral-100 dark:border-white/[0.08] flex-wrap">
                  <button onClick={() => handleRemove(user.userId)} disabled={!!isActing}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[13px] font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors disabled:opacity-50 cursor-pointer">
                    {actionLoading === user.userId + ":remove" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
                    Remove Mute
                  </button>
                  {!isEditing && (
                    <button onClick={() => { setEditingId(user.userId); setEditAmount(1); setEditUnit("days"); }} disabled={!!isActing}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 text-[13px] font-semibold hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors disabled:opacity-50 cursor-pointer">
                      <Clock className="w-3.5 h-3.5" />
                      Change Duration
                    </button>
                  )}
                  {!user.isPermanent && (
                    <button onClick={() => handleMakePermanent(user.userId)} disabled={!!isActing}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-white/[0.06] text-neutral-700 dark:text-neutral-300 text-[13px] font-semibold hover:bg-neutral-200 dark:hover:bg-white/[0.12] transition-colors disabled:opacity-50 cursor-pointer ml-auto">
                      {actionLoading === user.userId + ":permanent" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <InfinityIcon className="w-3.5 h-3.5" />}
                      Make Permanent
                    </button>
                  )}
                </div>
              </div>
              </SwipeActionItem>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MutedUsersView;
