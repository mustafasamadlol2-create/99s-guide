export const MCQ_CATEGORIES = ["PREVIOUS_YEAR", "AI_GENERATED", "RESOURCE"] as const;
export type MCQCategory = (typeof MCQ_CATEGORIES)[number];

export const MCQ_CATEGORY_FILTERS = ["ALL", ...MCQ_CATEGORIES] as const;
export type MCQCategoryFilter = (typeof MCQ_CATEGORY_FILTERS)[number];

export const MCQ_DIFFICULTIES = ["Easy", "Medium", "Hard"] as const;
export type MCQDifficulty = (typeof MCQ_DIFFICULTIES)[number];

export const MCQ_CATEGORY_LABELS: Record<MCQCategory, { en: string; ar: string }> = {
  AI_GENERATED: { en: "AI Generated", ar: "مولدة بالذكاء الاصطناعي" },
  PREVIOUS_YEAR: { en: "Previous Year", ar: "السنوات السابقة" },
  RESOURCE: { en: "Resources", ar: "المصادر" },
};

export const MCQ_DIFFICULTY_LABELS: Record<MCQDifficulty, { en: string; ar: string }> = {
  Easy: { en: "Easy", ar: "سهل" },
  Medium: { en: "Normal", ar: "متوسط" },
  Hard: { en: "Hard", ar: "صعب" },
};

const categoryAliases: Record<string, MCQCategory> = {
  ai_generated: "AI_GENERATED",
  "ai-generated": "AI_GENERATED",
  ai: "AI_GENERATED",
  generated: "AI_GENERATED",
  previous_year: "PREVIOUS_YEAR",
  "previous-year": "PREVIOUS_YEAR",
  "previous year": "PREVIOUS_YEAR",
  past_year: "PREVIOUS_YEAR",
  "past-year": "PREVIOUS_YEAR",
  "past year": "PREVIOUS_YEAR",
  resource: "RESOURCE",
  resources: "RESOURCE",
  book: "RESOURCE",
};

export function isMCQCategory(value: unknown): value is MCQCategory {
  return typeof value === "string" && (MCQ_CATEGORIES as readonly string[]).includes(value);
}

export function normalizeMCQCategory(value: unknown, fallback: MCQCategory = "AI_GENERATED"): MCQCategory {
  if (isMCQCategory(value)) return value;
  if (typeof value !== "string") return fallback;
  return categoryAliases[value.trim().toLowerCase()] ?? fallback;
}

export function parseMCQCategory(value: unknown): MCQCategory | null {
  if (typeof value !== "string") return null;
  if (value.trim().toUpperCase() === "ALL") return null;
  if (isMCQCategory(value)) return value;
  return categoryAliases[value.trim().toLowerCase()] ?? null;
}

export function isMCQDifficulty(value: unknown): value is MCQDifficulty {
  return typeof value === "string" && (MCQ_DIFFICULTIES as readonly string[]).includes(value);
}

export function normalizeMCQDifficulty(value: unknown, fallback: MCQDifficulty = "Medium"): MCQDifficulty {
  if (isMCQDifficulty(value)) return value;
  if (typeof value === "string" && value.trim().toLowerCase() === "normal") return "Medium";
  return fallback;
}

export function parseMCQDifficulty(value: unknown): MCQDifficulty | null {
  if (isMCQDifficulty(value)) return value;
  if (typeof value === "string" && value.trim().toLowerCase() === "normal") return "Medium";
  return null;
}

export function isMCQCategoryFilter(value: unknown): value is MCQCategoryFilter {
  return typeof value === "string" && (MCQ_CATEGORY_FILTERS as readonly string[]).includes(value);
}

export function mcqCategoryLabel(category: MCQCategory, language: "en" | "ar" = "en"): string {
  return MCQ_CATEGORY_LABELS[category][language];
}

export function mcqDifficultyLabel(difficulty: MCQDifficulty, language: "en" | "ar" = "en"): string {
  return MCQ_DIFFICULTY_LABELS[difficulty][language];
}