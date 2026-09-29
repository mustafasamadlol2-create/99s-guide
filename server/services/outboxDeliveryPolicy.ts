export const OUTBOX_MAX_DELIVERY_ATTEMPTS = 8;
export const OUTBOX_RETRY_BASE_MS = 15_000;
export const OUTBOX_RETRY_CAP_MS = 300_000;

export type OutboxFailureClass =
  | "TRANSIENT"
  | "AUTH_CONFIGURATION"
  | "PERMANENT"
  | "OPERATIONAL";

export type OutboxFailureState = "RETRY" | "BLOCKED" | "POISON";

export type OutboxFailureResult = {
  state: OutboxFailureState;
  failureClass: OutboxFailureClass;
  failureCode: string;
  message: string;
};

export class OutboxDeliveryError extends Error {
  readonly failureClass: OutboxFailureClass;
  readonly failureCode: string;

  constructor(
    message: string,
    details: {
      failureClass: OutboxFailureClass;
      failureCode: string;
    },
  ) {
    super(message);
    this.name = "OutboxDeliveryError";
    this.failureClass = details.failureClass;
    this.failureCode = details.failureCode;
  }
}

const TRANSIENT_TRANSPORT_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function isTransientTransportFailure(error: unknown, depth = 0): boolean {
  if (depth > 3 || !(error instanceof Error)) return false;
  if (error.name === "AbortError" || error.name === "TimeoutError") return true;
  if (
    error instanceof TypeError &&
    /\b(?:fetch failed|network error|socket|connection reset|connect(?:ion)? timed out)\b/iu.test(error.message)
  ) {
    return true;
  }
  const code = (error as NodeJS.ErrnoException).code;
  if (typeof code === "string" && TRANSIENT_TRANSPORT_CODES.has(code)) return true;
  return isTransientTransportFailure(error.cause, depth + 1);
}

export function classifyOutboxDeliveryFailure(
  error: unknown,
  attempts: number,
): OutboxFailureResult {
  const known = error instanceof OutboxDeliveryError
    ? error
    : isTransientTransportFailure(error)
      ? new OutboxDeliveryError("Transient network or timeout failure.", {
          failureClass: "TRANSIENT",
          failureCode: "NETWORK_OR_TIMEOUT",
        })
      : new OutboxDeliveryError("Unclassified delivery failure requires operator review.", {
          failureClass: "OPERATIONAL",
          failureCode: "UNCLASSIFIED_FAILURE",
        });

  if (known.failureClass === "TRANSIENT") {
    if (attempts >= OUTBOX_MAX_DELIVERY_ATTEMPTS) {
      return {
        state: "POISON",
        failureClass: "PERMANENT",
        failureCode: "MAX_ATTEMPTS",
        message: "Maximum delivery attempts reached.",
      };
    }
    return {
      state: "RETRY",
      failureClass: "TRANSIENT",
      failureCode: known.failureCode,
      message: known.message,
    };
  }

  if (known.failureClass === "PERMANENT") {
    return {
      state: "POISON",
      failureClass: "PERMANENT",
      failureCode: known.failureCode,
      message: known.message,
    };
  }

  return {
    state: "BLOCKED",
    failureClass: known.failureClass,
    failureCode: known.failureCode,
    message: known.message,
  };
}

/**
 * Equal jitter keeps retries away from zero while spreading workers over the
 * lower half of each exponential window. Attempt 8 is capped at five minutes.
 */
export function outboxRetryDelayMs(
  attempts: number,
  random: () => number = Math.random,
): number {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError("Outbox retry attempts must be a positive integer.");
  }
  const exponentialCap = Math.min(
    OUTBOX_RETRY_CAP_MS,
    OUTBOX_RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 20),
  );
  const sample = random();
  const boundedSample = Number.isFinite(sample)
    ? Math.max(0, Math.min(1, sample))
    : 0.5;
  return Math.floor(exponentialCap * (0.5 + boundedSample * 0.5));
}