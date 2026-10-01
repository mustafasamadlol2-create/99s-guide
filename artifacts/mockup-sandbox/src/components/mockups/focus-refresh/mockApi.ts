import type {
  FocusPlanRecord,
  FocusSessionRecord,
} from "./FocusHubModel";

type PlanItemInput = Omit<FocusPlanRecord["items"][number], "id"> & {
  id?: string;
};
type PlanInput = {
  title: string;
  timezone: string;
  items: PlanItemInput[];
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

const lectureIds = [
  "b98f08e1-b9a2-4f75-9b7c-33e7eaa32f61",
  "74b25893-8ed7-4c34-8ccf-85244ebff118",
];
const now = "2025-02-14T09:00:00.000Z";

let savedPlan: FocusPlanRecord | null = {
  id: "b98f08e1-b9a2-4f75-9b7c-33e7eaa32f60",
  title: "Today’s Focus Plan",
  status: "ACTIVE",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  planVersion: 1,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  items: [
    {
      id: "b98f08e1-b9a2-4f75-9b7c-33e7eaa32f62",
      lectureId: lectureIds[0],
      sequence: 1,
      sessionCount: 2,
      focusDurationSeconds: 25 * 60,
      breakDurationSeconds: 5 * 60,
      includeMcq: false,
      includeFlashcards: false,
      includeVideo: false,
    },
    {
      id: "b98f08e1-b9a2-4f75-9b7c-33e7eaa32f63",
      lectureId: lectureIds[1],
      sequence: 2,
      sessionCount: 1,
      focusDurationSeconds: 25 * 60,
      breakDurationSeconds: 5 * 60,
      includeMcq: false,
      includeFlashcards: false,
      includeVideo: false,
    },
  ],
};

let currentSession: FocusSessionRecord | null = null;
let planSequence = 0;
let idempotencySequence = 0;

function makePlan(input: PlanInput): FocusPlanRecord {
  const timestamp = new Date().toISOString();
  return {
    id: savedPlan?.id ?? `sandbox-plan-${++planSequence}`,
    title: input.title,
    status: "ACTIVE",
    timezone: input.timezone,
    planVersion: (savedPlan?.planVersion ?? 0) + 1,
    createdAt: savedPlan?.createdAt ?? timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    items: input.items.map((item, index) => ({
      ...item,
      id: item.id ?? `sandbox-item-${index + 1}`,
    })),
  };
}

export const focusApi = {
  async getCurrentFocusSession() {
    return { session: currentSession };
  },
  async listFocusPlans(_limit?: number) {
    return savedPlan ? [savedPlan] : [];
  },
  async getFocusPlan(id: string) {
    if (!savedPlan || savedPlan.id !== id) {
      throw new FocusApiError("No sandbox plan exists.", "NOT_FOUND", 404);
    }
    return savedPlan;
  },
  async createFocusPlan(input: PlanInput) {
    savedPlan = makePlan(input);
    return savedPlan;
  },
  async updateFocusPlan(_id: string, input: PlanInput) {
    savedPlan = makePlan(input);
    return savedPlan;
  },
  async startFocusSession(input: {
    planId: string;
    planItemId: string;
    idempotencyKey: string;
    source: "web";
  }) {
    if (currentSession) {
      throw new FocusApiError("A sandbox session is already active.", "ACTIVE_SESSION_EXISTS", 409);
    }
    const item = savedPlan?.items.find((candidate) => candidate.id === input.planItemId);
    if (!savedPlan || !item) {
      throw new FocusApiError("The sandbox plan item is unavailable.", "NOT_FOUND", 404);
    }
    currentSession = {
      id: `sandbox-session-${++idempotencySequence}`,
      planId: input.planId,
      planItemId: input.planItemId,
      lectureId: item.lectureId,
      sessionNumber: 1,
      plannedSessionCount: item.sessionCount,
      status: "ACTIVE",
    };
    return { session: currentSession };
  },
};

export function createFocusIdempotencyKey(): string {
  return `sandbox-focus-${++idempotencySequence}`;
}

export function getFocusClientSource(): "web" {
  return "web";
}