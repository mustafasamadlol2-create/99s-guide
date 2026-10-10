import React from "react";
import { CircleHelp, LoaderCircle, LockKeyhole, RefreshCw } from "lucide-react";

export type GamificationAvailability = "loading" | "ready" | "unavailable";

type Props = {
  status: GamificationAvailability;
  enabled: boolean;
  onRetry: () => void;
  tx: (key: string, en: string, ar: string) => string;
};

export function GamificationFeatureState({
  status,
  enabled,
  onRetry,
  tx,
}: Props): React.ReactElement | null {
  if (status === "loading") {
    return (
      <div className="g-empty" role="status" aria-live="polite">
        <div className="g-empty-mark"><LoaderCircle className="g-spin" size={21} /></div>
        <h3>{tx("gamificationFlagsLoading", "Checking study engagement availability", "جارٍ التحقق من توفر التفاعل الدراسي")}</h3>
      </div>
    );
  }
  if (status === "unavailable") {
    return (
      <div className="g-error" role="alert">
        <div className="g-empty-mark"><CircleHelp size={21} /></div>
        <h3>{tx("gamificationFlagsUnavailable", "Study engagement availability could not be checked.", "تعذر التحقق من توفر التفاعل الدراسي.")}</h3>
        <button type="button" className="g-action" onClick={onRetry}>
          <RefreshCw size={15} /> {tx("gamificationRetry", "Try again", "حاول مجددًا")}
        </button>
      </div>
    );
  }
  if (!enabled) {
    return (
      <div className="g-empty" role="status">
        <div className="g-empty-mark"><LockKeyhole size={21} /></div>
        <h3>{tx("gamificationDisabled", "Study engagement is disabled.", "التفاعل الدراسي معطل.")}</h3>
        <p>{tx("gamificationDisabledHint", "This study engagement feature is currently disabled.", "ميزة التفاعل الدراسي هذه معطلة حاليًا.")}</p>
      </div>
    );
  }
  return null;
}
