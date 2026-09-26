import { randomUUID } from "node:crypto";
import {
  Prisma,
  type LeaderboardSeason,
  type PrismaClient,
} from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { LeaderboardError } from "./errors.js";
import {
  getLeaderboardSeasonWindow,
  validateSeasonKey,
  type ServerOwnedSemesterBoundary,
} from "./periods.js";
import {
  LEADERBOARD_SCOPES,
  type LeaderboardScope,
} from "./types.js";

type Transaction = Prisma.TransactionClient;

export function parseLeaderboardScope(value: unknown): LeaderboardScope | null {
  if (typeof value !== "string") return null;
  const normalized = value.toUpperCase();
  return (LEADERBOARD_SCOPES as readonly string[]).includes(normalized)
    ? normalized as LeaderboardScope
    : null;
}

function datesMatch(
  left: Date | null,
  right: Date | null,
): boolean {
  return left === null
    ? right === null
    : right !== null && left.getTime() === right.getTime();
}

export async function ensureLeaderboardSeason(input: {
  scope: LeaderboardScope;
  asOf: Date;
  semesterBoundaries?: readonly ServerOwnedSemesterBoundary[];
}, database: PrismaClient = getPrisma() as PrismaClient): Promise<LeaderboardSeason> {
  const window = getLeaderboardSeasonWindow(
    input.scope,
    input.asOf,
    input.semesterBoundaries,
  );
  if (!validateSeasonKey(input.scope, window.seasonKey)) {
    throw new LeaderboardError(
      "LEADERBOARD_SEASON_CONFIGURATION_CONFLICT",
      "Season configuration produced an invalid canonical key.",
    );
  }
  return database.$transaction(async (tx) => {
    const id = randomUUID();
    const initialStatus =
      !window.startsAt || input.asOf >= window.startsAt ? "ACTIVE" : "UPCOMING";
    await tx.$executeRaw`
      INSERT INTO "LeaderboardSeason" (
        "id", "scope", "seasonKey", "startsAt", "endsAt", "status",
        "createdAt", "updatedAt"
      ) VALUES (
        ${id}, ${window.scope}, ${window.seasonKey}, ${window.startsAt},
        ${window.endsAt}, ${initialStatus}, ${input.asOf}, ${input.asOf}
      )
      ON CONFLICT ("scope", "seasonKey") DO NOTHING
    `;
    const season = await tx.leaderboardSeason.findUniqueOrThrow({
      where: {
        scope_seasonKey: {
          scope: window.scope,
          seasonKey: window.seasonKey,
        },
      },
    });
    if (
      !datesMatch(season.startsAt, window.startsAt)
      || !datesMatch(season.endsAt, window.endsAt)
    ) {
      throw new LeaderboardError(
        "LEADERBOARD_SEASON_CONFIGURATION_CONFLICT",
        "Stored season boundaries do not match the current server-owned definition.",
      );
    }
    if (
      season.status === "UPCOMING"
      && window.startsAt
      && input.asOf >= window.startsAt
    ) {
      return tx.leaderboardSeason.update({
        where: { id: season.id },
        data: { status: "ACTIVE" },
      });
    }
    return season;
  });
}

export async function getLeaderboardSeasonById(
  seasonId: string,
  database: PrismaClient = getPrisma() as PrismaClient,
): Promise<LeaderboardSeason> {
  if (
    typeof seasonId !== "string"
    || seasonId.length < 1
    || seasonId.length > 128
  ) {
    throw new LeaderboardError(
      "LEADERBOARD_INVALID_INPUT",
      "Season identifier is invalid.",
    );
  }
  const season = await database.leaderboardSeason.findUnique({
    where: { id: seasonId },
  });
  if (!season) {
    throw new LeaderboardError(
      "LEADERBOARD_SEASON_NOT_FOUND",
      "Leaderboard season was not found.",
    );
  }
  return season;
}

export async function getLeaderboardSeasonByKey(input: {
  scope: LeaderboardScope;
  seasonKey: string;
}, database: PrismaClient = getPrisma() as PrismaClient): Promise<LeaderboardSeason> {
  if (!validateSeasonKey(input.scope, input.seasonKey)) {
    throw new LeaderboardError(
      "LEADERBOARD_INVALID_INPUT",
      "Canonical season key is invalid for the requested scope.",
    );
  }
  const season = await database.leaderboardSeason.findUnique({
    where: {
      scope_seasonKey: {
        scope: input.scope,
        seasonKey: input.seasonKey,
      },
    },
  });
  if (!season) {
    throw new LeaderboardError(
      "LEADERBOARD_SEASON_NOT_FOUND",
      "Leaderboard season was not found.",
    );
  }
  return season;
}

export function leaderboardSeasonToWindow(
  season: LeaderboardSeason,
): {
  scope: LeaderboardScope;
  seasonKey: string;
  startsAt: Date | null;
  endsAt: Date | null;
} {
  const scope = parseLeaderboardScope(season.scope);
  if (!scope) {
    throw new LeaderboardError(
      "LEADERBOARD_SEASON_CONFIGURATION_CONFLICT",
      "Stored leaderboard season has an unsupported scope.",
    );
  }
  return {
    scope,
    seasonKey: season.seasonKey,
    startsAt: season.startsAt,
    endsAt: season.endsAt,
  };
}

export async function findSeasonWithinTransaction(
  seasonId: string,
  tx: Transaction,
): Promise<LeaderboardSeason> {
  const season = await tx.leaderboardSeason.findUnique({
    where: { id: seasonId },
  });
  if (!season) {
    throw new LeaderboardError(
      "LEADERBOARD_SEASON_NOT_FOUND",
      "Leaderboard season was not found.",
    );
  }
  return season;
}