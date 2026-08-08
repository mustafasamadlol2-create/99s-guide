import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect, Suspense, memo, lazy } from "react";
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
 isOnline: boolean;
}

export default function UserRoleManagement({
 currentUser,
 language,
}: UserRoleManagementProps) {
 const isRtl = language === "ar";

 // Protected accounts whose roles can never be changed by anyone
 const PROTECTED_OWNER_EMAILS = [
   "mostafa.yasir24001@comed.uobaghdad.edu.iq",
 ];

 // Whether the currently logged-in user has Primary Owner privileges
 const isCurrentUserPrimaryOwner = PROTECTED_OWNER_EMAILS.includes(
   (currentUser.email ?? "").toLowerCase().trim()
 );

 const [users, setUsers] = useState<FetchedUser[]>([]);
 const [loading, setLoading] = useState(true);
 const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
 const [searchQuery, setSearchQuery] = useState("");
 const [roleFilter, setRoleFilter] = useState("all");
 const [successMessage, setSuccessMessage] = useState<string | null>(null);
 const [errorMessage, setErrorMessage] = useState<string | null>(null);
 const [disciplinaryUser, setDisciplinaryUser] = useState<FetchedUser | null>(null);

 const fetchUsers = async () => {
 try {
 setLoading(true);
 const response = await apiClient("/api/users");
 if (!response.ok) {
 throw new Error("Failed to fetch users");
 }
 const data = await response.json();
 if (Array.isArray(data)) {
 setUsers(data);
 }
 } catch (err: any) {
 
 setErrorMessage(
 isRtl ? "فشل تحميل قائمة المستخدمين." : "Failed to load user records.",
 );
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 fetchUsers();
 
    const handleFocus = () => fetchUsers();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") handleFocus();
    };
    window.addEventListener("focus", handleFocus);
    window.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("visibilitychange", handleVisibility);
    };
 }, []);

 const handleRoleChange = async (
 userId: string,
 targetUserEmail: string,
 newRole: string,
 ) => {
 // Block changes to protected accounts
 if (PROTECTED_OWNER_EMAILS.includes(targetUserEmail.toLowerCase().trim())) {
 const msg = isRtl
 ? "خطأ: غير مسموح بتعديل صلاحيات هذا الحساب المحمي."
 : "Error: This protected account's role cannot be modified.";
 setErrorMessage(msg);
 setSuccessMessage(null);
 return;
 }

 // Block self-role-change
 if (userId === currentUser.id) {
 setErrorMessage(isRtl ? "لا يمكنك تغيير دورك الخاص." : "You cannot change your own role.");
 setSuccessMessage(null);
 return;
 }

 // Regular Owner: cannot modify other owners or promote to owner
 if (!isCurrentUserPrimaryOwner) {
 const targetInList = users.find((u) => u.id === userId);
 if (targetInList?.role === "owner") {
 setErrorMessage(isRtl ? "لا يمكنك تعديل صلاحيات مالك آخر." : "You cannot modify another Owner's role.");
 setSuccessMessage(null);
 return;
 }
 if (newRole === "owner") {
 setErrorMessage(isRtl ? "لا يمكنك ترقية المستخدمين إلى مالك." : "You cannot promote users to the Owner role.");
 setSuccessMessage(null);
 return;
 }
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
 <div className="space-y-4" id="user_role_management_view">
 <div className="flex flex-col gap-4">
 <h3 className="text-headline font-display font-semibold text-neutral-800 dark:text-white flex items-center gap-2">
 <ShieldAlert className="w-icon-md h-icon-md text-rose-500" />
 <span>
 {isRtl ? "إدارة الرتب والصلاحيات" : "User Role Management"}
 </span>
 </h3>

 {/* Header Section: Filters + Search */}
 <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
 {/* Filters (Left) */}
 <div className="flex items-center gap-4 border-b border-black/5 dark:border-white/[0.12] w-full md:w-auto overflow-x-auto no-scrollbar overscroll-x-contain">
 {roleFilters.map((filter) => (
 <button
 key={filter.id}
 onClick={() => setRoleFilter(filter.id)}
 className={`pb-2 text-sm font-medium transition-colors whitespace-nowrap relative ${
 roleFilter === filter.id
 ? "text-neutral-900 dark:text-white"
 : "text-neutral-500 dark:text-[#EBEBF599] hover:text-neutral-700 dark:hover:text-neutral-500 dark:text-[#EBEBF599]"
 }`}
 >
 {filter.label}
 {roleFilter === filter.id && (
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
 onClick={fetchUsers}
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
 const isPrimaryOwner = PROTECTED_OWNER_EMAILS.includes(user.email.toLowerCase().trim());
 const isSelf = user.id === currentUser.id;
 // A regular Owner cannot touch another Owner row (Primary Owner can touch all)
 const isUntouchableOwner = !isCurrentUserPrimaryOwner && user.role === "owner" && !isPrimaryOwner;
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
 <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400 uppercase">Owner</span>
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
 Owner
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
 {isPrimaryOwner ? (
 // Protected Primary Owner accounts — no actions ever
 <span className="text-xs text-neutral-500 dark:text-[#EBEBF599] font-mono italic opacity-60">
 Primary Owner
 </span>
 ) : isSelf ? (
 // Cannot change own role
 <span className="text-xs text-neutral-500 dark:text-[#EBEBF599] font-mono italic opacity-60">
 {isRtl ? "حسابك" : "Your account"}
 </span>
 ) : isUntouchableOwner ? (
 // Regular Owner cannot modify another Owner
 <span className="text-xs text-neutral-500 dark:text-[#EBEBF599] font-mono italic opacity-60">
 {isRtl ? "مالك (محمي)" : "Owner (protected)"}
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
 disabled={user.role === "user"}
 className={`px-3 py-1 rounded-md text-xs font-semibold uppercase transition border ${user.role === "user" ? "bg-blue-50 dark:bg-med-blue/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/30 opacity-50 cursor-not-allowed" : "bg-neutral-50 dark:bg-[#2C2C2E]/80 text-neutral-600 dark:text-[#EBEBF599] border-neutral-200 dark:border-white/[0.15] hover:bg-blue-50 hover:border-blue-200 dark:hover:bg-med-blue/10 dark:hover:border-blue-500/30 hover:text-med-blue dark:hover:text-blue-400"}`}
 >
 {isRtl ? "طالب" : "Student"}
 </button>
 <button
 onClick={() => handleRoleChange(user.id, user.email, "admin")}
 disabled={user.role === "admin"}
 className={`px-3 py-1 rounded-md text-xs font-semibold uppercase transition border ${user.role === "admin" ? "bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-500/30 opacity-50 cursor-not-allowed" : "bg-neutral-50 dark:bg-[#2C2C2E]/80 text-neutral-600 dark:text-[#EBEBF599] border-neutral-200 dark:border-white/[0.15] hover:bg-purple-50 hover:border-purple-200 dark:hover:bg-purple-500/10 dark:hover:border-purple-500/30 hover:text-purple-600 dark:hover:text-purple-400"}`}
 >
 {isRtl ? "مشرف" : "Admin"}
 </button>
 {/* Owner button: only Primary Owner can promote/demote to owner */}
 {isCurrentUserPrimaryOwner && (
 <button
 onClick={() => handleRoleChange(user.id, user.email, "owner")}
 disabled={user.role === "owner"}
 className={`px-3 py-1 rounded-md text-xs font-semibold uppercase transition border ${user.role === "owner" ? "bg-amber-50 dark:bg-med-gold/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30 opacity-50 cursor-not-allowed" : "bg-neutral-50 dark:bg-[#2C2C2E]/80 text-neutral-600 dark:text-[#EBEBF599] border-neutral-200 dark:border-white/[0.15] hover:bg-amber-50 hover:border-amber-200 dark:hover:bg-med-gold/10 dark:hover:border-amber-500/30 hover:text-med-gold dark:hover:text-amber-400"}`}
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
 </div>
 );
}
