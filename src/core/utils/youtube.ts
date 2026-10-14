/**
 * YouTube URL helpers shared by web/PWA and Capacitor.
 *
 * YouTube's Share UI can produce several valid URL shapes (watch, youtu.be,
 * shorts, live, embed, etc.). Keep parsing in one place so a link that works in
 * a browser cannot be rejected by one lecture surface while being accepted by
 * another.
 */

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

function normalizeCandidate(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  const value = candidate.trim();
  return YOUTUBE_VIDEO_ID.test(value) ? value : null;
}

/** Extract the canonical 11-character video id from common YouTube link forms. */
export function extractYouTubeVideoId(rawUrl: string): string | null {
  if (typeof rawUrl !== "string") return null;

  let value = rawUrl.trim().replace(/&amp;/gi, "&");
  if (!value) return null;

  // Accept a raw ID as a convenience for imported/admin-entered content.
  if (YOUTUBE_VIDEO_ID.test(value)) return value;

  // URL() requires a scheme. YouTube share links are occasionally pasted as
  // "youtu.be/..." or "www.youtube.com/..." from rich text sources.
  if (/^(?:youtu\.be|(?:www\.|m\.|music\.)?youtube\.com|(?:www\.)?youtube-nocookie\.com)\//i.test(value)) {
    value = `https://${value}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");

  if (host === "youtu.be") {
    return normalizeCandidate(parsed.pathname.split("/").filter(Boolean)[0]);
  }

  if (!YOUTUBE_HOSTS.has(host)) return null;

  // A valid ?v= parameter is authoritative even when YouTube adds extra path
  // or tracking information around it.
  const queryVideoId = normalizeCandidate(parsed.searchParams.get("v"));
  if (queryVideoId) return queryVideoId;

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  // Supported official path forms:
  //   /shorts/<id>  /embed/<id>  /live/<id>  /v/<id>
  const prefix = segments[0].toLowerCase();
  if (["shorts", "embed", "live", "v"].includes(prefix)) {
    return normalizeCandidate(segments[1]);
  }

  return null;
}

/** Convert any supported YouTube URL to one stable HTTPS watch URL. */
export function normalizeYouTubeUrl(rawUrl: string): string | null {
  const videoId = extractYouTubeVideoId(rawUrl);
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
}
