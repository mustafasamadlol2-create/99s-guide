import type { SystemHealthSnapshot } from "../../../server/observability/types.js";
import { apiClient } from "../../core/api/apiClient.js";

export class SystemHealthRequestError extends Error {
  constructor(readonly status: number) {
    super("System health request failed.");
    this.name = "SystemHealthRequestError";
  }
}

export async function getSystemHealthSnapshot(): Promise<SystemHealthSnapshot> {
  let response: Response;
  try {
    response = await apiClient("/api/admin/study-health", {
      method: "GET",
      cache: "no-store",
      bypassCache: true,
      ttl: 0,
      retries: 0,
      silent: true,
    });
  } catch {
    throw new SystemHealthRequestError(0);
  }
  if (!response.ok) throw new SystemHealthRequestError(response.status);

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new SystemHealthRequestError(502);
  }
  if (
    typeof value !== "object"
    || value === null
    || (value as SystemHealthSnapshot).version !== "study-system-health-v1"
    || !("components" in value)
    || !("operations" in value)
  ) {
    throw new SystemHealthRequestError(502);
  }
  return value as SystemHealthSnapshot;
}