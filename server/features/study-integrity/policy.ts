import type { EvidenceClass } from "../study-core/evidence.js";
import type { StudyEventSource } from "../study-core/events.js";
import { DEFAULT_INTEGRITY_PRIVACY, INTEGRITY_ACTION_TYPES, INTEGRITY_LIMITS } from "./constants.js";
import type { IntegrityPolicy, IntegrityTimestampPolicy } from "./types.js";

const clientSources = [
  "web",
  "pwa",
  "ios",
  "android",
  "offline_replay",
] as const satisfies readonly StudyEventSource[];

const realtimeMembershipSources = [
  "backend",
  "durable_object",
] as const satisfies readonly StudyEventSource[];

const backendOnly = ["backend"] as const satisfies readonly StudyEventSource[];
const securityPrivacy = [DEFAULT_INTEGRITY_PRIVACY] as const;

/**
 * Client clocks are bounded, not treated as proof of misconduct. Out-of-bound
 * timestamps block the action; near-boundary skew may be reviewed. Details stay
 * under the default ADMIN_SECURITY privacy class.
 */
const clientTimestampPolicy: IntegrityTimestampPolicy = Object.freeze({
  authority: "CLIENT_BOUNDED",
  acceptClientTimestamp: true,
  replaceWithServerTime: false,
  maxPastMs: INTEGRITY_LIMITS.clientPastWindowMs,
  maxFutureMs: INTEGRITY_LIMITS.clientFutureSkewMs,
  clampSmallFutureSkew: true,
});

/** Server-authoritative actions replace device time with trusted receivedAt. */
const serverTimestampPolicy: IntegrityTimestampPolicy = Object.freeze({
  authority: "SERVER",
  acceptClientTimestamp: false,
  replaceWithServerTime: true,
});

function policy(
  actionType: string,
  minimumEvidence: EvidenceClass,
  allowedSources: readonly StudyEventSource[],
  timestampPolicy: IntegrityTimestampPolicy,
  rewardEligibleEvidence: readonly EvidenceClass[] = [],
  requiredEvidenceClass?: EvidenceClass,
  options: Pick<IntegrityPolicy, "durationBounds" | "rateRule"> = {},
): IntegrityPolicy {
  return Object.freeze({
    actionType,
    minimumEvidence,
    ...(requiredEvidenceClass ? { requiredEvidenceClass } : {}),
    allowedSources: Object.freeze([...allowedSources]),
    serverOwnedSources: Object.freeze([...backendOnly]),
    privacyClass: DEFAULT_INTEGRITY_PRIVACY,
    allowedPrivacyClasses: Object.freeze([...securityPrivacy]),
    timestampPolicy: Object.freeze({ ...timestampPolicy }),
    ...(options.durationBounds
      ? { durationBounds: Object.freeze({ ...options.durationBounds }) }
      : {}),
    ...(options.rateRule
      ? { rateRule: Object.freeze({ ...options.rateRule }) }
      : {}),
    payloadMaxBytes: INTEGRITY_LIMITS.maxPayloadBytes,
    rewardEligibleEvidence: Object.freeze([...rewardEligibleEvidence]),
  });
}

const policies: readonly IntegrityPolicy[] = [
  policy(
    INTEGRITY_ACTION_TYPES.CLIENT_OBSERVATION,
    "UNVERIFIED_CLIENT",
    clientSources,
    clientTimestampPolicy,
  ),
  policy(
    INTEGRITY_ACTION_TYPES.FOCUS_SESSION_START,
    "CLIENT_OBSERVED",
    clientSources,
    clientTimestampPolicy,
  ),
  policy(
    INTEGRITY_ACTION_TYPES.FOCUS_SESSION_COMPLETE,
    "SERVER_VALIDATED",
    backendOnly,
    serverTimestampPolicy,
    ["SERVER_VALIDATED"],
  ),
  policy(
    INTEGRITY_ACTION_TYPES.FOCUS_INTERRUPTION_RECORD,
    "SERVER_VALIDATED",
    backendOnly,
    serverTimestampPolicy,
  ),
  policy(
    INTEGRITY_ACTION_TYPES.FOCUS_RESOURCE_HANDOFF_START,
    "CLIENT_OBSERVED",
    clientSources,
    clientTimestampPolicy,
  ),
  policy(
    INTEGRITY_ACTION_TYPES.FOCUS_RESOURCE_HANDOFF_RETURN,
    "CLIENT_OBSERVED",
    clientSources,
    clientTimestampPolicy,
  ),
  policy(
    INTEGRITY_ACTION_TYPES.FOCUS_BACKGROUND_ABSENCE,
    "CLIENT_OBSERVED",
    clientSources,
    clientTimestampPolicy,
  ),
  policy(
    INTEGRITY_ACTION_TYPES.STUDY_RESOURCE_OPEN,
    "CLIENT_OBSERVED",
    clientSources,
    clientTimestampPolicy,
  ),
  policy(
    INTEGRITY_ACTION_TYPES.GROUP_FOCUS_ROOM_JOIN,
    "CLIENT_OBSERVED",
    realtimeMembershipSources,
    serverTimestampPolicy,
  ),
  policy(
    INTEGRITY_ACTION_TYPES.GROUP_FOCUS_ROOM_LEAVE,
    "CLIENT_OBSERVED",
    realtimeMembershipSources,
    serverTimestampPolicy,
  ),
  policy(
    INTEGRITY_ACTION_TYPES.GROUP_FOCUS_ROUND_COMPLETE,
    "REALTIME_VERIFIED",
    backendOnly,
    serverTimestampPolicy,
    ["REALTIME_VERIFIED"],
    "REALTIME_VERIFIED",
  ),
  policy(
    INTEGRITY_ACTION_TYPES.GROUP_FOCUS_SUMMARY_COMPLETE,
    "REALTIME_VERIFIED",
    backendOnly,
    serverTimestampPolicy,
    ["REALTIME_VERIFIED"],
    "REALTIME_VERIFIED",
  ),
  policy(
    INTEGRITY_ACTION_TYPES.MCQ_ANSWER,
    "SERVER_VALIDATED",
    backendOnly,
    serverTimestampPolicy,
  ),
  policy(
    INTEGRITY_ACTION_TYPES.FLASHCARD_REVIEW,
    "SERVER_VALIDATED",
    backendOnly,
    serverTimestampPolicy,
  ),
  policy(
    INTEGRITY_ACTION_TYPES.RECALL_ANSWER,
    "SERVER_VALIDATED",
    backendOnly,
    serverTimestampPolicy,
  ),
];

export const INTEGRITY_POLICY_REGISTRY: Readonly<
  Record<string, IntegrityPolicy>
> = Object.freeze(
  Object.fromEntries(policies.map((entry) => [entry.actionType, entry])),
);

export function getIntegrityPolicy(
  actionType: string,
): IntegrityPolicy | undefined {
  if (!Object.hasOwn(INTEGRITY_POLICY_REGISTRY, actionType)) return undefined;
  return INTEGRITY_POLICY_REGISTRY[actionType];
}