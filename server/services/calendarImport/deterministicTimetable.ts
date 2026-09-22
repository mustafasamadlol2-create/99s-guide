import type { PDFLayoutPage, PDFLayoutTextToken } from "../ai/input/pdfVisualSource.js";
import type { ExtractionCandidate } from "./schemas.js";

interface LayoutLine {
  y: number;
  tokens: PDFLayoutTextToken[];
  text: string;
}

interface DateAnchor {
  y: number;
  rawDate: string;
  date: string;
}

interface TimeRange {
  start: string;
  end: string;
  x: number;
  y: number;
}

const DAY_PATTERN = /\b(?:Sun\.?|Mon\.?|Tues?\.?|Wed\.?|Thurs?\.?|Fri\.?|Sat\.?)\b/iu;
const DATE_PATTERN = /\b(\d{1,2})\s*[/.\-]\s*(\d{1,2})(?:\s*[/.\-]\s*(20\d{2}))?\b/u;
const TIME_RANGE_PATTERN = /\b(\d{1,2}):([0-5]\d)\s*[-–—]\s*(\d{1,2}):([0-5]\d)\b/u;
const EVENT_START_PATTERN = /^(?:Y3\b|(?:CA|ID|NT|RM|PS|VL|FA|MME|EME)\b)/iu;
const GROUP_EVENT_PATTERN = /(?:^|\s)([A-E])\s*-\s*/gu;

const SUBJECT_LABELS: Record<string, string> = {
  CA: "Clinical Attachment",
  ID: "Infectious Diseases",
  NT: "Nutrition",
  RM: "Research Methodology",
  PS: "Practicing skills",
};

function cleanText(value: string): string {
  return value
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function linesForPage(page: PDFLayoutPage): LayoutLine[] {
  const rows: LayoutLine[] = [];
  for (const token of page.tokens) {
    const text = cleanText(token.text);
    if (!text) continue;
    let row = rows.find((candidate) => Math.abs(candidate.y - token.y) <= 3.2);
    if (!row) {
      row = { y: token.y, tokens: [], text: "" };
      rows.push(row);
    }
    row.tokens.push({ ...token, text });
  }
  for (const row of rows) {
    row.tokens.sort((left, right) => left.x - right.x);
    row.text = cleanText(row.tokens.map((token) => token.text).join(" "));
  }
  return rows.sort((left, right) => left.y - right.y);
}

function academicYears(pages: PDFLayoutPage[]): { start: number; end: number } {
  const text = pages.flatMap((page) => page.tokens.map((token) => cleanText(token.text))).join(" ");
  const match = text.match(/\b(20\d{2})\s*[-–—/]\s*(20\d{2})\b/u);
  if (match) return { start: Number(match[1]), end: Number(match[2]) };
  const year = Number(text.match(/\b20\d{2}\b/u)?.[0] ?? new Date().getUTCFullYear());
  return { start: year, end: year + 1 };
}

function dateIso(day: number, month: number, explicitYear: number | null, years: { start: number; end: number }): string | null {
  const year = explicitYear ?? (month >= 8 ? years.start : years.end);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function findDateAnchors(lines: LayoutLine[], years: { start: number; end: number }): DateAnchor[] {
  const anchors: DateAnchor[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = line.text.match(DATE_PATTERN);
    if (!match) continue;
    const nearby = lines.filter((candidate) => Math.abs(candidate.y - line.y) <= 32 && candidate.tokens.some((token) => token.x < 100));
    if (!nearby.some((candidate) => DAY_PATTERN.test(candidate.text))) continue;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const explicitYear = match[3] ? Number(match[3]) : null;
    const iso = dateIso(day, month, explicitYear, years);
    if (!iso) continue;
    const dayLine = nearby.find((candidate) => DAY_PATTERN.test(candidate.text));
    anchors.push({
      y: Math.min(line.y, dayLine?.y ?? line.y),
      rawDate: `${day}/${month}${explicitYear ? `/${explicitYear}` : ""}`,
      date: iso,
    });
  }
  return [...new Map(anchors.map((anchor) => [anchor.date, anchor])).values()].sort((left, right) => left.y - right.y);
}

function hour24(hour: number, minute: number, startHour?: number): string | null {
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;
  let normalized = hour;
  if (startHour !== undefined && normalized <= startHour && normalized <= 2 && startHour >= 11) normalized += 12;
  return `${String(normalized).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseTimeRange(text: string): { start: string; end: string } | null {
  const match = cleanText(text).match(TIME_RANGE_PATTERN);
  if (!match) return null;
  let startHour = Number(match[1]);
  const startMinute = Number(match[2] ?? 0);
  let endHour = Number(match[3]);
  const endMinute = Number(match[4] ?? 0);
  // Academic timetables commonly write afternoon 1:00-2:00 without PM.
  // Treat 1-6 as afternoon in this timetable-specific parser; morning slots in
  // these sources are written as 08:00/09:00/etc.
  if (startHour >= 1 && startHour <= 6) startHour += 12;
  if (endHour >= 1 && endHour <= 6) endHour += 12;
  const start = hour24(startHour, startMinute);
  const end = hour24(endHour, endMinute, startHour);
  return start && end ? { start, end } : null;
}

function timeRangesBefore(page: PDFLayoutPage, anchorY: number): TimeRange[] {
  const candidates = page.tokens.flatMap((token): TimeRange[] => {
    if (token.y >= anchorY) return [];
    const range = parseTimeRange(token.text);
    return range ? [{ ...range, x: token.x, y: token.y }] : [];
  });
  if (!candidates.length) return [];
  const latest = Math.max(...candidates.map((candidate) => candidate.y));
  // Header times are often on two adjacent rows (e.g. 11-12 / 12-1), so keep
  // the compact header band immediately preceding the day block.
  return candidates.filter((candidate) => candidate.y >= latest - 32).sort((left, right) => left.y - right.y || left.x - right.x);
}

function eventType(title: string): string {
  if (/\b(?:MME|EME|MID\s*MODULE\s*EXAM|END\s*MODULE\s*EXAM|HISTORY\s*EXAM|EXAM)\b/iu.test(title)) return "EXAM";
  if (/\b(?:FA|FORMATIVE\s*ASSESSMENT|QUIZ)\b/iu.test(title)) return "QUIZ";
  return "LECTURE";
}

function subjectLabel(title: string): string | null {
  const match = cleanText(title).match(/^(?:[A-E]\s*-\s*)?(CA|ID|NT|RM|PS)\b/iu);
  return match ? SUBJECT_LABELS[match[1]!.toUpperCase()] ?? null : null;
}

function normalizeTitle(value: string): string {
  return cleanText(value)
    .replace(/\s+([,.;:)])/gu, "$1")
    .replace(/([(])\s+/gu, "$1")
    .slice(0, 240);
}

function candidateFromTitle(input: {
  title: string;
  anchor: DateAnchor;
  page: number;
  time?: { start: string; end: string } | null;
  group?: string | null;
  room?: string | null;
  evidence?: string;
}): ExtractionCandidate | null {
  let title = normalizeTitle(input.title.replace(/^[A-E]\s*-\s*/iu, ""));
  if (/^(?:CA|ID|NT|RM|PS|VL|FA|MME|EME)\b/iu.test(title)) {
    title = title.replace(/(?:\s+[A-E])+$/gu, "").trim();
  }
  if (!title || title.length < 2 || /^(?:Day\/?date|Date|LGT|HV)$/iu.test(title)) return null;
  const allDay = !input.time;
  return {
    title,
    eventType: eventType(title),
    date: input.anchor.date,
    startTime: input.time?.start ?? null,
    endTime: input.time?.end ?? null,
    allDay,
    rawDate: input.anchor.rawDate,
    rawStartTime: input.time?.start ?? null,
    rawEndTime: input.time?.end ?? null,
    subjectId: null,
    subjectLabelRaw: subjectLabel(title),
    room: input.room ?? null,
    doctor: null,
    description: null,
    targetGroups: input.group ? [input.group] : [],
    sourcePage: input.page,
    sourceImageIndex: null,
    sourceEvidence: cleanText(input.evidence ?? `${input.anchor.rawDate} ${input.time ? `${input.time.start}-${input.time.end}` : ""} ${title}`).slice(0, 2_000),
    warnings: allDay && eventType(title) !== "EXAM" ? ["Exact event time could not be recovered from the timetable layout; review before import."] : [],
  };
}

function textsInColumn(page: PDFLayoutPage, startY: number, endY: number, left: number, right: number): LayoutLine[] {
  const selected = page.tokens.filter((token) => token.y >= startY && token.y < endY && token.x >= left && token.x < right);
  return linesForPage({ ...page, tokens: selected });
}

function splitCellEvents(lines: LayoutLine[]): Array<{ y: number; text: string }> {
  const events: Array<{ y: number; text: string }> = [];
  let current: { y: number; text: string } | null = null;
  for (const line of lines) {
    const text = normalizeTitle(line.text);
    if (!text) continue;
    if (EVENT_START_PATTERN.test(text)) {
      if (current) events.push(current);
      current = { y: line.y, text };
    } else if (current && !DATE_PATTERN.test(text) && !DAY_PATTERN.test(text) && !TIME_RANGE_PATTERN.test(text)) {
      current.text = normalizeTitle(`${current.text} ${text}`);
    }
  }
  if (current) events.push(current);
  return events;
}

function practicalEvents(page: PDFLayoutPage, startY: number, endY: number): Array<{ group: string; title: string; y: number }> {
  const lines = textsInColumn(page, startY, endY, page.width * 0.15, page.width * 0.405);
  const flattened = lines.map((line) => ({ y: line.y, text: normalizeTitle(line.text) })).filter((line) => line.text);
  const result: Array<{ group: string; title: string; y: number }> = [];
  let current: { group: string; title: string; y: number } | null = null;
  for (const line of flattened) {
    const match = line.text.match(/^([A-E])\s*-\s*(.*)$/iu);
    if (match) {
      if (current?.title) result.push(current);
      current = { group: match[1]!.toUpperCase(), title: match[2]!.trim(), y: line.y };
    } else if (current && !DATE_PATTERN.test(line.text) && !DAY_PATTERN.test(line.text) && !TIME_RANGE_PATTERN.test(line.text)) {
      current.title = normalizeTitle(`${current.title} ${line.text}`);
    }
  }
  if (current?.title) result.push(current);
  return result;
}

function standardColumnBounds(width: number): Array<{ left: number; right: number; room: string }> {
  const centers = [0.43, 0.555, 0.68, 0.81].map((ratio) => width * ratio);
  const bounds = [width * 0.405, ...centers.slice(0, -1).map((center, index) => (center + centers[index + 1]!) / 2), width * 0.90];
  const rooms = ["Hall A", "Hall B", "Al-Kindi Hall", "Ibn Hayyan Hall"];
  return centers.map((_, index) => ({ left: bounds[index]!, right: bounds[index + 1]!, room: rooms[index]! }));
}

function firstWeekColumnBounds(width: number): Array<{ left: number; right: number; room: string | null }> {
  const centers = [0.145, 0.265, 0.395, 0.465, 0.58, 0.655, 0.74, 0.87].map((ratio) => width * ratio);
  const bounds = [width * 0.11, ...centers.slice(0, -1).map((center, index) => (center + centers[index + 1]!) / 2), width * 0.96];
  const rooms: Array<string | null> = ["Ibn Al-Nafis Hall", "Ibn Sina Hall", null, null, "Hall A", "Hall B", "Al-Kindi Hall", "Ibn Hayyan Hall"];
  return centers.map((_, index) => ({ left: bounds[index]!, right: bounds[index + 1]!, room: rooms[index]! }));
}

function isFirstWeekPage(page: PDFLayoutPage): boolean {
  const text = page.tokens.map((token) => cleanText(token.text)).join(" ");
  return /\b1(?:st)?\s*Week\b/iu.test(text) && (text.match(/\bLGT\b/giu)?.length ?? 0) >= 2;
}

function chooseTimeForEvent(
  ranges: TimeRange[],
  eventIndex: number,
  columnCenter: number,
  firstWeek: boolean,
  columnIndex: number,
): { start: string; end: string } | null {
  if (!ranges.length) return null;
  const distinctX = [...new Set(ranges.map((range) => Math.round(range.x / 12) * 12))];
  if (distinctX.length >= 4) {
    const nearest = [...ranges].sort((left, right) => Math.abs(left.x - columnCenter) - Math.abs(right.x - columnCenter))[0];
    if (nearest) return { start: nearest.start, end: nearest.end };
  }
  const orderedUnique: Array<{ start: string; end: string }> = [];
  for (const range of ranges.sort((left, right) => left.y - right.y || left.x - right.x)) {
    if (!orderedUnique.some((item) => item.start === range.start && item.end === range.end)) {
      orderedUnique.push({ start: range.start, end: range.end });
    }
  }
  if (firstWeek) {
    const xs = ranges.map((range) => range.x);
    const splitX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const sideRanges = ranges
      .filter((range) => columnIndex < 4 ? range.x < splitX : range.x >= splitX)
      .sort((left, right) => left.y - right.y);
    const sideUnique: Array<{ start: string; end: string }> = [];
    for (const range of sideRanges) {
      if (!sideUnique.some((item) => item.start === range.start && item.end === range.end)) {
        sideUnique.push({ start: range.start, end: range.end });
      }
    }
    if (sideUnique.length) return sideUnique[Math.min(sideUnique.length - 1, eventIndex)] ?? sideUnique[0] ?? null;
  }
  return orderedUnique[Math.min(orderedUnique.length - 1, eventIndex)] ?? orderedUnique[0] ?? null;
}

function parseLayoutPage(page: PDFLayoutPage, years: { start: number; end: number }): ExtractionCandidate[] {
  const lines = linesForPage(page);
  const anchors = findDateAnchors(lines, years);
  if (!anchors.length) return [];
  const firstWeek = isFirstWeekPage(page);
  const results: ExtractionCandidate[] = [];

  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index]!;
    const startY = Math.max(0, anchor.y - 20);
    const endY = index + 1 < anchors.length ? Math.max(startY + 8, anchors[index + 1]!.y - 6) : page.height * 0.86;
    const ranges = timeRangesBefore(page, anchor.y);

    if (!firstWeek) {
      const practicalRange = ranges
        .filter((range) => range.x >= page.width * 0.15 && range.x < page.width * 0.405)
        .sort((left, right) => right.y - left.y)[0] ?? null;
      for (const practical of practicalEvents(page, startY, endY)) {
        const candidate = candidateFromTitle({
          title: practical.title,
          anchor,
          page: page.page,
          time: practicalRange ? { start: practicalRange.start, end: practicalRange.end } : null,
          group: practical.group,
          evidence: `${anchor.rawDate} ${practical.group}-${practical.title}`,
        });
        if (candidate) results.push(candidate);
      }
    }

    const rightLines = textsInColumn(page, startY, endY, page.width * 0.405, page.width * 0.96);
    const wideExamLines = rightLines.filter((line) => /\b(?:exam|MME|EME)\b/iu.test(line.text) && EVENT_START_PATTERN.test(line.text));
    for (const line of wideExamLines) {
      const candidate = candidateFromTitle({
        title: line.text,
        anchor,
        page: page.page,
        time: null,
        evidence: `${anchor.rawDate} ${line.text}`,
      });
      if (candidate) results.push({ ...candidate, eventType: "EXAM", warnings: [] });
    }

    const columns = firstWeek ? firstWeekColumnBounds(page.width) : standardColumnBounds(page.width);
    const lectureRanges = firstWeek ? ranges : ranges.filter((range) => range.x >= page.width * 0.405);
    columns.forEach((column, columnIndex) => {
      const cellEvents = splitCellEvents(textsInColumn(page, startY, endY, column.left, column.right))
        .filter((event) => !wideExamLines.some((line) => Math.abs(line.y - event.y) <= 5));
      cellEvents.forEach((event, eventIndex) => {
        const center = (column.left + column.right) / 2;
        const time = chooseTimeForEvent(lectureRanges, eventIndex, center, firstWeek, columnIndex);
        const candidate = candidateFromTitle({
          title: event.text,
          anchor,
          page: page.page,
          time,
          room: column.room,
          evidence: `${anchor.rawDate} ${time ? `${time.start}-${time.end}` : ""} ${event.text}`,
        });
        if (candidate) results.push(candidate);
      });
    });
  }
  return results;
}

function dedupe(items: ExtractionCandidate[]): ExtractionCandidate[] {
  return [...new Map(items.map((item) => [[
    item.sourcePage ?? "",
    item.date ?? item.rawDate ?? "",
    item.startTime ?? item.rawStartTime ?? "",
    item.endTime ?? item.rawEndTime ?? "",
    item.title ?? "",
    item.room ?? "",
    item.targetGroups.join(","),
  ].join("|"), item])).values()];
}

/**
 * Deterministic geometry-aware parser for academic timetable PDFs. It is
 * intentionally conservative: when a date/time cannot be recovered it keeps a
 * reviewable all-day candidate rather than inventing a clock time.
 */
export function parseDeterministicTimetableLayout(pages: PDFLayoutPage[]): ExtractionCandidate[] {
  if (!pages.length) return [];
  const years = academicYears(pages);
  return dedupe(pages.flatMap((page) => parseLayoutPage(page, years)));
}

function academicYearsFromText(text: string): { start: number; end: number } {
  const match = cleanText(text).match(/\b(20\d{2})\s*[-–—/]\s*(20\d{2})\b/u);
  if (match) return { start: Number(match[1]), end: Number(match[2]) };
  const year = Number(cleanText(text).match(/\b20\d{2}\b/u)?.[0] ?? new Date().getUTCFullYear());
  return { start: year, end: year + 1 };
}

function transcriptEventSegments(line: string): Array<{ group: string | null; title: string }> {
  const normalized = cleanText(line);
  const marker = /(?:^|\s)((?:[A-E]\s*-\s*)?(?:Y3\b|(?:CA|ID|NT|RM|PS|VL|FA|MME|EME)\b))/giu;
  const starts: Array<{ index: number; group: string | null }> = [];
  for (const match of normalized.matchAll(marker)) {
    const raw = match[1] ?? "";
    const group = raw.match(/^([A-E])\s*-/iu)?.[1]?.toUpperCase() ?? null;
    starts.push({ index: match.index ?? 0, group });
  }
  const output: Array<{ group: string | null; title: string }> = [];
  for (let index = 0; index < starts.length; index += 1) {
    const current = starts[index]!;
    const end = starts[index + 1]?.index ?? normalized.length;
    const rawTitle = normalizeTitle(normalized.slice(current.index, end));
    const title = normalizeTitle(rawTitle.replace(/^[A-E]\s*-\s*/iu, ""));
    if (title && EVENT_START_PATTERN.test(title)) output.push({ group: current.group, title });
  }
  return output;
}

/**
 * Conservative fallback for OCR/Markdown transcripts of schedule images. It is
 * used only when the transcript contains explicit dates plus multiple timetable
 * codes; uncertain times stay reviewable instead of being invented.
 */
function parseVisionEventTranscript(
  lines: string[],
  years: { start: number; end: number },
  defaultImageIndex: number,
): ExtractionCandidate[] {
  const items: ExtractionCandidate[] = [];
  let currentImageIndex = defaultImageIndex;
  for (const line of lines) {
    const imageMarker = line.match(/^\[Image\s+(\d+)\]$/iu);
    if (imageMarker) {
      currentImageIndex = Math.max(0, Number(imageMarker[1]) - 1);
      continue;
    }
    if (!/^EVENT\|/iu.test(line)) continue;
    const fields = new Map<string, string>();
    for (const segment of line.split("|").slice(1)) {
      const separator = segment.indexOf("=");
      if (separator <= 0) continue;
      fields.set(segment.slice(0, separator).trim().toLowerCase(), segment.slice(separator + 1).trim());
    }
    const rawDate = fields.get("date") ?? "";
    const dateMatch = rawDate.match(DATE_PATTERN);
    const title = normalizeTitle(fields.get("title") ?? "");
    if (!dateMatch || !title) continue;
    const day = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const explicitYear = dateMatch[3] ? Number(dateMatch[3]) : null;
    const iso = dateIso(day, month, explicitYear, years);
    if (!iso) continue;
    const time = parseTimeRange(fields.get("time") ?? "");
    const rawGroup = (fields.get("group") ?? "").toUpperCase();
    const group = /^(?:[A-E]|ALL)$/u.test(rawGroup) ? rawGroup : null;
    const anchor: DateAnchor = { y: 0, rawDate, date: iso };
    const candidate = candidateFromTitle({
      title,
      anchor,
      page: 1,
      time,
      group,
      room: fields.get("room") || null,
      evidence: line,
    });
    if (!candidate) continue;
    candidate.sourcePage = null;
    candidate.sourceImageIndex = currentImageIndex;
    items.push(candidate);
  }
  return dedupe(items);
}

export function parseDeterministicTimetableTranscript(
  text: string,
  options: { sourceImageIndex?: number | null } = {},
): ExtractionCandidate[] {
  const normalized = text.replace(/\r/gu, "");
  const lines = normalized.split(/\n+/u).map(cleanText).filter(Boolean);
  const years = academicYearsFromText(normalized);
  const structuredVisionItems = parseVisionEventTranscript(lines, years, options.sourceImageIndex ?? 0);
  if (structuredVisionItems.length >= 1) return structuredVisionItems;

  const dateHits = lines.filter((line) => !/\bWEEK\b/iu.test(line) && DATE_PATTERN.test(line)).length;
  const codeHits = normalized.match(/\b(?:CA|ID|NT|RM|PS|VL|FA|MME|EME)\b/giu)?.length ?? 0;
  if (dateHits < 1 || codeHits < 3) return [];

  const items: ExtractionCandidate[] = [];
  let currentDate: DateAnchor | null = null;
  let currentTime: { start: string; end: string } | null = null;
  let currentImageIndex = options.sourceImageIndex ?? 0;

  for (const line of lines) {
    const imageMarker = line.match(/^\[Image\s+(\d+)\]$/iu);
    if (imageMarker) {
      currentImageIndex = Math.max(0, Number(imageMarker[1]) - 1);
      continue;
    }
    if (!/\bWEEK\b/iu.test(line)) {
      const dateMatch = line.match(DATE_PATTERN);
      if (dateMatch) {
        const day = Number(dateMatch[1]);
        const month = Number(dateMatch[2]);
        const explicitYear = dateMatch[3] ? Number(dateMatch[3]) : null;
        const iso = dateIso(day, month, explicitYear, years);
        if (iso) currentDate = { y: 0, rawDate: `${day}/${month}${explicitYear ? `/${explicitYear}` : ""}`, date: iso };
      }
    }
    const range = parseTimeRange(line);
    if (range) currentTime = range;
    if (!currentDate) continue;
    for (const event of transcriptEventSegments(line)) {
      // Ignore pure header/legend occurrences such as "CA Clinical Attachment"
      // unless the line also carries a lecture number/session/exam marker.
      if (!/[0-9]|\b(?:Introduction|Exam|TBL|Session|Practical|FA|CS|SL|HV)\b/iu.test(event.title)) continue;
      const candidate = candidateFromTitle({
        title: event.title,
        anchor: currentDate,
        page: 1,
        time: currentTime,
        group: event.group,
        evidence: line,
      });
      if (candidate) {
        candidate.sourcePage = null;
        candidate.sourceImageIndex = currentImageIndex;
        items.push(candidate);
      }
    }
  }
  return dedupe(items);
}
