import assert from "node:assert/strict";
import test from "node:test";
import {
  GROUP_FOCUS_RECONCILIATION_KID_HEADER,
  GROUP_FOCUS_RECONCILIATION_NONCE_HEADER,
  GROUP_FOCUS_RECONCILIATION_SIGNATURE_HEADER,
  GROUP_FOCUS_RECONCILIATION_TIMESTAMP_HEADER,
  parseGroupFocusReconciliationKeyring,
  signGroupFocusMachineRequest,
  verifyGroupFocusMachineRequest,
} from "../shared/group-focus-reconciliation/signing.js";

const now = Date.parse("2026-09-25T12:00:00.000Z");
const path = "/api/internal/group-focus/runtime/snapshot";
const body = new TextEncoder().encode('{"roomId":"00000000-0000-4000-8000-000000000020"}');
const keyBytes = new Uint8Array(32).fill(0x5a);
const nonce = Buffer.from(new Uint8Array(16).fill(0x2a)).toString("base64url");
const environment = {
  GROUP_FOCUS_RECONCILIATION_KEYS_JSON: JSON.stringify({
    "prompt16-test": Buffer.from(keyBytes).toString("base64url"),
  }),
  GROUP_FOCUS_RECONCILIATION_ACTIVE_KID: "prompt16-test",
};

function headersFor(signed: {
  kid: string;
  timestamp: string;
  nonce: string;
  signature: string;
}): Headers {
  return new Headers({
    [GROUP_FOCUS_RECONCILIATION_KID_HEADER]: signed.kid,
    [GROUP_FOCUS_RECONCILIATION_TIMESTAMP_HEADER]: signed.timestamp,
    [GROUP_FOCUS_RECONCILIATION_NONCE_HEADER]: signed.nonce,
    [GROUP_FOCUS_RECONCILIATION_SIGNATURE_HEADER]: signed.signature,
  });
}

test("signed machine requests bind method, path, timestamp, nonce, and body", async () => {
  const signed = await signGroupFocusMachineRequest(environment, {
    method: "post",
    path,
    body,
    now,
    nonce,
  });
  const valid = await verifyGroupFocusMachineRequest(environment, {
    method: "POST",
    path,
    body,
    now,
    headers: headersFor(signed),
  });
  assert.deepEqual(valid, { ok: true, kid: "prompt16-test" });

  const changedBody = await verifyGroupFocusMachineRequest(environment, {
    method: "POST",
    path,
    body: new TextEncoder().encode('{"roomId":"changed"}'),
    now,
    headers: headersFor(signed),
  });
  assert.deepEqual(changedBody, { ok: false, code: "INVALID_MACHINE_AUTH" });

  const changedPath = await verifyGroupFocusMachineRequest(environment, {
    method: "POST",
    path: `${path}/other`,
    body,
    now,
    headers: headersFor(signed),
  });
  assert.deepEqual(changedPath, { ok: false, code: "INVALID_MACHINE_AUTH" });

  const expired = await verifyGroupFocusMachineRequest(environment, {
    method: "POST",
    path,
    body,
    now: now + 61_000,
    headers: headersFor(signed),
  });
  assert.deepEqual(expired, { ok: false, code: "INVALID_MACHINE_AUTH" });
});

test("reconciliation keyrings require at least 256 bits of key material", () => {
  assert.equal(parseGroupFocusReconciliationKeyring(
    environment.GROUP_FOCUS_RECONCILIATION_KEYS_JSON,
  ).get("prompt16-test")?.byteLength, 32);
  const shortKey = Buffer.from(new Uint8Array(31).fill(0x2a)).toString("base64url");
  assert.throws(
    () => parseGroupFocusReconciliationKeyring(JSON.stringify({ short: shortKey })),
    /not configured/,
  );
});