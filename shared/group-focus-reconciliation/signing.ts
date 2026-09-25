import { decodeBase64Url, encodeBase64Url } from "../group-focus-capability/encoding.js";
import {
  GROUP_FOCUS_CAPABILITY_MAX_KEY_BYTES,
  GROUP_FOCUS_CAPABILITY_MAX_KEYS,
  GROUP_FOCUS_CAPABILITY_MIN_KEY_BYTES,
  isPlainRecord,
} from "../group-focus-capability/contract.js";

export const GROUP_FOCUS_RECONCILIATION_KEYRING_ENV = "GROUP_FOCUS_RECONCILIATION_KEYS_JSON";
export const GROUP_FOCUS_RECONCILIATION_ACTIVE_KID_ENV =
  "GROUP_FOCUS_RECONCILIATION_ACTIVE_KID";
export const GROUP_FOCUS_RECONCILIATION_KID_HEADER = "X-GF-Kid";
export const GROUP_FOCUS_RECONCILIATION_TIMESTAMP_HEADER = "X-GF-Timestamp";
export const GROUP_FOCUS_RECONCILIATION_NONCE_HEADER = "X-GF-Nonce";
export const GROUP_FOCUS_RECONCILIATION_SIGNATURE_HEADER = "X-GF-Signature";
export const GROUP_FOCUS_RECONCILIATION_CLOCK_SKEW_SECONDS = 60;

const KID_PATTERN = /^[A-Za-z0-9._-]{1,32}$/u;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export type GroupFocusReconciliationEnvironment = {
  GROUP_FOCUS_RECONCILIATION_KEYS_JSON?: string;
  GROUP_FOCUS_RECONCILIATION_ACTIVE_KID?: string;
};

export class GroupFocusReconciliationConfigurationError extends Error {
  readonly code = "RECONCILIATION_NOT_CONFIGURED";

  constructor() {
    super("Group Focus reconciliation authentication is not configured.");
    this.name = "GroupFocusReconciliationConfigurationError";
  }
}

export type GroupFocusMachineHeaders = {
  kid: string;
  timestamp: string;
  nonce: string;
  signature: string;
};

export function parseGroupFocusReconciliationKeyring(
  input: string | undefined,
): ReadonlyMap<string, Uint8Array> {
  if (!input || input.length > 16_384) {
    throw new GroupFocusReconciliationConfigurationError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input) as unknown;
  } catch {
    throw new GroupFocusReconciliationConfigurationError();
  }
  if (!isPlainRecord(parsed)) throw new GroupFocusReconciliationConfigurationError();
  const entries = Object.entries(parsed);
  if (entries.length < 1 || entries.length > GROUP_FOCUS_CAPABILITY_MAX_KEYS) {
    throw new GroupFocusReconciliationConfigurationError();
  }
  const keys = new Map<string, Uint8Array>();
  for (const [kid, encoded] of entries) {
    const bytes = typeof encoded === "string" ? decodeBase64Url(encoded) : null;
    if (
      !KID_PATTERN.test(kid)
      || !bytes
      || bytes.byteLength < GROUP_FOCUS_CAPABILITY_MIN_KEY_BYTES
      || bytes.byteLength > GROUP_FOCUS_CAPABILITY_MAX_KEY_BYTES
    ) {
      throw new GroupFocusReconciliationConfigurationError();
    }
    keys.set(kid, bytes);
  }
  return keys;
}

function activeKey(
  environment: GroupFocusReconciliationEnvironment,
): { kid: string; bytes: Uint8Array } {
  const kid = environment.GROUP_FOCUS_RECONCILIATION_ACTIVE_KID;
  if (!kid || !KID_PATTERN.test(kid)) {
    throw new GroupFocusReconciliationConfigurationError();
  }
  const bytes = parseGroupFocusReconciliationKeyring(
    environment.GROUP_FOCUS_RECONCILIATION_KEYS_JSON,
  ).get(kid);
  if (!bytes) throw new GroupFocusReconciliationConfigurationError();
  return { kid, bytes };
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

async function hmac(keyBytes: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
}

export function makeGroupFocusRequestNonce(): string {
  const random = new Uint8Array(16);
  crypto.getRandomValues(random);
  return encodeBase64Url(random);
}

export async function signGroupFocusMachineRequest(
  environment: GroupFocusReconciliationEnvironment,
  input: {
    method: string;
    path: string;
    body: Uint8Array;
    now?: number;
    nonce?: string;
  },
): Promise<GroupFocusMachineHeaders> {
  const { kid, bytes } = activeKey(environment);
  const timestamp = String(Math.floor((input.now ?? Date.now()) / 1000));
  const nonce = input.nonce ?? makeGroupFocusRequestNonce();
  if (decodeBase64Url(nonce)?.byteLength !== 16) {
    throw new TypeError("Group Focus request nonce must contain exactly 128 random bits.");
  }
  const bodyHash = encodeBase64Url(await sha256(input.body));
  const canonical = [
    "gf-reconcile-v1",
    input.method.toUpperCase(),
    input.path,
    timestamp,
    nonce,
    bodyHash,
  ].join("\n");
  const signature = encodeBase64Url(await hmac(bytes, new TextEncoder().encode(canonical)));
  return { kid, timestamp, nonce, signature };
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function verifyGroupFocusMachineRequest(
  environment: GroupFocusReconciliationEnvironment,
  input: {
    method: string;
    path: string;
    body: Uint8Array;
    now?: number;
    headers: Headers;
  },
): Promise<{ ok: true; kid: string } | { ok: false; code: string }> {
  let keyring: ReadonlyMap<string, Uint8Array>;
  try {
    keyring = parseGroupFocusReconciliationKeyring(
      environment.GROUP_FOCUS_RECONCILIATION_KEYS_JSON,
    );
  } catch {
    return { ok: false, code: "RECONCILIATION_NOT_CONFIGURED" };
  }
  const kid = input.headers.get(GROUP_FOCUS_RECONCILIATION_KID_HEADER);
  const timestamp = input.headers.get(GROUP_FOCUS_RECONCILIATION_TIMESTAMP_HEADER);
  const nonce = input.headers.get(GROUP_FOCUS_RECONCILIATION_NONCE_HEADER);
  const suppliedSignature = input.headers.get(GROUP_FOCUS_RECONCILIATION_SIGNATURE_HEADER);
  if (
    !kid || !KID_PATTERN.test(kid)
    || !timestamp || !/^[0-9]{1,12}$/u.test(timestamp)
    || !nonce || decodeBase64Url(nonce)?.byteLength !== 16
    || !suppliedSignature || !SIGNATURE_PATTERN.test(suppliedSignature)
  ) return { ok: false, code: "INVALID_MACHINE_AUTH" };

  const key = keyring.get(kid);
  if (!key) return { ok: false, code: "INVALID_MACHINE_AUTH" };
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  const requestSeconds = Number(timestamp);
  if (
    !Number.isSafeInteger(requestSeconds)
    || Math.abs(nowSeconds - requestSeconds) > GROUP_FOCUS_RECONCILIATION_CLOCK_SKEW_SECONDS
  ) return { ok: false, code: "INVALID_MACHINE_AUTH" };

  const bodyHash = encodeBase64Url(await sha256(input.body));
  const canonical = [
    "gf-reconcile-v1",
    input.method.toUpperCase(),
    input.path,
    timestamp,
    nonce,
    bodyHash,
  ].join("\n");
  const expected = await hmac(key, new TextEncoder().encode(canonical));
  const supplied = decodeBase64Url(suppliedSignature);
  if (!supplied || !constantTimeEqual(expected, supplied)) {
    return { ok: false, code: "INVALID_MACHINE_AUTH" };
  }
  return { ok: true, kid };
}