import { apiClient } from "../../core/api/apiClient";
import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect, Suspense, memo, lazy } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Users, Search, RefreshCw, Star, Shield, ShieldOff, MicOff } from "lucide-react";
import { LivePresenceSkeleton } from "./Skeleton";
import { UserAvatar } from "../../features/profile/components/UserAvatar";
import { QuickBanModal, QuickBanTarget } from "./QuickBanModal";
import { QuickMuteModal, QuickMuteTarget } from "./QuickMuteModal";

interface UserPresence {
 id: string;
 email: string;
 name: string;
 avatarUrl?: string;
 avatar?: string;
 role: string;
 isOnline: boolean;
}

interface UserPresenceWidgetProps {
 isOwner?: boolean;
 currentUserId?: string;
}

const UserPresenceWidget = function UserPresenceWidget({ isOwner = false, currentUserId }: UserPresenceWidgetProps) {
 const isMountedRef = useRef(true);

 useEffect(() => {
 isMountedRef.current = true;
 return () => {
 isMountedRef.current = false;
 };
 }, []);

 const [users, setUsers] = useState<UserPresence[]>([]);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);
 const [filterQuery, setFilterQuery] = useState("");
 const [banTarget, setBanTarget] = useState<QuickBanTarget | null>(null);
 const [bannedIds, setBannedIds] = useState<Set<string>>(new Set());
 const [muteTarget, setMuteTarget] = useState<QuickMuteTarget | null>(null);
 const [mutedIds, setMutedIds] = useState<Set<string>>(new Set());

 const fetchUsers = async (isBackground = false) => {
 try {
 if (!isBackground) setLoading(true);
 const token = await import("../../core/utils/secureStorage").then(m => m.SecureStorage.get("auth_token"));
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await apiClient("/api/users", { bypassCache: true, headers: authHeaders });
 if (!response.ok) {
 throw new Error("HTTP error " + response.status);
 }

 const contentType = response.headers.get("content-type");
 if (!contentType || !contentType.includes("application/json")) {
 if (isMountedRef.current && !isBackground) setLoading(false);
 return;
 }

 const data = await response.json();
 if (!isMountedRef.current) return;
 if (Array.isArray(data)) {
 const sorted = data.sort((a, b) => {
 if (a.isOnline && !b.isOnline) return -1;
 if (!a.isOnline && b.isOnline) return 1;
 return (a.name || "").localeCompare(b.name || "");
 });
 setUsers(sorted);
 }
 } catch (err: any) {
 if (isMountedRef.current && !isBackground) {
 const errMsg = err.message || String(err); if (errMsg.includes("Authentication required")) { setError("Authentication required. Please log in again."); setUsers([]); } else { setError("Unable to sync active cohort roster. " + errMsg); }
 }
 } finally {
 if (isMountedRef.current && !isBackground) {
 setLoading(false);
 }
 }
 };

 useEffect(() => {
 fetchUsers();

 const handleStatusUpdate = (data: any) => {
 if (!data || !data.email) return;

 setUsers((prevUsers) => {
 const index = prevUsers.findIndex(
 (u) => u.email.toLowerCase() === data.email.toLowerCase(),
 );
 if (index === -1) {
 setTimeout(() => {
 if (isMountedRef.current) {
 fetchUsers(true);
 }
 }, 1000);
 return prevUsers;
 }

 const updated = [...prevUsers];
 updated[index] = {
 ...updated[index],
 ...data,
 avatar: data.avatar || data.avatarUrl || updated[index].avatar,
 avatarUrl: data.avatarUrl || data.avatar || updated[index].avatarUrl,
 };

 return updated.sort((a, b) => {
 if (a.isOnline && !b.isOnline) return -1;
 if (!a.isOnline && b.isOnline) return 1;
 return (a.name || "").localeCompare(b.name || "");
 });
 });
 };

 const handlePresenceUpdate = () => {
 if (isMountedRef.current) {
 fetchUsers();
 }
 };

 const handleCustomStatusUpdate = (e: Event) => {
 const customEvent = e as CustomEvent;
 if (customEvent.detail) {
 handleStatusUpdate(customEvent.detail);
 }
 };

 const handleUserDeleted = (data: { id: string }) => {
 if (!data || !data.id) return;
 setUsers((prevUsers) => prevUsers.filter((u) => u.id !== data.id));
 };

 window.addEventListener("socket-presence-update", handlePresenceUpdate);
 window.addEventListener("socket-user-status-update", handleCustomStatusUpdate);

 return () => {
 window.removeEventListener("socket-presence-update", handlePresenceUpdate);
 window.removeEventListener("socket-user-status-update", handleCustomStatusUpdate);
 };
 }, []);

 const filteredUsers = useMemo(() => users.filter((u) => {
 const query = filterQuery.toLowerCase();
 return (
 (u.name || "").toLowerCase().includes(query) ||
 (u.email || "").toLowerCase().includes(query)
 );
 }), [users, filterQuery]);

 const onlineCount = users.filter((u) => u.isOnline).length;

 return (
 <div className="space-y-4">
 {/* Toolbar */}
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-neutral-50/50 dark:bg-[#1C1C1E]/30 p-2 rounded-lg border border-neutral-200/50 dark:border-white/[0.06]">
 <div className="flex items-center gap-3 px-2">
 <div className="flex items-center gap-2 bg-white dark:bg-[#2C2C2E] shadow-elevation-1 border border-neutral-200 dark:border-white/[0.15] rounded-md px-2 py-1">
 <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
 <span className="text-xs font-mono font-semibold text-neutral-700 dark:text-[#EBEBF599]">
 {onlineCount} / {users.length} ONLINE
 </span>
 </div>
 <button
 onClick={() => fetchUsers()}
 className="flex items-center gap-2 px-2 py-1 rounded-md text-neutral-500 hover:text-neutral-800 dark:text-white hover:bg-neutral-200/50 dark:hover:bg-white/[0.18]/50 transition-colors"
 title="Refresh class"
 >
 <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-emerald-500" : ""}`} />
 <span className="text-xs font-medium">Sync</span>
 </button>
 </div>

 {/* Roster Search Bar */}
 <div className="relative flex items-center w-full sm:max-w-[240px]">
 <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-icon-sm h-icon-sm text-neutral-500 dark:text-[#EBEBF599] pointer-events-none" />
 <input aria-label="Input field"
 type="text"
 placeholder="Search cohort..."
 value={filterQuery}
 onChange={(e) => setFilterQuery(e.target.value)}
 style={{ paddingInlineStart: "38px" }}
 className="w-full ps-10 pe-4 h-10 bg-black/5 dark:bg-white/[0.12] rounded-lg border-none focus:bg-black/10 dark:focus:bg-white/15 outline-none transition text-sm text-neutral-800 dark:text-white placeholder:text-neutral-500"
 />
 </div>
 </div>

 {/* User scrollable lists container */}
 <div className="max-h-[280px] overflow-y-auto pr-1 space-y-1 scrollbar-thin overscroll-y-contain">
 {loading && users.length === 0 ? (
 <LivePresenceSkeleton />
 ) : error && users.length === 0 ? (
 <div className="py-6 text-center text-caption text-med-error bg-red-50/50 rounded-lg border border-red-200/40 font-mono">
 {error}
 </div>
 ) : filteredUsers.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-6 px-4 text-center">
 <div className="w-10 h-10 rounded-full bg-neutral-100 dark:bg-[#2C2C2E]/80 flex items-center justify-center mb-3 border border-neutral-200/50 dark:border-white/[0.12]">
 <Users className="w-icon-sm h-icon-sm text-neutral-500 dark:text-[#EBEBF599]" />
 </div>
 <p className="text-sm font-medium text-neutral-500 dark:text-[#EBEBF599]">
 No active peers found
 </p>
 </div>
 ) : (
 <AnimatePresence initial={false}>
 {filteredUsers.map((u) => {
 const canBan = isOwner && u.id !== currentUserId && u.role !== "owner";
 return (
 <motion.div
 key={u.id}
 initial={{ opacity: 0, y: 5 }}
 animate={{ opacity: 1, y: 0 }}
 exit={{ opacity: 0, y: -5 }}
 className="flex flex-col p-3 hover:bg-neutral-50/80 dark:hover:bg-white/[0.12] rounded-lg transition duration-200 cursor-default group gap-1"
 >
 {/* Row 1: avatar + name + role + status */}
 <div className="flex items-center gap-2 min-w-0">
 <div className="relative shrink-0">
 <UserAvatar
 name={u.name || u.email.split("@")[0]}
 avatarUrl={u.avatarUrl || u.avatar || ""}
 className="w-8 h-8 rounded-full border border-neutral-200 dark:border-[rgba(255,255,255,0.1)] shrink-0 select-none pointer-events-none"
 />
 <span className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white dark:border-neutral-900 flex items-center justify-center`}>
 <span className={`w-2 h-2 rounded-full ${u.isOnline ? "bg-emerald-500 animate-pulse" : "bg-neutral-400 dark:bg-neutral-600"}`} />
 </span>
 </div>
 <span className="text-sm font-semibold text-neutral-800 dark:text-white truncate min-w-0 flex-1">
 {u.name || u.email.split("@")[0]}
 </span>
 {u.role === "owner" ? (
 <div className="flex items-center gap-1 bg-amber-50 dark:bg-med-gold/10 px-2 py-0.5 rounded-full border border-amber-100 dark:border-amber-500/20 shrink-0">
 <span className="w-1.5 h-1.5 rounded-full bg-med-gold"></span>
 <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400 uppercase leading-none">Owner</span>
 </div>
 ) : u.role === "admin" ? (
 <div className="flex items-center gap-1 bg-purple-50 dark:bg-purple-500/10 px-2 py-0.5 rounded-full border border-purple-100 dark:border-purple-500/20 shrink-0">
 <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
 <span className="text-[10px] font-medium text-purple-700 dark:text-purple-400 uppercase leading-none">Admin</span>
 </div>
 ) : (
 <div className="flex items-center gap-1 bg-blue-50 dark:bg-med-blue/10 px-2 py-0.5 rounded-full border border-blue-100 dark:border-blue-500/20 shrink-0">
 <span className="w-1.5 h-1.5 rounded-full bg-med-blue"></span>
 <span className="text-[10px] font-medium text-blue-700 dark:text-blue-400 uppercase leading-none">Student</span>
 </div>
 )}
 {u.isOnline ? (
 <span className="shrink-0 text-[10px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400 px-2 py-0.5 rounded-sm uppercase">
 Active
 </span>
 ) : (
 <span className="shrink-0 text-[10px] font-semibold text-neutral-500 bg-neutral-100 dark:bg-[#2C2C2E] dark:text-[#EBEBF599] px-2 py-0.5 rounded-sm uppercase">
 Away
 </span>
 )}
 </div>
 {/* Row 2: email + Mute/Ban actions */}
 <div className="flex items-center gap-2 pl-10 min-w-0">
 <span className="text-xs text-neutral-500 dark:text-[#EBEBF599] font-mono truncate min-w-0 flex-1">
 {u.email}
 </span>
 {canBan && !mutedIds.has(u.id) && (
 <button
 onClick={() => setMuteTarget({
 userId: u.id,
 name: u.name || u.email.split("@")[0],
 email: u.email,
 avatarUrl: u.avatarUrl || u.avatar,
 })}
 title="Mute user"
 className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-neutral-500 dark:text-[#EBEBF599] hover:bg-amber-50 dark:hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400 border border-neutral-200/60 dark:border-white/[0.12] hover:border-amber-200 dark:hover:border-amber-500/30 transition-all duration-150 cursor-pointer"
 >
 <MicOff className="w-3 h-3" />
 Mute
 </button>
 )}
 {canBan && mutedIds.has(u.id) && (
 <span className="shrink-0 px-2 py-1 rounded-md text-[11px] font-semibold text-amber-500 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30">
 Muted
 </span>
 )}
 {canBan && !bannedIds.has(u.id) && (
 <button
 onClick={() => setBanTarget({
 userId: u.id,
 name: u.name || u.email.split("@")[0],
 email: u.email,
 avatarUrl: u.avatarUrl || u.avatar,
 })}
 title="Ban user"
 className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-neutral-500 dark:text-[#EBEBF599] hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400 border border-neutral-200/60 dark:border-white/[0.12] hover:border-rose-200 dark:hover:border-rose-500/30 transition-all duration-150 cursor-pointer"
 >
 <ShieldOff className="w-3 h-3" />
 Ban
 </button>
 )}
 {canBan && bannedIds.has(u.id) && (
 <span className="shrink-0 px-2 py-1 rounded-md text-[11px] font-semibold text-neutral-400 dark:text-neutral-600 border border-neutral-200 dark:border-white/[0.08]">
 Banned
 </span>
 )}
 </div>
 </motion.div>
 );
 })}
 </AnimatePresence>
 )}
 </div>

 <QuickBanModal
 target={banTarget}
 onClose={() => setBanTarget(null)}
 onSuccess={(userId) => {
 setBannedIds((prev) => { const s = new Set(prev); s.add(userId); return s; });
 }}
 />

 <QuickMuteModal
 target={muteTarget}
 onClose={() => setMuteTarget(null)}
 onSuccess={(userId) => {
 setMutedIds((prev) => { const s = new Set(prev); s.add(userId); return s; });
 }}
 />
 </div>
 );
};

export default memo(UserPresenceWidget);
