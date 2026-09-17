export const MAX_NOTE_MATERIALS = 10;

export class NoteLimitReachedError extends Error {
  readonly code = "NOTE_LIMIT_REACHED";
  readonly currentCount: number;

  constructor(currentCount: number) {
    super("This lecture already has the maximum of 10 notes.");
    this.name = "NoteLimitReachedError";
    this.currentCount = currentCount;
  }
}

export function noteLimitResponse(currentCount: number): {
  error: string;
  code: "NOTE_LIMIT_REACHED";
  max: number;
  currentCount: number;
  remaining: number;
} {
  return {
    error: "This lecture already has the maximum of 10 notes.",
    code: "NOTE_LIMIT_REACHED",
    max: MAX_NOTE_MATERIALS,
    currentCount,
    remaining: Math.max(0, MAX_NOTE_MATERIALS - currentCount),
  };
}

export function sortNoteMaterials<T extends {
  id?: string | null;
  createdAt?: string | Date | null;
}>(materials: T[]): T[] {
  return [...materials].sort((a, b) => {
    const createdA = Date.parse(String(a.createdAt || ""));
    const createdB = Date.parse(String(b.createdAt || ""));
    if (Number.isFinite(createdA) && Number.isFinite(createdB) && createdA !== createdB) {
      return createdA - createdB;
    }
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}