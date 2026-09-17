export const MCQ_PROMPT_VERSION = "mcq-v1" as const;
export const DEFAULT_MCQ_GENERATION_COUNT = 20;
export const MAX_MCQ_GENERATION_COUNT = 100;
export const MAX_MCQ_EXTRACTION_COUNT = 100;
export const MCQ_REVIEW_CONFIDENCE_THRESHOLD = 0.85;
export const MAX_SOURCE_EXCERPT_LENGTH = 300;
export const MAX_UNCERTAINTIES = 5;
export const MAX_UNCERTAINTY_LENGTH = 240;
export const MAX_SKIPPED_ITEMS = 100;
export const MAX_SOURCE_SECTION_LENGTH = 160;
export const MAX_CANDIDATE_TEXT_LENGTH = 4_000;

export interface MCQEngineConfig {
  generationDefaultCount: number;
  generationMaxCount: number;
  extractionMaxCount: number;
  reviewConfidenceThreshold: number;
  maxSourceExcerptLength: number;
  maxUncertainties: number;
  maxUncertaintyLength: number;
  maxSkippedItems: number;
}

export const DEFAULT_MCQ_ENGINE_CONFIG: MCQEngineConfig = {
  generationDefaultCount: DEFAULT_MCQ_GENERATION_COUNT,
  generationMaxCount: MAX_MCQ_GENERATION_COUNT,
  extractionMaxCount: MAX_MCQ_EXTRACTION_COUNT,
  reviewConfidenceThreshold: MCQ_REVIEW_CONFIDENCE_THRESHOLD,
  maxSourceExcerptLength: MAX_SOURCE_EXCERPT_LENGTH,
  maxUncertainties: MAX_UNCERTAINTIES,
  maxUncertaintyLength: MAX_UNCERTAINTY_LENGTH,
  maxSkippedItems: MAX_SKIPPED_ITEMS,
};