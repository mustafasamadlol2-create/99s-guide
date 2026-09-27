import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { request as httpRequest } from "node:http";
import express, { type RequestHandler } from "express";
import test from "node:test";
import {
  createOwnerAnalyticsRouter,
  OWNER_ANALYTICS_DEFAULT_LECTURE_LIMIT,
  OWNER_ANALYTICS_MAX_LECTURE_LIMIT,
  OWNER_ANALYTICS_RATE_LIMIT_PER_MINUTE,
  type OwnerAnalyticsRouterDependencies,
} from "../server/routes/ownerAnalytics.js";
import type { OwnerAcademicAggregateInput } from "../server/features/owner-analytics/types.js";
import { createOwnerAcademicAggregateFixture } from "./owner-analytics-fixtures.js";

const LECTURE_IDS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
] as const;

type FakeWhere = {
  AND?: FakeWhere[];
  OR?: FakeWhere[];
  mainSubject?: string | { gt: string };
  id?: { gt: string };
};

type FakeLecture = { id: string; mainSubject: string };

function matchesWhere(row: FakeLecture, where: FakeWhere | undefined): boolean {
  if (!where) return true;
  if (where.AND && !where.AND.every((condition) => matchesWhere(row, condition))) return false;
  if (where.OR && !where.OR.some((condition) => matchesWhere(row, condition))) return false;
  if (typeof where.mainSubject === "string" && row.mainSubject !== where.mainSubject) return false;
  if (
    typeof where.mainSubject === "object"
    && row.mainSubject <= where.mainSubject.gt
  ) return false;
  if (where.id && row.id <= where.id.gt) return false;
  return true;
}

function createFakeDatabase() {
  const lectures: FakeLecture[] = LECTURE_IDS.map((id) => ({ id, mainSubject: "cardiology" }));
  let contentQueries = 0;
  const database = {
    lecture: {
      findFirst: async (args: unknown) => {
        contentQueries += 1;
        const options = args as { where: { mainSubject: string } };
        return lectures.find((lecture) => lecture.mainSubject === options.where.mainSubject)
          ? { id: lectures[0]!.id }
          : null;
      },
      findUnique: async (args: unknown) => {
        contentQueries += 1;
        const options = args as { where: { id: string } };
        const lecture = lectures.find((item) => item.id === options.where.id);
        return lecture ? { id: lecture.id } : null;
      },
      findMany: async (args: unknown) => {
        contentQueries += 1;
        const options = args as { where?: FakeWhere; take: number };
        return lectures
          .filter((lecture) => matchesWhere(lecture, options.where))
          .sort((left, right) =>
            left.mainSubject.localeCompare(right.mainSubject) || left.id.localeCompare(right.id))
          .slice(0, options.take);
      },
    },
  };
  return {
    database,
    get contentQueries() {
      return contentQueries;
    },
  };
}

function createAuth(role: string | null): RequestHandler {
  return (req, res, next) => {
    const requestRole = role ?? req.get("x-test-role") ?? null;
    if (!requestRole) return res.status(401).json({ error: "Authentication required." });
    if (requestRole !== "owner") return res.status(403).json({ error: "Owner access required." });
    (req as express.Request & { user?: { id: string; role: string } }).user = {
      id: "internal-owner-actor",
      role: "owner",
    };
    return next();
  };
}

function fixtureForInput(input: OwnerAcademicAggregateInput) {
  const aggregate = createOwnerAcademicAggregateFixture();
  if (input.subjectIds) {
    aggregate.subjects = input.subjectIds.map((subjectId) => ({
      subjectId,
      lectureCount: LECTURE_IDS.length,
      activeStudyUsers: 0,
      activityWindowMetrics: aggregate.activityWindowMetrics,
      currentStateMetrics: aggregate.currentStateMetrics,
    }));
    for (const subjectId of input.subjectIds) {
      aggregate.privacyMetadata.subjects[subjectId] = aggregate.privacyMetadata.cohort;
    }
  }
  if (input.lectureIds) {
    aggregate.lectures = input.lectureIds.map((lectureId) => ({
      lectureId,
      subjectId: "cardiology",
      samples: { trackedUsers: 0, activeStudyUsers: 0 },
      activityWindowMetrics: aggregate.activityWindowMetrics,
      currentStateMetrics: aggregate.currentStateMetrics,
    }));
    for (const lectureId of input.lectureIds) {
      aggregate.privacyMetadata.lectures[lectureId] = aggregate.privacyMetadata.cohort;
    }
  }
  return aggregate;
}

async function withServer(
  run: (baseUrl: string) => Promise<void>,
  options: {
    role?: string | null;
    enableRateLimit?: boolean;
    onAggregate?: (input: OwnerAcademicAggregateInput) => void;
    onAccessLog?: OwnerAnalyticsRouterDependencies["onAccessLog"];
  } = {},
): Promise<void> {
  const fakeDb = createFakeDatabase();
  const app = express();
  app.use("/api/admin/owner-analytics", createOwnerAnalyticsRouter({
    requireOwner: createAuth(options.role ?? null),
    database: fakeDb.database as never,
    ...(options.enableRateLimit === false
      ? { rateLimiter: (_req, _res, next) => next() }
      : {}),
    getAggregates: async (input) => {
      options.onAggregate?.(input);
      return fixtureForInput(input);
    },
    now: () => new Date("2026-09-27T12:00:00.000Z"),
    onAccessLog: options.onAccessLog ?? (() => {}),
  }));

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP test server did not start.");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }

}

function getWithBody(url: string, body: string, role: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, {
      method: "GET",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
        "x-test-role": role,
      },
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.on("error", reject);
    request.end(body);
  });
}

test("owner access runs before aggregate service; all denial responses are private", async () => {
  let calls = 0;
  const accessLogs: unknown[] = [];
  await withServer(async (baseUrl) => {
    for (const [role, expectedStatus] of [
      [null, 401],
      ["admin", 403],
      ["user", 403],
      ["group-host", 403],
    ] as const) {
      const response = await fetch(`${baseUrl}/api/admin/owner-analytics/academic`, {
        headers: role ? { "x-test-role": role } : {},
      });
      assert.equal(response.status, expectedStatus);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.match(response.headers.get("vary") ?? "", /authorization/iu);
    }
    assert.equal(calls, 0);

    const owner = await fetch(`${baseUrl}/api/admin/owner-analytics/academic`, {
      headers: { "x-test-role": "owner" },
    });
    assert.equal(owner.status, 200);
    const body = await owner.json() as Record<string, unknown>;
    assert.equal(JSON.stringify(body).includes("privacyMetadata"), false);
    assert.equal(JSON.stringify(body).includes("internal-owner-actor"), false);
  }, {
    enableRateLimit: false,
    onAggregate: () => {
      calls += 1;
    },
    onAccessLog: (entry) => {
      accessLogs.push(entry);
    },
  });
  assert.equal(calls, 1);
  assert.equal(accessLogs.length, 1);
  const serializedLogs = JSON.stringify(accessLogs);
  assert.match(serializedLogs, /internal-owner-actor/u);
  assert.doesNotMatch(
    serializedLogs,
    /accuracy|mastery|reviewCount|focusSeconds|verifiedStudySeconds|resourceHandoffs/iu,
  );
});

test("rejects custom windows and identity, subgroup, and sort controls before aggregation", async () => {
  let calls = 0;
  await withServer(async (baseUrl) => {
    for (const query of [
      "?from=2026-09-01",
      "?window=LAST_14_DAYS",
      "?userId=student",
      "?studentId=student",
      "?email=student%40example.test",
      "?ownerId=another-owner",
      "?actorUserId=student",
      "?lectureIds=a&lectureIds=b",
      "?sort=accuracy",
      "?role=owner",
    ]) {
      const response = await fetch(
        `${baseUrl}/api/admin/owner-analytics/academic${query}`,
        { headers: { "x-test-role": "owner" } },
      );
      assert.equal(response.status, 400, query);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
    assert.equal(calls, 0, "unsupported queries must not reach the aggregate service");
    const getBodyStatus = await getWithBody(
      `${baseUrl}/api/admin/owner-analytics/academic`,
      JSON.stringify({ actorUserId: "student" }),
      "owner",
    );
    assert.equal(getBodyStatus, 400);
    assert.equal(calls, 0, "GET bodies must not reach the aggregate service");

    const bodyRequest = await fetch(`${baseUrl}/api/admin/owner-analytics/academic`, {
      method: "POST",
      headers: {
        "x-test-role": "owner",
        "content-type": "application/json",
      },
      body: JSON.stringify({ actorUserId: "student" }),
    });
    assert.equal(bodyRequest.status, 404);
    assert.equal(calls, 0);
  }, {
    enableRateLimit: false,
    onAggregate: () => {
      calls += 1;
    },
  });
});

test("lecture pagination is bounded, content-ordered, and carries only content state", async () => {
  const aggregateLectureIds: string[][] = [];
  await withServer(async (baseUrl) => {
    const headers = { "x-test-role": "owner" };
    const first = await fetch(
      `${baseUrl}/api/admin/owner-analytics/lectures?subjectId=cardiology&limit=2`,
      { headers },
    );
    assert.equal(first.status, 200);
    const firstBody = await first.json() as {
      lectures: Array<{ lectureId: string; analyticsStatus: string }>;
      pageInfo: { limit: number; nextCursor: string | null };
    };
    assert.equal(firstBody.pageInfo.limit, 2);
    assert.equal(firstBody.lectures.length, 2);
    assert.deepEqual(firstBody.lectures.map((lecture) => lecture.lectureId), LECTURE_IDS.slice(0, 2));
    assert.ok(firstBody.pageInfo.nextCursor);
    assert.match(firstBody.pageInfo.nextCursor!, /^[A-Za-z0-9_-]+$/u);
    assert.equal(firstBody.lectures[0]?.analyticsStatus, "NO_DATA");

    const second = await fetch(
      `${baseUrl}/api/admin/owner-analytics/lectures?subjectId=cardiology&limit=2&cursor=${firstBody.pageInfo.nextCursor}`,
      { headers },
    );
    assert.equal(second.status, 200);
    const secondBody = await second.json() as {
      lectures: Array<{ lectureId: string }>;
      pageInfo: { nextCursor: string | null };
    };
    assert.deepEqual(secondBody.lectures.map((lecture) => lecture.lectureId), [LECTURE_IDS[2]]);
    assert.equal(secondBody.pageInfo.nextCursor, null);
  }, {
    enableRateLimit: false,
    onAggregate: (input) => {
      if (input.lectureIds) aggregateLectureIds.push([...input.lectureIds]);
    },
  });
  assert.deepEqual(aggregateLectureIds, [
    [LECTURE_IDS[0], LECTURE_IDS[1]],
    [LECTURE_IDS[2]],
  ]);
});

test("subject and lecture details return only privacy-transformed aggregate DTOs", async () => {
  await withServer(async (baseUrl) => {
    const headers = { "x-test-role": "owner" };
    const subjectResponse = await fetch(
      `${baseUrl}/api/admin/owner-analytics/subjects/cardiology?window=LAST_30_DAYS`,
      { headers },
    );
    assert.equal(subjectResponse.status, 200);
    const subjectBody = await subjectResponse.json() as {
      subject: { subjectId: string; analyticsStatus: string };
      privacy: { policyVersion: string };
    };
    assert.equal(subjectBody.subject.subjectId, "cardiology");
    assert.equal(subjectBody.subject.analyticsStatus, "NO_DATA");
    assert.equal(subjectBody.privacy.policyVersion, "owner-analytics-privacy-v1");
    assert.equal(JSON.stringify(subjectBody).includes("privacyMetadata"), false);

    const lectureResponse = await fetch(
      `${baseUrl}/api/admin/owner-analytics/lectures/${LECTURE_IDS[0]}?window=LAST_7_DAYS`,
      { headers },
    );
    assert.equal(lectureResponse.status, 200);
    const lectureBody = await lectureResponse.json() as {
      lecture: { lectureId: string; analyticsStatus: string };
    };
    assert.equal(lectureBody.lecture.lectureId, LECTURE_IDS[0]);
    assert.equal(lectureBody.lecture.analyticsStatus, "NO_DATA");
    assert.equal(JSON.stringify(lectureBody).includes("privacyMetadata"), false);
  }, { enableRateLimit: false });
});

test("lecture list limit defaults to 25 and rejects values above the hard maximum", async () => {
  assert.equal(OWNER_ANALYTICS_DEFAULT_LECTURE_LIMIT, 25);
  assert.equal(OWNER_ANALYTICS_MAX_LECTURE_LIMIT, 100);
  await withServer(async (baseUrl) => {
    const oversized = await fetch(
      `${baseUrl}/api/admin/owner-analytics/lectures?limit=101`,
      { headers: { "x-test-role": "owner" } },
    );
    assert.equal(oversized.status, 400);
    const defaulted = await fetch(
      `${baseUrl}/api/admin/owner-analytics/lectures`,
      { headers: { "x-test-role": "owner" } },
    );
    assert.equal(defaulted.status, 200);
    const body = await defaulted.json() as { pageInfo: { limit: number } };
    assert.equal(body.pageInfo.limit, OWNER_ANALYTICS_DEFAULT_LECTURE_LIMIT);
  }, { enableRateLimit: false });
});

test("current-semester failure is explicit and never runs the aggregate service", async () => {
  let calls = 0;
  await withServer(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/admin/owner-analytics/academic?window=CURRENT_SEMESTER`,
      { headers: { "x-test-role": "owner" } },
    );
    assert.equal(response.status, 503);
    const body = await response.json() as { code: string };
    assert.equal(body.code, "SEMESTER_CONFIGURATION_UNAVAILABLE");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }, {
    enableRateLimit: false,
    onAggregate: () => {
      calls += 1;
    },
  });
  assert.equal(calls, 0);
});

test("invalid IDs and missing content are rejected before semester resolution or aggregation", async () => {
  let calls = 0;
  await withServer(async (baseUrl) => {
    const headers = { "x-test-role": "owner" };
    const invalidLecture = await fetch(
      `${baseUrl}/api/admin/owner-analytics/lectures/not-a-uuid?window=LAST_7_DAYS`,
      { headers },
    );
    assert.equal(invalidLecture.status, 400);

    const unknownLecture = await fetch(
      `${baseUrl}/api/admin/owner-analytics/lectures/00000000-0000-4000-8000-000000000099?window=CURRENT_SEMESTER`,
      { headers },
    );
    assert.equal(unknownLecture.status, 404);
    const unknownSubject = await fetch(
      `${baseUrl}/api/admin/owner-analytics/subjects/not-a-subject?window=CURRENT_SEMESTER`,
      { headers },
    );
    assert.equal(unknownSubject.status, 404);
    assert.equal(calls, 0);
  }, {
    enableRateLimit: false,
    onAggregate: () => {
      calls += 1;
    },
  });
});

test("owner-specific request limit is 60 per minute", async () => {
  assert.equal(OWNER_ANALYTICS_RATE_LIMIT_PER_MINUTE, 60);
  await withServer(async (baseUrl) => {
    let lastStatus = 0;
    let lastCacheControl: string | null = null;
    for (let request = 0; request < OWNER_ANALYTICS_RATE_LIMIT_PER_MINUTE + 1; request += 1) {
      const response = await fetch(`${baseUrl}/api/admin/owner-analytics/academic`, {
        headers: { "x-test-role": "owner" },
      });
      lastStatus = response.status;
      lastCacheControl = response.headers.get("cache-control");
      await response.arrayBuffer();
    }
    assert.equal(lastStatus, 429);
    assert.equal(lastCacheControl, "private, no-store");
  });
});