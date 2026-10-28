import assert from "node:assert/strict";
import test from "node:test";
import {
  checksumGamificationChallengeDefinitions,
} from "../server/features/gamification/challengeChecksum.js";
import {
  checksumGamificationDefinitionBundle,
} from "../server/features/gamification/checksum.js";
import {
  getCurrentGamificationDefinitionBundle,
} from "../server/features/gamification/definitions.js";
import { GamificationError } from "../server/features/gamification/errors.js";
import {
  bootstrapCurrentGamificationRuleSet,
  getActiveGamificationRuleSet,
} from "../server/features/gamification/ruleSetService.js";
import {
  clearStudyEngineHealthCacheForTests,
  getStudyEngineHealth,
} from "../server/observability/health.js";
import {
  checksumGamificationLevelDefinitions,
} from "../server/features/gamification/levelChecksum.js";

const sourceBundle = getCurrentGamificationDefinitionBundle();
const fixedNow = new Date("2026-10-09T12:00:00.000Z");

function activeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ruleset-current",
    version: sourceBundle.version,
    status: "ACTIVE",
    schemaVersion: sourceBundle.schemaVersion,
    definitionChecksum: checksumGamificationDefinitionBundle(sourceBundle),
    levelDefinitionChecksum: checksumGamificationLevelDefinitions(sourceBundle),
    challengeDefinitionChecksum: checksumGamificationChallengeDefinitions(sourceBundle),
    effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
    retiredAt: null,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    ...overrides,
  };
}

class MemoryRuleSetDatabase {
  rows: ReturnType<typeof activeRow>[];
  database: any;
  private nextId = 1;

  constructor(rows: ReturnType<typeof activeRow>[] = []) {
    this.rows = rows;
    this.database = {
      gamificationRuleSet: {
        findMany: async ({ where }: { where?: { status?: string } } = {}) =>
          structuredClone(
            this.rows.filter((row) =>
              where?.status ? row.status === where.status : true
            ),
          ),
        findUnique: async ({ where }: { where: { version: string } }) =>
          structuredClone(
            this.rows.find((row) => row.version === where.version) ?? null,
          ),
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = {
            id: `ruleset-created-${this.nextId++}`,
            ...data,
            effectiveFrom: null,
            retiredAt: null,
            createdAt: fixedNow,
            updatedAt: fixedNow,
          } as ReturnType<typeof activeRow>;
          this.rows.push(row);
          return structuredClone(row);
        },
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = this.rows.find((candidate) => candidate.id === where.id);
          assert.ok(row, "expected an existing ruleset row to update");
          Object.assign(row, data, { updatedAt: fixedNow });
          return structuredClone(row);
        },
      },
      $queryRaw: async () => [{ now: fixedNow }],
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(this.database),
    };
  }
}

function hasCode(code: GamificationError["code"]) {
  return (error: unknown) =>
    error instanceof GamificationError && error.code === code;
}

test("active ruleset verification reports a missing registry entry", async () => {
  const store = new MemoryRuleSetDatabase();
  await assert.rejects(
    getActiveGamificationRuleSet(store.database),
    hasCode("GAMIFICATION_ACTIVE_RULE_SET_NOT_CONFIGURED"),
  );
});

test("a single current active ruleset with matching checksums verifies", async () => {
  const row = activeRow();
  const store = new MemoryRuleSetDatabase([row]);
  const active = await getActiveGamificationRuleSet(store.database);
  assert.equal(active.ruleSet.id, row.id);
  assert.equal(active.definitions.version, sourceBundle.version);
});

test("active ruleset verification rejects duplicate ACTIVE rows", async () => {
  const store = new MemoryRuleSetDatabase([
    activeRow(),
    activeRow({ id: "ruleset-duplicate", version: "gamification-v2" }),
  ]);
  await assert.rejects(
    getActiveGamificationRuleSet(store.database),
    hasCode("GAMIFICATION_ACTIVE_RULE_SET_INVARIANT_FAILED"),
  );
});

test("active ruleset verification rejects mismatched source checksums", async () => {
  const row = activeRow({ definitionChecksum: "0".repeat(64) });
  const store = new MemoryRuleSetDatabase([row]);
  await assert.rejects(
    getActiveGamificationRuleSet(store.database),
    hasCode("GAMIFICATION_DEFINITION_CHECKSUM_MISMATCH"),
  );
  await assert.rejects(
    bootstrapCurrentGamificationRuleSet(store.database),
    hasCode("GAMIFICATION_DEFINITION_CHECKSUM_MISMATCH"),
  );
  assert.equal(store.rows[0]?.definitionChecksum, "0".repeat(64));
});

test("bootstrap is idempotent and does not rewrite an already-active ruleset", async () => {
  const store = new MemoryRuleSetDatabase();
  const first = await bootstrapCurrentGamificationRuleSet(store.database);
  const second = await bootstrapCurrentGamificationRuleSet(store.database);
  assert.equal(first.outcome, "ACTIVATED");
  assert.equal(second.outcome, "ALREADY_ACTIVE");
  assert.equal(store.rows.length, 1);
  assert.deepEqual(second.ruleSet.effectiveFrom, first.ruleSet.effectiveFrom);
  assert.deepEqual(second.ruleSet.updatedAt, first.ruleSet.updatedAt);
  assert.equal((await getActiveGamificationRuleSet(store.database)).ruleSet.id, first.ruleSet.id);
});

test("an active source version older than the current pointer is reported as stale", async () => {
  const store = new MemoryRuleSetDatabase([
    activeRow({ version: "gamification-v1" }),
  ]);
  await assert.rejects(
    getActiveGamificationRuleSet(store.database),
    hasCode("GAMIFICATION_ACTIVE_RULE_SET_STALE"),
  );
  await assert.rejects(
    bootstrapCurrentGamificationRuleSet(store.database),
    hasCode("GAMIFICATION_ACTIVE_RULE_SET_STALE"),
  );
});

test("runtime health exposes the precise missing-ruleset diagnostic", async () => {
  clearStudyEngineHealthCacheForTests();
  const health = await getStudyEngineHealth({
    database: {
      $queryRaw: async () => {
        throw new Error("database query unavailable");
      },
      gamificationRuleSet: {
        findMany: async () => [],
      },
    } as never,
    forceRefresh: true,
    now: fixedNow.getTime(),
  });
  assert.equal(health.components.gamification.status, "UNHEALTHY");
  assert.equal(
    health.components.gamification.summary.errorCode,
    "GAMIFICATION_ACTIVE_RULE_SET_NOT_CONFIGURED",
  );
  clearStudyEngineHealthCacheForTests();
});
