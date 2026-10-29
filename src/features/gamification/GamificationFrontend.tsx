import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Award, BookOpen, Brain, CalendarCheck2, CalendarDays, Check, ChevronDown,
  CircleHelp, Clock3, Flame, Layers3, LoaderCircle, Medal, Sparkles,
  Target, Trophy, UsersRound, LockKeyhole,
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
  GamificationTab, LeaderboardResponse, LeaderboardScope, OwnRankResponse, StudyStreakSummary,
} from "./types";
import { LeaderboardView } from "./LeaderboardView";
import { StudyStreakCard } from "./StudyStreakCard";
import { GamificationFeatureState } from "./GamificationFeatureState";
import { GAMIFICATION_LEVEL_COUNT, getAllLevelPresentations, getLevelPresentation } from "./levelPresentation";
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

const SCOPES: LeaderboardScope[] = ["MONTHLY", "SEMESTER", "ALL_TIME"];
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
  "gamification.achievement.first_lecture.title": "gamificationAchievementFirstLectureTitle",
  "gamification.achievement.first_lecture.description": "gamificationAchievementFirstLectureDescription",
  "gamification.achievement.ten_lectures.title": "gamificationAchievementTenLecturesTitle",
  "gamification.achievement.ten_lectures.description": "gamificationAchievementTenLecturesDescription",
  "gamification.achievement.fifty_mcq.title": "gamificationAchievementFiftyMcqTitle",
  "gamification.achievement.fifty_mcq.description": "gamificationAchievementFiftyMcqDescription",
  "gamification.achievement.two_hundred_mcq.title": "gamificationAchievementTwoHundredMcqTitle",
  "gamification.achievement.two_hundred_mcq.description": "gamificationAchievementTwoHundredMcqDescription",
  "gamification.achievement.flashcard_25.title": "gamificationAchievementFlashcard25Title",
  "gamification.achievement.flashcard_25.description": "gamificationAchievementFlashcard25Description",
  "gamification.achievement.focus_10.title": "gamificationAchievementFocus10Title",
  "gamification.achievement.focus_10.description": "gamificationAchievementFocus10Description",
  "gamification.achievement.consistency_7.title": "gamificationAchievementConsistency7Title",
  "gamification.achievement.consistency_7.description": "gamificationAchievementConsistency7Description",
  "gamification.achievement.twenty_five_lectures.title": "gamificationAchievementTwentyFiveLecturesTitle",
  "gamification.achievement.twenty_five_lectures.description": "gamificationAchievementTwentyFiveLecturesDescription",
  "gamification.achievement.fifty_lectures.title": "gamificationAchievementFiftyLecturesTitle",
  "gamification.achievement.fifty_lectures.description": "gamificationAchievementFiftyLecturesDescription",
  "gamification.achievement.ten_mcq.title": "gamificationAchievementTenMcqTitle",
  "gamification.achievement.ten_mcq.description": "gamificationAchievementTenMcqDescription",
  "gamification.achievement.one_hundred_mcq.title": "gamificationAchievementOneHundredMcqTitle",
  "gamification.achievement.one_hundred_mcq.description": "gamificationAchievementOneHundredMcqDescription",
  "gamification.achievement.two_hundred_fifty_mcq.title": "gamificationAchievementTwoHundredFiftyMcqTitle",
  "gamification.achievement.two_hundred_fifty_mcq.description": "gamificationAchievementTwoHundredFiftyMcqDescription",
  "gamification.achievement.five_hundred_mcq.title": "gamificationAchievementFiveHundredMcqTitle",
  "gamification.achievement.five_hundred_mcq.description": "gamificationAchievementFiveHundredMcqDescription",
  "gamification.achievement.flashcard_100.title": "gamificationAchievementFlashcard100Title",
  "gamification.achievement.flashcard_100.description": "gamificationAchievementFlashcard100Description",
  "gamification.achievement.flashcard_250.title": "gamificationAchievementFlashcard250Title",
  "gamification.achievement.flashcard_250.description": "gamificationAchievementFlashcard250Description",
  "gamification.achievement.focus_25.title": "gamificationAchievementFocus25Title",
  "gamification.achievement.focus_25.description": "gamificationAchievementFocus25Description",
  "gamification.achievement.focus_50.title": "gamificationAchievementFocus50Title",
  "gamification.achievement.focus_50.description": "gamificationAchievementFocus50Description",
  "gamification.achievement.consistency_3.title": "gamificationAchievementConsistency3Title",
  "gamification.achievement.consistency_3.description": "gamificationAchievementConsistency3Description",
  "gamification.achievement.consistency_14.title": "gamificationAchievementConsistency14Title",
  "gamification.achievement.consistency_14.description": "gamificationAchievementConsistency14Description",
  "gamification.achievement.consistency_30.title": "gamificationAchievementConsistency30Title",
  "gamification.achievement.consistency_30.description": "gamificationAchievementConsistency30Description",
  "gamification.challenge.consistency_4.title": "gamificationChallengeConsistency4Title",
  "gamification.challenge.consistency_4.description": "gamificationChallengeConsistency4Description",
  "gamification.challenge.focus_90.title": "gamificationChallengeFocus90Title",
  "gamification.challenge.focus_90.description": "gamificationChallengeFocus90Description",
  "gamification.challenge.lectures_3.title": "gamificationChallengeLectures3Title",
  "gamification.challenge.lectures_3.description": "gamificationChallengeLectures3Description",
  "gamification.challenge.mcq_25.title": "gamificationChallengeMcq25Title",
  "gamification.challenge.mcq_25.description": "gamificationChallengeMcq25Description",
  "gamification.challenge.consistency_3.title": "gamificationChallengeConsistency3Title",
  "gamification.challenge.consistency_3.description": "gamificationChallengeConsistency3Description",
  "gamification.challenge.consistency_5.title": "gamificationChallengeConsistency5Title",
  "gamification.challenge.consistency_5.description": "gamificationChallengeConsistency5Description",
  "gamification.challenge.focus_60.title": "gamificationChallengeFocus60Title",
  "gamification.challenge.focus_60.description": "gamificationChallengeFocus60Description",
  "gamification.challenge.focus_120.title": "gamificationChallengeFocus120Title",
  "gamification.challenge.focus_120.description": "gamificationChallengeFocus120Description",
  "gamification.challenge.lectures_2.title": "gamificationChallengeLectures2Title",
  "gamification.challenge.lectures_2.description": "gamificationChallengeLectures2Description",
  "gamification.challenge.lectures_5.title": "gamificationChallengeLectures5Title",
  "gamification.challenge.lectures_5.description": "gamificationChallengeLectures5Description",
  "gamification.challenge.mcq_20.title": "gamificationChallengeMcq20Title",
  "gamification.challenge.mcq_20.description": "gamificationChallengeMcq20Description",
  "gamification.challenge.mcq_50.title": "gamificationChallengeMcq50Title",
  "gamification.challenge.mcq_50.description": "gamificationChallengeMcq50Description",
  "gamification.challenge.flashcards_40.title": "gamificationChallengeFlashcards40Title",
  "gamification.challenge.flashcards_40.description": "gamificationChallengeFlashcards40Description",
  "gamification.challenge.study_mix.title": "gamificationChallengeStudyMixTitle",
  "gamification.challenge.study_mix.description": "gamificationChallengeStudyMixDescription",
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
      rewardPoints: item.rewardPoints,
      hidden: false,
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
  if (metricId === "learning.lecture_completions") {
    return `${exact} ${tx("gamificationUnitLectures", "lectures", "محاضرات")}`;
  }
  if (metricId === "learning.mcq_first_correct") {
    return `${exact} ${tx("gamificationUnitQuestions", "questions", "أسئلة")}`;
  }
  if (metricId === "learning.flashcard_first_recalls") {
    return `${exact} ${tx("gamificationUnitRecalls", "recalls", "مراجعات")}`;
  }
  if (metricId === "learning.weekly_study_mix") {
    return value >= 1
      ? tx("gamificationStudyMixComplete", "complete", "مكتمل")
      : tx("gamificationStudyMixPending", "pending", "قيد التنفيذ");
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
  const [scope, setScope] = useState<LeaderboardScope>("MONTHLY");
  const [availableScopes, setAvailableScopes] = useState<LeaderboardScope[]>(
    () => SCOPES.filter((item) => item !== "SEMESTER"),
  );
  const [summary, setSummary] = useState<GamificationSummary | null>(null);
  const [achievements, setAchievements] = useState<AchievementsResponse | null>(null);
  const [achievementCelebration, setAchievementCelebration] = useState<Achievement | null>(null);
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
  const [studyStreak, setStudyStreak] = useState<StudyStreakSummary | null>(null);
  const [studyStreakLoading, setStudyStreakLoading] = useState(false);
  const [studyStreakError, setStudyStreakError] = useState(false);
  const [optimisticPointDelta, setOptimisticPointDelta] = useState(() => getOptimisticStudyPointsDelta());
  const summaryGeneration = useRef(0);
  const achievementsGeneration = useRef(0);
  const challengesGeneration = useRef(0);
  const leaderboardGeneration = useRef(0);
  const leaderboardRequestingScope = useRef<LeaderboardScope | null>(null);
  const rankGeneration = useRef(0);
  const overviewRankGeneration = useRef(0);
  const studyStreakGeneration = useRef(0);
  const warnedPointMismatch = useRef(false);
  const knownAchievementUnlocks = useRef<Set<string> | null>(null);
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

  const applyAchievementPayload = useCallback((data: AchievementsResponse) => {
    const nextUnlocks = new Set(data.unlockHistory.map((item) => item.achievementId));
    const known = knownAchievementUnlocks.current;
    if (known) {
      const newlyUnlocked = data.unlockHistory
        .filter((item) => !known.has(item.achievementId))
        .sort((left, right) => right.unlockedAt.localeCompare(left.unlockedAt));
      const latest = newlyUnlocked[0];
      if (latest) {
        const achievement = data.achievements.find((item) => item.achievementId === latest.achievementId);
        if (achievement) setAchievementCelebration(achievement);
      }
    }
    knownAchievementUnlocks.current = nextUnlocks;
    setAchievements(data);
  }, []);

  useEffect(() => {
    knownAchievementUnlocks.current = null;
    setAchievementCelebration(null);
  }, [accountId]);

  useEffect(() => {
    if (!achievementCelebration) return;
    const timer = window.setTimeout(() => setAchievementCelebration(null), 4200);
    return () => window.clearTimeout(timer);
  }, [achievementCelebration]);

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
        applyAchievementPayload({
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
  }, [applyAchievementPayload]);

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
        applyAchievementPayload(data);
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
  }, [applyAchievementPayload]);

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

  const loadStudyStreak = useCallback(async () => {
    if (featureFlagsStatus !== "ready" || !gamificationEnabled) return;
    const account = currentAccountId.current;
    const requestId = ++studyStreakGeneration.current;
    setStudyStreakLoading(true);
    setStudyStreakError(false);
    try {
      const result = await gamificationApi.studyStreak();
      if (studyStreakGeneration.current === requestId && currentAccountId.current === account) {
        setStudyStreak(result);
      }
    } catch {
      if (studyStreakGeneration.current === requestId && currentAccountId.current === account) {
        setStudyStreakError(true);
      }
    } finally {
      if (studyStreakGeneration.current === requestId && currentAccountId.current === account) {
        setStudyStreakLoading(false);
      }
    }
  }, [featureFlagsStatus, gamificationEnabled]);

  const loadOverviewRank = useCallback(async () => {
    if (featureFlagsStatus !== "ready" || !gamificationEnabled) return;
    const account = currentAccountId.current;
    const requestId = ++overviewRankGeneration.current;
    setOverviewRank(null);
    setOverviewRankError(false);
    setOverviewRankLoading(true);
    try {
      const result = await gamificationApi.ownRank("MONTHLY");
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
      setScope("MONTHLY");
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
        if (currentScope.current === "SEMESTER") setScope("MONTHLY");
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
      if (currentTab.current === "overview" || studyStreak !== null) void loadStudyStreak();
    };
    const onReconnect = () => {
      void warmLeaderboardScopes();
      if (currentTab.current === "overview" || studyStreak !== null) void loadStudyStreak();
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
  }, [loadStudyStreak, queueResourceRefresh, studyStreak, warmLeaderboardScopes]);

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
      await Promise.all([privatePromise, loadOverviewRank(), loadStudyStreak(), availabilityPromise]);
    } else await Promise.all([privatePromise, availabilityPromise]);
  }, [
    loadLeaderboard,
    loadLeaderboardAvailability,
    loadOverviewRank,
    loadPrivateData,
    loadStudyStreak,
  ]);

  useEffect(() => {
    setGamificationReadAccountScope(accountId);
    setSummary(null);
    setAchievements(null);
    setChallenges(null);
    setLeaderboard(null);
    setOwnRank(null);
    setOverviewRank(null);
    setStudyStreak(null);
    setStudyStreakLoading(false);
    setStudyStreakError(false);
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
      // monthly leaderboard request also started by the selected-tab effect.
      void loadPrivateData();
      void loadAchievements();
      void loadChallenges();
      void loadOverviewRank();
      void loadStudyStreak();
      void warmLeaderboardScopes();
    }
    return () => {
      summaryGeneration.current += 1;
      achievementsGeneration.current += 1;
      challengesGeneration.current += 1;
      leaderboardGeneration.current += 1;
      rankGeneration.current += 1;
      overviewRankGeneration.current += 1;
      studyStreakGeneration.current += 1;
    };
  }, [
    accountId,
    featureFlagsStatus,
    gamificationEnabled,
    loadChallenges,
    loadAchievements,
    loadOverviewRank,
    loadPrivateData,
    loadStudyStreak,
    warmLeaderboardScopes,
  ]);
  useEffect(() => {
    if (featureFlagsStatus !== "ready" || !gamificationEnabled || tab !== "overview") return;
    if (!studyStreak && !studyStreakLoading && !studyStreakError) void loadStudyStreak();

    const handleStudyStreakVisibility = () => {
      if (document.visibilityState === "visible") void loadStudyStreak();
    };
    const handleStudyStreakFocus = () => void loadStudyStreak();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadStudyStreak();
    }, 60_000);
    document.addEventListener("visibilitychange", handleStudyStreakVisibility);
    window.addEventListener("focus", handleStudyStreakFocus);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleStudyStreakVisibility);
      window.removeEventListener("focus", handleStudyStreakFocus);
    };
  }, [featureFlagsStatus, gamificationEnabled, loadStudyStreak, studyStreak, studyStreakError, studyStreakLoading, tab]);

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
    const statusText = item.hidden
      ? tx("gamificationHidden", "Hidden", "مخفي")
      : status === "unlocked"
        ? tx(statusKey, "Unlocked", "مفتوح")
        : status === "in-progress"
          ? tx(statusKey, "In progress", "قيد التقدم")
          : tx(statusKey, "Not yet unlocked", "لم يُفتح بعد");
    const AchievementIcon = item.hidden
      ? Sparkles
      : item.metricId === "learning.lecture_completions" ? BookOpen
        : item.metricId === "learning.mcq_first_correct" ? Brain
          : item.metricId === "learning.flashcard_first_recalls" ? Layers3
            : item.metricId === "focus.completed_sessions" ? Flame
              : item.metricId === "consistency.qualifying_days" ? CalendarCheck2
                : Award;
    const tierClass = item.tier ? ` tier-${item.tier.toLowerCase()}` : "";
    return (
      <div className={`g-achievement ${status === "locked" ? "is-locked" : ""}${item.hidden ? " is-hidden" : ""}${tierClass}`} key={`${item.achievementId}-${item.sortOrder}`}>
        <div className="g-medallion" aria-hidden="true">
          <AchievementIcon size={item.hidden ? 18 : 20} />
        </div>
        <div className="g-achievement-body">
          <h3>{item.hidden ? tx("gamificationHiddenAchievementTitle", "Hidden Achievement", "إنجاز مخفي") : localizedBackendText(item.titleKey, "title")}</h3>
          {!compact && <p>{item.hidden ? tx("gamificationHiddenAchievementDescription", "Keep studying to discover this achievement.", "استمر بالدراسة لاكتشاف هذا الإنجاز.") : localizedBackendText(item.descriptionKey, "description")}</p>}
          {!compact && !item.hidden && <div className="g-inline-meta">
            {unlocked
              ? `${statusText}${item.unlockedAt ? ` · ${formatDate(item.unlockedAt, locale)}` : ""}`
              : isBoolNumber(item.currentValue) && isBoolNumber(item.targetValue)
              ? `${valueLabel(item.currentValue, locale)} / ${valueLabel(item.targetValue, locale)}`
              : item.currentValue === true || item.currentValue === false
                ? `${valueLabel(item.currentValue, locale)} / ${valueLabel(item.targetValue, locale)}`
                : statusText}
          </div>}
        </div>
        <div className="g-card-actions">
          {item.hidden ? (
            <span className="g-reward-pill mystery">{tx("gamificationHiddenReward", "Mystery reward", "مكافأة مفاجئة")}</span>
          ) : item.rewardPoints > 0 && (
            <span className="g-reward-pill">+{formatNumber(item.rewardPoints)} {tx("gamificationRewardPointsShort", "pts", "نقطة")}</span>
          )}
          <span className={`g-status-pill ${status === "locked" ? "muted" : ""}`}>
            {status === "unlocked" ? <Check size={13} /> : status === "in-progress" ? <Clock3 size={13} /> : <LockKeyhole size={13} />}
            {statusText}
          </span>
        </div>
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
            <div className="g-card-actions">
              {item.rewardPoints > 0 && (
                <span className="g-reward-pill">+{formatNumber(item.rewardPoints)} {tx("gamificationRewardPointsShort", "pts", "نقطة")}</span>
              )}
              <span className={`g-status-pill ${item.status === "ACTIVE" ? "" : "muted"}`}>{statusCopy(item.status)}</span>
            </div>
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
    const levelPresentation = getLevelPresentation(level.level);
    const LevelIcon = levelPresentation.Icon;
    const levelName = tx(levelPresentation.titleKey, levelPresentation.fallbackEn, levelPresentation.fallbackAr);
    const nextLevelPresentation = level.level < GAMIFICATION_LEVEL_COUNT
      ? getLevelPresentation(level.level + 1)
      : null;
    const nextLevelName = nextLevelPresentation
      ? tx(nextLevelPresentation.titleKey, nextLevelPresentation.fallbackEn, nextLevelPresentation.fallbackAr)
      : null;
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
            <div className="g-total" aria-label={`${formatNumber(summary.points.totalPoints + optimisticPointDelta)} ${tx("gamificationScore", "Points", "النقاط")}`}>{formatNumber(summary.points.totalPoints + optimisticPointDelta)}</div>
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
                  <div className="g-level-caption" id="g-level-heading">{tx("gamificationLevel", "Current rank", "الرتبة الحالية")}</div>
                  <div className="g-level-title">{levelName}</div>
                  <div className="g-level-number">{tx("gamificationLevelLabel", "Level", "المستوى")} {formatNumber(level.level)} / {formatNumber(GAMIFICATION_LEVEL_COUNT)}</div>
                </div>
                <div className={`g-level-mark level-${level.level}`} aria-hidden="true"><LevelIcon size={25} /></div>
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
                    ? `${formatNumber(level.pointsToNextLevel)} ${tx("gamificationPointsToNext", "points to", "نقطة للوصول إلى")} ${nextLevelName ?? tx("gamificationNextLevel", "next rank", "الرتبة التالية")}`
                    : tx("gamificationNextThresholdUnavailable", "Next level threshold unavailable", "حد المستوى التالي غير متاح")}
              </div>
              <div className="g-level-thresholds">
                <div>
                  <span>{levelName} · {tx("gamificationStartsAt", "starts at", "تبدأ عند")}</span>
                  <strong>{formatNumber(level.currentLevelMinimumPoints)} {tx("gamificationScore", "Points", "النقاط")}</strong>
                </div>
                {!level.maxLevelReached && <div>
                  <span>{nextLevelName
                    ? <>{nextLevelName} · {tx("gamificationStartsAt", "starts at", "تبدأ عند")}</>
                    : tx("gamificationNextThreshold", "Next rank starts at", "تبدأ الرتبة التالية عند")}</span>
                  <strong>{level.nextLevelMinimumPoints === null
                    ? tx("gamificationNextThresholdUnavailable", "Unavailable", "غير متاح")
                    : `${formatNumber(level.nextLevelMinimumPoints)} ${tx("gamificationScore", "Points", "النقاط")}`}</strong>
                </div>}
              </div>
              <div className="g-level-system-note">
                {tx("gamificationLevelSystemNote", "10 ranks · Lifetime Study Points determine your rank", "10 رتب · مجموع نقاط الدراسة مدى الحياة يحدد رتبتك")}
              </div>
              <details className="g-level-path">
                <summary>{tx("gamificationViewAllRanks", "View all ranks & point thresholds", "عرض جميع الرتب وحدود النقاط")}</summary>
                <div className="g-level-path-grid">
                  {getAllLevelPresentations().map((rank) => {
                    const RankIcon = rank.Icon;
                    const rankName = tx(rank.titleKey, rank.fallbackEn, rank.fallbackAr);
                    return (
                      <div
                        className={`g-level-path-item${rank.level === level.level ? " is-current" : ""}`}
                        key={rank.level}
                        aria-current={rank.level === level.level ? "step" : undefined}
                      >
                        <span className={`g-level-path-icon level-${rank.level}`} aria-hidden="true"><RankIcon size={15} /></span>
                        <span className="g-level-path-copy">
                          <strong>{rankName}</strong>
                          <small>{tx("gamificationLevelLabel", "Level", "المستوى")} {formatNumber(rank.level)}</small>
                        </span>
                        <span className="g-level-path-points">{formatNumber(rank.minimumPoints)}+</span>
                      </div>
                    );
                  })}
                </div>
              </details>
            </div>
          </section>
        </div>
        {studyStreak ? (
          <StudyStreakCard data={studyStreak} language={language} />
        ) : studyStreakLoading ? (
          <div className="g-card g-streak-loading" aria-busy="true"><div className="g-skeleton g-skeleton-card" /></div>
        ) : studyStreakError ? (
          <section className="g-card g-streak-unavailable" role="status">
            <div>
              <h2>{tx("studyStreakTitle", "Study streak", "سلسلة الدراسة")}</h2>
              <p>{tx("studyStreakUnavailable", "Your study streak could not be refreshed just now.", "تعذر تحديث سلسلة الدراسة الآن.")}</p>
            </div>
            <button type="button" className="g-action" onClick={() => void loadStudyStreak()}>
              {tx("gamificationRetry", "Try again", "حاول مجددًا")}
            </button>
          </section>
        ) : null}
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
              : currentChallenges.length ? <div className="g-list">{currentChallenges.slice(0, 2).map((item) => <div className="g-mini-row" key={item.instanceId}><div className="g-medallion"><Target size={17} /></div><div className="g-row-copy"><strong>{localizedBackendText(item.titleKey, "challengeTitle")}</strong><span>{formatChallengeAmount(item.current, item.metricId, locale, tx)} / {formatChallengeAmount(item.target, item.metricId, locale, tx)}</span></div><span className="g-row-end">+{formatNumber(item.rewardPoints)} {tx("gamificationRewardPointsShort", "pts", "نقطة")} · {Math.round(safeFraction(item.progressRatio) * 100)}%</span></div>)}</div>
                : <div className="g-empty"><div className="g-empty-mark"><Target size={20} /></div><h3>{tx("gamificationNoChallenges", "No active challenges right now", "لا توجد تحديات نشطة حاليًا")}</h3><p>{tx("gamificationNoChallengesHint", "When a challenge is available, its server-verified progress will appear here.", "عند توفر تحدٍ، سيظهر تقدمه الموثّق من الخادم هنا.")}</p></div>}
          </section>
        </div>
        <section className="g-card g-overview-rank" aria-labelledby="g-overview-rank-heading">
          <div className="g-section-head">
            <div>
              <h2 id="g-overview-rank-heading">
                {tx("gamificationLeaderboard", "Leaderboard", "لوحة النقاط")} · {tx("gamificationMonthly", "Monthly", "شهري")}
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
                  ? tx("gamificationNoPeriodRankScore", "No Study Points in this period yet.", "لا توجد نقاط دراسة في هذه الفترة بعد.")
                  : tx("gamificationUnrankedPeriodScore", "Your Study Points are not ranked in this period yet.", "نقاط دراستك غير مدرجة في ترتيب هذه الفترة بعد.")
                : tx("gamificationMonthlyRanking", "Monthly ranking", "الترتيب الشهري")}</span>
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
      {challenges?.currentPeriod && <>
        <div className="g-period-note">{tx("gamificationPeriod", "Current period", "الفترة الحالية")}: {formatDate(challenges.currentPeriod.startsAt, locale, { year: "numeric" })} – {formatDate(challenges.currentPeriod.endsAt, locale, { year: "numeric" })}</div>
        <div className="g-rotation-note">
          <Sparkles size={15} aria-hidden="true" />
          <span>{tx("gamificationWeeklyRotationNote", "Four challenges are selected from a larger pool each week, so your goals stay fresh.", "يتم اختيار أربعة تحديات من مجموعة أكبر كل أسبوع لتبقى أهدافك متجددة.")}</span>
        </div>
      </>}
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
        optimisticPointDelta={optimisticPointDelta}
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
      {achievementCelebration && (
        <div className="g-achievement-celebration" role="status" aria-live="polite">
          <div className="g-celebration-icon"><Trophy size={22} /></div>
          <div className="g-celebration-copy">
            <span>{tx("gamificationAchievementUnlockedCelebration", "Achievement Unlocked", "تم فتح إنجاز")}</span>
            <strong>{localizedBackendText(achievementCelebration.titleKey, "title")}</strong>
          </div>
          <div className="g-celebration-points">+{formatNumber(achievementCelebration.rewardPoints)} {tx("gamificationRewardPointsShort", "pts", "نقطة")}</div>
        </div>
      )}
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