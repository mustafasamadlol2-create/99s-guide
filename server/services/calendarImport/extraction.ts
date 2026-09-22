import { AIServiceError } from "../ai/errors.js";
import type { AIProvider, SafeProviderMetadata } from "../ai/contracts.js";
import type { AIContentPart } from "../ai/input/contracts.js";
import { runResilientBatches, shardTextContent } from "../ai/reliability.js";
import {
  extractionBatchSchema,
  verificationBatchSchema,
  type ExtractionCandidate,
  type VerificationItem,
} from "./schemas.js";

const EXTRACTION_PROMPT = [
  "Extract only schedule events explicitly supported by the supplied source.",
  "Do not invent dates, times, titles, locations, doctors, subjects, or groups.",
  "Do not use general medical-school knowledge or fill missing information from outside the document.",
  "If a value is unclear, return null and add an ambiguity warning.",
  "Return sourcePage only when an actual PDF page marker is available; otherwise use null. Return sourceImageIndex for image events; text-only sources may leave both source locations null.",
  "Understand merged cells, shared date/day headers, morning/afternoon columns, multi-column subject blocks,",
  "multiple events in one cell, exam matrices, lecturer/room sub-lines, group-specific cells, repeated headers,",
  "footers, and continuation pages. Repeated headers and footers are not events.",
  "Do not expand an implied recurrence such as 'Every Monday' into dates.",
  "Preserve raw values alongside normalized ISO date and HH:mm values.",
].join(" ");

const VERIFICATION_PROMPT = [
  "Verify the supplied candidate events against the uploaded schedule source.",
  "This is a source verification task, not a creative extraction task.",
  "Check title, date, start/end time, all-day meaning, subject, room, doctor, target group, and source location.",
  "Do not silently rewrite a candidate. Return SOURCE_MATCH, MISMATCH, AMBIGUOUS, or NOT_FOUND with concise issues.",
  "Use only the supplied document and candidate context.",
  "For text-only sources, sourcePage/sourceImageIndex may both be null; verify against sourceEvidence and the supplied text instead.",
].join(" ");

export interface ScheduleExtractionOptions {
  provider: AIProvider;
  contents: AIContentPart[];
  sourcePageCount: number | null;
  inputKind: "pdf" | "image" | "text";
  maxCandidates?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (current: number, total: number, stage: string) => Promise<void> | void;
}

export interface ScheduleExtractionResult {
  candidates: ExtractionCandidate[];
  warnings: string[];
  provider: SafeProviderMetadata;
}


export async function extractSchedule(options: ScheduleExtractionOptions): Promise<ScheduleExtractionResult> {
  const maxCandidates = options.maxCandidates ?? 500;
  const warnings: string[] = [];
  let provider: SafeProviderMetadata = { provider: "unknown", model: "unknown" };

  // A PDF is converted once into page-labelled text/OCR by the Cloudflare
  // provider. The older implementation called inference repeatedly for 3-page
  // ranges while passing the same complete PDF every time, multiplying latency
  // and making the UI appear stuck. One provider pass can still internally split
  // the prepared page text into bounded chunks and merge all candidates.
  if (options.inputKind === "pdf") {
    await options.onProgress?.(0, 1, "Reading document");
    const result = await options.provider.generateStructured({
      contents: options.contents,
      responseSchema: extractionBatchSchema,
      trustedSystemInstruction: EXTRACTION_PROMPT,
      additionalUntrustedContext: [
        `The PDF has ${options.sourcePageCount ?? "an unknown number of"} pages.`,
        "Inspect the complete document once. If the converted document does not expose stable page markers, return sourcePage as null rather than guessing it.",
        "Do not omit an event merely because it appears on a continuation page or in a visually rendered/scanned page.",
      ].join("\n"),
      operation: "extract",
      maxItems: maxCandidates,
      sourceChunkConcurrency: 6,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      reusePreparedMedia: true,
    });
    provider = result.meta;
    const candidates = result.data.items.map((item) => {
      // Whole-document Cloudflare Markdown conversion can preserve the schedule
      // accurately without a stable PDF page number. Missing page provenance is
      // therefore allowed; only an explicitly returned out-of-range page is a
      // grounding warning.
      if (item.sourcePage === null) return item;
      const validPage = item.sourcePage >= 1 &&
        (options.sourcePageCount === null || item.sourcePage <= options.sourcePageCount);
      return validPage
        ? item
        : { ...item, warnings: [...item.warnings, "Source page is outside the uploaded PDF."] };
    });
    if (candidates.length > maxCandidates) {
      throw new AIServiceError("AI_VALIDATION_ERROR", {
        publicMessage: "This schedule contains too many events. Split it into smaller files.",
        diagnosticMessage: `Schedule extraction exceeded the ${maxCandidates}-candidate safety cap.`,
      });
    }
    warnings.push(...result.data.warnings);
    await options.onProgress?.(1, 1, "Document read complete");
    return {
      candidates,
      warnings: [...new Set(warnings)].slice(0, 50),
      provider,
    };
  }

  const textWindows = options.inputKind === "text" ? shardTextContent(options.contents, 24_000) : [];
  const totalUnits = options.inputKind === "image"
    ? Math.max(1, Math.ceil(options.contents.length / 3))
    : Math.max(1, textWindows.length);
  const candidates: ExtractionCandidate[] = [];

  for (let unit = 0; unit < totalUnits; unit += 1) {
    if (candidates.length >= maxCandidates) {
      throw new AIServiceError("AI_VALIDATION_ERROR", {
        publicMessage: "This schedule contains too many events. Split it into smaller files.",
        diagnosticMessage: `Schedule extraction reached the ${maxCandidates}-candidate safety cap before all source units were read.`,
      });
    }

    let unitContents: AIContentPart[];
    let context: string;
    let progressLabel: string;
    if (options.inputKind === "image") {
      const start = unit * 3;
      const end = Math.min(options.contents.length, start + 3);
      unitContents = options.contents.slice(start, end);
      context = [
        `Only extract events from uploaded source image indexes ${start}-${end - 1}.`,
        "Return sourceImageIndex using the original uploaded image index stored in the source metadata.",
      ].join("\n");
      progressLabel = `Reading image ${start + 1}${end > start + 1 ? `-${end}` : ""}`;
    } else {
      unitContents = textWindows[unit] ?? options.contents;
      context = [
        `Only extract events explicitly present in pasted text segment ${unit + 1} of ${totalUnits}.`,
        "This is a text-only source, so sourcePage and sourceImageIndex must be null. Preserve a concise sourceEvidence quote for grounding.",
      ].join("\n");
      progressLabel = `Reading text segment ${unit + 1}/${totalUnits}`;
    }

    const result = await options.provider.generateStructured({
      contents: unitContents,
      responseSchema: extractionBatchSchema,
      trustedSystemInstruction: EXTRACTION_PROMPT,
      additionalUntrustedContext: context,
      operation: "extract",
      maxItems: Math.min(100, maxCandidates - candidates.length),
      sourceChunkConcurrency: 3,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      reusePreparedMedia: true,
    });
    provider = result.meta;

    const groundedItems = result.data.items.map((item) => {
      if (options.inputKind === "text") {
        return { ...item, sourcePage: null, sourceImageIndex: null };
      }
      const start = unit * 3;
      const end = Math.min(options.contents.length, start + 3);
      const inActiveRange = item.sourceImageIndex !== null &&
        item.sourceImageIndex >= start && item.sourceImageIndex < end;
      return inActiveRange
        ? item
        : { ...item, warnings: [...item.warnings, "Source location is outside the active extraction range."] };
    });

    candidates.push(...groundedItems);
    warnings.push(...result.data.warnings);
    if (candidates.length > maxCandidates) {
      throw new AIServiceError("AI_VALIDATION_ERROR", {
        publicMessage: "This schedule contains too many events. Split it into smaller files.",
        diagnosticMessage: `Schedule extraction exceeded the ${maxCandidates}-candidate safety cap.`,
      });
    }
    await options.onProgress?.(unit + 1, totalUnits, progressLabel);
  }

  return {
    candidates,
    warnings: [...new Set(warnings)].slice(0, 50),
    provider,
  };
}

export async function verifySchedule(
  provider: AIProvider,
  contents: AIContentPart[],
  candidates: Array<{ candidateId: string; candidate: unknown }>,
  options: { signal?: AbortSignal; timeoutMs?: number; onProgress?: (current: number, total: number) => Promise<void> | void },
): Promise<{ items: VerificationItem[]; warnings: string[]; provider: SafeProviderMetadata }> {
  if (candidates.length === 0) {
    return {
      items: [],
      warnings: [],
      provider: { provider: "unknown", model: "unknown" },
    };
  }

  const verification: VerificationItem[] = [];
  const warnings: string[] = [];
  const failedRanges: Array<{ start: number; count: number }> = [];
  let providerMeta: SafeProviderMetadata = { provider: "unknown", model: "unknown" };
  let completed = 0;
  const batchSize = 20;

  const results = await runResilientBatches({
    total: candidates.length,
    batchSize,
    minimumBatchSize: 5,
    concurrency: 4,
    signal: options.signal,
    run: async (batch) => {
      const candidateBatch = candidates.slice(batch.start, batch.start + batch.count);
      const result = await provider.generateStructured({
        contents,
        responseSchema: verificationBatchSchema,
        trustedSystemInstruction: VERIFICATION_PROMPT,
        additionalUntrustedContext: JSON.stringify({ candidates: candidateBatch }),
        // Verification is candidate-local and extraction order follows source
        // order. Use one rotating source window instead of re-reading the whole
        // annual PDF for every verification batch.
        operation: "enhance",
        sourceWindowIndex: Math.floor(batch.start / batchSize),
        maxItems: batch.count,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        reusePreparedMedia: true,
      });
      completed += batch.count;
      await options.onProgress?.(Math.min(candidates.length, completed), candidates.length);
      return { batch, result };
    },
    onFailure: (batch) => {
      failedRanges.push(batch);
    },
  });

  for (const { result } of results) {
    providerMeta = result.meta;
    verification.push(...result.data.items);
    warnings.push(...result.data.warnings);
  }

  // Verification is a safety layer after extraction, not a reason to destroy an
  // otherwise reviewable import. If one tiny verifier range still fails after
  // bounded split recovery, keep those candidates as AMBIGUOUS for human review.
  for (const range of failedRanges) {
    for (const entry of candidates.slice(range.start, range.start + range.count)) {
      verification.push({
        candidateId: entry.candidateId,
        status: "AMBIGUOUS",
        issues: ["Automated source verification could not complete for this item; review it before importing."],
      });
    }
    warnings.push("Some schedule items require manual review because automated source verification could not complete.");
  }

  const byId = new Map(verification.map((item) => [item.candidateId, item]));
  const ordered = candidates.map((entry) => byId.get(entry.candidateId) ?? ({
    candidateId: entry.candidateId,
    status: "AMBIGUOUS" as const,
    issues: ["Automated source verification did not return this item; review it before importing."],
  }));

  return {
    items: ordered,
    warnings: [...new Set(warnings)].slice(0, 50),
    provider: providerMeta,
  };
}
