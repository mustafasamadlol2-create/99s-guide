import { createHmac, randomBytes } from "node:crypto";
import type { GroupFocusAuthorizationContext } from "./types.js";
import { GroupFocusError } from "./errors.js";
import {
  GROUP_FOCUS_CAPABILITY_AUDIENCE,
  GROUP_FOCUS_CAPABILITY_DEFAULT_TTL_SECONDS,
  GROUP_FOCUS_CAPABILITY_ISSUER,
  GROUP_FOCUS_CAPABILITY_PURPOSE,
  GROUP_FOCUS_CAPABILITY_VERSION,
  parseGroupFocusCapabilityClaims,
} from "../../../shared/group-focus-capability/contract.js";
import { encodeBase64Url } from "../../../shared/group-focus-capability/encoding.js";
import {
  getActiveGroupFocusCapabilityKey,
  GroupFocusCapabilityConfigurationError,
  type GroupFocusCapabilityEnvironment,
} from "../../../shared/group-focus-capability/keyring.js";

export type GroupFocusCapabilityResponse = {
  capabilityToken: string;
  expiresAt: string;
  expiresInSeconds: number;
};

export function issueGroupFocusCapability(
  context: GroupFocusAuthorizationContext,
  environment: GroupFocusCapabilityEnvironment = process.env,
  now: Date = new Date(),
): GroupFocusCapabilityResponse {
  let activeKey;
  try {
    activeKey = getActiveGroupFocusCapabilityKey(environment);
  } catch (error) {
    if (error instanceof GroupFocusCapabilityConfigurationError) {
      throw new GroupFocusError(
        "CAPABILITY_NOT_CONFIGURED",
        "Group Focus capability signing is not configured.",
      );
    }
    throw error;
  }

  const nowMilliseconds = now.getTime();
  if (!Number.isFinite(nowMilliseconds)) {
    throw new GroupFocusError(
      "RECONCILIATION_REQUIRED",
      "Group Focus authorization context is invalid.",
    );
  }
  const iat = Math.floor(nowMilliseconds / 1000);
  const exp = iat + GROUP_FOCUS_CAPABILITY_DEFAULT_TTL_SECONDS;
  const claims = {
    version: GROUP_FOCUS_CAPABILITY_VERSION,
    iss: GROUP_FOCUS_CAPABILITY_ISSUER,
    aud: GROUP_FOCUS_CAPABILITY_AUDIENCE,
    purpose: GROUP_FOCUS_CAPABILITY_PURPOSE,
    sub: context.userId,
    roomId: context.roomId,
    membershipId: context.membershipId,
    role: context.role,
    mode: context.mode,
    visibility: context.visibility,
    effectiveLectureId: context.effectiveLectureId,
    focusDurationSeconds: context.focusDurationSeconds,
    breakDurationSeconds: context.breakDurationSeconds,
    roundCount: context.roundCount,
    maxParticipants: context.maxParticipants,
    roomUpdatedAt: context.roomUpdatedAt,
    membershipUpdatedAt: context.membershipUpdatedAt,
    iat,
    nbf: iat,
    exp,
    jti: encodeBase64Url(randomBytes(16)),
  };

  if (!parseGroupFocusCapabilityClaims(claims, now)) {
    throw new GroupFocusError(
      "RECONCILIATION_REQUIRED",
      "Group Focus authorization context is invalid.",
    );
  }

  const header = {
    alg: "HS256",
    typ: "GF-CAP",
    kid: activeKey.kid,
  };
  const encoder = new TextEncoder();
  const headerSegment = encodeBase64Url(encoder.encode(JSON.stringify(header)));
  const payloadSegment = encodeBase64Url(encoder.encode(JSON.stringify(claims)));
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signature = createHmac("sha256", activeKey.bytes)
    .update(signingInput, "ascii")
    .digest("base64url");

  return {
    capabilityToken: `${signingInput}.${signature}`,
    expiresAt: new Date(exp * 1000).toISOString(),
    expiresInSeconds: GROUP_FOCUS_CAPABILITY_DEFAULT_TTL_SECONDS,
  };
}