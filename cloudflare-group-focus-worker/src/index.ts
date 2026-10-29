import type { GroupFocusCapabilityWorkerEnvironment } from "./capability.js";
import type { GroupFocusReconciliationEnvironment } from "../../shared/group-focus-reconciliation/signing.js";
import {
  GROUP_FOCUS_CAPABILITY_MAX_TOKEN_BYTES,
  isGroupFocusPrincipalId,
  type VerifiedGroupFocusCapability,
} from "../../shared/group-focus-capability/contract.js";
import { encodeBase64Url } from "../../shared/group-focus-capability/encoding.js";
import {
  GROUP_FOCUS_REALTIME_AUTH_PREFIX,
  GROUP_FOCUS_REALTIME_INTERNAL_CAPABILITY_HEADER,
  GROUP_FOCUS_REALTIME_INTERNAL_RESUME_HEADER,
  GROUP_FOCUS_REALTIME_PROTOCOL,
  GROUP_FOCUS_REALTIME_RESUME_PREFIX,
} from "../../shared/group-focus-realtime/protocol.js";

export { GroupFocusRoom } from "./GroupFocusRoom.js";

const ROOM_PATH = /^\/(?:group-focus\/)?rooms\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/connect$/iu;
const SUMMARY_PATH = /^\/(?:group-focus\/)?rooms\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/summary$/iu;
const MAX_PROTOCOL_HEADER_BYTES = GROUP_FOCUS_CAPABILITY_MAX_TOKEN_BYTES + 128;
const MAX_AUTHORIZATION_HEADER_BYTES = GROUP_FOCUS_CAPABILITY_MAX_TOKEN_BYTES + 16;
const UUID_ROOM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const PRODUCTION_GROUP_FOCUS_API_BASE_URL = "https://nine9s-guide.onrender.com";
const VERIFIED_CAPABILITY_HEADER = "X-Group-Focus-Verified-Capability";
const SUMMARY_READ_HEADER = "X-Group-Focus-Internal-Summary-Read";

export type GroupFocusWorkerEnvironment =
  & GroupFocusCapabilityWorkerEnvironment
  & GroupFocusReconciliationEnvironment
  & { GROUP_FOCUS_API_BASE_URL?: string }
  & Env;

type CredentialResult =
  | { ok: true; token: string; resumeToken: string | null }
  | { ok: false; status: number; code: string };

function jsonError(status: number, code: string): Response {
  return Response.json(
    { error: "Group Focus realtime request was rejected.", code },
    { status, headers: { "Cache-Control": "no-store, private", Pragma: "no-cache" } },
  );
}

function bytesLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function apiBase(environment: GroupFocusWorkerEnvironment): URL | null {
  try {
    const base = new URL(
      environment.GROUP_FOCUS_API_BASE_URL?.trim() || PRODUCTION_GROUP_FOCUS_API_BASE_URL,
    );
    if (
      (base.protocol !== "https:" && base.protocol !== "http:")
      || base.username.length > 0
      || base.password.length > 0
      || base.search.length > 0
      || base.hash.length > 0
      || (base.pathname !== "/" && base.pathname !== "")
    ) return null;
    return base;
  } catch {
    return null;
  }
}

function groupFocusWorkerRuntimeReady(environment: GroupFocusWorkerEnvironment): boolean {
  return Boolean(apiBase(environment) && environment.GROUP_FOCUS_ROOMS);
}

function parseCredentials(request: Request): CredentialResult {
  const protocolHeader = request.headers.get("sec-websocket-protocol");
  if (!protocolHeader || bytesLength(protocolHeader) > MAX_PROTOCOL_HEADER_BYTES) {
    return { ok: false, status: 400, code: "INVALID_WEBSOCKET_PROTOCOL" };
  }
  const offered = protocolHeader.split(",").map((protocol) => protocol.trim());
  if (
    offered.some((protocol) => protocol.length === 0)
    || offered.filter((protocol) => protocol === GROUP_FOCUS_REALTIME_PROTOCOL).length !== 1
    || offered.length > 3
    || offered.some((protocol) =>
      protocol !== GROUP_FOCUS_REALTIME_PROTOCOL
      && !protocol.startsWith(GROUP_FOCUS_REALTIME_AUTH_PREFIX)
      && !protocol.startsWith(GROUP_FOCUS_REALTIME_RESUME_PREFIX))
  ) return { ok: false, status: 400, code: "INVALID_WEBSOCKET_PROTOCOL" };

  const protocolCredentials = offered.filter((protocol) =>
    protocol.startsWith(GROUP_FOCUS_REALTIME_AUTH_PREFIX));
  const resumeCredentials = offered.filter((protocol) =>
    protocol.startsWith(GROUP_FOCUS_REALTIME_RESUME_PREFIX));
  if (protocolCredentials.length > 1 || resumeCredentials.length > 1) {
    return { ok: false, status: 400, code: "AMBIGUOUS_CREDENTIALS" };
  }

  const authorization = request.headers.get("authorization");
  if (authorization && bytesLength(authorization) > MAX_AUTHORIZATION_HEADER_BYTES) {
    return { ok: false, status: 413, code: "CREDENTIAL_TOO_LARGE" };
  }
  if (authorization && protocolCredentials.length > 0) {
    return { ok: false, status: 400, code: "AMBIGUOUS_CREDENTIALS" };
  }

  let token: string | undefined;
  if (authorization) {
    token = authorization.match(
      /^\s*Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s*$/iu,
    )?.[1];
  } else {
    token = protocolCredentials[0]?.slice(GROUP_FOCUS_REALTIME_AUTH_PREFIX.length);
  }
  if (
    !token
    || bytesLength(token) > GROUP_FOCUS_CAPABILITY_MAX_TOKEN_BYTES
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token)
  ) return { ok: false, status: 401, code: "UNAUTHORIZED" };

  const resumeToken = resumeCredentials[0]?.slice(GROUP_FOCUS_REALTIME_RESUME_PREFIX.length) ?? null;
  if (resumeToken !== null && !/^[A-Za-z0-9_-]{43}$/u.test(resumeToken)) {
    return { ok: false, status: 401, code: "INVALID_RESUME_CREDENTIAL" };
  }
  return { ok: true, token, resumeToken };
}

function isVerifiedCapability(value: unknown): value is VerifiedGroupFocusCapability {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item.version === 1
    && isGroupFocusPrincipalId(item.userId)
    && typeof item.roomId === "string" && UUID_ROOM_ID.test(item.roomId)
    && typeof item.membershipId === "string" && UUID_ROOM_ID.test(item.membershipId)
    && (item.role === "HOST" || item.role === "MEMBER")
    && (item.mode === "SHARED_LECTURE" || item.mode === "STUDY_TOGETHER")
    && (item.visibility === "PUBLIC" || item.visibility === "PRIVATE")
    && typeof item.effectiveLectureId === "string" && UUID_ROOM_ID.test(item.effectiveLectureId)
    && Number.isSafeInteger(item.focusDurationSeconds)
    && Number.isSafeInteger(item.breakDurationSeconds)
    && Number.isSafeInteger(item.roundCount)
    && Number.isSafeInteger(item.maxParticipants)
    && typeof item.roomUpdatedAt === "string"
    && typeof item.membershipUpdatedAt === "string"
    && typeof item.issuedAt === "string"
    && typeof item.expiresAt === "string"
    && typeof item.jti === "string";
}

async function verifyCapabilityRemotely(
  token: string,
  roomId: string,
  environment: GroupFocusWorkerEnvironment,
): Promise<VerifiedGroupFocusCapability | null> {
  const base = apiBase(environment);
  if (!base) return null;
  const url = new URL("/api/group-focus/runtime/verify-capability", base.origin);
  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "group-focus-worker" },
      body: JSON.stringify({ capabilityToken: token, roomId }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as unknown;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
    const capability = (payload as { capability?: unknown }).capability;
    return isVerifiedCapability(capability) && capability.roomId === roomId ? capability : null;
  } catch {
    return null;
  }
}

function encodeVerifiedCapability(capability: VerifiedGroupFocusCapability): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(capability)));
}

async function forwardToRoom(
  request: Request,
  environment: GroupFocusWorkerEnvironment,
  roomId: string,
  token: string,
  capability: VerifiedGroupFocusCapability,
  resumeToken: string | null,
  summaryRead = false,
): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.set(VERIFIED_CAPABILITY_HEADER, encodeVerifiedCapability(capability));
  headers.set(GROUP_FOCUS_REALTIME_INTERNAL_CAPABILITY_HEADER, token);
  if (summaryRead) {
    headers.set(SUMMARY_READ_HEADER, "1");
  } else {
    headers.set("sec-websocket-protocol", GROUP_FOCUS_REALTIME_PROTOCOL);
    if (resumeToken) headers.set(GROUP_FOCUS_REALTIME_INTERNAL_RESUME_HEADER, resumeToken);
  }
  const internalUrl = new URL(request.url);
  internalUrl.pathname = summaryRead
    ? `/rooms/${roomId}/summary`
    : `/rooms/${roomId}/connect`;
  const internalRequest = new Request(internalUrl.toString(), { method: "GET", headers });
  const stub = environment.GROUP_FOCUS_ROOMS.get(environment.GROUP_FOCUS_ROOMS.idFromName(roomId));
  return stub.fetch(internalRequest);
}

async function fetchGroupFocusRoom(
  request: Request,
  environment: GroupFocusWorkerEnvironment,
  roomId: string,
): Promise<Response> {
  if (request.method !== "GET") return jsonError(405, "METHOD_NOT_ALLOWED");
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return jsonError(426, "WEBSOCKET_UPGRADE_REQUIRED");
  }
  const credentials = parseCredentials(request);
  if (!credentials.ok) return jsonError(credentials.status, credentials.code);
  const capability = await verifyCapabilityRemotely(credentials.token, roomId, environment);
  if (!capability) return jsonError(401, "INVALID_CAPABILITY");
  return forwardToRoom(
    request,
    environment,
    roomId,
    credentials.token,
    capability,
    credentials.resumeToken,
  );
}

async function fetchGroupFocusSummary(
  request: Request,
  environment: GroupFocusWorkerEnvironment,
  roomId: string,
): Promise<Response> {
  if (request.method !== "GET") return jsonError(405, "METHOD_NOT_ALLOWED");
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.match(
    /^\s*Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s*$/iu,
  )?.[1];
  if (!token) return jsonError(401, "UNAUTHORIZED");
  const capability = await verifyCapabilityRemotely(token, roomId, environment);
  if (!capability) return jsonError(401, "INVALID_CAPABILITY");
  return forwardToRoom(request, environment, roomId, token, capability, null, true);
}

export default {
  async fetch(request: Request, environment: GroupFocusWorkerEnvironment): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/group-focus/health")) {
      return Response.json({ status: "ok" }, {
        headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
      });
    }
    if (request.method === "GET" && (url.pathname === "/ready" || url.pathname === "/group-focus/ready")) {
      const runtimeReady = groupFocusWorkerRuntimeReady(environment);
      return Response.json(
        { status: runtimeReady ? "ready" : "not_ready", runtimeReady, mode: "same-origin" },
        {
          status: runtimeReady ? 200 : 503,
          headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
        },
      );
    }
    if (!groupFocusWorkerRuntimeReady(environment)) return jsonError(503, "WORKER_RUNTIME_NOT_READY");
    const roomMatch = url.pathname.match(ROOM_PATH);
    if (roomMatch?.[1] && UUID_ROOM_ID.test(roomMatch[1])) {
      return fetchGroupFocusRoom(request, environment, roomMatch[1]);
    }
    const summaryMatch = url.pathname.match(SUMMARY_PATH);
    if (summaryMatch?.[1] && UUID_ROOM_ID.test(summaryMatch[1])) {
      return fetchGroupFocusSummary(request, environment, summaryMatch[1]);
    }
    return jsonError(404, "NOT_FOUND");
  },
};
