import { GroupFocusApiError } from "./api/groupFocusApi.js";
import type { Language } from "../../core/i18n/translations";

export type GroupFocusFrontendRoute =
  | { kind: "home" }
  | { kind: "create" }
  | { kind: "join"; roomId?: string; inviteToken?: string }
  | { kind: "room"; roomId: string }
  | { kind: "summary"; roomId: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseGroupFocusFrontendRoute(routePath: string): GroupFocusFrontendRoute {
  const parts = routePath
    .split("/")
    .filter(Boolean)
    .map(decodeSegment);
  if (parts[0] === "create") return { kind: "create" };
  if (parts[0] === "join") {
    return {
      kind: "join",
      roomId: parts[1],
      inviteToken: parts[2],
    };
  }
  if (parts[0] === "room" && parts[1]) {
    return { kind: "room", roomId: parts[1] };
  }
  if (parts[0] === "summary" && parts[1]) {
    return { kind: "summary", roomId: parts[1] };
  }
  return { kind: "home" };
}

export function buildGroupFocusInviteUrl(
  roomId: string,
  inviteToken: string,
  origin: string,
): string {
  return `${origin.replace(/\/$/, "")}/#focus/group/join/${encodeURIComponent(roomId)}/${encodeURIComponent(inviteToken)}`;
}

function parseGroupFocusRouteSegments(
  value: string,
): { roomId: string; inviteToken?: string } | null {
  const parts = value.split("/").filter(Boolean).map(decodeSegment);
  if (parts[0] === "focus" && parts[1] === "group") {
    if (parts[2] === "join" && parts[3]) {
      return { roomId: parts[3], inviteToken: parts[4] };
    }
    if (parts[2] === "room" && parts[3]) {
      return { roomId: parts[3] };
    }
  }
  if (parts[0] === "join" && parts[1]) {
    return { roomId: parts[1], inviteToken: parts[2] };
  }
  if (parts[0] === "room" && parts[1]) {
    return { roomId: parts[1] };
  }
  return null;
}

export function parseGroupFocusJoinInput(
  rawValue: string,
  origin: string,
): { roomId: string; inviteToken?: string } | null {
  const value = rawValue.trim();
  if (!value) return null;

  if (UUID_PATTERN.test(value)) return { roomId: value };

  const code = value.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})[:.\s]([A-Za-z0-9_-]+)$/i,
  );
  if (code) return { roomId: code[1], inviteToken: code[2] };

  const hashIndex = value.indexOf("#");
  if (hashIndex >= 0) {
    const fromHash = parseGroupFocusRouteSegments(value.slice(hashIndex + 1));
    if (fromHash) return UUID_PATTERN.test(fromHash.roomId) ? fromHash : null;
  }

  const fromPath = parseGroupFocusRouteSegments(value.replace(/^\/+/, ""));
  if (fromPath) return UUID_PATTERN.test(fromPath.roomId) ? fromPath : null;

  try {
    const url = new URL(value, origin);
    const fromUrlHash = parseGroupFocusRouteSegments(url.hash.replace(/^#\/?/, ""));
    if (fromUrlHash) return UUID_PATTERN.test(fromUrlHash.roomId) ? fromUrlHash : null;
    const fromUrlPath = parseGroupFocusRouteSegments(url.pathname.replace(/^\/+/, ""));
    if (fromUrlPath) return UUID_PATTERN.test(fromUrlPath.roomId) ? fromUrlPath : null;
  } catch {
    return null;
  }

  return null;
}

export function groupFocusErrorMessage(
  error: unknown,
  language: Language,
  fallback: string,
): string {
  const code = error instanceof GroupFocusApiError
    ? error.code
    : typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const arabic = language === "ar";
  switch (code) {
    case "FEATURE_DISABLED":
      return arabic
        ? "خدمة التركيز الجماعي غير متاحة حالياً."
        : "Group Focus is not available right now.";
    case "ROOM_FULL":
      return arabic
        ? "هذه الغرفة ممتلئة."
        : "This room is full.";
    case "ROOM_CLOSED":
      return arabic
        ? "أُغلقت هذه الغرفة."
        : "This room is closed.";
    case "ROOM_NOT_FOUND":
    case "INVALID_INVITE":
      return arabic
        ? "رابط الدعوة غير صالح أو انتهت صلاحيته."
        : "This invite is invalid or has expired.";
    case "MEMBER_REMOVED":
      return arabic
        ? "لم يعد بإمكانك الانضمام إلى هذه الغرفة."
        : "You can no longer join this room.";
    case "INVALID_MEMBER_LECTURE":
      return arabic
        ? "اختر محاضرة متاحة لك للانضمام إلى هذه الغرفة."
        : "Choose a lecture you can access before joining this room.";
    case "HOST_MUST_CLOSE_ROOM":
      return arabic
        ? "يجب على المضيف إغلاق الغرفة بدلاً من مغادرتها."
        : "Hosts must close the room instead of leaving it.";
    case "CAPABILITY_ISSUANCE_FAILED":
    case "AUTHORIZATION_REFRESH_REQUIRED":
    case "CANONICAL_MEMBERSHIP_INACTIVE":
    case "CONNECTION_FAILED":
    case "CONNECTION_CLOSED":
    case "CONNECTION_CANCELLED":
    case "PROTOCOL_NEGOTIATION_FAILED":
    case "RECONNECT_EXHAUSTED":
    case "ROOM_UNAVAILABLE":
    case "ROOM_TERMINAL":
    case "NOT_CONNECTED":
    case "WORKER_URL_INVALID":
    case "WORKER_URL_MISSING":
      return arabic
        ? "انقطع الاتصال المباشر بالغرفة. أعد الاتصال للمزامنة مع حالتها الحالية."
        : "The realtime room connection needs attention. Reconnect to sync with its current state.";
    case "SUMMARY_NOT_FOUND":
      return arabic
        ? "لم يكتمل ملخص الغرفة بعد."
        : "The room summary is still being finalized.";
    default:
      return fallback;
  }
}