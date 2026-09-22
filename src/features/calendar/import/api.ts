import { apiClient, errorMessageFromBody } from "../../../core/api/apiClient";
import {
  CalendarImportCandidate, CalendarImportCommitResult, CalendarImportCreateOptions,
  CalendarImportJob,
} from "./types";

const IMPORT_BASE = "/api/admin/calendar/import";

function unwrap<T>(value: unknown): T {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return (record.job || record.data || value) as T;
  }
  return value as T;
}

async function json<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => ({}));
  const errorBody = body && typeof body === "object" && !Array.isArray(body)
    ? body as { error?: string | { message?: unknown }; message?: string; [key: string]: unknown }
    : null;
  if (!response.ok) throw new Error(errorMessageFromBody(errorBody) || "Calendar import request failed.");
  return unwrap<T>(body);
}

export async function createCalendarImportJob(options: CalendarImportCreateOptions): Promise<CalendarImportJob> {
  const form = new FormData();
  (options.files ?? []).forEach((file) => form.append("files", file));
  if (options.text?.trim()) form.append("text", options.text);
  form.append("defaultTargetGroups", JSON.stringify(options.targetGroups));
  if (options.language) form.append("language", options.language);
  return json<CalendarImportJob>(await apiClient(IMPORT_BASE, {
    method: "POST", body: form, bypassCache: true, retries: 0,
  }));
}

export async function getCalendarImportJob(jobId: string): Promise<CalendarImportJob> {
  return json<CalendarImportJob>(await apiClient(`${IMPORT_BASE}/${encodeURIComponent(jobId)}`, {
    bypassCache: true, retries: 0,
  }));
}

export async function updateCalendarImportReview(jobId: string, candidates: CalendarImportCandidate[]): Promise<CalendarImportJob> {
  return json<CalendarImportJob>(await apiClient(`${IMPORT_BASE}/${encodeURIComponent(jobId)}/review`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidates }), bypassCache: true, retries: 0,
  }));
}

export async function commitCalendarImportJob(jobId: string, candidateIds: string[], allowConflicts = false): Promise<CalendarImportCommitResult> {
  return json<CalendarImportCommitResult>(await apiClient(`${IMPORT_BASE}/${encodeURIComponent(jobId)}/commit`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidateIds, allowConflicts }), bypassCache: true, retries: 0,
  }));
}

export async function cancelCalendarImportJob(jobId: string): Promise<void> {
  await apiClient(`${IMPORT_BASE}/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST", bypassCache: true, retries: 0,
  });
}