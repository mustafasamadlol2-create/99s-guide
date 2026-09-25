import { Buffer } from "node:buffer";

export type CanonicalJsonErrorCode =
  | "INVALID_LIMIT"
  | "UNSUPPORTED_VALUE"
  | "TOO_LARGE";

export class CanonicalJsonError extends Error {
  constructor(public readonly code: CanonicalJsonErrorCode) {
    super(`Canonical JSON failed: ${code}`);
    this.name = "CanonicalJsonError";
  }
}

export type CanonicalJsonOptions = {
  maxBytes?: number;
};

/**
 * Canonical JSON for bounded semantic payloads. Object keys are sorted by
 * code-point order, arrays retain their order, and unsupported/cyclic values
 * fail explicitly. Dates retain the Study Event helper's ISO-string meaning.
 */
export function canonicalJson(
  value: unknown,
  options: CanonicalJsonOptions = {},
): string {
  const maxBytes = options.maxBytes;
  if (
    maxBytes !== undefined &&
    (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
  ) {
    throw new CanonicalJsonError("INVALID_LIMIT");
  }

  let byteCount = 0;
  const chunks: string[] = [];
  const ancestors = new Set<object>();

  const append = (chunk: string): void => {
    byteCount += Buffer.byteLength(chunk, "utf8");
    if (maxBytes !== undefined && byteCount > maxBytes) {
      throw new CanonicalJsonError("TOO_LARGE");
    }
    chunks.push(chunk);
  };

  const visit = (current: unknown): void => {
    if (current === null) {
      append("null");
      return;
    }
    if (typeof current === "string") {
      append(JSON.stringify(current));
      return;
    }
    if (typeof current === "boolean") {
      append(current ? "true" : "false");
      return;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new CanonicalJsonError("UNSUPPORTED_VALUE");
      }
      append(JSON.stringify(current));
      return;
    }
    if (current instanceof Date) {
      if (!Number.isSafeInteger(current.getTime())) {
        throw new CanonicalJsonError("UNSUPPORTED_VALUE");
      }
      append(JSON.stringify(current.toISOString()));
      return;
    }
    if (typeof current !== "object") {
      throw new CanonicalJsonError("UNSUPPORTED_VALUE");
    }
    if (ancestors.has(current)) {
      throw new CanonicalJsonError("UNSUPPORTED_VALUE");
    }

    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        append("[");
        for (let index = 0; index < current.length; index += 1) {
          if (index > 0) append(",");
          if (!Object.hasOwn(current, index)) {
            throw new CanonicalJsonError("UNSUPPORTED_VALUE");
          }
          visit(current[index]);
        }
        append("]");
        return;
      }

      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new CanonicalJsonError("UNSUPPORTED_VALUE");
      }

      const descriptors = Object.getOwnPropertyDescriptors(current);
      const entries = Object.keys(descriptors)
        .filter((key) => descriptors[key]?.enumerable)
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

      append("{");
      entries.forEach((key, index) => {
        const descriptor = descriptors[key];
        if (!descriptor || !("value" in descriptor)) {
          throw new CanonicalJsonError("UNSUPPORTED_VALUE");
        }
        if (index > 0) append(",");
        append(JSON.stringify(key));
        append(":");
        visit(descriptor.value);
      });
      append("}");
    } finally {
      ancestors.delete(current);
    }
  };

  visit(value);
  return chunks.join("");
}