import type { AIContentPart } from "./input/contracts.js";
import { sha256Text } from "./input/hash.js";

export interface ReliabilityBatch {
  start: number;
  count: number;
}

/**
 * Runs bounded batches with optional, explicitly-limited concurrency.
 *
 * Why this exists instead of Promise.all():
 * - large MCQ/Flashcard jobs should not wait for N network calls serially;
 * - one failing range is still bisected without replaying healthy ranges;
 * - result ordering stays deterministic even when batches finish out of order;
 * - concurrency is hard-capped so Cloudflare is not flooded.
 */
export async function runResilientBatches<T>(options: {
  total: number;
  batchSize: number;
  minimumBatchSize?: number;
  concurrency?: number;
  signal?: AbortSignal;
  run: (batch: ReliabilityBatch) => Promise<T>;
  onFailure?: (batch: ReliabilityBatch, error: unknown) => void;
}): Promise<T[]> {
  const minimumBatchSize = options.minimumBatchSize ?? 1;
  const concurrency = options.concurrency ?? 1;
  if (!Number.isInteger(options.total) || options.total < 1 ||
    !Number.isInteger(options.batchSize) || options.batchSize < 1 ||
    !Number.isInteger(minimumBatchSize) || minimumBatchSize < 1 ||
    minimumBatchSize > options.batchSize ||
    !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error("Reliability batch sizes/concurrency must be positive bounded integers.");
  }

  const initial: ReliabilityBatch[] = [];
  for (let start = 0; start < options.total; start += options.batchSize) {
    initial.push({ start, count: Math.min(options.batchSize, options.total - start) });
  }

  const executeWithSplit = async (batch: ReliabilityBatch): Promise<T[]> => {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("The AI request was aborted.", "AbortError");
    }
    try {
      return [await options.run(batch)];
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (batch.count > minimumBatchSize) {
        const left = Math.ceil(batch.count / 2);
        // Keep split recovery sequential inside the failed parent. Healthy parent
        // ranges are already processed concurrently by the worker pool.
        return [
          ...await executeWithSplit({ start: batch.start, count: left }),
          ...await executeWithSplit({ start: batch.start + left, count: batch.count - left }),
        ];
      }
      options.onFailure?.(batch, error);
      return [];
    }
  };

  const slots: Array<T[] | undefined> = new Array(initial.length);
  let next = 0;
  const workerCount = Math.min(concurrency, initial.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      if (options.signal?.aborted) {
        throw options.signal.reason ?? new DOMException("The AI request was aborted.", "AbortError");
      }
      const index = next;
      next += 1;
      if (index >= initial.length) return;
      slots[index] = await executeWithSplit(initial[index]!);
    }
  }));

  return slots.flatMap((slot) => slot ?? []);
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
