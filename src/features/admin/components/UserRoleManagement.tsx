import React, { useState, useEffect, useRef, useCallback } from "react";
import { flushSync } from "react-dom";
import { animate, motion, useMotionValue } from "motion/react";
import { IOS_CONSOLE_SMOOTH_MOTION } from "../../../core/motion/swipeMotion";
import { showiOSAlert } from "../../../core/device/alert";
import { User } from "../../../core/types";
import { FormError } from "../../../components/ui/FormError";
import { UserAvatar } from "../../../features/profile/components/UserAvatar";
import { apiClient } from "../../../core/api/apiClient";
import UserDisciplinaryPanel from "../../moderation/components/UserDisciplinaryPanel";
import {
 ShieldAlert,
 ShieldCheck,
 UserCheck,
 Search,
 Loader2,
 ArrowLeftRight,
 Check,
 AlertCircle,
 MoreVertical,
 Edit2,
 Ban,
 Trash2,
 ClipboardList,
} from "lucide-react";

interface UserRoleManagementProps {
 currentUser: User;
 language: "en" | "ar";
}

interface FetchedUser {
 id: string;
 email: string;
 name: string;
 avatarUrl?: string;
 avatar?: string;
 role: string;
 isPrimaryOwner?: boolean;
 isOnline: boolean;
}

let cachedRoleUsers: FetchedUser[] | null = null;
let roleUsersRequest: Promise<FetchedUser[]> | null = null;

async function requestRoleUsers(force = false): Promise<FetchedUser[]> {
 if (!force && cachedRoleUsers) return cachedRoleUsers;
 if (roleUsersRequest) return roleUsersRequest;

 roleUsersRequest = (async () => {
  const token = await import("../../../core/utils/secureStorage").then((m) =>
   m.SecureStorage.get("auth_token"),
  );
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await apiClient("/api/users", { headers: authHeaders });
  if (!response.ok) throw new Error("Failed to fetch users");
  const data = await response.json();
  const nextUsers = Array.isArray(data) ? data : [];
  cachedRoleUsers = nextUsers;
  return nextUsers;
 })();

 try {
  return await roleUsersRequest;
 } finally {
  roleUsersRequest = null;
 }
}

/** Warm the Roles panel before the first Console swipe reaches it. */
export async function preloadUserRoleUsers(): Promise<void> {
 try {
  await requestRoleUsers(false);
 } catch {
  // The mounted panel will surface the normal localized error state if needed.
 }
}

const ROLE_FILTER_ORDER = ["all", "owner", "admin", "user"] as const;
type RoleFilterId = (typeof ROLE_FILTER_ORDER)[number];

export default function UserRoleManagement({
 currentUser,
 language,
}: UserRoleManagementProps) {
 const isRtl = language === "ar";

 const [users, setUsers] = useState<FetchedUser[]>(() => cachedRoleUsers ?? []);
 const [loading, setLoading] = useState(() => cachedRoleUsers === null);
 const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
 const [searchQuery, setSearchQuery] = useState("");
 const [roleFilter, setRoleFilter] = useState<RoleFilterId>("all");
 const roleSwipeX = useMotionValue(0);
 const [roleSwipePreview, setRoleSwipePreview] = useState<RoleFilterId | null>(null);
 const roleSwipeAnimatingRef = useRef(false);
 const roleSwipeSessionRef = useRef({
  tracking: false,
  axis: null as "x" | "y" | null,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastTime: 0,
  velocity: 0,
 });
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [disciplinaryUser, setDisciplinaryUser] = useState<FetchedUser | null>(null);
  const isPrimaryOwner = currentUser.isPrimaryOwner === true;

  const canManageRole = useCallback((target: FetchedUser, nextRole: string) => {
    if (target.id === currentUser.id || target.isPrimaryOwner === true) return false;
    if (target.role === "owner" && !isPrimaryOwner) return false;
    if (nextRole === "owner" && !isPrimaryOwner) return false;
    return true;
  }, [currentUser.id, isPrimaryOwner]);

 const fetchUsers = useCallback(async (force = false) => {
  const shouldShowBlockingSpinner = users.length === 0 && cachedRoleUsers === null;
  try {
   if (shouldShowBlockingSpinner) setLoading(true);
   const data = await requestRoleUsers(force);
   setUsers(data);
  } catch (err: any) {
   setErrorMessage(
    isRtl ? "فشل تحميل قائمة المستخدمين." : "Failed to load user records.",
   );
  } finally {
   setLoading(false);
  }
 }, [isRtl, users.length]);

 useEffect(() => {
 fetchUsers(false);
 
    const handleFocus = () => fetchUsers(true);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") handleFocus();
    };
    window.addEventListener("focus", handleFocus);
    window.addEventListener("visibilitychange", handleVisibility);
    const handleRosterRefresh = () => void fetchUsers(true);
    window.addEventListener("socket-roster-updated", handleRosterRefresh as EventListener);
    window.addEventListener("socket-user-created", handleRosterRefresh as EventListener);
    window.addEventListener("socket-user-deleted", handleRosterRefresh as EventListener);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("socket-roster-updated", handleRosterRefresh as EventListener);
      window.removeEventListener("socket-user-created", handleRosterRefresh as EventListener);
      window.removeEventListener("socket-user-deleted", handleRosterRefresh as EventListener);
    };
 }, [fetchUsers]);

 const handleRoleChange = async (
 userId: string,
 targetUserEmail: string,
  newRole: string,
  ) => {
  const targetUser = users.find((u) => u.id === userId);

  // Block self-role-change
 if (userId === currentUser.id) {
 setErrorMessage(isRtl ? "لا يمكنك تغيير دورك الخاص." : "You cannot change your own role.");
 setSuccessMessage(null);
  return;
  }

  if (!targetUser || !canManageRole(targetUser, newRole)) {
  setErrorMessage(
    isRtl
      ? "لا تملك الصلاحية لتعديل رتبة هذا الحساب."
      : "You do not have permission to change this user's role.",
  );
  setSuccessMessage(null);
  return;
  }


 
    showiOSAlert({
      title: isRtl ? "تأكيد تغيير الرتبة" : "Confirm Role Change",
      message: isRtl ? `هل أنت متأكد من تغيير صلاحيات هذا الحساب إلى ${newRole}؟` : `Are you sure you want to change this user's role to ${newRole}?`,
      actions: [
        { label: isRtl ? "إلغاء" : "Cancel", style: "cancel" },
        { 
          label: isRtl ? "تأكيد" : "Confirm", 
          style: "destructive",
          onClick: async () => {
try {
 setUpdatingUserId(userId);
 setErrorMessage(null);
 setSuccessMessage(null);

 const response = await apiClient("/api/users/role", {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ userId, role: newRole }),
 });

 const result = await response.json();

 if (!response.ok) {
 throw new Error(result.error || "Failed to update user role");
 }

 setUsers((prevUsers) =>
 prevUsers.map((u) => (u.id === userId ? { ...u, role: newRole } : u)),
 );

 const nameToDisplay =
 users.find((u) => u.id === userId)?.name || targetUserEmail;
 const successText = isRtl
 ? `تم تحديث رتبة (${nameToDisplay}) بنجاح إلى [${newRole === "owner" ? "مالك" : newRole === "admin" ? "مشرف" : "مستخدم"}].`
 : `Successfully changed role for ${nameToDisplay} to [${newRole.toUpperCase()}].`;

 setSuccessMessage(successText);
 } catch (err: any) {
 
 setErrorMessage(
 err.message ||
 (isRtl
 ? "حدث خطأ أثناء محاولة تعديل الصلاحيات."
 : "Failed to modify role due to a server error."),
 );
 } finally {
 setUpdatingUserId(null); }
          }
        }
      ]
    });
}; const filteredUsers = users.filter((u) => {
 const term = searchQuery.toLowerCase();
 const matchesSearch = (u.name || "").toLowerCase().includes(term) ||
 (u.email || "").toLowerCase().includes(term);
 const matchesRole = roleFilter === "all" || u.role === roleFilter;
 return matchesSearch && matchesRole;
 });

 const clearRoleSwipePreview = useCallback(() => {
  setRoleSwipePreview(null);
 }, []);

 const settleRoleSwipe = useCallback(() => {
  const session = roleSwipeSessionRef.current;
  const currentX = roleSwipeX.get();
  const direction = currentX === 0 ? 0 : Math.sign(currentX);
  const releaseVelocity = session.velocity;

  session.tracking = false;
  session.axis = null;
  session.velocity = 0;

  animate(roleSwipeX, 0, {
   ...IOS_CONSOLE_SMOOTH_MOTION.cancelSpring,
   velocity:
    direction *
    Math.min(
     releaseVelocity * 1000,
     window.innerWidth * IOS_CONSOLE_SMOOTH_MOTION.cancelVelocityScreensPerSecond,
    ),
   onComplete: clearRoleSwipePreview,
  });
 }, [clearRoleSwipePreview, roleSwipeX]);

 const shouldIgnoreRoleSwipe = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('input, textarea, select, [contenteditable="true"], [data-role-filter-swipe-ignore="true"]')) return true;
  const button = target.closest("button");
  return Boolean(button && !button.hasAttribute("data-role-filter-tab"));
 };

 const handleRoleSwipeStart = (event: React.TouchEvent<HTMLDivElement>) => {
  if (event.touches.length !== 1 || roleSwipeAnimatingRef.current || shouldIgnoreRoleSwipe(event.target)) return;
  const touch = event.touches[0];
  roleSwipeX.stop();
  roleSwipeX.set(0);
  setRoleSwipePreview(null);
  roleSwipeSessionRef.current = {
   tracking: true,
   axis: null,
   startX: touch.clientX,
   startY: touch.clientY,
   lastX: touch.clientX,
   lastTime: performance.now(),
   velocity: 0,
  };
 };

 const handleRoleSwipeMove = (event: React.TouchEvent<HTMLDivElement>) => {
  const session = roleSwipeSessionRef.current;
  if (!session.tracking || event.touches.length !== 1) return;

  const touch = event.touches[0];
  const dx = touch.clientX - session.startX;
  const dy = touch.clientY - session.startY;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (session.axis === null) {
   if (absY >= IOS_CONSOLE_SMOOTH_MOTION.verticalRejectDistance && absY > absX * IOS_CONSOLE_SMOOTH_MOTION.verticalRejectRatio) {
    session.tracking = false;
    session.axis = "y";
    return;
   }
   if (absX < IOS_CONSOLE_SMOOTH_MOTION.axisLockDistance) return;
   if (absY > absX * IOS_CONSOLE_SMOOTH_MOTION.horizontalLockMaxVerticalRatio) return;
   session.axis = "x";
  }
  if (session.axis !== "x") return;
  if (event.cancelable) event.preventDefault();

  const now = performance.now();
  const dt = Math.max(1, now - session.lastTime);
  const instantVelocity = Math.abs(touch.clientX - session.lastX) / dt;
  session.velocity =
   session.velocity * IOS_CONSOLE_SMOOTH_MOTION.velocityPreviousWeight +
   instantVelocity * IOS_CONSOLE_SMOOTH_MOTION.velocityCurrentWeight;
  session.lastX = touch.clientX;
  session.lastTime = now;

  const currentIndex = ROLE_FILTER_ORDER.indexOf(roleFilter);
  const forward = isRtl ? dx > 0 : dx < 0;
  const nextIndex = currentIndex + (forward ? 1 : -1);
  const atBoundary = nextIndex < 0 || nextIndex >= ROLE_FILTER_ORDER.length;

  if (atBoundary) {
   setRoleSwipePreview(null);
   roleSwipeX.set(dx * IOS_CONSOLE_SMOOTH_MOTION.boundaryResistance);
   return;
  }

  setRoleSwipePreview(ROLE_FILTER_ORDER[nextIndex]);
  // This is an iOS segmented-content swipe, not a pushed page. Keep the list
  // attached to the finger while limiting travel so the card never exposes a gap.
  const rendered = Math.max(
   -IOS_CONSOLE_SMOOTH_MOTION.roleDragMax,
   Math.min(
    IOS_CONSOLE_SMOOTH_MOTION.roleDragMax,
    dx * IOS_CONSOLE_SMOOTH_MOTION.roleDragFactor,
   ),
  );
  roleSwipeX.set(rendered);
 };

 const handleRoleSwipeEnd = (event: React.TouchEvent<HTMLDivElement>) => {
  const session = roleSwipeSessionRef.current;
  if (!session.tracking) return;
  session.tracking = false;

  const touch = event.changedTouches[0];
  if (!touch || session.axis !== "x") {
   settleRoleSwipe();
   return;
  }

  const dx = touch.clientX - session.startX;
  const currentIndex = ROLE_FILTER_ORDER.indexOf(roleFilter);
  const forward = isRtl ? dx > 0 : dx < 0;
  const nextIndex = currentIndex + (forward ? 1 : -1);
  const qualifies =
   Math.abs(dx) >= 44 ||
   (Math.abs(dx) >= 24 && session.velocity >= IOS_CONSOLE_SMOOTH_MOTION.velocityThreshold);

  if (!qualifies || nextIndex < 0 || nextIndex >= ROLE_FILTER_ORDER.length) {
   settleRoleSwipe();
   return;
  }

  const nextFilter = ROLE_FILTER_ORDER[nextIndex];
  const physicalSign: 1 | -1 = dx >= 0 ? 1 : -1;
  roleSwipeAnimatingRef.current = true;

  // One-frame content handoff: the filter state and the 22px incoming offset
  // are committed before the browser paints, then the new list settles home.
  flushSync(() => {
   setRoleFilter(nextFilter);
   setRoleSwipePreview(null);
  });
  roleSwipeX.set(-physicalSign * IOS_CONSOLE_SMOOTH_MOTION.underlayOffset);
  animate(roleSwipeX, 0, {
   ...IOS_CONSOLE_SMOOTH_MOTION.completionSpring,
   velocity:
    -physicalSign * Math.min(session.velocity * 1000, window.innerWidth * IOS_CONSOLE_SMOOTH_MOTION.completionVelocityScreensPerSecond),
   onComplete: () => {
    roleSwipeAnimatingRef.current = false;
   },
  });
 };

 const handleRoleSwipeCancel = () => {
  roleSwipeAnimatingRef.current = false;
  settleRoleSwipe();
 };

 const selectRoleFilter = (nextFilter: RoleFilterId) => {
  if (nextFilter === roleFilter || roleSwipeAnimatingRef.current) return;
  const currentIndex = ROLE_FILTER_ORDER.indexOf(roleFilter);
  const nextIndex = ROLE_FILTER_ORDER.indexOf(nextFilter);
  const logicalForward = nextIndex > currentIndex;
  const physicalSign: 1 | -1 = logicalForward
   ? (isRtl ? 1 : -1)
   : (isRtl ? -1 : 1);

  roleSwipeAnimatingRef.current = true;
  flushSync(() => {
   setRoleFilter(nextFilter);
   setRoleSwipePreview(null);
  });
  roleSwipeX.set(-physicalSign * IOS_CONSOLE_SMOOTH_MOTION.underlayOffset);
  animate(roleSwipeX, 0, {
   ...IOS_CONSOLE_SMOOTH_MOTION.completionSpring,
   onComplete: () => {
    roleSwipeAnimatingRef.current = false;
   },
  });
 };

 if (currentUser.role !== "owner") {
 return (
 <div className="p-6 text-center text-med-error bg-red-50 dark:bg-red-950/20 rounded-md border border-red-100 dark:border-red-950 font-display">
 {isRtl
 ? "عذراً، هذه اللوحة مخصصة للمالك فقط."
 : "Access restricted. This panel is strictly for the Academic Owner."}
 </div>
 );
 }

 const roleFilters = [
 { id: "all", label: isRtl ? "الكل" : "All" },
 { id: "owner", label: isRtl ? "المالك" : "Owner" },
 { id: "admin", label: isRtl ? "مشرف" : "Admin" },
 { id: "user", label: isRtl ? "طالب" : "Student" },
 ];

 return (
 <div
  className="space-y-4 overflow-x-hidden"
  id="user_role_management_view"
  data-role-filter-swipe="true"
  style={{ touchAction: "pan-y" }}
  onTouchStart={handleRoleSwipeStart}
  onTouchMove={handleRoleSwipeMove}
  onTouchEnd={handleRoleSwipeEnd}
  onTouchCancel={handleRoleSwipeCancel}
 >
 <div className="flex flex-col gap-4">
 <h3 className="text-headline font-display font-semibold text-neutral-800 dark:text-white flex items-center gap-2">
 <ShieldAlert className="w-icon-md h-icon-md text-rose-500" />
  <span>
  {isRtl ? "إدارة الرتب والصلاحيات" : "User Role Management"}
  </span>
  {isPrimaryOwner && (
  <span className="text-[10px] font-semibold uppercase tracking-wide bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-500/30 px-2 py-1 rounded-full">
  PRIMARY OWNER
  </span>
  )}
  </h3>

 {/* Header Section: Filters + Search */}
 <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
 {/* Filters (Left) */}
 <div className="flex items-center gap-4 border-b border-black/5 dark:border-white/[0.12] w-full md:w-auto overflow-x-auto no-scrollbar overscroll-x-contain">
 {roleFilters.map((filter) => (
 <button
 key={filter.id}
 data-role-filter-tab
 onClick={() => selectRoleFilter(filter.id as RoleFilterId)}
 className={`pb-2 text-sm font-medium transition-colors whitespace-nowrap relative ${
 (roleSwipePreview ?? roleFilter) === filter.id
 ? "text-neutral-900 dark:text-white"
 : "text-neutral-500 dark:text-[#EBEBF599] hover:text-neutral-700 dark:hover:text-neutral-500 dark:text-[#EBEBF599]"
 }`}
 >
 {filter.label}
 {(roleSwipePreview ?? roleFilter) === filter.id && (
 <div className="absolute bottom-0 left-0 right-0 h-1 bg-neutral-900 dark:bg-white rounded-t-full" />
 )}
 </button>
 ))}
 </div>

 {/* Search Bar (Right) */}
 <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
 <div className="relative flex items-center w-full md:w-[260px]">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-icon-sm h-icon-sm text-neutral-500 dark:text-[#EBEBF599] pointer-events-none" />
 <input aria-label="Input field"
 type="text"
 placeholder={isRtl ? "بحث..." : "Search users..."}
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 style={{ paddingLeft: "36px" }}
 className="w-full pr-4 py-2 bg-black/5 dark:bg-[rgba(255,255,255,0.05)] rounded-lg border border-black/10 dark:border-[rgba(255,255,255,0.1)] focus:border-black/20 dark:focus:border-[rgba(255,255,255,0.3)] focus:ring-1 focus:ring-black/10 dark:focus:ring-[rgba(255,255,255,0.1)] outline-none transition text-sm text-neutral-800 dark:text-white placeholder:text-neutral-500 dark:text-[#EBEBF599]"
 />
 </div>
 <button
 onClick={() => void fetchUsers(true)}
 className="p-2 rounded-lg bg-black/5 hover:bg-black/10 text-neutral-500 hover:text-neutral-800 dark:bg-[rgba(255,255,255,0.05)] dark:hover:bg-[rgba(255,255,255,0.1)] dark:hover:text-white transition-colors border border-black/10 dark:border-[rgba(255,255,255,0.1)] shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
 title="Refresh List"
 >
 {loading ? (
 <Loader2 className="w-icon-sm h-icon-sm animate-spin text-rose-500" />
 ) : (
 <ArrowLeftRight className="w-icon-sm h-icon-sm" />
 )}
 </button>
 </div>
 </div>
 </div>

 {/* Notifications */}
 {successMessage && (
 <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 rounded-lg flex items-center gap-3 text-emerald-800 dark:text-emerald-400 text-caption font-medium animate-fadeIn">
 <Check className="w-icon-sm h-icon-sm shrink-0 text-emerald-600" />
 <span className="flex-1">{successMessage}</span>
 <button
 onClick={() => setSuccessMessage(null)}
 className="text-emerald-400 hover:text-emerald-600 font-semibold ml-2"
 >
 ×
 </button>
 </div>
 )}

 <FormError message={errorMessage} onDismiss={() => setErrorMessage(null)} />

 {/* Data Presentation (List View) */}
 <motion.div
  className="will-change-transform"
  style={{
   x: roleSwipeX,
   backfaceVisibility: "hidden",
   WebkitBackfaceVisibility: "hidden",
  }}
 >
 {loading && users.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-12 space-y-2">
 <Loader2 className="w-icon-xl h-icon-xl text-rose-500 animate-spin" />
 <p className="text-sm text-neutral-500 dark:text-[#EBEBF599]">
 {isRtl ? "جاري التحميل..." : "Loading users..."}
 </p>
 </div>
 ) : filteredUsers.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-12 px-6 text-center w-full border border-dashed border-neutral-200 dark:border-white/[0.12] rounded-lg bg-neutral-50/50 dark:bg-transparent">
 <div className="w-12 h-12 rounded-full bg-neutral-100 dark:bg-[#2C2C2E]/80 flex items-center justify-center mb-3">
 <Search className="w-icon-md h-icon-md text-neutral-500 dark:text-[#EBEBF599]" />
 </div>
 <h3 className="text-sm font-semibold text-neutral-900 dark:text-white mb-1">
 {isRtl ? "لا توجد نتائج" : "No Users Found"}
 </h3>
 <p className="text-sm text-neutral-500">
 {isRtl ? "لم يتم العثور على نتائج." : "No matching records."}
 </p>
 </div>
 ) : (
 <div className="flex flex-col rounded-lg bg-white dark:bg-[#1C1C1E] border border-neutral-200/50 dark:border-[rgba(255,255,255,0.05)] overflow-hidden">
  {filteredUsers.map((user, index) => {
   const isSelf = user.id === currentUser.id;
  const canChangeToStudent = canManageRole(user, "user");
  const canChangeToAdmin = canManageRole(user, "admin");
  const isLast = index === filteredUsers.length - 1;

 return (
 <div
 key={user.id}
 className={`group flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 sm:p-[12px_16px] transition-colors hover:bg-neutral-50 dark:hover:bg-[var(--bg-surface-2)] ${
 !isLast ? "border-b border-white/5 dark:border-[rgba(255,255,255,0.05)]" : ""
 }`}
 style={{ direction: isRtl ? "rtl" : "ltr" }}
 >
 {/* Left: Avatar + Name + Email */}
 <div className="flex items-center gap-3 sm:w-1/3 sm:min-w-[200px] min-w-0 flex-1">
<div className="relative shrink-0">
                        <UserAvatar
                          name={user.name || user.email}
                          avatarUrl={user.avatarUrl || user.avatar}
                          className="w-10 h-10 border border-neutral-200 dark:border-[rgba(255,255,255,0.1)]"
                        />
 {/* Online status indicator */}
 <span
 className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white dark:border-neutral-900 flex items-center justify-center`}
 >
 <span
 className={`w-2 h-2 rounded-full ${user.isOnline ? "bg-emerald-500 animate-pulse" : "bg-neutral-400 dark:bg-neutral-600"}`}
 />
 </span>
 </div>
 <div className="flex flex-col min-w-0 flex-1">
 <div className="text-sm font-semibold text-[var(--text-primary)] truncate flex items-center gap-2">
 {user.name}
 {isSelf && (
 <span className="text-caption-2 bg-neutral-200 dark:bg-white/[0.12] text-neutral-600 dark:text-[#EBEBF599] px-2 py-1 rounded-sm font-mono uppercase">
 {isRtl ? "أنت" : "You"}
 </span>
 )}
 </div>
 <div className="text-xs text-[var(--text-muted)] truncate mt-1 font-mono">
 {user.email}
 </div>
 </div>
 {/* Mobile role badge — inline with name, hidden on sm+ */}
 <div className="sm:hidden shrink-0 ml-auto">
 {user.role === "owner" ? (
 <div className="flex items-center gap-1 bg-amber-50 dark:bg-med-gold/10 px-2 py-0.5 rounded-full border border-amber-100 dark:border-amber-500/20">
 <span className="w-1.5 h-1.5 rounded-full bg-med-gold"></span>
  <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400 uppercase">{user.isPrimaryOwner ? "Primary Owner" : "Owner"}</span>
 </div>
 ) : user.role === "admin" ? (
 <div className="flex items-center gap-1 bg-purple-50 dark:bg-purple-500/10 px-2 py-0.5 rounded-full border border-purple-100 dark:border-purple-500/20">
 <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
 <span className="text-[10px] font-medium text-purple-700 dark:text-purple-400 uppercase">Admin</span>
 </div>
 ) : (
 <div className="flex items-center gap-1 bg-blue-50 dark:bg-med-blue/10 px-2 py-0.5 rounded-full border border-blue-100 dark:border-blue-500/20">
 <span className="w-1.5 h-1.5 rounded-full bg-med-blue"></span>
 <span className="text-[10px] font-medium text-blue-700 dark:text-blue-400 uppercase">Student</span>
 </div>
 )}
 </div>
 </div>

 {/* Center: Role Pill — desktop only; mobile shows it inline */}
 <div className="hidden sm:flex flex-1 justify-center min-w-[100px]">
 {user.role === "owner" ? (
 <div className="flex items-center gap-2 bg-amber-50 dark:bg-med-gold/10 px-3 py-1 rounded-full border border-amber-100 dark:border-amber-500/20">
 <span className="w-2 h-2 rounded-full bg-med-gold"></span>
 <span className="text-xs font-medium text-amber-700 dark:text-amber-400 uppercase">
  {user.isPrimaryOwner ? "Primary Owner" : "Owner"}
 </span>
 </div>
 ) : user.role === "admin" ? (
 <div className="flex items-center gap-2 bg-purple-50 dark:bg-purple-500/10 px-3 py-1 rounded-full border border-purple-100 dark:border-purple-500/20">
 <span className="w-2 h-2 rounded-full bg-purple-500"></span>
 <span className="text-xs font-medium text-purple-700 dark:text-purple-400 uppercase">
 Admin
 </span>
 </div>
 ) : (
 <div className="flex items-center gap-2 bg-blue-50 dark:bg-med-blue/10 px-3 py-1 rounded-full border border-blue-100 dark:border-blue-500/20">
 <span className="w-2 h-2 rounded-full bg-med-blue"></span>
 <span className="text-xs font-medium text-blue-700 dark:text-blue-400 uppercase">
 Student
 </span>
 </div>
 )}
 </div>

 {/* Right/Bottom: Action Buttons */}
 <div className="flex sm:w-1/3 sm:justify-end sm:min-w-[150px] justify-start flex-wrap gap-1">
  {isSelf ? (
 // Cannot change own role
 <span className="text-xs text-neutral-500 dark:text-[#EBEBF599] font-mono italic opacity-60">
 {isRtl ? "حسابك" : "Your account"}
 </span>
 ) : (
 <div className="flex items-center gap-2 justify-end">
 {updatingUserId === user.id ? (
 <div className="flex justify-center items-center px-4 py-1">
 <Loader2 className="w-icon-sm h-icon-sm animate-spin text-neutral-500" />
 </div>
 ) : (
 <>
  <button
  onClick={() => handleRoleChange(user.id, user.email, "user")}
  disabled={!canChangeToStudent || user.role === "user"}
  className={`px-3 py-1 rounded-md text-xs font-semibold uppercase transition border ${!canChangeToStudent || user.role === "user" ? "bg-blue-50 dark:bg-med-blue/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/30 opacity-50 cursor-not-allowed" : "bg-neutral-50 dark:bg-[#2C2C2E]/80 text-neutral-600 dark:text-[#EBEBF599] border-neutral-200 dark:border-white/[0.15] hover:bg-blue-50 hover:border-blue-200 dark:hover:bg-med-blue/10 dark:hover:border-blue-500/30 hover:text-med-blue dark:hover:text-blue-400"}`}
 >
 {isRtl ? "طالب" : "Student"}
 </button>
  <button
  onClick={() => handleRoleChange(user.id, user.email, "admin")}
  disabled={!canChangeToAdmin || user.role === "admin"}
  className={`px-3 py-1 rounded-md text-xs font-semibold uppercase transition border ${!canChangeToAdmin || user.role === "admin" ? "bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-500/30 opacity-50 cursor-not-allowed" : "bg-neutral-50 dark:bg-[#2C2C2E]/80 text-neutral-600 dark:text-[#EBEBF599] border-neutral-200 dark:border-white/[0.15] hover:bg-purple-50 hover:border-purple-200 dark:hover:bg-purple-500/10 dark:hover:border-purple-500/30 hover:text-purple-600 dark:hover:text-purple-400"}`}
 >
  {isRtl ? "مشرف" : "Admin"}
  </button>
  {isPrimaryOwner && (
  <button
  onClick={() => handleRoleChange(user.id, user.email, "owner")}
  disabled={user.role === "owner"}
  className={`px-3 py-1 rounded-md text-xs font-semibold uppercase transition border ${user.role === "owner" ? "bg-amber-50 dark:bg-med-gold/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30 opacity-50 cursor-not-allowed" : "bg-neutral-50 dark:bg-[#2C2C2E]/80 text-neutral-600 dark:text-[#EBEBF599] border-neutral-200 dark:border-white/[0.15] hover:bg-amber-50 hover:border-amber-200 dark:hover:bg-med-gold/10 dark:hover:border-amber-500/30 hover:text-amber-700 dark:hover:text-amber-400"}`}
  >
  {isRtl ? "مالك" : "Owner"}
  </button>
  )}
  </>
 )}
 </div>
 )}
 </div>
 </div>
 );
 })}
 </div>
 )}
 </motion.div>
 </div>
 );
}
