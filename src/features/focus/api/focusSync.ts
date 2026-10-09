export const FOCUS_STATE_INVALIDATED_EVENT = "focus-state-invalidated";
export const FOCUS_VIEW_RECONCILE_EVENT = "focus-view-reconcile";
export const FOCUS_SOCKET_RECONNECTED_EVENT = "focus-socket-reconnected";

export const FOCUS_SYNC_RESOURCES = [
  "current-session",
  "plans",
  "break",
  "history",
  "metrics",
  "summary",
  "post-actions",
] as const;

export type FocusSyncResource = (typeof FOCUS_SYNC_RESOURCES)[number];

export interface FocusInvalidationDetail {
  eventId?: string;
  reason?: string;
  changedAt?: string;
  resources: FocusSyncResource[];
  sessionId?: string;
  planId?: string;
  originClientId?: string;
}

type FocusReadLoader<T> = (requestKey: string) => Promise<T>;

const readEpochs = new Map<string, number>();
const readFlights = new Map<string, Promise<unknown>>();
const seenEventIds = new Set<string>();
let clientInstanceId: string | null = null;
let accountScope = "anonymous";

function readEpoch(scope: string): number {
  return readEpochs.get(scope) ?? 0;
}

function bumpReadEpoch(scope: string): void {
  readEpochs.set(scope, readEpoch(scope) + 1);
}

function bumpMatchingScopes(prefix: string, exact?: string): void {
  if (exact) {
    bumpReadEpoch(exact);
    return;
  }
  const scopes = new Set(
    [...readEpochs.keys()].filter((scope) => scope === prefix || scope.startsWith(`${prefix}:`)),
  );
  scopes.add(prefix);
  scopes.forEach(bumpReadEpoch);
}

function getScopedEpochKey(scope: string, variant: string, epoch: number): string {
  return `${scope}:${variant}:${epoch}`;
}

/**
 * Shares concurrent reads for the same resource and query. If an invalidation
 * arrives while a read is pending, callers wait for a request from the newer
 * epoch instead of committing the now-stale response.
 */
export async function readFocusResource<T>(
  scope: string,
  variant: string,
  load: FocusReadLoader<T>,
): Promise<T> {
  const scopedRead = `${accountScope}|${scope}`;
  for (;;) {
    const epoch = readEpoch(scopedRead);
    const flightKey = `${scopedRead}|${variant}|${epoch}`;
    let flight = readFlights.get(flightKey) as Promise<T> | undefined;
    if (!flight) {
      const requestKey = getScopedEpochKey(scopedRead, variant, epoch);
      const pending = Promise.resolve().then(() => load(requestKey));
      const tracked = pending.finally(() => {
        if (readFlights.get(flightKey) === tracked) {
          readFlights.delete(flightKey);
        }
      });
      readFlights.set(flightKey, tracked);
      flight = tracked;
    }

    let result: T;
    try {
      result = await flight;
    } catch (error) {
      if (readEpoch(scopedRead) !== epoch) continue;
      throw error;
    }
    if (readEpoch(scopedRead) === epoch) return result;
  }
}

export function setFocusReadAccountScope(accountId: string | null | undefined): void {
  accountScope = typeof accountId === "string" && accountId.trim()
    ? accountId.trim()
    : "anonymous";
}

export function invalidateFocusResources(
  invalidation: Pick<FocusInvalidationDetail, "resources" | "sessionId" | "planId">,
): void {
  for (const resource of invalidation.resources) {
    switch (resource) {
      case "current-session":
      case "history":
      case "metrics":
        bumpReadEpoch(`${accountScope}|${resource}`);
        break;
      case "plans":
        bumpMatchingScopes(`${accountScope}|plans`);
        if (invalidation.planId) {
          bumpReadEpoch(`${accountScope}|plan:${invalidation.planId}`);
        } else {
          bumpMatchingScopes(`${accountScope}|plan`);
        }
        break;
      case "break":
        bumpMatchingScopes(
          `${accountScope}|break`,
          invalidation.sessionId
            ? `${accountScope}|break:${invalidation.sessionId}`
            : undefined,
        );
        break;
      case "summary":
        bumpMatchingScopes(
          `${accountScope}|summary`,
          invalidation.sessionId
            ? `${accountScope}|summary:${invalidation.sessionId}`
            : undefined,
        );
        break;
      case "post-actions":
        bumpMatchingScopes(
          `${accountScope}|post-actions`,
          invalidation.sessionId
            ? `${accountScope}|post-actions:${invalidation.sessionId}`
            : undefined,
        );
        break;
      default:
        bumpReadEpoch(`${accountScope}|${resource}`);
        break;
    }
  }
}

/**
 * Validates and applies a server invalidation once. eventId prevents duplicate
 * socket deliveries from causing repeated resource reads.
 */
export function acceptFocusInvalidation(
  value: unknown,
): FocusInvalidationDetail | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.resources)) return null;
  const resources = [...new Set(input.resources.filter(
    (resource): resource is FocusSyncResource =>
      typeof resource === "string" &&
      (FOCUS_SYNC_RESOURCES as readonly string[]).includes(resource),
  ))];
  if (resources.length === 0) return null;

  const eventId = typeof input.eventId === "string" ? input.eventId : undefined;
  if (eventId && seenEventIds.has(eventId)) return null;
  if (eventId) {
    seenEventIds.add(eventId);
    if (seenEventIds.size > 500) {
      const oldest = seenEventIds.values().next().value;
      if (oldest) seenEventIds.delete(oldest);
    }
  }

  const detail: FocusInvalidationDetail = {
    resources,
    ...(eventId ? { eventId } : {}),
    ...(typeof input.reason === "string" ? { reason: input.reason } : {}),
    ...(typeof input.changedAt === "string" ? { changedAt: input.changedAt } : {}),
    ...(typeof input.sessionId === "string" ? { sessionId: input.sessionId } : {}),
    ...(typeof input.planId === "string" ? { planId: input.planId } : {}),
    ...(typeof input.originClientId === "string" ? { originClientId: input.originClientId } : {}),
  };
  invalidateFocusResources(detail);
  return detail;
}

export function isFocusResourceAffected(
  event: Event,
  resource: FocusSyncResource,
  resourceId?: string,
): boolean {
  const detail = (event as CustomEvent<FocusInvalidationDetail>).detail;
  if (!detail || !Array.isArray(detail.resources) || !detail.resources.includes(resource)) {
    return false;
  }
  if (!resourceId || !detail.sessionId || resource !== "break" &&
      resource !== "summary" && resource !== "post-actions") {
    return true;
  }
  return detail.sessionId === resourceId;
}

export function getFocusClientInstanceId(): string {
  if (clientInstanceId) return clientInstanceId;
  try {
    clientInstanceId = globalThis.crypto?.randomUUID?.() ?? "";
  } catch {
    clientInstanceId = "";
  }
  if (!clientInstanceId) {
    clientInstanceId = `focus-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
  return clientInstanceId;
}

export function isFocusInvalidationFromCurrentClient(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).originClientId === getFocusClientInstanceId(),
  );
}

export function resourcesForFocusMutation(
  path: string,
  result: unknown,
): Pick<FocusInvalidationDetail, "resources" | "sessionId" | "planId"> {
  const body = result && typeof result === "object"
    ? result as Record<string, unknown>
    : {};
  const session = body.session && typeof body.session === "object"
    ? body.session as Record<string, unknown>
    : {};
  const plan = body.plan && typeof body.plan === "object"
    ? body.plan as Record<string, unknown>
    : {};
  const sessionId =
    (typeof session.id === "string" ? session.id : undefined) ??
    path.match(/\/sessions\/([^/?]+)/)?.[1];
  const planId =
    (typeof plan.id === "string" ? plan.id : undefined) ??
    path.match(/\/plans\/([^/?]+)/)?.[1];

  if (
    typeof body.idempotency === "string" &&
    !["FIRST_SEEN", "CREATED"].includes(body.idempotency)
  ) {
    return { resources: [], ...(sessionId ? { sessionId } : {}) };
  }

  if (path.startsWith("/api/focus/plans")) {
    return { resources: ["plans"], ...(planId ? { planId } : {}) };
  }

  const isTerminal = ["COMPLETED", "ABANDONED", "EXPIRED"].includes(
    typeof session.status === "string" ? session.status : "",
  );
  const terminalResources: FocusSyncResource[] = [
    "history",
    "metrics",
    "summary",
    "post-actions",
  ];

  if (path.includes("/break/")) {
    return {
      resources: [
        "current-session",
        "break",
        ...(isTerminal ? terminalResources : []),
      ],
      ...(sessionId ? { sessionId } : {}),
    };
  }
  if (path.includes("/interruptions")) {
    const resources: FocusSyncResource[] =
      body.metricUpdated === true ? ["history", "metrics"] : [];
    return { resources, ...(sessionId ? { sessionId } : {}) };
  }
  if (isTerminal || path.endsWith("/complete") || path.endsWith("/abandon")) {
    return {
      resources: ["current-session", ...terminalResources],
      ...(sessionId ? { sessionId } : {}),
    };
  }
  return {
    resources: ["current-session"],
    ...(sessionId ? { sessionId } : {}),
  };
}
