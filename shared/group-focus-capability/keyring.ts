import {
  GROUP_FOCUS_CAPABILITY_MAX_KEYS,
  GROUP_FOCUS_CAPABILITY_MAX_KEY_BYTES,
  GROUP_FOCUS_CAPABILITY_MIN_KEY_BYTES,
  isPlainRecord,
} from "./contract.js";
import { decodeBase64Url } from "./encoding.js";

export type GroupFocusCapabilityEnvironment = {
  GROUP_FOCUS_CAPABILITY_KEYS_JSON?: string;
  GROUP_FOCUS_CAPABILITY_ACTIVE_KID?: string;
};

export type ActiveGroupFocusCapabilityKey = {
  kid: string;
  bytes: Uint8Array;
};

const MAX_KEYRING_JSON_LENGTH = 16_384;
const KID_PATTERN = /^[A-Za-z0-9._-]{1,32}$/u;

export class GroupFocusCapabilityConfigurationError extends Error {
  readonly code = "CAPABILITY_CONFIGURATION_UNAVAILABLE";
  readonly status = 503;

  constructor() {
    super("Group Focus capability configuration is unavailable.");
    this.name = "GroupFocusCapabilityConfigurationError";
  }
}

export function isValidGroupFocusCapabilityKid(value: unknown): value is string {
  return typeof value === "string" && KID_PATTERN.test(value);
}

export function parseGroupFocusCapabilityKeyring(
  keysJson: string | undefined,
): ReadonlyMap<string, Uint8Array> {
  if (
    typeof keysJson !== "string"
    || keysJson.length === 0
    || keysJson.length > MAX_KEYRING_JSON_LENGTH
  ) {
    throw new GroupFocusCapabilityConfigurationError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(keysJson) as unknown;
  } catch {
    throw new GroupFocusCapabilityConfigurationError();
  }
  if (!isPlainRecord(parsed)) {
    throw new GroupFocusCapabilityConfigurationError();
  }

  const entries = Object.entries(parsed);
  if (entries.length === 0 || entries.length > GROUP_FOCUS_CAPABILITY_MAX_KEYS) {
    throw new GroupFocusCapabilityConfigurationError();
  }

  const keys = new Map<string, Uint8Array>();
  for (const [kid, encodedSecret] of entries) {
    if (!isValidGroupFocusCapabilityKid(kid) || typeof encodedSecret !== "string") {
      throw new GroupFocusCapabilityConfigurationError();
    }
    const bytes = decodeBase64Url(encodedSecret);
    if (
      !bytes
      || bytes.byteLength < GROUP_FOCUS_CAPABILITY_MIN_KEY_BYTES
      || bytes.byteLength > GROUP_FOCUS_CAPABILITY_MAX_KEY_BYTES
    ) {
      throw new GroupFocusCapabilityConfigurationError();
    }
    keys.set(kid, bytes);
  }
  return keys;
}

export function getActiveGroupFocusCapabilityKey(
  environment: GroupFocusCapabilityEnvironment,
): ActiveGroupFocusCapabilityKey {
  const keyring = parseGroupFocusCapabilityKeyring(
    environment.GROUP_FOCUS_CAPABILITY_KEYS_JSON,
  );
  const kid = environment.GROUP_FOCUS_CAPABILITY_ACTIVE_KID;
  if (!isValidGroupFocusCapabilityKid(kid)) {
    throw new GroupFocusCapabilityConfigurationError();
  }
  const bytes = keyring.get(kid);
  if (!bytes) throw new GroupFocusCapabilityConfigurationError();
  return { kid, bytes };
}