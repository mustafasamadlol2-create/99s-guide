import {
  GroupFocusCapabilityVerificationError,
  verifyGroupFocusCapability,
  type GroupFocusCapabilityWorkerEnvironment,
} from "./capability.js";
import {
  GroupFocusCapabilityConfigurationError,
} from "../../shared/group-focus-capability/keyring.js";
import {
  GROUP_FOCUS_CAPABILITY_MAX_TOKEN_BYTES,
} from "../../shared/group-focus-capability/contract.js";
import {
  GROUP_FOCUS_REALTIME_AUTH_PREFIX,
  GROUP_FOCUS_REALTIME_INTERNAL_CAPABILITY_HEADER,
  GROUP_FOCUS_REALTIME_INTERNAL_RESUME_HEADER,
  GROUP_FOCUS_REALTIME_PROTOCOL,
  GROUP_FOCUS_REALTIME_RESUME_PREFIX,
} from "../../shared/group-focus-realtime/protocol.js";

export { GroupFocusRoom } from "./GroupFocusRoom.js";

const ROOM_PATH = /^\/rooms\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/connect$/iu;
const MAX_PROTOCOL_HEADER_BYTES = GROUP_FOCUS_CAPABILITY_MAX_TOKEN_BYTES + 128;
const MAX_AUTHORIZATION_HEADER_BYTES = GROUP_FOCUS_CAPABILITY_MAX_TOKEN_BYTES + 16;
const UUID_ROOM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type GroupFocusWorkerEnvironment =
  & GroupFocusCapabilityWorkerEnvironment
  & Env;

type CredentialResult =
  | { ok: true; token: string; resumeToken: string | null }
  | { ok: false; status: number; code: string };

function jsonError(status: number, code: string): Response {
  return Response.json(
    { error: "Group Focus realtime request was rejected.", code },
    {
      status,
      headers: {
        "Cache-Control": "no-store, private",
        Pragma: "no-cache",
      },
    },
  );
}

function bytesLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
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
  ) {
    return { ok: false, status: 400, code: "INVALID_WEBSOCKET_PROTOCOL" };
  }

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
    const match = authorization.match(
      /^\s*Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s*$/iu,
    );
    token = match?.[1];
  } else {
    const credentialProtocol = protocolCredentials[0];
    token = credentialProtocol?.slice(GROUP_FOCUS_REALTIME_AUTH_PREFIX.length);
  }

  if (
    !token
    || token.length === 0
    || bytesLength(token) > GROUP_FOCUS_CAPABILITY_MAX_TOKEN_BYTES
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token)
  ) {
    return { ok: false, status: 401, code: "UNAUTHORIZED" };
  }
  const resumeToken = resumeCredentials[0]?.slice(GROUP_FOCUS_REALTIME_RESUME_PREFIX.length)
    ?? null;
  if (resumeToken !== null && !/^[A-Za-z0-9_-]{43}$/u.test(resumeToken)) {
    return { ok: false, status: 401, code: "INVALID_RESUME_CREDENTIAL" };
  }
  return { ok: true, token, resumeToken };
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
  const url = new URL(request.url);
  if (
    url.searchParams.has("token")
    || url.searchParams.has("capability")
    || url.searchParams.has("auth")
  ) {
    return jsonError(400, "QUERY_CREDENTIALS_NOT_SUPPORTED");
  }

  const credentials = parseCredentials(request);
  if (!credentials.ok) return jsonError(credentials.status, credentials.code);

  let capability;
  try {
    capability = await verifyGroupFocusCapability(
      credentials.token,
      environment,
    );
  } catch (error) {
    if (error instanceof GroupFocusCapabilityConfigurationError) {
      return jsonError(503, "CAPABILITY_NOT_CONFIGURED");
    }
    if (error instanceof GroupFocusCapabilityVerificationError) {
      return jsonError(401, "INVALID_CAPABILITY");
    }
    return jsonError(401, "INVALID_CAPABILITY");
  }
  if (capability.roomId !== roomId) return jsonError(403, "ROOM_CAPABILITY_MISMATCH");

  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.set("sec-websocket-protocol", GROUP_FOCUS_REALTIME_PROTOCOL);
  headers.set(GROUP_FOCUS_REALTIME_INTERNAL_CAPABILITY_HEADER, credentials.token);
  if (credentials.resumeToken) {
    headers.set(GROUP_FOCUS_REALTIME_INTERNAL_RESUME_HEADER, credentials.resumeToken);
  }
  const internalRequest = new Request(request, { headers });
  const id = environment.GROUP_FOCUS_ROOMS.idFromName(roomId);
  const stub = environment.GROUP_FOCUS_ROOMS.get(id);
  return stub.fetch(internalRequest);
}

export default {
  async fetch(
    request: Request,
    environment: GroupFocusWorkerEnvironment,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json(
        { status: "ok" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (request.method === "GET" && url.pathname === "/rooms") {
      return jsonError(404, "NOT_FOUND");
    }
    const match = url.pathname.match(ROOM_PATH);
    if (!match?.[1] || !UUID_ROOM_ID.test(match[1])) {
      return jsonError(404, "NOT_FOUND");
    }
    return fetchGroupFocusRoom(request, environment, match[1]);
  },
};