import { useEffect, useState } from "react";
import { ShieldBan, Clock, Infinity as InfinityIcon, AlertCircle, Mail } from "lucide-react";

interface SuspensionScreenProps {
  reason: string | null;
  isPermanent: boolean;
  endTime: string | null;
  language?: "en" | "ar";
  onExpired?: () => void;
}

function formatRemaining(endTime: string): string {
  const remaining = new Date(endTime).getTime() - Date.now();
  if (remaining <= 0) return "0m";
  const totalSecs = Math.floor(remaining / 1000);
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export default function SuspensionScreen({
  reason,
  isPermanent,
  endTime,
  language = "en",
  onExpired,
}: SuspensionScreenProps) {
  const isRtl = language === "ar";
  const [remaining, setRemaining] = useState<string>("");
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (isPermanent || !endTime) return;

    const checkExpiry = () => {
      const ms = new Date(endTime).getTime() - Date.now();
      if (ms <= 0) {
        setExpired(true);
        onExpired?.();
        return;
      }
      setRemaining(formatRemaining(endTime));
    };

    checkExpiry();
    const id = setInterval(checkExpiry, 1000);
    return () => clearInterval(id);
  }, [endTime, isPermanent, onExpired]);

  if (expired) return null; // Parent will unmount and restore access

  const expiryDate = endTime ? new Date(endTime).toLocaleString() : null;

  return (
    <div
      dir={isRtl ? "rtl" : "ltr"}
      className="suspension-shell min-h-full w-full flex flex-col items-center justify-center bg-[#0a0a0b] px-6 py-12"
    >
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-rose-950/20 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-md flex flex-col items-center gap-8">
        {/* Icon */}
        <div className="flex flex-col items-center gap-4">
          <div className="w-24 h-24 rounded-full bg-rose-950/40 border border-rose-800/30 flex items-center justify-center shadow-[0_0_40px_rgba(220,38,38,0.15)]">
            <ShieldBan className="w-12 h-12 text-rose-500" strokeWidth={1.5} />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white tracking-tight">
              {isRtl ? "تم تعليق الحساب" : "Account Suspended"}
            </h1>
            <p className="mt-2 text-sm font-medium text-neutral-500">
              {isRtl
                ? "تم تقييد وصولك إلى المنصة مؤقتاً"
                : "Your access to the platform has been restricted"}
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="w-full rounded-2xl bg-white/[0.04] border border-white/[0.08] divide-y divide-white/[0.06] overflow-hidden">
          {/* Reason */}
          <div className="p-5">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">
                  {isRtl ? "السبب" : "Reason"}
                </p>
                <p className="text-sm font-medium text-neutral-200 leading-relaxed">
                  {reason ||
                    (isRtl
                      ? "لم يُحدَّد سبب."
                      : "No reason was provided.")}
                </p>
              </div>
            </div>
          </div>

          {/* Duration */}
          <div className="p-5">
            <div className="flex items-start gap-3">
              {isPermanent ? (
                <InfinityIcon className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
              ) : (
                <Clock className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">
                  {isRtl ? "المدة" : "Duration"}
                </p>
                {isPermanent ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-rose-400">
                      {isRtl ? "دائم" : "Permanent"}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-rose-950/60 border border-rose-800/40 text-[10px] font-bold text-rose-400 uppercase tracking-wider">
                      {isRtl ? "لا ينتهي" : "No expiry"}
                    </span>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {remaining && (
                      <p className="text-base font-bold text-amber-400 tabular-nums">
                        {remaining} {isRtl ? "متبقٍ" : "remaining"}
                      </p>
                    )}
                    {expiryDate && (
                      <p className="text-xs text-neutral-500">
                        {isRtl ? "ينتهي في:" : "Expires:"}{" "}
                        <span className="text-neutral-400">{expiryDate}</span>
                      </p>
                    )}
                    <p className="text-xs text-neutral-600 mt-1">
                      {isRtl
                        ? "سيُستعاد الوصول تلقائياً عند انتهاء المدة."
                        : "Access will be automatically restored when the suspension expires."}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Support */}
        <div className="flex items-start gap-2.5 text-center">
          <Mail className="w-4 h-4 text-neutral-600 mt-0.5 shrink-0" />
          <p className="text-xs text-neutral-600 leading-relaxed">
            {isRtl
              ? "إذا كنت تعتقد أن هذا الإجراء كان بالخطأ، يُرجى التواصل مع الدعم الأكاديمي."
              : "If you believe this suspension was issued in error, please contact academic support."}
          </p>
        </div>
      </div>
    </div>
  );
}
