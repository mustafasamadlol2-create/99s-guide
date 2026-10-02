export interface FocusPlanItemRecord {
  id: string;
  lectureId: string;
  sequence: number;
  sessionCount: number;
  focusDurationSeconds: number;
  breakDurationSeconds: number;
  includeMcq: boolean;
  includeFlashcards: boolean;
  includeVideo: boolean;
}

export interface FocusPlanRecord {
  id: string;
  title: string;
  status: "ACTIVE" | "ARCHIVED" | string;
  timezone: string;
  planVersion: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  items: FocusPlanItemRecord[];
}

export interface FocusSessionRecord {
  id: string;
  planId: string;
  planItemId: string;
  lectureId: string;
  sessionNumber: number;
  plannedSessionCount: number;
  status: string;
}

type FocusPlanInput = {
  title: string;
  timezone: string;
  items: Array<Omit<FocusPlanItemRecord, "id"> & { id?: string }>;
};

export interface FocusApi {
  getCurrentFocusSession(): Promise<{ session: FocusSessionRecord | null }>;
  listFocusPlans(limit?: number): Promise<FocusPlanRecord[]>;
  getFocusPlan(id: string): Promise<FocusPlanRecord>;
  createFocusPlan(input: FocusPlanInput): Promise<FocusPlanRecord>;
  updateFocusPlan(id: string, input: FocusPlanInput): Promise<FocusPlanRecord>;
  startFocusSession(input: {
    planId: string;
    planItemId: string;
    idempotencyKey: string;
    source: "web";
  }): Promise<{ session: FocusSessionRecord }>;
}

export class FocusApiError extends Error {
  constructor(
    readonly kind: "transport" | "http" | "protocol",
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FocusApiError";
  }
}

const fixturePlan: FocusPlanRecord = {
  id: "96e00dbe-9898-4d36-9b17-44e3b90c693a",
  title: "Focus Plan",
  status: "ACTIVE",
  timezone: "UTC",
  planVersion: 1,
  createdAt: "2025-01-01T09:00:00.000Z",
  updatedAt: "2025-01-01T09:00:00.000Z",
  archivedAt: null,
  items: [
    {
      id: "32f89d7b-769f-43ae-a1cb-83682e2876ab",
      lectureId: "b98f08e1-b9a2-4f75-9b7c-33e7eaa32f61",
      sequence: 1,
      sessionCount: 2,
      focusDurationSeconds: 25 * 60,
      breakDurationSeconds: 5 * 60,
      includeMcq: false,
      includeFlashcards: false,
      includeVideo: false,
    },
    {
      id: "9082b9d8-2132-4625-9a68-7b730bacfa81",
      lectureId: "74b25893-8ed7-4c34-8ccf-85244ebff118",
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

let plan = fixturePlan;
let currentSession: FocusSessionRecord | null = null;
let planCounter = 1;

function savePlan(input: FocusPlanInput): FocusPlanRecord {
  planCounter += 1;
  plan = {
    ...plan,
    ...input,
    planVersion: plan.planVersion + 1,
    updatedAt: new Date().toISOString(),
    items: input.items.map((item, index) => ({
      ...item,
      id: item.id ?? `00000000-0000-4000-8000-${String(planCounter * 100 + index + 1).padStart(12, "0")}`,
    })),
  };
  return plan;
}

export const focusApi: FocusApi = {
  async getCurrentFocusSession() {
    return { session: currentSession };
  },
  async listFocusPlans() {
    return [plan];
  },
  async getFocusPlan(id) {
    if (id !== plan.id) {
      throw new FocusApiError("http", "Focus plan not found.", "NOT_FOUND", 404);
    }
    return plan;
  },
  async createFocusPlan(input) {
    planCounter += 1;
    return savePlan(input);
  },
  async updateFocusPlan(_id, input) {
    return savePlan(input);
  },
  async startFocusSession(input) {
    const item = plan.items.find((candidate) => candidate.id === input.planItemId);
    if (!item) {
      throw new FocusApiError("http", "Focus plan item not found.", "NOT_FOUND", 404);
    }
    currentSession = {
      id: "2bba58f5-527a-4f28-a7b5-c0b6f301bb9c",
      planId: input.planId,
      planItemId: item.id,
      lectureId: item.lectureId,
      sessionNumber: 1,
      plannedSessionCount: item.sessionCount,
      status: "ACTIVE",
    };
    return { session: currentSession };
  },
};