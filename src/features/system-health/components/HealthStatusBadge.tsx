import type { HealthStatus } from "../../../../server/observability/types.js";

const statusStyles: Record<HealthStatus, string> = {
  HEALTHY: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  DEGRADED: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  UNHEALTHY: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  UNKNOWN: "bg-neutral-100 text-neutral-700 dark:bg-white/10 dark:text-neutral-300",
};

const arabicStatus: Record<HealthStatus, string> = {
  HEALTHY: "سليم",
  DEGRADED: "متأثر",
  UNHEALTHY: "غير سليم",
  UNKNOWN: "غير معروف",
};

export function HealthStatusBadge({
  status,
  language = "en",
}: {
  status: HealthStatus;
  language?: "en" | "ar";
}) {
  const label = language === "ar" ? arabicStatus[status] : status;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ${statusStyles[status]}`}
      aria-label={`${language === "ar" ? "الحالة" : "Status"}: ${label}`}
    >
      {label}
    </span>
  );
}