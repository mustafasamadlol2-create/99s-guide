import React, { memo, useCallback, useEffect, useState } from "react";
import { Check, Smartphone } from "lucide-react";
import { HapticFeedback } from "../../../core/device/haptic";
import {
  useTranslation,
  type Language,
} from "../../../core/i18n/translations";
import { toast } from "../../../core/utils/toast";
import { APP_ICON_CATALOG } from "./appIconCatalog";
import {
  getAppIconState,
  listenForAppIconActivation,
  setAppIcon,
} from "./appIconClient";
import type { AppIconId, AppIconState } from "./appIconTypes";

interface AppIconSelectorProps {
  language: Language;
}

const INITIAL_STATE: AppIconState = {
  supported: false,
  iconId: "primary",
};

export const AppIconSelector = memo(function AppIconSelector({
  language,
}: AppIconSelectorProps) {
  const { t } = useTranslation(language);
  const [state, setState] = useState<AppIconState>(INITIAL_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingId, setPendingId] = useState<AppIconId | null>(null);

  const refreshState = useCallback(async () => {
    setIsLoading(true);
    try {
      setState(await getAppIconState());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshState();
    return listenForAppIconActivation(() => {
      void refreshState();
    });
  }, [refreshState]);

  const handleSelect = useCallback(
    async (iconId: AppIconId) => {
      if (!state.supported || pendingId || state.iconId === iconId) return;

      setPendingId(iconId);
      HapticFeedback.selection();
      try {
        await setAppIcon(iconId);
        const nextState = await getAppIconState();
        setState(nextState);
        if (nextState.iconId === iconId) {
          toast.success(t("my99AppIconChanged"));
          HapticFeedback.notification("success");
        } else {
          toast.error(t("my99AppIconChangeFailed"));
          HapticFeedback.notification("error");
        }
      } catch {
        await refreshState();
        toast.error(t("my99AppIconChangeFailed"));
        HapticFeedback.notification("error");
      } finally {
        setPendingId(null);
      }
    },
    [pendingId, refreshState, state.iconId, state.supported, t],
  );

  return (
    <section
      className="mt-6"
      aria-labelledby="my99-app-icon-heading"
      aria-busy={isLoading || pendingId !== null}
    >
      <div className="mb-3 flex items-start gap-2">
        <Smartphone
          className="mt-0.5 h-5 w-5 shrink-0 text-semantic-action-accent"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="my99-app-icon-heading"
              className="text-base font-semibold text-semantic-content-primary"
            >
              {t("my99AppIconTitle")}
            </h2>
            <span className="rounded-full bg-semantic-action-accent-soft px-2 py-1 text-xs font-semibold text-semantic-action-accent">
              {t("my99AppIconDeviceBadge")}
            </span>
          </div>
          <p className="mt-1 text-sm text-semantic-content-secondary">
            {t("my99AppIconDescription")}
          </p>
        </div>
      </div>

      {!state.supported ? (
        <div className="rounded-xl border border-semantic-border-default bg-semantic-surface-primary px-4 py-3 text-sm text-semantic-content-secondary">
          {t("my99AppIconUnsupported")}
        </div>
      ) : (
        <div
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          role="radiogroup"
          aria-labelledby="my99-app-icon-heading"
        >
          {APP_ICON_CATALOG.map((item) => {
            const isSelected = state.iconId === item.id;
            const isPending = pendingId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={t(item.nameKey)}
                disabled={pendingId !== null || isSelected}
                onClick={() => void handleSelect(item.id)}
                className={`group relative flex min-h-36 items-center gap-3 rounded-xl border p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-focus-ring sm:block ${
                  isSelected
                    ? "border-semantic-action-accent bg-semantic-action-accent-soft"
                    : "border-semantic-border-default bg-semantic-surface-primary hover:border-semantic-action-accent/60 hover:bg-semantic-chrome-surface-hover"
                } disabled:cursor-default disabled:opacity-75`}
              >
                <img
                  src={item.previewSrc}
                  alt=""
                  aria-hidden="true"
                  className="h-16 w-16 shrink-0 rounded-2xl object-cover shadow-elevation-1 sm:h-24 sm:w-24"
                />
                <span className="min-w-0 flex-1 sm:mt-3 sm:block">
                  <span className="block text-sm font-semibold text-semantic-content-primary">
                    {t(item.nameKey)}
                  </span>
                  <span className="mt-1 block text-xs text-semantic-content-secondary">
                    {t(item.descriptionKey)}
                  </span>
                </span>
                <span
                  className={`absolute end-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-full ${
                    isSelected
                      ? "bg-semantic-action-accent text-white"
                      : "border border-semantic-border-strong bg-semantic-surface-primary text-transparent"
                  }`}
                  aria-hidden="true"
                >
                  <Check className="h-4 w-4" />
                </span>
                {isPending ? (
                  <span className="absolute inset-x-3 bottom-2 text-center text-[0.68rem] font-semibold text-semantic-action-accent">
                    {t("my99AppIconApplying")}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
});