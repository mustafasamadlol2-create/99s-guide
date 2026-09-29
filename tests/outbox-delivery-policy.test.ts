import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyOutboxDeliveryFailure,
  OUTBOX_MAX_DELIVERY_ATTEMPTS,
  OutboxDeliveryError,
  outboxRetryDelayMs,
} from "../server/services/outboxDeliveryPolicy.js";

test("transient failures retry with a bounded attempt count", () => {
  const first = classifyOutboxDeliveryFailure(
    new OutboxDeliveryError("Worker returned 429.", {
      failureClass: "TRANSIENT",
      failureCode: "WORKER_HTTP_429",
    }),
    1,
  );
  assert.equal(first.state, "RETRY");
  assert.equal(first.failureClass, "TRANSIENT");

  const exhausted = classifyOutboxDeliveryFailure(
    new OutboxDeliveryError("Temporary Worker failure.", {
      failureClass: "TRANSIENT",
      failureCode: "WORKER_HTTP_503",
    }),
    OUTBOX_MAX_DELIVERY_ATTEMPTS,
  );
  assert.equal(exhausted.state, "POISON");
  assert.equal(exhausted.failureCode, "MAX_ATTEMPTS");
});

test("permanent payload errors poison and authentication/configuration errors block", () => {
  const poison = classifyOutboxDeliveryFailure(
    new OutboxDeliveryError("Invalid projection.", {
      failureClass: "PERMANENT",
      failureCode: "INVALID_PAYLOAD",
    }),
    1,
  );
  assert.equal(poison.state, "POISON");

  const blocked = classifyOutboxDeliveryFailure(
    new OutboxDeliveryError("Worker credentials are invalid.", {
      failureClass: "AUTH_CONFIGURATION",
      failureCode: "AUTH_INVALID",
    }),
    8,
  );
  assert.equal(blocked.state, "BLOCKED");
  assert.equal(blocked.failureClass, "AUTH_CONFIGURATION");
});

test("network and timeout errors retry but unclassified errors are blocked for review", () => {
  const timeout = new Error("request timed out");
  timeout.name = "AbortError";
  assert.equal(classifyOutboxDeliveryFailure(timeout, 2).state, "RETRY");
  assert.equal(classifyOutboxDeliveryFailure(new TypeError("fetch failed"), 2).state, "RETRY");
  assert.equal(classifyOutboxDeliveryFailure(new TypeError("Cannot read property of undefined"), 2).state, "BLOCKED");
  assert.equal(classifyOutboxDeliveryFailure(new Error("unexpected bug"), 2).state, "BLOCKED");
});

test("exponential backoff uses equal jitter and caps at five minutes", () => {
  assert.equal(outboxRetryDelayMs(1, () => 0), 7_500);
  assert.equal(outboxRetryDelayMs(1, () => 1), 15_000);
  assert.equal(outboxRetryDelayMs(8, () => 0), 150_000);
  assert.equal(outboxRetryDelayMs(8, () => 1), 300_000);
  assert.throws(() => outboxRetryDelayMs(0), /positive integer/u);
});