import type { AIContentPart } from "./input/contracts.js";
import { sha256Text } from "./input/hash.js";

export interface ReliabilityBatch {
  start: number;
  count: number;
}

export async function runResilientBatches<T>(options: {
  total: number;
  batchSize: number;
  minimumBatchSize?: number;
  signal?: AbortSignal;
  run: (batch: ReliabilityBatch) => Promise<T>;
  onFailure?: (batch: ReliabilityBatch, error: unknown) => void;
}): Promise<T[]> {
  const minimumBatchSize = options.minimumBatchSize ?? 1;
  if (!Number.isInteger(options.total) || options.total < 1 ||
    !Number.isInteger(options.batchSize) || options.batchSize < 1 ||
    !Number.isInteger(minimumBatchSize) || minimumBatchSize < 1 ||
    minimumBatchSize > options.batchSize) {
    throw new Error("Reliability batch sizes must be positive integers.");
  }
  const pending: ReliabilityBatch[] = [];
  for (let start = 0; start < options.total; start += options.batchSize) {
    pending.push({ start, count: Math.min(options.batchSize, options.total - start) });
  }
  const results: T[] = [];
  while (pending.length) {
    const batch = pending.shift()!;
    try {
      results.push(await options.run(batch));
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (batch.count > minimumBatchSize) {
        const left = Math.ceil(batch.count / 2);
        pending.unshift(
          { start: batch.start, count: left },
          { start: batch.start + left, count: batch.count - left },
        );
      } else {
        options.onFailure?.(batch, error);
      }
    }
  }
  return results;
}

export function dedupeByText<T>(items: T[], getText: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getText(item).trim().replace(/\s+/gu, " ").toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function shardTextContent(
  contents: AIContentPart[],
  maxBytes = 24_000,
): AIContentPart[][] {
  const part = contents.length === 1 && contents[0]?.kind === "text" ? contents[0] : null;
  if (!part || new TextEncoder().encode(part.text).byteLength <= maxBytes) return [contents];
  const chunks: string[] = [];
  let current = "";
  for (const line of part.text.split("\n")) {
    const candidate = current ? `${current}\n${line}` : line;
    if (current && new TextEncoder().encode(candidate).byteLength > maxBytes) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks.map((text) => [{
    kind: "text" as const,
    text,
    source: part.source,
    sizeBytes: new TextEncoder().encode(text).byteLength,
    sha256: sha256Text(text),
  }]);
}