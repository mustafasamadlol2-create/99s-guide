import {
  Prisma,
  type GamificationRuleSet,
  type PrismaClient,
} from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { checksumGamificationDefinitionBundle } from "./checksum.js";
import {
  assertGamificationLevelDefinitionsChecksum,
  checksumGamificationLevelDefinitions,
} from "./levelChecksum.js";
import {
  assertGamificationChallengeDefinitionsChecksum,
  checksumGamificationChallengeDefinitions,
} from "./challengeChecksum.js";
import {
  GAMIFICATION_RULE_VERSION_PATTERN,
} from "./constants.js";
import {
  getCurrentGamificationDefinitionBundle,
  getGamificationDefinitionBundle,
} from "./definitions.js";
import { GamificationError } from "./errors.js";
import { validateGamificationDefinitionBundle } from "./validation.js";
import type {
  GamificationDefinitionBundle,
  GamificationRuleSetWithDefinition,
} from "./types.js";

type RuleSetDatabase = PrismaClient;
type RuleSetTransaction = Prisma.TransactionClient;
type RuleSetReadDatabase =
  | Pick<RuleSetDatabase, "gamificationRuleSet">
  | Pick<RuleSetTransaction, "gamificationRuleSet">;

const LOCK_NAMESPACE = "99s-guide:gamification:ruleset:";

async function acquireAdvisoryLock(
  tx: RuleSetTransaction,
  key: string,
): Promise<void> {
  await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT TRUE AS locked
    FROM (SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))) AS acquired
  `;
}

export async function acquireActiveGamificationRuleSetLock(
  tx: RuleSetTransaction,
): Promise<void> {
  await acquireAdvisoryLock(tx, `${LOCK_NAMESPACE}active`);
}

function validateRuleVersion(version: string): void {
  if (
    typeof version !== "string"
    || !GAMIFICATION_RULE_VERSION_PATTERN.test(version)
  ) {
    throw new GamificationError(
      "GAMIFICATION_INVALID_INPUT",
      "Rule-set versions must use the gamification-vN naming format.",
    );
  }
}

function assertStoredChecksumMatches(
  row: GamificationRuleSet,
  bundle: GamificationDefinitionBundle,
): void {
  assertGamificationLevelDefinitionsChecksum(
    bundle,
    row.levelDefinitionChecksum,
  );
  assertGamificationChallengeDefinitionsChecksum(
    bundle,
    row.challengeDefinitionChecksum,
  );
  if (
    row.version !== bundle.version
    || row.schemaVersion !== bundle.schemaVersion
    || row.definitionChecksum !== checksumGamificationDefinitionBundle(bundle)
  ) {
    throw new GamificationError(
      "GAMIFICATION_DEFINITION_CHECKSUM_MISMATCH",
      `Stored definition checksum does not match the source bundle for ${row.version}.`,
    );
  }
}

function assertActiveLifecycle(row: GamificationRuleSet): void {
  if (
    !(row.effectiveFrom instanceof Date)
    || Number.isNaN(row.effectiveFrom.getTime())
    || row.retiredAt !== null
  ) {
    throw new GamificationError(
      "GAMIFICATION_ACTIVE_RULE_SET_LIFECYCLE_INVALID",
      `Active rule set ${row.version} must have a valid effectiveFrom timestamp and no retiredAt timestamp.`,
    );
  }
}

function getSourceBundleForActiveRuleSet(
  row: GamificationRuleSet,
): GamificationDefinitionBundle {
  try {
    return getGamificationDefinitionBundle(row.version);
  } catch (error) {
    if (
      error instanceof GamificationError
      && error.code === "GAMIFICATION_DEFINITION_BUNDLE_NOT_FOUND"
    ) {
      throw new GamificationError(
        "GAMIFICATION_ACTIVE_RULE_SET_STALE",
        `Active rule set ${row.version} has no source-controlled definition bundle and cannot be verified.`,
      );
    }
    throw error;
  }
}

function assertBundleVersion(
  version: string,
  bundle: GamificationDefinitionBundle,
): void {
  validateRuleVersion(version);
  validateGamificationDefinitionBundle(bundle);
  if (bundle.version !== version) {
    throw new GamificationError(
      "GAMIFICATION_INVALID_INPUT",
      "The requested rule-set version must match the definition bundle.",
    );
  }
}

async function registerDraftInTransaction(
  bundle: GamificationDefinitionBundle,
  tx: RuleSetTransaction,
): Promise<GamificationRuleSet> {
  const checksum = checksumGamificationDefinitionBundle(bundle);
  const levelChecksum = checksumGamificationLevelDefinitions(bundle);
  const challengeChecksum = checksumGamificationChallengeDefinitions(bundle);
  await acquireAdvisoryLock(tx, `${LOCK_NAMESPACE}register:${bundle.version}`);
  const existing = await tx.gamificationRuleSet.findUnique({
    where: { version: bundle.version },
  });
  if (existing) {
    if (
      existing.schemaVersion !== bundle.schemaVersion
      || existing.definitionChecksum !== checksum
      || existing.levelDefinitionChecksum !== levelChecksum
      || existing.challengeDefinitionChecksum !== challengeChecksum
    ) {
      throw new GamificationError(
        "GAMIFICATION_RULE_VERSION_CONFLICT",
        `Version ${bundle.version} is already registered with different immutable definitions.`,
      );
    }
    return existing;
  }
  return tx.gamificationRuleSet.create({
    data: {
      version: bundle.version,
      status: "DRAFT",
      schemaVersion: bundle.schemaVersion,
      definitionChecksum: checksum,
      levelDefinitionChecksum: levelChecksum,
      challengeDefinitionChecksum: challengeChecksum,
    },
  });
}

/**
 * Internal registration primitive. Production callers use the source-controlled
 * version resolver below; tests may supply a second immutable source bundle to
 * exercise lifecycle transitions without adding test rules to production.
 */
export async function registerGamificationRuleSetDraftForBundle(
  bundle: GamificationDefinitionBundle,
  database: RuleSetDatabase = getPrisma() as RuleSetDatabase,
): Promise<GamificationRuleSet> {
  assertBundleVersion(bundle.version, bundle);
  return database.$transaction(async (tx) => {
    return registerDraftInTransaction(bundle, tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function ensureGamificationRuleSetDraft(
  version: string,
  database: RuleSetDatabase = getPrisma() as RuleSetDatabase,
): Promise<GamificationRuleSet> {
  validateRuleVersion(version);
  const bundle = getGamificationDefinitionBundle(version);
  return registerGamificationRuleSetDraftForBundle(bundle, database);
}

export type GamificationRuleSetBootstrapResult = {
  outcome: "ACTIVATED" | "ALREADY_ACTIVE";
  ruleSet: GamificationRuleSet;
};

/**
 * Safe first-deploy bootstrap. It activates the current source bundle only
 * when no ruleset is active; a valid older active ruleset requires an explicit
 * activation command, and invalid state is never repaired implicitly.
 */
export async function bootstrapCurrentGamificationRuleSet(
  database: RuleSetDatabase = getPrisma() as RuleSetDatabase,
): Promise<GamificationRuleSetBootstrapResult> {
  const bundle = getCurrentGamificationDefinitionBundle();
  assertBundleVersion(bundle.version, bundle);
  return database.$transaction(async (tx) => {
    await acquireActiveGamificationRuleSetLock(tx);
    const activeRows = await tx.gamificationRuleSet.findMany({
      where: { status: "ACTIVE" },
      orderBy: { version: "asc" },
    });
    if (activeRows.length > 1) {
      throw new GamificationError(
        "GAMIFICATION_ACTIVE_RULE_SET_INVARIANT_FAILED",
        "More than one gamification rule set is marked ACTIVE.",
      );
    }
    const active = activeRows[0];
    if (active) {
      if (active.version !== bundle.version) {
        throw new GamificationError(
          "GAMIFICATION_ACTIVE_RULE_SET_STALE",
          `Active rule set ${active.version} is not the current source version ${bundle.version}; use explicit ruleset activation after review.`,
        );
      }
      assertActiveLifecycle(active);
      assertStoredChecksumMatches(active, bundle);
      return { outcome: "ALREADY_ACTIVE", ruleSet: active };
    }

    const target = await registerDraftInTransaction(bundle, tx);
    if (target.status === "ACTIVE") {
      throw new GamificationError(
        "GAMIFICATION_ACTIVE_RULE_SET_INVARIANT_FAILED",
        `Rule set ${bundle.version} is ACTIVE but was not returned by the active registry query.`,
      );
    }
    if (target.status === "RETIRED") {
      throw new GamificationError(
        "GAMIFICATION_RETIRED_RULE_SET_CANNOT_REACTIVATE",
        `Retired rule set ${bundle.version} cannot be reactivated.`,
      );
    }
    if (target.status !== "DRAFT") {
      throw new GamificationError(
        "GAMIFICATION_RULE_SET_NOT_DRAFT",
        `Rule set ${bundle.version} is not a DRAFT.`,
      );
    }
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`
      SELECT CURRENT_TIMESTAMP AS now
    `;
    const ruleSet = await tx.gamificationRuleSet.update({
      where: { id: target.id },
      data: { status: "ACTIVE", effectiveFrom: now, retiredAt: null },
    });
    return { outcome: "ACTIVATED", ruleSet };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

async function activateGamificationRuleSetForBundle(
  bundle: GamificationDefinitionBundle,
  database: RuleSetDatabase,
): Promise<GamificationRuleSet> {
  assertBundleVersion(bundle.version, bundle);
  const checksum = checksumGamificationDefinitionBundle(bundle);
  const levelChecksum = checksumGamificationLevelDefinitions(bundle);
  const challengeChecksum = checksumGamificationChallengeDefinitions(bundle);
  return database.$transaction(async (tx) => {
    await acquireActiveGamificationRuleSetLock(tx);
    const target = await tx.gamificationRuleSet.findUnique({
      where: { version: bundle.version },
    });
    if (!target) {
      throw new GamificationError(
        "GAMIFICATION_RULE_VERSION_NOT_FOUND",
        `Rule set ${bundle.version} must be explicitly registered before activation.`,
      );
    }
    if (
      target.schemaVersion !== bundle.schemaVersion
      || target.definitionChecksum !== checksum
      || target.levelDefinitionChecksum !== levelChecksum
      || target.challengeDefinitionChecksum !== challengeChecksum
    ) {
      throw new GamificationError(
        "GAMIFICATION_DEFINITION_CHECKSUM_MISMATCH",
        `Stored definition checksum does not match the source bundle for ${bundle.version}.`,
      );
    }
    const activeRows = await tx.gamificationRuleSet.findMany({
      where: { status: "ACTIVE" },
      orderBy: { version: "asc" },
    });
    if (activeRows.length > 1) {
      throw new GamificationError(
        "GAMIFICATION_ACTIVE_RULE_SET_INVARIANT_FAILED",
        "More than one gamification rule set is marked ACTIVE.",
      );
    }
    if (target.status === "ACTIVE") {
      if (activeRows[0]?.id !== target.id) {
        throw new GamificationError(
          "GAMIFICATION_ACTIVE_RULE_SET_INVARIANT_FAILED",
          "The active rule-set registry is inconsistent.",
        );
      }
      assertActiveLifecycle(target);
      return target;
    }
    if (target.status === "RETIRED") {
      throw new GamificationError(
        "GAMIFICATION_RETIRED_RULE_SET_CANNOT_REACTIVATE",
        `Retired rule set ${bundle.version} cannot be reactivated.`,
      );
    }
    if (target.status !== "DRAFT") {
      throw new GamificationError(
        "GAMIFICATION_RULE_SET_NOT_DRAFT",
        `Rule set ${bundle.version} is not a DRAFT.`,
      );
    }

    const previous = activeRows[0];
    if (previous) {
      assertActiveLifecycle(previous);
      const previousBundle = getSourceBundleForActiveRuleSet(previous);
      assertStoredChecksumMatches(previous, previousBundle);
    }
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`
      SELECT CURRENT_TIMESTAMP AS now
    `;
    if (previous) {
      await tx.gamificationRuleSet.update({
        where: { id: previous.id },
        data: { status: "RETIRED", retiredAt: now },
      });
    }
    return tx.gamificationRuleSet.update({
      where: { id: target.id },
      data: {
        status: "ACTIVE",
        effectiveFrom: now,
        retiredAt: null,
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function activateGamificationRuleSet(
  version: string,
  database: RuleSetDatabase = getPrisma() as RuleSetDatabase,
): Promise<GamificationRuleSet> {
  validateRuleVersion(version);
  const currentBundle = getCurrentGamificationDefinitionBundle();
  if (version !== currentBundle.version) {
    throw new GamificationError(
      "GAMIFICATION_ACTIVE_RULE_SET_STALE",
      `Only the current source version ${currentBundle.version} may be activated; ${version} is not current.`,
    );
  }
  return activateGamificationRuleSetForBundle(
    currentBundle,
    database,
  );
}

export async function getGamificationRuleSetVersion(
  version: string,
  database: RuleSetReadDatabase = getPrisma() as RuleSetDatabase,
): Promise<GamificationRuleSetWithDefinition> {
  validateRuleVersion(version);
  const row = await database.gamificationRuleSet.findUnique({
    where: { version },
  });
  if (!row) {
    throw new GamificationError(
      "GAMIFICATION_RULE_VERSION_NOT_FOUND",
      `Rule set ${version} has not been registered.`,
    );
  }
  const definitions = getGamificationDefinitionBundle(version);
  assertStoredChecksumMatches(row, definitions);
  return { ruleSet: row, definitions };
}

export async function getActiveGamificationRuleSet(
  database: RuleSetReadDatabase = getPrisma() as RuleSetDatabase,
): Promise<GamificationRuleSetWithDefinition> {
  const activeRows = await database.gamificationRuleSet.findMany({
    where: { status: "ACTIVE" },
    orderBy: { version: "asc" },
  });
  if (activeRows.length === 0) {
    throw new GamificationError(
      "GAMIFICATION_ACTIVE_RULE_SET_NOT_CONFIGURED",
      "No gamification rule set is active.",
    );
  }
  if (activeRows.length !== 1) {
    throw new GamificationError(
      "GAMIFICATION_ACTIVE_RULE_SET_INVARIANT_FAILED",
      "More than one gamification rule set is marked ACTIVE.",
    );
  }
  const ruleSet = activeRows[0];
  const definitions = getCurrentGamificationDefinitionBundle();
  if (ruleSet.version !== definitions.version) {
    throw new GamificationError(
      "GAMIFICATION_ACTIVE_RULE_SET_STALE",
      `Active rule set ${ruleSet.version} is stale; current source version is ${definitions.version}.`,
    );
  }
  assertActiveLifecycle(ruleSet);
  assertStoredChecksumMatches(ruleSet, definitions);
  return { ruleSet, definitions };
}

export { activateGamificationRuleSetForBundle as __activateGamificationRuleSetForTests };