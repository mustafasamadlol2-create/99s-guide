/**
 * ModerationHistoryView — full audit log of every moderation action.
 * Professional data table with search, filters, pagination, detail panel, and CSV export.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Search, Filter, X, ChevronLeft, ChevronRight, Download,
  ShieldOff, MicOff, Flag, Trash2, CheckCircle, XCircle,
  Clock, Infinity as InfinityIcon, RefreshCw, Eye, User as UserIcon, Shield,
  AlertTriangle, FileText, Calendar, ChevronDown, Bot,
  ArrowUpCircle, ArrowDownCircle,
} from "lucide-react";
// exceljs is loaded on demand — only imported when the admin clicks "Excel export"
import { apiClient } from "../../../core/api/apiClient";
import { UserAvatar } from "../../profile/components/UserAvatar";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  avatar?: string;
}

const SYSTEM_ADMIN: AdminUser = { id: "system", name: "System", email: "auto@system" };

interface HistoryRecord {
  id: string;
  actionType: string;
  adminId: string | null;
  targetUserId: string | null;
  commentId: string | null;
  questionId: string | null;
  answerId: string | null;
  replyId: string | null;
  lectureId: string | null;
  reportId: string | null;
  reason: string | null;
  notes: string | null;
  oldStatus: string | null;
  newStatus: string | null;
  duration: number | null;
  isPermanent: boolean;
  isSystemAction: boolean;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  metadata: Record<string, any> | null;
  admin: AdminUser | null;
  targetUser: AdminUser | null;
}

interface PaginatedResponse {
  records: HistoryRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface Filters {
  search: string;
  actionType: string;
  adminId: string;
  targetUserId: string;
  startDate: string;
  endDate: string;
  isPermanent: boolean;
  activeOnly: boolean;
  expiredOnly: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  APPROVE_REPORT:  "Approve Report",
  REJECT_REPORT:   "Reject Report",
  DELETE_QUESTION: "Delete Question",
  DELETE_ANSWER:   "Delete Answer",
  DELETE_REPLY:    "Delete Reply",
  MUTE_USER:       "Mute User",
  REMOVE_MUTE:     "Remove Mute",
  UPDATE_MUTE:     "Update Mute",
  EXTEND_MUTE:     "Extend Mute",
  REDUCE_MUTE:     "Reduce Mute",
  PERMANENT_MUTE:  "Permanent Mute",
  BAN_USER:        "Ban User",
  REMOVE_BAN:      "Remove Ban",
  UPDATE_BAN:      "Update Ban",
  EXTEND_BAN:      "Extend Ban",
  REDUCE_BAN:      "Reduce Ban",
  PERMANENT_BAN:   "Permanent Ban",
  MUTE_EXPIRED:    "Mute Expired",
  BAN_EXPIRED:     "Ban Expired",
};

const ACTION_COLORS: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  APPROVE_REPORT:  { bg: "bg-emerald-50 dark:bg-emerald-500/10",   text: "text-emerald-700 dark:text-emerald-400", icon: CheckCircle },
  REJECT_REPORT:   { bg: "bg-neutral-100 dark:bg-white/[0.06]",    text: "text-neutral-600 dark:text-neutral-400", icon: XCircle },
  DELETE_QUESTION: { bg: "bg-rose-50 dark:bg-rose-500/10",         text: "text-rose-700 dark:text-rose-400",       icon: Trash2 },
  DELETE_ANSWER:   { bg: "bg-rose-50 dark:bg-rose-500/10",         text: "text-rose-700 dark:text-rose-400",       icon: Trash2 },
  DELETE_REPLY:    { bg: "bg-rose-50 dark:bg-rose-500/10",         text: "text-rose-700 dark:text-rose-400",       icon: Trash2 },
  MUTE_USER:       { bg: "bg-amber-50 dark:bg-amber-500/10",       text: "text-amber-700 dark:text-amber-400",     icon: MicOff },
  REMOVE_MUTE:     { bg: "bg-sky-50 dark:bg-sky-500/10",           text: "text-sky-700 dark:text-sky-400",         icon: MicOff },
  UPDATE_MUTE:     { bg: "bg-amber-50 dark:bg-amber-500/10",       text: "text-amber-700 dark:text-amber-400",     icon: MicOff },
  EXTEND_MUTE:     { bg: "bg-orange-50 dark:bg-orange-500/10",     text: "text-orange-700 dark:text-orange-400",   icon: ArrowUpCircle },
  REDUCE_MUTE:     { bg: "bg-sky-50 dark:bg-sky-500/10",           text: "text-sky-600 dark:text-sky-400",         icon: ArrowDownCircle },
  PERMANENT_MUTE:  { bg: "bg-orange-50 dark:bg-orange-500/10",     text: "text-orange-700 dark:text-orange-400",   icon: MicOff },
  BAN_USER:        { bg: "bg-red-50 dark:bg-red-500/10",           text: "text-red-700 dark:text-red-400",         icon: ShieldOff },
  REMOVE_BAN:      { bg: "bg-sky-50 dark:bg-sky-500/10",           text: "text-sky-700 dark:text-sky-400",         icon: Shield },
  UPDATE_BAN:      { bg: "bg-red-50 dark:bg-red-500/10",           text: "text-red-700 dark:text-red-400",         icon: ShieldOff },
  EXTEND_BAN:      { bg: "bg-red-100 dark:bg-red-500/15",          text: "text-red-800 dark:text-red-300",         icon: ArrowUpCircle },
  REDUCE_BAN:      { bg: "bg-sky-50 dark:bg-sky-500/10",           text: "text-sky-600 dark:text-sky-400",         icon: ArrowDownCircle },
  PERMANENT_BAN:   { bg: "bg-red-100 dark:bg-red-500/15",          text: "text-red-800 dark:text-red-300",         icon: ShieldOff },
  MUTE_EXPIRED:    { bg: "bg-neutral-100 dark:bg-white/[0.06]",    text: "text-neutral-500 dark:text-neutral-400", icon: Clock },
  BAN_EXPIRED:     { bg: "bg-neutral-100 dark:bg-white/[0.06]",    text: "text-neutral-500 dark:text-neutral-400", icon: Clock },
};

const ALL_ACTION_TYPES = Object.keys(ACTION_LABELS);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(minutes: number | null, isPermanent: boolean): string {
  if (isPermanent) return "Permanent";
  if (!minutes) return "—";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  if (minutes < 10080) return `${Math.round(minutes / 1440)}d`;
  return `${Math.round(minutes / 10080)}w`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function getActionStyle(actionType: string) {
  return ACTION_COLORS[actionType] ?? {
    bg: "bg-neutral-100 dark:bg-white/[0.06]",
    text: "text-neutral-600 dark:text-neutral-400",
    icon: Flag,
  };
}

function computeCurrentStatus(record: HistoryRecord): { label: string; color: string } {
  const now = new Date();
  const isRemoval = record.actionType === "REMOVE_MUTE" || record.actionType === "REMOVE_BAN";
  const isExpiry  = record.actionType === "MUTE_EXPIRED" || record.actionType === "BAN_EXPIRED";

  if (isRemoval || isExpiry) return { label: "Lifted", color: "text-sky-600 dark:text-sky-400" };

  if (record.isPermanent) return { label: "Permanent", color: "text-red-600 dark:text-red-400" };

  if (record.expiresAt) {
    const expires = new Date(record.expiresAt);
    if (expires < now) return { label: "Expired", color: "text-neutral-500 dark:text-neutral-400" };
    return { label: "Active", color: "text-emerald-600 dark:text-emerald-400" };
  }

  const neutralTypes = ["APPROVE_REPORT","REJECT_REPORT","DELETE_QUESTION","DELETE_ANSWER"];
  if (neutralTypes.includes(record.actionType)) return { label: "Completed", color: "text-neutral-500 dark:text-neutral-400" };

  return { label: "Active", color: "text-emerald-600 dark:text-emerald-400" };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const ActionBadge: React.FC<{ actionType: string }> = ({ actionType }) => {
  const style = getActionStyle(actionType);
  const Icon = style.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap ${style.bg} ${style.text}`}>
      <Icon className="w-3 h-3 shrink-0" />
      {ACTION_LABELS[actionType] ?? actionType}
    </span>
  );
};

const UserCell: React.FC<{ user: AdminUser | null; empty?: string; isSystem?: boolean }> = ({ user, empty = "—", isSystem }) => {
  if (!user && isSystem) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-7 h-7 rounded-full shrink-0 border border-neutral-200 dark:border-white/10 bg-neutral-100 dark:bg-white/[0.06] flex items-center justify-center">
          <Bot className="w-3.5 h-3.5 text-neutral-400" />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-neutral-600 dark:text-neutral-400 leading-tight">System</p>
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500">Auto</p>
        </div>
      </div>
    );
  }
  if (!user) return <span className="text-neutral-400 dark:text-neutral-600 text-[13px]">{empty}</span>;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <UserAvatar
        name={user.name}
        avatarUrl={user.avatarUrl || user.avatar || ""}
        className="w-7 h-7 rounded-full shrink-0 border border-neutral-200 dark:border-white/10"
      />
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-neutral-900 dark:text-white truncate leading-tight">{user.name || "Unknown"}</p>
        <p className="text-[11px] text-neutral-400 dark:text-neutral-500 truncate">{user.email}</p>
      </div>
    </div>
  );
};

// ─── Detail Panel ─────────────────────────────────────────────────────────────

const DetailPanel: React.FC<{ record: HistoryRecord | null; onClose: () => void }> = ({ record, onClose }) => {
  const status = record ? computeCurrentStatus(record) : null;
  return (
    <AnimatePresence>
      {record && (
        <>
          <motion.div
            key="dp-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 dark:bg-black/50 z-40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            key="dp-panel"
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            className="mobile-overlay-top fixed top-0 right-0 bottom-0 z-50 w-full max-w-lg bg-white dark:bg-[#1C1C1E] border-l border-neutral-200 dark:border-white/[0.08] shadow-2xl overflow-y-auto"
          >
            {/* Header */}
            <div className="sticky top-0 bg-white dark:bg-[#1C1C1E] border-b border-neutral-100 dark:border-white/[0.06] px-6 py-4 flex items-center justify-between z-10">
              <div>
                <h3 className="text-[15px] font-semibold text-neutral-900 dark:text-white">Action Detail</h3>
                <p className="text-[11px] text-neutral-400 dark:text-neutral-500 font-mono mt-0.5">{record.id}</p>
              </div>
              <button onClick={onClose} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/[0.08] text-neutral-400 transition-colors cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Action badge */}
              <div className="flex items-center gap-3 flex-wrap">
                <ActionBadge actionType={record.actionType} />
                {record.isPermanent && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-[10px] font-bold uppercase tracking-wider">
                    <InfinityIcon className="w-3 h-3" /> Permanent
                  </span>
                )}
                <span className={`text-[12px] font-semibold ${status?.color}`}>{status?.label}</span>
              </div>

              {/* People */}
              <Section title="Administrator">
                <UserCell user={record.admin} isSystem={record.isSystemAction && !record.admin} />
                {record.isSystemAction && (
                  <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold text-neutral-400 dark:text-neutral-500">
                    <Bot className="w-3 h-3" /> Auto-generated system event
                  </span>
                )}
              </Section>
              <Section title="Target User">
                <UserCell user={record.targetUser} empty="No target user" />
              </Section>

              {/* Timing */}
              <Section title="Timing">
                <div className="space-y-1.5">
                  <InfoRow icon={Calendar} label="Action Time" value={formatDateTime(record.createdAt)} />
                  {record.duration && <InfoRow icon={Clock} label="Duration" value={formatDuration(record.duration, record.isPermanent)} />}
                  {record.expiresAt && <InfoRow icon={Clock} label="Expires" value={formatDateTime(record.expiresAt)} />}
                  {record.revokedAt && <InfoRow icon={CheckCircle} label="Revoked" value={formatDateTime(record.revokedAt)} />}
                </div>
              </Section>

              {/* Reason */}
              {record.reason && (
                <Section title="Reason">
                  <p className="text-[13px] text-neutral-700 dark:text-neutral-200 leading-relaxed">{record.reason}</p>
                </Section>
              )}
              {record.notes && (
                <Section title="Notes">
                  <p className="text-[13px] text-neutral-700 dark:text-neutral-200 leading-relaxed">{record.notes}</p>
                </Section>
              )}

              {/* Status changes */}
              {(record.oldStatus || record.newStatus) && (
                <Section title="Status Change">
                  <div className="flex items-center gap-2 text-[13px]">
                    {record.oldStatus && <span className="px-2 py-0.5 bg-neutral-100 dark:bg-white/[0.06] rounded text-neutral-500 dark:text-neutral-400">{record.oldStatus}</span>}
                    {record.oldStatus && record.newStatus && <span className="text-neutral-400">→</span>}
                    {record.newStatus && <span className="px-2 py-0.5 bg-emerald-50 dark:bg-emerald-500/10 rounded text-emerald-700 dark:text-emerald-400 font-medium">{record.newStatus}</span>}
                  </div>
                </Section>
              )}

              {/* References */}
              <Section title="References">
                <div className="space-y-1.5">
                  {record.reportId  && <InfoRow icon={Flag}     label="Report ID"  value={record.reportId}  mono />}
                  {record.commentId && <InfoRow icon={FileText} label="Comment ID" value={record.commentId} mono />}
                  {record.lectureId && <InfoRow icon={UserIcon} label="Lecture ID" value={record.lectureId} mono />}
                </div>
              </Section>

              {/* Metadata */}
              {record.metadata && Object.keys(record.metadata).length > 0 && (
                <Section title="Metadata">
                  <pre className="text-[11px] text-neutral-600 dark:text-neutral-400 bg-neutral-50 dark:bg-white/[0.04] rounded-lg p-3 overflow-x-auto">
                    {JSON.stringify(record.metadata, null, 2)}
                  </pre>
                </Section>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="space-y-2">
    <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 dark:text-neutral-500">{title}</p>
    {children}
  </div>
);

const InfoRow: React.FC<{ icon: React.ElementType; label: string; value: string; mono?: boolean }> = ({ icon: Icon, label, value, mono }) => (
  <div className="flex items-center gap-2">
    <Icon className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
    <span className="text-[12px] text-neutral-500 dark:text-neutral-400 shrink-0">{label}:</span>
    <span className={`text-[12px] text-neutral-800 dark:text-neutral-200 truncate ${mono ? "font-mono" : ""}`}>{value}</span>
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

const ModerationHistoryView: React.FC = () => {
  const [records, setRecords]           = useState<HistoryRecord[]>([]);
  const [total, setTotal]               = useState(0);
  const [totalPages, setTotalPages]     = useState(1);
  const [page, setPage]                 = useState(1);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState("");
  const [selected, setSelected]         = useState<HistoryRecord | null>(null);
  const [showFilters, setShowFilters]   = useState(false);
  const [admins, setAdmins]             = useState<AdminUser[]>([]);
  const [filters, setFilters]           = useState<Filters>({
    search: "", actionType: "", adminId: "", targetUserId: "",
    startDate: "", endDate: "", isPermanent: false, activeOnly: false, expiredOnly: false,
  });
  const searchTimeout = useRef<NodeJS.Timeout | null>(null);
  const LIMIT = 25;

  const buildParams = (f: Filters, p: number, limit = LIMIT) => {
    const params = new URLSearchParams({ page: String(p), limit: String(limit) });
    if (f.search)       params.set("search", f.search);
    if (f.actionType)   params.set("actionType", f.actionType);
    if (f.adminId)      params.set("adminId", f.adminId);
    if (f.targetUserId) params.set("targetUserId", f.targetUserId);
    if (f.startDate)    params.set("startDate", f.startDate);
    if (f.endDate)      params.set("endDate", f.endDate);
    if (f.isPermanent)  params.set("isPermanent", "true");
    if (f.activeOnly)   params.set("activeOnly", "true");
    if (f.expiredOnly)  params.set("expiredOnly", "true");
    return params;
  };

  const fetchHistory = useCallback(async (f: Filters, p: number) => {
    setLoading(true);
    setError("");
    try {
      const params = buildParams(f, p);
      const res = await apiClient(`/api/moderation/history?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data: PaginatedResponse = await res.json();
      setRecords(data.records);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch {
      setError("Failed to load moderation history.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch admins for filter dropdown
  useEffect(() => {
    apiClient("/api/moderation/history/admins")
      .then(r => r.ok ? r.json() : [])
      .then(setAdmins)
      .catch(() => {});
  }, []);

  // Reload when page or filters change
  useEffect(() => { fetchHistory(filters, page); }, [page, filters, fetchHistory]);

  // Re-fetch from page 1 whenever the server signals a new moderation action
  useEffect(() => {
    const handler = () => { setPage(1); fetchHistory(filters, 1); };
    window.addEventListener("socket-moderation-history-updated", handler);
    return () => window.removeEventListener("socket-moderation-history-updated", handler);
  }, [fetchHistory, filters]);

  const handleSearchChange = (val: string) => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setPage(1);
      setFilters(f => ({ ...f, search: val }));
    }, 350);
  };

  const handleFilter = (key: keyof Filters, value: any) => {
    setPage(1);
    setFilters(f => ({ ...f, [key]: value }));
  };

  const clearFilters = () => {
    setPage(1);
    setFilters({ search: "", actionType: "", adminId: "", targetUserId: "", startDate: "", endDate: "", isPermanent: false, activeOnly: false, expiredOnly: false });
  };

  const hasActiveFilters = filters.search || filters.actionType || filters.adminId || filters.targetUserId || filters.startDate || filters.endDate || filters.isPermanent || filters.activeOnly || filters.expiredOnly;

  // ── Fetch all records for export ─────────────────────────────────────────────
  const fetchAllForExport = async (): Promise<HistoryRecord[]> => {
    const params = buildParams(filters, 1, 10000);
    const res = await apiClient(`/api/moderation/history?${params}`);
    const data: PaginatedResponse = await res.json();
    return data.records;
  };

  const makeExportRows = (recs: HistoryRecord[]) => {
    const headers = ["ID","Action","Target User","Target Email","Administrator","Admin Email","System Action","Reason","Notes","Duration (min)","Permanent","Created At","Expires At","Revoked At","Report ID","Comment ID","Old Status","New Status","Metadata"];
    const rows = recs.map(r => [
      r.id,
      ACTION_LABELS[r.actionType] ?? r.actionType,
      r.targetUser?.name ?? "",
      r.targetUser?.email ?? "",
      r.admin?.name ?? "System",
      r.admin?.email ?? "",
      r.isSystemAction ? "Yes" : "No",
      r.reason ?? "",
      r.notes ?? "",
      r.duration ?? "",
      r.isPermanent ? "Yes" : "No",
      r.createdAt,
      r.expiresAt ?? "",
      r.revokedAt ?? "",
      r.reportId ?? "",
      r.commentId ?? "",
      r.oldStatus ?? "",
      r.newStatus ?? "",
      r.metadata ? JSON.stringify(r.metadata) : "",
    ]);
    return { headers, rows };
  };

  // ── CSV Export ────────────────────────────────────────────────────────────────
  const exportCSV = async () => {
    try {
      const recs = await fetchAllForExport();
      const { headers, rows } = makeExportRows(recs);
      const csv = [headers, ...rows]
        .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
        .join("\r\n");
      const bom = "\uFEFF";
      const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `moderation-history-${new Date().toISOString().slice(0,10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } catch { /* silent */ }
  };

  // ── Excel Export ──────────────────────────────────────────────────────────────
  const exportExcel = async () => {
    try {
      // Dynamically import exceljs only when the admin actually clicks Export —
      // keeps the chunk lean for the common case where export is never used in a
      // session. exceljs replaced the vulnerable sheetjs `xlsx` package.
      const ExcelJS = await import("exceljs");
      const recs = await fetchAllForExport();
      const { headers, rows } = makeExportRows(recs);
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Moderation History");
      ws.addRows([headers, ...rows]);
      // Auto-width columns
      ws.columns.forEach((col, i) => {
        if (!col) return;
        col.width =
          Math.max(headers[i].length, ...rows.map(r => String(r[i] ?? "").length), 10) + 1;
      });
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `moderation-history-${new Date().toISOString().slice(0,10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* silent */ }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Page Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-neutral-900 dark:text-white tracking-tight">Moderation History</h2>
          <p className="text-[12px] text-neutral-500 dark:text-neutral-400 mt-0.5">
            Permanent audit log of every moderation action.{" "}
            {!loading && <span className="font-semibold text-neutral-700 dark:text-neutral-300">{total.toLocaleString()} records</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchHistory(filters, page)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-neutral-200 dark:border-white/[0.1] text-neutral-600 dark:text-neutral-300 text-[12px] font-medium hover:bg-neutral-50 dark:hover:bg-white/[0.05] transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-neutral-200 dark:border-white/[0.1] text-neutral-600 dark:text-neutral-300 text-[12px] font-medium hover:bg-neutral-50 dark:hover:bg-white/[0.05] transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
          <button
            onClick={exportExcel}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-neutral-200 dark:border-white/[0.1] text-neutral-600 dark:text-neutral-300 text-[12px] font-medium hover:bg-neutral-50 dark:hover:bg-white/[0.05] transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Excel
          </button>
        </div>
      </div>

      {/* Search + Filter bar */}
      <div className="space-y-2">
        <div className="flex gap-2 flex-wrap">
          <div className="flex-1 min-w-48 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400" />
            <input
              type="text"
              placeholder="Search by user, email, reason, report ID…"
              defaultValue={filters.search}
              onChange={e => handleSearchChange(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-neutral-200 dark:border-white/[0.1] bg-neutral-50 dark:bg-white/[0.04] text-[13px] text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-600 outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 dark:focus-visible:ring-white/20 transition"
            />
          </div>
          <button
            onClick={() => setShowFilters(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[12px] font-medium transition-colors cursor-pointer ${
              showFilters || hasActiveFilters
                ? "border-rose-300 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400"
                : "border-neutral-200 dark:border-white/[0.1] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-white/[0.05]"
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            Filters
            {hasActiveFilters && <span className="ml-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] flex items-center justify-center font-bold">!</span>}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showFilters ? "rotate-180" : ""}`} />
          </button>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-neutral-200 dark:border-white/[0.1] text-neutral-500 dark:text-neutral-400 text-[12px] hover:bg-neutral-50 dark:hover:bg-white/[0.05] transition-colors cursor-pointer"
            >
              <X className="w-3 h-3" /> Clear
            </button>
          )}
        </div>

        {/* Expanded filters */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-4 bg-neutral-50 dark:bg-white/[0.03] border border-neutral-100 dark:border-white/[0.06] rounded-xl">
                {/* Action type */}
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Action Type</label>
                  <select
                    value={filters.actionType}
                    onChange={e => handleFilter("actionType", e.target.value)}
                    className="w-full appearance-none bg-white dark:bg-white/[0.06] border border-neutral-200 dark:border-white/[0.1] rounded-lg px-2.5 py-2 text-[12px] text-neutral-900 dark:text-white outline-none transition cursor-pointer"
                  >
                    <option value="">All Types</option>
                    {ALL_ACTION_TYPES.map(t => <option key={t} value={t}>{ACTION_LABELS[t]}</option>)}
                  </select>
                </div>

                {/* Admin */}
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Administrator</label>
                  <select
                    value={filters.adminId}
                    onChange={e => handleFilter("adminId", e.target.value)}
                    className="w-full appearance-none bg-white dark:bg-white/[0.06] border border-neutral-200 dark:border-white/[0.1] rounded-lg px-2.5 py-2 text-[12px] text-neutral-900 dark:text-white outline-none transition cursor-pointer"
                  >
                    <option value="">All Admins</option>
                    {admins.map(a => <option key={a.id} value={a.id}>{a.name || a.email}</option>)}
                  </select>
                </div>

                {/* Target User search */}
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Target User ID</label>
                  <input
                    type="text"
                    placeholder="Paste user ID…"
                    value={filters.targetUserId}
                    onChange={e => handleFilter("targetUserId", e.target.value)}
                    className="w-full bg-white dark:bg-white/[0.06] border border-neutral-200 dark:border-white/[0.1] rounded-lg px-2.5 py-2 text-[12px] text-neutral-900 dark:text-white placeholder-neutral-400 outline-none transition"
                  />
                </div>

                {/* Start Date */}
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">From Date</label>
                  <input
                    type="date"
                    value={filters.startDate}
                    onChange={e => handleFilter("startDate", e.target.value)}
                    className="w-full bg-white dark:bg-white/[0.06] border border-neutral-200 dark:border-white/[0.1] rounded-lg px-2.5 py-2 text-[12px] text-neutral-900 dark:text-white outline-none transition"
                  />
                </div>

                {/* End Date */}
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">To Date</label>
                  <input
                    type="date"
                    value={filters.endDate}
                    onChange={e => handleFilter("endDate", e.target.value)}
                    className="w-full bg-white dark:bg-white/[0.06] border border-neutral-200 dark:border-white/[0.1] rounded-lg px-2.5 py-2 text-[12px] text-neutral-900 dark:text-white outline-none transition"
                  />
                </div>

                {/* Checkboxes */}
                <div className="col-span-2 md:col-span-1 flex flex-wrap gap-x-4 gap-y-2 items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.isPermanent}
                      onChange={e => {
                        handleFilter("isPermanent", e.target.checked);
                        if (e.target.checked) { handleFilter("activeOnly", false); handleFilter("expiredOnly", false); }
                      }}
                      className="w-3.5 h-3.5 rounded accent-rose-500 cursor-pointer"
                    />
                    <span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">Permanent only</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.activeOnly}
                      onChange={e => {
                        handleFilter("activeOnly", e.target.checked);
                        if (e.target.checked) handleFilter("expiredOnly", false);
                      }}
                      className="w-3.5 h-3.5 rounded accent-emerald-500 cursor-pointer"
                    />
                    <span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">Active only</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.expiredOnly}
                      onChange={e => {
                        handleFilter("expiredOnly", e.target.checked);
                        if (e.target.checked) handleFilter("activeOnly", false);
                      }}
                      className="w-3.5 h-3.5 rounded accent-neutral-400 cursor-pointer"
                    />
                    <span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">Expired / lifted</span>
                  </label>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Table */}
      <div className="border border-neutral-200/60 dark:border-white/[0.08] rounded-xl overflow-hidden">
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse" style={{ minWidth: "760px" }}>
            <thead>
              <tr className="bg-neutral-50 dark:bg-white/[0.03] border-b border-neutral-200/60 dark:border-white/[0.08]">
                {[
                  { label: "Action",        style: { minWidth: "120px" } },
                  { label: "Target User",   style: { minWidth: "150px" } },
                  { label: "Administrator", style: { minWidth: "150px" } },
                  { label: "Reason",        style: { minWidth: "140px", maxWidth: "180px" } },
                  { label: "Date",          style: { minWidth: "110px" } },
                  { label: "Status",        style: { minWidth: "80px"  } },
                  { label: "Duration",      style: { minWidth: "90px"  } },
                  { label: "",              style: { minWidth: "44px", width: "44px" } },
                ].map(h => (
                  <th key={h.label} style={h.style} className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && records.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <RefreshCw className="w-5 h-5 text-neutral-400 animate-spin" />
                      <p className="text-[13px] text-neutral-500 dark:text-neutral-400">Loading…</p>
                    </div>
                  </td>
                </tr>
              )}
              {!loading && records.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Shield className="w-8 h-8 text-neutral-300 dark:text-neutral-600" />
                      <p className="text-[14px] font-medium text-neutral-500 dark:text-neutral-400">No records found</p>
                      {hasActiveFilters && (
                        <button onClick={clearFilters} className="text-[12px] text-rose-500 hover:underline cursor-pointer">
                          Clear filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
              {records.map((record, idx) => {
                const status = computeCurrentStatus(record);
                return (
                  <tr
                    key={record.id}
                    className={`border-b border-neutral-100 dark:border-white/[0.04] hover:bg-neutral-50/80 dark:hover:bg-white/[0.03] transition-colors ${
                      idx % 2 === 0 ? "" : "bg-neutral-50/30 dark:bg-white/[0.01]"
                    }`}
                  >
                    <td className="px-4 py-3"><ActionBadge actionType={record.actionType} /></td>
                    <td className="px-4 py-3"><UserCell user={record.targetUser} /></td>
                    <td className="px-4 py-3"><UserCell user={record.admin} isSystem={record.isSystemAction && !record.admin} /></td>
                    <td className="px-4 py-3 max-w-[180px]">
                      <p className="text-[12px] text-neutral-700 dark:text-neutral-200 truncate" title={record.reason ?? ""}>
                        {record.reason || <span className="text-neutral-400 dark:text-neutral-600">—</span>}
                      </p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="text-[12px] text-neutral-600 dark:text-neutral-300">{formatDateTime(record.createdAt)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[12px] font-semibold ${status.color}`}>{status.label}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {record.isPermanent ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400 font-semibold">
                          <InfinityIcon className="w-3 h-3" /> Permanent
                        </span>
                      ) : (
                        <span className="text-[12px] text-neutral-600 dark:text-neutral-300">
                          {formatDuration(record.duration, false)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setSelected(record)}
                        className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/[0.08] text-neutral-400 hover:text-neutral-700 dark:hover:text-white transition-colors cursor-pointer"
                        title="View details"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mod-history-pagination flex items-center justify-between">
          <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
            Showing {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, total)} of {total.toLocaleString()}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-2 rounded-lg border border-neutral-200 dark:border-white/[0.1] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-white/[0.05] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                let p: number;
                if (totalPages <= 7) {
                  p = i + 1;
                } else if (page <= 4) {
                  p = i < 6 ? i + 1 : totalPages;
                } else if (page >= totalPages - 3) {
                  p = i < 1 ? 1 : totalPages - 6 + i;
                } else {
                  const mid = [1, page - 1, page, page + 1, totalPages];
                  p = i < mid.length ? mid[i] : mid[mid.length - 1];
                }
                return (
                  <button
                    key={`${i}-${p}`}
                    onClick={() => setPage(p)}
                    className={`w-8 h-8 rounded-lg text-[12px] font-medium transition-colors cursor-pointer ${
                      p === page
                        ? "bg-neutral-900 dark:bg-white text-white dark:text-neutral-900"
                        : "border border-neutral-200 dark:border-white/[0.1] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-white/[0.05]"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-2 rounded-lg border border-neutral-200 dark:border-white/[0.1] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-white/[0.05] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200/60 dark:border-rose-500/20 rounded-xl">
          <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
          <p className="text-[13px] text-rose-700 dark:text-rose-400">{error}</p>
        </div>
      )}

      {/* Detail panel */}
      <DetailPanel record={selected} onClose={() => setSelected(null)} />
    </div>
  );
};

export default ModerationHistoryView;
