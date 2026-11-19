import assert from "node:assert/strict";
import test from "node:test";
import { getBaghdadWeekPeriod } from "../server/features/gamification/challengePeriods.js";
import { readWeeklyChallengesWithBoundaryBridge } from "../server/features/gamification/weeklyChallengeBoundaryRead.js";

function stale() {
  return Object.assign(new Error("Week changed"), {
    name: "Phase6GamificationReadError",
    code: "PHASE6_WEEKLY_CHALLENGES_EXPIRED",
  });
}

test("Baghdad Sunday-to-Monday boundary: 2026-11-16 -> 2026-11-23", () => {
  const before = getBaghdadWeekPeriod(new Date("2026-11-22T20:59:59.999Z"));
  const after = getBaghdadWeekPeriod(new Date("2026-11-22T21:00:00.000Z"));
  assert.equal(before.periodKey, "2026-11-16");
  assert.equal(after.periodKey, "2026-11-23");
  assert.equal(before.endsAt.toISOString(), after.startsAt.toISOString());
  assert.equal(after.endsAt.toISOString(), "2026-11-29T21:00:00.000Z");
});

test("current D1 challenge data remains the first choice", async () => {
  let canonicalCalls = 0;
  const got = await readWeeklyChallengesWithBoundaryBridge("u1",
    async () => ({ periodKey: "2026-11-23" }),
    async () => { canonicalCalls++; return { periodKey: "canonical" }; },
  );
  assert.equal(got.periodKey, "2026-11-23");
  assert.equal(canonicalCalls, 0);
});

test("expired D1 week uses the canonical current-week challenge read", async () => {
  let canonicalCalls = 0;
  const got = await readWeeklyChallengesWithBoundaryBridge("u2",
    async () => { throw stale(); },
    async (id) => { canonicalCalls++; assert.equal(id, "u2"); return { periodKey: "2026-11-23" }; },
  );
  assert.equal(got.periodKey, "2026-11-23");
  assert.equal(canonicalCalls, 1);
});

test("D1 offline/malformed/authentication errors do not trigger a PG fallback", async () => {
  const errors = ["PHASE6_D1_UNAVAILABLE", "PHASE6_D1_MALFORMED", "PHASE6_INVALID_USER_SCOPE"];
  for (const code of errors) {
    let canonicalCalls = 0;
    await assert.rejects(readWeeklyChallengesWithBoundaryBridge("u3",
      async () => { throw Object.assign(new Error(code), { name: "Phase6GamificationReadError", code }); },
      async () => { canonicalCalls++; return { periodKey: "bad" }; },
    ), (e: unknown) => (e as { code?: string })?.code === code);
    assert.equal(canonicalCalls, 0);
  }
});

test("same error code without the D1 read error class never bypasses D1 safety", async () => {
  await assert.rejects(readWeeklyChallengesWithBoundaryBridge("u4",
    async () => { throw Object.assign(new Error("fake"), { code: "PHASE6_WEEKLY_CHALLENGES_EXPIRED" }); },
    async () => { throw Error("canonical must not run"); },
  ), /fake/);
});

test("if canonical is unavailable on a rollover, the route still fails closed", async () => {
  await assert.rejects(readWeeklyChallengesWithBoundaryBridge("u5",
    async () => { throw stale(); },
    async () => { throw new Error("canonical unavailable"); },
  ), /canonical unavailable/);
});
