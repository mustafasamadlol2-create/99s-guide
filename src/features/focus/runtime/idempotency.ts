export interface CryptoKeySource {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
}

const MAX_IDEMPOTENCY_KEY_LENGTH = 160;

export function createFocusIdempotencyKey(
  cryptoSource: CryptoKeySource | undefined = globalThis.crypto,
): string {
  if (cryptoSource?.randomUUID) {
    const key = `focus-${cryptoSource.randomUUID()}`;
    if (key.length <= MAX_IDEMPOTENCY_KEY_LENGTH) return key;
  }

  if (cryptoSource?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoSource.getRandomValues(bytes);
    const key = `focus-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    if (key.length <= MAX_IDEMPOTENCY_KEY_LENGTH) return key;
  }

  throw new Error("Secure random generation is unavailable for Focus mutations.");
}