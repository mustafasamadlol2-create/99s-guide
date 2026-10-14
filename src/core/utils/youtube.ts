/**
 * YouTube URL helpers shared by web/PWA and Capacitor.
 *
 * Imported/admin-entered content may contain a direct YouTube URL, a copied
 * mobile link, markdown/HTML around the URL, or a YouTube search/channel page.
 * Keep parsing in one place so valid YouTube destinations are not rejected just
 * because they are not the classic watch?v= form.
 */

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
]);

const REDIRECT_QUERY_KEYS = [
  "q",
  "url",
  "u",
  "target",
  "redirect_url",
  "redir_url",
  "continue",
];

function stripInvisibleCharacters(value: string): string {
  return value.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function safeDecodeURIComponent(value: string): string {
  let current = value;
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
}

function trimUrlPunctuation(value: string): string {
  return value
    .trim()
    .replace(/^[\s`'"(<\[]+/, "")
    .replace(/[\s`'">)\],.;!?]+$/, "");
}

function normalizeCandidate(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  const value = trimUrlPunctuation(candidate);
  return YOUTUBE_VIDEO_ID.test(value) ? value : null;
}

function normalizeUrlLike(value: string): string | null {
  let candidate = trimUrlPunctuation(value);
  if (!candidate) return null;

  // Accept the schemes often copied by mobile apps and convert them to HTTPS.
  candidate = candidate
    .replace(/^youtube:\/\/watch\?v=/i, "https://www.youtube.com/watch?v=")
    .replace(/^vnd\.youtube:\/\//i, "https://www.youtube.com/watch?v=");

  if (/^(?:youtu\.be|(?:www\.|m\.|music\.)?youtube\.com|(?:www\.)?youtube-nocookie\.com)\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    return new URL(candidate).href;
  } catch {
    return null;
  }
}

function collectCandidates(rawValue: string): string[] {
  const raw = safeDecodeURIComponent(
    decodeHtmlEntities(stripInvisibleCharacters(rawValue.trim())),
  );

  const candidates = new Set<string>();
  const push = (value: string | null | undefined) => {
    if (!value) return;
    const cleaned = trimUrlPunctuation(value);
    if (cleaned) candidates.add(cleaned);
  };

  push(raw);

  // Markdown: [label](https://youtube...)
  for (const match of raw.matchAll(/\]\(([^)]+)\)/g)) push(match[1]);

  // HTML: href="..." / src="..."
  for (const match of raw.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
    push(match[1]);
  }

  // Any full/bare YouTube URL embedded in a copied sentence.
  const urlRegex = /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\/[^\s<>"']+/gi;
  for (const match of raw.matchAll(urlRegex)) push(match[0]);

  // Also inspect decoded variants of every candidate.
  for (const value of Array.from(candidates)) {
    push(safeDecodeURIComponent(value));
  }

  return Array.from(candidates);
}

function extractVideoIdFromParsedUrl(parsed: URL): string | null {
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");

  if (host === "youtu.be") {
    return normalizeCandidate(parsed.pathname.split("/").filter(Boolean)[0]);
  }

  if (!YOUTUBE_HOSTS.has(host)) return null;

  const queryVideoId = normalizeCandidate(parsed.searchParams.get("v"));
  if (queryVideoId) return queryVideoId;

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length >= 2) {
    const prefix = segments[0].toLowerCase();
    if (["shorts", "embed", "live", "v"].includes(prefix)) {
      const segmentId = normalizeCandidate(segments[1]);
      if (segmentId) return segmentId;
    }
  }

  return null;
}

/** Extract the canonical 11-character video id from common or wrapped links. */
export function extractYouTubeVideoId(rawUrl: string): string | null {
  if (typeof rawUrl !== "string") return null;

  const stripped = stripInvisibleCharacters(rawUrl.trim());
  if (!stripped) return null;

  if (YOUTUBE_VIDEO_ID.test(stripped)) return stripped;

  const candidates = collectCandidates(stripped);

  // First parse URLs and any nested redirect URLs.
  const queue = [...candidates];
  const visited = new Set<string>();

  while (queue.length > 0 && visited.size < 24) {
    const value = queue.shift();
    if (!value || visited.has(value)) continue;
    visited.add(value);

    if (YOUTUBE_VIDEO_ID.test(value)) return value;

    const normalized = normalizeUrlLike(value);
    if (!normalized) continue;

    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      continue;
    }

    const directId = extractVideoIdFromParsedUrl(parsed);
    if (directId) return directId;

    for (const key of REDIRECT_QUERY_KEYS) {
      const nested = parsed.searchParams.get(key);
      if (!nested) continue;
      const decoded = safeDecodeURIComponent(decodeHtmlEntities(nested));
      if (!visited.has(decoded)) queue.push(decoded);
    }
  }

  // Last-resort extraction for malformed copied text where URL() cannot parse
  // the entire value but the actual YouTube ID is still present.
  const relaxedMatch = safeDecodeURIComponent(decodeHtmlEntities(stripped)).match(
    /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:[^\s?#]+\/)*(?:watch\?(?:[^\s#]*&)?v=|shorts\/|embed\/|live\/|v\/)|[?&]v=)([A-Za-z0-9_-]{11})(?:[^A-Za-z0-9_-]|$)/i,
  );

  return relaxedMatch?.[1] || null;
}

/** Convert a direct video URL to one stable HTTPS watch URL. */
export function normalizeYouTubeUrl(rawUrl: string): string | null {
  const videoId = extractYouTubeVideoId(rawUrl);
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
}

/**
 * Return a safe YouTube destination even when the stored link is a search,
 * channel, playlist, redirect, or another official YouTube page without a
 * direct video id. Direct videos are still canonicalized to watch?v= form.
 */
export function normalizeYouTubeTargetUrl(rawUrl: string): string | null {
  if (typeof rawUrl !== "string") return null;

  const directVideoUrl = normalizeYouTubeUrl(rawUrl);
  if (directVideoUrl) return directVideoUrl;

  const candidates = collectCandidates(rawUrl);
  const queue = [...candidates];
  const visited = new Set<string>();

  while (queue.length > 0 && visited.size < 24) {
    const value = queue.shift();
    if (!value || visited.has(value)) continue;
    visited.add(value);

    const normalized = normalizeUrlLike(value);
    if (!normalized) continue;

    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      continue;
    }

    const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (YOUTUBE_HOSTS.has(host)) {
      // Redirect pages may contain the real YouTube destination in a query
      // parameter. Prefer it when present, otherwise the YouTube page itself is
      // still a valid destination and should be allowed to open.
      for (const key of REDIRECT_QUERY_KEYS) {
        const nested = parsed.searchParams.get(key);
        if (!nested) continue;
        const nestedTarget = normalizeYouTubeTargetUrl(
          safeDecodeURIComponent(decodeHtmlEntities(nested)),
        );
        if (nestedTarget) return nestedTarget;
      }

      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
      parsed.protocol = "https:";
      return parsed.href;
    }

    // Google/other redirect wrappers are not returned themselves, but their
    // nested q/url target may legitimately be a YouTube page.
    for (const key of REDIRECT_QUERY_KEYS) {
      const nested = parsed.searchParams.get(key);
      if (!nested) continue;
      const decoded = safeDecodeURIComponent(decodeHtmlEntities(nested));
      if (!visited.has(decoded)) queue.push(decoded);
    }
  }

  return null;
}
