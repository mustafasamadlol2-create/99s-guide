import { STUDY_EVENT_SOURCES, type StudyEventSource } from "../study-core/events.js";
import { DEFAULT_INTEGRITY_PRIVACY, INTEGRITY_LIMITS } from "./constants.js";
import { StudyIntegrityError } from "./errors.js";
import { getIntegrityPolicy } from "./policy.js";
import type {
  IntegrityActionEnvelope,
  IntegritySubject,
} from "./types.js";

export type NewIntegrityActionEnvelope = Omit<
  IntegrityActionEnvelope,
  "privacyClass"
> & {
  privacyClass?: never;
};

/** Privacy is assigned by the server policy, never copied from client input. */
export function createIntegrityActionEnvelope(
  input: NewIntegrityActionEnvelope,
): IntegrityActionEnvelope {
  const policy = getIntegrityPolicy(input.actionType);
  return {
    ...input,
    privacyClass: policy?.privacyClass ?? DEFAULT_INTEGRITY_PRIVACY,
  };
}

export function isValidClientInstanceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= INTEGRITY_LIMITS.maxClientInstanceIdLength &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

export function normalizeIntegritySubject(input: {
  userId: string;
  source: StudyEventSource;
  clientInstanceId?: string;
  sessionId?: string;
}): IntegritySubject {
  if (
    typeof input.userId !== "string" ||
    input.userId.length < 1 ||
    input.userId.length > 128 ||
    !STUDY_EVENT_SOURCES.includes(input.source) ||
    (input.clientInstanceId !== undefined &&
      !isValidClientInstanceId(input.clientInstanceId)) ||
    (input.sessionId !== undefined &&
      (typeof input.sessionId !== "string" ||
        input.sessionId.length < 1 ||
        input.sessionId.length > 128))
  ) {
    throw new StudyIntegrityError(
      "INTEGRITY_INVALID_INPUT",
      "Integrity subject fields are invalid or exceed their bounds.",
    );
  }

  return {
    userId: input.userId,
    source: input.source,
    ...(input.clientInstanceId ? { clientInstanceId: input.clientInstanceId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  };
}