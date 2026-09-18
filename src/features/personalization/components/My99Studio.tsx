import React, { memo, useCallback } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Palette,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import { HapticFeedback } from "../../../core/device/haptic";
import {
  useTranslation,
  type Language,
} from "../../../core/i18n/translations";
import { toast } from "../../../core/utils/toast";
import {
  usePersonalization,
  type PersonalizationRuntimeApplyResult,
} from "../PersonalizationProvider";
import {
  PERSONALIZATION_THEME_CATALOG,
  type PersonalizationThemeCatalogItem,
} from "../personalizationCatalog";
import type { ImplementedThemeId } from "../classic99Tokens";

interface My99StudioProps {
  language: Language;
  onBack: () => void;
}

function isHydrated(
  phase: "signed-out" | "loading" | "ready" | "fallback",
): boolean {
  return phase === "ready" || phase === "fallback";
}

function getApplyMessage(
  language: Language,
  result: PersonalizationRuntimeApplyResult,
): { kind: "success" | "error"; message: string } {
  if (result.ok) {
    return {
      kind: "success",
      message:
        language === "ar"
          ? "تم تطبيق التخصيص بنجاح."
          : "Personalization applied.",
    };
  }

  return {
    kind: "error",
    message:
      language === "ar"
        ? "تعذر تطبيق التغييرات. حاول مرة أخرى."
        : "Couldn't apply your changes. Try again.",
  };
}

const ThemeMiniPreview = memo(function ThemeMiniPreview({
  themeId,
}: {
  themeId: ImplementedThemeId;
}) {
  return (
    <div
      aria-hidden="true"
      className="my99-theme-mini-preview"
      data-personalization-preview-theme={themeId}
    >
      <span className="my99-theme-mini-preview-bar" />
      <span className="my99-theme-mini-preview-card" />
      <span className="my99-theme-mini-preview-card my99-theme-mini-preview-card-short" />
      <span className="my99-theme-mini-preview-accent" />
    </div>
  );
});

const ThemeCard = memo(function ThemeCard({
  item,
  language,
  name,
  description,
  isDraft,
  isCurrent,
  onSelect,
}: {
  item: PersonalizationThemeCatalogItem;
  language: Language;
  name: string;
  description: string;
  isDraft: boolean;
  isCurrent: boolean;
  onSelect: () => void;
}) {
  const isRtl = language === "ar";
  const status =
    isDraft && isCurrent
      ? language === "ar"
        ? "الحالي والمحدد"
        : "Current and selected"
      : isDraft
        ? language === "ar"
          ? "المحدد"
          : "Selected"
        : isCurrent
          ? language === "ar"
            ? "الحالي"
            : "Current"
          : "";

  return (
    <button
      type="button"
      role="radio"
      aria-checked={isDraft}
      aria-label={`${name}${status ? ` — ${status}` : ""}`}
      onClick={() => {
        onSelect();
        HapticFeedback.selection();
      }}
      className={`my99-theme-card group ${
        isDraft
          ? "border-semantic-action-accent bg-semantic-action-accent-soft shadow-elevation-1"
          : "border-semantic-border-default bg-semantic-surface-elevated hover:border-semantic-border-strong"
      }`}
      dir={isRtl ? "rtl" : "ltr"}
    >
      <div className="flex items-start gap-3">
        <ThemeMiniPreview themeId={item.id} />
        <div className="min-w-0 flex-1 text-start">
          <div className="flex items-start justify-between gap-2">
            <span className="text-base font-semibold text-semantic-content-primary">
              {name}
            </span>
            <span
              className={`mt-0.5 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full ${
                isDraft
                  ? "bg-semantic-action-accent text-white"
                  : "border border-semantic-border-strong text-transparent"
              }`}
              aria-hidden="true"
            >
              <Check className="h-4 w-4" strokeWidth={2.5} />
            </span>
          </div>
          <p className="mt-1 text-sm leading-5 text-semantic-content-secondary">
            {description}
          </p>
          {status && (
            <span
              className={`mt-3 inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                isDraft
                  ? "bg-semantic-action-accent-soft text-semantic-action-accent"
                  : "bg-semantic-surface-muted text-semantic-content-secondary"
              }`}
            >
              {status}
            </span>
          )}
        </div>
      </div>
    </button>
  );
});

const My99Studio = memo(function My99Studio({
  language,
  onBack,
}: My99StudioProps) {
  const { t } = useTranslation(language);
  const {
    userId,
    committed,
    draft,
    isDirty,
    hydration,
    applyStatus,
    updateDraft,
    cancelDraft,
    resetDraft,
    applyDraft,
  } = usePersonalization();
  const isRtl = language === "ar";
  const canApply =
    Boolean(userId) &&
    isHydrated(hydration.phase) &&
    isDirty &&
    applyStatus.phase !== "saving";
  const isApplying = applyStatus.phase === "saving";

  const handleSelect = useCallback(
    (themeId: ImplementedThemeId) => {
      updateDraft({ type: "setThemeId", value: themeId });
    },
    [updateDraft],
  );

  const handleApply = useCallback(async () => {
    if (!canApply) return;
    HapticFeedback.selection();
    const result = await applyDraft();
    const feedback = getApplyMessage(language, result);
    if (feedback.kind === "success") {
      toast.success(feedback.message);
      HapticFeedback.notification("success");
    } else {
      toast.error(feedback.message);
      HapticFeedback.notification("error");
    }
  }, [applyDraft, canApply, language]);

  const handleCancel = useCallback(() => {
    cancelDraft();
    HapticFeedback.selection();
  }, [cancelDraft]);

  const handleReset = useCallback(() => {
    resetDraft();
    HapticFeedback.selection();
  }, [resetDraft]);

  return (
    <main
      className="my99-studio mx-auto w-full max-w-5xl pb-[calc(5rem+env(safe-area-inset-bottom,0px))]"
      dir={isRtl ? "rtl" : "ltr"}
    >
      <header className="mb-6 flex items-start gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("my99Back")}
          className="mt-0.5 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-semantic-chrome-content-secondary transition-colors hover:bg-semantic-chrome-surface-hover hover:text-semantic-chrome-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-focus-ring"
        >
          {isRtl ? (
            <ArrowRight className="h-5 w-5" />
          ) : (
            <ArrowLeft className="h-5 w-5" />
          )}
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Palette className="h-5 w-5 shrink-0 text-semantic-action-accent" />
            <h1 className="text-large-title font-display font-semibold text-semantic-chrome-content-primary">
              {t("my99Title")}
            </h1>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-semantic-chrome-content-secondary">
            {t("my99Description")}
          </p>
        </div>
      </header>

      <section
        className="mb-6 rounded-2xl border border-semantic-border-default bg-semantic-surface-primary p-4 shadow-elevation-1 sm:p-6"
        aria-labelledby="my99-preview-heading"
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2
              id="my99-preview-heading"
              className="text-base font-semibold text-semantic-content-primary"
            >
              {t("my99PreviewTitle")}
            </h2>
            <p className="mt-1 text-sm text-semantic-content-secondary">
              {t("my99PreviewDescription")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full bg-semantic-surface-muted px-2.5 py-1 text-semantic-content-secondary">
              {t("my99CurrentLabel")}: {t(
                PERSONALIZATION_THEME_CATALOG.find(
                  (item) => item.id === committed.themeId,
                )?.nameKey ?? "my99ThemeClassicName",
              )}
            </span>
            <span className="rounded-full bg-semantic-action-accent-soft px-2.5 py-1 text-semantic-action-accent">
              {t("my99DraftLabel")}: {t(
                PERSONALIZATION_THEME_CATALOG.find(
                  (item) => item.id === draft.themeId,
                )?.nameKey ?? "my99ThemeClassicName",
              )}
            </span>
          </div>
        </div>
        <div
          className="my99-main-preview overflow-hidden rounded-xl border border-semantic-border-default bg-semantic-background-page"
          data-personalization-preview-theme={draft.themeId}
        >
          <div className="my99-main-preview-topbar">
            <span className="my99-main-preview-dot" />
            <span className="my99-main-preview-dot" />
            <span className="my99-main-preview-dot" />
            <span className="ms-auto h-2 w-16 rounded-full bg-semantic-content-subtle" />
          </div>
          <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1.25fr)_minmax(180px,0.75fr)] sm:p-6">
            <div className="rounded-xl bg-semantic-surface-primary p-4">
              <div className="mb-5 h-3 w-28 rounded-full bg-semantic-content-subtle" />
              <div className="h-8 w-3/4 rounded-lg bg-semantic-content-primary/90" />
              <div className="mt-3 h-3 w-full rounded-full bg-semantic-content-subtle" />
              <div className="mt-2 h-3 w-5/6 rounded-full bg-semantic-content-subtle" />
              <div className="mt-6 flex gap-2">
                <span className="h-9 w-24 rounded-lg bg-semantic-action-accent" />
                <span className="h-9 w-20 rounded-lg bg-semantic-surface-muted" />
              </div>
            </div>
            <div className="rounded-xl bg-semantic-surface-elevated p-4">
              <div className="mb-4 h-3 w-20 rounded-full bg-semantic-content-subtle" />
              <div className="space-y-3">
                <div className="h-10 rounded-lg bg-semantic-action-accent-soft" />
                <div className="h-10 rounded-lg bg-semantic-surface-muted" />
                <div className="h-10 rounded-lg bg-semantic-surface-muted" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="my99-themes-heading"
        aria-busy={hydration.phase === "loading"}
      >
        <div className="mb-3">
          <h2
            id="my99-themes-heading"
            className="text-base font-semibold text-semantic-content-primary"
          >
            {t("my99ThemePacksTitle")}
          </h2>
          <p className="mt-1 text-sm text-semantic-content-secondary">
            {t("my99ThemePacksDescription")}
          </p>
        </div>
        <div
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          role="radiogroup"
          aria-labelledby="my99-themes-heading"
        >
          {PERSONALIZATION_THEME_CATALOG.map((item) => (
            <ThemeCard
              key={item.id}
              item={item}
              language={language}
              name={t(item.nameKey)}
              description={t(item.descriptionKey)}
              isDraft={draft.themeId === item.id}
              isCurrent={committed.themeId === item.id}
              onSelect={() => handleSelect(item.id)}
            />
          ))}
        </div>
      </section>

      <div className="sticky bottom-0 z-10 -mx-2 mt-6 border-t border-semantic-border-default bg-semantic-background-page/95 px-2 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] pt-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-6 sm:backdrop-blur-none">
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={!isDirty || isApplying}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-semantic-border-strong px-4 text-sm font-semibold text-semantic-content-primary transition-colors hover:bg-semantic-chrome-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-focus-ring disabled:pointer-events-none disabled:opacity-45"
            >
              <X className="h-4 w-4" />
              {t("my99Cancel")}
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={isApplying}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-semantic-content-secondary transition-colors hover:bg-semantic-chrome-surface-hover hover:text-semantic-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-focus-ring disabled:pointer-events-none disabled:opacity-45"
            >
              <RotateCcw className="h-4 w-4" />
              {t("my99Reset")}
            </button>
          </div>
          <button
            type="button"
            onClick={() => void handleApply()}
            disabled={!canApply}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-semantic-action-accent px-5 text-sm font-semibold text-white shadow-elevation-1 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-focus-ring disabled:pointer-events-none disabled:opacity-45"
          >
            <Save className="h-4 w-4" />
            {isApplying ? t("my99Applying") : t("my99Apply")}
          </button>
        </div>
      </div>
    </main>
  );
});

export default My99Studio;