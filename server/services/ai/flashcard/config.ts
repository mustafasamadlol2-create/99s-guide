export const FLASHCARD_PROMPT_VERSION = "flashcard-v1" as const;
export const DEFAULT_FLASHCARD_GENERATION_COUNT = 20;
export const MAX_FLASHCARD_GENERATION_COUNT = 100;
export const MAX_FLASHCARD_EXTRACTION_COUNT = 100;
export const FLASHCARD_REVIEW_CONFIDENCE_THRESHOLD = 0.85;
export const MAX_FLASHCARD_SOURCE_EXCERPT_LENGTH = 300;
export const MAX_FLASHCARD_UNCERTAINTIES = 5;
export const MAX_FLASHCARD_UNCERTAINTY_LENGTH = 240;
export const MAX_FLASHCARD_SKIPPED_ITEMS = 100;
export const MAX_FLASHCARD_SOURCE_SECTION_LENGTH = 160;
export const MAX_FLASHCARD_CANDIDATE_TEXT_LENGTH = 4_000;
export const MAX_FLASHCARD_FOCUS_LENGTH = 200;

export interface FlashcardEngineConfig {
  generationDefaultCount: number;
  generationMaxCount: number;
  extractionMaxCount: number;
  reviewConfidenceThreshold: number;
  maxSourceExcerptLength: number;
  maxUncertainties: number;
  maxUncertaintyLength: number;
  maxSkippedItems: number;
  maxFocusLength: number;
}

export const DEFAULT_FLASHCARD_ENGINE_CONFIG: FlashcardEngineConfig = {
  generationDefaultCount: DEFAULT_FLASHCARD_GENERATION_COUNT,
  generationMaxCount: MAX_FLASHCARD_GENERATION_COUNT,
  extractionMaxCount: MAX_FLASHCARD_EXTRACTION_COUNT,
  reviewConfidenceThreshold: FLASHCARD_REVIEW_CONFIDENCE_THRESHOLD,
  maxSourceExcerptLength: MAX_FLASHCARD_SOURCE_EXCERPT_LENGTH,
  maxUncertainties: MAX_FLASHCARD_UNCERTAINTIES,
  maxUncertaintyLength: MAX_FLASHCARD_UNCERTAINTY_LENGTH,
  maxSkippedItems: MAX_FLASHCARD_SKIPPED_ITEMS,
  maxFocusLength: MAX_FLASHCARD_FOCUS_LENGTH,
};