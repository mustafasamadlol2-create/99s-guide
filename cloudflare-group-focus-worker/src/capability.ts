import {
  GROUP_FOCUS_CAPABILITY_ALGORITHM,
  GROUP_FOCUS_CAPABILITY_MAX_TOKEN_BYTES,
  GROUP_FOCUS_CAPABILITY_TYP,
  parseGroupFocusCapabilityClaims,
  type GroupFocusCapabilityClaims,
  type VerifiedGroupFocusCapability,
} from "../../shared/group-focus-capability/contract.js";
import { decodeBase64Url } from "../../shared/group-focus-capability/encoding.js";
import {
  GroupFocusCapabilityConfigurationError,
  parseGroupFocusCapabilityKeyring,
} from "../../shared/group-focus-capability/keyring.js";

export type GroupFocusCapabilityWorkerEnvironment = {
  GROUP_FOCUS_CAPABILITY_KEYS_JSON?: string;
};

export class GroupFocusCapabilityVerificationError extends Error {
  readonly code = "INVALID_CAPABILITY";

  constructor() {
    super("Group Focus capability is invalid.");
    this.name = "GroupFocusCapabilityVerificationError";
  }
}

export class GroupFocusCapabilityUnauthorizedError extends Error {
  readonly status = 401;

  constructor() {
    super("Unauthorized.");
    this.name = "GroupFocusCapabilityUnauthorizedError";
  }
}

function invalidCapability(): never {
  throw new GroupFocusCapabilityVerificationError();
}

function decodeJsonSegment(segment: string): unknown {
  const bytes = decodeBase64Url(segment);
  if (!bytes) return invalidCapability();
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return invalidCapability();
  }
}

function hasExactHeaderKeys(value: Record<string, unknown>): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === 3
    && actual[0] === "alg"
    && actual[1] === "kid"
    && actual[2] === "typ";
}

function normalizedClaims(claims: GroupFocusCapabilityClaims): VerifiedGroupFocusCapability {
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

export async function verifyGroupFocusCapability(
  token: string,
  environment: GroupFocusCapabilityWorkerEnvironment,
  now: Date = new Date(),
): Promise<VerifiedGroupFocusCapability> {
  let keyring: ReadonlyMap<string, Uint8Array>;
  try {
    keyring = parseGroupFocusCapabilityKeyring(
      environment.GROUP_FOCUS_CAPABILITY_KEYS_JSON,
    );
  } catch (error) {
    if (error instanceof GroupFocusCapabilityConfigurationError) throw error;
    throw new GroupFocusCapabilityConfigurationError();
  }

  if (typeof token !== "string" || token.length === 0 || token.length > GROUP_FOCUS_CAPABILITY_MAX_TOKEN_BYTES) {
    return invalidCapability();
  }
  const segments = token.split(".");
  if (segments.length !== 3 || segments.some((segment) => segment.length === 0)) {
    return invalidCapability();
  }
  const [headerSegment, payloadSegment, signatureSegment] = segments;
  const header = decodeJsonSegment(headerSegment);
  const payload = decodeJsonSegment(payloadSegment);
  if (
    typeof header !== "object"
    || header === null
    || Array.isArray(header)
    || !hasExactHeaderKeys(header as Record<string, unknown>)
  ) {
    return invalidCapability();
  }

  const headerRecord = header as Record<string, unknown>;
  if (
    headerRecord.alg !== GROUP_FOCUS_CAPABILITY_ALGORITHM
    || headerRecord.typ !== GROUP_FOCUS_CAPABILITY_TYP
    || typeof headerRecord.kid !== "string"
  ) {
    return invalidCapability();
  }
  const key = keyring.get(headerRecord.kid);
  const signature = decodeBase64Url(signatureSegment);
  if (!key || !signature || signature.byteLength !== 32) return invalidCapability();

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new GroupFocusCapabilityConfigurationError();
  let validSignature: boolean;
  try {
    const cryptoKey = await subtle.importKey(
      "raw",
      key,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    validSignature = await subtle.verify(
      "HMAC",
      cryptoKey,
      signature,
      new TextEncoder().encode(`${headerSegment}.${payloadSegment}`),
    );
  } catch {
    throw new GroupFocusCapabilityConfigurationError();
  }
  if (!validSignature) return invalidCapability();

  const claims = parseGroupFocusCapabilityClaims(payload, now);
  if (!claims) return invalidCapability();
  return normalizedClaims(claims);
}

export async function requireGroupFocusCapability(
  request: Request,
  environment: GroupFocusCapabilityWorkerEnvironment,
  now: Date = new Date(),
): Promise<VerifiedGroupFocusCapability> {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(
    /^\s*Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s*$/iu,
  );
  if (!match?.[1]) throw new GroupFocusCapabilityUnauthorizedError();
  try {
    return await verifyGroupFocusCapability(match[1], environment, now);
  } catch (error) {
    if (error instanceof GroupFocusCapabilityConfigurationError) throw error;
    throw new GroupFocusCapabilityUnauthorizedError();
  }
}