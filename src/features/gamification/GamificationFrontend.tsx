import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Award, CalendarDays, Check, ChevronDown,
  CircleHelp, Clock3, LoaderCircle, Medal,
  Sparkles, Target, Trophy, UsersRound, LockKeyhole,
} from "lucide-react";
import { useTranslation, type Language } from "../../core/i18n/translations";
import { gamificationApi } from "./api";
import {
  GAMIFICATION_INVALIDATED_EVENT,
  GAMIFICATION_OPTIMISTIC_POINTS_EVENT,
  GAMIFICATION_SOCKET_RECONNECTED_EVENT,
  acknowledgeCommittedOptimisticStudyPoints,
  getOptimisticStudyPointsDelta,
  resourcesForGamificationReconnect,
  setGamificationReadAccountScope,
  type GamificationInvalidationDetail,
  type GamificationSyncResource,
} from "./realtime";
import type {
  Achievement, AchievementsResponse, ChallengesResponse, ChallengeItem, GamificationSummary, UnlockHistory,
  GamificationTab, LeaderboardResponse, LeaderboardScope, OwnRankResponse,
} from "./types";
import { LeaderboardView } from "./LeaderboardView";
import { GamificationFeatureState } from "./GamificationFeatureState";
import "./gamification.css";

export interface GamificationFrontendProps {
  accountId?: string | null;
  language: "en" | "ar";
  studyPointsEnabled: boolean;
  gamificationEnabled: boolean;
  featureFlagsStatus: "loading" | "ready" | "unavailable";
  onRetryFeatureFlags: () => void;
  initialTab?: GamificationTab;
  navigationRequest?: number;
}

type ApiFailure = Error & { status?: number; body?: { error?: unknown; code?: unknown; message?: unknown } };
type LoadingSet = { summary: boolean; achievements: boolean; challenges: boolean; leaderboard: boolean };
type AchievementStatus = "unlocked" | "in-progress" | "locked";

const SCOPES: LeaderboardScope[] = ["WEEKLY", "MONTHLY", "SEMESTER", "ALL_TIME"];
const INITIAL_LEADERBOARD_PAGE_SIZE = 50;
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

function isSemesterConfigurationUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as ApiFailure).body?.code;
  return code === "LEADERBOARD_SEASON_CONFIGURATION_MISSING"
    || code === "LEADERBOARD_SEASON_CONFIGURATION_CONFLICT";
}

function isFeatureDisabledError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && (error as ApiFailure).body?.code === "FEATURE_DISABLED",
  );
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

export function GamificationFrontend({
  accountId = null,
  language,
  studyPointsEnabled,
  gamificationEnabled,
  featureFlagsStatus,
  onRetryFeatureFlags,
  initialTab = "overview",
  navigationRequest = 0,
}: GamificationFrontendProps) {
  const { t } = useTranslation(language);
  const tGlobal = t as (key: string) => string;
  const isRtl = language === "ar";
  const locale = language === "ar" ? "ar-IQ" : "en";
  const [tab, setTab] = useState<GamificationTab>(initialTab);
  const [scope, setScope] = useState<LeaderboardScope>("WEEKLY");
  const [availableScopes, setAvailableScopes] = useState<LeaderboardScope[]>(
    () => SCOPES.filter((item) => item !== "SEMESTER"),
  );
  const [summary, setSummary] = useState<GamificationSummary | null>(null);
  const [achievements, setAchievements] = useState<AchievementsResponse | null>(null);
  const [challenges, setChallenges] = useState<ChallengesResponse | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse | null>(null);
  const [ownRank, setOwnRank] = useState<OwnRankResponse | null>(null);
  const [loading, setLoading] = useState<LoadingSet>({
    summary: true, achievements: true, challenges: true,
    leaderboard: initialTab === "leaderboard",
  });
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [disabled, setDisabled] = useState<Record<string, boolean>>({});
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursorHasExpired, setCursorHasExpired] = useState(false);
  const [rankLoading, setRankLoading] = useState(false);
  const [rankError, setRankError] = useState(false);
  const [rankRetrySerial, setRankRetrySerial] = useState(0);
  const [overviewRank, setOverviewRank] = useState<OwnRankResponse | null>(null);
  const [overviewRankLoading, setOverviewRankLoading] = useState(false);
  const [overviewRankError, setOverviewRankError] = useState(false);
  const [overviewRankRetrySerial, setOverviewRankRetrySerial] = useState(0);
  const [optimisticPointDelta, setOptimisticPointDelta] = useState(() => getOptimisticStudyPointsDelta());
  const summaryGeneration = useRef(0);
  const achievementsGeneration = useRef(0);
  const challengesGeneration = useRef(0);
  const leaderboardGeneration = useRef(0);
  const leaderboardRequestingScope = useRef<LeaderboardScope | null>(null);
  const rankGeneration = useRef(0);
  const overviewRankGeneration = useRef(0);
  const warnedPointMismatch = useRef(false);
  const currentTab = useRef(tab);
  const currentScope = useRef(scope);
  const currentLeaderboard = useRef(leaderboard);
  const currentOverviewRank = useRef(overviewRank);
  const currentOwnRank = useRef(ownRank);
  const currentAccountId = useRef<string | null>(accountId);
  const resourceRefreshScheduled = useRef(false);
  const resourceRefreshMounted = useRef(true);
  const leaderboardWarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  currentTab.current = tab;
  currentScope.current = scope;
  currentLeaderboard.current = leaderboard;
  currentOverviewRank.current = overviewRank;
  currentOwnRank.current = ownRank;
  currentAccountId.current = accountId;

  useEffect(() => {
    const syncOptimisticPoints = () => {
      setOptimisticPointDelta(getOptimisticStudyPointsDelta());
    };
    syncOptimisticPoints();
    window.addEventListener(GAMIFICATION_OPTIMISTIC_POINTS_EVENT, syncOptimisticPoints);
    return () => {
      window.removeEventListener(GAMIFICATION_OPTIMISTIC_POINTS_EVENT, syncOptimisticPoints);
    };
  }, [accountId]);
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

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

  const loadSummary = useCallback(async () => {
    const account = currentAccountId.current;
    const requestId = ++summaryGeneration.current;
    setErrors((old) => ({ ...old, summary: false }));
    setDisabled((old) => ({ ...old, summary: false }));
    setLoading((old) => ({ ...old, summary: true }));
    try {
      const data = await gamificationApi.summary();
      if (
        summaryGeneration.current === requestId &&
        currentAccountId.current === account
      ) {
        setSummary(data);
        setAchievements({
          ruleSetVersion: data.ruleSetVersion,
          achievements: data.achievements,
          unlockHistory: data.unlockHistory,
        });
        setErrors((old) => ({ ...old, achievements: false }));
        setDisabled((old) => ({ ...old, achievements: false }));
        setDisabled((old) => ({ ...old, summary: false }));
      }
    } catch (error) {
      if (
        summaryGeneration.current === requestId &&
        currentAccountId.current === account
      ) {
        setErrors((old) => ({ ...old, summary: true }));
        setLoading((old) => ({ ...old, achievements: false }));
        const isDisabled = isFeatureDisabledError(error);
        setDisabled((old) => ({ ...old, summary: isDisabled }));
        if (isDisabled) {
          setSummary(null);
          setAchievements(null);
        }
      }
    } finally {
      if (
        summaryGeneration.current === requestId &&
        currentAccountId.current === account
      ) setLoading((old) => ({ ...old, summary: false, achievements: false }));
    }
  }, []);

  const loadAchievements = useCallback(async () => {
    const account = currentAccountId.current;
    const requestId = ++achievementsGeneration.current;
    setErrors((old) => ({ ...old, achievements: false }));
    setDisabled((old) => ({ ...old, achievements: false }));
    setLoading((old) => ({ ...old, achievements: true }));
    try {
      const data = await gamificationApi.achievements();
      if (
        achievementsGeneration.current === requestId &&
        currentAccountId.current === account
      ) {
        setAchievements(data);
        setDisabled((old) => ({ ...old, achievements: false }));
      }
    } catch (error) {
      if (
        achievementsGeneration.current === requestId &&
        currentAccountId.current === account
      ) {
        setErrors((old) => ({ ...old, achievements: true }));
        const isDisabled = isFeatureDisabledError(error);
        setDisabled((old) => ({ ...old, achievements: isDisabled }));
        if (isDisabled) setAchievements(null);
      }
    } finally {
      if (
        achievementsGeneration.current === requestId &&
        currentAccountId.current === account
      ) setLoading((old) => ({ ...old, achievements: false }));
    }
  }, []);

  const loadChallenges = useCallback(async () => {
    const account = currentAccountId.current;
    const requestId = ++challengesGeneration.current;
    setErrors((old) => ({ ...old, challenges: false }));
    setDisabled((old) => ({ ...old, challenges: false }));
    setLoading((old) => ({ ...old, challenges: true }));
    try {
      const data = await gamificationApi.challenges();
      if (
        challengesGeneration.current === requestId &&
        currentAccountId.current === account
      ) {
        setChallenges(data);
        setDisabled((old) => ({ ...old, challenges: false }));
      }
    } catch (error) {
      if (
        challengesGeneration.current === requestId &&
        currentAccountId.current === account
      ) {
        setErrors((old) => ({ ...old, challenges: true }));
        const isDisabled = isFeatureDisabledError(error);
        setDisabled((old) => ({ ...old, challenges: isDisabled }));
        if (isDisabled) setChallenges(null);
      }
    } finally {
      if (
        challengesGeneration.current === requestId &&
        currentAccountId.current === account
      ) setLoading((old) => ({ ...old, challenges: false }));
    }
  }, []);

  const loadPrivateData = useCallback(async () => {
    if (featureFlagsStatus !== "ready" || !gamificationEnabled) return;
    await loadSummary();
  }, [featureFlagsStatus, gamificationEnabled, loadSummary]);

  const loadOverviewRank = useCallback(async () => {
    if (featureFlagsStatus !== "ready" || !gamificationEnabled) return;
    const account = currentAccountId.current;
    const requestId = ++overviewRankGeneration.current;
    setOverviewRank(null);
    setOverviewRankError(false);
    setOverviewRankLoading(true);
    try {
      const result = await gamificationApi.ownRank("WEEKLY");
      if (
        overviewRankGeneration.current === requestId &&
        currentAccountId.current === account
      ) {
        acknowledgeCommittedOptimisticStudyPoints();
        setOverviewRank(result);
      }
    } catch {
      if (
        overviewRankGeneration.current === requestId &&
        currentAccountId.current === account
      ) {
        setOverviewRank(null);
        setOverviewRankError(true);
      }
    } finally {
      if (
        overviewRankGeneration.current === requestId &&
        currentAccountId.current === account
      ) setOverviewRankLoading(false);
    }
  }, [featureFlagsStatus, gamificationEnabled]);

  const loadLeaderboardAvailability = useCallback(async () => {
    let semesterAvailable = false;
    try {
      const availability = await gamificationApi.leaderboardAvailability();
      semesterAvailable = Array.isArray(availability?.scopes)
        && availability.scopes.includes("SEMESTER");
    } catch {
      // Keep non-semester views available when the availability check fails.
    }
    const nextScopes = SCOPES.filter((item) =>
      item !== "SEMESTER" || semesterAvailable);
    setAvailableScopes(nextScopes);
    if (!semesterAvailable && currentScope.current === "SEMESTER") {
      setScope("WEEKLY");
      setLeaderboard(null);
      setOwnRank(null);
      setRankLoading(false);
      setRankError(false);
      setErrors((old) => ({ ...old, leaderboard: false }));
      setCursorHasExpired(false);
    }
    return semesterAvailable;
  }, []);

  const warmLeaderboardScopes = useCallback(async () => {
    const availability = loadLeaderboardAvailability();
    const firstPage = gamificationApi
      .leaderboard(currentScope.current, null, INITIAL_LEADERBOARD_PAGE_SIZE)
      .catch(() => null);
    await Promise.all([availability, firstPage]);
  }, [loadLeaderboardAvailability]);

  const loadLeaderboard = useCallback(async (nextScope: LeaderboardScope, append = false) => {
    if (featureFlagsStatus !== "ready" || !gamificationEnabled) return;
    if (append && !leaderboard?.nextCursor) return;
    const account = currentAccountId.current;
    const requestId = ++leaderboardGeneration.current;
    leaderboardRequestingScope.current = nextScope;
    if (!append && currentLeaderboard.current?.scope !== nextScope) {
      setLeaderboard(null);
      setOwnRank(null);
      setRankError(false);
      setRankLoading(false);
    }
    setLoading((old) => ({ ...old, leaderboard: true }));
    setErrors((old) => ({ ...old, leaderboard: false }));
    if (!append) setDisabled((old) => ({ ...old, leaderboard: false }));
    try {
      const cursor = append ? leaderboard?.nextCursor : null;
      const result = await gamificationApi.leaderboard(
        nextScope,
        cursor,
        INITIAL_LEADERBOARD_PAGE_SIZE,
      );
      if (
        leaderboardGeneration.current !== requestId ||
        currentScope.current !== nextScope ||
        currentAccountId.current !== account
      ) return;
      setLeaderboard((old) => {
        if (!append || old?.scope !== nextScope) return result;
        return { ...result, entries: [...old.entries, ...result.entries] };
      });
      setDisabled((old) => ({ ...old, leaderboard: false }));
      setCursorHasExpired(false);
      setOwnRank(null);
    } catch (error) {
      if (
        leaderboardGeneration.current !== requestId ||
        currentAccountId.current !== account
      ) return;
      if (append && cursorExpired(error)) {
        setLeaderboard(null);
        setOwnRank(null);
        setRankLoading(false);
        setCursorHasExpired(true);
      } else if (
        nextScope === "SEMESTER"
        && isSemesterConfigurationUnavailable(error)
      ) {
        setAvailableScopes((old) => old.filter((item) => item !== "SEMESTER"));
        if (currentScope.current === "SEMESTER") setScope("WEEKLY");
        setLeaderboard(null);
        setOwnRank(null);
        setRankLoading(false);
        setRankError(false);
        setErrors((old) => ({ ...old, leaderboard: false }));
        setCursorHasExpired(false);
      } else {
        setLeaderboard(null);
        setOwnRank(null);
        setRankLoading(false);
        setErrors((old) => ({ ...old, leaderboard: true }));
        setDisabled((old) => ({
          ...old,
          leaderboard: isFeatureDisabledError(error),
        }));
      }
    } finally {
      if (
        leaderboardGeneration.current === requestId &&
        currentAccountId.current === account
      ) {
        leaderboardRequestingScope.current = null;
        setLoading((old) => ({ ...old, leaderboard: false }));
        setLoadingMore(false);
      }
    }
  }, [featureFlagsStatus, gamificationEnabled, leaderboard]);

  const refreshResources = useCallback(async (
    resources: readonly GamificationSyncResource[],
  ) => {
    const jobs: Promise<unknown>[] = [];
    if (resources.includes("summary")) jobs.push(loadSummary());
    if (resources.includes("achievements")) jobs.push(loadAchievements());
    if (resources.includes("challenges")) jobs.push(loadChallenges());
    if (
      resources.includes("leaderboard") &&
      (currentTab.current === "leaderboard" || currentLeaderboard.current !== null)
    ) {
      jobs.push(loadLeaderboard(currentScope.current));
    }
    if (
      resources.includes("rank") &&
      (currentTab.current === "overview" || currentOverviewRank.current !== null)
    ) {
      jobs.push(loadOverviewRank());
    }
    if (
      resources.includes("rank") &&
      currentTab.current === "leaderboard" &&
      !resources.includes("leaderboard")
    ) {
      setRankRetrySerial((value) => value + 1);
    }
    await Promise.all(jobs);
  }, [
    loadAchievements,
    loadChallenges,
    loadLeaderboard,
    loadOverviewRank,
    loadSummary,
  ]);

  const pendingResources = useRef(new Set<GamificationSyncResource>());
  const queueResourceRefresh = useCallback((
    resources: readonly GamificationSyncResource[],
  ) => {
    resources.forEach((resource) => pendingResources.current.add(resource));
    if (resourceRefreshScheduled.current) return;
    resourceRefreshScheduled.current = true;
    queueMicrotask(() => {
      resourceRefreshScheduled.current = false;
      if (!resourceRefreshMounted.current) return;
      const queued = [...pendingResources.current];
      pendingResources.current.clear();
      void refreshResources(queued);
    });
  }, [refreshResources]);

  useEffect(() => {
    const onInvalidated = (event: Event) => {
      const detail = (event as CustomEvent<GamificationInvalidationDetail>).detail;
      if (!detail?.resources?.length) return;
      if (detail.resources.includes("leaderboard")) {
        if (leaderboardWarmTimer.current) clearTimeout(leaderboardWarmTimer.current);
        leaderboardWarmTimer.current = setTimeout(() => {
          leaderboardWarmTimer.current = null;
          void warmLeaderboardScopes();
        }, 350);
      }
      queueResourceRefresh(detail.resources);
    };
    const onReconnect = () => {
      void warmLeaderboardScopes();
      queueResourceRefresh(resourcesForGamificationReconnect(currentTab.current, {
        leaderboard: currentLeaderboard.current !== null,
        rank: currentOwnRank.current !== null || currentOverviewRank.current !== null,
      }));
    };
    window.addEventListener(GAMIFICATION_INVALIDATED_EVENT, onInvalidated);
    window.addEventListener(GAMIFICATION_SOCKET_RECONNECTED_EVENT, onReconnect);
    resourceRefreshMounted.current = true;
    return () => {
      resourceRefreshMounted.current = false;
      if (leaderboardWarmTimer.current) clearTimeout(leaderboardWarmTimer.current);
      leaderboardWarmTimer.current = null;
      window.removeEventListener(GAMIFICATION_INVALIDATED_EVENT, onInvalidated);
      window.removeEventListener(GAMIFICATION_SOCKET_RECONNECTED_EVENT, onReconnect);
      pendingResources.current.clear();
    };
  }, [queueResourceRefresh, warmLeaderboardScopes]);

  const refresh = useCallback(async () => {
    const activeTab = currentTab.current;
    const activeScope = currentScope.current;
    const privatePromise = loadPrivateData();
    const availabilityPromise = loadLeaderboardAvailability();
    if (activeTab === "leaderboard") {
      const semesterAvailable = await availabilityPromise;
      const leaderboardPromise = activeScope === "SEMESTER" && !semesterAvailable
        ? Promise.resolve()
        : loadLeaderboard(activeScope);
      await Promise.all([privatePromise, leaderboardPromise]);
    } else if (activeTab === "overview") {
      await Promise.all([privatePromise, loadOverviewRank(), availabilityPromise]);
    } else await Promise.all([privatePromise, availabilityPromise]);
  }, [
    loadLeaderboard,
    loadLeaderboardAvailability,
    loadOverviewRank,
    loadPrivateData,
  ]);

  useEffect(() => {
    setGamificationReadAccountScope(accountId);
    setSummary(null);
    setAchievements(null);
    setChallenges(null);
    setLeaderboard(null);
    setOwnRank(null);
    setOverviewRank(null);
    setAvailableScopes(SCOPES.filter((item) => item !== "SEMESTER"));
    setCursorHasExpired(false);
    setErrors({});
    setDisabled({});
    setLoading({
      summary: true,
      achievements: true,
      challenges: currentTab.current === "challenges",
      leaderboard: currentTab.current === "leaderboard",
    });
    setOverviewRank(null);
    setOverviewRankLoading(false);
    setOverviewRankError(false);
    if (featureFlagsStatus === "ready" && gamificationEnabled) {
      // Prime every first-view resource immediately after authentication.
      // These are independent reads; the shared API cache deduplicates the
      // weekly leaderboard request also started by the selected-tab effect.
      void loadPrivateData();
      void loadAchievements();
      void loadChallenges();
      void loadOverviewRank();
      void warmLeaderboardScopes();
    }
    return () => {
      summaryGeneration.current += 1;
      achievementsGeneration.current += 1;
      challengesGeneration.current += 1;
      leaderboardGeneration.current += 1;
      rankGeneration.current += 1;
      overviewRankGeneration.current += 1;
    };
  }, [
    accountId,
    featureFlagsStatus,
    gamificationEnabled,
    loadChallenges,
    loadAchievements,
    loadOverviewRank,
    loadPrivateData,
    warmLeaderboardScopes,
  ]);
  useEffect(() => {
    if (navigationRequest > 0) setTab("leaderboard");
  }, [navigationRequest]);
  useEffect(() => {
    if (
      featureFlagsStatus === "ready"
      && gamificationEnabled
      && tab === "overview"
      && !overviewRank
      && !overviewRankLoading
      && !overviewRankError
    ) {
      void loadOverviewRank();
    }
  }, [
    accountId,
    featureFlagsStatus,
    gamificationEnabled,
    tab,
    overviewRank,
    overviewRankLoading,
    overviewRankError,
    overviewRankRetrySerial,
    loadOverviewRank,
  ]);
  useEffect(() => {
    if (featureFlagsStatus !== "ready" || !gamificationEnabled) return;
    if (tab === "achievements" && !achievements && !loading.achievements) {
      void loadAchievements();
    } else if (tab === "challenges" && !challenges && !loading.challenges) {
      void loadChallenges();
    }
  }, [
    accountId,
    achievements,
    challenges,
    featureFlagsStatus,
    gamificationEnabled,
    loading.achievements,
    loading.challenges,
    loadAchievements,
    loadChallenges,
    tab,
  ]);
  useEffect(() => {
    if (featureFlagsStatus === "ready" && gamificationEnabled
        && tab === "leaderboard" && !cursorHasExpired &&
        (!leaderboard || leaderboard.scope !== scope) &&
        leaderboardRequestingScope.current !== scope) void loadLeaderboard(scope);
  }, [accountId, featureFlagsStatus, gamificationEnabled, tab, scope, leaderboard?.scope, cursorHasExpired, loadLeaderboard]);
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
    const account = currentAccountId.current;
    void gamificationApi.ownRank(scope, seasonKey)
      .then((rank) => {
        if (
          !cancelled &&
          rankGeneration.current === requestId &&
          currentAccountId.current === account
        ) {
          acknowledgeCommittedOptimisticStudyPoints();
          setOwnRank(rank);
        }
      })
      .catch(() => {
        if (
          !cancelled &&
          rankGeneration.current === requestId &&
          currentAccountId.current === account
        ) setRankError(true);
      })
      .finally(() => {
        if (
          !cancelled &&
          rankGeneration.current === requestId &&
          currentAccountId.current === account
        ) setRankLoading(false);
      });
    return () => { cancelled = true; };
  }, [accountId, leaderboard?.season.seasonKey, leaderboard?.scope, scope, tab, rankRetrySerial]);
  useEffect(() => {
    let lastRefresh = 0;
    const onForeground = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRefresh < 1200) return;
      lastRefresh = now;
      if (featureFlagsStatus === "unavailable") onRetryFeatureFlags();
      void refresh();
    };
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("focus", onForeground);
    return () => {
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("focus", onForeground);
    };
  }, [featureFlagsStatus, onRetryFeatureFlags, refresh]);

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
  const categorizedLedgerTotal = summary
    ? summary.points.ledgerPoints - summary.points.legacyLedgerPoints
    : 0;
  const pointTotalsDisagree = Boolean(summary && categoryTotal !== categorizedLedgerTotal);
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
      {tx("gamificationPrivateStale", "Some progress may be out of date. It will sync automatically when the server reconnects.", "قد لا يكون بعض التقدم محدثًا. ستتم مزامنته تلقائيًا عند عودة الاتصال بالخادم.")}
    </div>
    : null;
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

  const renderError = (title: string) => (
    <div className="g-error" role="alert">
      <div className="g-empty-mark"><CircleHelp size={21} /></div>
      <h3>{title}</h3>
      <p>{tx("gamificationLoadError", "We couldn't load this progress just now.", "تعذر تحميل هذا التقدم الآن.")}</p>
    </div>
  );

  const renderDisabled = (title: string) => (
    <div className="g-empty" role="status">
      <div className="g-empty-mark"><LockKeyhole size={21} /></div>
      <h3>{title}</h3>
      <p>{tx("gamificationDisabledHint", "This study engagement feature is currently disabled.", "ميزة التفاعل الدراسي هذه معطلة حاليًا.")}</p>
    </div>
  );

  const skeleton = (count: number) => (
    <div aria-label={tx("gamificationRefreshing", "Refreshing", "جارٍ التحديث")} aria-busy="true">
      {Array.from({ length: count }, (_, index) => <div className="g-skeleton g-skeleton-card" key={index} />)}
    </div>
  );

  const effectiveOverviewRank = overviewRank
    ? { ...overviewRank, score: overviewRank.score + optimisticPointDelta }
    : overviewRank;
  const effectiveOwnRank = ownRank
    ? { ...ownRank, score: ownRank.score + optimisticPointDelta }
    : ownRank;

  const renderOverview = () => {
    if (loading.summary && !summary) return skeleton(3);
    if (disabled.summary && !summary) return renderDisabled(tx("gamificationDisabled", "Study engagement is disabled.", "التفاعل الدراسي معطل."));
    if (errors.summary && !summary) return renderError(tx("gamificationOverviewError", "Your engagement summary could not be loaded.", "تعذر تحميل ملخص التفاعل."));
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
          {studyPointsEnabled && <section className="g-card g-points-card" aria-labelledby="g-points-heading">
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
          </section>}
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
              {effectiveOverviewRank && <p className="g-subtle">
                {formatDate(effectiveOverviewRank.season.startsAt, locale, { year: "numeric" })} – {formatDate(effectiveOverviewRank.season.endsAt, locale, { year: "numeric" })}
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
          </div>}
          {effectiveOverviewRank && <div className="g-own-rank" aria-label={tx("gamificationYourPlace", "Your place", "ترتيبك")}>
            <div className="g-own-rank-badge">{effectiveOverviewRank.notRanked || effectiveOverviewRank.rank === null ? "—" : formatNumber(effectiveOverviewRank.rank)}</div>
            <div>
              <strong>{effectiveOverviewRank.notRanked || effectiveOverviewRank.rank === null
                ? tx("gamificationNotRanked", "Not ranked in this snapshot", "غير مدرج في هذه اللقطة")
                : tx("gamificationYourPlace", "Your place", "ترتيبك")}</strong>
              <span>{effectiveOverviewRank.notRanked || effectiveOverviewRank.rank === null
                ? effectiveOverviewRank.score === 0
                  ? tx("gamificationNoRankScore", "No engagement points recorded for this season.", "لا توجد نقاط تفاعل مسجلة لهذا الموسم.")
                  : tx("gamificationUnrankedWithScore", "Your points are not ranked in this snapshot.", "نقاطك غير مدرجة في ترتيب هذه اللقطة.")
                : `${formatNumber(effectiveOverviewRank.totalRankedUsers)} ${tx("gamificationRankedUsers", "ranked participants", "مشاركًا مدرجًا")}${effectiveOverviewRank.tieSize && effectiveOverviewRank.tieSize > 1 ? ` · ${formatNumber(effectiveOverviewRank.tieSize)} ${tx("gamificationTie", "tied", "تعادل")}` : ""}`}</span>
            </div>
            <div className="g-own-score">
              {effectiveOverviewRank.notRanked && effectiveOverviewRank.score === 0 ? "—" : formatNumber(effectiveOverviewRank.score)}
              <span style={{ fontSize: 10, display: "block", fontWeight: 500 }}>{tx("gamificationScore", "Points", "النقاط")}</span>
            </div>
          </div>}
        </section>
      </div>
    );
  };

  const renderAchievements = () => (
    <div className="g-tab-panel">
      <div className="g-section-head"><div><h2>{tx("gamificationAchievements", "Achievements", "الإنجازات")}</h2><p>{tx("gamificationRuleInfo", "Progress is verified by the server.", "يتم التحقق من التقدم بواسطة الخادم.")}</p></div></div>
        {privateStaleNotice}
      {loading.achievements && !achievements ? skeleton(4)
        : disabled.achievements && !achievements ? renderDisabled(tx("gamificationDisabled", "Achievements are disabled.", "الإنجازات معطلة."))
          : errors.achievements && !achievements ? renderError(tx("gamificationAchievementsError", "Achievements could not be loaded.", "تعذر تحميل الإنجازات."))
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
        : disabled.challenges && !challenges ? renderDisabled(tx("gamificationDisabled", "Challenges are disabled.", "التحديات معطلة."))
          : errors.challenges && !challenges ? renderError(tx("gamificationChallengesError", "Challenges could not be loaded.", "تعذر تحميل التحديات."))
          : (
            <>
              {currentChallenges.length ? <div className="g-items">{currentChallenges.map(renderChallenge)}</div>
                : <div className="g-empty"><div className="g-empty-mark"><Target size={20} /></div><h3>{tx("gamificationNoChallenges", "No active challenges right now", "لا توجد تحديات نشطة حاليًا")}</h3><p>{tx("gamificationNoChallengesHint", "When a challenge is available, its server-verified progress will appear here.", "عند توفر تحدٍ، سيظهر تقدمه الموثّق من الخادم هنا.")}</p></div>}
              {recentChallenges.length > 0 && <section style={{ marginTop: 24 }}><div className="g-section-head"><div><h2>{tx("gamificationChallengeRecent", "Recent challenges", "التحديات الأخيرة")}</h2></div></div><div className="g-items">{recentChallenges.map(renderChallenge)}</div></section>}
            </>
          )}
    </div>
  );

  const renderLeaderboard = () => {
    return (
      <LeaderboardView
        scope={scope}
        onScopeChange={(nextScope) => {
          setScope(nextScope);
          setLeaderboard(null);
          setLoading((old) => ({ ...old, leaderboard: true }));
          setOwnRank(null);
          setRankError(false);
          setErrors((old) => ({ ...old, leaderboard: false }));
          setCursorHasExpired(false);
        }}
        availableScopes={availableScopes}
        data={leaderboard}
        ownRank={effectiveOwnRank}
        loading={loading.leaderboard}
        rankLoading={rankLoading}
        rankError={rankError}
        loadingMore={loadingMore}
        error={disabled.leaderboard ? { body: { code: "FEATURE_DISABLED" } } : errors.leaderboard}
        onLoadMore={loadMore}
        locale={locale}
        isRtl={isRtl}
        tx={tx}
      />
    );
  };

  const tabs: { id: GamificationTab; label: string }[] = [
    { id: "overview", label: tx("gamificationOverview", "Overview", "نظرة عامة") },
    { id: "achievements", label: tx("gamificationAchievements", "Achievements", "الإنجازات") },
    { id: "challenges", label: tx("gamificationChallenges", "Challenges", "التحديات") },
    { id: "leaderboard", label: tx("gamificationLeaderboard", "Leaderboard", "لوحة النقاط") },
  ];
  return (
    <main className="gamification" dir={isRtl ? "rtl" : "ltr"}>
      <div className="g-shell">
        <header className="g-hero">
          <div>
            <p className="g-eyebrow">{tx("gamificationEyebrow", "Your progress, at your pace", "تقدمك، بإيقاعك")}</p>
            <h1>{tx("gamificationTitle", "Study engagement", "التفاعل الدراسي")}</h1>
          </div>
        </header>
        <nav className="g-tabs" aria-label={tx("gamificationTitle", "Study engagement", "التفاعل الدراسي")}>
          {tabs.map((item) => <button
            type="button"
            key={item.id}
            className="g-tab"
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => {
              if (
                item.id === "leaderboard"
                && currentLeaderboard.current?.scope !== currentScope.current
              ) setLoading((old) => ({ ...old, leaderboard: true }));
              setTab(item.id);
            }}
          >{item.label}</button>)}
        </nav>
        <div className="g-content">
          <GamificationFeatureState
            status={featureFlagsStatus}
            enabled={gamificationEnabled}
            tx={tx}
          />
          {featureFlagsStatus === "ready" && gamificationEnabled && (
            <>
              {tab === "overview" && renderOverview()}
              {tab === "achievements" && renderAchievements()}
              {tab === "challenges" && renderChallenges()}
              {tab === "leaderboard" && renderLeaderboard()}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default GamificationFrontend;