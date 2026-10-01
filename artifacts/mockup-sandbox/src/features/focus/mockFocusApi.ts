import type {
  FocusPlanRecord,
  FocusSessionRecord,
} from "./focusHubModel";

type PlanItemInput = FocusPlanRecord["items"][number];
type CurrentSessionResult = { session: FocusSessionRecord | null };
type PlanInput = {
  title: string;
  timezone: string;
  items: Array<Omit<PlanItemInput, "id"> & { id?: string }>;
};

export class FocusApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FocusApiError";
  }
}

let savedPlan: FocusPlanRecord | null = null;
let sequence = 0;

function makePlan(input: PlanInput): FocusPlanRecord {
  const now = new Date().toISOString();
  const id = savedPlan?.id ?? `sandbox-plan-${++sequence}`;
  return {
    id,
    title: input.title,
    status: "ACTIVE",
    timezone: input.timezone,
    planVersion: (savedPlan?.planVersion ?? 0) + 1,
    createdAt: savedPlan?.createdAt ?? now,
    updatedAt: now,
    archivedAt: null,
    items: input.items.map((item, index) => ({
      ...item,
      id: item.id ?? `sandbox-item-${index + 1}`,
    })),
  };
}

export const focusApi = {
  async getCurrentFocusSession(): Promise<CurrentSessionResult> {
    return { session: null };
  },
  async listFocusPlans(_limit?: number): Promise<FocusPlanRecord[]> {
    return savedPlan ? [savedPlan] : [];
  },
  async getFocusPlan(_id: string): Promise<FocusPlanRecord> {
    if (!savedPlan) throw new FocusApiError("No sandbox plan exists.", "NOT_FOUND", 404);
    return savedPlan;
  },
  async createFocusPlan(input: PlanInput): Promise<FocusPlanRecord> {
    savedPlan = makePlan(input);
    return savedPlan;
  },
  async updateFocusPlan(_id: string, input: PlanInput): Promise<FocusPlanRecord> {
    savedPlan = makePlan(input);
    return savedPlan;
  },
  async startFocusSession(_input: {
    planId: string;
    planItemId: string;
    idempotencyKey: string;
    source: "web";
  }): Promise<{ session: FocusSessionRecord }> {
    throw new FocusApiError("Session start is disabled in the isolated preview.");
  },
};

let idempotencySequence = 0;
export function createFocusIdempotencyKey(): string {
  return `mockup-focus-${++idempotencySequence}`;
}

export function getFocusClientSource(): "web" {
  return "web";
}