import assert from "node:assert/strict";
import test from "node:test";
import type { FocusRepository } from "../server/features/focus/repository.js";
import {
  FOCUS_HISTORY_DEFAULT_LIMIT,
  FOCUS_HISTORY_MAX_LIMIT,
  focusHistoryQuerySchema,
} from "../server/features/focus/schemas.js";
import {
  decodeFocusHistoryCursor,
  encodeFocusHistoryCursor,
} from "../server/features/focus/historyCursor.js";
import { createFocusService } from "../server/features/focus/service.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const PLAN_ID = "44444444-4444-4444-8444-444444444444";
const PLAN_ITEM_ID = "55555555-5555-4555-8555-555555555555";
const LECTURE_ID = "66666666-6666-4666-8666-666666666666";
const PDF_ID = "77777777-7777-4777-8777-777777777777";
const NOTE_ID = "88888888-8888-4888-8888-888888888888";
const STARTED_AT = new Date("2026-09-20T10:00:00.000Z");
const ENDED_AT = new Date("2026-09-20T10:45:00.000Z");

const planItem = {
  id: PLAN_ITEM_ID,
  lectureId: LECTURE_ID,
  sequence: 1,
  sessionCount: 3,
  focusDurationSeconds: 1_800,
  breakDurationSeconds: 300,
  includeMcq: false,
  includeFlashcards: false,
  includeVideo: true,
};
const lecture = { id: LECTURE_ID, name: "Atomic structure", mainSubject: "Chemistry" };
const session = {
  id: SESSION_ID,
  userId: USER_ID,
  planId: PLAN_ID,
  planItemId: PLAN_ITEM_ID,
  lectureId: LECTURE_ID,
  status: "COMPLETED",
  startedAt: STARTED_AT,
  plannedEndAt: ENDED_AT,
  actualEndedAt: ENDED_AT,
  lastCheckpointAt: ENDED_AT,
  activeSeconds: 1_800,
  pauseSeconds: 600,
  completionReason: "PLANNED_DURATION_ELAPSED",
  createdAt: STARTED_AT,
  updatedAt: ENDED_AT,
  planItem,
  plan: {
    id: PLAN_ID,
    title: "Chemistry revision",
    status: "ACTIVE",
    items: [{ ...planItem, lecture }],
  },
  lecture,
};
const events = [
  {
    focusSessionId: SESSION_ID,
    eventType: "focus_session_completed",
    source: "backend",
    occurredAt: ENDED_AT,
    payload: { activeSeconds: 1_800, pauseSeconds: 600 },
  },
  {
    focusSessionId: SESSION_ID,
    eventType: "focus_resource_handoff_started",
    source: "web",
    occurredAt: new Date("2026-09-20T10:10:00.000Z"),
    payload: { resourceId: PDF_ID, resourceType: "PDF" },
  },
  {
    focusSessionId: SESSION_ID,
    eventType: "focus_resource_handoff_started",
    source: "web",
    occurredAt: new Date("2026-09-20T10:20:00.000Z"),
    payload: { resourceId: PDF_ID, resourceType: "PDF" },
  },
];

function makeService(tx: Record<string, any>) {
  const repository = {
    database: {
      $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
    },
  } as unknown as FocusRepository;
  return createFocusService({
    repository,
    isFocusEnabled: () => true,
    isStudyEventsEnabled: () => true,
  });
}

test("Focus history query defaults and caps page sizes and rejects unsafe filters", () => {
  assert.equal(focusHistoryQuerySchema.parse({}).limit, FOCUS_HISTORY_DEFAULT_LIMIT);
  assert.equal(
    focusHistoryQuerySchema.parse({ limit: FOCUS_HISTORY_MAX_LIMIT }).limit,
    FOCUS_HISTORY_MAX_LIMIT,
  );
  assert.equal(focusHistoryQuerySchema.safeParse({ limit: FOCUS_HISTORY_MAX_LIMIT + 1 }).success, false);
  assert.equal(focusHistoryQuerySchema.safeParse({ status: "UNKNOWN" }).success, false);
  assert.equal(focusHistoryQuerySchema.safeParse({ unexpected: true }).success, false);
});

test("Focus history cursors round-trip and reject malformed or noncanonical values", () => {
  const cursor = { startedAt: STARTED_AT, sessionId: SESSION_ID };
  assert.deepEqual(decodeFocusHistoryCursor(encodeFocusHistoryCursor(cursor)), cursor);
  assert.throws(() => decodeFocusHistoryCursor("not-a-cursor"), { code: "INVALID_REQUEST" });
  assert.throws(
    () => decodeFocusHistoryCursor(Buffer.from(JSON.stringify(["2026-09-20", SESSION_ID])).toString("base64url")),
    { code: "INVALID_REQUEST" },
  );
});

test("Focus summary uses canonical completion, ledger, resource, and private-note facts", async () => {
  let pointWhere: Record<string, unknown> | undefined;
  let completedBeforeWhere: Record<string, any> | undefined;
  const tx = {
    focusSession: {
      findFirst: async (args: { where: { userId: string } }) =>
        args.where.userId === USER_ID ? session : null,
      groupBy: async () => [{
        planItemId: PLAN_ITEM_ID,
        status: "COMPLETED",
        _count: { _all: 2 },
      }],
      count: async (args: { where: Record<string, any> }) => {
        completedBeforeWhere = args.where;
        return 1;
      },
    },
    studyEvent: { findMany: async () => events },
    focusQuickNote: {
      findMany: async () => [{
        id: NOTE_ID,
        userId: USER_ID,
        focusSessionId: SESSION_ID,
        lectureId: LECTURE_ID,
        content: "Review the orbital diagram.",
        status: "ACTIVE",
        convertedToPlanItemId: null,
        createdAt: STARTED_AT,
        updatedAt: ENDED_AT,
        archivedAt: null,
        convertedAt: null,
      }],
    },
    material: {
      findMany: async () => [{ id: PDF_ID, title: "Atomic structure notes", type: "PDF" }],
    },
    studyPointsLedgerEntry: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        pointWhere = args.where;
        return [{
          sourceId: SESSION_ID,
          amount: 5,
          reasonCode: "focus.verified_completion",
          reversedBy: null,
        }];
      },
    },
  };
  const service = makeService(tx);
  const result = await service.getSessionSummary(USER_ID, SESSION_ID);

  assert.equal(result.timing.verifiedFocusSeconds, 1_800);
  assert.equal(result.timing.plannedBreakSeconds, 300);
  assert.equal(result.progress.sessionNumber, 2);
  assert.equal(result.progress.completedSessions, 2);
  assert.equal(result.progress.totalPlannedSessions, 3);
  assert.equal(result.progress.isLastPlannedSession, false);
  assert.deepEqual(result.points, { amount: 5, reasonCode: "focus.verified_completion" });
  assert.equal(result.resources.launchCount, 2);
  assert.equal(result.resources.uniqueResourceCount, 1);
  assert.equal(result.resources.items[0]?.title, "Atomic structure notes");
  assert.equal(result.quickNotes[0]?.content, "Review the orbital diagram.");
  assert.equal(result.nextAction.kind, "NEXT_SESSION");
  assert.equal(pointWhere?.sourceType, "FOCUS_SESSION");
  assert.equal(pointWhere?.sourceId, SESSION_ID);
  assert.deepEqual(completedBeforeWhere?.OR, [
    { startedAt: { lt: STARTED_AT } },
    { startedAt: STARTED_AT, id: { lt: SESSION_ID } },
  ]);
  await assert.rejects(service.getSessionSummary(OTHER_USER_ID, SESSION_ID), {
    code: "SESSION_NOT_FOUND",
  });
});

test("Focus history is user-scoped, bounded, cursor-paginated, and omits Quick Note text", async () => {
  const findManyCalls: Array<Record<string, any>> = [];
  const row = {
    id: SESSION_ID,
    status: "COMPLETED",
    planId: PLAN_ID,
    planItemId: PLAN_ITEM_ID,
    lectureId: LECTURE_ID,
    startedAt: STARTED_AT,
    actualEndedAt: ENDED_AT,
    activeSeconds: 1_800,
    plan: { title: "Chemistry revision", status: "ACTIVE" },
    planItem: { focusDurationSeconds: 1_800 },
    lecture,
  };
  const laterRow = { ...row, id: "99999999-9999-4999-8999-999999999999" };
  const tx = {
    focusSession: {
      findMany: async (args: Record<string, any>) => {
        findManyCalls.push(args);
        return findManyCalls.length === 1 ? [row, laterRow] : [laterRow];
      },
    },
    studyEvent: { findMany: async () => events },
    studyPointsLedgerEntry: {
      findMany: async () => [{
        sourceId: SESSION_ID,
        amount: 5,
        reasonCode: "focus.verified_completion",
        reversedBy: { amount: -5 },
      }],
    },
  };
  const service = makeService(tx);
  const first = await service.listHistory(USER_ID, {
    limit: 1,
    status: "COMPLETED",
    subject: "Chemistry",
    lectureId: LECTURE_ID,
  });
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0]?.verifiedFocusSeconds, 1_800);
  assert.equal(first.items[0]?.points, null);
  assert.equal(first.items[0]?.resourceLaunchCount, 2);
  assert.equal("quickNotes" in (first.items[0] ?? {}), false);
  assert.ok(first.nextCursor);
  assert.equal(findManyCalls[0]?.where.userId, USER_ID);
  assert.equal(findManyCalls[0]?.where.status, "COMPLETED");
  assert.equal(findManyCalls[0]?.where.lectureId, LECTURE_ID);
  assert.equal(findManyCalls[0]?.where.lecture.is.mainSubject, "Chemistry");
  assert.deepEqual(findManyCalls[0]?.orderBy, [{ startedAt: "desc" }, { id: "desc" }]);
  assert.equal(findManyCalls[0]?.take, 2);

  const second = await service.listHistory(USER_ID, {
    limit: 1,
    cursor: first.nextCursor!,
    status: "COMPLETED",
    subject: "Chemistry",
    lectureId: LECTURE_ID,
  });
  assert.equal(second.items[0]?.sessionId, laterRow.id);
  assert.equal(second.nextCursor, null);
  assert.equal(findManyCalls[1]?.where.userId, USER_ID);
  assert.deepEqual(
    decodeFocusHistoryCursor(first.nextCursor!),
    { startedAt: STARTED_AT, sessionId: SESSION_ID },
  );
});

test("Focus summaries never infer verified time or Points without matching completion evidence", async () => {
  for (const status of ["COMPLETED", "ABANDONED", "EXPIRED"] as const) {
    const tx = {
      focusSession: {
        findFirst: async () => ({ ...session, status }),
        groupBy: async () => [],
        count: async () => 0,
      },
      studyEvent: { findMany: async () => [] },
      focusQuickNote: { findMany: async () => [] },
      material: { findMany: async () => [] },
      studyPointsLedgerEntry: {
        findMany: async () => {
          assert.fail("Unverified sessions must not query or report Focus Points.");
        },
      },
    };
    const result = await makeService(tx).getSessionSummary(USER_ID, SESSION_ID);
    assert.equal(result.status, status);
    assert.equal(result.timing.verifiedFocusSeconds, null);
    assert.equal(result.points, null);
  }
});