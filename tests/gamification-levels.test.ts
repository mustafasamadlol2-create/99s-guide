import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import express, { type RequestHandler } from "express";
import type {
  Prisma,
  PrismaClient,
  UserGamificationLevel,
} from "@prisma/client";
import { test } from "node:test";
import { checksumGamificationDefinitionBundle } from "../server/features/gamification/checksum.js";
import { GAMIFICATION_DEFINITION_CHECKSUM_NAMESPACE } from "../server/features/gamification/constants.js";
import { checksumGamificationChallengeDefinitions } from "../server/features/gamification/challengeChecksum.js";
import { getGamificationDefinitionBundle } from "../server/features/gamification/definitions.js";
import { checksumGamificationLevelDefinitions } from "../server/features/gamification/levelChecksum.js";
import {
  evaluateLifetimeLevel,
  readGamificationLevelView,
} from "../server/features/gamification/levelMath.js";
import { refreshUserGamificationLevelInTransaction } from "../server/features/gamification/levelService.js";
import {
  getPublicGamificationProfile,
  isProfileAchievementVisible,
} from "../server/features/gamification/publicProfile.js";
import { createGamificationRouter } from "../server/routes/gamification.js";
import type { GamificationRuleSetWithDefinition } from "../server/features/gamification/types.js";
import { canonicalJson } from "../server/features/study-core/canonicalJson.js";

const version = "gamification-v1";
const bundle = getGamificationDefinitionBundle(version);
const checksum = checksumGamificationDefinitionBundle(bundle);
const levelChecksum = checksumGamificationLevelDefinitions(bundle);
const challengeChecksum = checksumGamificationChallengeDefinitions(bundle);
const ruleSet = {
  id: "test-ruleset",
  version,
  status: "ACTIVE",
  schemaVersion: bundle.schemaVersion,
  definitionChecksum: checksum,
  levelDefinitionChecksum: levelChecksum,
  challengeDefinitionChecksum: challengeChecksum,
  effectiveFrom: new Date("2026-09-26T00:00:00.000Z"),
  retiredAt: null,
  createdAt: new Date("2026-09-26T00:00:00.000Z"),
  updatedAt: new Date("2026-09-26T00:00:00.000Z"),
} as GamificationRuleSetWithDefinition["ruleSet"];
const rules = {
  ruleSet,
  definitions: bundle,
} satisfies GamificationRuleSetWithDefinition;

test("lifetime Level thresholds are inclusive and reversals can lower the current Level", () => {
  const definitions = bundle.levelDefinitions;
  for (let index = 0; index < definitions.length; index += 1) {
    const current = definitions[index]!;
    assert.equal(
      evaluateLifetimeLevel(current.minimumLifetimePoints, definitions)
        .definition.level,
      current.level,
    );
    if (index > 0) {
      assert.equal(
        evaluateLifetimeLevel(current.minimumLifetimePoints - 1, definitions)
          .definition.level,
        definitions[index - 1]!.level,
      );
    }
  }
  assert.equal(evaluateLifetimeLevel(100, definitions).definition.level, 2);
  assert.equal(evaluateLifetimeLevel(99, definitions).definition.level, 1);
  const progress = evaluateLifetimeLevel(320, definitions);
  assert.equal(progress.definition.level, 3);
  assert.equal(320 - progress.definition.minimumLifetimePoints, 70);
  assert.equal(progress.nextDefinition!.minimumLifetimePoints - 320, 180);
  assert.equal(
    (320 - progress.definition.minimumLifetimePoints)
      / (progress.nextDefinition!.minimumLifetimePoints
        - progress.definition.minimumLifetimePoints),
    0.28,
  );
});

test("Prompt 24 preserves Prompt 23 Achievement checksums and checksums Levels separately", () => {
  const prompt23Bundle = {
    ...bundle,
    levelDefinitions: [],
    challengeDefinitionContracts: [],
  };
  const prompt23Checksum = createHash("sha256")
    .update(GAMIFICATION_DEFINITION_CHECKSUM_NAMESPACE, "utf8")
    .update(canonicalJson(prompt23Bundle), "utf8")
    .digest("hex");
  assert.equal(checksum, prompt23Checksum);
  assert.equal(
    levelChecksum,
    "5bbf8eb146b70cb4de45eeb6ca2adf22bd2e801f205b76034cbf35718dd611e2",
  );

  const changedLevels = structuredClone(bundle);
  changedLevels.levelDefinitions[3]!.minimumLifetimePoints += 10;
  assert.equal(checksumGamificationDefinitionBundle(changedLevels), checksum);
  assert.notEqual(
    checksumGamificationLevelDefinitions(changedLevels),
    levelChecksum,
  );
});

test("the last Level has no next threshold and invalid Point totals fail closed", () => {
  const maximum = evaluateLifetimeLevel(5600, bundle.levelDefinitions);
  assert.equal(maximum.definition.level, 10);
  assert.equal(maximum.nextDefinition, null);
  assert.equal(maximum.maxLevelReached, true);
  assert.throws(() => evaluateLifetimeLevel(-1, bundle.levelDefinitions));
  assert.throws(() =>
    evaluateLifetimeLevel(Number.MAX_SAFE_INTEGER + 1, bundle.levelDefinitions)
  );
  assert.throws(() => evaluateLifetimeLevel(0, []));
});

test("Level projection views verify source version, checksum, and derived state", () => {
  const row = {
    id: "level-row",
    userId: "user-1",
    ruleSetVersion: version,
    definitionChecksum: checksum,
    levelDefinitionChecksum: levelChecksum,
    level: 4,
    lifetimePoints: 500n,
    maxLevelReached: false,
    lastEvaluatedAt: new Date("2026-09-26T00:00:00.000Z"),
    createdAt: new Date("2026-09-26T00:00:00.000Z"),
    updatedAt: new Date("2026-09-26T00:00:00.000Z"),
  } as UserGamificationLevel;
  const view = readGamificationLevelView(row, rules);
  assert.equal(view?.level, 4);
  assert.equal(view?.currentLevelMinimumPoints, 500);
  assert.equal(view?.nextLevelMinimumPoints, 900);
  assert.equal(view?.pointsIntoLevel, 0);
  assert.equal(view?.pointsToNextLevel, 400);
  assert.equal(view?.levelProgressRatio, 0);
  assert.equal("lifetimePoints" in (view ?? {}), true);
  assert.equal(
    readGamificationLevelView(
      { ...row, level: 3 },
      rules,
    ),
    null,
  );
  assert.equal(
    readGamificationLevelView(
      { ...row, definitionChecksum: "0".repeat(64) },
      rules,
    ),
    null,
  );
  assert.equal(
    readGamificationLevelView(
      { ...row, levelDefinitionChecksum: "0".repeat(64) },
      rules,
    ),
    null,
  );
  const maximumRow = {
    ...row,
    level: 10,
    lifetimePoints: 5600n,
    maxLevelReached: true,
  };
  const maximumView = readGamificationLevelView(maximumRow, rules);
  assert.equal(maximumView?.nextLevelMinimumPoints, null);
  assert.equal(maximumView?.pointsToNextLevel, null);
  assert.equal(maximumView?.levelProgressRatio, null);
  assert.equal(maximumView?.maxLevelReached, true);
});

test("active rule-version changes recompute the Level from unchanged Points", async () => {
  const nextVersion = "gamification-v2";
  const nextDefinitions = {
    ...bundle,
    version: nextVersion,
    achievementDefinitions: bundle.achievementDefinitions.map((definition) => ({
      ...definition,
      ruleSetVersion: nextVersion,
    })),
    challengeDefinitionContracts: bundle.challengeDefinitionContracts.map((definition) => ({
      ...definition,
      ruleSetVersion: nextVersion,
    })),
    levelDefinitions: bundle.levelDefinitions.map((definition, index) => ({
      ...definition,
      minimumLifetimePoints: index === 0
        ? 0
        : definition.minimumLifetimePoints - 10,
    })),
  };
  const nextChecksum = checksumGamificationDefinitionBundle(nextDefinitions);
  const nextRules = {
    ruleSet: {
      ...ruleSet,
      version: nextVersion,
      definitionChecksum: nextChecksum,
      levelDefinitionChecksum:
        checksumGamificationLevelDefinitions(nextDefinitions),
      challengeDefinitionChecksum:
        checksumGamificationChallengeDefinitions(nextDefinitions),
    },
    definitions: nextDefinitions,
  } satisfies GamificationRuleSetWithDefinition;
  const existing = {
    id: "level-row",
    userId: "user-1",
    ruleSetVersion: version,
    definitionChecksum: checksum,
    levelDefinitionChecksum: levelChecksum,
    level: 1,
    lifetimePoints: 99n,
    maxLevelReached: false,
    lastEvaluatedAt: new Date("2026-09-26T00:00:00.000Z"),
    createdAt: new Date("2026-09-26T00:00:00.000Z"),
    updatedAt: new Date("2026-09-26T00:00:00.000Z"),
  } as UserGamificationLevel;
  let updated: Record<string, unknown> | null = null;
  const tx = {
    userGamificationLevel: {
      findUnique: async () => existing,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updated = data;
        return { ...existing, ...data };
      },
    },
  } as unknown as Prisma.TransactionClient;

  const row = await refreshUserGamificationLevelInTransaction(
    tx,
    "user-1",
    nextRules,
    99,
    new Date("2026-09-26T00:00:00.000Z"),
  );
  assert.equal(updated?.ruleSetVersion, nextVersion);
  assert.equal(updated?.lifetimePoints, 99n);
  assert.equal(updated?.level, 2);
  assert.equal(row.level, 2);
});

test("public achievement visibility requires both historical and current safety", () => {
  assert.equal(isProfileAchievementVisible("PROFILE_SAFE", "PROFILE_SAFE"), true);
  assert.equal(isProfileAchievementVisible("PROFILE_SAFE", undefined), true);
  assert.equal(isProfileAchievementVisible("PROFILE_SAFE", "PRIVATE"), false);
  assert.equal(isProfileAchievementVisible("PRIVATE", "PROFILE_SAFE"), false);
  assert.equal(isProfileAchievementVisible("PRIVATE", undefined), false);
});

test("public Gamification reads return only safe Level fields and perform no writes", async () => {
  const calls: string[] = [];
  let accountStatus = "ACTIVE";
  let blocked = false;
  const now = new Date("2026-09-26T00:00:00.000Z");
  const levelRow = {
    id: "level-row",
    userId: "profile-user",
    ruleSetVersion: version,
    definitionChecksum: checksum,
    levelDefinitionChecksum: levelChecksum,
    level: 4,
    lifetimePoints: 500n,
    maxLevelReached: false,
    lastEvaluatedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const database = {
    user: {
      findUnique: async () => {
        calls.push("user.findUnique");
        return { id: "profile-user", accountStatus };
      },
    },
    userBlock: {
      findFirst: async () => {
        calls.push("userBlock.findFirst");
        return blocked ? { id: "block-1" } : null;
      },
    },
    gamificationRuleSet: {
      findMany: async () => {
        calls.push("gamificationRuleSet.findMany");
        return [ruleSet];
      },
    },
    userGamificationLevel: {
      findUnique: async () => {
        calls.push("userGamificationLevel.findUnique");
        return levelRow;
      },
    },
    userAchievement: {
      findMany: async () => {
        calls.push("userAchievement.findMany");
        return [];
      },
    },
  } as unknown as PrismaClient;

  const profile = await getPublicGamificationProfile(
    "viewer-user",
    "profile-user",
    database,
  );
  assert.deepEqual(profile, {
    level: 4,
    maxLevelReached: false,
    achievements: [],
  });
  assert.deepEqual(calls, [
    "user.findUnique",
    "userBlock.findFirst",
    "gamificationRuleSet.findMany",
    "userGamificationLevel.findUnique",
    "userAchievement.findMany",
  ]);
  assert.equal(
    calls.some((call) =>
      /points|ledger|focus|create|update|delete/iu.test(call)
    ),
    false,
  );

  blocked = true;
  calls.length = 0;
  assert.equal(
    await getPublicGamificationProfile(
      "viewer-user",
      "profile-user",
      database,
    ),
    null,
  );
  assert.deepEqual(calls, ["user.findUnique", "userBlock.findFirst"]);

  blocked = false;
  accountStatus = "BANNED";
  calls.length = 0;
  assert.equal(
    await getPublicGamificationProfile(
      "viewer-user",
      "profile-user",
      database,
    ),
    null,
  );
  assert.deepEqual(calls, ["user.findUnique"]);
});

test("Gamification routes separate private self-summary from public profile reads", async () => {
  const app = express();
  const calls: Array<{ kind: string; ids: string[] }> = [];
  const requireUser: RequestHandler = (req, _res, next) => {
    Object.assign(req, { user: { id: "viewer-user" } });
    next();
  };
  app.use("/api", createGamificationRouter({
    requireUser,
    getMyGamificationSummary: async (userId) => {
      calls.push({ kind: "private", ids: [userId] });
      return {
        ruleSetVersion: version,
        points: {
          totalPoints: 500,
          focusPoints: 0,
          masteryPoints: 0,
          progressPoints: 500,
          consistencyPoints: 0,
          ledgerPoints: 0,
          legacyPoints: 500,
        },
        level: {
          level: 4,
          lifetimePoints: 500,
          currentLevelMinimumPoints: 500,
          nextLevelMinimumPoints: 900,
          pointsIntoLevel: 0,
          pointsToNextLevel: 400,
          levelProgressRatio: 0,
          maxLevelReached: false,
          ruleSetVersion: version,
          lastEvaluatedAt: "2026-09-26T00:00:00.000Z",
        },
        achievements: [],
        unlockHistory: [],
      };
    },
    getPublicGamificationProfile: async (viewerId, profileUserId) => {
      calls.push({ kind: "public", ids: [viewerId, profileUserId] });
      return null;
    },
  }));
  const server = createServer(app);
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    const ownResponse = await fetch(`${origin}/api/me/gamification`);
    assert.equal(ownResponse.status, 200);
    assert.equal(ownResponse.headers.get("cache-control"), "no-store, private");
    assert.equal(
      (await ownResponse.json() as { points: { totalPoints: number } })
        .points.totalPoints,
      500,
    );

    const publicResponse = await fetch(
      `${origin}/api/users/profile-user/gamification`,
    );
    assert.equal(publicResponse.status, 404);
    assert.equal(publicResponse.headers.get("cache-control"), "no-store, private");
    assert.deepEqual(calls, [
      { kind: "private", ids: ["viewer-user"] },
      { kind: "public", ids: ["viewer-user", "profile-user"] },
    ]);
  } finally {
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose());
    });
  }
});

test("Prompt 24 migration adds one table without data backfill or extra currency", () => {
  const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
  const migration = readFileSync(
    resolve("prisma/migrations/20260926100000_gamification_level_projection/migration.sql"),
    "utf8",
  );
  assert.match(schema, /model UserGamificationLevel\s*\{/u);
  assert.match(migration, /CREATE TABLE "UserGamificationLevel"/u);
  assert.equal((migration.match(/CREATE TABLE/gu) ?? []).length, 1);
  assert.doesNotMatch(
    migration,
    /\b(?:INSERT\s+INTO|UPDATE\s+"UserGamificationLevel"|DELETE\s+FROM)/iu,
  );
  assert.match(migration, /UPDATE "GamificationRuleSet"/u);
  assert.ok(
    migration.includes(
      `SET "levelDefinitionChecksum" = '${levelChecksum}'`,
    ),
  );
  assert.match(migration, /UNIQUE INDEX "UserGamificationLevel_userId_key"/u);
  assert.match(migration, /REFERENCES "GamificationRuleSet"\("version"\)/u);
  assert.doesNotMatch(schema, /model (?:GamificationLevelHistory|UserLevelHistory)\b/u);
});