import { AIServiceError } from "../ai/errors.js";
import type { AIProvider, SafeProviderMetadata } from "../ai/contracts.js";
import type { AIContentPart } from "../ai/input/contracts.js";
import { shardTextContent } from "../ai/reliability.js";
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
  "Return the actual source page for every PDF event and sourceImageIndex for image events; text-only sources may leave both source locations null.",
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
        "Inspect the complete document once. Return the actual sourcePage for every event.",
        "Do not omit an event merely because it appears on a continuation page or in a visually rendered/scanned page.",
      ].join("\n"),
      operation: "extract",
      maxItems: maxCandidates,
      sourceChunkConcurrency: 3,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      reusePreparedMedia: true,
    });
    provider = result.meta;
    const candidates = result.data.items.map((item) => {
      const validPage = item.sourcePage !== null &&
        item.sourcePage >= 1 &&
        (options.sourcePageCount === null || item.sourcePage <= options.sourcePageCount);
      return validPage
        ? item
        : { ...item, warnings: [...item.warnings, "Source page is missing or outside the uploaded PDF."] };
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
  const verification: VerificationItem[] = [];
  const warnings: string[] = [];
  let providerMeta: SafeProviderMetadata = { provider: "unknown", model: "unknown" };
  for (let offset = 0; offset < candidates.length; offset += 50) {
    const batch = candidates.slice(offset, offset + 50);
    const result = await provider.generateStructured({
      contents,
      responseSchema: verificationBatchSchema,
      trustedSystemInstruction: VERIFICATION_PROMPT,
      additionalUntrustedContext: JSON.stringify({ candidates: batch }),
      operation: "extract",
      maxItems: 50,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      reusePreparedMedia: true,
    });
    providerMeta = result.meta;
    verification.push(...result.data.items);
    warnings.push(...result.data.warnings);
    await options.onProgress?.(Math.min(candidates.length, offset + batch.length), candidates.length);
  }
  return {
    items: verification,
    warnings: [...new Set(warnings)].slice(0, 50),
    provider: providerMeta,
  };
}