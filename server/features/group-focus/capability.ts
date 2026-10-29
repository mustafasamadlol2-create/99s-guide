import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { GroupFocusAuthorizationContext } from "./types.js";
import { GroupFocusError } from "./errors.js";
import {
  GROUP_FOCUS_CAPABILITY_AUDIENCE,
  GROUP_FOCUS_CAPABILITY_DEFAULT_TTL_SECONDS,
  GROUP_FOCUS_CAPABILITY_ISSUER,
  GROUP_FOCUS_CAPABILITY_PURPOSE,
  GROUP_FOCUS_CAPABILITY_VERSION,
  parseGroupFocusCapabilityClaims,
  type VerifiedGroupFocusCapability,
} from "../../../shared/group-focus-capability/contract.js";
import { decodeBase64Url, encodeBase64Url } from "../../../shared/group-focus-capability/encoding.js";
import {
  getActiveGroupFocusCapabilityKey,
  parseGroupFocusCapabilityKeyring,
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

export function verifyIssuedGroupFocusCapability(
  token: string,
  environment: GroupFocusCapabilityEnvironment = process.env,
  now: Date = new Date(),
): VerifiedGroupFocusCapability {
  if (typeof token !== "string" || token.length === 0 || token.length > 8 * 1024) {
    throw new GroupFocusError("RECONCILIATION_REQUIRED", "Group Focus capability is invalid.");
  }
  const segments = token.split(".");
  if (segments.length !== 3) {
    throw new GroupFocusError("RECONCILIATION_REQUIRED", "Group Focus capability is invalid.");
  }
  const [headerSegment, payloadSegment, signatureSegment] = segments;
  const headerBytes = decodeBase64Url(headerSegment);
  const payloadBytes = decodeBase64Url(payloadSegment);
  const signature = decodeBase64Url(signatureSegment);
  if (!headerBytes || !payloadBytes || !signature || signature.byteLength !== 32) {
    throw new GroupFocusError("RECONCILIATION_REQUIRED", "Group Focus capability is invalid.");
  }
  let header: unknown;
  let payload: unknown;
  try {
    header = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(headerBytes)) as unknown;
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes)) as unknown;
  } catch {
    throw new GroupFocusError("RECONCILIATION_REQUIRED", "Group Focus capability is invalid.");
  }
  if (typeof header !== "object" || header === null || Array.isArray(header)) {
    throw new GroupFocusError("RECONCILIATION_REQUIRED", "Group Focus capability is invalid.");
  }
  const headerRecord = header as Record<string, unknown>;
  const keyring = parseGroupFocusCapabilityKeyring(environment.GROUP_FOCUS_CAPABILITY_KEYS_JSON);
  const kid = typeof headerRecord.kid === "string" ? headerRecord.kid : null;
  const key = kid ? keyring.get(kid) : undefined;
  if (
    headerRecord.alg !== "HS256"
    || headerRecord.typ !== "GF-CAP"
    || !key
  ) {
    throw new GroupFocusError("RECONCILIATION_REQUIRED", "Group Focus capability is invalid.");
  }
  const expected = createHmac("sha256", key)
    .update(`${headerSegment}.${payloadSegment}`, "ascii")
    .digest();
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new GroupFocusError("RECONCILIATION_REQUIRED", "Group Focus capability is invalid.");
  }
  const claims = parseGroupFocusCapabilityClaims(payload, now);
  if (!claims) {
    throw new GroupFocusError("RECONCILIATION_REQUIRED", "Group Focus capability is invalid or expired.");
  }
  return {
    version: claims.version,
    userId: claims.sub,
    roomId: claims.roomId,
    membershipId: claims.membershipId,
    role: claims.role,
    mode: claims.mode,
    visibility: claims.visibility,
    effectiveLectureId: claims.effectiveLectureId,
    focusDurationSeconds: claims.focusDurationSeconds,
    breakDurationSeconds: claims.breakDurationSeconds,
    roundCount: claims.roundCount,
    maxParticipants: claims.maxParticipants,
    roomUpdatedAt: claims.roomUpdatedAt,
    membershipUpdatedAt: claims.membershipUpdatedAt,
    issuedAt: new Date(claims.iat * 1000).toISOString(),
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    jti: claims.jti,
  };
}
