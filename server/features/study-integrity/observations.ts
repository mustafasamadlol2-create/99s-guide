import {
  INTEGRITY_LIMITS,
  INTEGRITY_OBSERVATION_CATALOG,
  type IntegrityObservationCode,
  type IntegrityObservationSeverity,
} from "./constants.js";
import type {
  IntegrityObservation,
  IntegrityStructuredValue,
} from "./types.js";
import { canonicalJson } from "../study-core/canonicalJson.js";

const SENSITIVE_DETAIL_KEY =
  /token|authorization|secret|password|signing.?key|api.?key|question|answer|prompt|content|note|pdf|flashcard|resume|capability|invite|text|body/i;

export type SafeIntegrityDetails = Readonly<
  Record<string, IntegrityStructuredValue>
>;

export function sanitizeIntegrityDetails(
  details: Readonly<Record<string, unknown>>,
): SafeIntegrityDetails {
  let remainingKeys = INTEGRITY_LIMITS.maxObservationDetailKeys;
  const ancestors = new Set<object>();

  const visit = (value: unknown, depth: number): IntegrityStructuredValue | undefined => {
    if (value === null) return null;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      return value.slice(0, INTEGRITY_LIMITS.maxObservationDetailStringLength);
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
        return undefined;
      }
      return value;
    }
    if (typeof value !== "object" || depth >= INTEGRITY_LIMITS.maxObservationDetailDepth) {
      return undefined;
    }
    if (ancestors.has(value)) return undefined;

    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        const items: IntegrityStructuredValue[] = [];
        for (const item of value.slice(0, INTEGRITY_LIMITS.maxObservationDetailArrayItems)) {
          const safeItem = visit(item, depth + 1);
          if (safeItem !== undefined) items.push(safeItem);
        }
        return items;
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return undefined;
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const safe: Record<string, IntegrityStructuredValue> = Object.create(
        null,
      ) as Record<string, IntegrityStructuredValue>;
      for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (
          remainingKeys <= 0 ||
          !descriptor?.enumerable ||
          !("value" in descriptor) ||
          SENSITIVE_DETAIL_KEY.test(key)
        ) {
          continue;
        }
        remainingKeys -= 1;
        const safeValue = visit(descriptor.value, depth + 1);
        if (safeValue !== undefined) safe[key.slice(0, 64)] = safeValue;
      }
      return safe;
    } finally {
      ancestors.delete(value);
    }
  };

  const result = visit(details, 0);
  if (!result || Array.isArray(result) || typeof result !== "object") return {};

  try {
    canonicalJson(result, {
      maxBytes: INTEGRITY_LIMITS.maxObservationDetailsBytes,
    });
    return result as SafeIntegrityDetails;
  } catch {
    return {};
  }
}

export function createIntegrityObservation(
  code: IntegrityObservationCode,
  details: Readonly<Record<string, unknown>> = {},
  severity?: IntegrityObservationSeverity,
): IntegrityObservation {
  const definition = INTEGRITY_OBSERVATION_CATALOG[code];
  return {
    code,
    severity: severity ?? definition.severity,
    category: definition.category,
    ruleId: definition.ruleId,
    details: sanitizeIntegrityDetails(details),
  };
}