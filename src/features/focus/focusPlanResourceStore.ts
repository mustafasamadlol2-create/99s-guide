import type { FocusPlanResourceSelectionDto } from "../../../server/features/focus/types";
import type { FocusPlanDraft, FocusPlanRecord } from "./focusHubModel";

const STORAGE_PREFIX = "99s-focus-plan-resource-selections:v1:";
const MAX_STORED_PLANS = 24;
const RESOURCE_TYPES = new Set(["PDF", "NOTE", "MCQ_SET", "FLASHCARD_SET", "VIDEO"]);

type StoredPlanResources = {
  updatedAt: number;
  byLecture: Record<string, FocusPlanResourceSelectionDto[]>;
};

type StoredEnvelope = {
  version: 1;
  plans: Record<string, StoredPlanResources>;
};

function storageKey(accountId: string): string {
  return `${STORAGE_PREFIX}${accountId}`;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function normalizeResources(value: unknown): FocusPlanResourceSelectionDto[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: FocusPlanResourceSelectionDto[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    if (
      typeof item.resourceType !== "string" ||
      !RESOURCE_TYPES.has(item.resourceType) ||
      typeof item.resourceId !== "string" ||
      !item.resourceId.trim()
    ) continue;
    const key = `${item.resourceType}:${item.resourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      resourceType: item.resourceType as FocusPlanResourceSelectionDto["resourceType"],
      resourceId: item.resourceId,
      sequence: result.length + 1,
    });
  }
  return result;
}

function readEnvelope(accountId: string | null): StoredEnvelope {
  if (!accountId || !canUseStorage()) return { version: 1, plans: {} };
  try {
    const raw = window.localStorage.getItem(storageKey(accountId));
    if (!raw) return { version: 1, plans: {} };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { version: 1, plans: {} };
    }
    const plansRaw = (parsed as { plans?: unknown }).plans;
    if (!plansRaw || typeof plansRaw !== "object" || Array.isArray(plansRaw)) {
      return { version: 1, plans: {} };
    }
    const plans: StoredEnvelope["plans"] = {};
    for (const [planId, value] of Object.entries(plansRaw as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const row = value as { updatedAt?: unknown; byLecture?: unknown };
      const byLectureRaw = row.byLecture;
      if (!byLectureRaw || typeof byLectureRaw !== "object" || Array.isArray(byLectureRaw)) continue;
      const byLecture: Record<string, FocusPlanResourceSelectionDto[]> = {};
      for (const [lectureId, resources] of Object.entries(byLectureRaw as Record<string, unknown>)) {
        const normalized = normalizeResources(resources);
        if (normalized.length > 0) byLecture[lectureId] = normalized;
      }
      if (Object.keys(byLecture).length > 0) {
        plans[planId] = {
          updatedAt: typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt)
            ? row.updatedAt
            : 0,
          byLecture,
        };
      }
    }
    return { version: 1, plans };
  } catch {
    return { version: 1, plans: {} };
  }
}

function writeEnvelope(accountId: string | null, envelope: StoredEnvelope): void {
  if (!accountId || !canUseStorage()) return;
  try {
    const entries = Object.entries(envelope.plans)
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_STORED_PLANS);
    window.localStorage.setItem(storageKey(accountId), JSON.stringify({
      version: 1,
      plans: Object.fromEntries(entries),
    }));
  } catch {
    // Resource persistence is a planner convenience only. Never block Focus.
  }
}

export function rememberFocusPlanDraftResources(
  accountId: string | null,
  planId: string,
  draft: FocusPlanDraft,
): void {
  if (!accountId || !planId) return;
  const envelope = readEnvelope(accountId);
  const byLecture: Record<string, FocusPlanResourceSelectionDto[]> = {};
  for (const item of draft.items) {
    const resources = normalizeResources(item.resources);
    if (resources.length > 0) byLecture[item.lectureId] = resources;
  }
  if (Object.keys(byLecture).length === 0) return;
  envelope.plans[planId] = { updatedAt: Date.now(), byLecture };
  writeEnvelope(accountId, envelope);
}

export function hydrateFocusPlanResourceSelections(
  accountId: string | null,
  plan: FocusPlanRecord | null,
): FocusPlanRecord | null {
  if (!accountId || !plan) return plan;
  const stored = readEnvelope(accountId).plans[plan.id];
  if (!stored) return plan;
  let changed = false;
  const items = plan.items.map((item) => {
    if ((item.resources?.length ?? 0) > 0) return item;
    const resources = stored.byLecture[item.lectureId] ?? [];
    if (resources.length === 0) return item;
    changed = true;
    return {
      ...item,
      resources,
      includeMcq: resources.some((resource) => resource.resourceType === "MCQ_SET"),
      includeFlashcards: resources.some((resource) => resource.resourceType === "FLASHCARD_SET"),
      includeVideo: resources.some((resource) => resource.resourceType === "VIDEO"),
    };
  });
  return changed ? { ...plan, items } : plan;
}
