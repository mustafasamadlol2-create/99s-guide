import React from "react";
import {
  AlertCircle,
  Medal,
  Trophy,
  UsersRound,
} from "lucide-react";
import type {
  LeaderboardEntry,
  LeaderboardResponse,
  LeaderboardScope,
  OwnRankResponse,
} from "./types";
import { getLevelPresentation } from "./levelPresentation";
import "./leaderboard-view.css";

export interface LeaderboardViewProps {
  scope: LeaderboardScope;
  onScopeChange: (scope: LeaderboardScope) => void;
  availableScopes: LeaderboardScope[];
  data: LeaderboardResponse | null;
  ownRank: OwnRankResponse | null;
  loading: boolean;
  rankLoading: boolean;
  rankError: boolean;
  loadingMore: boolean;
  error: unknown;
  onLoadMore: () => void;
  locale: string;
  isRtl: boolean;
  tx: (key: string, en: string, ar: string) => string;
  optimisticPointDelta?: number;
}

const SCOPE_COPY: Record<LeaderboardScope, [string, string, string]> = {
  WEEKLY: ["gamificationWeekly", "Weekly", "أسبوعي"],
  MONTHLY: ["gamificationMonthly", "Monthly", "شهري"],
  SEMESTER: ["gamificationSemester", "Semester", "فصلي"],
  ALL_TIME: ["gamificationAllTime", "All time", "طوال الوقت"],
};

function isFeatureDisabled(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const body = (error as { body?: { code?: unknown } }).body;
  return body?.code === "FEATURE_DISABLED";
}

function SkeletonRows({ label }: { label: string }) {
  return (
    <div className="lv-skeleton-list" role="status" aria-label={label}>
      {[0, 1, 2, 3].map((item) => (
        <div className="lv-skeleton-row" key={item} aria-hidden="true">
          <span className="lv-skeleton lv-skeleton-rank" />
          <span className="lv-skeleton lv-skeleton-avatar" />
          <span className="lv-skeleton lv-skeleton-name" />
          <span className="lv-skeleton lv-skeleton-score" />
        </div>
      ))}
    </div>
  );
}

function LeaderboardAvatar({ url }: { url: string | null }) {
  const [failed, setFailed] = React.useState(false);
  return (
    <span className="lv-avatar" aria-hidden="true">
      {url && !failed
        ? <img
            src={url}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
          />
        : <UsersRound size={17} />}
    </span>
  );
}

export function LeaderboardView({
  scope,
  onScopeChange,
  availableScopes,
  data,
  ownRank,
  loading,
  rankLoading,
  rankError,
  loadingMore,
  error,
  onLoadMore,
  locale,
  isRtl,
  tx,
  optimisticPointDelta = 0,
}: LeaderboardViewProps) {
  const formatNumber = (value: number) => new Intl.NumberFormat(locale).format(value);
  const scopeTitle = (value: LeaderboardScope) => {
    const [key, en, ar] = SCOPE_COPY[value];
    return tx(key, en, ar);
  };
  const currentData = data?.scope === scope ? data : null;
  const currentRank = ownRank?.scope === scope ? ownRank : null;
  const showError = Boolean(error);
  const featureDisabled = isFeatureDisabled(error);
  const entries: LeaderboardEntry[] = currentData?.entries ?? [];

  return (
    <section
      className="g-tab-panel g-leaderboard-view"
      dir={isRtl ? "rtl" : "ltr"}
      aria-labelledby="leaderboard-view-title"
    >
      <header className="lv-heading">
        <div className="lv-heading-copy">
          <span className="lv-kicker">
            <span className="lv-kicker-mark"><Trophy size={14} aria-hidden="true" /></span>
            {tx("gamificationStudyCommunity", "Study community", "مجتمع الدراسة")}
          </span>
          <h1 id="leaderboard-view-title">{tx("gamificationLeaderboard", "Leaderboard", "لوحة النقاط")}</h1>
        </div>
      </header>

      <div
        className="g-scope-row lv-scopes"
        role="group"
        aria-label={tx("gamificationScopeLabel", "Snapshot period", "فترة اللقطة")}
      >
        {availableScopes.map((item) => (
          <button
            type="button"
            className="g-scope"
            key={item}
            aria-pressed={scope === item}
            onClick={() => onScopeChange(item)}
          >
            {scopeTitle(item)}
          </button>
        ))}
      </div>

      <div className="lv-board">
        <div className="lv-board-top">
          <div className="lv-board-title">
            <div className="lv-title-icon" aria-hidden="true"><Medal size={20} /></div>
            <div>
              <h2>{scopeTitle(scope)}</h2>
            </div>
          </div>

          <div className="lv-place-slot">
            {rankLoading ? (
              <div className="lv-place-chip lv-place-loading" role="status" aria-live="polite">
                <span className="lv-place-rank"><span className="lv-skeleton lv-rank-skeleton" /></span>
                <span className="lv-skeleton lv-place-skeleton-copy" />
              </div>
            ) : currentRank ? (
              <div className="lv-place-chip" aria-label={tx("gamificationYourPlace", "Your place", "ترتيبك")}>
                <span className="lv-place-rank" aria-hidden="true">
                  {currentRank.notRanked || currentRank.rank === null
                    ? "—"
                    : formatNumber(currentRank.rank)}
                </span>
                <span className="lv-place-copy">
                  <strong>{currentRank.notRanked || currentRank.rank === null
                    ? tx("gamificationNotRanked", "Not ranked", "غير مدرج")
                    : tx("gamificationYourPlace", "Your place", "ترتيبك")}</strong>
                  <span>{formatNumber(currentRank.score)} {tx("gamificationScore", "Study Points", "نقاط الدراسة")}</span>
                </span>
              </div>
            ) : rankError ? (
              <div className="lv-place-error" role="status">
                {tx("gamificationRankError", "Your position is unavailable.", "ترتيبك غير متاح حاليًا.")}
              </div>
            ) : null}
          </div>
        </div>

        {showError && (
          <div className="lv-error" role="alert">
            <span className="lv-error-icon"><AlertCircle size={17} aria-hidden="true" /></span>
            <div className="lv-error-copy">
              <strong>{featureDisabled
                ? tx("gamificationDisabled", "The leaderboard is disabled.", "لوحة الصدارة معطلة.")
                : tx("gamificationLeaderboardError", "The leaderboard could not be loaded.", "تعذر تحميل لوحة النقاط.")}</strong>
              <span>{featureDisabled
                ? tx("gamificationDisabledHint", "This study engagement feature is currently disabled.", "ميزة التفاعل الدراسي هذه معطلة حاليًا.")
                : tx("gamificationRetryHint", "Updates resume automatically when the server connection returns.", "يُستأنف التحديث تلقائيًا عند عودة الاتصال بالخادم.")}</span>
            </div>
          </div>
        )}

        {loading && !currentData
          ? <SkeletonRows label={tx("gamificationLoadingLeaderboard", "Loading leaderboard", "جارٍ تحميل لوحة النقاط")} />
          : null}

        {!loading && !showError && !currentData && (
          <div className="g-empty lv-empty">
            <div className="g-empty-mark"><Trophy size={20} aria-hidden="true" /></div>
            <h3>{tx("gamificationNoLeaderboardEntries", "Leaderboard is not ready", "لوحة النقاط غير جاهزة")}</h3>
            <p>{tx("gamificationLeaderboardAwaiting", "The latest verified snapshot will appear here.", "ستظهر هنا أحدث لقطة موثّقة.")}</p>
          </div>
        )}

        {currentData && entries.length === 0 && !loading && (
          <div className="g-empty lv-empty">
            <div className="g-empty-mark"><Trophy size={20} aria-hidden="true" /></div>
            <h3>{tx("gamificationNoLeaderboardEntries", "No leaderboard entries", "لا توجد نتائج في لوحة النقاط")}</h3>
            <p>{tx("gamificationNoLeaderboardActivity", "No students have Study Points in this period yet.", "لا توجد نقاط دراسة مسجلة للطلاب في هذه الفترة بعد.")}</p>
          </div>
        )}

        {currentData && entries.length > 0 && (
          <div className="lv-list" role="list" aria-label={tx("gamificationLeaderboard", "Leaderboard", "لوحة النقاط")}>
            {entries.map((entry, index) => {
              const publicLabel = entry.displayName?.trim()
                || tx("gamificationParticipant", "Student", "طالب");
              const podium = entry.rank >= 1 && entry.rank <= 3;
              // Snapshot ordering can take a moment to rebuild, but the
              // authenticated user's score should never visually lag. The
              // own-rank endpoint reads the canonical ledger directly; while
              // that request is in flight, use the local committed optimistic
              // delta as a temporary overlay on this user's row only.
              const displayedScore = entry.isViewer
                ? (currentRank?.score ?? (entry.score + optimisticPointDelta))
                : entry.score;
              const levelPresentation = entry.level === null
                ? null
                : getLevelPresentation(entry.level);
              const LevelIcon = levelPresentation?.Icon;
              const levelName = levelPresentation
                ? tx(levelPresentation.titleKey, levelPresentation.fallbackEn, levelPresentation.fallbackAr)
                : null;
              return (
                <div
                  className={`lv-row${podium ? ` lv-podium lv-podium-${entry.rank}` : ""}`}
                  key={`${entry.rank}-${index}`}
                  role="listitem"
                  aria-label={`${publicLabel}. ${tx("gamificationYourPlace", "Rank", "الترتيب")} ${formatNumber(entry.rank)}. ${formatNumber(displayedScore)} ${tx("gamificationScore", "Study Points", "نقاط الدراسة")}`}
                >
                  <span className="lv-rank">
                    {podium ? <Medal size={17} aria-hidden="true" /> : null}
                    <span>{formatNumber(entry.rank)}</span>
                  </span>
                  <LeaderboardAvatar key={entry.avatarUrl ?? "no-avatar"} url={entry.avatarUrl} />
                  <span className="lv-student">
                    <strong>{publicLabel}</strong>
                    <span className="lv-level-line">{entry.level === null
                      ? tx("gamificationVerifiedPoints", "Verified activity", "نشاط موثّق")
                      : <>
                          {LevelIcon ? <LevelIcon size={12} aria-hidden="true" /> : null}
                          <span>{levelName} · {tx("gamificationLevelShort", "Level", "المستوى")} {formatNumber(entry.level)}</span>
                        </>}</span>
                  </span>
                  <span className="lv-score">
                    <strong>{formatNumber(displayedScore)}</strong>
                    <span>{tx("gamificationScore", "Study Points", "نقاط الدراسة")}</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {currentData?.nextCursor && (
          <div className="lv-load-more">
            <button type="button" className="g-action" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore
                ? tx("gamificationLoadingMore", "Loading more", "جارٍ تحميل المزيد")
                : tx("gamificationLoadMore", "Load more students", "تحميل المزيد من الطلاب")}
            </button>
          </div>
        )}

      </div>
    </section>
  );
}

export default LeaderboardView;
