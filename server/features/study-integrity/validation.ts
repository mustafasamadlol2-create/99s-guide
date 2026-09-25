import { Buffer } from "node:buffer";
import { STUDY_EVENT_SOURCES } from "../study-core/events.js";
import { EVIDENCE_CLASSES } from "../study-core/evidence.js";
import { PRIVACY_CLASSES } from "../study-core/privacy.js";
import { canonicalJson, CanonicalJsonError } from "../study-core/canonicalJson.js";
import { INTEGRITY_LIMITS } from "./constants.js";
import { createIntegrityObservation } from "./observations.js";
import { isValidClientInstanceId } from "./envelope.js";
import type {
  IntegrityActionEnvelope,
  IntegrityObservation,
} from "./types.js";

const ACTION_TYPE_FORMAT = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const RESOURCE_KIND_FORMAT = /^[a-z][a-z0-9_-]*$/;

export type IntegrityStructureResult = {
  valid: boolean;
  observations: IntegrityObservation[];
};

export function validateIntegrityEnvelopeStructure(
  action: IntegrityActionEnvelope,
  payloadMaxBytes: number,
): IntegrityStructureResult {
  const observations: IntegrityObservation[] = [];
  const malformed =
    typeof action.actionType !== "string" ||
    action.actionType.length > 96 ||
    !ACTION_TYPE_FORMAT.test(action.actionType) ||
    typeof action.userId !== "string" ||
    action.userId.length < 1 ||
    action.userId.length > 128 ||
    !STUDY_EVENT_SOURCES.includes(action.source) ||
    !EVIDENCE_CLASSES.includes(action.evidenceClass) ||
    !PRIVACY_CLASSES.includes(action.privacyClass) ||
    (action.idempotencyKey !== undefined &&
      (typeof action.idempotencyKey !== "string" ||
        action.idempotencyKey.length < 1 ||
        action.idempotencyKey.length > INTEGRITY_LIMITS.maxIdempotencyKeyLength)) ||
    (action.clientInstanceId !== undefined &&
      !isValidClientInstanceId(action.clientInstanceId)) ||
    (action.resource !== undefined &&
      (typeof action.resource !== "object" ||
        action.resource === null ||
        typeof action.resource.kind !== "string" ||
        action.resource.kind.length < 1 ||
        action.resource.kind.length > INTEGRITY_LIMITS.maxResourceKindLength ||
        !RESOURCE_KIND_FORMAT.test(action.resource.kind) ||
        typeof action.resource.id !== "string" ||
        action.resource.id.length < 1 ||
        action.resource.id.length > INTEGRITY_LIMITS.maxResourceIdLength)) ||
    (action.durationSeconds !== undefined &&
      typeof action.durationSeconds !== "number");

  if (malformed) {
    observations.push(createIntegrityObservation("PAYLOAD_INVALID"));
  }

  if (
    !Number.isSafeInteger(payloadMaxBytes) ||
    payloadMaxBytes < 1 ||
    payloadMaxBytes > INTEGRITY_LIMITS.maxPayloadBytes
  ) {
    observations.push(createIntegrityObservation("PAYLOAD_INVALID"));
    return { valid: false, observations };
  }

  for (const [name, value, maxBytes] of [
    ["payload", action.payload, payloadMaxBytes],
    [
      "metadata",
      action.metadata,
      INTEGRITY_LIMITS.maxEnvelopeMetadataBytes,
    ],
  ] as const) {
    if (value === undefined) continue;
    try {
      const serialized = canonicalJson(value, { maxBytes });
      if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
        observations.push(
          createIntegrityObservation("PAYLOAD_TOO_LARGE", { field: name, maxBytes }),
        );
      }
    } catch (error) {
      if (error instanceof CanonicalJsonError && error.code === "TOO_LARGE") {
        observations.push(
          createIntegrityObservation("PAYLOAD_TOO_LARGE", { field: name, maxBytes }),
        );
      } else {
        observations.push(
          createIntegrityObservation("PAYLOAD_INVALID", { field: name }),
        );
      }
    }
  }

  return {
    valid: observations.length === 0,
    observations,
  };
}