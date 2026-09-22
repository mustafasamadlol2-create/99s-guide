import { z } from "zod";
import { AIServiceError } from "../ai/errors.js";
import type { AIProvider, SafeProviderMetadata } from "../ai/contracts.js";
import type { AIContentPart } from "../ai/input/contracts.js";
import { sha256Text } from "../ai/input/hash.js";
import { readLocalPdfLayout, readLocalPdfText, type LocalPdfTextResult } from "../ai/input/localPdfText.js";
import { runResilientBatches, shardTextContent } from "../ai/reliability.js";
import {
  parseDeterministicTimetableLayout,
  parseDeterministicTimetableTranscript,
} from "./deterministicTimetable.js";
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

const lightweightEventSchema = z.object({
  title: z.string().trim().min(1).max(240),
  eventType: z.string().trim().max(64).nullable().optional().catch(null).default(null),
  date: z.string().trim().max(64).nullable().optional().catch(null).default(null),
  startTime: z.string().trim().max(64).nullable().optional().catch(null).default(null),
  endTime: z.string().trim().max(64).nullable().optional().catch(null).default(null),
  allDay: z.boolean().catch(false).default(false),
  subjectLabelRaw: z.string().trim().max(160).nullable().optional().catch(null).default(null),
  room: z.string().trim().max(160).nullable().optional().catch(null).default(null),
  doctor: z.string().trim().max(160).nullable().optional().catch(null).default(null),
  description: z.string().trim().max(1_000).nullable().optional().catch(null).default(null),
  targetGroups: z.array(z.string().trim().max(32)).max(6).catch([]).default([]),
  sourcePage: z.number().int().positive().nullable().optional().catch(null).default(null),
  sourceImageIndex: z.number().int().nonnegative().nullable().optional().catch(null).default(null),
  sourceEvidence: z.string().trim().max(2_000).nullable().optional().catch(null).default(null),
});

const lightweightBatchSchema = z.object({
  items: z.array(lightweightEventSchema).max(500),
  warnings: z.array(z.string().trim().min(1).max(240)).max(50).catch([]).default([]),
});

type LightweightEvent = z.infer<typeof lightweightEventSchema>;

function toExtractionCandidate(item: LightweightEvent): ExtractionCandidate {
  return {
    title: item.title,
    eventType: item.eventType,
    date: item.date,
    startTime: item.startTime,
    endTime: item.endTime,
    allDay: item.allDay,
    rawDate: item.date,
    rawStartTime: item.startTime,
    rawEndTime: item.endTime,
    subjectId: null,
    subjectLabelRaw: item.subjectLabelRaw,
    room: item.room,
    doctor: item.doctor,
    description: item.description,
    targetGroups: item.targetGroups,
    sourcePage: item.sourcePage,
    sourceImageIndex: item.sourceImageIndex,
    sourceEvidence: item.sourceEvidence,
    warnings: [],
  };
}

const LIGHTWEIGHT_EXTRACTION_PROMPT = [
  "Extract every explicit calendar/schedule event from the supplied timetable or schedule source.",
  "A populated timetable cell is an event even when it is only a compact code such as ID-5 C.Med, RM-7, NT-4 Bioch, CA-S1, TBL, P1, CS, SL, FA, MME, EME, or HISTORY EXAM.",
  "For each event return a short source-faithful title, the date, start/end time when shown, event type, subject label, room/doctor when shown, target group when explicit, and a concise sourceEvidence quote.",
  "Classify ordinary lectures, practicals, TBLs, sessions, skills labs, hospital visits and video lectures as LECTURE; assessments/quizzes/FA as QUIZ; explicit exams/MME/EME as EXAM.",
  "Never return an empty items array when the source visibly contains dated timetable cells. Do not invent missing values; use null and preserve the event for review.",
  "For a PDF, keep sourcePage when available. For images, keep sourceImageIndex when available.",
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

function textContentsFromPreparedText(text: string, label: string): AIContentPart[] {
  return [{
    kind: "text",
    text,
    source: { inputType: "text", section: label, label },
    sizeBytes: new TextEncoder().encode(text).byteLength,
    sha256: sha256Text(text),
  }];
}

async function preferredSourceContents(
  provider: AIProvider,
  contents: AIContentPart[],
  inputKind: "pdf" | "image" | "text",
  signal?: AbortSignal,
): Promise<{ contents: AIContentPart[]; preparedText: string | null; meta?: SafeProviderMetadata }> {
  if (inputKind === "text" || typeof provider.prepareSourceText !== "function") {
    return { contents, preparedText: inputKind === "text" && contents[0]?.kind === "text" ? contents[0].text : null };
  }
  const prepared = await provider.prepareSourceText(contents, signal);
  const text = prepared.text.trim();
  if (!text) return { contents, preparedText: null, meta: prepared.meta };
  return {
    contents: textContentsFromPreparedText(text, `Prepared ${inputKind} source text`),
    preparedText: text,
    meta: prepared.meta,
  };
}

function preserveSourceTransport(
  inference: SafeProviderMetadata,
  prepared?: SafeProviderMetadata,
): SafeProviderMetadata {
  return {
    ...inference,
    ...(prepared?.transport ? { transport: prepared.transport } : {}),
    ...(prepared?.mediaCount !== undefined ? { mediaCount: prepared.mediaCount } : {}),
  };
}

function scheduleAnchorScore(text: string): number {
  const dateCount = text.match(/(?:^|\s)\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?(?=\s|$)/gu)?.length ?? 0;
  const timeCount = text.match(/\b(?:0?8|0?9|10|11|12|0?1|0?2):[0-5]\d\b/gu)?.length ?? 0;
  const eventCodeCount = text.match(/\b(?:CA|ID|NT|RM|TBL|LGT|CS|SL|HV|FA|MME|EME|Micro|C\.?Med|Bioch|Med|Surg)\b/giu)?.length ?? 0;
  const headerCount = text.match(/\b(?:WEEK|Day\s*\/?\s*date|Sun\.?|Mon\.?|Tues?\.?|Wed\.?|Thurs?\.?)\b/giu)?.length ?? 0;
  return dateCount * 3 + timeCount * 2 + eventCodeCount + headerCount * 2;
}

function academicYearContext(local: LocalPdfTextResult): string {
  const match = local.text.match(/\b(20\d{2})\s*[-–—/]\s*(20\d{2})\b/u);
  return match ? `The academic-year header is ${match[1]}-${match[2]}.` : "";
}

function pageTextPart(page: number, text: string): AIContentPart[] {
  const labelled = `[PDF page ${page}]\n${text.trim()}`;
  return textContentsFromPreparedText(labelled, `PDF page ${page}`);
}

const TIMETABLE_PAGE_PROMPT = [
  EXTRACTION_PROMPT,
  "This is a university timetable page. A non-empty timetable cell under a day/date and time column is an event; do not require prose sentences.",
  "Recognize compact lecture/session codes such as ID-1-Med, RM-5, NT-2 Bioch, CA-S1, TBL, practical, session, skill lab, hospital visit, formative assessment and exams as real schedule entries.",
  "Use the page week/date header to resolve short day/month dates to the explicit year shown on the same page or in the supplied academic-year context.",
  "Use the time heading above each cell for startTime/endTime. For a merged practical/session block such as 08:00-11:00 or 09:00-12:00, preserve that full block.",
  "Target groups in this app are A-E or ALL. Do not treat lecture-room column numbers such as 1-4 as target groups. If an A-E/ALL group cannot be established safely, leave targetGroups empty so the user's selected default groups can be applied instead of omitting the event.",
  "Return sourcePage for every event from this page. It is better to return a source-supported NEEDS-REVIEW candidate with a nullable field than to drop a visible timetable event.",
].join(" ");

async function extractPdfPagesLocally(
  options: ScheduleExtractionOptions,
  local: LocalPdfTextResult,
  maxCandidates: number,
): Promise<ScheduleExtractionResult | null> {
  const usablePages = local.profiles.filter((profile) => profile.text.trim().length >= 30);
  if (!usablePages.length || scheduleAnchorScore(local.text) < 12) return null;

  const warnings: string[] = [];
  const failedPages = new Set<number>();
  const zeroPages = new Set<number>();
  let provider: SafeProviderMetadata = { provider: "unknown", model: "unknown" };
  const yearContext = academicYearContext(local);
  let completed = 0;

  const firstPass = await runResilientBatches({
    total: usablePages.length,
    batchSize: 1,
    minimumBatchSize: 1,
    concurrency: 4,
    signal: options.signal,
    run: async ({ start }) => {
      const profile = usablePages[start]!;
      const result = await options.provider.generateStructured({
        contents: pageTextPart(profile.page, profile.text),
        responseSchema: extractionBatchSchema,
        trustedSystemInstruction: TIMETABLE_PAGE_PROMPT,
        additionalUntrustedContext: [
          `This is PDF page ${profile.page} of ${options.sourcePageCount ?? local.profiles.length}.`,
          yearContext,
          "Extract every source-supported timetable cell on this page. Do not return an empty items array when dated/time-slotted entries are visibly represented in the supplied page text.",
        ].filter(Boolean).join("\n"),
        operation: "extract",
        maxItems: Math.min(80, maxCandidates),
        sourceChunkConcurrency: 1,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      });
      if (!result.data.items.length && scheduleAnchorScore(profile.text) >= 8) zeroPages.add(profile.page);
      completed += 1;
      await options.onProgress?.(completed, usablePages.length, `Reading timetable page ${profile.page}`);
      return { profile, result };
    },
    onFailure: ({ start }) => {
      const page = usablePages[start]?.page;
      if (page !== undefined) failedPages.add(page);
    },
  });

  const candidates: ExtractionCandidate[] = [];
  for (const { profile, result } of firstPass) {
    provider = result.meta;
    candidates.push(...result.data.items.map((item) => ({
      ...item,
      sourcePage: profile.page,
      sourceImageIndex: null,
      sourceEvidence: item.sourceEvidence ?? profile.text.slice(0, 1_500),
    })));
    warnings.push(...result.data.warnings);
  }

  // Retry only pages that clearly look like timetable pages yet returned zero
  // candidates. This is bounded and page-local, so it is much cheaper and more
  // reliable than re-reading the full annual PDF.
  const recoveryPages = usablePages.filter((profile) => zeroPages.has(profile.page) || failedPages.has(profile.page));
  if (recoveryPages.length) {
    const recovered = await runResilientBatches({
      total: recoveryPages.length,
      batchSize: 1,
      minimumBatchSize: 1,
      concurrency: 4,
      signal: options.signal,
      run: async ({ start }) => {
        const profile = recoveryPages[start]!;
        const examples = (profile.text.match(/\b(?:CA|ID|NT|RM)[- ]?[A-Z0-9.&() -]{1,24}/giu) ?? []).slice(0, 12);
        const result = await options.provider.generateStructured({
          contents: pageTextPart(profile.page, profile.text),
          responseSchema: extractionBatchSchema,
          trustedSystemInstruction: [
            TIMETABLE_PAGE_PROMPT,
            "RECOVERY PASS: the page has timetable anchors. Reconstruct the row/column relationships and return every explicit scheduled item. Do not summarize the page and do not return zero solely because the table layout is compact.",
          ].join("\n\n"),
          additionalUntrustedContext: [
            `PDF page ${profile.page}.`,
            yearContext,
            examples.length ? `Visible event-like labels include: ${examples.join(", ")}` : "",
          ].filter(Boolean).join("\n"),
          operation: "extract",
          maxItems: Math.min(80, maxCandidates),
          sourceChunkConcurrency: 1,
          timeoutMs: options.timeoutMs,
          signal: options.signal,
        });
        return { profile, result };
      },
      onFailure: ({ start }) => {
        const page = recoveryPages[start]?.page;
        if (page !== undefined) warnings.push(`Timetable page ${page} could not be fully extracted and may require review.`);
      },
    });
    for (const { profile, result } of recovered) {
      provider = result.meta;
      if (!result.data.items.length) continue;
      // Replace a page's empty first-pass result; for failed pages there was no
      // first-pass data to replace.
      candidates.push(...result.data.items.map((item) => ({
        ...item,
        sourcePage: profile.page,
        sourceImageIndex: null,
        sourceEvidence: item.sourceEvidence ?? profile.text.slice(0, 1_500),
      })));
      warnings.push(...result.data.warnings);
    }
  }

  const deduped = [...new Map(candidates.map((candidate) => [
    [candidate.sourcePage ?? "", candidate.date ?? candidate.rawDate ?? "", candidate.startTime ?? candidate.rawStartTime ?? "", candidate.title ?? "", candidate.room ?? "", candidate.targetGroups.join(",")].join("|"),
    candidate,
  ])).values()];

  if (!deduped.length) return null;
  if (deduped.length > maxCandidates) {
    throw new AIServiceError("AI_VALIDATION_ERROR", {
      publicMessage: "This schedule contains too many events. Split it into smaller files.",
      diagnosticMessage: `Page-local schedule extraction exceeded the ${maxCandidates}-candidate safety cap.`,
    });
  }
  if (failedPages.size) warnings.push("Some timetable pages needed bounded recovery; review their extracted events before import.");
  return {
    candidates: deduped,
    warnings: [...new Set(warnings)].slice(0, 50),
    provider,
  };
}


export async function extractSchedule(options: ScheduleExtractionOptions): Promise<ScheduleExtractionResult> {
  const maxCandidates = options.maxCandidates ?? 2_000;
  const warnings: string[] = [];
  let provider: SafeProviderMetadata = { provider: "unknown", model: "unknown" };

  if (options.inputKind === "pdf") {
    // Geometry-first fast path for real timetable PDFs. This does not depend on
    // Cloudflare deciding that a compact table cell "looks like" an event, so a
    // populated annual timetable can never silently become a successful 0-item
    // preview merely because structured inference returned items: [].
    const layoutPages = await readLocalPdfLayout(options.contents, options.signal);
    if (layoutPages?.length) {
      const deterministic = parseDeterministicTimetableLayout(layoutPages);
      if (deterministic.length >= 3) {
        if (deterministic.length > maxCandidates) {
          throw new AIServiceError("AI_VALIDATION_ERROR", {
            publicMessage: "This schedule contains more events than one import can safely review.",
            diagnosticMessage: `Deterministic timetable parsing found ${deterministic.length} events, above the ${maxCandidates}-candidate safety cap.`,
          });
        }
        await options.onProgress?.(layoutPages.length, layoutPages.length, "Timetable layout parsed");
        return {
          candidates: deterministic,
          warnings: [],
          provider: {
            provider: "local",
            model: "timetable-layout-parser-v1",
            transport: "inline",
            mediaCount: 1,
          },
        };
      }
    }
    const localPdf = await readLocalPdfText(options.contents, options.signal);
    if (localPdf && localPdf.totalTextCharacters >= 600 && scheduleAnchorScore(localPdf.text) >= 12) {
      const pageLocal = await extractPdfPagesLocally(options, localPdf, maxCandidates);
      if (pageLocal?.candidates.length) return pageLocal;
    }

    const preferred = await preferredSourceContents(options.provider, options.contents, options.inputKind, options.signal);
    await options.onProgress?.(0, 1, preferred.preparedText ? "Reading document text" : "Reading document");
    let result = await options.provider.generateStructured({
      contents: preferred.contents,
      responseSchema: lightweightBatchSchema,
      trustedSystemInstruction: LIGHTWEIGHT_EXTRACTION_PROMPT,
      additionalUntrustedContext: [
        `The PDF has ${options.sourcePageCount ?? "an unknown number of"} pages.`,
        preferred.preparedText
          ? "The supplied content is a prepared OCR/text conversion of the PDF. Extract every supported event even if stable PDF page numbers are unavailable."
          : "Inspect the complete document once. If the converted document does not expose stable page markers, return sourcePage as null rather than guessing it.",
        "Do not omit an event merely because it appears on a continuation page or in a visually rendered/scanned page.",
      ].join("\n"),
      operation: "extract",
      maxItems: maxCandidates,
      sourceChunkConcurrency: 6,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      reusePreparedMedia: true,
    });
    provider = preserveSourceTransport(result.meta, preferred.meta);
    if (!result.data.items.length && preferred.preparedText) {
      const recovery = await options.provider.generateStructured({
        contents: preferred.contents,
        responseSchema: lightweightBatchSchema,
        trustedSystemInstruction: [
          LIGHTWEIGHT_EXTRACTION_PROMPT,
          "The previous schedule extraction returned zero events. Retry the non-empty OCR/text conversion and recover every explicit event.",
          "If page provenance is unavailable, keep sourcePage null instead of failing the extraction.",
        ].join("\n\n"),
        additionalUntrustedContext: `The PDF has ${options.sourcePageCount ?? "an unknown number of"} pages. Use only the supplied OCR/text conversion.`,
        operation: "extract",
        maxItems: maxCandidates,
        sourceChunkConcurrency: 6,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        reusePreparedMedia: true,
      });
      result = recovery;
      provider = preserveSourceTransport(recovery.meta, preferred.meta);
    }
    const candidates = result.data.items.map(toExtractionCandidate).map((item) => {
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
    if (!candidates.length && localPdf && scheduleAnchorScore(localPdf.text) >= 12) {
      throw new AIServiceError("AI_EXTRACTION_INCOMPLETE", {
        publicMessage: "The timetable contains dated schedule entries, but Cloudflare could not convert them into calendar events. Please retry.",
        diagnosticMessage: "Strong local timetable anchors were detected but both page-local and converted-document extraction returned zero candidates.",
        retryable: true,
      });
    }
    await options.onProgress?.(1, 1, "Document read complete");
    return {
      candidates,
      warnings: [...new Set(warnings)].slice(0, 50),
      provider,
    };
  }

  let specializedImageText: { text: string; meta: SafeProviderMetadata } | null = null;
  const calendarImageProvider = options.provider as AIProvider & {
    prepareTimetableImageText?: (
      contents: AIContentPart[],
      signal?: AbortSignal,
    ) => Promise<{ text: string; meta: SafeProviderMetadata }>;
    normalizeTimetableTranscriptToEventLines?: (
      transcript: string,
      signal?: AbortSignal,
    ) => Promise<{ text: string; meta: SafeProviderMetadata }>;
  };
  const recoverImageTranscript = async (
    text: string,
    meta: SafeProviderMetadata | undefined,
  ): Promise<ScheduleExtractionResult | null> => {
    const direct = parseDeterministicTimetableTranscript(text, { sourceImageIndex: 0 });
    if (direct.length >= 1) {
      return {
        candidates: direct,
        warnings: [...new Set(warnings)].slice(0, 50),
        provider: {
          provider: "local",
          model: "timetable-image-parser-v2",
          ...(meta?.transport ? { transport: meta.transport } : { transport: "inline" }),
          ...(meta?.mediaCount !== undefined ? { mediaCount: meta.mediaCount } : {}),
        },
      };
    }
    if (typeof calendarImageProvider.normalizeTimetableTranscriptToEventLines !== "function") return null;
    try {
      const normalized = await calendarImageProvider.normalizeTimetableTranscriptToEventLines(text, options.signal);
      const recovered = parseDeterministicTimetableTranscript(normalized.text, { sourceImageIndex: 0 });
      if (!recovered.length) return null;
      warnings.push("The timetable image needed a bounded text-layout recovery pass.");
      return {
        candidates: recovered,
        warnings: [...new Set(warnings)].slice(0, 50),
        provider: {
          provider: "local",
          model: "timetable-image-event-lines-v2",
          ...(normalized.meta.transport ? { transport: normalized.meta.transport } : { transport: "inline" }),
        },
      };
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason ?? error;
      warnings.push("Timetable image text needed the final structured recovery path.");
      return null;
    }
  };

  if (options.inputKind === "image" && typeof calendarImageProvider.prepareTimetableImageText === "function") {
    try {
      await options.onProgress?.(1, 4, "Reading timetable image");
      specializedImageText = await calendarImageProvider.prepareTimetableImageText(options.contents, options.signal);
      await options.onProgress?.(2, 4, "Interpreting timetable image");
      const recovered = await recoverImageTranscript(specializedImageText.text, specializedImageText.meta);
      if (recovered) {
        await options.onProgress?.(4, 4, "Schedule image parsed");
        return recovered;
      }
      await options.onProgress?.(3, 4, "Recovering timetable rows");
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason ?? error;
      // The timetable image path already tried both Cloudflare Vision and the
      // independent image-to-Markdown endpoint. Re-running the generic media
      // converter would repeat the same slow calls and was the source of the
      // apparent endless 0% spinner.
      throw error;
    }
  }

  const preferred = specializedImageText
    ? {
      contents: textContentsFromPreparedText(specializedImageText.text, "Prepared timetable image source"),
      preparedText: specializedImageText.text,
      meta: specializedImageText.meta,
    }
    : await preferredSourceContents(options.provider, options.contents, options.inputKind, options.signal);
  if (options.inputKind === "image" && preferred.preparedText) {
    const recovered = await recoverImageTranscript(preferred.preparedText, preferred.meta);
    if (recovered) {
      await options.onProgress?.(1, 1, "Schedule image parsed");
      return recovered;
    }
  }
  const effectiveContents = preferred.contents;
  const textWindows = options.inputKind === "text" ? shardTextContent(effectiveContents, 24_000) : [];
  const totalUnits = options.inputKind === "image"
    ? Math.max(1, Math.ceil(effectiveContents.length / 3))
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
      const end = Math.min(effectiveContents.length, start + 3);
      unitContents = effectiveContents.slice(start, end);
      context = preferred.preparedText
        ? [
          `Only extract events from prepared source segment ${unit + 1} of ${totalUnits}.`,
          "This content was prepared from uploaded schedule images. If an exact image index is unavailable, return sourceImageIndex as null and preserve sourceEvidence.",
        ].join("\n")
        : [
          `Only extract events from uploaded source image indexes ${start}-${end - 1}.`,
          "Return sourceImageIndex using the original uploaded image index stored in the source metadata.",
        ].join("\n");
      progressLabel = `Reading image ${start + 1}${end > start + 1 ? `-${end}` : ""}`;
    } else {
      unitContents = textWindows[unit] ?? effectiveContents;
      context = [
        `Only extract events explicitly present in pasted text segment ${unit + 1} of ${totalUnits}.`,
        "This is a text-only source, so sourcePage and sourceImageIndex must be null. Preserve a concise sourceEvidence quote for grounding.",
      ].join("\n");
      progressLabel = `Reading text segment ${unit + 1}/${totalUnits}`;
    }

    let result = await options.provider.generateStructured({
      contents: unitContents,
      responseSchema: lightweightBatchSchema,
      trustedSystemInstruction: LIGHTWEIGHT_EXTRACTION_PROMPT,
      additionalUntrustedContext: context,
      operation: "extract",
      maxItems: Math.min(100, maxCandidates - candidates.length),
      sourceChunkConcurrency: 3,
      timeoutMs: options.inputKind === "image" ? Math.min(options.timeoutMs ?? 30_000, 30_000) : options.timeoutMs,
      signal: options.signal,
      reusePreparedMedia: true,
    });
    if (!result.data.items.length && options.inputKind !== "image") {
      const recovery = await options.provider.generateStructured({
        contents: unitContents,
        responseSchema: lightweightBatchSchema,
        trustedSystemInstruction: [
          LIGHTWEIGHT_EXTRACTION_PROMPT,
          "RECOVERY PASS: the uploaded source is non-empty. Re-read all visible date/day/time labels and every populated timetable cell in this source unit. Return the events instead of an empty list.",
        ].join("\n\n"),
        additionalUntrustedContext: context,
        operation: "extract",
        maxItems: Math.min(150, maxCandidates - candidates.length),
        sourceChunkConcurrency: 1,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        reusePreparedMedia: true,
      });
      result = recovery;
    }
    provider = preserveSourceTransport(result.meta, preferred.meta);

    const groundedItems = result.data.items.map(toExtractionCandidate).map((item) => {
      if (options.inputKind === "text") {
        return { ...item, sourcePage: null, sourceImageIndex: null };
      }
      if (preferred.preparedText) {
        return { ...item, sourceImageIndex: item.sourceImageIndex ?? null };
      }
      const start = unit * 3;
      const end = Math.min(effectiveContents.length, start + 3);
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
    await options.onProgress?.(
      options.inputKind === "image" ? 4 : unit + 1,
      options.inputKind === "image" ? 4 : totalUnits,
      options.inputKind === "image" ? "Schedule image parsed" : progressLabel,
    );
  }

  if (!candidates.length && effectiveContents.length > 0) {
    throw new AIServiceError("AI_EXTRACTION_INCOMPLETE", {
      publicMessage: "The uploaded schedule is readable, but no calendar events were recovered. Please retry.",
      diagnosticMessage: "Non-empty image/text schedule source produced zero events after primary and recovery extraction passes.",
      retryable: true,
    });
  }
  return {
    candidates,
    warnings: [...new Set(warnings)].slice(0, 50),
    provider: provider.provider === "unknown" ? preferred.meta ?? provider : provider,
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
      const candidateContext = JSON.stringify({ candidates: candidateBatch });
      const result = await provider.generateStructured({
        // Every extracted candidate already carries page/source evidence. Do not
        // re-read the complete PDF for each verification batch: that previously
        // multiplied Markdown/OCR latency after extraction had already succeeded.
        contents: textContentsFromPreparedText(candidateContext, "Calendar candidate source-evidence verification"),
        responseSchema: verificationBatchSchema,
        trustedSystemInstruction: [
          VERIFICATION_PROMPT,
          "The candidate records below include the sourcePage/sourceEvidence captured during extraction. Verify only against that supplied evidence; never invent missing source facts.",
        ].join("\n\n"),
        operation: "enhance",
        sourceWindowIndex: Math.floor(batch.start / batchSize),
        maxItems: batch.count,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
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
