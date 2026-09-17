export type AIPreviewTarget = "mcq" | "flashcard";
export type AIPreviewOperation = "extract" | "generate" | "enhance";
export type AIPreviewInputKind = "pdf" | "image" | "text";

export type MCQDifficulty = "Easy" | "Medium" | "Hard" | "mixed";
export type MCQQuestionStyle = "direct" | "understanding" | "clinical" | "mixed";
export type MCQAnswer = "A" | "B" | "C" | "D";

export interface MCQGenerationOptions {
  count: number;
  difficulty: MCQDifficulty;
  questionStyle: MCQQuestionStyle;
  includeHints: boolean;
  includeExplanations: boolean;
}

export interface MCQEnhancementOptions {
  hint: boolean;
  explanation: boolean;
}

export interface FlashcardGenerationOptions {
  count: number;
  focus: string | null;
}

export interface FlashcardEnhancementOptions {
  explanation: true;
}

export type AIPreviewOptions =
  | Record<string, never>
  | MCQGenerationOptions
  | MCQEnhancementOptions
  | FlashcardGenerationOptions
  | FlashcardEnhancementOptions;

export interface AIPreviewSource {
  inputKind: AIPreviewInputKind;
  text?: string;
  file?: File;
  files?: File[];
}

export interface AIPreviewRequest {
  target: AIPreviewTarget;
  lectureId: string;
  operation: AIPreviewOperation;
  source: AIPreviewSource;
  options: AIPreviewOptions;
}

export interface AISourceEvidence {
  inputType: AIPreviewInputKind;
  page?: number;
  imageIndex?: number;
  section?: string | null;
  label?: string | null;
  supportingExcerpt?: string | null;
}

export type AIProvenance = "extracted" | "generated" | "enhanced";

export interface AIMCQCandidate {
  candidateId: string;
  question: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: MCQAnswer | null;
  hint: string | null;
  explanation: string | null;
  difficulty: "Easy" | "Medium" | "Hard" | null;
  provenance: AIProvenance;
  source: AISourceEvidence | null;
  confidence: number;
  importReady: boolean;
  needsReview: boolean;
  requiresHumanApproval: true;
  warnings: string[];
}

export interface AIFlashcardCandidate {
  candidateId: string;
  clinicalConcept: string;
  explanation: string | null;
  provenance: AIProvenance;
  source: AISourceEvidence | null;
  confidence: number;
  importReady: boolean;
  needsReview: boolean;
  requiresHumanApproval: true;
  warnings: string[];
}

export interface AISkippedItem {
  reason: string;
  source: AISourceEvidence | null;
  summary?: string;
}

export interface AIResultCounts {
  requestedCount?: number;
  returnedCount: number;
  readyCount: number;
  reviewCount: number;
  skippedCount: number;
}

export interface AIPreviewResponse<T extends AIMCQCandidate | AIFlashcardCandidate> {
  requestId: string;
  target: AIPreviewTarget;
  operation: AIPreviewOperation;
  inputKind: AIPreviewInputKind;
  lecture: { id: string; name: string };
  result: {
    promptVersion: string;
    items: T[];
    skippedItems: AISkippedItem[];
    truncated: boolean;
    warnings: string[];
    requiresHumanApproval: true;
    counts: AIResultCounts;
    provider: {
      provider: string;
      model: string;
      responseId?: string | null;
      transport?: "inline" | "files_api";
      mediaCount?: number;
      cleanupWarning?: "provider_media_cleanup_failed";
    };
    processing: { durationMs: number };
  };
}

export interface AIHttpErrorPayload {
  requestId?: string;
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    details?: Array<{ field?: string; message?: string }>;
  };
}

export interface LocalValidation {
  ready: boolean;
  errors: string[];
  warnings: string[];
}

export interface LocalMCQCandidate {
  original: AIMCQCandidate;
  draft: AIMCQCandidate;
  selected: boolean;
  edited: boolean;
  localValidation: LocalValidation;
}

export interface LocalFlashcardCandidate {
  original: AIFlashcardCandidate;
  draft: AIFlashcardCandidate;
  selected: boolean;
  edited: boolean;
  localValidation: LocalValidation;
}