import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import test, { after, before } from "node:test";
import {
  GAMIFICATION_V1_RULE_SET_VERSION,
  GamificationError,
  checksumGamificationDefinitionBundle,
  getGamificationDefinitionBundle,
} from "../server/features/gamification/index.js";
import {
  __activateGamificationRuleSetForTests,
  activateGamificationRuleSet,
  ensureGamificationRuleSetDraft,
  getGamificationRuleSetVersion,
  registerGamificationRuleSetDraftForBundle,
} from "../server/features/gamification/ruleSetService.js";
import type { GamificationDefinitionBundle } from "../server/features/gamification/types.js";
import { getPrompt22GamificationPostgresGateUrl } from "./helpers/prompt22GamificationPostgresGate.js";

const databaseUrl = getPrompt22GamificationPostgresGateUrl();
const skipped = databaseUrl
  ? false
  : "Set the explicit Prompt 22 disposable-schema PostgreSQL gate to run.";
const TEST_VERSIONS = [
  "gamification-v1",
  "gamification-v2",
];

let prisma: PrismaClient | undefined;

function db(): PrismaClient {
  assert.ok(prisma);
  return prisma;
}

if (databaseUrl) {
  before(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
    await prisma.gamificationRuleSet.deleteMany({
      where: { version: { in: TEST_VERSIONS } },
    });
  });
  after(async () => {
    await prisma?.gamificationRuleSet.deleteMany({
      where: { version: { in: TEST_VERSIONS } },
    });
    await prisma?.$disconnect();
  });
}

test("rule-set registration and activation are immutable, idempotent, and atomic", {
  skip: skipped,
}, async () => {
  const ledgerCountBefore = await db().studyPointsLedgerEntry.count();
  const concurrentDrafts = await Promise.all(
    Array.from({ length: 12 }, () =>
      ensureGamificationRuleSetDraft(GAMIFICATION_V1_RULE_SET_VERSION, db()),
    ),
  );
  const firstDraft = concurrentDrafts[0]!;
  assert.equal(firstDraft.status, "DRAFT");
  assert.ok(concurrentDrafts.every((row) => row.id === firstDraft.id));
  assert.equal(
    await db().gamificationRuleSet.count({
      where: { version: GAMIFICATION_V1_RULE_SET_VERSION },
    }),
    1,
  );
  const checksum = checksumGamificationDefinitionBundle(
    getGamificationDefinitionBundle(GAMIFICATION_V1_RULE_SET_VERSION),
  );
  assert.equal(firstDraft.definitionChecksum, checksum);

  const changedChecksum = "0".repeat(64);
  await db().gamificationRuleSet.update({
    where: { version: GAMIFICATION_V1_RULE_SET_VERSION },
    data: { definitionChecksum: changedChecksum },
  });
  await assert.rejects(
    ensureGamificationRuleSetDraft(GAMIFICATION_V1_RULE_SET_VERSION, db()),
    (error: unknown) =>
      error instanceof GamificationError
      && error.code === "GAMIFICATION_RULE_VERSION_CONFLICT",
  );
  await db().gamificationRuleSet.update({
    where: { version: GAMIFICATION_V1_RULE_SET_VERSION },
    data: { definitionChecksum: checksum },
  });

  const activeV1 = await activateGamificationRuleSet(
    GAMIFICATION_V1_RULE_SET_VERSION,
    db(),
  );
  assert.equal(activeV1.status, "ACTIVE");
  const replayedV1 = await activateGamificationRuleSet(
    GAMIFICATION_V1_RULE_SET_VERSION,
    db(),
  );
  assert.equal(replayedV1.id, activeV1.id);
  assert.deepEqual(replayedV1.effectiveFrom, activeV1.effectiveFrom);
  assert.deepEqual(replayedV1.updatedAt, activeV1.updatedAt);

  const v2 = structuredClone(
    getGamificationDefinitionBundle(GAMIFICATION_V1_RULE_SET_VERSION),
  ) as GamificationDefinitionBundle;
  v2.version = "gamification-v2";
  for (const achievement of v2.achievementDefinitions) {
    achievement.ruleSetVersion = v2.version;
  }
  for (const challenge of v2.challengeDefinitionContracts) {
    challenge.ruleSetVersion = v2.version;
  }
  for (const leaderboard of v2.leaderboardDefinitionContracts) {
    leaderboard.ruleSetVersion = v2.version;
  }
  v2.achievementDefinitions[0]!.threshold = 2;
  await registerGamificationRuleSetDraftForBundle(v2, db());
  const activeV2 = await __activateGamificationRuleSetForTests(v2, db());
  assert.equal(activeV2.status, "ACTIVE");
  const retiredV1 = await getGamificationRuleSetVersion(
    GAMIFICATION_V1_RULE_SET_VERSION,
    db(),
  );
  assert.equal(retiredV1.ruleSet.status, "RETIRED");
  assert.ok(retiredV1.ruleSet.retiredAt);
  assert.deepEqual(
    (await db().gamificationRuleSet.findMany({
      where: { status: "ACTIVE" },
      select: { version: true },
    })).map((row) => row.version),
    ["gamification-v2"],
  );

  await assert.rejects(
    activateGamificationRuleSet(GAMIFICATION_V1_RULE_SET_VERSION, db()),
    (error: unknown) =>
      error instanceof GamificationError
      && error.code === "GAMIFICATION_RETIRED_RULE_SET_CANNOT_REACTIVATE",
  );

  assert.equal(
    await db().studyPointsLedgerEntry.count(),
    ledgerCountBefore,
    "Gamification lifecycle operations must not write Study Points ledger entries.",
  );
});