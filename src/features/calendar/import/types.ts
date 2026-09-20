import { CalendarEvent } from "../../../core/types";

export type CalendarImportStage =
  | "Uploading"
  | "Preparing source"
  | "Extracting schedule"
  | "Validating dates and times"
  | "Verifying against source"
  | "Checking Calendar conflicts"
  | "Ready for review"
  | "Importing"
  | "Completed"
  | string;
export type CalendarImportStatus =
  | "UPLOADED"
  | "PROCESSING"
  | "READY_FOR_REVIEW"
  | "IMPORTING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | string;
export type CalendarImportReviewStatus = "VERIFIED" | "NEEDS_REVIEW" | "DUPLICATE" | "CONFLICT" | "INVALID";

export interface CalendarImportCandidate {
  candidateId: string;
  title: string | null;
  eventType: string | null;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  rawDate: string | null;
  rawStartTime: string | null;
  rawEndTime: string | null;
  subjectId: string | null;
  subjectLabelRaw: string | null;
  room: string | null;
  doctor: string | null;
  description: string | null;
  targetGroups: string[];
  status?: CalendarImportReviewStatus;
  sourcePage: number | null;
  sourceImageIndex: number | null;
  sourceEvidence: string | null;
  warnings: string[];
  verification: {
    status: "SOURCE_MATCH" | "MISMATCH" | "AMBIGUOUS" | "NOT_FOUND";
    issues: string[];
  };
  selected: boolean;
}

export interface CalendarImportJob {
  id: string;
  status: CalendarImportStatus;
  stage: CalendarImportStage;
  sourceFileName: string;
  sourceMime: string;
  sourcePageCount: number | null;
  timezone: string;
  defaultTargetGroups: string[];
  progressCurrent: number;
  progressTotal: number;
  preview: {
    candidates: CalendarImportCandidate[];
    warnings: string[];
    provider: { provider: string; model: string; transport?: string; mediaCount?: number };
  } | null;
  error: { code: string; message: string | null } | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CalendarImportCreateOptions {
  files: File[];
  targetGroups: string[];
  language?: "en" | "ar";
}

export interface CalendarImportCommitResult {
  inserted: number;
  alreadyImported: number;
  duplicatesSkipped: number;
  conflictsSkipped: number;
  invalidRejected: number;
  events: CalendarEvent[];
}