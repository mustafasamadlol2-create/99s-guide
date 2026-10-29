export const GROUP_FOCUS_DEFAULT_WORKER_ORIGIN =
  "https://99s-guide.mustafasamadlol2.workers.dev";
export const GROUP_FOCUS_LEGACY_WORKER_ORIGIN =
  "https://99sguide-group-focus.mustafasamadlol2.workers.dev";

export function normalizeGroupFocusWorkerOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    const url = new URL(value.trim());
    if (
      (url.protocol !== "https:" && url.protocol !== "http:")
      || url.username.length > 0
      || url.password.length > 0
      || url.search.length > 0
      || url.hash.length > 0
      || (url.pathname !== "/" && url.pathname !== "")
    ) return null;
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    const normalized = url.toString().replace(/\/$/u, "");
    // The old dedicated Worker is intentionally retired. Mapping it to the main
    // app origin keeps stale Render/Vite environment values from breaking Group
    // Focus after the realtime Durable Object moved into the primary Worker.
    if (normalized === GROUP_FOCUS_LEGACY_WORKER_ORIGIN) {
      return GROUP_FOCUS_DEFAULT_WORKER_ORIGIN;
    }
    return normalized;
  } catch {
    return null;
  }
}

export function deriveSiblingGroupFocusWorkerOrigin(value: unknown): string | null {
  const normalized = normalizeGroupFocusWorkerOrigin(value);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    const labels = url.hostname.split(".");
    if (labels.length < 4 || labels.slice(-2).join(".") !== "workers.dev") return null;
    if (labels[0] === "99s-guide") return normalized;
    // All current deployments use the main 99s-guide Worker for realtime.
    url.hostname = ["99s-guide", ...labels.slice(1)].join(".");
    return url.toString().replace(/\/$/u, "");
  } catch {
    return null;
  }
}

export function groupFocusWorkerOriginCandidates(input: {
  preferred?: unknown;
  configured?: unknown;
  currentAppOrigin?: unknown;
}): string[] {
  const candidates = [
    normalizeGroupFocusWorkerOrigin(input.preferred),
    normalizeGroupFocusWorkerOrigin(input.currentAppOrigin),
    normalizeGroupFocusWorkerOrigin(input.configured),
    deriveSiblingGroupFocusWorkerOrigin(input.configured),
    deriveSiblingGroupFocusWorkerOrigin(input.currentAppOrigin),
    GROUP_FOCUS_DEFAULT_WORKER_ORIGIN,
  ];
  return [...new Set(candidates.filter((value): value is string => Boolean(value)))];
}

export function resolveGroupFocusWorkerOrigin(environment: {
  GROUP_FOCUS_WORKER_URL?: string;
  VITE_GROUP_FOCUS_WORKER_URL?: string;
}): string {
  return groupFocusWorkerOriginCandidates({
    preferred: environment.GROUP_FOCUS_WORKER_URL,
    configured: environment.VITE_GROUP_FOCUS_WORKER_URL,
  })[0] ?? GROUP_FOCUS_DEFAULT_WORKER_ORIGIN;
}
