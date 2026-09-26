import assert from "node:assert/strict";
import test from "node:test";
import { mintRecallInteractionToken, verifyRecallInteractionToken } from "../server/features/recall/interactionToken.js";

const now = new Date("2026-09-26T12:00:00.000Z");
const expires = new Date(now.getTime() + 30 * 60_000);

test("Recall interaction tokens bind user, attempt, and bounded expiry", () => {
  const old = {
    keys: process.env.RECALL_INTERACTION_TOKEN_KEYS_JSON,
    kid: process.env.RECALL_INTERACTION_TOKEN_ACTIVE_KID,
  };
  process.env.RECALL_INTERACTION_TOKEN_KEYS_JSON = JSON.stringify({ test: Buffer.alloc(32, 7).toString("base64url") });
  process.env.RECALL_INTERACTION_TOKEN_ACTIVE_KID = "test";
  try {
    const token = mintRecallInteractionToken("user-1", "attempt-1", expires, now);
    assert.doesNotThrow(() => verifyRecallInteractionToken(token, "user-1", "attempt-1", now));
    assert.throws(() => verifyRecallInteractionToken(token, "user-2", "attempt-1", now), { code: "RECALL_TOKEN_INVALID" });
    assert.throws(() => verifyRecallInteractionToken(token, "user-1", "attempt-1", new Date(expires.getTime() + 31_000)), { code: "RECALL_TOKEN_INVALID" });
  } finally {
    if (old.keys === undefined) delete process.env.RECALL_INTERACTION_TOKEN_KEYS_JSON;
    else process.env.RECALL_INTERACTION_TOKEN_KEYS_JSON = old.keys;
    if (old.kid === undefined) delete process.env.RECALL_INTERACTION_TOKEN_ACTIVE_KID;
    else process.env.RECALL_INTERACTION_TOKEN_ACTIVE_KID = old.kid;
  }
});

test("Recall interaction tokens reject malformed and modified values", () => {
  const old = {
    keys: process.env.RECALL_INTERACTION_TOKEN_KEYS_JSON,
    kid: process.env.RECALL_INTERACTION_TOKEN_ACTIVE_KID,
  };
  process.env.RECALL_INTERACTION_TOKEN_KEYS_JSON = JSON.stringify({
    test: Buffer.alloc(32, 9).toString("base64url"),
  });
  process.env.RECALL_INTERACTION_TOKEN_ACTIVE_KID = "test";
  try {
    const token = mintRecallInteractionToken("user-1", "attempt-1", expires, now);
    const [header, payload, signature] = token.split(".");
    assert.ok(header && payload && signature);

    const malformedHeader = `${Buffer.from("null").toString("base64url")}.${payload}.${signature}`;
    assert.throws(
      () => verifyRecallInteractionToken(malformedHeader, "user-1", "attempt-1", now),
      { code: "RECALL_TOKEN_INVALID" },
    );

    const last = signature.slice(-1);
    const modifiedSignature = `${header}.${payload}.${signature.slice(0, -1)}${last === "A" ? "B" : "A"}`;
    assert.throws(
      () => verifyRecallInteractionToken(modifiedSignature, "user-1", "attempt-1", now),
      { code: "RECALL_TOKEN_INVALID" },
    );
  } finally {
    if (old.keys === undefined) delete process.env.RECALL_INTERACTION_TOKEN_KEYS_JSON;
    else process.env.RECALL_INTERACTION_TOKEN_KEYS_JSON = old.keys;
    if (old.kid === undefined) delete process.env.RECALL_INTERACTION_TOKEN_ACTIVE_KID;
    else process.env.RECALL_INTERACTION_TOKEN_ACTIVE_KID = old.kid;
  }
});

test("Recall token issuance fails closed without a configured key ring", () => {
  const old = {
    keys: process.env.RECALL_INTERACTION_TOKEN_KEYS_JSON,
    kid: process.env.RECALL_INTERACTION_TOKEN_ACTIVE_KID,
  };
  delete process.env.RECALL_INTERACTION_TOKEN_KEYS_JSON;
  delete process.env.RECALL_INTERACTION_TOKEN_ACTIVE_KID;
  try {
    assert.throws(
      () => mintRecallInteractionToken("user-1", "attempt-1", expires, now),
      { code: "RECALL_TOKEN_CONFIG_INVALID" },
    );
  } finally {
    if (old.keys !== undefined) process.env.RECALL_INTERACTION_TOKEN_KEYS_JSON = old.keys;
    if (old.kid !== undefined) process.env.RECALL_INTERACTION_TOKEN_ACTIVE_KID = old.kid;
  }
});