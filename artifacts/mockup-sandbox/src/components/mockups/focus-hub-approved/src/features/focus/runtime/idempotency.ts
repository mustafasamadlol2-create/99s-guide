let sequence = 0;

export function createFocusIdempotencyKey(): string {
  sequence += 1;
  return `mock-focus-${sequence}`;
}