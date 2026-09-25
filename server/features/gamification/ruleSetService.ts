import {
  Prisma,
  type GamificationRuleSet,
  type PrismaClient,
} from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { checksumGamificationDefinitionBundle } from "./checksum.js";
import {
  GAMIFICATION_RULE_VERSION_PATTERN,
} from "./constants.js";
import { getGamificationDefinitionBundle } from "./definitions.js";
import { GamificationError } from "./errors.js";
import { validateGamificationDefinitionBundle } from "./validation.js";
import type {
  GamificationDefinitionBundle,
  GamificationRuleSetWithDefinition,
} from "./types.js";

type RuleSetDatabase = PrismaClient;
type RuleSetTransaction = Prisma.TransactionClient;

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
  const checksum = checksumGamificationDefinitionBundle(bundle);

  return database.$transaction(async (tx) => {
    await acquireAdvisoryLock(
      tx,
      `${LOCK_NAMESPACE}register:${bundle.version}`,
    );
    const existing = await tx.gamificationRuleSet.findUnique({
      where: { version: bundle.version },
    });
    if (existing) {
      if (
        existing.schemaVersion !== bundle.schemaVersion
        || existing.definitionChecksum !== checksum
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
      },
    });
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

async function activateGamificationRuleSetForBundle(
  bundle: GamificationDefinitionBundle,
  database: RuleSetDatabase,
): Promise<GamificationRuleSet> {
  assertBundleVersion(bundle.version, bundle);
  const checksum = checksumGamificationDefinitionBundle(bundle);
  return database.$transaction(async (tx) => {
    await acquireAdvisoryLock(tx, `${LOCK_NAMESPACE}active`);
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

    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`
      SELECT CURRENT_TIMESTAMP AS now
    `;
    const previous = activeRows[0];
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
  return activateGamificationRuleSetForBundle(
    getGamificationDefinitionBundle(version),
    database,
  );
}

export async function getGamificationRuleSetVersion(
  version: string,
  database: RuleSetDatabase = getPrisma() as RuleSetDatabase,
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
  database: RuleSetDatabase = getPrisma() as RuleSetDatabase,
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
  const definitions = getGamificationDefinitionBundle(ruleSet.version);
  assertStoredChecksumMatches(ruleSet, definitions);
  return { ruleSet, definitions };
}

export { activateGamificationRuleSetForBundle as __activateGamificationRuleSetForTests };