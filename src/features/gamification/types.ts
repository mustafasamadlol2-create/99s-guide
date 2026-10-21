export type GamificationTab = "overview" | "achievements" | "challenges" | "leaderboard";
export type LeaderboardScope = "WEEKLY" | "MONTHLY" | "SEMESTER" | "ALL_TIME";

export interface PointsBalance {
  totalPoints: number;
  focusPoints: number;
  masteryPoints: number;
  progressPoints: number;
  consistencyPoints: number;
  legacyLedgerPoints: number;
  ledgerPoints: number;
  legacyPoints: number;
}

export interface LevelSummary {
  level: number;
  titleKey?: string;
  lifetimePoints: number;
  currentLevelMinimumPoints: number;
  nextLevelMinimumPoints: number | null;
  pointsIntoLevel: number;
  pointsToNextLevel: number | null;
  levelProgressRatio: number | null;
  maxLevelReached: boolean;
  ruleSetVersion: string;
  lastEvaluatedAt: string;
}

export interface Achievement {
  achievementId: string;
  ruleSetVersion: string;
  metricId: string;
  titleKey: string;
  descriptionKey: string;
  visibility: string;
  tier?: string;
  sortOrder: number;
  currentValue: number | boolean;
  targetValue: number | boolean;
  progressCompleted: boolean;
  unlocked: boolean;
  lastEvaluatedAt: string;
  unlockedAt?: string | null;
  unlockedUnderRuleSetVersion?: string | null;
}

export interface UnlockHistory {
  achievementId: string;
  unlockedUnderRuleSetVersion: string;
  metricId: string;
  titleKey: string;
  descriptionKey: string;
  visibility: string;
  tier?: string;
  metricValueAtUnlock: number | boolean;
  targetValueAtUnlock: number | boolean;
  unlockedAt: string;
}

export interface GamificationSummary {
  ruleSetVersion: string;
  points: PointsBalance;
  level: LevelSummary;
  achievements: Achievement[];
  unlockHistory: UnlockHistory[];
}

export interface AchievementsResponse {
  ruleSetVersion: string;
  achievements: Achievement[];
  unlockHistory: UnlockHistory[];
}

export interface ChallengeItem {
  instanceId: string;
  definitionId: string;
  ruleSetVersion: string;
  periodKey: string;
  titleKey: string;
  descriptionKey: string;
  metricId: string;
  current: number;
  target: number;
  progressRatio: number;
  status: "ACTIVE" | "COMPLETED" | "EXPIRED" | "LEFT";
  startsAt: string;
  endsAt: string;
  completedAt?: string | null;
  expiredAt?: string | null;
}

export interface ChallengesResponse {
  ruleSetVersion: string;
  currentPeriod: { periodKey: string; startsAt: string; endsAt: string };
  active: ChallengeItem[];
  recent: ChallengeItem[];
}

export interface LeaderboardSeason {
  id: string;
  scope: LeaderboardScope;
  seasonKey: string;
  startsAt: string | null;
  endsAt: string | null;
  status: "UPCOMING" | "ACTIVE" | "CLOSED";
}

export interface LeaderboardEntry {
  rank: number;
  tieSize: number;
  level: number | null;
  score: number;
  displayName: string | null;
  avatarUrl: string | null;
  isViewer?: boolean;
}

export interface LeaderboardResponse {
  scope: LeaderboardScope;
  season: LeaderboardSeason;
  generatedAt: string;
  scoreThrough: string;
  isStale: boolean;
  totalRankedUsers: number;
  entries: LeaderboardEntry[];
  nextCursor: string | null;
}

export interface OwnRankResponse {
  scope: LeaderboardScope;
  season: LeaderboardSeason;
  rank: number | null;
  score: number;
  tieSize: number | null;
  totalRankedUsers: number;
  notRanked: boolean;
  snapshotGeneratedAt: string;
}

export interface LeaderboardAvailabilityResponse {
  scopes: LeaderboardScope[];
}

export interface PublicProfile {
  level: number;
  titleKey?: string;
  maxLevelReached: boolean;
  achievements: { achievementId: string; titleKey: string; descriptionKey: string; unlockedAt: string }[];
}
export interface StudyStreakDay {
  date: string;
  active: boolean;
  intensity: 0 | 1 | 2 | 3 | 4;
  focusSeconds: number;
  groupFocusSeconds: number;
  sessionsCompleted: number;
  mcqAttempts: number;
  flashcardReviews: number;
  recallAttempts: number;
  lectureCompletions: number;
  progressEvents: number;
}

export interface StudyStreakSummary {
  timeZone: "Asia/Baghdad";
  rangeStart: string;
  rangeEnd: string;
  currentStreakDays: number;
  longestStreakDays: number;
  activeToday: boolean;
  activeDaysLast7: number;
  activeDaysLast30: number;
  activeDaysInRange: number;
  historyDays: number;
  streakCappedByHistory: boolean;
  activityRuleVersion: "study-day-v1";
  days: StudyStreakDay[];
}
