import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, Award, CalendarDays, Check, ChevronDown,
  CircleHelp, Clock3, LoaderCircle, Medal, RefreshCw, ShieldCheck,
  Sparkles, Target, Trophy, UsersRound, LockKeyhole,
} from "lucide-react";
import { useTranslation, type Language } from "../../core/i18n/translations";
import { gamificationApi } from "./api";
import type {
  Achievement, AchievementsResponse, ChallengesResponse, ChallengeItem, GamificationSummary, UnlockHistory,
  GamificationTab, LeaderboardEntry, LeaderboardResponse, LeaderboardScope, OwnRankResponse,
  PublicProfile,
} from "./types";
import "./gamification.css";

export interface GamificationFrontendProps {
  language: "en" | "ar";
  onBack: () => void;
}

type ApiFailure = Error & { status?: number; body?: { error?: unknown; code?: unknown; message?: unknown } };
type LoadingSet = { summary: boolean; achievements: boolean; challenges: boolean; leaderboard: boolean };
type AchievementStatus = "unlocked" | "in-progress" | "locked";

const SCOPES: LeaderboardScope[] = ["WEEKLY", "MONTHLY", "SEMESTER", "ALL_TIME"];
const loggedUnknownDisplayKinds = new Set<string>();
const BACKEND_COPY: Record<string, string> = {
  "gamification.achievement.first_focus.title": "gamificationAchievementFirstFocusTitle",
  "gamification.achievement.first_focus.description": "gamificationAchievementFirstFocusDescription",
  "gamification.achievement.first_100_points.title": "gamificationAchievementFirst100Title",
  "gamification.achievement.first_100_points.description": "gamificationAchievementFirst100Description",
  "gamification.achievement.first_group_focus.title": "gamificationAchievementFirstGroupFocusTitle",
  "gamification.achievement.first_group_focus.description": "gamificationAchievementFirstGroupFocusDescription",
  "gamification.challenge.weekly_focus_sessions.title": "gamificationChallengeWeeklyFocusSessionsTitle",
  "gamification.challenge.weekly_focus_sessions.description": "gamificationChallengeWeeklyFocusSessionsDescription",
  "gamification.challenge.weekly_focus_minutes.title": "gamificationChallengeWeeklyFocusMinutesTitle",
  "gamification.challenge.weekly_focus_minutes.description": "gamificationChallengeWeeklyFocusMinutesDescription",
  "gamification.challenge.weekly_consistency_days.title": "gamificationChallengeWeeklyConsistencyDaysTitle",
  "gamification.challenge.weekly_consistency_days.description": "gamificationChallengeWeeklyConsistencyDaysDescription",
  "gamification.challenge.weekly_group_focus_runs.title": "gamificationChallengeWeeklyGroupFocusRunsTitle",
  "gamification.challenge.weekly_group_focus_runs.description": "gamificationChallengeWeeklyGroupFocusRunsDescription",
};

function pickLocalized(language: Language, en: string, ar: string): string {
  return language === "ar" ? ar : en;
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as ApiFailure).status === 404);
}

function cursorExpired(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const failure = error as ApiFailure;
  const bodyText = JSON.stringify(failure.body ?? {}).toLowerCase();
  return failure.status === 410 || bodyText.includes("cursor_expired") || bodyText.includes("cursor expired");
}

function safeFraction(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function formatDate(value: string | null | undefined, locale: string, options: Intl.DateTimeFormatOptions = {}): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", ...options }).format(date);
}

function isBoolNumber(value: number | boolean): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function valueLabel(value: number | boolean, locale: string): string {
  if (typeof value === "boolean") return value ? "✓" : "—";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
}

function achievementStatus(item: Achievement): AchievementStatus {
  if (item.unlocked) return "unlocked";
  if (item.progressCompleted || item.currentValue === true ||
      (typeof item.currentValue === "number" && item.currentValue > 0)) {
    return "in-progress";
  }
  return "locked";
}

function preserveUnlockHistory(
  current: Achievement[],
  history: UnlockHistory[],
): Achievement[] {
  const histories = new Map<string, UnlockHistory>();
  history.forEach((item) => {
    const previous = histories.get(item.achievementId);
    if (!previous || new Date(item.unlockedAt).getTime() < new Date(previous.unlockedAt).getTime()) {
      histories.set(item.achievementId, item);
    }
  });
  const result = current.map((item) => {
    const unlocked = histories.get(item.achievementId);
    return unlocked ? { ...item, unlocked: true, unlockedAt: unlocked.unlockedAt } : item;
  });
  const known = new Set(current.map((item) => item.achievementId));
  history.forEach((item) => {
    if (known.has(item.achievementId)) return;
    known.add(item.achievementId);
    result.push({
      achievementId: item.achievementId,
      ruleSetVersion: item.unlockedUnderRuleSetVersion,
      metricId: item.metricId,
      titleKey: item.titleKey,
      descriptionKey: item.descriptionKey,
      visibility: item.visibility,
      tier: item.tier,
      sortOrder: result.length,
      currentValue: item.metricValueAtUnlock,
      targetValue: item.targetValueAtUnlock,
      progressCompleted: true,
      unlocked: true,
      lastEvaluatedAt: item.unlockedAt,
      unlockedAt: item.unlockedAt,
      unlockedUnderRuleSetVersion: item.unlockedUnderRuleSetVersion,
    });
  });
  return result;
}

function formatExactNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 12 }).format(value);
}

function formatChallengeAmount(
  value: number,
  metricId: string,
  locale: string,
  tx: (key: string, fallbackEn: string, fallbackAr: string) => string,
): string {
  const exact = formatExactNumber(value, locale);
  if (metricId === "focus.completed_sessions") {
    return `${exact} ${tx("gamificationUnitSessions", "sessions", "جلسات")}`;
  }
  if (metricId === "focus.verified_seconds") {
    const unit = tx("gamificationUnitSeconds", "seconds", "ثانية");
    const humanValue = value >= 3600 ? value / 3600 : value / 60;
    const humanUnit = value >= 3600
      ? tx("gamificationUnitHours", "hours", "ساعات")
      : tx("gamificationUnitMinutes", "minutes", "دقائق");
    return `${exact} ${unit} (${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(humanValue)} ${humanUnit})`;
  }
  if (metricId === "consistency.qualifying_days") {
    return `${exact} ${tx("gamificationUnitDays", "days", "أيام")}`;
  }
  if (metricId === "group_focus.completed_runs") {
    return `${exact} ${tx("gamificationUnitRuns", "runs", "جلسات جماعية")}`;
  }
  return exact;
}

export function GamificationFrontend({ language, onBack }: GamificationFrontendProps) {
  const { t } = useTranslation(language);
  const tGlobal = t as (key: string) => string;
  const isRtl = language === "ar";
  const locale = language === "ar" ? "ar-IQ" : "en";
  const [tab, setTab] = useState<GamificationTab>("overview");
  const [scope, setScope] = useState<LeaderboardScope>("WEEKLY");
  const [summary, setSummary] = useState<GamificationSummary | null>(null);
  const [achievements, setAchievements] = useState<AchievementsResponse | null>(null);
  const [challenges, setChallenges] = useState<ChallengesResponse | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse | null>(null);
  const [ownRank, setOwnRank] = useState<OwnRankResponse | null>(null);
  const [loading, setLoading] = useState<LoadingSet>({
    summary: true, achievements: true, challenges: true, leaderboard: false,
  });
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursorHasExpired, setCursorHasExpired] = useState(false);
  const [rankLoading, setRankLoading] = useState(false);
  const [rankError, setRankError] = useState(false);
  const [rankRetrySerial, setRankRetrySerial] = useState(0);
  const [overviewRank, setOverviewRank] = useState<OwnRankResponse | null>(null);
  const [overviewRankLoading, setOverviewRankLoading] = useState(false);
  const [overviewRankError, setOverviewRankError] = useState(false);
  const [overviewRankRetrySerial, setOverviewRankRetrySerial] = useState(0);
  const [selectedParticipant, setSelectedParticipant] = useState<{ userId: string; profile: PublicProfile | null; unavailable: boolean; loading: boolean } | null>(null);
  const privateGeneration = useRef(0);
  const leaderboardGeneration = useRef(0);
  const leaderboardRequestingScope = useRef<LeaderboardScope | null>(null);
  const rankGeneration = useRef(0);
  const overviewRankGeneration = useRef(0);
  const participantGeneration = useRef(0);
  const warnedPointMismatch = useRef(false);
  const currentTab = useRef(tab);
  const currentScope = useRef(scope);
  currentTab.current = tab;
  currentScope.current = scope;

  const tx = useCallback((key: string, fallbackEn: string, fallbackAr: string) => {
    const translated = tGlobal(key);
    return translated !== key ? translated : pickLocalized(language, fallbackEn, fallbackAr);
  }, [language, tGlobal]);
  const localizedBackendText = useCallback((backendKey: string | undefined, kind: "title" | "description" | "challengeTitle" | "challengeDescription") => {
    const translationKey = backendKey ? BACKEND_COPY[backendKey] : undefined;
    if (translationKey) {
      const translated = tGlobal(translationKey);
      if (translated !== translationKey) return translated;
    }
    if (backendKey && !translationKey && !loggedUnknownDisplayKinds.has(kind)) {
      loggedUnknownDisplayKinds.add(kind);
      console.warn(`[Gamification] Unknown ${kind} display definition.`);
    }
    if (kind === "challengeTitle") {
      return tx("gamificationGenericChallenge", "Study challenge", "تحدٍ دراسي");
    }
    if (kind === "challengeDescription") {
      return tx("gamificationGenericChallengeDescription", "A challenge with progress verified by the server.", "تحدٍ يتم التحقق من تقدمه بواسطة الخادم.");
    }
    return kind === "title"
      ? tx("gamificationGenericAchievement", "Study milestone", "إنجاز دراسي")
      : tx("gamificationGenericAchievementDescription", "A verified study engagement milestone.", "إنجاز موثّق للتفاعل الدراسي.");
  }, [tGlobal, tx]);
  const formatNumber = useCallback((value: number) => new Intl.NumberFormat(locale).format(value), [locale]);

  const loadPrivateData = useCallback(async () => {
    const requestId = ++privateGeneration.current;
    setErrors((old) => ({ ...old, summary: false, achievements: false, challenges: false }));
    setLoading((old) => ({ ...old, summary: true, achievements: true, challenges: true }));
    const jobs = [
      gamificationApi.summary().then((data) => { if (privateGeneration.current === requestId) setSummary(data); }).catch(() => { if (privateGeneration.current === requestId) setErrors((old) => ({ ...old, summary: true })); }),
      gamificationApi.achievements().then((data) => { if (privateGeneration.current === requestId) setAchievements(data); }).catch(() => { if (privateGeneration.current === requestId) setErrors((old) => ({ ...old, achievements: true })); }),
      gamificationApi.challenges().then((data) => { if (privateGeneration.current === requestId) setChallenges(data); }).catch(() => { if (privateGeneration.current === requestId) setErrors((old) => ({ ...old, challenges: true })); }),
    ];
    await Promise.all(jobs);
    if (privateGeneration.current === requestId) setLoading((old) => ({ ...old, summary: false, achievements: false, challenges: false }));
  }, []);

  const loadOverviewRank = useCallback(async () => {
    const requestId = ++overviewRankGeneration.current;
    setOverviewRank(null);
    setOverviewRankError(false);
    setOverviewRankLoading(true);
    try {
      const result = await gamificationApi.ownRank("WEEKLY");
      if (overviewRankGeneration.current === requestId) setOverviewRank(result);
    } catch {
      if (overviewRankGeneration.current === requestId) {
        setOverviewRank(null);
        setOverviewRankError(true);
      }
    } finally {
      if (overviewRankGeneration.current === requestId) setOverviewRankLoading(false);
    }
  }, []);

  const loadLeaderboard = useCallback(async (nextScope: LeaderboardScope, append = false) => {
    if (append && !leaderboard?.nextCursor) return;
    const requestId = ++leaderboardGeneration.current;
    leaderboardRequestingScope.current = nextScope;
    if (!append) {
      setLeaderboard(null);
      setOwnRank(null);
      setRankError(false);
      setRankLoading(false);
    }
    setLoading((old) => ({ ...old, leaderboard: true }));
    setErrors((old) => ({ ...old, leaderboard: false }));
    try {
      const cursor = append ? leaderboard?.nextCursor : null;
      const result = await gamificationApi.leaderboard(nextScope, cursor);
      if (leaderboardGeneration.current !== requestId || currentScope.current !== nextScope) return;
      setLeaderboard((old) => {
        if (!append || old?.scope !== nextScope) return result;
        const seen = new Set(old.entries.map((entry) => entry.userId));
        const addedEntries = result.entries.filter((entry) => {
          if (seen.has(entry.userId)) return false;
          seen.add(entry.userId);
          return true;
        });
        return { ...result, entries: [...old.entries, ...addedEntries] };
      });
      setCursorHasExpired(false);
      setOwnRank(null);
    } catch (error) {
      if (leaderboardGeneration.current !== requestId) return;
      if (append && cursorExpired(error)) {
        setLeaderboard(null);
        setOwnRank(null);
        setRankLoading(false);
        setCursorHasExpired(true);
      } else {
        setLeaderboard(null);
        setOwnRank(null);
        setRankLoading(false);
        setErrors((old) => ({ ...old, leaderboard: true }));
      }
    } finally {
      if (leaderboardGeneration.current === requestId) {
        leaderboardRequestingScope.current = null;
        setLoading((old) => ({ ...old, leaderboard: false }));
        setLoadingMore(false);
      }
    }
  }, [leaderboard]);

  const refresh = useCallback(async () => {
    const activeTab = currentTab.current;
    const activeScope = currentScope.current;
    const privatePromise = loadPrivateData();
    const visibleParticipantId = activeTab === "leaderboard" ? selectedParticipant?.userId : undefined;
    const refreshParticipant = async () => {
      if (!visibleParticipantId) return;
      const requestId = ++participantGeneration.current;
      setSelectedParticipant((current) => current?.userId === visibleParticipantId
        ? { ...current, profile: null, loading: true, unavailable: false }
        : current);
      try {
        const profile = await gamificationApi.publicProfile(visibleParticipantId);
        if (participantGeneration.current === requestId) {
          setSelectedParticipant({ userId: visibleParticipantId, profile, unavailable: false, loading: false });
        }
      } catch (error) {
        if (participantGeneration.current === requestId) {
          setSelectedParticipant({ userId: visibleParticipantId, profile: null, unavailable: isNotFound(error), loading: false });
        }
      }
    };
    if (activeTab === "leaderboard") {
      await Promise.all([privatePromise, loadLeaderboard(activeScope), refreshParticipant()]);
    } else if (activeTab === "overview") {
      await Promise.all([privatePromise, loadOverviewRank()]);
    } else await privatePromise;
  }, [loadLeaderboard, loadOverviewRank, loadPrivateData, selectedParticipant?.userId]);

  useEffect(() => { void loadPrivateData(); }, [loadPrivateData]);
  useEffect(() => {
    if (tab === "overview") void loadOverviewRank();
  }, [tab, overviewRankRetrySerial, loadOverviewRank]);
  useEffect(() => {
    if (tab === "leaderboard" && !cursorHasExpired &&
        (!leaderboard || leaderboard.scope !== scope) &&
        leaderboardRequestingScope.current !== scope) void loadLeaderboard(scope);
  }, [tab, scope, leaderboard?.scope, cursorHasExpired, loadLeaderboard]);
  useEffect(() => {
    const seasonKey = leaderboard?.scope === scope ? leaderboard.season.seasonKey : null;
    if (!seasonKey || tab !== "leaderboard") {
      rankGeneration.current += 1;
      setOwnRank(null);
      setRankLoading(false);
      setRankError(false);
      return;
    }
    let cancelled = false;
    const requestId = ++rankGeneration.current;
    setOwnRank(null);
    setRankError(false);
    setRankLoading(true);
    void gamificationApi.ownRank(scope, seasonKey)
      .then((rank) => { if (!cancelled && rankGeneration.current === requestId) setOwnRank(rank); })
      .catch(() => { if (!cancelled && rankGeneration.current === requestId) setRankError(true); })
      .finally(() => { if (!cancelled && rankGeneration.current === requestId) setRankLoading(false); });
    return () => { cancelled = true; };
  }, [leaderboard?.season.seasonKey, leaderboard?.scope, scope, tab, rankRetrySerial]);
  useEffect(() => {
    let lastRefresh = 0;
    const onForeground = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRefresh < 1200) return;
      lastRefresh = now;
      void refresh();
    };
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("focus", onForeground);
    return () => {
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("focus", onForeground);
    };
  }, [refresh]);
  useEffect(() => () => {
    privateGeneration.current += 1;
    leaderboardGeneration.current += 1;
    rankGeneration.current += 1;
    overviewRankGeneration.current += 1;
    participantGeneration.current += 1;
  }, []);

  const achievementList = useMemo(() => {
    const current = achievements?.achievements ?? summary?.achievements ?? [];
    const history = [
      ...(summary?.unlockHistory ?? []),
      ...(achievements?.unlockHistory ?? []),
    ];
    return preserveUnlockHistory(current, history);
  }, [achievements, summary]);
  const overviewAchievements = useMemo(
    () => achievementList.filter((item) => item.unlocked).slice(0, 3),
    [achievementList],
  );
  const currentChallenges = challenges?.active ?? [];
  const recentChallenges = challenges?.recent ?? [];
  const categoryTotals = useMemo(() => summary ? [
    summary.points.focusPoints,
    summary.points.masteryPoints,
    summary.points.progressPoints,
    summary.points.consistencyPoints,
  ] : [], [summary]);
  const categoryTotal = categoryTotals.reduce((sum, points) => sum + points, 0);
  const pointTotalsDisagree = Boolean(summary && categoryTotal !== summary.points.totalPoints);
  useEffect(() => {
    if (pointTotalsDisagree && !warnedPointMismatch.current) {
      warnedPointMismatch.current = true;
      console.warn("[Gamification] Canonical total and category totals differ.");
    }
  }, [pointTotalsDisagree]);
  const categoryBarValues = categoryTotals.map((value) => Math.max(0, value));
  const categoryBarTotal = categoryBarValues.reduce((sum, value) => sum + value, 0);
  const privateDataMayBeStale = Boolean(
    (summary && (loading.summary || errors.summary))
    || (achievements && (loading.achievements || errors.achievements))
    || (challenges && (loading.challenges || errors.challenges)),
  );
  const privateStaleNotice = privateDataMayBeStale
    ? <div className="g-period-note" role="status" aria-live="polite">
      {tx("gamificationPrivateStale", "Some progress may be out of date. Refresh to check again.", "قد لا يكون بعض التقدم محدثًا. حدّث الصفحة للتحقق مجددًا.")}
    </div>
    : null;
  const scopeLabel = (value: LeaderboardScope) => {
    const keys: Record<LeaderboardScope, string> = {
      WEEKLY: "gamificationWeekly", MONTHLY: "gamificationMonthly",
      SEMESTER: "gamificationSemester", ALL_TIME: "gamificationAllTime",
    };
    const fallback: Record<LeaderboardScope, [string, string]> = {
      WEEKLY: ["Weekly", "أسبوعي"], MONTHLY: ["Monthly", "شهري"],
      SEMESTER: ["Semester", "فصلي"], ALL_TIME: ["All time", "طوال الوقت"],
    };
    return tx(keys[value], ...fallback[value]);
  };
  const statusCopy = (status: ChallengeItem["status"]) => {
    const map: Record<ChallengeItem["status"], [string, string, string]> = {
      ACTIVE: ["gamificationActive", "Active", "نشط"],
      COMPLETED: ["gamificationCompleted", "Completed", "مكتمل"],
      EXPIRED: ["gamificationExpired", "Expired", "انتهى"],
      LEFT: ["gamificationLeft", "No longer active", "لم يعد نشطًا"],
    };
    const [key, en, ar] = map[status];
    return tx(key, en, ar);
  };

  const openParticipant = useCallback(async (entry: LeaderboardEntry) => {
    const requestId = ++participantGeneration.current;
    setSelectedParticipant({ userId: entry.userId, profile: null, unavailable: false, loading: true });
    try {
      const profile = await gamificationApi.publicProfile(entry.userId);
      if (participantGeneration.current === requestId) {
        setSelectedParticipant({ userId: entry.userId, profile, unavailable: false, loading: false });
      }
    } catch (error) {
      if (participantGeneration.current === requestId) {
        setSelectedParticipant({ userId: entry.userId, profile: null, unavailable: isNotFound(error), loading: false });
      }
    }
  }, []);

  const closeParticipant = useCallback(() => {
    participantGeneration.current += 1;
    setSelectedParticipant(null);
  }, []);

  const loadMore = useCallback(() => {
    if (loadingMore || !leaderboard?.nextCursor) return;
    setLoadingMore(true);
    void loadLeaderboard(scope, true);
  }, [leaderboard, loadLeaderboard, loadingMore, scope]);

  const renderAchievement = (item: Achievement, compact = false) => {
    const status = achievementStatus(item);
    const unlocked = status === "unlocked";
    const statusKey = status === "unlocked" ? "gamificationUnlocked"
      : status === "in-progress" ? "gamificationInProgress" : "gamificationLocked";
    const statusText = status === "unlocked"
      ? tx(statusKey, "Unlocked", "مفتوح")
      : status === "in-progress"
        ? tx(statusKey, "In progress", "قيد التقدم")
        : tx(statusKey, "Not yet unlocked", "لم يُفتح بعد");
    return (
      <div className={`g-achievement ${status === "locked" ? "is-locked" : ""}`} key={`${item.achievementId}-${item.sortOrder}`}>
        <div className="g-medallion" aria-hidden="true">
          {status === "unlocked" ? <Award size={20} /> : status === "in-progress" ? <Clock3 size={18} /> : <LockKeyhole size={18} />}
        </div>
        <div className="g-achievement-body">
          <h3>{localizedBackendText(item.titleKey, "title")}</h3>
          {!compact && <p>{localizedBackendText(item.descriptionKey, "description")}</p>}
          {!compact && <div className="g-inline-meta">
            {unlocked
              ? `${statusText}${item.unlockedAt ? ` · ${formatDate(item.unlockedAt, locale)}` : ""}`
              : isBoolNumber(item.currentValue) && isBoolNumber(item.targetValue)
              ? `${valueLabel(item.currentValue, locale)} / ${valueLabel(item.targetValue, locale)}`
              : item.currentValue === true || item.currentValue === false
                ? `${valueLabel(item.currentValue, locale)} / ${valueLabel(item.targetValue, locale)}`
                : statusText}
          </div>}
        </div>
        <span className={`g-status-pill ${status === "locked" ? "muted" : ""}`}>
          {status === "unlocked" ? <Check size={13} /> : status === "in-progress" ? <Clock3 size={13} /> : <LockKeyhole size={13} />}
          {statusText}
        </span>
      </div>
    );
  };

  const renderChallenge = (item: ChallengeItem) => {
    const ratio = safeFraction(item.progressRatio);
    return (
      <article className="g-challenge" key={item.instanceId}>
        <div className="g-medallion" aria-hidden="true"><Target size={19} /></div>
        <div className="g-challenge-body" style={{ flex: 1, minWidth: 0 }}>
          <div className="g-section-head" style={{ marginBottom: 0 }}>
            <div>
              <h3>{localizedBackendText(item.titleKey, "challengeTitle")}</h3>
              <p>{localizedBackendText(item.descriptionKey, "challengeDescription")}</p>
            </div>
            <span className={`g-status-pill ${item.status === "ACTIVE" ? "" : "muted"}`}>{statusCopy(item.status)}</span>
          </div>
          <div className="g-challenge-progress">
            <div className="g-progress-track" role="progressbar" aria-label={tx("gamificationProgressLabel", "Server-verified progress", "التقدم الموثّق من الخادم")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
              <div className="g-progress-value" style={{ width: `${ratio * 100}%` }} />
            </div>
            <div className="g-challenge-stats">
              <span>{formatChallengeAmount(item.current, item.metricId, locale, tx)} / {formatChallengeAmount(item.target, item.metricId, locale, tx)}</span>
              <span>{formatDate(item.startsAt, locale)} – {formatDate(item.endsAt, locale)}</span>
            </div>
          </div>
        </div>
      </article>
    );
  };

  const renderError = (title: string, retry: () => void) => (
    <div className="g-error" role="alert">
      <div className="g-empty-mark"><CircleHelp size={21} /></div>
      <h3>{title}</h3>
      <p>{tx("gamificationLoadError", "We couldn't load this progress just now.", "تعذر تحميل هذا التقدم الآن.")}</p>
      <button type="button" className="g-action" onClick={retry} style={{ marginTop: 16 }}>
        <RefreshCw size={15} /> {tx("gamificationRetry", "Try again", "حاول مجددًا")}
      </button>
    </div>
  );

  const skeleton = (count: number) => (
    <div aria-label={tx("gamificationRefreshing", "Refreshing", "جارٍ التحديث")} aria-busy="true">
      {Array.from({ length: count }, (_, index) => <div className="g-skeleton g-skeleton-card" key={index} />)}
    </div>
  );

  const renderOverview = () => {
    if (loading.summary && !summary) return skeleton(3);
    if (errors.summary && !summary) return renderError(tx("gamificationOverviewError", "Your engagement summary could not be loaded.", "تعذر تحميل ملخص التفاعل."), () => void loadPrivateData());
    if (!summary) return null;
    const level = summary.level;
    const progress = level.levelProgressRatio === null ? null : safeFraction(level.levelProgressRatio);
    const pointsCategory: ["focusPoints" | "masteryPoints" | "progressPoints" | "consistencyPoints", string, string, string][] = [
      ["focusPoints", "gamificationFocusPoints", "Focus", "التركيز"],
      ["masteryPoints", "gamificationMasteryPoints", "Mastery", "الإتقان"],
      ["progressPoints", "gamificationProgressPoints", "Progress", "التقدم"],
      ["consistencyPoints", "gamificationConsistencyPoints", "Consistency", "الاستمرارية"],
    ];
    const pointColors = ["#d0e5d9", "#e8d5b9", "#b9d5cc", "#f0e9d8"];
    return (
      <div className="g-tab-panel">
        {privateStaleNotice}
        <div className="g-overview-grid">
          <section className="g-card g-points-card" aria-labelledby="g-points-heading">
            <div className="g-points-label" id="g-points-heading">{tx("gamificationPoints", "Study Points", "نقاط الدراسة")}</div>
            <div className="g-total" aria-label={`${formatNumber(summary.points.totalPoints)} ${tx("gamificationScore", "Points", "النقاط")}`}>{formatNumber(summary.points.totalPoints)}</div>
            <div className="g-point-bar" role="img" aria-label={tx("gamificationCategoryDistribution", "Canonical points by category", "توزيع النقاط حسب الفئة")}>
              {pointsCategory.map(([category], index) => (
                <span
                  className="g-point-bar-segment"
                  key={category}
                  style={{
                    width: `${categoryBarTotal > 0 ? (categoryBarValues[index] / categoryBarTotal) * 100 : 0}%`,
                    backgroundColor: pointColors[index],
                  }}
                />
              ))}
            </div>
            <div className="g-point-cats">
              {pointsCategory.map(([category, key, en, ar]) => (
                <div className="g-point-chip" key={category}>
                  <span>{tx(key, en, ar)}</span><strong>{formatNumber(summary.points[category])}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className="g-card g-level-card" aria-labelledby="g-level-heading">
            <div>
              <div className="g-level-top">
                <div>
                  <div className="g-level-caption" id="g-level-heading">{tx("gamificationLevel", "Current level", "المستوى الحالي")}</div>
                  <div className="g-level-title">{tx("gamificationLevelLabel", "Level", "المستوى")} {formatNumber(level.level)}</div>
                </div>
                <div className="g-level-mark" aria-hidden="true"><Sparkles size={24} /></div>
              </div>
            </div>
            <div>
              {progress !== null && <div className="g-progress-track" role="progressbar" aria-label={tx("gamificationLevelProgress", "Progress within this level", "التقدم ضمن هذا المستوى")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
                <div className="g-progress-value" style={{ width: `${progress * 100}%` }} />
              </div>}
              <div className="g-progress-note">
                {level.maxLevelReached
                  ? tx("gamificationMaxLevel", "Highest level reached", "تم بلوغ أعلى مستوى")
                  : level.pointsToNextLevel !== null
                    ? `${formatNumber(level.pointsToNextLevel)} ${tx("gamificationPointsToNext", "points to next level", "نقطة للمستوى التالي")}`
                    : tx("gamificationNextThresholdUnavailable", "Next level threshold unavailable", "حد المستوى التالي غير متاح")}
              </div>
              <div className="g-level-thresholds">
                <div>
                  <span>{tx("gamificationCurrentThreshold", "Current level starts at", "يبدأ المستوى الحالي عند")}</span>
                  <strong>{formatNumber(level.currentLevelMinimumPoints)} {tx("gamificationScore", "Points", "النقاط")}</strong>
                </div>
                {!level.maxLevelReached && <div>
                  <span>{tx("gamificationNextThreshold", "Next level starts at", "يبدأ المستوى التالي عند")}</span>
                  <strong>{level.nextLevelMinimumPoints === null
                    ? tx("gamificationNextThresholdUnavailable", "Unavailable", "غير متاح")
                    : `${formatNumber(level.nextLevelMinimumPoints)} ${tx("gamificationScore", "Points", "النقاط")}`}</strong>
                </div>}
              </div>
            </div>
          </section>
        </div>
        <div className="g-split">
          <section className="g-card" aria-labelledby="g-recent-heading">
            <div className="g-section-head">
              <div><h2 id="g-recent-heading">{tx("gamificationRecentAchievements", "Recent achievements", "أحدث الإنجازات")}</h2><p>{tx("gamificationRuleInfo", "Progress is verified by the server.", "يتم التحقق من التقدم بواسطة الخادم.")}</p></div>
              <button type="button" className="g-action" onClick={() => setTab("achievements")}>{tx("gamificationViewAll", "View all", "عرض الكل")} <ChevronDown size={14} /></button>
            </div>
            {loading.achievements && !achievements ? skeleton(2) : errors.achievements && !achievements ? <p className="g-subtle">{tx("gamificationAchievementsError", "Achievements could not be loaded.", "تعذر تحميل الإنجازات.")}</p>
              : overviewAchievements.length ? <div className="g-list">{overviewAchievements.map((item) => renderAchievement(item, true))}</div>
                : <div className="g-empty"><div className="g-empty-mark"><Medal size={21} /></div><h3>{tx("gamificationNoAchievements", "Your milestones will appear here", "ستظهر إنجازاتك هنا")}</h3><p>{tx("gamificationNoAchievementsHint", "Keep showing up for your study routine. New milestones appear when verified.", "واصل الالتزام بروتينك الدراسي. ستظهر الإنجازات الجديدة بعد توثيقها.")}</p></div>}
          </section>
          <section className="g-card" aria-labelledby="g-challenges-heading">
            <div className="g-section-head">
              <div><h2 id="g-challenges-heading">{tx("gamificationChallengesNow", "Challenges in progress", "تحديات قيد التقدم")}</h2><p>{challenges?.currentPeriod ? `${formatDate(challenges.currentPeriod.startsAt, locale)} – ${formatDate(challenges.currentPeriod.endsAt, locale)}` : tx("gamificationRuleInfo", "Progress is verified by the server.", "يتم التحقق من التقدم بواسطة الخادم.")}</p></div>
              <button type="button" className="g-action" onClick={() => setTab("challenges")}>{tx("gamificationViewAll", "View all", "عرض الكل")} <ChevronDown size={14} /></button>
            </div>
            {loading.challenges && !challenges ? skeleton(2) : errors.challenges && !challenges ? <p className="g-subtle">{tx("gamificationChallengesError", "Challenges could not be loaded.", "تعذر تحميل التحديات.")}</p>
              : currentChallenges.length ? <div className="g-list">{currentChallenges.slice(0, 2).map((item) => <div className="g-mini-row" key={item.instanceId}><div className="g-medallion"><Target size={17} /></div><div className="g-row-copy"><strong>{localizedBackendText(item.titleKey, "challengeTitle")}</strong><span>{formatChallengeAmount(item.current, item.metricId, locale, tx)} / {formatChallengeAmount(item.target, item.metricId, locale, tx)}</span></div><span className="g-row-end">{Math.round(safeFraction(item.progressRatio) * 100)}%</span></div>)}</div>
                : <div className="g-empty"><div className="g-empty-mark"><Target size={20} /></div><h3>{tx("gamificationNoChallenges", "No active challenges right now", "لا توجد تحديات نشطة حاليًا")}</h3><p>{tx("gamificationNoChallengesHint", "When a challenge is available, its server-verified progress will appear here.", "عند توفر تحدٍ، سيظهر تقدمه الموثّق من الخادم هنا.")}</p></div>}
          </section>
        </div>
        <section className="g-card g-overview-rank" aria-labelledby="g-overview-rank-heading">
          <div className="g-section-head">
            <div>
              <h2 id="g-overview-rank-heading">
                {tx("gamificationLeaderboard", "Leaderboard", "لوحة النقاط")} · {tx("gamificationWeekly", "Weekly", "أسبوعي")}
              </h2>
              <p>{tx("gamificationRankIntro", "A snapshot of study engagement points", "لقطة لنقاط التفاعل الدراسي")}</p>
              {overviewRank && <p className="g-subtle">
                {formatDate(overviewRank.season.startsAt, locale, { year: "numeric" })} – {formatDate(overviewRank.season.endsAt, locale, { year: "numeric" })}
              </p>}
            </div>
            <button type="button" className="g-action" onClick={() => setTab("leaderboard")}>
              {tx("gamificationViewAll", "View all", "عرض الكل")} <ChevronDown size={14} />
            </button>
          </div>
          {overviewRankLoading && <div className="g-own-rank" role="status" aria-live="polite">
            <div className="g-own-rank-badge"><LoaderCircle size={17} /></div>
            <div><strong>{tx("gamificationRankLoading", "Loading your position", "جارٍ تحميل ترتيبك")}</strong><span>{tx("gamificationRankLoadingHint", "Checking your place in this server snapshot.", "جارٍ التحقق من ترتيبك في لقطة الخادم.")}</span></div>
          </div>}
          {overviewRankError && <div className="g-rank-error" role="alert">
            <span>{tx("gamificationRankError", "Your position could not be loaded.", "تعذر تحميل ترتيبك.")}</span>
            <button type="button" className="g-action" onClick={() => setOverviewRankRetrySerial((serial) => serial + 1)}>
              {tx("gamificationRetry", "Try again", "حاول مجددًا")}
            </button>
          </div>}
          {overviewRank && <div className="g-own-rank" aria-label={tx("gamificationYourPlace", "Your place", "ترتيبك")}>
            <div className="g-own-rank-badge">{overviewRank.notRanked || overviewRank.rank === null ? "—" : formatNumber(overviewRank.rank)}</div>
            <div>
              <strong>{overviewRank.notRanked || overviewRank.rank === null
                ? tx("gamificationNotRanked", "Not ranked in this snapshot", "غير مدرج في هذه اللقطة")
                : tx("gamificationYourPlace", "Your place", "ترتيبك")}</strong>
              <span>{overviewRank.notRanked || overviewRank.rank === null
                ? overviewRank.score === 0
                  ? tx("gamificationNoRankScore", "No engagement points recorded for this season.", "لا توجد نقاط تفاعل مسجلة لهذا الموسم.")
                  : tx("gamificationUnrankedWithScore", "Your points are not ranked in this snapshot.", "نقاطك غير مدرجة في ترتيب هذه اللقطة.")
                : `${formatNumber(overviewRank.totalRankedUsers)} ${tx("gamificationRankedUsers", "ranked participants", "مشاركًا مدرجًا")}${overviewRank.tieSize && overviewRank.tieSize > 1 ? ` · ${formatNumber(overviewRank.tieSize)} ${tx("gamificationTie", "tied", "تعادل")}` : ""}`}</span>
            </div>
            <div className="g-own-score">
              {overviewRank.notRanked && overviewRank.score === 0 ? "—" : formatNumber(overviewRank.score)}
              <span style={{ fontSize: 10, display: "block", fontWeight: 500 }}>{tx("gamificationScore", "Points", "النقاط")}</span>
            </div>
          </div>}
          <p className="g-footer-note" style={{ marginBottom: 0 }}>
            {tx("gamificationRankDisclaimer", "This is an engagement measure only—not an academic ranking.", "هذا مقياس للتفاعل فقط، وليس ترتيبًا أكاديميًا.")}
          </p>
        </section>
        <p className="g-footer-note">{tx("gamificationPrivateNote", "Only your verified totals, progress and milestones are shown here.", "تظهر هنا فقط إجمالياتك وتقدمك وإنجازاتك الموثّقة.")}</p>
      </div>
    );
  };

  const renderAchievements = () => (
    <div className="g-tab-panel">
      <div className="g-section-head"><div><h2>{tx("gamificationAchievements", "Achievements", "الإنجازات")}</h2><p>{tx("gamificationRuleInfo", "Progress is verified by the server.", "يتم التحقق من التقدم بواسطة الخادم.")}</p></div></div>
        {privateStaleNotice}
      {loading.achievements && !achievements ? skeleton(4)
        : errors.achievements && !achievements ? renderError(tx("gamificationAchievementsError", "Achievements could not be loaded.", "تعذر تحميل الإنجازات."), () => void loadPrivateData())
          : achievementList.length ? <div className="g-items">{achievementList.map((item) => renderAchievement(item))}</div>
            : <div className="g-empty"><div className="g-empty-mark"><Medal size={21} /></div><h3>{tx("gamificationNoAchievements", "Your milestones will appear here", "ستظهر إنجازاتك هنا")}</h3><p>{tx("gamificationNoAchievementsHint", "Keep showing up for your study routine. New milestones appear when verified.", "واصل الالتزام بروتينك الدراسي. ستظهر الإنجازات الجديدة بعد توثيقها.")}</p></div>}
      {achievements?.unlockHistory?.length ? <section className="g-card" style={{ marginTop: 14 }}><h2>{tx("gamificationUnlocked", "Unlocked", "مفتوح")}</h2><div style={{ marginTop: 12 }}>{achievements.unlockHistory.map((item, index) => <div className="g-profile-achievement" key={`${item.achievementId}-${index}`}><strong>{localizedBackendText(item.titleKey, "title")}</strong><span>{formatDate(item.unlockedAt, locale)}</span></div>)}</div></section> : null}
    </div>
  );

  const renderChallenges = () => (
    <div className="g-tab-panel">
      <div className="g-section-head"><div><h2>{tx("gamificationChallenges", "Challenges", "التحديات")}</h2><p>{tx("gamificationRuleInfo", "Progress is verified by the server.", "يتم التحقق من التقدم بواسطة الخادم.")}</p></div></div>
        {privateStaleNotice}
      {challenges?.currentPeriod && <div className="g-period-note">{tx("gamificationPeriod", "Current period", "الفترة الحالية")}: {formatDate(challenges.currentPeriod.startsAt, locale, { year: "numeric" })} – {formatDate(challenges.currentPeriod.endsAt, locale, { year: "numeric" })}</div>}
      {loading.challenges && !challenges ? skeleton(4)
        : errors.challenges && !challenges ? renderError(tx("gamificationChallengesError", "Challenges could not be loaded.", "تعذر تحميل التحديات."), () => void loadPrivateData())
          : (
            <>
              {currentChallenges.length ? <div className="g-items">{currentChallenges.map(renderChallenge)}</div>
                : <div className="g-empty"><div className="g-empty-mark"><Target size={20} /></div><h3>{tx("gamificationNoChallenges", "No active challenges right now", "لا توجد تحديات نشطة حاليًا")}</h3><p>{tx("gamificationNoChallengesHint", "When a challenge is available, its server-verified progress will appear here.", "عند توفر تحدٍ، سيظهر تقدمه الموثّق من الخادم هنا.")}</p></div>}
              {recentChallenges.length > 0 && <section style={{ marginTop: 24 }}><div className="g-section-head"><div><h2>{tx("gamificationChallengeRecent", "Recent challenges", "التحديات الأخيرة")}</h2></div></div><div className="g-items">{recentChallenges.map(renderChallenge)}</div></section>}
            </>
          )}
    </div>
  );

  const renderPublicProfile = () => {
    if (!selectedParticipant) return null;
    return (
      <section className="g-card g-profile" aria-live="polite">
        <div className="g-profile-title">
          <div><p className="g-eyebrow" style={{ marginBottom: 6 }}>{tx("gamificationParticipant", "Anonymous participant", "مشارك مجهول")}</p><h2>{tx("gamificationParticipant", "Anonymous participant", "مشارك مجهول")}</h2></div>
          <button className="g-action" type="button" onClick={closeParticipant}><ArrowLeft size={15} /> {tx("gamificationBackToLeaderboard", "Back to leaderboard", "العودة إلى لوحة النقاط")}</button>
        </div>
        {selectedParticipant.loading ? skeleton(2)
          : selectedParticipant.unavailable || !selectedParticipant.profile
            ? <div className="g-empty" style={{ marginTop: 18 }}><div className="g-empty-mark"><ShieldCheck size={20} /></div><h3>{tx("gamificationUnavailable", "Public progress is unavailable", "التقدم العام غير متاح")}</h3><p>{tx("gamificationUnavailableHint", "This participant’s safe public progress could not be shown.", "تعذر عرض التقدم العام الآمن لهذا المشارك.")}</p></div>
            : <>
              <div className="g-profile-level"><div className="g-level-mark"><Sparkles size={21} /></div><div><span className="g-level-caption">{tx("gamificationLevel", "Current level", "المستوى الحالي")}</span><div style={{ fontWeight: 750, fontSize: 18 }}>{tx("gamificationLevelLabel", "Level", "المستوى")} {formatNumber(selectedParticipant.profile.level)}</div></div></div>
              <h3 style={{ fontSize: 14, margin: "18px 0 4px" }}>{tx("gamificationProfileAchievements", "Unlocked achievements", "الإنجازات المفتوحة")}</h3>
              {selectedParticipant.profile.achievements.slice(0, 6).length > 0
                ? selectedParticipant.profile.achievements.slice(0, 6).map((item, index) => (
                  <div className="g-profile-achievement" key={`${item.achievementId}-${index}`}>
                    <strong>{localizedBackendText(item.titleKey, "title")}</strong>
                    <span>{localizedBackendText(item.descriptionKey, "description")}</span>
                  </div>
                ))
                : <p className="g-subtle">{tx("gamificationNoPublicAchievements", "No public achievements to show yet.", "لا توجد إنجازات عامة لعرضها بعد.")}</p>}
            </>}
      </section>
    );
  };

  const renderLeaderboard = () => {
    if (selectedParticipant) return renderPublicProfile();
    if (loading.leaderboard && !leaderboard) return skeleton(5);
    if (errors.leaderboard) return renderError(tx("gamificationLeaderboardError", "The leaderboard could not be loaded.", "تعذر تحميل لوحة النقاط."), () => void loadLeaderboard(scope));
    const data = leaderboard?.scope === scope ? leaderboard : null;
    const season = data?.season;
    const snapshotStatus = data?.isStale ? "stale"
      : season?.status === "CLOSED" ? "final"
        : season?.status === "UPCOMING" ? "upcoming" : "live";
    const statusKey = snapshotStatus === "stale" ? "gamificationStale"
      : snapshotStatus === "final" ? "gamificationFinal"
        : snapshotStatus === "upcoming" ? "gamificationUpcoming" : "gamificationLive";
    const statusFallback: Record<string, [string, string]> = {
      stale: ["Snapshot may be out of date", "قد تكون اللقطة غير محدثة"],
      final: ["Final snapshot", "لقطة نهائية"],
      upcoming: ["Season upcoming", "الموسم قادم"],
      live: ["Live snapshot", "لقطة مباشرة"],
    };
    return (
      <div className="g-tab-panel">
        <div className="g-scope-row" role="group" aria-label={tx("gamificationScopeLabel", "Snapshot period", "فترة اللقطة")}>
          {SCOPES.map((item) => <button type="button" className="g-scope" key={item} aria-pressed={scope === item} onClick={() => { setScope(item); setLeaderboard(null); setOwnRank(null); setErrors((old) => ({ ...old, leaderboard: false })); setCursorHasExpired(false); closeParticipant(); }}>{scopeLabel(item)}</button>)}
        </div>
        <section className="g-card">
          <div className="g-leaderboard-head">
            <div>
              <h2>{tx("gamificationLeaderboard", "Leaderboard", "لوحة النقاط")} · {scopeLabel(scope)}</h2>
              <p className="g-subtle">{tx("gamificationRankIntro", "A snapshot of study engagement points", "لقطة لنقاط التفاعل الدراسي")}</p>
              {season && <div className="g-season">
                <span><CalendarDays size={13} style={{ verticalAlign: "middle" }} /> {formatDate(season.startsAt, locale, { year: "numeric" })} – {formatDate(season.endsAt, locale, { year: "numeric" })}</span>
                <span>{tx("gamificationGenerated", "Updated", "تم التحديث")}: {formatDate(data?.generatedAt, locale, { hour: "numeric", minute: "2-digit" })}</span>
                <span>{tx("gamificationScoresThrough", "Points through", "النقاط حتى")}: {formatDate(data?.scoreThrough, locale, { hour: "numeric", minute: "2-digit" })}</span>
              </div>}
            </div>
            {data && <span className={`g-semantics ${snapshotStatus === "stale" ? "stale" : ""}`}>{tx(statusKey, ...statusFallback[snapshotStatus])}</span>}
          </div>
          <p className="g-footer-note" style={{ textAlign: isRtl ? "right" : "left", margin: "12px 0 0" }}>{tx("gamificationRankDisclaimer", "This is an engagement measure only—not an academic ranking.", "هذا مقياس للتفاعل فقط، وليس ترتيبًا أكاديميًا.")}</p>
          {rankLoading && <div className="g-own-rank" role="status" aria-live="polite">
            <div className="g-own-rank-badge"><LoaderCircle size={17} /></div>
            <div><strong>{tx("gamificationRankLoading", "Loading your position", "جارٍ تحميل ترتيبك")}</strong><span>{tx("gamificationRankLoadingHint", "Checking your place in this server snapshot.", "جارٍ التحقق من ترتيبك في لقطة الخادم.")}</span></div>
          </div>}
          {rankError && <div className="g-rank-error" role="alert">
            <span>{tx("gamificationRankError", "Your position could not be loaded.", "تعذر تحميل ترتيبك.")}</span>
            <button type="button" className="g-action" onClick={() => setRankRetrySerial((serial) => serial + 1)}>{tx("gamificationRetry", "Try again", "حاول مجددًا")}</button>
          </div>}
          {ownRank && <div className="g-own-rank" aria-label={tx("gamificationYourPlace", "Your place", "ترتيبك")}>
            <div className="g-own-rank-badge">{ownRank.notRanked || ownRank.rank === null ? "—" : formatNumber(ownRank.rank)}</div>
            <div><strong>{ownRank.notRanked || ownRank.rank === null ? tx("gamificationNotRanked", "Not ranked in this snapshot", "غير مدرج في هذه اللقطة") : tx("gamificationYourPlace", "Your place", "ترتيبك")}</strong>
              <span>{ownRank.notRanked || ownRank.rank === null
                ? ownRank.score === 0
                  ? tx("gamificationNoRankScore", "No engagement points recorded for this season.", "لا توجد نقاط تفاعل مسجلة لهذا الموسم.")
                  : tx("gamificationUnrankedWithScore", "Your points are not ranked in this snapshot.", "نقاطك غير مدرجة في ترتيب هذه اللقطة.")
                : `${formatNumber(ownRank.totalRankedUsers)} ${tx("gamificationRankedUsers", "ranked participants", "مشاركًا مدرجًا")}${ownRank.tieSize && ownRank.tieSize > 1 ? ` · ${formatNumber(ownRank.tieSize)} ${tx("gamificationTie", "tied", "تعادل")}` : ""}`}</span>
            </div>
            <div className="g-own-score">{formatNumber(ownRank.score)}<span style={{ fontSize: 10, display: "block", fontWeight: 500 }}>{tx("gamificationScore", "Points", "النقاط")}</span></div>
          </div>}
          {loading.leaderboard && !data ? skeleton(4) : null}
          {cursorHasExpired && <div className="g-period-note" role="status">{tx("gamificationCursorExpired", "This snapshot has changed. Reload to see the latest list.", "تغيرت هذه اللقطة. أعد التحميل لعرض القائمة الأحدث.")}<button type="button" className="g-action" style={{ marginInlineStart: 10 }} onClick={() => void loadLeaderboard(scope)}>{tx("gamificationReload", "Reload snapshot", "إعادة تحميل اللقطة")}</button></div>}
          {data && <>
            {data.entries.length ? <div className="g-board-list">
              {data.entries.map((entry, index) => (
                <button type="button" className="g-participant" key={`${entry.rank}-${entry.userId}-${index}`} onClick={() => void openParticipant(entry)} aria-label={`${tx("gamificationParticipantOpen", "View safe public progress", "عرض التقدم العام الآمن")}: ${tx("gamificationParticipant", "Anonymous participant", "مشارك مجهول")}. ${tx("gamificationYourPlace", "Your place", "ترتيبك")} ${formatNumber(entry.rank)}${entry.tieSize > 1 ? `, ${formatNumber(entry.tieSize)} ${tx("gamificationTie", "tied", "تعادل")}` : ""}. ${entry.level === null ? "" : `${tx("gamificationLevelShort", "Level", "المستوى")} ${formatNumber(entry.level)}. `}${formatNumber(entry.score)} ${tx("gamificationScore", "Study Points", "نقاط الدراسة")}`}>
                  <span className="g-rank-number">{formatNumber(entry.rank)}</span>
                  <span className="g-anon-mark" aria-hidden="true"><UsersRound size={17} /></span>
                  <span className="g-participant-label">{tx("gamificationParticipant", "Anonymous participant", "مشارك مجهول")}<span className="g-participant-meta">{entry.level === null ? "—" : `${tx("gamificationLevelShort", "Level", "المستوى")} ${formatNumber(entry.level)}`}{entry.tieSize > 1 ? ` · ${formatNumber(entry.tieSize)} ${tx("gamificationTie", "tied", "تعادل")}` : ""}</span></span>
                  <span className="g-score">{formatNumber(entry.score)} <span style={{ fontSize: 10, color: "var(--g-muted)" }}>{tx("gamificationScore", "Points", "النقاط")}</span></span>
                </button>
              ))}
            </div> : <div className="g-empty"><div className="g-empty-mark"><Trophy size={20} /></div><h3>{tx("gamificationNoLeaderboardEntries", "No leaderboard entries", "لا توجد نتائج في لوحة النقاط")}</h3><p>{tx("gamificationNoRankedParticipants", "There are no ranked participants in this snapshot.", "لا يوجد مشاركون مدرجون في ترتيب هذه اللقطة.")}</p></div>}
            {data.nextCursor && !cursorHasExpired && <div style={{ display: "flex", justifyContent: "center", paddingTop: 16 }}>
              <button type="button" className="g-action" onClick={loadMore} disabled={loadingMore}>{loadingMore ? <LoaderCircle size={15} className="g-spin" /> : null}{loadingMore ? tx("gamificationLoadingMore", "Loading more", "جارٍ تحميل المزيد") : tx("gamificationLoadMore", "Load more", "تحميل المزيد")}</button>
            </div>}
          </>}
        </section>
      </div>
    );
  };

  const tabs: { id: GamificationTab; label: string }[] = [
    { id: "overview", label: tx("gamificationOverview", "Overview", "نظرة عامة") },
    { id: "achievements", label: tx("gamificationAchievements", "Achievements", "الإنجازات") },
    { id: "challenges", label: tx("gamificationChallenges", "Challenges", "التحديات") },
    { id: "leaderboard", label: tx("gamificationLeaderboard", "Leaderboard", "لوحة النقاط") },
  ];
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;

  return (
    <main className="gamification" dir={isRtl ? "rtl" : "ltr"}>
      <div className="g-shell">
        <div className="g-topbar">
          <button type="button" className="g-icon-button" onClick={onBack} aria-label={tx("gamificationBack", "Back", "رجوع")}><BackIcon size={19} /></button>
          <span className="g-top-title">{tx("gamificationTitle", "Study engagement", "التفاعل الدراسي")}</span>
        </div>
        <header className="g-hero">
          <div>
            <p className="g-eyebrow">{tx("gamificationEyebrow", "Your progress, at your pace", "تقدمك، بإيقاعك")}</p>
            <h1>{tx("gamificationTitle", "Study engagement", "التفاعل الدراسي")}</h1>
            <p className="g-hero-copy">{tx("gamificationSubtitle", "A private view of verified study engagement. Points reflect recorded activity, not academic ability.", "عرض خاص لتفاعلك الدراسي الموثّق. تعكس النقاط النشاط المسجل، لا القدرة الأكاديمية.")}</p>
          </div>
          <button type="button" className="g-action g-refresh" onClick={() => void refresh()} disabled={loading.summary || loading.leaderboard}>
            <RefreshCw size={15} /> {loading.summary || loading.leaderboard ? tx("gamificationRefreshing", "Refreshing", "جارٍ التحديث") : tx("gamificationRefresh", "Refresh", "تحديث")}
          </button>
        </header>
        <nav className="g-tabs" aria-label={tx("gamificationTitle", "Study engagement", "التفاعل الدراسي")}>
          {tabs.map((item) => <button type="button" key={item.id} className="g-tab" aria-current={tab === item.id ? "page" : undefined} onClick={() => { setTab(item.id); closeParticipant(); }}>{item.label}</button>)}
        </nav>
        <div className="g-content">
          {tab === "overview" && renderOverview()}
          {tab === "achievements" && renderAchievements()}
          {tab === "challenges" && renderChallenges()}
          {tab === "leaderboard" && renderLeaderboard()}
        </div>
      </div>
    </main>
  );
}

export default GamificationFrontend;