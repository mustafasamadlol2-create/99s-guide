export type StudyAnalyzerOutput = {
  generatedAt: string;
  sourceEventCount: number;
};

// Core analytics must remain computable without Workers AI.