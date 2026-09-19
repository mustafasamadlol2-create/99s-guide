import { apiClient } from "../../core/api/apiClient";
import {
  acknowledgePersonalizationCloudRecord,
  createPersonalizationEnvelope,
  readCachedPersonalization,
  writePendingPersonalization,
  writePersonalizationEnvelope,
  type PersonalizationCacheReadResult,
  type PersonalizationKeyValueStorage,
} from "./personalizationStorage";
import {
  type PersonalizationCloudRecord,
  type PersonalizationConfigV2,
  type PersonalizationLocalEnvelopeV2,
  type PersonalizationSyncState,
} from "../../../shared/personalization";
import { personalizationConfigsEqual } from "./personalizationState";

export type PersonalizationCloudResult =
  | { status: "ok"; record: PersonalizationCloudRecord }
  | { status: "empty"; record: null }
  | { status: "disabled"; record: null };

export type PersonalizationReconciliation =
  | { action: "none"; state?: PersonalizationSyncState }
  | { action: "upload-pending"; pending: NonNullable<PersonalizationLocalEnvelopeV2["sync"]["pending"]> }
  | { action: "adopt"; record: PersonalizationCloudRecord }
  | { action: "confirm"; candidate: PersonalizationConfigV2; record: PersonalizationCloudRecord | null };

export async function getPersonalizationCloud(): Promise<PersonalizationCloudResult> {
  const response = await apiClient("/api/personalization", {
    bypassCache: true,
    silent: true,
    timeoutMs: 10_000,
    retries: 0,
  });
  const body = await response.json() as unknown;
  if (!body || typeof body !== "object") throw new Error("Invalid personalization sync response.");
  const data = body as Record<string, unknown>;
  if (data.status === "disabled") return { status: "disabled", record: null };
  if (data.status === "empty") return { status: "empty", record: null };
  if (data.status !== "ok" || !data.record) throw new Error("Invalid personalization sync response.");
  return { status: "ok", record: data.record as PersonalizationCloudRecord };
}

export async function putPersonalizationCloud(
  pending: NonNullable<PersonalizationLocalEnvelopeV2["sync"]["pending"]>,
  knownRevision: string | null,
): Promise<PersonalizationCloudRecord | null> {
  const response = await apiClient("/api/personalization", {
    method: "PUT",
    bypassCache: true,
    silent: true,
    timeoutMs: 10_000,
    retries: 0,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      config: pending.config,
      intentId: pending.intentId,
      knownRevision,
    }),
  });
  const body = await response.json() as { status?: string; record?: PersonalizationCloudRecord };
  if (body.status === "disabled") return null;
  if (body.status !== "ok" || !body.record) throw new Error("Invalid personalization sync response.");
  return body.record;
}

export function reconcilePersonalization(
  local: PersonalizationCacheReadResult,
  remote: PersonalizationCloudResult,
): PersonalizationReconciliation {
  if (remote.status === "disabled") return { action: "none" };
  if (local.status !== "found") {
    return remote.status === "ok" ? { action: "adopt", record: remote.record } : { action: "none" };
  }
  const envelope = local.envelope;
  if (envelope.sync.pending) return { action: "upload-pending", pending: envelope.sync.pending };
  if (remote.status === "empty") {
    if (envelope.sync.knownCloudRevision === null) {
      return { action: "confirm", candidate: envelope.config, record: null };
    }
    return { action: "none", state: "retryable-failure" };
  }
  if (envelope.sync.knownCloudRevision === remote.record.revision) {
    return { action: "none", state: "clean" };
  }
  if (personalizationConfigsEqual(envelope.config, remote.record.config)) {
    return { action: "adopt", record: remote.record };
  }
  return { action: "confirm", candidate: envelope.config, record: remote.record };
}

export async function persistSyncState(
  userId: string,
  envelope: PersonalizationLocalEnvelopeV2,
  state: PersonalizationSyncState,
  storage?: PersonalizationKeyValueStorage,
): Promise<void> {
  await writePersonalizationEnvelope(userId, {
    ...envelope,
    savedAt: new Date().toISOString(),
    sync: { ...envelope.sync, lastSyncState: state },
  }, storage);
}

export {
  acknowledgePersonalizationCloudRecord,
  createPersonalizationEnvelope,
  readCachedPersonalization,
  writePendingPersonalization,
  writePersonalizationEnvelope,
};