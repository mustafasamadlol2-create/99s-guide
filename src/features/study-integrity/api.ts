import { apiClient } from "../../core/api/apiClient";

export type IntegritySignalStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED";
export type IntegritySignalSeverity = "INFO" | "REVIEW" | "BLOCK";

export type IntegritySignal = {
  id: string;
  userId: string;
  actionType: string;
  observationCode: string;
  category: string;
  severity: IntegritySignalSeverity;
  ruleId: string;
  ruleVersion: string;
  evidenceClass: string;
  source: string;
  privacyClass: string;
  resourceKind: string | null;
  resourceId: string | null;
  firstOccurredAt: string;
  lastOccurredAt: string;
  lastReceivedAt: string;
  occurrenceCount: number;
  status: IntegritySignalStatus;
  reviewVersion: number;
  latestSafeDetails: unknown;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

export type IntegrityReviewAction = {
  id: string;
  signalId: string;
  reviewerUserId: string | null;
  fromStatus: string;
  toStatus: string;
  actionType: string;
  note: string | null;
  createdAt: string;
};

export type IntegritySignalPage = {
  items: IntegritySignal[];
  nextCursor: string | null;
};

export type IntegritySignalDetail = {
  signal: IntegritySignal;
  reviewHistory: IntegrityReviewAction[];
};

class IntegrityApiError extends Error {
  constructor(readonly status: number, message = "Study integrity request failed.") {
    super(message);
    this.name = "IntegrityApiError";
  }
}

async function requestJson<T>(path: string, init: RequestInit & { bypassCache?: boolean } = {}): Promise<T> {
  const response = await apiClient(path, {
    ...init,
    cache: "no-store",
    bypassCache: true,
    ttl: 0,
    retries: 0,
    silent: true,
  });
  if (!response.ok) {
    let message = "Study integrity request failed.";
    try {
      const body = await response.json() as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) message = body.error;
    } catch {
      // Keep the stable fallback message.
    }
    throw new IntegrityApiError(response.status, message);
  }
  return await response.json() as T;
}

export async function listIntegritySignals(input: {
  status?: IntegritySignalStatus | "all";
  severity?: IntegritySignalSeverity;
  category?: string;
  limit?: number;
  cursor?: string | null;
} = {}): Promise<IntegritySignalPage> {
  const query = new URLSearchParams();
  query.set("status", input.status ?? "OPEN");
  query.set("limit", String(input.limit ?? 50));
  if (input.severity) query.set("severity", input.severity);
  if (input.category) query.set("category", input.category);
  if (input.cursor) query.set("cursor", input.cursor);
  return requestJson<IntegritySignalPage>(`/api/admin/study-integrity/signals?${query.toString()}`);
}

export async function getIntegritySignal(signalId: string): Promise<IntegritySignalDetail> {
  return requestJson<IntegritySignalDetail>(
    `/api/admin/study-integrity/signals/${encodeURIComponent(signalId)}`,
  );
}

export async function reviewIntegritySignal(input: {
  signalId: string;
  action: "ACKNOWLEDGE" | "RESOLVE" | "DISMISS" | "REOPEN" | "ADD_NOTE";
  expectedReviewVersion: number;
  note?: string;
}): Promise<{ signal: IntegritySignal; reviewAction: IntegrityReviewAction }> {
  return requestJson(
    `/api/admin/study-integrity/signals/${encodeURIComponent(input.signalId)}/review`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: input.action,
        expectedReviewVersion: input.expectedReviewVersion,
        ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      }),
    },
  );
}

export async function reverseIntegrityFocusPoints(signalId: string): Promise<{
  signalId: string;
  originalEntryId: string;
  reversalEntryId: string;
  amount: number;
  replayed: boolean;
}> {
  return requestJson(
    `/api/admin/study-integrity/signals/${encodeURIComponent(signalId)}/reverse-focus-points`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
  );
}
