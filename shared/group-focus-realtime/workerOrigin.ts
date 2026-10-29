export const GROUP_FOCUS_DEFAULT_WORKER_ORIGIN =
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
    return url.toString().replace(/\/$/u, "");
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
    if (labels[0] === "99sguide-group-focus") return normalized;
    url.hostname = ["99sguide-group-focus", ...labels.slice(1)].join(".");
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
