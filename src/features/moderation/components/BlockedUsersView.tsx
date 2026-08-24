/**
 * BlockedUsersView — profile sub-page listing blocked users with Unblock button.
 */
import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronLeft, UserX, Loader2, AlertCircle } from "lucide-react";
import { apiClient } from "../../../core/api/apiClient";
import { UserAvatar } from "../../profile/components/UserAvatar";

interface BlockedUser {
  id: string;
  blockId: string;
  name: string;
  avatar: string;
  avatarUrl: string;
  blockedAt: string;
}

interface BlockedUsersViewProps {
  onBack: () => void;
}

export const BlockedUsersView: React.FC<BlockedUsersViewProps> = ({ onBack }) => {
  const [users, setUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unblocking, setUnblocking] = useState<string | null>(null);

  const fetchBlocked = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiClient("/api/blocks");
      if (!res.ok) throw new Error("Failed to load blocked users");
      setUsers(await res.json());
    } catch {
      setError("Failed to load blocked users. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBlocked(); }, [fetchBlocked]);

  const handleUnblock = useCallback(async (blockedId: string) => {
    setUnblocking(blockedId);
    try {
      const res = await apiClient(`/api/blocks/${blockedId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to unblock");
      setUsers((prev) => prev.filter((u) => u.id !== blockedId));
    } catch {
      setError("Failed to unblock user. Please try again.");
    } finally {
      setUnblocking(null);
    }
  }, []);

  return (
    <motion.div
      key="blocked-users-view"
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
          Blocked Users
        </h1>
      </div>

      {/* States */}
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

      {!loading && !error && users.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <div className="w-14 h-14 rounded-2xl bg-neutral-100 dark:bg-white/[0.06] flex items-center justify-center">
            <UserX className="w-6 h-6 text-neutral-400" />
          </div>
          <p className="text-[16px] font-semibold text-neutral-700 dark:text-white">No blocked users</p>
          <p className="text-[14px] text-neutral-500 dark:text-[#EBEBF599] max-w-xs">
            You haven't blocked anyone. Users you block will appear here.
          </p>
        </div>
      )}

      {!loading && !error && users.length > 0 && (
        <div className="bg-white/60 dark:bg-[#1C1C1E]/40 backdrop-blur-sm rounded-2xl overflow-hidden border border-neutral-200/50 dark:border-white/[0.06] shadow-sm">
          <AnimatePresence initial={false}>
            {users.map((user, i) => (
              <motion.div
                key={user.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex items-center gap-4 p-4 relative ${
                  i < users.length - 1
                    ? "after:content-[''] after:absolute after:bottom-0 after:left-16 after:right-4 after:h-[1px] after:bg-neutral-100 dark:after:bg-neutral-800/50"
                    : ""
                }`}
              >
                <UserAvatar
                  name={user.name}
                  avatarUrl={user.avatarUrl || user.avatar}
                  className="w-11 h-11 rounded-full border border-neutral-200 dark:border-white/[0.12] shrink-0 select-none pointer-events-none"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-semibold text-neutral-900 dark:text-white truncate">
                    {user.name}
                  </p>
                  <p className="text-[13px] text-neutral-500 dark:text-[#EBEBF599] mt-0.5">
                    Blocked on{" "}
                    {new Date(user.blockedAt).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <button
                  onClick={() => handleUnblock(user.id)}
                  disabled={unblocking === user.id}
                  className="px-4 py-2 rounded-xl border border-neutral-200 dark:border-white/[0.12] bg-white dark:bg-[#2C2C2E] text-neutral-700 dark:text-[#EBEBF599] text-[13px] font-semibold hover:border-rose-300 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-all duration-150 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5"
                >
                  {unblocking === user.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    "Unblock"
                  )}
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
};

export default BlockedUsersView;
