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

function ranges(total: number): Array<{ start: number; end: number }> {
  const result: Array<{ start: number; end: number }> = [];
  for (let start = 1; start <= total; start += 3) result.push({ start, end: Math.min(total, start + 2) });
  return result.length > 0 ? result : [{ start: 1, end: 1 }];
}

export async function extractSchedule(options: ScheduleExtractionOptions): Promise<ScheduleExtractionResult> {
  const maxCandidates = options.maxCandidates ?? 500;
  const pdfRanges = options.inputKind === "pdf" ? ranges(options.sourcePageCount ?? 1) : [];
  const textWindows = options.inputKind === "text" ? shardTextContent(options.contents, 24_000) : [];
  const totalUnits = options.inputKind === "pdf"
    ? pdfRanges.length
    : options.inputKind === "image"
      ? Math.max(1, Math.ceil(options.contents.length / 3))
      : Math.max(1, textWindows.length);
  const candidates: ExtractionCandidate[] = [];
  const warnings: string[] = [];
  let provider: SafeProviderMetadata = { provider: "unknown", model: "unknown" };

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

    if (options.inputKind === "pdf") {
      const pageRange = pdfRanges[unit]!;
      unitContents = options.contents;
      context = [
        `Only extract events from PDF pages ${pageRange.start}-${pageRange.end}.`,
        `The PDF has ${options.sourcePageCount ?? "an unknown number of"} pages.`,
        "Return sourcePage for every event and ignore content outside the active page range.",
      ].join("\n");
      progressLabel = `Reading page ${pageRange.start}${pageRange.end > pageRange.start ? `-${pageRange.end}` : ""}`;
    } else if (options.inputKind === "image") {
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
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      reusePreparedMedia: true,
    });
    provider = result.meta;

    const groundedItems = result.data.items.map((item) => {
      if (options.inputKind === "text") {
        return { ...item, sourcePage: null, sourceImageIndex: null };
      }
      if (options.inputKind === "pdf") {
        const pageRange = pdfRanges[unit]!;
        const inActiveRange = item.sourcePage !== null &&
          item.sourcePage >= pageRange.start && item.sourcePage <= pageRange.end;
        return inActiveRange
          ? item
          : { ...item, warnings: [...item.warnings, "Source location is outside the active extraction range."] };
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