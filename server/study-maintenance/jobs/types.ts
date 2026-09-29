import type { PrismaClient } from "@prisma/client";
import type { MaintenanceAdapter } from "../core/index.js";

export type MaintenanceDatabase = Pick<PrismaClient, "user">;

export type UserMaintenanceItem = { id: string };

export type UserMaintenanceAdapter = MaintenanceAdapter<UserMaintenanceItem>;

export type UserMaintenanceDependencies = {
  database: MaintenanceDatabase;
};

export function parseUserScope(scope: string): { userId?: string; all: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(scope);
  } catch {
    throw new Error("Maintenance scope must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Maintenance scope must be an object.");
  }
  const value = parsed as { userId?: unknown; all?: unknown };
  if (value.userId !== undefined &&
      (typeof value.userId !== "string" || value.userId.trim() !== value.userId || value.userId.length === 0)) {
    throw new Error("Maintenance scope userId must be a nonempty string.");
  }
  if (value.all !== undefined && typeof value.all !== "boolean") {
    throw new Error("Maintenance scope all must be a boolean.");
  }
  if (value.userId !== undefined && value.all === true) {
    throw new Error("Maintenance scope cannot combine userId and all.");
  }
  return { userId: value.userId as string | undefined, all: value.all === true };
}

export function userDiscoverer(database: MaintenanceDatabase): UserMaintenanceAdapter["discoverBatch"] {
  return async ({ cursor, limit, scope }) => {
    const selected = parseUserScope(scope);
    if (selected.userId) {
      if (cursor) return { items: [], nextCursor: null };
      const row = await database.user.findUnique({
        where: { id: selected.userId },
        select: { id: true },
      });
      return { items: row ? [{ id: row.id }] : [], nextCursor: null };
    }
    if (!selected.all) throw new Error("Maintenance scope must specify userId or all.");
    const rows = await database.user.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      orderBy: { id: "asc" },
      take: limit,
      select: { id: true },
    });
    return {
      items: rows.map((row) => ({ id: row.id })),
      nextCursor: rows.length === limit ? rows.at(-1)?.id ?? null : null,
    };
  };
}