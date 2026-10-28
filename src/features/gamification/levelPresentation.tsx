import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Brain,
  Compass,
  Crown,
  GraduationCap,
  Lightbulb,
  Map,
  Medal,
  ShieldCheck,
  Target,
} from "lucide-react";

export type LevelPresentation = {
  level: number;
  titleKey: string;
  fallbackEn: string;
  fallbackAr: string;
  Icon: LucideIcon;
  minimumPoints: number;
};

const LEVEL_PRESENTATIONS: readonly LevelPresentation[] = [
  { level: 1, minimumPoints: 0, titleKey: "gamificationLevelExplorer", fallbackEn: "Explorer", fallbackAr: "المستكشف", Icon: Compass },
  { level: 2, minimumPoints: 100, titleKey: "gamificationLevelLearner", fallbackEn: "Learner", fallbackAr: "المتعلم", Icon: BookOpen },
  { level: 3, minimumPoints: 250, titleKey: "gamificationLevelScholar", fallbackEn: "Scholar", fallbackAr: "الباحث", Icon: GraduationCap },
  { level: 4, minimumPoints: 500, titleKey: "gamificationLevelAchiever", fallbackEn: "Achiever", fallbackAr: "المنجز", Icon: Medal },
  { level: 5, minimumPoints: 900, titleKey: "gamificationLevelPathfinder", fallbackEn: "Pathfinder", fallbackAr: "رائد الطريق", Icon: Map },
  { level: 6, minimumPoints: 1400, titleKey: "gamificationLevelStrategist", fallbackEn: "Strategist", fallbackAr: "الاستراتيجي", Icon: Target },
  { level: 7, minimumPoints: 2100, titleKey: "gamificationLevelSpecialist", fallbackEn: "Specialist", fallbackAr: "المتخصص", Icon: Brain },
  { level: 8, minimumPoints: 3000, titleKey: "gamificationLevelMentor", fallbackEn: "Mentor", fallbackAr: "المرشد", Icon: Lightbulb },
  { level: 9, minimumPoints: 4200, titleKey: "gamificationLevelVanguard", fallbackEn: "Vanguard", fallbackAr: "الطليعي", Icon: ShieldCheck },
  { level: 10, minimumPoints: 5600, titleKey: "gamificationLevelLuminary", fallbackEn: "Luminary", fallbackAr: "المتألق", Icon: Crown },
] as const;

export const GAMIFICATION_LEVEL_COUNT = LEVEL_PRESENTATIONS.length;

export function getLevelPresentation(level: number | null | undefined): LevelPresentation {
  const safeLevel = Number.isInteger(level) && Number(level) >= 1
    ? Math.min(Number(level), GAMIFICATION_LEVEL_COUNT)
    : 1;
  return LEVEL_PRESENTATIONS[safeLevel - 1];
}

export function getAllLevelPresentations(): readonly LevelPresentation[] {
  return LEVEL_PRESENTATIONS;
}
