import { AIServiceError } from "../ai/errors.js";
import type { AIProvider, SafeProviderMetadata } from "../ai/contracts.js";
import type { AIContentPart } from "../ai/input/contracts.js";
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
  "Return the actual source page for every PDF event and sourceImageIndex for image events.",
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
].join(" ");

export interface ScheduleExtractionOptions {
  provider: AIProvider;
  contents: AIContentPart[];
  sourcePageCount: number | null;
  inputKind: "pdf" | "image";
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
  const totalUnits = options.inputKind === "pdf"
    ? ranges(options.sourcePageCount ?? 1).length
    : Math.max(1, Math.ceil(options.contents.length / 3));
  const candidates: ExtractionCandidate[] = [];
  const warnings: string[] = [];
  let provider: SafeProviderMetadata = { provider: "unknown", model: "unknown" };

  for (let unit = 0; unit < totalUnits; unit += 1) {
    const pageRange = options.inputKind === "pdf"
      ? ranges(options.sourcePageCount ?? 1)[unit]!
      : { start: unit * 3 + 1, end: Math.min(options.contents.length, unit * 3 + 3) };
    const unitContents = options.inputKind === "image"
      ? options.contents.slice((pageRange.start - 1), pageRange.end)
      : options.contents;
    const context = [
      `Only extract events from source page range ${pageRange.start}-${pageRange.end}.`,
      options.inputKind === "image"
        ? `The source image indexes in this unit are ${pageRange.start - 1}-${pageRange.end - 1}.`
        : `The PDF has ${options.sourcePageCount ?? "an unknown number of"} pages.`,
    ].join("\n");
    const result = await options.provider.generateStructured({
      contents: unitContents,
      responseSchema: extractionBatchSchema,
      trustedSystemInstruction: EXTRACTION_PROMPT,
      additionalUntrustedContext: context,
      operation: "extract",
      maxItems: maxCandidates,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    provider = result.meta;
    const groundedItems = result.data.items.map((item) => {
      const inActiveRange = options.inputKind === "pdf"
        ? item.sourcePage !== null &&
          item.sourcePage >= pageRange.start &&
          item.sourcePage <= pageRange.end
        : item.sourceImageIndex !== null &&
          item.sourceImageIndex >= pageRange.start - 1 &&
          item.sourceImageIndex < pageRange.end;
      if (inActiveRange || (unit === 0 && item.sourcePage === null && item.sourceImageIndex === null)) {
        return item;
      }
      return {
        ...item,
        warnings: [...item.warnings, "Source location is outside the active extraction range."],
      };
    });
    candidates.push(...groundedItems);
    warnings.push(...result.data.warnings);
    if (candidates.length > maxCandidates) {
      throw new AIServiceError("AI_VALIDATION_ERROR", {
        publicMessage: "This schedule contains too many events. Split it into smaller files.",
        diagnosticMessage: `Schedule extraction exceeded the ${maxCandidates}-candidate safety cap.`,
      });
    }
    await options.onProgress?.(unit + 1, totalUnits, `Reading page ${pageRange.start}${pageRange.end > pageRange.start ? `-${pageRange.end}` : ""}`);
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
  options: { signal?: AbortSignal; timeoutMs?: number },
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
    });
    providerMeta = result.meta;
    verification.push(...result.data.items);
    warnings.push(...result.data.warnings);
  }
  return {
    items: verification,
    warnings: [...new Set(warnings)].slice(0, 50),
    provider: providerMeta,
  };
}