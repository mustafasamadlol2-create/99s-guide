export type MaintenanceMode = "dry-run" | "apply";
export type MaintenanceEnvironment =
  | "local"
  | "development"
  | "test"
  | "staging"
  | "production";

export interface MaintenanceRunOptions {
  jobType: string;
  jobVersion: string;
  environment: MaintenanceEnvironment;
  mode: MaintenanceMode;
  scope: string;
  userId?: string;
  lectureId?: string;
  seasonId?: string;
  snapshotId?: string;
  all: boolean;
  allowCloudflare: boolean;
  allowExternalWrites: boolean;
  before?: string;
  olderThanDays?: number;
  asOf: string;
  batchSize: number;
  sleepMs: number;
  maxRps?: number;
  limit?: number;
  maxErrors: number;
  failOnDrift: boolean;
  resumeJobId?: string;
  afterId?: string;
  reportFile?: string;
  quiet: boolean;
  checkpointDir?: string;
}

export interface MaintenanceArgs {
  command: string;
  options: MaintenanceRunOptions;
}

export interface MaintenanceItem {
  id: string;
}

export interface InspectionResult {
  status: string;
  wouldChange?: boolean;
  changed?: boolean;
  skipped?: boolean;
  code?: string;
}

export interface MaintenanceAdapter<T extends MaintenanceItem = MaintenanceItem> {
  discoverBatch(input: {
    cursor: string | null;
    limit: number;
    scope: string;
  }): Promise<{ items: T[]; nextCursor: string | null }>;
  inspect(item: T, input: { asOf: string }): Promise<InspectionResult>;
  apply(item: T, input: { asOf: string }): Promise<InspectionResult>;
}

export interface MaintenanceReport {
  jobId: string;
  jobVersion: string;
  jobType: string;
  mode: MaintenanceMode;
  environment: MaintenanceEnvironment;
  scope: string;
  asOf: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  scanned: number;
  unchanged: number;
  changed: number;
  wouldChange: number;
  errors: number;
  skipped: number;
  checkpoint: string | null;
  status?: "PAUSED" | "COMPLETED";
  statusCounts?: Record<string, number>;
  errorDetails?: Array<{ code: string; message: string; itemId?: string }>;
}