export type MaintenanceScope = {
  userId?: string;
  lectureId?: string;
  all?: boolean;
};

export function parseMaintenanceScope(value: string): MaintenanceScope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Maintenance scope must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Maintenance scope must be a JSON object.");
  }
  const input = parsed as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.some((key) => !["userId", "lectureId", "all"].includes(key))) {
    throw new Error("Maintenance scope contains an unsupported field.");
  }
  for (const key of ["userId", "lectureId"] as const) {
    if (input[key] !== undefined && (typeof input[key] !== "string" || input[key].length === 0)) {
      throw new Error(`Maintenance scope ${key} must be a non-empty string.`);
    }
  }
  if (input.all !== undefined && typeof input.all !== "boolean") {
    throw new Error("Maintenance scope all must be boolean.");
  }
  const scope: MaintenanceScope = {};
  if (typeof input.userId === "string") scope.userId = input.userId;
  if (typeof input.lectureId === "string") scope.lectureId = input.lectureId;
  if (input.all === true) scope.all = true;
  if (!scope.all && !scope.userId && !scope.lectureId) {
    throw new Error("Maintenance scope must include userId, lectureId, or all:true.");
  }
  if (scope.all && (scope.userId || scope.lectureId)) {
    throw new Error("Maintenance scope all:true cannot be combined with an ID filter.");
  }
  return scope;
}

export function canonicalMaintenanceScope(scope: MaintenanceScope): string {
  const normalized: MaintenanceScope = {};
  if (scope.userId) normalized.userId = scope.userId;
  if (scope.lectureId) normalized.lectureId = scope.lectureId;
  if (scope.all === true) normalized.all = true;
  return JSON.stringify(normalized);
}

export function decodePairCursor(cursor: string | null): { userId: string; lectureId: string } | null {
  if (!cursor) return null;
  const separator = cursor.indexOf("\u0000");
  if (separator <= 0 || separator === cursor.length - 1) {
    throw new Error("Maintenance cursor is invalid.");
  }
  return { userId: cursor.slice(0, separator), lectureId: cursor.slice(separator + 1) };
}

export function encodePairCursor(userId: string, lectureId: string): string {
  return `${userId}\u0000${lectureId}`;
}