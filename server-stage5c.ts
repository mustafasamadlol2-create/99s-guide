console.log("🚀 Starting 99's Guide backend...");
import dotenv from "dotenv";
// Use override:false so Replit-injected DATABASE_URL / secrets are preserved
dotenv.config({ override: false });

// Prisma needs DIRECT_URL; fall back to DATABASE_URL when not explicitly set
if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

if (!process.env.DATABASE_URL && !process.env.SUPABASE_DATABASE_URL) {
  console.warn("⚠️  DATABASE_URL is missing. Add your PostgreSQL connection string to .env, then restart.");
}

import express from "express";
import path from "path";
import fs from "fs/promises";
import { createServer as createViteServer } from "vite";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import http, { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import cors from "cors";
import multer from "multer";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import compression from "compression";
import helmet from "helmet";
import xss from "xss-clean";


// Static Seed imports to populate DB dynamically on first runtime
import { 
  subjects as seedSubjects, 
  mcqs as seedMcqs, 
  flashcards as seedFlashcards, 
  videos as seedVideos
} from "./src/core/constants/seedData.js";

import { UserService } from "./server/services/userService.js";
import { AuthService } from "./server/services/authService.js";
import * as OAuthService from "./server/services/oauthService.js";
import { EmailService } from "./server/services/emailService.js";
import crypto from "crypto";
import { prisma, getPrisma, disconnectPrisma } from "./server/services/prismaClient.js";
import { execFile } from "child_process";

// ── Monitoring & Logging ──────────────────────────────────────────────────────
import { logger, getRecentLogs } from "./server/services/logger.js";
import { authMonitor } from "./server/services/authMonitor.js";
import { dbMonitor } from "./server/services/dbMonitor.js";
import {
  PDF_DOWNLOAD_SCOPE,
  createPdfDownloadToken,
  verifyPdfDownloadToken,
} from "./server/services/pdfAccess.js";
import { requestLogger } from "./server/middleware/requestLogger.js";
import { buildOAuthPendingQuery, isOAuthStateBound, isValidPkceCodeChallenge, parseOAuthState } from "./server/services/oauthState.js";
import { getRevokedSessionKey, isRevocationActive } from "./server/services/sessionRevocation.js";
import {
  buildMaterialStoragePath,
  createSupabaseSignedUrl,
  deleteSupabaseStorageObject,
  uploadPdfToSupabaseStorage,
} from "./server/services/supabaseStorage.js";


// --- Production-Grade In-Memory Caches for read-heavy operations ---
let materialsCache: { group: string; data: any } | null = null;
let lecturesCache: { data: any[]; expiresAt: number } | null = null;

function invalidateMaterialsCache() {
  materialsCache = null;
  lecturesCache = null;
}

function parseTargetGroups(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map(v => v.trim().toUpperCase()).filter(Boolean);
  return String(value || "").split(",").map(v => v.trim().toUpperCase()).filter(Boolean);
}

function eventVisibleToGroup(targetGroups: unknown, studentGroup: unknown): boolean {
  const groups = parseTargetGroups(targetGroups);
  const group = typeof studentGroup === "string" ? studentGroup.trim().toUpperCase() : "";
  return groups.includes("ALL") || (!!group && groups.includes(group));
}

/**
 * fetch() with a hard timeout that works on every supported Node runtime.
 * `AbortSignal.timeout()` requires Node >= 17.3 — on older runtimes it throws
 * a synchronous TypeError, which the OAuth callbacks would surface as a 500
 * "Verification Failure".  The timer is cleared once the request settles.
 */
function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ── Cloudflare D1 content mirror (Stage 4E) ────────────────────────────────────
//
// Supabase/PostgreSQL remains the write authority during Stage 4. After a
// successful academic-content mutation, the canonical row is mirrored to D1.
// If the Worker is temporarily unavailable, the latest mutation for that row is
// durably queued in the existing SystemSetting table and retried later.
type ContentSyncEntity =
  | "Lecture"
  | "Material"
  | "Mcq"
  | "Flashcard"
  | "DailyMotto"
  | "CalendarEvent";

type ContentSyncMutation = {
  version: 1;
  entity: ContentSyncEntity;
  operation: "upsert" | "delete";
  id: string;
  data?: Record<string, unknown>;
  occurredAt: string;
};

const CONTENT_SYNC_OUTBOX_PREFIX = "__content_sync_pending__:";
const CONTENT_SYNC_BATCH_SIZE = 25;
let contentSyncDrainTimer: ReturnType<typeof setTimeout> | null = null;
let contentSyncDrainInFlight = false;

function contentSyncOutboxKey(entity: ContentSyncEntity, id: string): string {
  return `${CONTENT_SYNC_OUTBOX_PREFIX}${entity}:${id}`;
}

function getContentSyncConfig(): { workerBaseUrl: string; secret: string } | null {
  const workerBaseUrl = process.env.CONTENT_WORKER_BASE_URL?.trim().replace(/\/+$/, "");
  const secret = process.env.CONTENT_SYNC_SECRET?.trim();
  if (!workerBaseUrl || !secret) return null;
  return { workerBaseUrl, secret };
}


function contentD1ReadsEnabled(): boolean {
  const value = String(process.env.CONTENT_D1_READS_ENABLED || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

type ContentReadError = Error & { status?: number };

async function fetchContentReadJson<T = unknown>(
  pathWithQuery: string,
  timeoutMs = 3_000,
): Promise<T> {
  const config = getContentSyncConfig();
  if (!config) {
    throw new Error("CONTENT_WORKER_BASE_URL or CONTENT_SYNC_SECRET is not configured.");
  }

  const normalizedPath = pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`;
  const response = await fetchWithTimeout(
    `${config.workerBaseUrl}/internal/content-read${normalizedPath}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Content-Sync-Secret": config.secret,
      },
    },
    timeoutMs,
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(
      `Content Worker read failed with HTTP ${response.status}: ${body.slice(0, 180)}`,
    ) as ContentReadError;
    error.status = response.status;
    throw error;
  }

  return await response.json() as T;
}

function toLectureContentRow(row: any): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    mainSubject: row.mainSubject,
    subSubject: row.subSubject ?? null,
    trackMode: row.trackMode,
    department: row.department ?? null,
    createdAt: row.createdAt,
  };
}

function toMaterialContentRow(row: any): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    fileUrlOrLink: row.fileUrlOrLink,
    lectureId: row.lectureId,
    createdAt: row.createdAt,
    storagePath: row.storagePath ?? null,
  };
}

function toMcqContentRow(row: any): Record<string, unknown> {
  return {
    id: row.id,
    question: row.question,
    optionA: row.optionA,
    optionB: row.optionB,
    optionC: row.optionC,
    optionD: row.optionD,
    correctAnswer: row.correctAnswer,
    hint: row.hint ?? null,
    explanation: row.explanation ?? null,
    sourceType: row.sourceType,
    sourceRef: row.sourceRef,
    difficulty: row.difficulty,
    lectureId: row.lectureId,
    createdAt: row.createdAt,
  };
}

function toFlashcardContentRow(row: any): Record<string, unknown> {
  return {
    id: row.id,
    clinicalConcept: row.clinicalConcept,
    explanation: row.explanation,
    lectureId: row.lectureId,
    createdAt: row.createdAt,
  };
}

function toDailyMottoContentRow(row: any): Record<string, unknown> {
  return {
    id: row.id,
    message: row.message,
    isActive: row.isActive,
    isFeatured: row.isFeatured,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCalendarEventContentRow(row: any): Record<string, unknown> {
  return {
    id: row.id,
    userId: row.userId ?? null,
    title: row.title,
    eventType: row.eventType,
    startDateTime: row.startDateTime,
    endDateTime: row.endDateTime,
    targetGroups: row.targetGroups,
    description: row.description ?? null,
    subjectId: row.subjectId ?? null,
    lectureId: row.lectureId ?? null,
    room: row.room ?? null,
    doctor: row.doctor ?? null,
    notes: row.notes ?? null,
    isPinned: row.isPinned,
    isCompleted: row.isCompleted,
  };
}

function makeContentUpsert(
  entity: ContentSyncEntity,
  data: Record<string, unknown>,
): ContentSyncMutation {
  const id = typeof data.id === "string" ? data.id : "";
  if (!id) throw new Error(`Content sync ${entity} upsert is missing id.`);
  return { version: 1, entity, operation: "upsert", id, data, occurredAt: new Date().toISOString() };
}

function makeContentDelete(entity: ContentSyncEntity, id: string): ContentSyncMutation {
  if (!id) throw new Error(`Content sync ${entity} delete is missing id.`);
  return { version: 1, entity, operation: "delete", id, occurredAt: new Date().toISOString() };
}

async function postContentSyncMutation(
  mutation: ContentSyncMutation,
  timeoutMs = 3_000,
): Promise<void> {
  const config = getContentSyncConfig();
  if (!config) throw new Error("CONTENT_WORKER_BASE_URL or CONTENT_SYNC_SECRET is not configured.");

  const response = await fetchWithTimeout(
    `${config.workerBaseUrl}/internal/content-sync`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Content-Sync-Secret": config.secret,
      },
      body: JSON.stringify(mutation),
    },
    timeoutMs,
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Content Worker sync failed with HTTP ${response.status}: ${body.slice(0, 180)}`);
  }
}

async function persistContentSyncOutbox(mutation: ContentSyncMutation): Promise<void> {
  const key = contentSyncOutboxKey(mutation.entity, mutation.id);
  const now = new Date();
  await getPrisma().systemSetting.upsert({
    where: { key },
    update: { value: JSON.stringify(mutation), updatedAt: now },
    create: { key, value: JSON.stringify(mutation), updatedAt: now },
  });
}

async function clearContentSyncOutbox(entity: ContentSyncEntity, id: string): Promise<void> {
  await getPrisma().systemSetting.deleteMany({ where: { key: contentSyncOutboxKey(entity, id) } });
}

async function clearContentSyncOutboxMany(
  entries: Array<{ entity: ContentSyncEntity; id: string }>,
): Promise<void> {
  if (entries.length === 0) return;
  await getPrisma().systemSetting.deleteMany({
    where: {
      key: { in: entries.map(({ entity, id }) => contentSyncOutboxKey(entity, id)) },
    },
  });
}

function scheduleContentSyncDrain(delayMs = 30_000): void {
  if (contentSyncDrainTimer) return;
  contentSyncDrainTimer = setTimeout(() => {
    contentSyncDrainTimer = null;
    void drainContentSyncOutbox();
  }, delayMs);
  if (typeof contentSyncDrainTimer.unref === "function") contentSyncDrainTimer.unref();
}

async function syncContentMutation(mutation: ContentSyncMutation): Promise<void> {
  try {
    await postContentSyncMutation(mutation);
    try {
      await clearContentSyncOutbox(mutation.entity, mutation.id);
    } catch (clearError: any) {
      logger.warn(
        "[ContentSync]",
        `D1 sync succeeded but stale outbox cleanup failed for ${mutation.entity}/${mutation.id}: ${clearError?.message ?? "unknown error"}`,
      );
    }
  } catch (syncError: any) {
    try {
      await persistContentSyncOutbox(mutation);
      logger.warn(
        "[ContentSync]",
        `D1 sync queued for ${mutation.entity}/${mutation.id}: ${syncError?.message ?? "unknown error"}`,
      );
      scheduleContentSyncDrain();
    } catch (outboxError: any) {
      logger.error(
        "[ContentSync]",
        `CRITICAL: failed to sync or queue ${mutation.entity}/${mutation.id}: ${outboxError?.message ?? "unknown error"}`,
      );
    }
  }
}

async function syncContentUpsert(
  entity: ContentSyncEntity,
  data: Record<string, unknown>,
): Promise<void> {
  await syncContentMutation(makeContentUpsert(entity, data));
}

async function syncContentDelete(entity: ContentSyncEntity, id: string): Promise<void> {
  await syncContentMutation(makeContentDelete(entity, id));
}

async function drainContentSyncOutbox(): Promise<void> {
  if (contentSyncDrainInFlight || !getContentSyncConfig()) return;
  contentSyncDrainInFlight = true;
  let shouldRetryLater = false;

  try {
    const rows = await getPrisma().systemSetting.findMany({
      where: { key: { startsWith: CONTENT_SYNC_OUTBOX_PREFIX } },
      orderBy: { updatedAt: "asc" },
      take: CONTENT_SYNC_BATCH_SIZE,
      select: { key: true, value: true },
    });

    for (const row of rows) {
      let mutation: ContentSyncMutation;
      try {
        mutation = JSON.parse(String(row.value || "")) as ContentSyncMutation;
        if (
          mutation?.version !== 1 ||
          !mutation.id ||
          !mutation.entity ||
          !["upsert", "delete"].includes(mutation.operation)
        ) {
          throw new Error("Malformed content-sync outbox record.");
        }
      } catch (parseError: any) {
        shouldRetryLater = true;
        logger.error("[ContentSync]", `Malformed pending mutation ${row.key}: ${parseError?.message ?? "unknown error"}`);
        continue;
      }

      try {
        await postContentSyncMutation(mutation, 5_000);
        await getPrisma().systemSetting.deleteMany({ where: { key: row.key } });
      } catch (error: any) {
        shouldRetryLater = true;
        logger.warn(
          "[ContentSync]",
          `Pending D1 mutation still waiting (${mutation.entity}/${mutation.id}): ${error?.message ?? "unknown error"}`,
        );
      }
    }

    if (rows.length === CONTENT_SYNC_BATCH_SIZE) shouldRetryLater = true;
  } catch (error: any) {
    shouldRetryLater = true;
    logger.warn("[ContentSync]", `Outbox drain failed: ${error?.message ?? "unknown error"}`);
  } finally {
    contentSyncDrainInFlight = false;
  }

  if (shouldRetryLater) scheduleContentSyncDrain(2 * 60_000);
}

if (getContentSyncConfig()) {
  logger.info("[ContentSync]", "Cloudflare D1 content mirror is configured.");
} else {
  logger.warn(
    "[ContentSync]",
    "Cloudflare D1 content mirror is not configured yet. Future academic mutations will be queued in Supabase until CONTENT_WORKER_BASE_URL and CONTENT_SYNC_SECRET are set.",
  );
}


if (contentD1ReadsEnabled()) {
  if (getContentSyncConfig()) {
    logger.info(
      "[ContentRead]",
      "D1 lecture reads are ENABLED. Render authentication/API contracts remain in front; Supabase is automatic fallback.",
    );
  } else {
    logger.warn(
      "[ContentRead]",
      "CONTENT_D1_READS_ENABLED is on but Content Worker configuration is missing. Lecture reads will fall back to Supabase.",
    );
  }
} else {
  logger.info(
    "[ContentRead]",
    "D1 lecture reads are available but DISABLED. Current Supabase lecture read path is unchanged.",
  );
}

// Recover pending durable mutations after a Render deploy/restart without
// continuously polling Supabase while the queue is empty.
scheduleContentSyncDrain(15_000);

const app = express();

const catchAsync = (fn: any) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Trust proxy hops only when explicitly configured via TRUST_PROXY_HOPS.
// Defaults to 1 trusted hop in production (behind a reverse proxy that
// overwrites X-Forwarded-For, e.g. Render) and 0 (no trust) in development,
// so arbitrary client-supplied X-Forwarded-For values are never trusted unless
// the deployment explicitly says a proxy hop count is present.
const TRUST_PROXY_HOPS = (() => {
  const raw = process.env.TRUST_PROXY_HOPS;
  if (raw !== undefined && raw !== "") {
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n)) return Math.max(0, Math.min(n, 3));
  }
  return process.env.NODE_ENV === "production" ? 1 : 0;
})();
app.set("trust proxy", TRUST_PROXY_HOPS);
const PORT = 3000;
const httpServer = createServer(app);

// Securely configure CORS for production web domain and Capacitor mobile origins (iOS/Android)
// NOTE: Capacitor native apps serve their UI from local custom schemes, not http/https.
// We MUST explicitly allow 'capacitor://localhost' (and 'ionic://localhost' for backward compat) 
// here. If this is missing, the native App Store version will fail to connect to the backend.
const getCorsOrigins = (): (string | RegExp)[] => {
  const origins: (string | RegExp)[] = [
    "https://99s-guide.mustafasamadlol2.workers.dev",
    "capacitor://localhost",
    "ionic://localhost",
    "https://appleid.apple.com", // Apple OAuth form_post callback (response_mode=form_post)
  ];
  
  if (process.env.NODE_ENV !== "production") {
    origins.push(
      "http://localhost",
      "http://localhost:5173",
      `http://localhost:${PORT}`,
      `http://127.0.0.1:${PORT}`,
      /^https?:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/, // Allow local IP addresses dynamically (like 192.168.x.x)
      /\.trycloudflare\.com$/, // Allow Cloudflare secure tunnels (used for dev previews)
      /\.replit\.dev$/, // Allow Replit preview domains
      /\.pike\.replit\.dev$/ // Allow Replit pike preview domains
    );
  }

  // Both variables are used by the OAuth redirect layer. Keep CORS aligned
  // with that configuration so a deployment can move the frontend without
  // silently breaking credentialed auth/API requests.
  for (const configuredUrl of [process.env.APP_URL, process.env.FRONTEND_URL]) {
    if (!configuredUrl) continue;
    origins.push(configuredUrl);
    try {
      origins.push(new URL(configuredUrl).origin);
    } catch {
      // Ignore invalid URL format; startup/configuration diagnostics handle it.
    }
  }

  return origins;
};

function getValidatedRequestOrigin(req: express.Request): string | undefined {
  const rawOrigin = req.get("origin")?.trim();
  if (!rawOrigin) return undefined;

  const normalized = rawOrigin.replace(/\/+$/, "");
  let origin: string;
  try {
    const parsed = new URL(normalized);
    // URL.origin is "null" for custom Capacitor schemes. Preserve the
    // normalized scheme in that case so it can still be checked explicitly.
    origin = parsed.origin === "null" ? normalized : parsed.origin;
  } catch {
    return undefined;
  }

  const isAllowed = getCorsOrigins().some((allowedOrigin) =>
    allowedOrigin instanceof RegExp ? allowedOrigin.test(origin) : allowedOrigin === origin,
  );
  return isAllowed ? origin : undefined;
}

const io = new SocketServer(httpServer, {
  destroyUpgrade: false,
  cors: {
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }
      const allowed = getCorsOrigins();
      const isAllowed = allowed.some((allowedOrigin) => {
        if (allowedOrigin instanceof RegExp) {
          return allowedOrigin.test(origin);
        }
        return allowedOrigin === origin;
      });
      if (isAllowed) {
        callback(null, origin);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Re-evaluate every live socket for a user after an authorization-affecting
// change. Room membership is not an authorization source by itself.
async function refreshUserSocketAuthorization(userId: string): Promise<void> {
  const sockets = Array.from(io.sockets.sockets.values()).filter(
    (socket) => socket.data.userId === userId,
  );
  if (sockets.length === 0) return;

  let user: any;
  try {
    user = await UserService.findById(userId);
  } catch {
    // Fail closed if the authorization re-check cannot reach the database.
    sockets.forEach((socket) => socket.disconnect(true));
    return;
  }

  let accessRevoked = !user || user.emailVerified === false;
  if (!accessRevoked) {
    try {
      accessRevoked = await isUserCurrentlyBanned(user);
    } catch {
      sockets.forEach((socket) => socket.disconnect(true));
      return;
    }
  }
  if (accessRevoked) {
    sockets.forEach((socket) => {
      socket.emit("userForcedLogout", { userId });
      socket.disconnect(true);
    });
    return;
  }

  const adminRole = user.role === "admin" || user.role === "owner";
  for (const socket of sockets) {
    socket.data.userEmail = user.email;
    socket.data.role = user.role;
    socket.data.studentGroup = user.studentGroup;
    socket.data.isPrimaryOwner = user.isPrimaryOwner === true;

    for (const room of socket.rooms) {
      if (room.startsWith("group:") && room !== `group:${user.studentGroup}`) {
        await socket.leave(room);
      }
    }
    if (user.studentGroup) await socket.join(`group:${user.studentGroup}`);
    if (adminRole) await socket.join("admins");
    else await socket.leave("admins");
  }
}

// Socket identity is established before connection handlers run. Anonymous
// sockets are rejected so they cannot passively receive private broadcasts.
io.use(async (socket, next) => {
  try {
    const cookieToken = (socket.handshake.headers?.cookie || "")
      .match(/(?:^|;\s*)auth_token=([^;]+)/)?.[1];
    const handshakeToken =
      (socket.handshake.auth?.token as string | undefined) || cookieToken;
    if (!handshakeToken) return next(new Error("Authentication required"));

    const decoded = jwt.verify(handshakeToken, JWT_SECRET, { algorithms: ["HS256"] }) as { userId: string; sessionVersion?: number };
    if (await isRevokedToken(handshakeToken)) return next(new Error("Session revoked"));
    const user = await getAuthenticatedUser(decoded.userId);
    if (!user || user.emailVerified === false || (decoded.sessionVersion ?? 0) !== (user.sessionVersion ?? 0) || await isUserCurrentlyBanned(user)) {
      return next(new Error("Invalid session"));
    }

    socket.data.userId = user.id;
    socket.data.userEmail = user.email;
    socket.data.studentGroup = user.studentGroup;
    socket.data.role = user.role;
    socket.data.verified = true;
    socket.join("authenticated");
    socket.join("user-" + user.id);
    if (user.studentGroup) socket.join("group:" + user.studentGroup);
    if (user.role === "admin" || user.role === "owner") socket.join("admins");
    next();
  } catch {
    next(new Error("Authentication required"));
  }
});

// Register real-time database-to-socket listeners via UserService
UserService.onCreate = (createdUser) => {
  // Strip sensitive fields before broadcasting — password_hash and reset_token
  // must never travel over the socket to connected clients.
  const { password_hash: _ph, reset_token: _rt, reset_token_expires: _rte, ...safeCreatedUser } = createdUser as any;
  io.to("admins").emit("userCreated", safeCreatedUser);
  io.to("authenticated").emit("userStatusChanged", { email: createdUser.email, isOnline: createdUser.isOnline });
  io.to("authenticated").emit("userStatusUpdate", { email: createdUser.email, isOnline: createdUser.isOnline });
};

UserService.onUpdate = (updatedUser) => {
  // Strip sensitive fields before broadcasting.
  const { password_hash: _ph, reset_token: _rt, reset_token_expires: _rte, ...safeUpdatedUser } = updatedUser as any;
  io.to("admins").emit("userUpdated", safeUpdatedUser);
  io.to("authenticated").emit("userStatusChanged", safeUpdatedUser);
  io.to("authenticated").emit("userStatusUpdate", safeUpdatedUser);
};

UserService.onDelete = (userId) => {
  io.to("admins").emit("userDeleted", { id: userId });
};

app.use(cors({
  origin: (origin, callback) => {
    // If no origin (like server-to-server or curl), allow it
    if (!origin) {
      return callback(null, true);
    }
    
    const allowed = getCorsOrigins();
    const isAllowed = allowed.some((allowedOrigin) => {
      if (allowedOrigin instanceof RegExp) {
        return allowedOrigin.test(origin);
      }
      return allowedOrigin === origin;
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`[CORS Blocked] Request origin "${origin}" not in whitelist.`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: [
    "Content-Type", 
    "Authorization", 
    "X-Requested-With", 
    "Accept", 
    "Origin",
    "Access-Control-Allow-Headers",
    "Access-Control-Request-Method",
    "Access-Control-Request-Headers",
    "Cache-Control",
    "Pragma",
    "X-Session-Delivery",
    "X-OAuth-State"
  ],
  exposedHeaders: ["Content-Range", "X-Content-Range", "Content-Disposition", "Content-Length"]
}));
app.use(cookieParser());

// Prerelease reverse proxy for Prisma Studio running inside the secure sandbox.
// SECURITY: strictly a development aid. It fails closed by default — it is only
// reachable when NODE_ENV !== "production" AND ENABLE_PRISMA_STUDIO_PROXY=true
// is explicitly set, so it can never be publicly exposed in production.
app.use("/prisma-studio", (req, res) => {
  const prismaStudioEnabled =
    process.env.NODE_ENV !== "production" &&
    process.env.ENABLE_PRISMA_STUDIO_PROXY === "true";
  if (!prismaStudioEnabled) {
    return res.status(404).send("Not found");
  }

  // If request is exactly /prisma-studio, redirect to /prisma-studio/ (with trailing slash)
  if (req.originalUrl === "/prisma-studio") {
    return res.redirect(301, "/prisma-studio/");
  }

  const targetUrl = "http://127.0.0.1:5555" + req.url;
  
  const proxyReq = http.request(
    targetUrl,
    {
      method: req.method,
      headers: {
        ...req.headers,
        // Host header override for internal routing
        host: "127.0.0.1:5555",
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (err) => {
    console.error("[Prisma Studio Proxy Error]:", err instanceof Error ? err.message.substring(0, 50) : "Sanitized");
    res.status(502).send("Prisma Studio is starting up or unreachable. Please try again in a few seconds.");
  });

  req.pipe(proxyReq);
});


// Security Headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  xFrameOptions: process.env.NODE_ENV === "production" ? { action: "sameorigin" } : false,
}));

app.use((req, res, next) => {
  // Only generate CSP nonce for requests that might serve HTML (not pure API/JSON).
  // API endpoints (/api/*) never need a nonce; OAuth callback pages (/auth/*) do.
  const isApiRequest = req.path.startsWith("/api/");
  if (!isApiRequest) {
    res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
  }
  if (process.env.NODE_ENV === "production") {
    const nonce = res.locals.cspNonce || "";
    res.setHeader("Content-Security-Policy", [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      `script-src 'self' 'nonce-${nonce}'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https: wss:",
      "frame-src 'self' https://www.youtube.com https://accounts.google.com",
      "form-action 'self' https://appleid.apple.com",
    ].join("; "));
  }
  next();
});

// Sanitize user input to prevent XSS — only on state-changing methods (GETs have no user-controlled body)
app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  xss()(req, res, next);
});

app.use(compression());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// Lightweight structured audit logging for administrative and state-changing operations
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.path.startsWith('/api')) {
    res.on('finish', () => {
      const user = (req as any).user;
      if (user && (user.role === 'admin' || user.role === 'owner')) {
         const sensitivePaths = ['/api/auth/login', '/api/auth/refresh', '/api/auth/update-profile'];
         if (sensitivePaths.some(p => req.path.includes(p))) return;
         
         console.log(JSON.stringify({
           timestamp: new Date().toISOString(),
           actor: user.email,
           action: req.method,
           target: req.path,
           result: res.statusCode >= 400 ? "Failed" : "Success",
           role: user.role
         }));
      }
    });
  }
  next();
});

// ── Request / Performance Monitoring ─────────────────────────────────────────
app.use(requestLogger);

// Rate Limiting Security Enhancements
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000,
  skip: (req, res) => process.env.NODE_ENV !== "production",
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests from this IP, please try again after 15 minutes." }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // 15 attempts per 15-minute window per IP — tight brute-force protection
  // Do not throttle development: local iteration would otherwise lock the
  // developer out after a handful of test sign-ins, obscuring real bugs.
  skip: (req, res) => process.env.NODE_ENV !== "production",
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts from this IP, please try again after 15 minutes." }
});

// OAuth session polling must NOT share the tight authLimiter above (15 req /
// 15 min per IP). A single normal Google sign-in polls /api/auth/oauth-session
// every ~1.5 s while the account chooser is open; after ~22 s it would burn
// the entire budget, and on a shared campus NAT a handful of students exhaust
// it in seconds. From then on every poll returns 429, the client's poll reads
// "not successful", and the app reports "Sign-in was cancelled" even though
// the user really completed the sign-in. This endpoint is safe to allow
// generously: a session can only be minted via /api/auth/oauth-url (still
// capped by authLimiter), is one-time-use, bound to the oauth_state cookie or
// the same-origin-protected X-OAuth-State header, and PKCE-guarded for native
// flows. Key by state token so concurrent students
// behind one public IP cannot exhaust each other's allowance.
const oauthSessionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600, // ≈ 3 long (5 min) chooser sessions per token; token minting is capped elsewhere
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req, res) => process.env.NODE_ENV !== "production",
  keyGenerator: (req) => {
    const token = req.originalUrl.split("/api/auth/oauth-session/")[1]?.split(/[?/]/)[0];
    return token ? `oauth:${token}` : `oauth:ip:${ipKeyGenerator(req.ip || "unknown")}`;
  },
  message: { error: "Too many OAuth session checks. Please try again after 15 minutes." }
});

// Per-account authentication limiter. Keyed on the normalized email from the
// request body (never on IP alone) so rotating spoofed X-Forwarded-For values
// cannot be used to brute-force a single account.  This is the primary defense
// against the rate-limit bypass; the IP limiter above is defense-in-depth.
const accountAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15-minute window per account
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const raw = (req.body && typeof req.body.email === "string") ? req.body.email.trim().toLowerCase() : "";
    return raw ? `acct:${raw}` : `ip:${ipKeyGenerator(req.ip || "unknown")}`;
  },
  message: { error: "Too many authentication attempts for this account. Please try again after 15 minutes." }
});

// Use a wrapper to skip rate-limiting for static streaming and uploads (Safari chunking needs this)
app.use("/api/", (req, res, next) => {
  if (req.path.startsWith('/materials/pdf') || req.path.startsWith('/uploads')) {
    return next();
  }
  return generalLimiter(req, res, next);
});

app.use("/api/auth/login", authLimiter, accountAuthLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/verify-email", authLimiter);
app.use("/api/auth/resend-verification", authLimiter, accountAuthLimiter);
app.use("/api/auth/forgot-password", authLimiter, accountAuthLimiter);
app.use("/api/auth/reset-password", authLimiter, accountAuthLimiter);
// OAuth URL generation and callback endpoints — also rate-limited to prevent
// state-token farming and callback replay / brute-force attempts.
app.use("/api/auth/oauth-url", authLimiter);
app.use("/auth/callback", authLimiter);
// Protect the native Capacitor polling endpoint against brute-force enumeration.
app.use("/api/auth/oauth-session", oauthSessionLimiter);

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  skip: (req, res) => process.env.NODE_ENV !== "production",
  standardHeaders: true,
  legacyHeaders: false,
  // validate: false removed — trust proxy is configured; validation is safe to run.
  message: { error: "Too many admin requests from this IP, please try again after 15 minutes." }
});
app.use("/api/roster", adminLimiter);
app.use("/api/admin", adminLimiter);
app.use("/api/users/role", adminLimiter);
app.use("/api/mottos", adminLimiter);

// ── CSRF protection via custom request header ─────────────────────────────────
// Requires X-Requested-With on every non-safe API request.
// Safe methods (GET/HEAD/OPTIONS) are exempt — they don't mutate state.
// OAuth provider callbacks live under /auth/ (not /api/), so they're also exempt.
//
// Why this works:
//   1. HTML form submissions and cross-origin redirected POSTs cannot set custom
//      headers, so they will always be rejected here.
//   2. Cross-origin XHR/fetch that does include the header must first pass a CORS
//      preflight.  In production, our CORS whitelist rejects non-approved origins,
//      so the preflight fails and the browser never sends the credentialed request.
//   3. All apiClient calls (frontend) now set this header automatically.
//   4. The native Capacitor polling path (GET /api/auth/oauth-session/:token) is
//      a GET, so it is exempt.  The token response there is the intentional
//      carve-out for native — no cookie is available in Capacitor's WebView.
function requireXRequestedWith(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (!req.headers["x-requested-with"]) {
    return res.status(403).json({ error: "Forbidden: missing X-Requested-With header." });
  }

  // Header presence alone is not a CSRF token. Bind cookie-backed mutations to
  // an exact configured origin; bearer/native requests may legitimately omit it.
  const origin = req.get("origin");
  const referer = req.get("referer");
  const hasBearer = typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ");
  if (origin) {
    const allowed = getCorsOrigins().some((allowedOrigin) =>
      allowedOrigin instanceof RegExp ? allowedOrigin.test(origin) : allowedOrigin === origin
    );
    if (!allowed) return res.status(403).json({ error: "Forbidden: invalid request origin." });
  } else if (req.cookies?.auth_token && !referer && !hasBearer) {
    return res.status(403).json({ error: "Forbidden: missing CSRF origin proof." });
  }
  next();
}
app.use("/api/", requireXRequestedWith);


// ── OAuth state/session handoff store ─────────────────────────────────────────
// OAuth callbacks may land on a different Render instance than the one that
// created the authorization URL, and a process restart must not invalidate a
// user who is already at Google/Apple. Store only short-lived flow metadata in
// the existing Supabase-backed SystemSetting table. State values are consumed
// with an atomic DELETE ... RETURNING; Google handoff records remain short-lived
// and PKCE-bound so a lost Safari response can be retried safely.
type OAuthStateRecord = {
  expiresAt: number;
  provider: string;
  codeChallenge?: string;
  /** The validated app origin that started this flow (needed after redirect). */
  returnOrigin?: string;
};

type OAuthSessionRecord = {
  userId?: string;
  email?: string;
  authorizationCode?: string;
  provider?: string;
  redirectUri?: string;
  codeChallenge?: string;
  /** Set to true when domain restriction fires so polling can distinguish it from cancel. */
  rejected?: true;
  /** Kept only for same-browser popup fallback; native polling mints a fresh token after consume. */
  token?: string;
  /** Set while a form_post callback is exchanging Apple's single-use code. */
  processing?: true;
  /** Set when the callback reached a terminal provider/server failure. */
  failed?: true;
  /** Generic, non-sensitive failure text for the browser polling handoff. */
  failureMessage?: string;
  /** Validated frontend origin retained after the one-time state is consumed. */
  returnOrigin?: string;
  expiresAt: number;
};

const OAUTH_STATE_KEY_PREFIX = "__oauth_state__:";
const OAUTH_SESSION_KEY_PREFIX = "__oauth_session__:";
const OAUTH_STORE_RETENTION_MS = 10 * 60 * 1000;

function oauthStoreKey(prefix: string, token: string): string {
  return `${prefix}${token}`;
}

async function writeOAuthStoreValue(key: string, value: unknown): Promise<void> {
  const client = getPrisma();
  const now = new Date();
  await client.systemSetting.upsert({
    where: { key },
    update: { value: JSON.stringify(value), updatedAt: now },
    create: { key, value: JSON.stringify(value), updatedAt: now },
  });
}

async function readOAuthStoreValue<T>(key: string): Promise<T | null> {
  const row = await getPrisma().systemSetting.findUnique({ where: { key } });
  if (!row || typeof row.value !== "string") return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

async function consumeOAuthStoreValue<T>(key: string): Promise<T | null> {
  const rows = await getPrisma().$queryRaw`
    DELETE FROM "SystemSetting"
    WHERE "key" = ${key}
    RETURNING "value"
  ` as Array<{ value?: unknown }>;
  const rawValue = rows[0]?.value;
  if (typeof rawValue !== "string") return null;
  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return null;
  }
}

async function readOAuthState(token: string): Promise<OAuthStateRecord | null> {
  const state = await readOAuthStoreValue<OAuthStateRecord>(oauthStoreKey(OAUTH_STATE_KEY_PREFIX, token));
  if (!state || state.expiresAt < Date.now()) return null;
  return state;
}

async function consumeOAuthState(token: string): Promise<OAuthStateRecord | null> {
  const state = await consumeOAuthStoreValue<OAuthStateRecord>(oauthStoreKey(OAUTH_STATE_KEY_PREFIX, token));
  if (!state || state.expiresAt < Date.now()) return null;
  return state;
}

async function writeOAuthState(token: string, state: OAuthStateRecord): Promise<void> {
  await writeOAuthStoreValue(oauthStoreKey(OAUTH_STATE_KEY_PREFIX, token), state);
}

async function readOAuthSession(token: string): Promise<OAuthSessionRecord | null> {
  const session = await readOAuthStoreValue<OAuthSessionRecord>(oauthStoreKey(OAUTH_SESSION_KEY_PREFIX, token));
  if (!session || session.expiresAt < Date.now()) return null;
  return session;
}

async function consumeOAuthSession(token: string): Promise<OAuthSessionRecord | null> {
  const session = await consumeOAuthStoreValue<OAuthSessionRecord>(oauthStoreKey(OAUTH_SESSION_KEY_PREFIX, token));
  if (!session || session.expiresAt < Date.now()) return null;
  return session;
}

async function writeOAuthSession(token: string, session: OAuthSessionRecord): Promise<void> {
  await writeOAuthStoreValue(oauthStoreKey(OAUTH_SESSION_KEY_PREFIX, token), session);
}

async function cleanupOAuthStore(): Promise<void> {
  try {
    await getPrisma().systemSetting.deleteMany({
      where: {
        updatedAt: { lt: new Date(Date.now() - OAUTH_STORE_RETENTION_MS) },
        OR: [
          { key: { startsWith: OAUTH_STATE_KEY_PREFIX } },
          { key: { startsWith: OAUTH_SESSION_KEY_PREFIX } },
          { key: { startsWith: "__revoked_session__:" } },
        ],
      },
    });
  } catch {
    // Cleanup is best-effort; expiry checks still reject old records safely.
  }
}

const _oauthStoreCleanup = setInterval(() => { void cleanupOAuthStore(); }, OAUTH_STORE_RETENTION_MS);
if (typeof _oauthStoreCleanup.unref === "function") _oauthStoreCleanup.unref();

// ── HTML-escape helper ────────────────────────────────────────────────────────
// Prevents reflected/stored XSS when provider- or user-controlled values are
// interpolated into manually generated HTML responses (error pages, callbacks).
// NOTE: values interpolated into <script> JS strings must also be passed
// through JSON.stringify — escapeHtml alone is insufficient for JS contexts.
function escapeHtml(str: unknown): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === "production"
  ? (() => {
      console.error("FATAL ERROR: JWT_SECRET must be provided in production environment.");
      process.exit(1);
    })()
  : (() => {
      // Development-only fallback — never reaches production (process.exit above).
      // Generate a random secret each startup so no known value is ever embedded
      // in the repository. Sessions will not survive server restarts in dev,
      // which is acceptable. Set JWT_SECRET in .env to get persistent sessions.
      const devSecret = crypto.randomBytes(32).toString("hex");
      console.warn(
        "[SECURITY WARNING] JWT_SECRET is not set. Using a randomly-generated ephemeral " +
        "key — sessions will not survive server restarts. Set JWT_SECRET in .env."
      );
      return devSecret;
    })());

// ── Server-side JWT revocation (real logout) ─────────────────────────────────
// Keep a local cache for hot-path repeat checks, while persisting the hashed
// token in the existing shared SystemSetting store so logout survives restarts
// and multiple backend instances. The raw bearer is never persisted.
const revokedTokens = new Map<string, number>();
async function revokeToken(rawToken: string): Promise<void> {
  if (!rawToken) return;
  let expMs = 0;
  try {
    const decoded = jwt.decode(rawToken) as { exp?: number } | null;
    if (decoded && typeof decoded.exp === "number") expMs = decoded.exp * 1000;
  } catch { /* ignore malformed tokens */ }
  if (expMs <= Date.now()) return;
  const hash = getRevokedSessionKey(rawToken);
  revokedTokens.set(hash, expMs);
  await writeOAuthStoreValue(hash, { expiresAt: expMs });
}
async function isRevokedToken(rawToken: string): Promise<boolean> {
  if (!rawToken) return false;
  const hash = getRevokedSessionKey(rawToken);
  const localExpiry = revokedTokens.get(hash);
  if (localExpiry !== undefined) {
    if (localExpiry > Date.now()) return true;
    revokedTokens.delete(hash);
  }
  try {
    const record = await readOAuthStoreValue<{ expiresAt?: unknown }>(hash);
    if (isRevocationActive(record)) {
      revokedTokens.set(hash, record!.expiresAt as number);
      return true;
    }
    if (record) {
      await getPrisma().systemSetting.deleteMany({ where: { key: hash } });
    }
  } catch {
    // The existing local cache remains authoritative during a shared-store
    // outage; protected routes still perform their normal DB user check.
  }
  return false;
}
const _revokedCleanup = setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of revokedTokens.entries()) if (exp < now) revokedTokens.delete(k);
}, 10 * 60 * 1000);
if (typeof _revokedCleanup.unref === "function") _revokedCleanup.unref();

// Dynamic configuration of server uploads storage
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const MATERIALS_UPLOADS_DIR = path.join(process.cwd(), "uploads", "materials");

async function ensureUploadsDir() {
  try {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.mkdir(MATERIALS_UPLOADS_DIR, { recursive: true });
  } catch (e: any) {
    // { recursive: true } means EEXIST is never thrown in Node ≥ 12;
    // any error here is a real problem (permissions, disk full, etc.).
    logger.error("[Storage]", `Failed to create uploads directory: ${e.message}`);
  }
}
ensureUploadsDir();

// ── Storage configuration diagnostics ────────────────────────────────────────
// Run at module load so misconfiguration is surfaced immediately in the log,
// not silently at the moment a user tries to download a file.
const _S3_VARS = {
  AWS_ACCESS_KEY_ID:     !!process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: !!process.env.AWS_SECRET_ACCESS_KEY,
  AWS_REGION:            !!process.env.AWS_REGION,
  AWS_S3_BUCKET_NAME:    !!process.env.AWS_S3_BUCKET_NAME,
};
const S3_CONFIGURED =
  _S3_VARS.AWS_ACCESS_KEY_ID &&
  _S3_VARS.AWS_SECRET_ACCESS_KEY &&
  _S3_VARS.AWS_REGION &&
  _S3_VARS.AWS_S3_BUCKET_NAME;
const S3_PARTIAL = Object.values(_S3_VARS).some(Boolean) && !S3_CONFIGURED;

if (S3_CONFIGURED) {
  logger.info("[Storage]", "✅ S3 fully configured — cloud presigned-URL generation active.");
} else if (S3_PARTIAL) {
  const missing = Object.entries(_S3_VARS)
    .filter(([, present]) => !present)
    .map(([key]) => key)
    .join(", ");
  logger.warn("[Storage]",
    `⚠️  Partial S3 configuration — missing: ${missing}. ` +
    "All four AWS_* variables must be set to enable cloud storage. Falling back to local storage."
  );
} else {
  logger.info("[Storage]", "Local filesystem storage active (no S3 credentials configured).");
}

if (process.env.NODE_ENV === "production") {
  // Render's local disk is ephemeral — it is wiped on restart/deploy. New
  // uploads are persisted to PostgreSQL (durable), so the local uploads dir is
  // only a transient multer staging area. This warning ensures operators never
  // assume files placed under ./uploads are permanent.
  logger.info("[Storage]",
    "Production storage: PDFs are persisted to PostgreSQL (durable). " +
    "The ./uploads directory is a transient staging area on Render's ephemeral filesystem and is NOT durable. " +
    "Legacy local files will be migrated into the database on startup."
  );
}

// Lazy S3 SDK singleton — modules and client loaded only once on first use.
// This avoids re-importing and re-constructing the SDK on every presigned-URL request.
let _s3: { client: any; GetObjectCommand: any; getSignedUrl: any } | null = null;
async function getS3(): Promise<{ client: any; GetObjectCommand: any; getSignedUrl: any } | null> {
  if (!S3_CONFIGURED) return null;
  if (!_s3) {
    const [{ S3Client, GetObjectCommand }, { getSignedUrl }] = await Promise.all([
      import("@aws-sdk/client-s3"),
      import("@aws-sdk/s3-request-presigner"),
    ]);
    _s3 = {
      client: new S3Client({ region: process.env.AWS_REGION }),
      GetObjectCommand,
      getSignedUrl,
    };
  }
  return _s3;
}

const pdfLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  skip: () => process.env.NODE_ENV !== "production",
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many PDF requests. Please retry shortly." },
});

app.use("/uploads", requireUser, pdfLimiter, (req, res, next) => {
  if (path.extname(req.path).toLowerCase() !== ".pdf") {
    return res.status(404).send("Not found");
  }
  next();
}, express.static(UPLOADS_DIR, {
  dotfiles: "deny",   // never serve hidden files (e.g. .htaccess, .env backups)
  setHeaders: (res, filePath) => {
    res.setHeader("Cache-Control", "private, no-store");
    if (filePath.toLowerCase().endsWith('.pdf')) {
      // Force inline display — browsers open PDFs in-tab, never download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
  }
}));
// Note: /uploads already covers /uploads/materials/* correctly because express.static
// strips the mount prefix and resolves sub-paths within UPLOADS_DIR.

// ── Upload resource protections ──────────────────────────────────────────────
// Academic PDFs are stored in the private Supabase Storage bucket.
// The Free plan enforces a 50 MB maximum per object, so validate that limit
// before sending data to Storage and keep only metadata in PostgreSQL.
const MAX_PDF_UPLOAD_BYTES = 50 * 1024 * 1024; // Supabase Free: 50 MB per file
const MAX_CONCURRENT_UPLOADS = 2;

// Configure multer storage structure
const fileFilter = (req: any, file: any, cb: any) => {
  if (file.mimetype === "application/pdf") {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type. Only PDF files are allowed."));
  }
};

// Configure multer for materials storage structure
const materialsStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, MATERIALS_UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueId = crypto.randomUUID();
    let ext = '';
    ext = ".pdf";
    cb(null, `${uniqueId}${ext}`);
  }
});


const uploadMaterials = multer({
  storage: materialsStorage,
  limits: {
    fileSize: MAX_PDF_UPLOAD_BYTES,
    files: 1,     // single PDF per request — no multi-file batches
    fields: 6,    // title, type, lectureId (+ future metadata)
    parts: 8,     // fields + files, hard ceiling on multipart complexity
  },
  fileFilter
});

// ── Approved external URL allowlist ──────────────────────────────────────────
// Materials may only link to HTTPS resources on hosts approved for educational
// content. YouTube hosts are allowed by default; deployers can add more via
// ALLOWED_EXTERNAL_URL_HOSTS (comma-separated). Relative same-origin paths
// (local uploads / DB-backed PDF endpoints) are always permitted.
const DEFAULT_APPROVED_EXTERNAL_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
]);

function getApprovedExternalHosts(): Set<string> {
  const extra = (process.env.ALLOWED_EXTERNAL_URL_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const hosts = new Set(DEFAULT_APPROVED_EXTERNAL_HOSTS);
  for (const h of extra) hosts.add(h);
  return hosts;
}

/** Same-origin relative paths and approved HTTPS external hosts only. */
function isApprovedExternalUrl(rawUrl: string): boolean {
  if (!rawUrl) return false;
  if (rawUrl.startsWith("/")) return true; // same-origin /uploads or /api path
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return getApprovedExternalHosts().has(host);
}

// ── Durable storage migration ────────────────────────────────────────────────
// Render's filesystem is ephemeral — files written to the local uploads dir can
// disappear on restart/deploy. New uploads are already persisted to PostgreSQL
// (bytea) immediately after the multer temp write. This best-effort, bounded
// one-way migration folds any legacy local /uploads files still referenced by
// materials (fileData === NULL) into the durable database. It is idempotent:
// once a row has fileData it is skipped on subsequent boots.
async function migrateLegacyLocalFilesToDb(): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  let prismaClient;
  try {
    prismaClient = getPrisma();
    const materials = await prismaClient.material.findMany({
      where: {
        fileData: null,
        fileUrlOrLink: { startsWith: "/uploads/" },
      },
      select: { id: true, fileUrlOrLink: true },
    });
    if (materials.length === 0) return;
    logger.info("[Storage]", `Found ${materials.length} legacy local material(s); migrating to durable database storage.`);
    let migrated = 0;
    let skipped = 0;
    const uploadsRoot = path.resolve(UPLOADS_DIR);
    for (const m of materials) {
      try {
        const rel = String(m.fileUrlOrLink).replace(/^\/uploads\//, "");
        const filePath = path.resolve(uploadsRoot, rel);
        // Path-traversal guard: resolved file must live under the uploads root.
        if (filePath !== uploadsRoot && !filePath.startsWith(uploadsRoot + path.sep)) {
          skipped += 1;
          continue;
        }
        const stat = await fs.stat(filePath);
        if (!stat.isFile() || stat.size === 0 || stat.size > MAX_PDF_UPLOAD_BYTES) {
          skipped += 1;
          continue;
        }
        const buf = await fs.readFile(filePath);
        if (buf.length < 5 || buf.subarray(0, 5).toString("ascii") !== "%PDF-") {
          skipped += 1;
          continue;
        }
        await prismaClient.material.update({
          where: { id: m.id },
          data: { fileData: buf },
        });
        migrated += 1;
      } catch (e: any) {
        if (e?.code === "ENOENT") skipped += 1;
        else logger.warn("[Storage]", `Legacy migration skipped material ${m.id}: ${e?.message ?? "unknown error"}`);
      }
    }
    logger.info("[Storage]", `Legacy migration complete: ${migrated} migrated, ${skipped} skipped.`);
  } catch (e: any) {
    logger.error("[Storage]", `Legacy migration failed: ${e?.message ?? "unknown error"}`);
  }
}


// Single endpoint /api/upload that receives a file and returns its static state local URL

// Real-Time Socket Presence state storage


io.on("connection", (socket) => {

  // SECURITY: Identity on the socket is established ONLY from a JWT verified
  // against JWT_SECRET. A raw client-claimed userId (auth/query) is NEVER trusted
  // for presence writes or socket binding — trusting it allowed any client to
  // take over another user's presence/socket. Anonymous sockets get no identity.
  const verifiedUserId = socket.data.userId as string;
  const handshakeUserId = verifiedUserId;

  if (handshakeUserId && handshakeUserId.trim()) {
    socket.data.userId = handshakeUserId;
    socket.data.verified = true;
    // Async handshake work is isolated in a void IIFE so Socket.IO never receives
    // a hanging promise — unhandled rejections from async socket listeners are
    // silently discarded by Socket.IO and can crash the process in Node ≥18.
    void (async () => {
      const client = getPrisma();
      try {
        const updatedUser = await client.user.update({
          where: { id: handshakeUserId },
          data: { isOnline: true, lastActive: new Date(), lastSeen: new Date(), socketId: socket.id },
          select: { email: true, studentGroup: true },
        });
        socket.data.userEmail = updatedUser.email;
        // Join the user's group room so targeted announcements can be scoped
        if (updatedUser.studentGroup) {
          socket.join("group:" + updatedUser.studentGroup);
        }

        // Broadcast new status immediately
        io.to("authenticated").emit('userStatusChanged', { email: updatedUser.email, isOnline: true });
        io.to("authenticated").emit('userStatusUpdate', { email: updatedUser.email, isOnline: true });

        // Notify other connected clients of presence status update
        const liveOnline = await client.user.findMany({ where: { isOnline: true }, select: { id: true, name: true, email: true, lastActive: true } });
        io.to("authenticated").emit("presence-update", liveOnline.map(u => ({
          userId: u.id,
          name: u.name || u.email.split("@")[0],
          status: "Online",
          lastActive: u.lastActive.toISOString()
        })));
      } catch (err: any) {
        // P2025 = user not found (handshake with stale/invalid userId) — safe to ignore
        if (err?.code !== 'P2025') {
          logger.error("[Socket]", `Handshake DB error for ${handshakeUserId.substring(0, 8)}: ${err instanceof Error ? err.message.substring(0, 80) : 'Unknown'}`);
        }
      }
    })();
  }

  // Modern Socket Event: registerUser using Prisma's upsert method
  socket.on("registerUser", (userData: any) => { void (async () => {
    if (!userData) return;

    // SECURITY: Presence/profile writes require a JWT-verified identity. Anonymous
    // sockets can no longer claim a victim's id/email to flip their presence,
    // overwrite their row, or hijack their socket. Verified sockets act only on
    // their own verified id — client-supplied id/email are never used to target a row.
    if (!verifiedUserId) {
      logger.warn("[Socket registerUser]", `Rejected unauthenticated registerUser from ${socket.id} — no verified identity.`);
      return;
    }

    const userId = verifiedUserId;
    const emailVal = (userData.email || "").trim().toLowerCase();
    if (!emailVal) return;

    const client = getPrisma();
    try {
      // The row targeted is pinned to the verified user's own id ONLY — never
      // looked up by client-provided email/id. Email is NOT in updateData at all:
      // the DB value is authoritative and cannot be changed or squatted via sockets.
      //
      // ARCHITECTURAL INVARIANT: Socket registration is a PRESENCE operation only.
      // It must NEVER write profile fields (avatar, avatarUrl, name, email, signature,
      // academic info) to the database. Profile data is modified exclusively through
      // authenticated HTTP endpoints (/api/auth/update-profile). This prevents socket
      // reconnects from overwriting valid profile data with stale or placeholder values.
      const u = await client.user.update({
        where: { id: userId },
        data: {
          isOnline: true,
          lastActive: new Date(),
          lastSeen: new Date(),
          socketId: socket.id,
        },
        select: { email: true, studentGroup: true },
      });

      // Attach tracking data to the socket instance
      socket.data.userId = userId;
      socket.data.userEmail = u.email;
      socket.data.verified = true;

      // Immediately use io.emit('userStatusChanged' / 'userStatusUpdate') to broadcast this change to ALL connected clients.
      io.to("authenticated").emit('userStatusChanged', { email: u.email, isOnline: true });
      io.to("authenticated").emit('userStatusUpdate', { email: u.email, isOnline: true });

      // Join the user's group room for targeted announcement broadcasts
      if (u.studentGroup) {
        socket.join("group:" + u.studentGroup);
      }

      // Legacy fallback memory update helper if needed
      try {
        await UserService.updateUser({ id: userId, isOnline: true });
      } catch (err) {
        logger.error("[Socket registerUser]", `UserService sync failed for ${userId.substring(0, 8)}: ${err instanceof Error ? err.message.substring(0, 50) : 'Unknown'}`);
      }

      // Emit update lists query directly and physically from the database
      const liveOnline = await client.user.findMany({ where: { isOnline: true }, select: { id: true, name: true, email: true, lastActive: true } });
      io.to("authenticated").emit("presence-update", liveOnline.map(onlineUser => ({
        userId: onlineUser.id,
        name: onlineUser.name || onlineUser.email.split("@")[0],
        status: "Online",
        lastActive: onlineUser.lastActive ? onlineUser.lastActive.toISOString() : new Date().toISOString()
      })));
    } catch (err) {
      logger.error("[Socket registerUser]", `Database error: ${err instanceof Error ? err.message.substring(0, 50) : "Sanitized"}`);
    }
  })().catch(err => logger.error("[Socket registerUser]", `Unhandled rejection: ${err instanceof Error ? err.message.substring(0, 80) : 'Unknown'}`)); });

  socket.on("disconnect", () => { void (async () => {
    const userId = socket.data.userId;
    const socketId = socket.id;
    const userEmail = socket.data.userEmail;

    try {
      const client = getPrisma();
      
      // Look up candidate users with this specific socketId or matching details to broadcast correct offline notifications
      const candidateUsers = await client.user.findMany({
        where: {
          OR: [
            { socketId: socketId },
            userId ? { id: userId } : null
          ].filter(Boolean) as any
        }
      });

      // Secure updateMany update to flag disconnected users as offline
      await client.user.updateMany({
        where: {
          OR: [
            { socketId: socketId },
            userId ? { id: userId } : null
          ].filter(Boolean) as any
        },
        data: {
          isOnline: false,
          lastSeen: new Date()
        }
      });

      // Broadcast offline changes
      const loggedEmails = new Set<string>();
      if (userEmail) loggedEmails.add(userEmail.toLowerCase());
      for (const u of candidateUsers) {
        loggedEmails.add(u.email.toLowerCase());
      }

      for (const email of loggedEmails) {
        io.to("authenticated").emit('userStatusChanged', { email: email, isOnline: false });
        io.to("authenticated").emit('userStatusUpdate', { email: email, isOnline: false });
      }

      // Maintain backward compatibility with the JSON legacy database fallback if needed
      if (userId) {
        try {
          await UserService.updateUser({ id: userId, isOnline: false });
        } catch (err) {
          logger.error("[Socket disconnect]", `UserService sync failed for ${userId.substring(0, 8)}: ${err instanceof Error ? err.message.substring(0, 50) : 'Unknown'}`);
        }
      }

      // Emit updated online presence lists directly and query physically from database
      const liveOnline = await client.user.findMany({ where: { isOnline: true }, select: { id: true, name: true, email: true, lastActive: true } });
      io.to("authenticated").emit("presence-update", liveOnline.map(onlineUser => ({
        userId: onlineUser.id,
        name: onlineUser.name || onlineUser.email.split("@")[0],
        status: "Online",
        lastActive: onlineUser.lastActive ? onlineUser.lastActive.toISOString() : new Date().toISOString()
      })));
    } catch (err) {
      logger.error("[Socket disconnect]", `Failed to update offline status: ${err instanceof Error ? err.message.substring(0, 80) : '[REDACTED_ERROR]'}`);
    }
  })().catch(err => logger.error("[Socket disconnect]", `Unhandled rejection: ${err instanceof Error ? err.message.substring(0, 80) : 'Unknown'}`)); });
});

// Storage path for catalog/academic materials
const MATERIALS_DB_PATH = path.join(process.cwd(), "materials_db.json");

// Helper to safely read academic/catalog database
async function readMaterialsDb() {
  try {
    const data = await fs.readFile(MATERIALS_DB_PATH, "utf-8");
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("materials_db.json must contain a JSON object");
    }

    // Legacy JSON is read-only catalog data. Never repair or overwrite it from a
    // GET request: a malformed/partial file must not be replaced by empty seeds.
    return {
      ...parsed,
      subjects: Array.isArray(parsed.subjects) ? parsed.subjects : seedSubjects,
      mcqs: Array.isArray(parsed.mcqs) ? parsed.mcqs : seedMcqs,
      flashcards: Array.isArray(parsed.flashcards) ? parsed.flashcards : seedFlashcards,
      videos: Array.isArray(parsed.videos) ? parsed.videos : seedVideos,
      calendarEvents: Array.isArray(parsed.calendarEvents) ? parsed.calendarEvents : [],
    };
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      throw error;
    }

    // A missing legacy file is not a reason to mutate state from a GET. Return
    // in-memory defaults; Prisma remains authoritative for mutable records.
    return {
      subjects: seedSubjects,
      mcqs: seedMcqs,
      flashcards: seedFlashcards,
      videos: seedVideos,
      calendarEvents: [],
    };
  }
}

// System initialization to boost schemas and seed credentials
async function initializeSystem() {
  try {
    // Force database verification
    const client = getPrisma();
    await client.$connect();

    // Optimize Search Performance with pg_trgm
    if (process.env.DATABASE_URL?.startsWith("postgres") || process.env.DATABASE_URL?.startsWith("postgresql")) {
      try {
        await client.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
        await client.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS lecture_name_trgm_idx ON "Lecture" USING gin (name gin_trgm_ops);`);
        await client.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS lecture_mainSubject_trgm_idx ON "Lecture" USING gin ("mainSubject" gin_trgm_ops);`);
        await client.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS material_title_trgm_idx ON "Material" USING gin (title gin_trgm_ops);`);
        await client.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS mcq_question_trgm_idx ON "Mcq" USING gin (question gin_trgm_ops);`);
        await client.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS flashcard_concept_trgm_idx ON "Flashcard" USING gin ("clinicalConcept" gin_trgm_ops);`);
        await client.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS flashcard_explanation_trgm_idx ON "Flashcard" USING gin (explanation gin_trgm_ops);`);
      } catch (err) {
        console.warn("Could not create pg_trgm indexes. Continuing without advanced indexing.", err);
      }
    }


    // Ensure materials catalogs are pre-loaded
    await readMaterialsDb();

    // Resiliency: clear any stale online users on server boots/starts
    try {
      const client = getPrisma();
      await client.user.updateMany({ data: { isOnline: false } });
    } catch (bootErr) {
      console.error("[System] Boot-up Resiliency update skipped/failed:", "[REDACTED_ERROR]");
    }
  } catch (error) {
    console.error("[System] Setup initialization failed:", error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
  }
}
// Removed immediate top-level invocation of initializeSystem to prevent startup race condition.
// It will be safely called inside startServer after database health verification.

// --- Backend REST API Endpoints ---

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ==========================================
// CUSTOM DATABASE ARCHITECTURE REST API ENDPOINTS
// ==========================================

// 1. Users CRUD Endpoints (/api/users)
// Users support fields: id, name, email, avatarUrl (from local storage), role, isOnline
app.get("/api/users", requireUser, catchAsync(async (req, res) => {
  try {
    // Send cache-control headers for client-side caching (stale-while-revalidate)
    res.setHeader("Cache-Control", "no-cache");

    // 1. Fetch from database using Prisma Client directly with absolute state
    try {
      const client = getPrisma();
      const limit = parseInt(req.query.limit as string) || 200;
      const isPrivileged = (req as any).user?.role === 'admin' || (req as any).user?.role === 'owner';
      const callerId = (req as any).user?.id;
      // Select only the fields the response actually uses — avoids fetching passwordHash,
      // avatar base64 blobs, deviceToken, preferences JSON, and other unused columns.
      const prismaUsers = await client.user.findMany({
        take: limit > 2000 ? 2000 : limit,
        orderBy: [{ isOnline: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          email: true,
          name: true,
          avatar: true,
          avatarUrl: true,
           role: true,
           isPrimaryOwner: true,
           isOnline: true,
          lastSeen: true,
          createdAt: true,
          updatedAt: true,
          studentGroup: true,
          accountStatus: true,
        },
      });
      const formatted = prismaUsers.map(u => ({
        id: u.id,
        email: (isPrivileged || u.id === callerId) ? u.email : undefined,
        name: u.name || u.email.split("@")[0],
        avatarUrl: u.avatarUrl || u.avatar || "",
        avatar: u.avatar || "",
         role: u.role,
         isPrimaryOwner: u.isPrimaryOwner === true,
         isOnline: u.isOnline,
        lastSeen: u.lastSeen,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
        studentGroup: u.studentGroup,
        accountStatus: String(u.accountStatus || "ACTIVE").toLowerCase(),
      }));
      return res.json(formatted);
    } catch (prismaErr) {
      // Fail closed. The legacy list contains progress/activity fields and
      // must never be used as a fallback for this general user endpoint.
      console.error(prismaErr); return res.status(503).json({ error: "User list temporarily unavailable.", retryable: true, msg: String(prismaErr) });
    }
  } catch (err: any) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}));





// 2. Content/Lectures CRUD Endpoints (/api/content)
// Content/Lectures support fields: title, youtubeUrl (string), pdfUrl (local URL from multer)
app.get("/api/content", requireUser, catchAsync(async (req, res) => {
  try {
    const db = await readMaterialsDb();
    const legacyContent = Array.isArray(db.content) ? db.content : (db.subjects || []).flatMap((s: any) =>
      (s.modules || []).flatMap((m: any) => (m.lectures || []).map((l: any) => ({
        id: l.id,
        title: l.title,
        youtubeUrl: l.youtubeUrl || "",
        pdfUrl: l.pdfUrl || "",
        notesPdfUrl: l.notesPdfUrl || "",
        doctorName: l.doctorName || "",
        description: l.description || "",
      })))
    );

    // Prisma is authoritative for mutable lecture/material records. The legacy
    // JSON catalog remains a read-only compatibility source during migration.
    const prismaClient = getPrisma();
    const dbLectures = await prismaClient.lecture.findMany({
      select: {
        id: true,
        name: true,
        materials: { select: { type: true, fileUrlOrLink: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    const contentById = new Map(legacyContent.map((item: any) => [item.id, item]));
    for (const lecture of dbLectures) {
      const pdf = lecture.materials.find((m: any) => m.type.toUpperCase() === "PDF");
      const note = lecture.materials.find((m: any) => m.type.toUpperCase() === "NOTE");
      const existingContent = contentById.get(lecture.id) as any;
      contentById.set(lecture.id, {
        ...(existingContent || {}),
        id: lecture.id,
        title: lecture.name,
        pdfUrl: pdf?.fileUrlOrLink || "",
        notesPdfUrl: note?.fileUrlOrLink || "",
      });
    }
    res.json(Array.from(contentById.values()));
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// Helper to generate a dynamic presigned URL (e.g., AWS S3).
// Falls back to a local relative URL if S3 is not configured.
async function generatePresignedUrl(rawUrl: string): Promise<string> {
  if (!rawUrl) return "";

  // Strip hardcoded localhost from old database entries to make it relative
  let cleanedUrl = rawUrl;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      cleanedUrl = parsed.pathname + parsed.search + parsed.hash;
    }
  } catch (_) {}

  // External HTTPS links are only returned when they point at an approved host
  // (e.g. YouTube). Arbitrary external URLs are never handed to the client.
  if (cleanedUrl.startsWith("http")) {
    return isApprovedExternalUrl(cleanedUrl) ? cleanedUrl : "";
  }

  // Relative URLs are served by this application. Do not invent an S3 URL for
  // local/database-backed files when S3 is merely configured for another use.
  if (cleanedUrl.startsWith("/api/materials/") || cleanedUrl.startsWith("/uploads/")) {
    return cleanedUrl;
  }

  // Extract the file key (e.g. "/uploads/materials/uuid.pdf" → "uuid.pdf")
  const fileKey = cleanedUrl
    .replace("/uploads/materials/", "")
    .replace("/uploads/", "")
    .replace("/assets/", "");

  try {
    const s3 = await getS3();   // returns null when S3 is not configured
    if (s3) {
      const command = new s3.GetObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME!,
        Key: fileKey,
      });
      // Fresh 1-hour presigned URL
      const presignedUrl = await s3.getSignedUrl(s3.client, command, { expiresIn: 3600 });
      return presignedUrl;
    }
  } catch (cloudErr: any) {
    logger.error("[Storage]",
      `S3 presigned URL generation failed for key "${fileKey}" — falling back to local URL: ${cloudErr?.message ?? "unknown"}`
    );
  }

  // Fallback: local relative URL
  return cleanedUrl.startsWith("/") ? cleanedUrl : `/uploads/materials/${cleanedUrl}`;
}

// 2b. Content/Lecture details by ID - Dynamically retrieves secure URLs
app.get("/api/content/:id", requireUser, catchAsync(async (req, res) => {
  try {
    const db = await readMaterialsDb();
    const contentList = Array.isArray(db.content) ? db.content : (db.subjects || []).flatMap((s: any) =>
      (s.modules || []).flatMap((m: any) => (m.lectures || []).map((l: any) => ({
        id: l.id,
        title: l.title,
        youtubeUrl: l.youtubeUrl || "",
        pdfUrl: l.pdfUrl || "",
        notesPdfUrl: l.notesPdfUrl || "",
        doctorName: l.doctorName || "",
        description: l.description || "",
      })))
    );
    let lecture = contentList.find((c: any) => c.id === req.params.id);

    if (!lecture) {
      const prismaClient = getPrisma();
      const dbLecture = await prismaClient.lecture.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          name: true,
          materials: { select: { type: true, fileUrlOrLink: true } },
        },
      });
      if (dbLecture) {
        const pdf = dbLecture.materials.find((m: any) => m.type.toUpperCase() === "PDF");
        const note = dbLecture.materials.find((m: any) => m.type.toUpperCase() === "NOTE");
        lecture = {
          id: dbLecture.id,
          title: dbLecture.name,
          youtubeUrl: "",
          pdfUrl: pdf?.fileUrlOrLink || "",
          notesPdfUrl: note?.fileUrlOrLink || "",
          doctorName: "",
          description: "",
        };
      }
    }
    
    if (!lecture) {
      return res.status(404).json({ error: "Lecture not found" });
    }

    // Generate brand new, fresh secure URLs on the fly
    const securePdfUrl = await generatePresignedUrl(lecture.pdfUrl);
    const secureNotesUrl = await generatePresignedUrl(lecture.notesPdfUrl);

    // Return the lecture data with the fresh, active URLs
    res.json({
      ...lecture,
      pdfUrl: securePdfUrl,
      notesPdfUrl: secureNotesUrl
    });
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}));





// 3. Quizzes (MCQs) CRUD Endpoints (/api/quizzes)
// Quizzes support fields: question, options (array/mapped), correctAnswer





// 4. Flashcards CRUD Endpoints (/api/flashcards)
app.get("/api/flashcards/progress", requireUser, catchAsync(async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-cache");
    const prismaClient = getPrisma();
    const userId = (req as any).user.id;
    const progress = await prismaClient.flashcardProgress.findMany({
      where: { userId }
    });
    const stats: Record<string, string> = {};
    for (const p of progress) {
      stats[p.flashcardId] = p.status;
    }
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

app.post("/api/flashcards/batch-progress", requireUser, catchAsync(async (req, res) => {
  try {
    const prismaClient = getPrisma();
    const userId = (req as any).user.id;
    const { updates } = req.body;
    if (!updates || typeof updates !== "object") {
      return res.status(400).json({ error: "Invalid updates payload" });
    }

    const upserts = [];
    for (const [flashcardId, status] of Object.entries(updates)) {
      if (typeof status === "string") {
        upserts.push(
          prismaClient.flashcardProgress.upsert({
            where: { userId_flashcardId: { userId, flashcardId } },
            update: { status },
            create: { userId, flashcardId, status }
          })
        );
      }
    }
    await prismaClient.$transaction(upserts);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// Flashcards support fields: frontText, backText
app.get("/api/flashcards", requireUser, catchAsync(async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-cache");
    const db = await readMaterialsDb();
    const jsonCards = db.flashcards.map((f: any) => ({
      ...f,
      frontText: f.frontText || f.front || "",
      backText: f.backText || f.back || "",
      front: f.front || f.frontText || "",
      back: f.back || f.backText || ""
    }));

    let sqlCards: any[] = [];
    try {
      const prismaClient = getPrisma();
      const dbCards = await prismaClient.flashcard.findMany({ take: 2000 });
      sqlCards = dbCards.map((f: any) => ({
        id: f.id,
        lectureId: f.lectureId,
        clinicalConcept: f.clinicalConcept,
        explanation: f.explanation,
        frontText: f.clinicalConcept,
        backText: f.explanation,
        front: f.clinicalConcept,
        back: f.explanation
      }));
    } catch (sqlErr) {
      console.warn("Could not query SQL flashcards table:", "[REDACTED_ERROR]");
    }

    // Merge lists, avoiding duplicates by id
    const cardMap = new Map();
    jsonCards.forEach((c: any) => cardMap.set(c.id, c));
    sqlCards.forEach((c: any) => cardMap.set(c.id, c));

    res.json(Array.from(cardMap.values()));
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

app.post("/api/flashcards", requireAdmin, catchAsync(async (req, res) => {
  try {
    const { clinicalConcept, explanation, frontText, backText, front, back, lectureId } = req.body;
    
    // Resolve frontend naming variations gracefully!
    const textFront = clinicalConcept || frontText || front;
    const textBack = explanation || backText || back;
    const targetLectureId = typeof lectureId === "string" ? lectureId.trim() : "";

    if (!textFront || !textBack || !targetLectureId) {
      return res.status(400).json({ error: "Front text (clinicalConcept) and back text (explanation) are required." });
    }

    const prismaClient = getPrisma();
    const lectureExists = await prismaClient.lecture.findUnique({ where: { id: targetLectureId } });
    if (!lectureExists) {
      return res.status(404).json({ error: `Lecture with ID ${targetLectureId} not found.` });
    }

    // Prisma is the write authority for mutable academic records. Legacy JSON
    // flashcards remain read-only until a deliberate data migration is run.
    const sqlCard = await prismaClient.flashcard.create({
      data: {
        id: crypto.randomUUID(),
        clinicalConcept: textFront,
        explanation: textBack,
        lectureId: targetLectureId,
      },
    });
    const newJsonCard = {
      ...sqlCard,
      front: sqlCard.clinicalConcept,
      back: sqlCard.explanation,
      frontText: sqlCard.clinicalConcept,
      backText: sqlCard.explanation,
    };

    await syncContentUpsert("Flashcard", toFlashcardContentRow(sqlCard));

    invalidateMaterialsCache();
    io.to("authenticated").emit("materials_updated");
    res.status(201).json({
      success: true,
      card: newJsonCard,
      createdInSql: true,
      sqlCard
    });
  } catch (err: any) {
    console.error("[Post Flashcard Error]:", err instanceof Error ? err.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// ADD (Admin) new Lecture
app.get("/api/lectures", requireUser, catchAsync(async (req, res) => {
  try {
    const forceRefresh = req.get("cache-control") === "no-cache";

    const where: any = {};
    const filters = ["mainSubject", "subSubject", "trackMode", "department"] as const;
    const d1Params = new URLSearchParams();

    for (const field of filters) {
      const value = req.query[field];
      if (typeof value === "string" && value.trim()) {
        const normalizedValue = value.trim();
        where[field] = { equals: normalizedValue, mode: "insensitive" };
        d1Params.set(field, normalizedValue);
      }
    }

    // IMPORTANT:
    // lecturesCache stores the unfiltered/global lecture list only.
    // Never return that cache for a path-filtered request.
    const hasPathFilters = Object.keys(where).length > 0;

    if (
      !hasPathFilters &&
      !forceRefresh &&
      lecturesCache &&
      lecturesCache.expiresAt > Date.now()
    ) {
      res.setHeader("X-Content-Read-Source", "memory-cache");
      return res.json(lecturesCache.data);
    }

    if (contentD1ReadsEnabled()) {
      try {
        const query = d1Params.toString();
        const lectures = await fetchContentReadJson<any[]>(
          `/lectures${query ? `?${query}` : ""}`,
        );

        if (!Array.isArray(lectures)) {
          throw new Error("Content Worker lecture list returned an invalid payload.");
        }

        if (!hasPathFilters) {
          lecturesCache = {
            data: lectures,
            expiresAt: Date.now() + 30_000,
          };
        }

        res.setHeader("X-Content-Read-Source", "d1");
        return res.json(lectures);
      } catch (error: any) {
        logger.warn(
          "[ContentRead]",
          `D1 lecture list read failed; falling back to Supabase: ${error?.message ?? "unknown error"}`,
        );
      }
    }

    const prismaClient = getPrisma();
    const lectures = await prismaClient.lecture.findMany({
      where,
      include: {
        materials: {
          select: {
            id: true,
            title: true,
            type: true,
            fileUrlOrLink: true,
            lectureId: true,
            createdAt: true,
          },
        },
        // Search only needs existence/counts from the list endpoint. Full
        // question/card payloads are fetched by /api/lectures/:id on demand.
        mcqs: { select: { id: true } },
        flashcards: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!hasPathFilters) {
      lecturesCache = {
        data: lectures,
        expiresAt: Date.now() + 30_000,
      };
    }

    res.setHeader(
      "X-Content-Read-Source",
      contentD1ReadsEnabled() ? "supabase-fallback" : "supabase",
    );
    return res.json(lectures);
  } catch (error) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
}));

app.post("/api/lectures", requireAdmin, catchAsync(async (req, res) => {
  try {
    const { name, mainSubject, subSubject, trackMode, department } = req.body;

    if (!name || !mainSubject || !trackMode) {
      return res.status(400).json({ error: "Missing required fields: name, mainSubject, trackMode are required." });
    }

    const prismaClient = getPrisma();

    const lecture = await prismaClient.lecture.create({
      data: {
        name,
        mainSubject,
        subSubject: subSubject || null,
        trackMode,
        department: department || null,
      }
    });

    await syncContentUpsert("Lecture", toLectureContentRow(lecture));

    invalidateMaterialsCache();
    io.to("authenticated").emit("lecture_created", lecture);
    res.status(201).json(lecture);
  } catch (err: any) {
    console.error("[Post Lecture Error]:", err instanceof Error ? err.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

app.get("/api/lectures/:id", requireUser, catchAsync(async (req, res) => {
  try {
    if (contentD1ReadsEnabled()) {
      try {
        const lecture = await fetchContentReadJson<any>(
          `/lectures/${encodeURIComponent(req.params.id)}`,
        );

        res.setHeader("X-Content-Read-Source", "d1");
        return res.json(lecture);
      } catch (error: any) {
        // A 404 can occur briefly after a successful authoritative Supabase write
        // if the D1 mirror is queued for retry. Falling back keeps the public API
        // strongly correct while Stage 4's outbox repairs the replica.
        logger.warn(
          "[ContentRead]",
          `D1 lecture detail read failed for ${req.params.id}; falling back to Supabase: ${error?.message ?? "unknown error"}`,
        );
      }
    }

    const prismaClient = getPrisma();
    const lecture = await prismaClient.lecture.findUnique({
      where: { id: req.params.id },
      include: {
        materials: {
          select: {
            id: true,
            title: true,
            type: true,
            fileUrlOrLink: true,
            lectureId: true,
            createdAt: true,
          },
        },
        // The correct answer key is intentionally withheld from the client;
        // grading is performed server-side by POST /api/mcqs/submit.
        mcqs: {
          select: {
            id: true,
            question: true,
            optionA: true,
            optionB: true,
            optionC: true,
            optionD: true,
            hint: true,
            explanation: true,
            sourceType: true,
            sourceRef: true,
            difficulty: true,
            lectureId: true,
            createdAt: true,
          },
        },
        flashcards: true,
      },
    });

    if (!lecture) {
      return res.status(404).json({ error: "Lecture not found" });
    }

    res.setHeader(
      "X-Content-Read-Source",
      contentD1ReadsEnabled() ? "supabase-fallback" : "supabase",
    );
    return res.json(lecture);
  } catch (error) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
}));

app.delete("/api/lectures/:id", requireAdmin, catchAsync(async (req, res) => {
  try {
    const lectureId = req.params.id;
    const prismaClient = getPrisma();
    
    // Keep these administrative reads sequential so a rare content deletion
    // never opens multiple Supabase session-pool connections at once.
    const materials = await prismaClient.material.findMany({ where: { lectureId } });
    const childMcqs = await prismaClient.mcq.findMany({ where: { lectureId }, select: { id: true } });
    const childFlashcards = await prismaClient.flashcard.findMany({ where: { lectureId }, select: { id: true } });
    
    for (const mat of materials) {
      if (mat.fileUrlOrLink && mat.fileUrlOrLink.startsWith("/uploads/materials/")) {
        const filePath = path.join(MATERIALS_UPLOADS_DIR, path.basename(mat.fileUrlOrLink));
        try {
          await fs.unlink(filePath);
        } catch (e: any) {
          if (e.code !== "ENOENT") {
            logger.warn("[Storage]", `Failed to delete local file during lecture deletion: ${e.message}`);
          }
        }
      }
    }
    
    await prismaClient.lecture.delete({ where: { id: lectureId } });

    for (const mat of materials) {
      if (mat.storagePath) {
        try { await deleteSupabaseStorageObject(mat.storagePath); } catch (e: any) {
          logger.warn("[Storage]", `Failed to delete Storage object after lecture deletion: ${e?.message ?? "unknown error"}`);
        }
      }
    }

    // D1 cascades Lecture deletion to Material/Mcq/Flashcard. Remove stale
    // queued child upserts so they cannot keep retrying after the parent is gone.
    try {
      await clearContentSyncOutboxMany([
        ...materials.map((mat: any) => ({ entity: "Material" as ContentSyncEntity, id: mat.id })),
        ...childMcqs.map((row: any) => ({ entity: "Mcq" as ContentSyncEntity, id: row.id })),
        ...childFlashcards.map((row: any) => ({ entity: "Flashcard" as ContentSyncEntity, id: row.id })),
      ]);
    } catch (clearError: any) {
      logger.warn("[ContentSync]", `Failed to clear child outbox entries for deleted lecture ${lectureId}: ${clearError?.message ?? "unknown error"}`);
    }
    await syncContentDelete("Lecture", lectureId);

    invalidateMaterialsCache();
    io.to("authenticated").emit("lecture_deleted", { lectureId });
    res.json({ success: true });
  } catch (err: any) {
    console.error("[Delete Lecture Error]:", err instanceof Error ? err.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

app.delete("/api/materials/:id", requireAdmin, catchAsync(async (req, res) => {
  try {
    const materialId = req.params.id;
    const prismaClient = getPrisma();
    
    const mat = await prismaClient.material.findUnique({
      where: { id: materialId }
    });
    
    if (mat) {
      if (mat.fileUrlOrLink && mat.fileUrlOrLink.startsWith("/uploads/materials/")) {
        const filePath = path.join(MATERIALS_UPLOADS_DIR, path.basename(mat.fileUrlOrLink));
        try {
          await fs.unlink(filePath);
        } catch (e: any) {
          if (e.code !== "ENOENT") {
            logger.warn("[Storage]", `Failed to delete local file during material deletion: ${e.message}`);
          }
        }
      }
      
      await prismaClient.material.delete({ where: { id: materialId } });

      if (mat.storagePath) {
        try { await deleteSupabaseStorageObject(mat.storagePath); } catch (e: any) {
          logger.warn("[Storage]", `Failed to delete Storage object after material deletion: ${e?.message ?? "unknown error"}`);
        }
      }
    }
    
    // Idempotent mirror delete: even if the Supabase row was already absent,
    // removing the same id from D1 is safe and converges stale replicas.
    await syncContentDelete("Material", materialId);

    invalidateMaterialsCache();
    io.to("authenticated").emit("materials_updated");
    res.json({ success: true });
  } catch (err: any) {
    console.error("[Delete Material Error]:", err instanceof Error ? err.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// 2. Material Routes
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  skip: () => process.env.NODE_ENV !== "production",
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many uploads. Please retry later." },
});

let activeUploads = 0;

app.post("/api/materials/upload", requireAdmin, uploadLimiter, (req: any, res: any, next: any) => {
  // Bounded concurrency: multer streams the file to disk, so at most
  // MAX_CONCURRENT_UPLOADS transfers may be in flight at any moment.
  if (activeUploads >= MAX_CONCURRENT_UPLOADS) {
    return res.status(429).json({ error: "Too many concurrent uploads. Please retry shortly." });
  }
  activeUploads += 1;
  // Run multer and surface errors as structured JSON instead of crashing.
  uploadMaterials.single("file")(req, res, (err: any) => {
    activeUploads -= 1;
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: `File too large. Maximum allowed size is ${Math.floor(MAX_PDF_UPLOAD_BYTES / (1024 * 1024))} MB.` });
      }
      if (err.name === "MulterError") {
        return res.status(400).json({ error: `Upload error: ${err.message}` });
      }
      // fileFilter rejection (invalid MIME type)
      return res.status(400).json({ error: err.message ?? "Invalid file." });
    }
    next();
  });
}, catchAsync(async (req, res) => {
  try {
    const { title, type, lectureId } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "No file was uploaded." });
    }

    if (!title || !type || !lectureId) {
      // Cleanup file if referential integrity check fails (so we don't leak files)
      if (req.file && req.file.path) {
        try { await fs.unlink(req.file.path); } catch (e) {}
      }
      return res.status(400).json({ error: "Missing required fields: title, type, and lectureId are required." });
    }

    if (type !== 'PDF' && type !== 'NOTE') {
      if (req.file && req.file.path) {
        try { await fs.unlink(req.file.path); } catch (e) {}
      }
      return res.status(400).json({ error: "Invalid material type. Type must be 'PDF' or 'NOTE'." });
    }

    const prismaClient = getPrisma();
    const lectureExists = await prismaClient.lecture.findUnique({
      where: { id: lectureId },
    });
    if (!lectureExists) {
      // Cleanup file
      if (req.file && req.file.path) {
        try { await fs.unlink(req.file.path); } catch (e) {}
      }
      return res.status(404).json({ error: `Lecture with ID '${lectureId}' was not found.` });
    }

    const uniqueId = crypto.randomUUID();
    // Keep the public app contract unchanged: clients still open the authenticated
    // API endpoint, while the backend resolves the private Storage object.
    const fileUrlOrLink = `/api/materials/pdf/${uniqueId}`;

    let fileBuffer: Buffer | null = null;
    if (req.file?.path) {
      try {
        fileBuffer = await fs.readFile(req.file.path);
      } catch (e) {
        console.warn("Failed to read uploaded PDF before Storage upload:", e);
      }
    }

    if (!fileBuffer || fileBuffer.length < 5 || fileBuffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      if (req.file?.path) {
        try { await fs.unlink(req.file.path); } catch (e) {}
      }
      return res.status(400).json({ error: "The uploaded file is not a valid PDF." });
    }

    const storagePath = buildMaterialStoragePath(lectureId, uniqueId);
    const replacedMaterials = await prismaClient.material.findMany({
      where: { lectureId, type },
      select: { id: true, storagePath: true, fileUrlOrLink: true },
    });

    try {
      await uploadPdfToSupabaseStorage(storagePath, fileBuffer);
    } catch (storageError: any) {
      if (req.file?.path) {
        try { await fs.unlink(req.file.path); } catch (e) {}
      }
      logger.error("[Storage]", `PDF upload failed: ${storageError?.message ?? "unknown error"}`);
      return res.status(502).json({
        error: "The PDF could not be saved to file storage. Please try again.",
        code: "STORAGE_UPLOAD_FAILED",
      });
    }

    let material: any;
    try {
      material = await prismaClient.$transaction(async (tx: any) => {
        await tx.material.deleteMany({ where: { lectureId, type } });
        return tx.material.create({
          data: {
            id: uniqueId,
            title,
            type,
            fileUrlOrLink,
            storagePath,
            fileData: null,
            lectureId,
          },
        });
      });
    } catch (dbError) {
      // Do not leave an orphaned Storage object when metadata persistence fails.
      try { await deleteSupabaseStorageObject(storagePath); } catch (_) {}
      throw dbError;
    }

    // Database now points at the new object. Old Storage/local objects can be
    // removed best-effort without risking loss of the newly uploaded material.
    for (const previous of replacedMaterials) {
      if (previous.storagePath) {
        try { await deleteSupabaseStorageObject(previous.storagePath); } catch (e: any) {
          logger.warn("[Storage]", `Failed to remove replaced Storage object: ${e?.message ?? "unknown error"}`);
        }
      }
      if (previous.fileUrlOrLink?.startsWith("/uploads/materials/")) {
        const previousPath = path.join(MATERIALS_UPLOADS_DIR, path.basename(previous.fileUrlOrLink));
        try { await fs.unlink(previousPath); } catch (e: any) {
          if (e?.code !== "ENOENT") logger.warn("[Storage]", "Failed to remove replaced local material file.");
        }
      }
    }

    if (req.file?.path) {
      try { await fs.unlink(req.file.path); } catch (e) {}
    }

    // This route replaces the prior PDF/NOTE of the same lecture/type in one
    // PostgreSQL transaction, so mirror both sides of that replacement.
    for (const previous of replacedMaterials) {
      if (previous.id !== material.id) {
        await syncContentDelete("Material", previous.id);
      }
    }
    await syncContentUpsert("Material", toMaterialContentRow(material));

    invalidateMaterialsCache();

    io.to("authenticated").emit("materials_updated");
    res.status(201).json({
      id: uniqueId,
      title,
      type,
      fileUrlOrLink,
      lectureId,
      material: {
        id: material.id,
        title: material.title,
        type: material.type,
        fileUrlOrLink: material.fileUrlOrLink,
        lectureId: material.lectureId,
        createdAt: material.createdAt,
      },
    });
  } catch (err: any) {
    const errorCode =
      typeof err?.code === "string" ? err.code : "PDF_UPLOAD_FAILED";
    const safeMessage =
      err instanceof Error
        ? err.message.substring(0, 300)
        : "Unknown PDF upload failure";

    console.error("[Upload Material Error]:", {
      code: errorCode,
      message: safeMessage,
      fileSizeBytes: req.file?.size ?? null,
      lectureId: req.body?.lectureId ?? null,
      type: req.body?.type ?? null,
    });

    if (req.file && req.file.path) {
      try { await fs.unlink(req.file.path); } catch (e) {}
    }

    res.status(500).json({
      error: "PDF upload failed while saving the file. Please try again.",
      code: errorCode,
    });
  }
}));

app.post("/api/materials/video", requireAdmin, catchAsync(async (req, res) => {
  try {
    const { title, fileUrlOrLink, type, lectureId } = req.body;
    if (!title || !fileUrlOrLink || !lectureId) {
      return res.status(400).json({ error: "Missing required fields: title, fileUrlOrLink, and lectureId are required." });
    }

    if (!isApprovedExternalUrl(fileUrlOrLink)) {
      return res.status(400).json({
        error: "External video links must be HTTPS and point to an approved host (e.g. YouTube).",
      });
    }
    
    const materialType = type || 'VIDEO';
    if (materialType !== 'VIDEO') {
      return res.status(400).json({ error: "Invalid material type for video route. Type must be 'VIDEO'." });
    }

    const prismaClient = getPrisma();
    // Verify lecture exists
    const lectureExists = await prismaClient.lecture.findUnique({
      where: { id: lectureId }
    });
    if (!lectureExists) {
      return res.status(404).json({ error: `Lecture with ID ${lectureId} not found.` });
    }

    const material = await prismaClient.material.create({
      data: {
        title,
        type: materialType,
        fileUrlOrLink,
        lectureId
      }
    });

    await syncContentUpsert("Material", toMaterialContentRow(material));

    
    invalidateMaterialsCache();
    io.to("authenticated").emit("materials_updated");

    res.status(201).json(material);
  } catch (err: any) {
    console.error("[Create Video Material Error]:", err instanceof Error ? err.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));


// Mint a short-lived, material-scoped URL for external PDF viewers. Storage-
// backed materials receive a direct private signed object URL; legacy materials
// receive the existing scoped backend token. The real app session is never
// exposed to the external viewer.
app.get("/api/materials/pdf/:id/external-url", requireUser, pdfLimiter, catchAsync(async (req, res) => {
  try {
    const materialId = normalizePdfMaterialId(req.params.id);
    const prismaClient = getPrisma();
    const material = await prismaClient.material.findUnique({
      where: { id: materialId },
      // Never select the large fileData blob on this latency-sensitive path.
      select: { type: true, storagePath: true },
    });

    if (!material || !["PDF", "NOTE"].includes(String(material.type || "").toUpperCase())) {
      return res.status(404).json({ error: "PDF not found." });
    }

    const user = (req as any).user;

    // Fast path for Storage-backed PDFs/Notes. Authorization is completed here,
    // then the viewer receives a short-lived private Storage capability URL.
    // This removes a second Render request, a second auth/DB lookup, and the
    // backend->Storage redirect from every normal PDF open.
    if (material.storagePath) {
      const signedUrl = await createSupabaseSignedUrl(material.storagePath, 300);

      console.log("[PDF-FAST SERVER] direct Storage URL minted", {
        userId: user.id,
        materialId,
        storageBacked: true,
      });

      res.setHeader("Cache-Control", "private, no-store");
      return res.json({
        url: signedUrl,
        delivery: "storage-direct",
        // Deliberately shorter than the actual 5-minute signature lifetime so
        // clients never reuse a URL near its expiry boundary.
        expiresAt: Date.now() + 240_000,
      });
    }

    // Legacy fallback for old DB/local-file materials. Keep the existing
    // material-scoped token so the user's real session token is never exposed.
    const downloadToken = createPdfDownloadToken(
      {
        userId: user.id,
        email: user.email,
        sessionVersion: user.sessionVersion,
        materialId,
      },
      JWT_SECRET,
    );

    const externalPdfUrl = `/api/materials/pdf/${encodeURIComponent(materialId)}?download_token=${encodeURIComponent(downloadToken)}`;
    console.log("[PDF-SECURE SERVER] legacy external URL minted", {
      userId: user.id,
      materialId,
      tokenGenerated: Boolean(downloadToken),
    });

    res.setHeader("Cache-Control", "private, no-store");
    return res.json({
      url: externalPdfUrl,
      delivery: "backend-scoped",
      expiresAt: Date.now() + 240_000,
    });
  } catch (error) {
    console.error("Error creating external PDF URL:", error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
    return res.status(500).json({ error: "Internal Server Error" });
  }
}));

// Endpoint to serve PDF directly from PostgreSQL
app.get("/api/materials/pdf/:id", requirePdfUser, pdfLimiter, catchAsync(async (req, res) => {
  try {
    const prismaClient = getPrisma();
    const idToFind = normalizePdfMaterialId(req.params.id);
    const material = await prismaClient.material.findUnique({
      where: { id: idToFind },
      select: { fileData: true, storagePath: true, fileUrlOrLink: true, title: true, type: true, createdAt: true }
    });

    if (!material) {
      return res.status(404).send("PDF not found.");
    }

    if (!['PDF', 'NOTE'].includes(String(material.type || '').toUpperCase())) {
      return res.status(404).send("PDF not found.");
    }

    // New PDFs/Notes live in the private Supabase Storage bucket. The app still
    // opens this authenticated API route; only after authorization succeeds do
    // we mint a very short-lived Storage URL and redirect the PDF viewer to it.
    if (!material.fileData && material.storagePath) {
      try {
        const signedUrl = await createSupabaseSignedUrl(material.storagePath, 300);
        res.setHeader("Cache-Control", "private, no-store");
        return res.redirect(302, signedUrl);
      } catch (storageError: any) {
        logger.error("[Storage]", `Could not create signed PDF URL: ${storageError?.message ?? "unknown error"}`);
        return res.status(502).send("PDF file storage is temporarily unavailable.");
      }
    }

    // Backward compatibility for legacy local files created before durable
    // database/Storage persistence was introduced.
    if (!material.fileData) {
      if (material.fileUrlOrLink && material.fileUrlOrLink !== `/api/materials/pdf/${idToFind}`) {
        let redirectTarget = material.fileUrlOrLink;
        try {
          const parsed = new URL(redirectTarget, `${req.protocol}://${req.get("host")}`);
          const requestOrigin = `${req.protocol}://${req.get("host")}`;
          if (parsed.origin !== requestOrigin) {
            return res.status(404).send("PDF file data unavailable.");
          }
          redirectTarget = parsed.pathname + parsed.search + parsed.hash;
        } catch (_) {
          return res.status(404).send("PDF file data unavailable.");
        }
        if (!redirectTarget.startsWith("/uploads/")) {
          return res.status(404).send("PDF file data unavailable.");
        }
        return res.redirect(302, redirectTarget);
      }
      return res.status(404).send("PDF file data unavailable.");
    }

    const fileData = material.fileData;
    if (fileData.length < 5 || fileData.subarray(0, 5).toString("ascii") !== "%PDF-") {
      return res.status(415).send("Stored material is not a PDF.");
    }
    const total = fileData.length;

    // Files are authenticated resources; shared/public caching could bypass a
    // later authorization check for a different account.
    const etag = `W/"${total}-${material.createdAt?.getTime() || 0}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-store');

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    res.setHeader('Content-Type', 'application/pdf');
    const safeFilename = String(material.title || "document").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "document";
    res.setHeader('Content-Disposition', `inline; filename="${safeFilename}.pdf"`);
    res.setHeader('Accept-Ranges', 'bytes');

    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!match || (match[1] === "" && match[2] === "")) {
        res.setHeader("Content-Range", `bytes */${total}`);
        return res.status(416).end();
      }

      let start: number;
      let end: number;
      if (match[1] === "") {
        const suffixLength = Number(match[2]);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
          res.setHeader("Content-Range", `bytes */${total}`);
          return res.status(416).end();
        }
        start = Math.max(total - suffixLength, 0);
        end = total - 1;
      } else {
        start = Number(match[1]);
        end = match[2] === "" ? total - 1 : Number(match[2]);
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= total || end < start) {
          res.setHeader("Content-Range", `bytes */${total}`);
          return res.status(416).end();
        }
        end = Math.min(end, total - 1);
      }

      const chunksize = (end - start) + 1;

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', chunksize.toString());
      // subarray is a zero-copy view of the already-fetched buffer — the range
      // never creates a second full-size allocation in memory.
      res.end(fileData.subarray(start, end + 1));
    } else {
      res.setHeader('Content-Length', total.toString());
      res.end(fileData);
    }
  } catch (error) {
    console.error("Error serving PDF from DB:", error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
    res.status(500).send("Internal Server Error");
  }
}));


// 3. Assessment Routes
app.post("/api/mcqs", requireAdmin, catchAsync(async (req, res) => {
  try {
    const { question, optionA, optionB, optionC, optionD, correctAnswer, hint, explanation, lectureId } = req.body;
    if (!question || !optionA || !optionB || !optionC || !optionD || !correctAnswer || !lectureId) {
      return res.status(400).json({ error: "Missing required fields for MCQ." });
    }

    const normalizedAnswer = String(correctAnswer).toUpperCase();
    if (!['A', 'B', 'C', 'D'].includes(normalizedAnswer)) {
      return res.status(400).json({ error: "correctAnswer must be set to 'A', 'B', 'C', or 'D'." });
    }

    const prismaClient = getPrisma();
    // Verify lecture exists
    const lectureExists = await prismaClient.lecture.findUnique({
      where: { id: lectureId }
    });
    if (!lectureExists) {
      return res.status(404).json({ error: `Lecture with ID ${lectureId} not found.` });
    }

    const mcq = await prismaClient.mcq.create({
      data: {
        question,
        optionA,
        optionB,
        optionC,
        optionD,
        correctAnswer: normalizedAnswer,
        hint: hint || null,
        explanation: explanation || null,
        lectureId
      }
    });

    await syncContentUpsert("Mcq", toMcqContentRow(mcq));

    
    invalidateMaterialsCache();
    io.to("authenticated").emit("materials_updated");

    res.status(201).json(mcq);
  } catch (err: any) {
    console.error("[Post MCQ Error]:", err instanceof Error ? err.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// Server-authoritative MCQ grading. The correct answer key is never shipped in
// material/lecture payloads; clients submit their selections here and receive
// the per-question verdict plus the post-submission explanation/reference
// answer needed to render the review screen.
app.post("/api/mcqs/submit", requireUser, catchAsync(async (req, res) => {
  try {
    const rawAnswers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    if (rawAnswers.length === 0) {
      return res.status(400).json({ error: "No answers provided." });
    }
    if (rawAnswers.length > 200) {
      return res.status(400).json({ error: "Too many answers in a single submission." });
    }

    const ids: string[] = [];
    const normalized: { id: string; answer: string | null }[] = [];
    for (const a of rawAnswers) {
      const id = typeof a?.id === "string" ? a.id : "";
      const answer = a?.answer == null ? null : String(a.answer).toUpperCase();
      if (!id) return res.status(400).json({ error: "Each answer requires a valid MCQ id." });
      if (answer !== null && !["A", "B", "C", "D"].includes(answer)) {
        return res.status(400).json({ error: "Answer must be one of A, B, C, or D." });
      }
      // De-duplicate by id while preserving client order.
      if (!ids.includes(id)) {
        ids.push(id);
        normalized.push({ id, answer });
      }
    }

    const prismaClient = getPrisma();
    const mcqs = await prismaClient.mcq.findMany({
      where: { id: { in: ids } },
      select: { id: true, correctAnswer: true, explanation: true, hint: true },
    });
    const byId = new Map<string, any>(mcqs.map((m: any) => [m.id, m] as [string, any]));

    const results = normalized.map(({ id, answer }) => {
      const mcq = byId.get(id);
      const correct = !!mcq && !!answer && answer === mcq.correctAnswer;
      return {
        id,
        correct,
        correctAnswer: mcq ? mcq.correctAnswer : null,
        explanation: mcq ? (mcq.explanation || mcq.hint || "") : "",
      };
    });

    res.json({ results });
  } catch (err: any) {
    console.error("[MCQ Submit Error]:", err instanceof Error ? err.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// -----------------------------------------------------------------------------

// PDF upload endpoint (receives base64 encoded streams)

// GET all academic materials (subjects, mcqs, flashcards, videos) + dynamic rosters
app.get("/api/materials", requireUser, catchAsync(async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-cache");
    const currentUserGroup = String((req as any).user?.studentGroup || "").trim().toUpperCase();
    const requestedScope = typeof req.query.scope === "string" ? req.query.scope : "full";
    const scope = requestedScope === "subjects" || requestedScope === "offline" ? requestedScope : "full";
    const forceRefresh = req.query.forceRefresh === "1" || req.get("cache-control") === "no-cache";
    // The legacy full response cache must never satisfy a scoped request: doing so
    // would defeat the payload reduction and waste bandwidth on every dashboard load.
    if (scope === "full" && materialsCache && materialsCache.group === currentUserGroup && !forceRefresh) {
      return res.json(materialsCache.data);
    }
    const materials = await readMaterialsDb();
    const prismaClient = getPrisma();
    const needsSubjects = scope === "full" || scope === "subjects";
    const needsOfflineStudyData = scope === "full" || scope === "offline";
    const needsCalendar = scope === "full";

    // Query only the relational datasets actually needed by the caller. The
    // dashboard does not need thousands of MCQs/flashcards/events, while the
    // offline synchronizer does not need the complete lecture/material tree.
    const [dbLectures, dbMcqs, dbFlashcards, dbMaterials, dbEvents] = await Promise.all([
      needsSubjects ? prismaClient.lecture.findMany({
        take: 2000,
        select: {
          id: true,
          name: true,
          mainSubject: true,
          subSubject: true,
          trackMode: true,
          department: true,
          createdAt: true,
          materials: { select: { id: true, title: true, type: true, fileUrlOrLink: true, lectureId: true } },
        },
        orderBy: { createdAt: "desc" },
      }) : Promise.resolve([]),
      needsOfflineStudyData ? prismaClient.mcq.findMany({ take: 2000 }) : Promise.resolve([]),
      needsOfflineStudyData ? prismaClient.flashcard.findMany({ take: 2000 }) : Promise.resolve([]),
      needsSubjects ? prismaClient.material.findMany({ take: 2000, select: { id: true, title: true, type: true, fileUrlOrLink: true, lectureId: true } }) : Promise.resolve([]),
      needsCalendar ? prismaClient.calendarEvent.findMany({ take: 2000, where: { userId: null } }) : Promise.resolve([])
    ]);

    // Merge logic
    const mergedSubjects = JSON.parse(JSON.stringify(materials.subjects || []));

    // JSON provides legacy subject/module presentation metadata; Prisma provides
    // the authoritative lecture records. Add database-only lectures to that
    // hierarchy so /api/materials cannot silently omit uploaded content.
    for (const lecture of dbLectures as any[]) {
      let subject = mergedSubjects.find((s: any) =>
        String(s.id).toLowerCase() === String(lecture.mainSubject).toLowerCase() ||
        String(s.name).toLowerCase() === String(lecture.mainSubject).toLowerCase()
      );
      if (!subject) {
        subject = {
          id: lecture.mainSubject,
          name: lecture.mainSubject,
          nameAr: "",
          icon: "BookOpen",
          color: "",
          description: "",
          modules: [],
        };
        mergedSubjects.push(subject);
      }
      subject.modules = Array.isArray(subject.modules) ? subject.modules : [];
      const moduleName = lecture.subSubject || "General";
      let module = subject.modules.find((m: any) => String(m.name).toLowerCase() === String(moduleName).toLowerCase());
      if (!module) {
        module = {
          id: `${subject.id}:${moduleName}`,
          subjectId: subject.id,
          name: moduleName,
          orderNumber: subject.modules.length + 1,
          lectures: [],
        };
        subject.modules.push(module);
      }
      module.lectures = Array.isArray(module.lectures) ? module.lectures : [];
      const existingLecture = module.lectures.find((l: any) => l.id === lecture.id);
      if (!existingLecture) {
        module.lectures.push({
          ...lecture,
          title: lecture.name,
          type: "lecture",
          pdfUrl: lecture.materials?.find((m: any) => m.type.toUpperCase() === "PDF")?.fileUrlOrLink || "",
          notesPdfUrl: lecture.materials?.find((m: any) => m.type.toUpperCase() === "NOTE")?.fileUrlOrLink || "",
        });
      }
    }

    const mcqMap = new Map<string, any>((materials.mcqs || []).map((m: any) => [m.id, m]));
    for (const mcq of dbMcqs) {
      // SECURITY: the correct answer key must never travel to the client in the
      // material payload. Grading happens server-side via POST /api/mcqs/submit.
      const { correctAnswer: _correctAnswer, ...safeMcq } = mcq;
      mcqMap.set(mcq.id, {
        ...safeMcq,
        options: [mcq.optionA, mcq.optionB, mcq.optionC, mcq.optionD].filter(Boolean)
      });
    }
    const mergedMcqs = Array.from(mcqMap.values());

    const flashcardMap = new Map<string, any>((materials.flashcards || []).map((f: any) => [f.id, f]));
    for (const f of dbFlashcards) {
      flashcardMap.set(f.id, {
        ...f,
        frontText: f.clinicalConcept,
        backText: f.explanation,
        front: f.clinicalConcept,
        back: f.explanation
      });
    }
    const mergedFlashcards = Array.from(flashcardMap.values());

    const mergedVideos = [...(materials.videos || [])];
    for (const m of dbMaterials) {
      if (m.type.toLowerCase() === 'video' && !mergedVideos.some(v => v.id === m.id)) {
        mergedVideos.push({
          id: m.id,
          title: m.title,
          url: m.fileUrlOrLink,
          lectureId: m.lectureId
        });
      } else if (m.type.toLowerCase() === 'pdf' || m.type.toLowerCase() === 'note') {
        // Inject into mergedSubjects
        for (const subject of mergedSubjects) {
          for (const mod of subject.modules || []) {
            for (const lec of mod.lectures || []) {
              if (lec.id === m.lectureId) {
                // Strip stale localhost origins so URLs always work in production
                let cleanUrl = m.fileUrlOrLink || "";
                try {
                  const parsed = new URL(cleanUrl);
                  if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
                    cleanUrl = parsed.pathname + parsed.search + parsed.hash;
                  }
                } catch (_) { /* already relative */ }
                if (m.type.toLowerCase() === 'pdf') {
                  lec.pdfUrl = cleanUrl;
                } else if (m.type.toLowerCase() === 'note') {
                  lec.notesPdfUrl = cleanUrl;
                }
              }
            }
          }
        }
      }
    }

    const mergedEvents = [...(materials.calendarEvents || [])];
    for (const e of dbEvents.filter((event: any) => eventVisibleToGroup(event.targetGroups, currentUserGroup))) {
      if (!mergedEvents.some(ev => ev.id === e.id)) {
        mergedEvents.push({
          ...e,
          targetGroups: typeof e.targetGroups === "string" ? e.targetGroups.split(",").filter(Boolean) : (e.targetGroups || [])
        });
      }
    }

    const normalizedFlashcards = mergedFlashcards.map((f: any) => ({
      ...f,
      frontText: f.frontText || f.front || f.clinicalConcept || "",
      backText: f.backText || f.back || f.explanation || "",
      front: f.front || f.frontText || f.clinicalConcept || "",
      back: f.back || f.backText || f.explanation || "",
      clinicalConcept: f.clinicalConcept || f.front || f.frontText || "",
      explanation: f.explanation || f.back || f.backText || ""
    }));

    // SECURITY: never ship the correct answer key in the material payload —
    // grading is done server-side by POST /api/mcqs/submit.
    const sanitizedMcqs = mergedMcqs.map((m: any) => {
      const { correctAnswer: _omit, ...rest } = m;
      return rest;
    });

    const fullResponseData = {
      subjects: mergedSubjects,
      mcqs: sanitizedMcqs,
      flashcards: normalizedFlashcards,
      videos: mergedVideos,
      calendarEvents: mergedEvents
    };

    if (scope === "subjects") {
      return res.json({ subjects: mergedSubjects });
    }
    if (scope === "offline") {
      return res.json({ mcqs: sanitizedMcqs, flashcards: normalizedFlashcards });
    }

    materialsCache = { group: String(currentUserGroup || "").trim().toUpperCase(), data: fullResponseData };
    res.json(fullResponseData);
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// Robust PostgreSQL-compatible Search Endpoint
app.get("/api/search", requireUser, catchAsync(async (req, res) => {
  try {
    if (req.query.q !== undefined && typeof req.query.q !== "string") {
      return res.status(400).json({ error: "Search query must be a string." });
    }
    const q = req.query.q as string | undefined;
    if (!q || q.trim() === "") {
      return res.json([]);
    }

    const query = q.trim();
    if (query.length > 200) {
      return res.status(400).json({ error: "Search query is too long." });
    }
    const prismaClient = getPrisma();
    
    // Check if running on postgres to apply mode: 'insensitive'
    // database uses LIKE internally which is already case-insensitive, but throws if mode is provided.
    const isPostgres = process.env.DATABASE_URL?.startsWith("postgres") || process.env.DATABASE_URL?.startsWith("postgresql");
    const modeConfig = isPostgres ? { mode: 'insensitive' as const } : {};

    const keywordFilters = query.split(/\s+/).filter(w => w.length > 0);
    if (keywordFilters.length > 8) {
      return res.status(400).json({ error: "Search query contains too many terms." });
    }

    // Concurrent parallel fetching for maximum performance
    const [lectures, materials, mcqs, flashcards] = await Promise.all([
      prismaClient.lecture.findMany({
        where: {
          OR: keywordFilters.flatMap(kw => [
            { name: { contains: kw, ...modeConfig } },
            { mainSubject: { contains: kw, ...modeConfig } }
          ])
        },
        take: 10,
        select: { id: true, name: true, mainSubject: true, subSubject: true }
      }),
      prismaClient.material.findMany({
        where: {
          OR: keywordFilters.map(kw => ({ title: { contains: kw, ...modeConfig } }))
        },
        take: 10,
        select: { id: true, title: true, type: true, lectureId: true }
      }),
      prismaClient.mcq.findMany({
        where: {
          OR: keywordFilters.map(kw => ({ question: { contains: kw, ...modeConfig } }))
        },
        take: 10,
        select: { id: true, question: true, lectureId: true }
      }),
      prismaClient.flashcard.findMany({
        where: {
          OR: keywordFilters.flatMap(kw => [
            { clinicalConcept: { contains: kw, ...modeConfig } },
            { explanation: { contains: kw, ...modeConfig } }
          ])
        },
        take: 10,
        select: { id: true, clinicalConcept: true, lectureId: true }
      })
    ]);

    // Combine results and remove duplicates (by ID + Type)
    const resultsMap = new Map<string, any>();

    // Pre-populate subject map from lectures already fetched (they include mainSubject).
    // Only query the DB for IDs belonging to materials/mcqs/flashcards not already known.
    const lectureToSubjectMap = new Map<string, string>();
    lectures.forEach((l: any) => lectureToSubjectMap.set(l.id, l.mainSubject));

    const unknownLectureIds = new Set<string>();
    let relatedLectures: Array<{ id: string; mainSubject: string }> = [];
    materials.forEach((m: any) => { if (!lectureToSubjectMap.has(m.lectureId)) unknownLectureIds.add(m.lectureId); });
    mcqs.forEach((m: any) => { if (!lectureToSubjectMap.has(m.lectureId)) unknownLectureIds.add(m.lectureId); });
    flashcards.forEach((f: any) => { if (!lectureToSubjectMap.has(f.lectureId)) unknownLectureIds.add(f.lectureId); });

    if (unknownLectureIds.size > 0) {
      relatedLectures = await prismaClient.lecture.findMany({
        where: { id: { in: Array.from(unknownLectureIds) } },
        select: { id: true, mainSubject: true },
      });
      relatedLectures.forEach((l: any) => lectureToSubjectMap.set(l.id, l.mainSubject));
    }

    // Map into SearchResultItem structure
    lectures.forEach((l: any) => {
      const key = `db-lecture-${l.id}`;
      if (!resultsMap.has(key)) {
        resultsMap.set(key, {
          id: key,
          title: l.name,
          subtitle: l.subSubject || l.mainSubject,
          type: "lecture",
          lectureId: l.id,
          subjectId: l.mainSubject,
          raw: l
        });
      }
    });

    materials.forEach((m: any) => {
      const typeMap: Record<string, string> = { "PDF": "pdf", "NOTE": "notes", "VIDEO": "video" };
      const type = typeMap[m.type] || "pdf";
       const key = `db-${type}-${m.id}`;
      if (!resultsMap.has(key)) {
        resultsMap.set(key, {
          id: key,
          title: `${m.title} (${type === 'video' ? 'Video' : type === 'notes' ? 'Notes' : 'PDF'})`,
          subtitle: m.title,
          type: type,
          lectureId: m.lectureId,
          subjectId: lectureToSubjectMap.get(m.lectureId),
          raw: m
        });
      }
    });

    mcqs.forEach((m: any) => {
       const key = `db-mcq-${m.id}`;
      if (!resultsMap.has(key)) {
        resultsMap.set(key, {
          id: key,
          title: m.question,
          subtitle: `Quiz Question`,
          type: "mcq",
          lectureId: m.lectureId,
          subjectId: lectureToSubjectMap.get(m.lectureId),
          raw: m
        });
      }
    });

    flashcards.forEach((f: any) => {
       const key = `db-flashcard-${f.id}`;
      if (!resultsMap.has(key)) {
        resultsMap.set(key, {
          id: key,
          title: f.clinicalConcept,
          subtitle: `Flashcard`,
          type: "flashcard",
          lectureId: f.lectureId,
          subjectId: lectureToSubjectMap.get(f.lectureId),
          raw: f
        });
      }
    });

    // Also search subjects from JSON if possible, but they are in DB indirectly
    // For exact match subjects:
    const subjectsSet = new Set([
      ...lectures.map((lecture: any) => lecture.mainSubject),
      ...relatedLectures.map(l => l.mainSubject),
    ]);
    subjectsSet.forEach(s => {
      if (s.toLowerCase().includes(query.toLowerCase())) {
        const key = `subject-${s}`;
        if (!resultsMap.has(key)) {
          resultsMap.set(key, {
            id: key,
            title: s,
            subtitle: "Subject",
            type: "subject",
            subjectId: s
          });
        }
      }
    });

    const finalResults = Array.from(resultsMap.values());
    res.json(finalResults);

  } catch (err: any) {
    console.error("Search API Error:", err instanceof Error ? err.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// Notifications Endpoints
app.get("/api/notifications", requireUser, catchAsync(async (req, res) => {
  try {
    const prismaClient = getPrisma();
    const currentUser = (req as any).user;
    const currentUserId = currentUser?.id;
    const currentUserGroup: string | null = currentUser?.studentGroup || null;

    // Return notifications that are addressed to this user (or everyone) AND
    // are either global (targetGroup null) or targeted at the user's own group.
    const notifications = await prismaClient.notification.findMany({
      take: 50,
      where: {
        AND: [
          {
            OR: [
              { targetUserId: null },
              { targetUserId: currentUserId },
            ],
          },
          {
            OR: [
              { targetGroup: null },
              ...(currentUserGroup ? [{ targetGroup: currentUserGroup }] : []),
            ],
          },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(notifications);
  } catch (err: any) {
    console.error("Failed to fetch notifications:", err instanceof Error ? err.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

app.delete("/api/notifications/:id", requireUser, catchAsync(async (req, res) => {
  try {
    const prismaClient = getPrisma();
    const user = (req as any).user;
    const notification = await prismaClient.notification.findUnique({ where: { id: req.params.id } });
    if (!notification) return res.status(404).json({ error: "Notification not found." });

    // Users may only delete notifications addressed to them.
    // System-wide broadcasts (targetUserId === null) may only be dismissed by admins/owners.
    const isAdmin = user.role === "admin" || user.role === "owner";
    const isOwner = notification.targetUserId === user.id;
    if (!isOwner && !isAdmin) {
      console.log(JSON.stringify({ timestamp: new Date().toISOString(), event: "UNAUTHORIZED_NOTIFICATION_DELETE", actor: user.email, notificationId: req.params.id }));
      return res.status(403).json({ error: "Not authorized to delete this notification." });
    }

    await prismaClient.notification.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

app.post("/api/notifications", requireOwner, catchAsync(async (req, res) => {
  try {
    const { title, message, isSystem, targetGroup } = req.body;
    if (!title || !message) {
      return res.status(400).json({ error: "Title and message are required." });
    }
    if (typeof title !== "string" || title.trim().length > 200) {
      return res.status(400).json({ error: "Title must be a string under 200 characters." });
    }
    if (typeof message !== "string" || message.trim().length > 2000) {
      return res.status(400).json({ error: "Message must be a string under 2000 characters." });
    }

    // Validate targetGroup: must be one of the known groups or absent (= global)
    const VALID_GROUPS = ["A", "B", "C", "D"] as const;
    const normalizedGroup: string | null =
      targetGroup && VALID_GROUPS.includes(String(targetGroup).toUpperCase() as any)
        ? String(targetGroup).toUpperCase()
        : null;

    const prismaClient = getPrisma();
    const savedNotification = await prismaClient.notification.create({
      data: {
        title,
        message,
        isSystem: isSystem !== undefined ? isSystem : true,
        targetGroup: normalizedGroup,
      }
    });

    // Scope the real-time broadcast: group-specific → room only; global → everyone
    if (normalizedGroup) {
      io.to("group:" + normalizedGroup).emit("receiveSystemNotification", savedNotification);
    } else {
      io.to("authenticated").emit("receiveSystemNotification", savedNotification);
    }

    res.status(201).json(savedNotification);
  } catch (err: any) {
    console.error("Failed to create notification:", err instanceof Error ? err.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

app.post("/api/notifications/register-token", requireUser, catchAsync(async (req, res) => {
  try {
    const { token } = req.body;
    const userId = (req as any).user.id;
    if (typeof token !== "string" || !token.trim() || token.length > 4096) {
      return res.status(400).json({ error: "A valid notification token is required." });
    }
    
    const tokenDbPath = path.join(process.cwd(), "device_tokens.json");
    let tokens: Record<string, string[]> = {};
    try {
      const content = await fs.readFile(tokenDbPath, "utf-8");
      tokens = JSON.parse(content);
    } catch {}
    
    if (!Array.isArray(tokens[userId])) {
      tokens[userId] = [];
    }
    const cleanToken = token.trim();
    if (!tokens[userId].includes(cleanToken)) {
      tokens[userId].push(cleanToken);
    }
    // Bound the legacy JSON store so repeated device registrations cannot grow it
    // without limit. Keep the newest registrations for this account.
    tokens[userId] = tokens[userId].slice(-10);
    await fs.writeFile(tokenDbPath, JSON.stringify(tokens, null, 2), "utf-8");
    
    res.json({ success: true, message: "Token registered successfully." });
  } catch (err: any) {
    console.error("Failed to register device token:", err instanceof Error ? err.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

async function removeDeviceTokensForUser(userId: string): Promise<void> {
  const tokenDbPath = path.join(process.cwd(), "device_tokens.json");
  try {
    const content = await fs.readFile(tokenDbPath, "utf-8");
    const tokens = JSON.parse(content) as Record<string, string[]>;
    if (!(userId in tokens)) return;
    delete tokens[userId];
    const tempPath = `${tokenDbPath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(tokens, null, 2), "utf-8");
    await fs.rename(tempPath, tokenDbPath);
  } catch (error: any) {
    if (error?.code !== "ENOENT") logger.warn("[Notifications]", "Failed to remove deleted user's device tokens.");
  }
}

// ============================================================
// Q&A ENDPOINTS
// ============================================================

// GET /api/qa/:lectureId — fetch questions (hidden deleted; hide blocked-user content for caller)
app.get("/api/qa/:lectureId", requireUser, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const userId = (req as any).user.id;
  const { lectureId } = req.params;

  // Fetch blocks and questions in parallel — they are independent queries
  const [blocks, questions] = await Promise.all([
    prismaClient.userBlock.findMany({
      where: { blockerId: userId },
      select: { blockedId: true },
    }),
    prismaClient.qaQuestion.findMany({
    where: { lectureId, isDeleted: false },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { id: true, name: true, avatar: true, avatarUrl: true } },
      answers: {
        where: { isDeleted: false },
        orderBy: { createdAt: "asc" },
        take: 200,
        include: {
          user: { select: { id: true, name: true, avatar: true, avatarUrl: true } },
        },
      },
    },
  }),
  ]);
  const blockedIds = new Set(blocks.map((b: any) => b.blockedId));

  const mapped = questions.map((q: any) => ({
    id: q.id,
    lectureId: q.lectureId,
    user_id: q.userId,
    userName: q.user?.name || "Unknown",
    userAvatar: q.user?.avatarUrl || q.user?.avatar || "",
    content: q.content,
    createdAt: q.createdAt.toISOString(),
    upvotes: q.upvotes,
    isBlocked: blockedIds.has(q.userId),
    answers: q.answers.map((a: any) => ({
      id: a.id,
      questionId: a.questionId,
      userId: a.userId,
      userName: a.user?.name || "Unknown",
      userAvatar: a.user?.avatarUrl || a.user?.avatar || "",
      content: a.content,
      createdAt: a.createdAt.toISOString(),
      upvotes: a.upvotes,
      isBest: a.isBest,
      isBlocked: blockedIds.has(a.userId),
    })),
  }));

  res.json(mapped);
}));

// POST /api/qa/:lectureId/questions — post a new question
app.post("/api/qa/:lectureId/questions", requireUser, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const userId = (req as any).user.id;
  const { lectureId } = req.params;
  const { content } = req.body;

  // Mute check — auto-expire if timed mute has passed
  const mute = await prismaClient.userMute.findUnique({ where: { userId } });
  if (mute) {
    if (mute.isPermanent || !mute.endTime || mute.endTime > new Date()) {
      return res.status(403).json({
        error: "You are currently muted and cannot participate in discussions.",
        isMuted: true,
        isPermanent: mute.isPermanent,
        endTime: mute.endTime?.toISOString() || null,
        reason: mute.reason,
      });
    }
    await prismaClient.userMute.delete({ where: { userId } });
    await logModerationAction(prismaClient, { actionType: "MUTE_EXPIRED", targetUserId: userId, isSystemAction: true, metadata: { expiredAt: new Date().toISOString() } });
  }

  if (!content || typeof content !== "string" || !content.trim()) {
    return res.status(400).json({ error: "Content is required." });
  }
  if (content.trim().length > 2000) {
    return res.status(400).json({ error: "Content must be under 2000 characters." });
  }

  // Verify lecture exists
  const lecture = await prismaClient.lecture.findUnique({ where: { id: lectureId } });
  if (!lecture) return res.status(404).json({ error: "Lecture not found." });

  const question = await prismaClient.qaQuestion.create({
    data: { lectureId, userId, content: content.trim() },
    include: { user: { select: { id: true, name: true, avatar: true, avatarUrl: true } } },
  });

  const questionPayload = {
    id: question.id,
    lectureId: question.lectureId,
    user_id: question.userId,
    userName: question.user?.name || "",
    userAvatar: question.user?.avatarUrl || question.user?.avatar || "",
    content: question.content,
    createdAt: question.createdAt.toISOString(),
    upvotes: 0,
    isBlocked: false,
    answers: [],
  };
  io.to("authenticated").emit("qa_question_created", questionPayload);
  res.status(201).json(questionPayload);
}));

// PUT /api/qa/questions/:id — edit own question
app.put("/api/qa/questions/:id", requireUser, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const userId = (req as any).user.id;
  const { id } = req.params;
  const { content } = req.body;

  if (!content || typeof content !== "string" || !content.trim()) {
    return res.status(400).json({ error: "Content is required." });
  }

  const question = await prismaClient.qaQuestion.findUnique({ where: { id } });
  if (!question || question.isDeleted) return res.status(404).json({ error: "Question not found." });
  if (question.userId !== userId) return res.status(403).json({ error: "Not authorized." });

  const updated = await prismaClient.qaQuestion.update({
    where: { id },
    data: { content: content.trim() },
  });
  io.to("authenticated").emit("qa_question_updated", { id: updated.id, content: updated.content, lectureId: question.lectureId });
  res.json({ id: updated.id, content: updated.content });
}));

// DELETE /api/qa/questions/:id — soft-delete own question (or admin hard-delete)
app.delete("/api/qa/questions/:id", requireUser, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const user = (req as any).user;
  const { id } = req.params;

  const question = await prismaClient.qaQuestion.findUnique({ where: { id } });
  if (!question || question.isDeleted) return res.status(404).json({ error: "Question not found." });

  const isAdmin = user.role === "admin" || user.role === "owner";
  if (question.userId !== user.id && !isAdmin) return res.status(403).json({ error: "Not authorized." });

  await prismaClient.qaQuestion.update({ where: { id }, data: { isDeleted: true } });

  // Audit log: only record when an admin deletes (not self-deletion)
  if (isAdmin) {
    await logModerationAction(prismaClient, {
      actionType: "DELETE_QUESTION",
      adminId: user.id,
      targetUserId: question.userId,
      commentId: id,
      newStatus: "Deleted",
      metadata: { source: "direct_delete" },
    });
  }

  io.to("authenticated").emit("qa_question_deleted", { questionId: id, lectureId: question.lectureId });
  res.json({ success: true });
}));

// POST /api/qa/questions/:id/upvote — toggle upvote on question
app.post("/api/qa/questions/:id/upvote", requireUser, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const userId = (req as any).user.id;
  const { id } = req.params;
  const { delta } = req.body; // +1 or -1

  if (delta !== 1 && delta !== -1) return res.status(400).json({ error: "delta must be 1 or -1." });
  const updated = await prismaClient.$transaction(async (tx: any) => {
    const question = await tx.qaQuestion.findUnique({ where: { id } });
    if (!question || question.isDeleted) return null;
    const vote = await tx.qaVote.findUnique({
      where: { userId_targetType_targetId: { userId, targetType: "question", targetId: id } },
    });
    if (vote) {
      await tx.qaVote.delete({ where: { id: vote.id } });
      return tx.qaQuestion.update({ where: { id }, data: { upvotes: Math.max(0, question.upvotes - 1) } });
    }
    if (delta === -1) return question;
    await tx.qaVote.create({ data: { userId, targetType: "question", targetId: id, value: 1 } });
    return tx.qaQuestion.update({ where: { id }, data: { upvotes: question.upvotes + 1 } });
  });
  if (!updated) return res.status(404).json({ error: "Question not found." });
  io.to("authenticated").emit("qa_question_updated", { id: updated.id, upvotes: updated.upvotes, lectureId: updated.lectureId });
  res.json({ upvotes: updated.upvotes });
}));

// POST /api/qa/questions/:questionId/answers — post an answer
app.post("/api/qa/questions/:questionId/answers", requireUser, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const userId = (req as any).user.id;
  const { questionId } = req.params;
  const { content } = req.body;

  // Mute check — auto-expire if timed mute has passed
  const muteForAnswer = await prismaClient.userMute.findUnique({ where: { userId } });
  if (muteForAnswer) {
    if (muteForAnswer.isPermanent || !muteForAnswer.endTime || muteForAnswer.endTime > new Date()) {
      return res.status(403).json({
        error: "You are currently muted and cannot participate in discussions.",
        isMuted: true,
        isPermanent: muteForAnswer.isPermanent,
        endTime: muteForAnswer.endTime?.toISOString() || null,
        reason: muteForAnswer.reason,
      });
    }
    await prismaClient.userMute.delete({ where: { userId } });
    await logModerationAction(prismaClient, { actionType: "MUTE_EXPIRED", targetUserId: userId, isSystemAction: true, metadata: { expiredAt: new Date().toISOString() } });
  }

  if (!content || typeof content !== "string" || !content.trim()) {
    return res.status(400).json({ error: "Content is required." });
  }
  if (content.trim().length > 2000) {
    return res.status(400).json({ error: "Content must be under 2000 characters." });
  }

  const question = await prismaClient.qaQuestion.findUnique({ where: { id: questionId } });
  if (!question || question.isDeleted) return res.status(404).json({ error: "Question not found." });

  const answer = await prismaClient.qaAnswer.create({
    data: { questionId, userId, content: content.trim() },
    include: { user: { select: { id: true, name: true, avatar: true, avatarUrl: true } } },
  });

  const answerPayload = {
    id: answer.id,
    questionId: answer.questionId,
    userId: answer.userId,
    userName: answer.user?.name || "",
    userAvatar: answer.user?.avatarUrl || answer.user?.avatar || "",
    content: answer.content,
    createdAt: answer.createdAt.toISOString(),
    upvotes: 0,
    isBest: false,
    isBlocked: false,
  };
  io.to("authenticated").emit("qa_answer_created", { ...answerPayload, lectureId: question.lectureId });
  res.status(201).json(answerPayload);
}));

// PUT /api/qa/answers/:id — edit own answer
app.put("/api/qa/answers/:id", requireUser, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const userId = (req as any).user.id;
  const { id } = req.params;
  const { content } = req.body;

  if (!content || typeof content !== "string" || !content.trim()) {
    return res.status(400).json({ error: "Content is required." });
  }

  const answer = await prismaClient.qaAnswer.findUnique({ where: { id } });
  if (!answer || answer.isDeleted) return res.status(404).json({ error: "Answer not found." });
  if (answer.userId !== userId) return res.status(403).json({ error: "Not authorized." });

  const updated = await prismaClient.qaAnswer.update({
    where: { id },
    data: { content: content.trim() },
  });
  io.to("authenticated").emit("qa_answer_updated", { id: updated.id, content: updated.content, questionId: answer.questionId });
  res.json({ id: updated.id, content: updated.content });
}));

// DELETE /api/qa/answers/:id
app.delete("/api/qa/answers/:id", requireUser, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const user = (req as any).user;
  const { id } = req.params;

  const answer = await prismaClient.qaAnswer.findUnique({ where: { id } });
  if (!answer || answer.isDeleted) return res.status(404).json({ error: "Answer not found." });

  const isAdmin = user.role === "admin" || user.role === "owner";
  if (answer.userId !== user.id && !isAdmin) return res.status(403).json({ error: "Not authorized." });

  await prismaClient.qaAnswer.update({ where: { id }, data: { isDeleted: true } });

  // Audit log: only record when an admin deletes (not self-deletion)
  if (isAdmin) {
    await logModerationAction(prismaClient, {
      actionType: "DELETE_ANSWER",
      adminId: user.id,
      targetUserId: answer.userId,
      commentId: id,
      newStatus: "Deleted",
      metadata: { source: "direct_delete" },
    });
  }

  io.to("authenticated").emit("qa_answer_deleted", { answerId: id, questionId: answer.questionId });
  res.json({ success: true });
}));

// POST /api/qa/answers/:id/upvote — toggle upvote on answer
app.post("/api/qa/answers/:id/upvote", requireUser, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const userId = (req as any).user.id;
  const { id } = req.params;
  const { delta } = req.body;

  if (delta !== 1 && delta !== -1) return res.status(400).json({ error: "delta must be 1 or -1." });
  const updated = await prismaClient.$transaction(async (tx: any) => {
    const answer = await tx.qaAnswer.findUnique({ where: { id } });
    if (!answer || answer.isDeleted) return null;
    const vote = await tx.qaVote.findUnique({
      where: { userId_targetType_targetId: { userId, targetType: "answer", targetId: id } },
    });
    if (vote) {
      await tx.qaVote.delete({ where: { id: vote.id } });
      return tx.qaAnswer.update({ where: { id }, data: { upvotes: Math.max(0, answer.upvotes - 1) } });
    }
    if (delta === -1) return answer;
    await tx.qaVote.create({ data: { userId, targetType: "answer", targetId: id, value: 1 } });
    return tx.qaAnswer.update({ where: { id }, data: { upvotes: answer.upvotes + 1 } });
  });
  if (!updated) return res.status(404).json({ error: "Answer not found." });
  io.to("authenticated").emit("qa_answer_updated", { id: updated.id, upvotes: updated.upvotes, questionId: updated.questionId });
  res.json({ upvotes: updated.upvotes });
}));

// PATCH /api/qa/answers/:id/best — mark/unmark as best answer
app.patch("/api/qa/answers/:id/best", requireUser, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const userId = (req as any).user.id;
  const { id } = req.params;
  const { isBest } = req.body;

  const answer = await prismaClient.qaAnswer.findUnique({
    where: { id },
    include: { question: true },
  });
  if (!answer || answer.isDeleted) return res.status(404).json({ error: "Answer not found." });

  const isAdmin = (req as any).user.role === "admin" || (req as any).user.role === "owner";
  if (answer.question.userId !== userId && !isAdmin) {
    return res.status(403).json({ error: "Only the question author or admin can mark the best answer." });
  }

  // If marking as best, unmark any existing best in the same question first
  if (isBest) {
    await prismaClient.qaAnswer.updateMany({
      where: { questionId: answer.questionId, isBest: true },
      data: { isBest: false },
    });
  }

  const updated = await prismaClient.qaAnswer.update({ where: { id }, data: { isBest: !!isBest } });
  io.to("authenticated").emit("qa_answer_updated", { id: updated.id, isBest: updated.isBest, questionId: answer.questionId });
  res.json({ id: updated.id, isBest: updated.isBest });
}));

// ============================================================
// BLOCK ENDPOINTS
// ============================================================

// GET /api/blocks — list users the caller has blocked
app.get("/api/blocks", requireUser, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const userId = (req as any).user.id;

  const blocks = await prismaClient.userBlock.findMany({
    where: { blockerId: userId },
    orderBy: { createdAt: "desc" },
    include: {
      blocked: { select: { id: true, name: true, avatar: true, avatarUrl: true } },
    },
  });

  res.json(blocks.map((b: any) => ({
    id: b.blocked.id,
    blockId: b.id,
    name: b.blocked.name || "Unknown",
    avatar: b.blocked.avatar || "",
    avatarUrl: b.blocked.avatarUrl || "",
    blockedAt: b.createdAt.toISOString(),
  })));
}));

// GET /api/blocks/ids — lightweight: just returns blocked user IDs for the caller
app.get("/api/blocks/ids", requireUser, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const userId = (req as any).user.id;

  const blocks = await prismaClient.userBlock.findMany({
    where: { blockerId: userId },
    select: { blockedId: true },
  });
  res.json(blocks.map((b: any) => b.blockedId));
}));

// POST /api/blocks — block a user
app.post("/api/blocks", requireUser, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const blockerId = (req as any).user.id;
  const { blockedId } = req.body;

  if (!blockedId || typeof blockedId !== "string") {
    return res.status(400).json({ error: "blockedId is required." });
  }
  if (blockedId === blockerId) {
    return res.status(400).json({ error: "You cannot block yourself." });
  }

  const target = await prismaClient.user.findUnique({ where: { id: blockedId } });
  if (!target) return res.status(404).json({ error: "User not found." });

  try {
    const block = await prismaClient.userBlock.create({
      data: { blockerId, blockedId },
    });
    res.status(201).json({ id: block.id, blockedId, createdAt: block.createdAt.toISOString() });
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "You have already blocked this user." });
    }
    throw err;
  }
}));

// DELETE /api/blocks/:blockedId — unblock a user
app.delete("/api/blocks/:blockedId", requireUser, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const blockerId = (req as any).user.id;
  const { blockedId } = req.params;

  const block = await prismaClient.userBlock.findUnique({
    where: { blockerId_blockedId: { blockerId, blockedId } },
  });
  if (!block) return res.status(404).json({ error: "Block record not found." });

  await prismaClient.userBlock.delete({
    where: { blockerId_blockedId: { blockerId, blockedId } },
  });
  res.json({ success: true });
}));

// ============================================================
// REPORT ENDPOINTS
// ============================================================

// POST /api/reports — submit a report
app.post("/api/reports", requireUser, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const reporterId = (req as any).user.id;
  const { reportedUserId, lectureId, commentId, commentType, commentContent, reason, description } = req.body;

  const validReasons = ["Spam", "Harassment / Abuse", "Hate Speech", "False Information", "Inappropriate Content", "Off-topic", "Other"];
  const validTypes = ["question", "answer"];

  if (!commentId || !commentType || !reason) {
    return res.status(400).json({ error: "commentId, commentType, and reason are required." });
  }
  if (!validReasons.includes(reason)) {
    return res.status(400).json({ error: "Invalid reason." });
  }
  if (!validTypes.includes(commentType)) {
    return res.status(400).json({ error: "Invalid comment type." });
  }
  const reportedComment = commentType === "question"
    ? await prismaClient.qaQuestion.findUnique({
        where: { id: commentId },
        select: { id: true, userId: true, lectureId: true, content: true, isDeleted: true },
      })
    : await prismaClient.qaAnswer.findUnique({
        where: { id: commentId },
        select: { id: true, userId: true, content: true, isDeleted: true, question: { select: { lectureId: true } } },
      });
  if (!reportedComment || reportedComment.isDeleted) {
    return res.status(404).json({ error: "Reported content not found." });
  }

  const derivedReportedUserId = reportedComment.userId;
  const derivedLectureId = commentType === "question"
    ? (reportedComment as any).lectureId
    : (reportedComment as any).question.lectureId;
  const derivedCommentContent = reportedComment.content;
  if (reporterId === derivedReportedUserId) {
    return res.status(400).json({ error: "You cannot report your own content." });
  }
  if (reportedUserId && reportedUserId !== derivedReportedUserId) {
    return res.status(400).json({ error: "Reported user does not match the selected content." });
  }
  if (lectureId && lectureId !== derivedLectureId) {
    return res.status(400).json({ error: "Lecture does not match the selected content." });
  }

  try {
    const report = await prismaClient.report.create({
      data: {
        reporterId,
        reportedUserId: derivedReportedUserId,
        lectureId: derivedLectureId || null,
        commentId,
        commentType,
        commentContent: derivedCommentContent.slice(0, 500),
        reason,
        description: description?.trim() || null,
        status: "Pending",
      },
    });
    io.to("admins").emit("report_created", { id: report.id, status: report.status });
    res.status(201).json({ id: report.id, status: report.status });
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "You have already reported this comment." });
    }
    throw err;
  }
}));

// GET /api/reports/mine — get the caller's submitted reports
app.get("/api/reports/mine", requireUser, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const reporterId = (req as any).user.id;

  // Select only the fields the response mapping uses — avoids fetching description,
  // reportedUserId, and other unused columns on this user-facing endpoint.
  const reports = await prismaClient.report.findMany({
    where: { reporterId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      reason: true,
      lectureId: true,
      status: true,
      createdAt: true,
      commentContent: true,
      commentType: true,
    },
  });

  // Resolve lecture names in a single query
  const lectureIds = [...new Set(reports.map((r: any) => r.lectureId).filter(Boolean))];
  const lectures = lectureIds.length > 0
    ? await prismaClient.lecture.findMany({ where: { id: { in: lectureIds as string[] } }, select: { id: true, name: true } })
    : [];
  const lectureMap = Object.fromEntries(lectures.map((l: any) => [l.id, l.name]));

  res.json(reports.map((r: any) => ({
    id: r.id,
    reason: r.reason,
    lectureName: r.lectureId ? (lectureMap[r.lectureId] || null) : null,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    commentContent: r.commentContent,
    commentType: r.commentType,
  })));
}));

// GET /api/reports — admin: get all reports (with reporter + reported user info)
app.get("/api/reports", requireAdmin, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const { status } = req.query;

  const where: any = {};
  if (status && status !== "All") where.status = status;

  const reports = await prismaClient.report.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      reporter: { select: { id: true, name: true, email: true } },
      reportedUser: { select: { id: true, name: true, email: true } },
    },
  });

  // Count reports per commentId
  const commentIds = [...new Set(reports.map((r: any) => r.commentId))];
  const countRows = await prismaClient.report.groupBy({
    by: ["commentId"],
    where: { commentId: { in: commentIds } },
    _count: { id: true },
  });
  const countMap = Object.fromEntries(countRows.map((c: any) => [c.commentId, c._count.id]));

  // Resolve lecture names
  const lectureIds = [...new Set(reports.map((r: any) => r.lectureId).filter(Boolean))];
  const lectures = lectureIds.length > 0
    ? await prismaClient.lecture.findMany({ where: { id: { in: lectureIds as string[] } }, select: { id: true, name: true } })
    : [];
  const lectureMap = Object.fromEntries(lectures.map((l: any) => [l.id, l.name]));

  res.json(reports.map((r: any) => ({
    id: r.id,
    reason: r.reason,
    description: r.description,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    commentContent: r.commentContent,
    commentType: r.commentType,
    commentId: r.commentId,
    count: countMap[r.commentId] || 1,
    reporter: r.reporter,
    reportedUser: r.reportedUser,
    lectureName: r.lectureId ? (lectureMap[r.lectureId] || null) : null,
  })));
}));

// PATCH /api/reports/:id/status — admin: change report status
app.patch("/api/reports/:id/status", requireAdmin, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const { id } = req.params;
  const { status } = req.body;

  const valid = ["Pending", "Approved", "Resolved", "Rejected"];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: "Invalid status value." });
  }

  const report = await prismaClient.report.findUnique({ where: { id } });
  if (!report) return res.status(404).json({ error: "Report not found." });

  const updated = await prismaClient.report.update({ where: { id }, data: { status } });

  // Broadcast real-time status update to all connected clients
  io.to("admins").emit("reportStatusUpdated", {
    id: updated.id,
    status: updated.status,
    reporterId: report.reporterId,
  });
  if (report.reporterId) {
    io.to(`user-${report.reporterId}`).emit("reportStatusUpdated", {
      id: updated.id,
      status: updated.status,
      reporterId: report.reporterId,
    });
  }
  io.to("admins").emit("moderation_history_updated");

  // Audit log: record reject/status change
  const adminId = (req as any).user?.id;
  if (adminId && status === "Rejected") {
    await logModerationAction(prismaClient, {
      actionType: "REJECT_REPORT",
      adminId,
      targetUserId: report.reportedUserId,
      reportId: id,
      reason: `Report status changed to ${status}`,
      oldStatus: report.status,
      newStatus: status,
    });
  }

  res.json({ id: updated.id, status: updated.status });
}));

// DELETE /api/reports/comment/:commentId — admin: delete the comment and resolve all its reports
app.delete("/api/reports/comment/:commentId", requireAdmin, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const { commentId } = req.params;
  const { type } = req.query; // "question" or "answer"

  await prismaClient.$transaction(async (tx: any) => {
    // Soft-delete the comment
    if (type === "question") {
      await tx.qaQuestion.update({ where: { id: commentId }, data: { isDeleted: true } });
    } else {
      await tx.qaAnswer.update({ where: { id: commentId }, data: { isDeleted: true } });
    }
    // Resolve all reports for this comment
    await tx.report.updateMany({
      where: { commentId },
      data: { status: "Resolved" },
    });
  });

  // Audit log
  const adminId = (req as any).user?.id;
  if (adminId) {
    const commentType = (type as string) === "question" ? "question" : "answer";
    await logModerationAction(prismaClient, {
      actionType: commentType === "question" ? "DELETE_QUESTION" : "DELETE_ANSWER",
      adminId,
      commentId,
      newStatus: "Deleted",
      metadata: { commentType, source: "report_delete" },
    });
  }

  res.json({ success: true });
}));

// ============================================================
// PENALTY SYSTEM — Approve report with penalty action
// ============================================================

// POST /api/reports/:id/approve — admin: approve report + apply penalty
app.post("/api/reports/:id/approve", requireAdmin, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const adminId = (req as any).user.id;
  const { id } = req.params;
  const { penaltyType, reason, durationMinutes, isPermanent, alsoDeleteComment } = req.body;

  if (!["delete", "mute", "ban"].includes(penaltyType)) {
    return res.status(400).json({ error: "Invalid penalty type. Use delete, mute, or ban." });
  }
  if (!reason || typeof reason !== "string" || !reason.trim()) {
    return res.status(400).json({ error: "Reason is required." });
  }
  if ((penaltyType === "mute" || penaltyType === "ban") && !isPermanent) {
    if (!durationMinutes || typeof durationMinutes !== "number" || durationMinutes <= 0) {
      return res.status(400).json({ error: "A positive duration is required for timed mute/ban." });
    }
  }

  const report = await prismaClient.report.findUnique({
    where: { id },
    include: { reportedUser: { select: { id: true, email: true, role: true } } },
  });
  if (!report) return res.status(404).json({ error: "Report not found." });
  if (report.status !== "Pending") return res.status(400).json({ error: "Only pending reports can be approved." });

  // Owner role is the only trusted protection; email does not grant or identify privilege.
  if (report.reportedUser.role === "owner") {
    return res.status(403).json({ error: "Forbidden: Owner accounts cannot be penalized." });
  }

  const targetUserId = report.reportedUserId;
  const endTime = isPermanent ? null : new Date(Date.now() + (durationMinutes || 60) * 60 * 1000);

  await prismaClient.$transaction(async (tx: any) => {
    // Level 1 delete — or "also delete" for Level 2/3
    if (penaltyType === "delete" || alsoDeleteComment) {
      if (report.commentType === "question") {
        await tx.qaQuestion.updateMany({ where: { id: report.commentId }, data: { isDeleted: true } });
      } else {
        await tx.qaAnswer.updateMany({ where: { id: report.commentId }, data: { isDeleted: true } });
      }
      // Resolve all reports for this comment
      await tx.report.updateMany({ where: { commentId: report.commentId }, data: { status: "Approved" } });
    } else {
      // Just approve this one report
      await tx.report.update({ where: { id }, data: { status: "Approved" } });
    }

    // Level 2 — mute user
    if (penaltyType === "mute") {
      await tx.userMute.upsert({
        where: { userId: targetUserId },
        create: { userId: targetUserId, reason: reason.trim(), endTime, isPermanent: !!isPermanent, createdBy: adminId },
        update: { reason: reason.trim(), startTime: new Date(), endTime, isPermanent: !!isPermanent, createdBy: adminId },
      });
    }

    // Level 3 — ban user
    if (penaltyType === "ban") {
      await tx.userBan.upsert({
        where: { userId: targetUserId },
        create: { userId: targetUserId, reason: reason.trim(), endTime, isPermanent: !!isPermanent, createdBy: adminId },
        update: { reason: reason.trim(), startTime: new Date(), endTime, isPermanent: !!isPermanent, createdBy: adminId },
      });
      await tx.user.update({ where: { id: targetUserId }, data: { accountStatus: "banned" } });
    }
  });

  // Real-time notifications for mute / ban
  if (penaltyType === "mute") {
    await emitToUser(getPrisma(), targetUserId, "userMuteUpdate", {
      userId: targetUserId,
      isMuted: true,
      isPermanent: !!isPermanent,
      endTime: endTime?.toISOString() || null,
      reason: reason.trim(),
    });
    // Persist + deliver system notification to the muted user
    await createMuteNotification(getPrisma(), targetUserId, reason.trim(), !!isPermanent, endTime);
  }
  if (penaltyType === "ban") {
    // Send the ban notification first so the client can display it before being logged out
    await emitToUser(getPrisma(), targetUserId, "userBanNotification", {
      userId: targetUserId,
      reason: reason.trim(),
      isPermanent: !!isPermanent,
      endTime: endTime?.toISOString() || null,
    });
    await emitToUser(getPrisma(), targetUserId, "userForcedLogout", { userId: targetUserId });
    await refreshUserSocketAuthorization(targetUserId);
  }

  // Broadcast report status update
  io.to("admins").emit("reportStatusUpdated", { id, status: "Approved", reporterId: report.reporterId });
  if (report.reporterId) {
    io.to(`user-${report.reporterId}`).emit("reportStatusUpdated", { id, status: "Approved", reporterId: report.reporterId });
  }
  io.to("admins").emit("moderation_history_updated");

  // Audit log: APPROVE_REPORT + the specific penalty
  const logBase = {
    adminId,
    targetUserId,
    reportId: id,
    lectureId: report.lectureId ?? null,
    reason: reason.trim(),
    commentId: report.commentId,
  };
  await logModerationAction(getPrisma(), { ...logBase, actionType: "APPROVE_REPORT", newStatus: "Approved", oldStatus: "Pending" });
  if (penaltyType === "delete" || alsoDeleteComment) {
    await logModerationAction(getPrisma(), {
      ...logBase,
      actionType: report.commentType === "question" ? "DELETE_QUESTION" : "DELETE_ANSWER",
      newStatus: "Deleted",
      metadata: { commentType: report.commentType, source: "approve_report" },
    });
  }
  if (penaltyType === "mute") {
    await logModerationAction(getPrisma(), {
      ...logBase,
      actionType: "MUTE_USER",
      duration: durationMinutes ?? null,
      isPermanent: !!isPermanent,
      expiresAt: endTime,
      metadata: { source: "approve_report" },
    });
  }
  if (penaltyType === "ban") {
    await logModerationAction(getPrisma(), {
      ...logBase,
      actionType: "BAN_USER",
      duration: durationMinutes ?? null,
      isPermanent: !!isPermanent,
      expiresAt: endTime,
      metadata: { source: "approve_report" },
    });
  }

  res.json({ success: true });
}));

// ============================================================
// MUTE MANAGEMENT ROUTES
// ============================================================

// POST /api/moderation/bans — direct ban (no report required, e.g. from Live Study Hall)
app.post("/api/moderation/bans", requireAdmin, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const adminId = (req as any).user.id;
  const { userId, reason, durationMinutes, isPermanent } = req.body;

  if (!userId || typeof userId !== "string") {
    return res.status(400).json({ error: "userId is required." });
  }
  if (!reason || typeof reason !== "string" || !reason.trim()) {
    return res.status(400).json({ error: "Reason is required." });
  }
  if (reason.trim().length > 500) {
    return res.status(400).json({ error: "Reason must be under 500 characters." });
  }
  if (!isPermanent) {
    if (!durationMinutes || typeof durationMinutes !== "number" || durationMinutes <= 0 || durationMinutes > 525600) {
      return res.status(400).json({ error: "A positive duration (max 1 year) is required for a timed ban." });
    }
  }

  const target = await UserService.findById(userId);
  if (!target) return res.status(404).json({ error: "User not found." });

  if (target.role === "owner") {
    return res.status(403).json({ error: "Forbidden: Owner accounts cannot be banned." });
  }

  const endTime = isPermanent ? null : new Date(Date.now() + (durationMinutes || 60) * 60 * 1000);

  await prismaClient.$transaction(async (tx: any) => {
    await tx.userBan.upsert({
      where: { userId },
      create: { userId, reason: reason.trim(), endTime, isPermanent: !!isPermanent, createdBy: adminId },
      update: { reason: reason.trim(), startTime: new Date(), endTime, isPermanent: !!isPermanent, createdBy: adminId },
    });
    await tx.user.update({ where: { id: userId }, data: { accountStatus: "banned" } });
  });

  // Notify the targeted user then force-logout
  await emitToUser(prismaClient, userId, "userBanNotification", {
    userId,
    reason: reason.trim(),
    isPermanent: !!isPermanent,
    endTime: endTime?.toISOString() || null,
  });
  await emitToUser(prismaClient, userId, "userForcedLogout", { userId });
  await refreshUserSocketAuthorization(userId);

  await logModerationAction(getPrisma(), {
    actionType: "BAN_USER",
    adminId,
    targetUserId: userId,
    reason: reason.trim(),
    duration: isPermanent ? null : (durationMinutes ?? null),
    isPermanent: !!isPermanent,
    expiresAt: endTime,
    metadata: { source: "direct_ban" },
  });

  io.to("admins").emit("ban_list_updated");
  io.to("admins").emit("moderation_history_updated");
  res.json({ success: true });
}));

// POST /api/moderation/mutes — direct mute (no report required, e.g. from Live Study Hall)
app.post("/api/moderation/mutes", requireAdmin, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const adminId = (req as any).user.id;
  const { userId, reason, durationMinutes, isPermanent } = req.body;

  if (!userId || typeof userId !== "string") {
    return res.status(400).json({ error: "userId is required." });
  }
  if (!reason || typeof reason !== "string" || !reason.trim()) {
    return res.status(400).json({ error: "Reason is required." });
  }
  if (reason.trim().length > 500) {
    return res.status(400).json({ error: "Reason must be under 500 characters." });
  }
  if (!isPermanent) {
    if (!durationMinutes || typeof durationMinutes !== "number" || durationMinutes <= 0 || durationMinutes > 525600) {
      return res.status(400).json({ error: "A positive duration (max 1 year) is required for a timed mute." });
    }
  }

  const target = await UserService.findById(userId);
  if (!target) return res.status(404).json({ error: "User not found." });

  if (target.role === "owner") {
    return res.status(403).json({ error: "Forbidden: Owner accounts cannot be muted." });
  }

  const endTime = isPermanent ? null : new Date(Date.now() + (durationMinutes || 60) * 60 * 1000);

  await prismaClient.userMute.upsert({
    where: { userId },
      create: { userId, reason: reason.trim(), endTime, isPermanent: !!isPermanent, createdBy: adminId },
    update: { reason: reason.trim(), endTime, isPermanent: !!isPermanent },
  });

  // Real-time mute update to the targeted user
  await emitToUser(prismaClient, userId, "userMuteUpdate", {
    userId,
    isMuted: true,
    isPermanent: !!isPermanent,
    endTime: endTime?.toISOString() || null,
    reason: reason.trim(),
  });

  // Persist + deliver the mute notification to the user only
  await createMuteNotification(prismaClient, userId, reason.trim(), !!isPermanent, endTime);

  await logModerationAction(getPrisma(), {
    actionType: "MUTE_USER",
    adminId,
    targetUserId: userId,
    reason: reason.trim(),
    duration: isPermanent ? null : (durationMinutes ?? null),
    isPermanent: !!isPermanent,
    expiresAt: endTime,
    metadata: { source: "direct_mute" },
  });

  io.to("admins").emit("mute_list_updated");
  io.to("admins").emit("moderation_history_updated");
  res.json({ success: true });
}));

// ============================================================
// MODERATION HISTORY ENDPOINTS
// ============================================================

// GET /api/moderation/history/admins — list admins who have ever taken a moderation action
app.get("/api/moderation/history/admins", requireAdmin, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const rows = await prismaClient.moderationHistory.findMany({
    distinct: ["adminId"],
    select: {
      admin: { select: { id: true, name: true, email: true, avatarUrl: true, avatar: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows.map((r: any) => r.admin).filter(Boolean));
}));

// GET /api/moderation/history/user/:userId — full disciplinary record for one user
app.get("/api/moderation/history/user/:userId", requireAdmin, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const { userId } = req.params;

  const records = await prismaClient.moderationHistory.findMany({
    where: { targetUserId: userId },
    orderBy: { createdAt: "desc" },
    include: {
      admin: { select: { id: true, name: true, email: true, avatarUrl: true, avatar: true } },
    },
  });

  // Build disciplinary summary
  const summary = {
    totalActions: records.length,
    approvedReports: records.filter((r: any) => r.actionType === "APPROVE_REPORT").length,
    rejectedReports: records.filter((r: any) => r.actionType === "REJECT_REPORT").length,
    deletedQuestions: records.filter((r: any) => r.actionType === "DELETE_QUESTION").length,
    deletedAnswers: records.filter((r: any) => r.actionType === "DELETE_ANSWER").length,
    muteCount: records.filter((r: any) => ["MUTE_USER","PERMANENT_MUTE","UPDATE_MUTE"].includes(r.actionType)).length,
    banCount: records.filter((r: any) => ["BAN_USER","PERMANENT_BAN","UPDATE_BAN"].includes(r.actionType)).length,
    firstActionAt: records.length ? records[records.length - 1].createdAt : null,
    lastActionAt: records.length ? records[0].createdAt : null,
    hasPermanentMute: records.some((r: any) => r.isPermanent && ["MUTE_USER","PERMANENT_MUTE"].includes(r.actionType)),
    hasPermanentBan: records.some((r: any) => r.isPermanent && ["BAN_USER","PERMANENT_BAN"].includes(r.actionType)),
  };

  // Risk level derived from real history
  let riskLevel = "No Violations";
  const score =
    summary.approvedReports * 3 +
    summary.deletedQuestions * 2 +
    summary.deletedAnswers * 2 +
    summary.muteCount * 4 +
    summary.banCount * 8;
  if (score >= 20) riskLevel = "Repeat Offender";
  else if (score >= 12) riskLevel = "High Risk";
  else if (score >= 6)  riskLevel = "Medium Risk";
  else if (score >= 2)  riskLevel = "Low Risk";

  res.json({ records, summary: { ...summary, riskLevel } });
}));

// GET /api/moderation/history — paginated history with filters + search
app.get("/api/moderation/history", requireAdmin, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const {
    page         = "1",
    limit        = "25",
    actionType,
    adminId,
    targetUserId,
    startDate,
    endDate,
    search,
    isPermanent,
    activeOnly,
    expiredOnly,
    isSystemAction,
  } = req.query as Record<string, string | undefined>;

  const pageNum  = Math.max(1, parseInt(page)  || 1);
  const limitNum = Math.min(500, Math.max(1, parseInt(limit) || 25));
  const skip     = (pageNum - 1) * limitNum;

  const REMOVAL_TYPES = ["REMOVE_MUTE", "REMOVE_BAN", "MUTE_EXPIRED", "BAN_EXPIRED"];
  const PENALTY_TYPES = ["MUTE_USER", "BAN_USER", "UPDATE_MUTE", "UPDATE_BAN", "EXTEND_MUTE", "REDUCE_MUTE", "EXTEND_BAN", "REDUCE_BAN", "PERMANENT_MUTE", "PERMANENT_BAN"];

  const where: any = {};
  if (actionType)        where.actionType   = actionType;
  if (adminId)           where.adminId      = adminId;
  if (targetUserId)      where.targetUserId = targetUserId;
  if (isPermanent === "true") where.isPermanent = true;
  if (isSystemAction === "true") where.isSystemAction = true;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }

  const now = new Date();
  if (activeOnly === "true") {
    // Active: penalty-type records where not yet removed/expired
    where.actionType = { in: PENALTY_TYPES };
    where.AND = [
      { NOT: { actionType: { in: REMOVAL_TYPES } } },
      {
        OR: [
          { isPermanent: true },
          { expiresAt: { gt: now } },
          { expiresAt: null, isPermanent: false },
        ],
      },
    ];
  } else if (expiredOnly === "true") {
    // Expired: either an expiry event or a penalty that has passed its expiresAt
    where.OR = [
      { actionType: { in: REMOVAL_TYPES } },
      { expiresAt: { lte: now }, actionType: { in: PENALTY_TYPES } },
    ];
  }

  if (search && search.trim()) {
    const q = search.trim();
    const searchClause = [
      { reason: { contains: q, mode: "insensitive" } },
      { reportId: { contains: q, mode: "insensitive" } },
      { commentId: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
      { admin: { name:  { contains: q, mode: "insensitive" } } },
      { admin: { email: { contains: q, mode: "insensitive" } } },
      { targetUser: { name:  { contains: q, mode: "insensitive" } } },
      { targetUser: { email: { contains: q, mode: "insensitive" } } },
    ];
    // Merge with any existing OR/AND from activeOnly/expiredOnly
    if (where.OR) {
      where.AND = [...(where.AND || []), { OR: searchClause }];
    } else {
      where.OR = searchClause;
    }
  }

  const include = {
    admin:      { select: { id: true, name: true, email: true, avatarUrl: true, avatar: true } },
    targetUser: { select: { id: true, name: true, email: true, avatarUrl: true, avatar: true } },
  };

  const [total, records] = await Promise.all([
    prismaClient.moderationHistory.count({ where }),
    prismaClient.moderationHistory.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limitNum,
      include,
    }),
  ]);

  res.json({
    records,
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum) || 1,
  });
}));

// GET /api/moderation/mutes — list all active mutes with user info
app.get("/api/moderation/mutes", requireAdmin, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const now = new Date();

  const mutes = await prismaClient.userMute.findMany({
    where: { OR: [{ isPermanent: true }, { endTime: { gt: now } }] },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, name: true, avatar: true, avatarUrl: true, email: true } } },
  });

  res.json(mutes.map((m: any) => ({
    id: m.id,
    userId: m.userId,
    name: m.user?.name || "Unknown",
    email: m.user?.email || "",
    avatar: m.user?.avatarUrl || m.user?.avatar || "",
    reason: m.reason,
    startTime: m.startTime.toISOString(),
    endTime: m.endTime ? m.endTime.toISOString() : null,
    isPermanent: m.isPermanent,
    createdAt: m.createdAt.toISOString(),
  })));
}));

// DELETE /api/moderation/mutes/:userId — remove a mute
app.delete("/api/moderation/mutes/:userId", requireAdmin, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const { userId } = req.params;

  // Single delete call — eliminates the findUnique + delete round trip.
  // P2025 means the record doesn't exist; surface as 404.
  let mute: any;
  try {
    mute = await prismaClient.userMute.delete({
      where: { userId },
      select: { reason: true, endTime: true, isPermanent: true },
    });
  } catch (e: any) {
    if (e.code === "P2025") return res.status(404).json({ error: "Mute record not found." });
    throw e;
  }

  // Real-time: lift mute restrictions immediately for the user
  await emitToUser(prismaClient, userId, "userMuteUpdate", { userId, isMuted: false, isPermanent: false, endTime: null, reason: null });
  io.to("admins").emit("mute_list_updated");
  io.to("admins").emit("moderation_history_updated");

  // Notify the affected user that their mute has been lifted
  await createMuteRemovedNotification(prismaClient, userId, mute.reason);

  const delMuteAdminId = (req as any).user?.id;
  if (delMuteAdminId) {
    await logModerationAction(prismaClient, {
      actionType: "REMOVE_MUTE",
      adminId: delMuteAdminId,
      targetUserId: userId,
      reason: mute.reason,
      metadata: { previousEndTime: mute.endTime?.toISOString() ?? null, wasPermanent: mute.isPermanent },
    });
  }

  res.json({ success: true });
}));

// POST /api/moderation/mutes/:userId/notify — resend mute notification to a specific user
app.post("/api/moderation/mutes/:userId/notify", requireAdmin, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const { userId } = req.params;
  const mute = await prismaClient.userMute.findUnique({ where: { userId } });
  if (!mute) return res.status(404).json({ error: "Mute record not found." });
  await createMuteNotification(prismaClient, userId, mute.reason, mute.isPermanent, mute.endTime);
  res.json({ success: true, message: "Notification sent." });
}));

// PATCH /api/moderation/mutes/:userId — update mute (extend/shorten/make permanent)
app.patch("/api/moderation/mutes/:userId", requireAdmin, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const { userId } = req.params;
  const { durationMinutes, isPermanent } = req.body;

  const mute = await prismaClient.userMute.findUnique({ where: { userId } });
  if (!mute) return res.status(404).json({ error: "Mute record not found." });

  let endTime: Date | null = null;
  if (!isPermanent) {
    if (!durationMinutes || typeof durationMinutes !== "number" || durationMinutes <= 0) {
      return res.status(400).json({ error: "Positive durationMinutes required for timed mute." });
    }
    endTime = new Date(Date.now() + durationMinutes * 60 * 1000);
  }

  const updated = await prismaClient.userMute.update({
    where: { userId },
    data: { endTime, isPermanent: !!isPermanent },
  });

  // Notify the user that their mute has been updated
  await emitToUser(prismaClient, userId, "userMuteUpdate", {
    userId,
    isMuted: true,
    isPermanent: !!isPermanent,
    endTime: updated.endTime?.toISOString() || null,
    reason: mute.reason,
  });

  const updMuteAdminId = (req as any).user?.id;
  if (updMuteAdminId) {
    let muteActionType = "EXTEND_MUTE";
    if (isPermanent) {
      muteActionType = "PERMANENT_MUTE";
    } else if (mute.isPermanent) {
      // was permanent, now timed — treat as reduce
      muteActionType = "REDUCE_MUTE";
    } else if (mute.endTime && endTime) {
      muteActionType = endTime > mute.endTime ? "EXTEND_MUTE" : "REDUCE_MUTE";
    }
    await logModerationAction(prismaClient, {
      actionType: muteActionType,
      adminId: updMuteAdminId,
      targetUserId: userId,
      reason: mute.reason,
      duration: isPermanent ? null : (durationMinutes ?? null),
      isPermanent: !!isPermanent,
      expiresAt: updated.endTime,
      metadata: {
        previousEndTime: mute.endTime?.toISOString() ?? null,
        wasPermanent: mute.isPermanent,
      },
    });
  }

  // Notify the affected user about the updated mute details
  await createMuteNotification(prismaClient, userId, mute.reason, !!isPermanent, updated.endTime, "update");

  io.to("admins").emit("mute_list_updated");
  io.to("admins").emit("moderation_history_updated");
  res.json({ success: true, endTime: updated.endTime?.toISOString() || null, isPermanent: updated.isPermanent });
}));

// GET /api/user/mute-status — fetch the current authenticated user's active mute (if any)
app.get("/api/user/mute-status", requireUser, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const userId = (req as any).user.id;
  const now = new Date();

  const mute = await prismaClient.userMute.findUnique({ where: { userId } });

  if (!mute) return res.json({ isMuted: false });

  // Auto-expire timed mutes
  if (!mute.isPermanent && mute.endTime && mute.endTime <= now) {
    await prismaClient.userMute.delete({ where: { userId } });
    await logModerationAction(prismaClient, { actionType: "MUTE_EXPIRED", targetUserId: userId, isSystemAction: true, metadata: { expiredAt: now.toISOString() } });
    return res.json({ isMuted: false });
  }

  return res.json({
    isMuted: true,
    isPermanent: mute.isPermanent,
    endTime: mute.endTime?.toISOString() || null,
    reason: mute.reason,
  });
}));

// ============================================================
// BAN MANAGEMENT ROUTES
// ============================================================

// GET /api/moderation/bans — list all active bans with user info
app.get("/api/moderation/bans", requireAdmin, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const now = new Date();

  const bans = await prismaClient.userBan.findMany({
    where: { OR: [{ isPermanent: true }, { endTime: { gt: now } }] },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, name: true, avatar: true, avatarUrl: true, email: true } } },
  });

  res.json(bans.map((b: any) => ({
    id: b.id,
    userId: b.userId,
    name: b.user?.name || "Unknown",
    email: b.user?.email || "",
    avatar: b.user?.avatarUrl || b.user?.avatar || "",
    reason: b.reason,
    startTime: b.startTime.toISOString(),
    endTime: b.endTime ? b.endTime.toISOString() : null,
    isPermanent: b.isPermanent,
    createdAt: b.createdAt.toISOString(),
  })));
}));

// DELETE /api/moderation/bans/:userId — remove a ban (restores access)
app.delete("/api/moderation/bans/:userId", requireAdmin, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const { userId } = req.params;

  // Delete + restore accountStatus atomically. P2025 = ban not found → 404.
  let ban: any;
  try {
    await prismaClient.$transaction(async (tx: any) => {
      ban = await tx.userBan.delete({
        where: { userId },
        select: { reason: true, endTime: true, isPermanent: true },
      });
      await tx.user.update({ where: { id: userId }, data: { accountStatus: "ACTIVE" } });
    });
  } catch (e: any) {
    if (e.code === "P2025") return res.status(404).json({ error: "Ban record not found." });
    throw e;
  }

  // Notify the unbanned user so their session can clear the ban screen immediately
  await emitToUser(prismaClient, userId, "userBanRemoved", { userId });
  await refreshUserSocketAuthorization(userId);

  const delBanAdminId = (req as any).user?.id;
  if (delBanAdminId) {
    await logModerationAction(prismaClient, {
      actionType: "REMOVE_BAN",
      adminId: delBanAdminId,
      targetUserId: userId,
      reason: ban.reason,
      metadata: { previousEndTime: ban.endTime?.toISOString() ?? null, wasPermanent: ban.isPermanent },
    });
  }

  io.to("admins").emit("ban_list_updated");
  io.to("admins").emit("moderation_history_updated");
  res.json({ success: true });
}));

// PATCH /api/moderation/bans/:userId — update ban (extend/shorten/make permanent)
app.patch("/api/moderation/bans/:userId", requireAdmin, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const { userId } = req.params;
  const { durationMinutes, isPermanent } = req.body;

  const ban = await prismaClient.userBan.findUnique({ where: { userId } });
  if (!ban) return res.status(404).json({ error: "Ban record not found." });

  let endTime: Date | null = null;
  if (!isPermanent) {
    if (!durationMinutes || typeof durationMinutes !== "number" || durationMinutes <= 0) {
      return res.status(400).json({ error: "Positive durationMinutes required for timed ban." });
    }
    endTime = new Date(Date.now() + durationMinutes * 60 * 1000);
  }

  const updated = await prismaClient.userBan.update({
    where: { userId },
    data: { endTime, isPermanent: !!isPermanent },
  });

  const updBanAdminId = (req as any).user?.id;
  if (updBanAdminId) {
    let banActionType = "EXTEND_BAN";
    if (isPermanent) {
      banActionType = "PERMANENT_BAN";
    } else if (ban.isPermanent) {
      banActionType = "REDUCE_BAN";
    } else if (ban.endTime && endTime) {
      banActionType = endTime > ban.endTime ? "EXTEND_BAN" : "REDUCE_BAN";
    }
    await logModerationAction(prismaClient, {
      actionType: banActionType,
      adminId: updBanAdminId,
      targetUserId: userId,
      reason: ban.reason,
      duration: isPermanent ? null : (durationMinutes ?? null),
      isPermanent: !!isPermanent,
      expiresAt: updated.endTime,
      metadata: {
        previousEndTime: ban.endTime?.toISOString() ?? null,
        wasPermanent: ban.isPermanent,
      },
    });
  }

  io.to("admins").emit("ban_list_updated");
  io.to("admins").emit("moderation_history_updated");
  res.json({ success: true, endTime: updated.endTime?.toISOString() || null, isPermanent: updated.isPermanent });
}));

// Calendar Events Endpoints
app.delete("/api/calendar/events/:id", requireAdmin, catchAsync(async (req, res) => {
  const eventId = req.params.id;
  const prismaClient = getPrisma();

  // Use deleteMany for idempotent delete — returns {count:0} when not found instead of throwing
  const result = await prismaClient.calendarEvent.deleteMany({ where: { id: eventId } });

  if (result.count > 0 && io) {
    io.to("authenticated").emit("calendar_updated", { action: "delete", eventId });
  }
  // D1 contains global calendar rows only. An idempotent delete is always safe:
  // for a personal event there should be no D1 row, and for a missing source row
  // it removes any stale replica.
  await syncContentDelete("CalendarEvent", eventId);
  invalidateMaterialsCache();

  auditLog(req, "DELETE_CALENDAR_EVENT", eventId, "Success");
  res.json({ success: true, deleted: result.count > 0 });
}));

app.get("/api/calendar/events", requireUser, catchAsync(async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-cache");
    const prismaClient = getPrisma();
    const userId = (req as any).user?.id;
    const currentUser = (req as any).user;
    const isPrivileged = currentUser?.role === "admin" || currentUser?.role === "owner";
    
    const events = await prismaClient.calendarEvent.findMany({
      take: 1000,
      where: {
        OR: [
          { userId: null },
          { userId: userId }
        ]
      },
      orderBy: {
        startDateTime: "asc"
      }
    });

    const parsedEvents = events
      .filter(event => isPrivileged || event.userId !== null || eventVisibleToGroup(event.targetGroups, currentUser?.studentGroup))
      .map(event => ({
        ...event,
        targetGroups: parseTargetGroups(event.targetGroups)
      }));

    res.json(parsedEvents);
  } catch (err: any) {
    console.error("Failed to fetch calendar events:", err instanceof Error ? err.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

app.post("/api/calendar/events", requireAdmin, catchAsync(async (req, res) => {
  try {
    const { title, eventType, startDateTime, endDateTime, targetGroups, sendNotification, description, subjectId, lectureId, room, doctor, notes, isPinned, isCompleted } = req.body;
    
    // Core payload validation
    if (!title || !eventType || !startDateTime || !endDateTime || !targetGroups || !Array.isArray(targetGroups)) {
      return res.status(400).json({ error: "Required fields are missing: title, eventType, startDateTime, endDateTime, targetGroups." });
    }

    const uppercaseType = eventType.toUpperCase();
    // Allow custom event types like 'TASK', 'PERSONAL', etc.
    const validGlobalTypes = ['LECTURE', 'QUIZ', 'EXAM', 'TASK', 'PERSONAL', 'HOLIDAY'];
    if (!validGlobalTypes.includes(uppercaseType)) {
      // allow anyway, but warn
    }

    const nS = new Date(startDateTime);
    let nE = new Date(endDateTime);

    if (isNaN(nS.getTime()) || isNaN(nE.getTime())) {
      return res.status(400).json({ error: "startDateTime or endDateTime has an invalid date format." });
    }

    if (nS >= nE) {
      // Auto-correct AM/PM confusion (e.g., user selected 12:30 AM instead of 12:30 PM)
      const correctedEnd = new Date(nE.getTime() + 12 * 60 * 60 * 1000);
      if (nS < correctedEnd) {
        nE = correctedEnd;
      } else {
        return res.status(400).json({ error: "startDateTime must be before endDateTime." });
      }
    }

    const prismaClient = getPrisma();

    // Idempotency for offline retries: the offline queue sends a stable clientId.
    // If the first attempt committed but its response was lost, a retry must not
    // create a duplicate event. When an identical event already exists, treat the
    // retry as success and return the stored event instead.
    const clientId = req.body.clientId;
    if (clientId) {
      const requestedGroups = targetGroups
        .map((group: unknown) => String(group).trim())
        .filter(Boolean)
        .sort()
        .join(",");
      const candidateEvents = await prismaClient.calendarEvent.findMany({
        where: { title, startDateTime: nS, endDateTime: nE },
      });
      const existingEvent = candidateEvents.find((event) =>
        String(event.targetGroups || "")
          .split(",")
          .map((group) => group.trim())
          .filter(Boolean)
          .sort()
          .join(",") === requestedGroups
      );
      if (existingEvent) {
        const parsedExistingEvent = {
          ...existingEvent,
          targetGroups: typeof existingEvent.targetGroups === "string" ? existingEvent.targetGroups.split(",").filter(Boolean) : (existingEvent.targetGroups || [])
        };
        if (existingEvent.userId == null) {
          await syncContentUpsert("CalendarEvent", toCalendarEventContentRow(existingEvent));
        }
        auditLog(req, "CREATE_CALENDAR_EVENT", existingEvent.id, "Idempotent (offline retry)");
        return res.status(201).json(parsedExistingEvent);
      }
    }

    // Check conflict (overlapping times only if targetGroups conflict)
    const existingEvents = await prismaClient.calendarEvent.findMany({ take: 1000, where: { AND: [{ startDateTime: { lt: nE } }, { endDateTime: { gt: nS } }] } });
    const hasConflict = existingEvents.some(event => {
      // Holidays never conflict with other events
      if (uppercaseType === "HOLIDAY" || event.eventType === "HOLIDAY") return false;

      const eS = new Date(event.startDateTime);
      const eE = new Date(event.endDateTime);
      
      const isTimeOverlapping = nS < eE && nE > eS;
      if (!isTimeOverlapping) return false;

      // Group overlap check:
      const eventTargetGroups = typeof event.targetGroups === "string" ? event.targetGroups.split(",").filter(Boolean) : (event.targetGroups || []);
      const newHasAll = targetGroups.includes("ALL");
      const existHasAll = eventTargetGroups.includes("ALL");

      if (newHasAll || existHasAll) return true;

      // Check if they share any common target group
      return targetGroups.some(g => eventTargetGroups.includes(g));
    });

    if (hasConflict) {
      return res.status(400).json({ error: "Time slot conflict for the selected groups." });
    }

    // Save Event to DB (database targetGroups is saved as CSV text)
    const savedEvent = await prismaClient.calendarEvent.create({
      data: {
        title,
        eventType: uppercaseType,
        startDateTime: nS,
        endDateTime: nE,
        targetGroups: targetGroups.join(","),
        description: description || null,
        subjectId: subjectId || null,
        lectureId: lectureId || null,
        room: room || null,
        doctor: doctor || null,
        notes: notes || null,
        isPinned: isPinned || false,
        isCompleted: isCompleted || false
      }
    });

    const parsedSavedEvent = {
      ...savedEvent,
      targetGroups: typeof savedEvent.targetGroups === "string" ? savedEvent.targetGroups.split(",").filter(Boolean) : (savedEvent.targetGroups || [])
    };

    await syncContentUpsert("CalendarEvent", toCalendarEventContentRow(savedEvent));

    // Optional Notification Logic
    if (sendNotification) {
      // Always format dates in Baghdad timezone (UTC+3), not server local time (UTC).
      // This prevents off-by-one date errors for events near midnight Baghdad time.
      const baghdadFormatter = new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Baghdad',
      });
      const formattedDateString = baghdadFormatter.format(nS);
      // Embed an unambiguous ISO date (Baghdad wall-clock date) so the client
      // can extract the exact date without timezone-sensitive Date parsing.
      const baghdadDateISO = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        timeZone: 'Asia/Baghdad',
      }).format(nS); // produces YYYY-MM-DD
      const notificationMessage = `A new ${eventType.toLowerCase()} titled "${title}" has been scheduled of interest to group(s): ${targetGroups.join(", ")} starting on ${formattedDateString}. [date:${baghdadDateISO}]`;
      
      let badgeTitle = "New Event:";
      const typeStr = (eventType || "").toUpperCase();
      if (typeStr === "LECTURE" || typeStr === "CLASS" || typeStr === "LECTURES") {
        badgeTitle = "New Lecture:";
      } else if (typeStr === "QUIZ" || typeStr === "DAILY EXAM") {
        badgeTitle = "New Quiz:";
      } else if (typeStr === "EXAM" || typeStr === "IMPORTANT EXAM") {
        badgeTitle = "New Exam:";
      } else if (typeStr === "HOLIDAY") {
        badgeTitle = "New Holiday:";
      }
      
      const notificationGroups = [...new Set(parseTargetGroups(targetGroups).filter((group) => group !== "ALL"))];
      if (notificationGroups.length === 0) {
        const savedNotification = await prismaClient.notification.create({
          data: { title: `${badgeTitle} ${title}`, message: notificationMessage, isSystem: true },
        });
        io.to("authenticated").emit("receiveSystemNotification", savedNotification);
      } else {
        for (const targetGroup of notificationGroups) {
          const savedNotification = await prismaClient.notification.create({
            data: { title: `${badgeTitle} ${title}`, message: notificationMessage, isSystem: true, targetGroup },
          });
          io.to("group:" + targetGroup).emit("receiveSystemNotification", savedNotification);
        }
      }
      io.to("authenticated").emit("calendar_updated", { action: "upsert", event: parsedSavedEvent });
    } else {
      io.to("authenticated").emit("calendar_updated", { action: "upsert", event: parsedSavedEvent });
    }

    invalidateMaterialsCache();
    res.status(201).json(parsedSavedEvent);
  } catch (err: any) {
    console.error("Failed to create calendar event:", err instanceof Error ? err.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// Update calendar event endpoint
app.put("/api/calendar/events/:id", requireAdmin, catchAsync(async (req, res) => {
  try {
    const { id } = req.params;
    const { title, eventType, startDateTime, endDateTime, targetGroups, description, room, doctor, notes, isPinned, isCompleted } = req.body;

    if (!title || !eventType || !startDateTime || !endDateTime || !targetGroups || !Array.isArray(targetGroups)) {
      return res.status(400).json({ error: "Required fields are missing: title, eventType, startDateTime, endDateTime, targetGroups." });
    }

    const nS = new Date(startDateTime);
    let nE = new Date(endDateTime);

    if (isNaN(nS.getTime()) || isNaN(nE.getTime())) {
      return res.status(400).json({ error: "Invalid date format for startDateTime or endDateTime." });
    }

    if (nS >= nE) {
      const correctedEnd = new Date(nE.getTime() + 12 * 60 * 60 * 1000);
      if (nS < correctedEnd) {
        nE = correctedEnd;
      } else {
        return res.status(400).json({ error: "startDateTime must be before endDateTime." });
      }
    }

    const prismaClient = getPrisma();

    // Conflict check — exclude the event being updated itself
    const uppercaseType = eventType.toUpperCase();
    const existingEvents = await prismaClient.calendarEvent.findMany({
      take: 1000,
      where: {
        id: { not: id },
        AND: [{ startDateTime: { lt: nE } }, { endDateTime: { gt: nS } }],
      },
    });

    const hasConflict = existingEvents.some(event => {
      if (uppercaseType === "HOLIDAY" || event.eventType === "HOLIDAY") return false;
      const isTimeOverlapping = nS < new Date(event.endDateTime) && nE > new Date(event.startDateTime);
      if (!isTimeOverlapping) return false;
      const eventTargetGroups = typeof event.targetGroups === "string" ? event.targetGroups.split(",").filter(Boolean) : (event.targetGroups || []);
      if (targetGroups.includes("ALL") || eventTargetGroups.includes("ALL")) return true;
      return targetGroups.some((g: string) => eventTargetGroups.includes(g));
    });

    if (hasConflict) {
      return res.status(400).json({ error: "Time slot conflict for the selected groups." });
    }

    const updatedEvent = await prismaClient.calendarEvent.update({
      where: { id },
      data: {
        title,
        eventType: uppercaseType,
        startDateTime: nS,
        endDateTime: nE,
        targetGroups: targetGroups.join(","),
        description: description || null,
        room: room || null,
        doctor: doctor || null,
        notes: notes || null,
        isPinned: isPinned ?? false,
        isCompleted: isCompleted ?? false,
      },
    });

    const parsedEvent = {
      ...updatedEvent,
      targetGroups: typeof updatedEvent.targetGroups === "string"
        ? updatedEvent.targetGroups.split(",").filter(Boolean)
        : (updatedEvent.targetGroups || []),
    };

    // Only global/admin events belong in D1. If an admin edits a personal row,
    // ensure any stale D1 copy with the same id is removed instead.
    if (updatedEvent.userId == null) {
      await syncContentUpsert("CalendarEvent", toCalendarEventContentRow(updatedEvent));
    } else {
      await syncContentDelete("CalendarEvent", updatedEvent.id);
    }

    // Broadcast to all connected clients so everyone sees the change instantly
    if (io) {
      io.to("authenticated").emit("calendar_updated", { action: "upsert", event: parsedEvent });
    }
    invalidateMaterialsCache();

    auditLog(req, "UPDATE_CALENDAR_EVENT", id, "Success");
    res.json(parsedEvent);
  } catch (err: any) {
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Event not found." });
    }
    console.error("Failed to update calendar event:", err instanceof Error ? err.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// Delete calendar event endpoint

// Helper to set secure httpOnly JWT cookie and return token
function setCookieToken(res: any, userId: string, email: string, sessionVersion = 0): string {
  const token = jwt.sign({ userId, email, sessionVersion }, JWT_SECRET, { algorithm: "HS256", expiresIn: "30d" });
  const isProduction = process.env.NODE_ENV === "production";
  res.cookie("auth_token", token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",         // Explicit path ensures clearCookie() always finds this cookie
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
  return token;
}

// Helper to extract JWT token from either cookies or the Authorization header
function getRequestToken(req: express.Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const bearerToken = authHeader.substring(7).trim();
    if (bearerToken) return bearerToken;
  }
  if (req.cookies && req.cookies.auth_token) {
    return req.cookies.auth_token;
  }
  return null;
}

function auditLog(req: express.Request, action: string, target: string, result: string) {
  const actor = (req as any).user ? (req as any).user.email : "unknown";
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), actor, action, target, result }));
}

// ============================================================
// MODERATION AUDIT LOG — records every moderation action permanently
// ============================================================
async function logModerationAction(prismaClient: any, data: {
  actionType: string;
  adminId?: string | null;
  targetUserId?: string | null;
  commentId?: string | null;
  questionId?: string | null;
  answerId?: string | null;
  replyId?: string | null;
  lectureId?: string | null;
  reportId?: string | null;
  reason?: string | null;
  notes?: string | null;
  oldStatus?: string | null;
  newStatus?: string | null;
  duration?: number | null;
  isPermanent?: boolean;
  isSystemAction?: boolean;
  expiresAt?: Date | null;
  metadata?: object | null;
}): Promise<void> {
  try {
    await prismaClient.moderationHistory.create({
      data: {
        actionType: data.actionType,
        adminId: data.adminId ?? null,
        targetUserId: data.targetUserId ?? null,
        commentId: data.commentId ?? null,
        questionId: data.questionId ?? null,
        answerId: data.answerId ?? null,
        replyId: data.replyId ?? null,
        lectureId: data.lectureId ?? null,
        reportId: data.reportId ?? null,
        reason: data.reason ?? null,
        notes: data.notes ?? null,
        oldStatus: data.oldStatus ?? null,
        newStatus: data.newStatus ?? null,
        duration: data.duration ?? null,
        isPermanent: !!data.isPermanent,
        isSystemAction: !!data.isSystemAction,
        expiresAt: data.expiresAt ?? null,
        metadata: data.metadata ?? undefined,
      },
    });
  } catch (err: any) {
    // Never allow audit failures to surface to callers
    console.error("[ModerationHistory] Failed to log action:", data.actionType, err?.message?.substring(0, 120));
  }
}

// ─── Internal helper: emit a notification to ONE user's socket only ───────────
async function emitToUser(prismaClient: any, targetUserId: string, event: string, payload: any): Promise<void> {
  try {
    const targetUser = await prismaClient.user.findUnique({
      where: { id: targetUserId },
      select: { socketId: true },
    });
    if (targetUser?.socketId) {
      io.to(targetUser.socketId).emit(event, payload);
    }
    // If the user is offline the notification is already persisted in DB — no broadcast needed.
  } catch {
    // Best-effort delivery; never throw.
  }
}

// ─── Helper: create + push a mute notification to the affected user only ──────
async function createMuteNotification(
  prismaClient: any,
  targetUserId: string,
  reason: string,
  isPermanent: boolean,
  endTime: Date | null,
  action: "new" | "update" = "new"
): Promise<void> {
  try {
    const durationText = isPermanent
      ? "Permanent"
      : endTime
        ? (() => {
            const ms = endTime.getTime() - Date.now();
            const m = Math.ceil(ms / 60000);
            if (m < 60) return `${m} minute${m !== 1 ? "s" : ""}`;
            const h = Math.ceil(m / 60);
            if (h < 24) return `${h} hour${h !== 1 ? "s" : ""}`;
            const d = Math.ceil(h / 24);
            return `${d} day${d !== 1 ? "s" : ""}`;
          })()
        : "Unknown";

    const expiresText = isPermanent
      ? "Never — this mute is permanent."
      : endTime
        ? new Date(endTime).toLocaleString("en-US", {
            month: "long", day: "numeric", year: "numeric",
            hour: "2-digit", minute: "2-digit",
          })
        : "Unknown";

    const title = action === "update"
      ? (isPermanent ? "🔔 Your Mute Has Been Changed to Permanent" : "🔔 Your Mute Has Been Updated")
      : (isPermanent ? "🔇 You Have Been Permanently Muted" : "🔇 You Have Been Muted");

    const intro = action === "update"
      ? "A moderator has updated your account mute. The following restrictions are now in effect."
      : "Your account has been muted by a moderator. You cannot post questions, answers, or replies in discussions until the mute is lifted.";

    const messageParts = [
      intro,
      "",
      `Reason: ${reason}`,
      `Duration: ${durationText}`,
      `Expires: ${expiresText}`,
    ];
    if (isPermanent) messageParts.push("", "🔴 This mute is permanent and has no expiry.");
    const message = messageParts.join("\n");

    const notification = await prismaClient.notification.create({
      data: { title, message, isSystem: true, targetUserId },
    });

    // Push ONLY to the muted user's socket — never broadcast.
    await emitToUser(prismaClient, targetUserId, "receiveSystemNotification", notification);
  } catch (err: any) {
    console.error("[MuteNotification] Failed to create:", err?.message?.substring(0, 100));
  }
}

// ─── Helper: notify a user that their mute has been removed ───────────────────
async function createMuteRemovedNotification(
  prismaClient: any,
  targetUserId: string,
  originalReason: string
): Promise<void> {
  try {
    const title = "✅ Your Mute Has Been Removed";
    const messageParts = [
      "Your account mute has been lifted by a moderator. You can now participate in discussions again.",
    ];
    if (originalReason) messageParts.push("", `Original reason: ${originalReason}`);
    const message = messageParts.join("\n");

    const notification = await prismaClient.notification.create({
      data: { title, message, isSystem: true, targetUserId },
    });

    // Push ONLY to the affected user's socket — never broadcast.
    await emitToUser(prismaClient, targetUserId, "receiveSystemNotification", notification);
  } catch (err: any) {
    console.error("[MuteRemovedNotification] Failed to create:", err?.message?.substring(0, 100));
  }
}

// Helper to validate email format using RFC 5322 regex
function validateEmail(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return emailRegex.test(email);
}

// OAuth has two different origins in production: the browser app is hosted on
// Cloudflare, while Google must return its authorization code to this server on
// Render. Keep those origins explicit so a frontend request can never cause a
// provider callback URI to be built from the Cloudflare host.
const PRODUCTION_FRONTEND_ORIGIN = "https://99s-guide.mustafasamadlol2.workers.dev";
const PRODUCTION_BACKEND_ORIGIN = "https://nine9s-guide.onrender.com";

function configuredOrigin(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    return new URL(value.trim()).origin;
  } catch {
    throw new Error("Configured OAuth origin is invalid.");
  }
}

function frontendOrigin(req: express.Request): string {
  if (process.env.NODE_ENV !== "production") {
    const requestOrigin = getValidatedRequestOrigin(req);
    if (requestOrigin) return requestOrigin;
  }

  const configured = configuredOrigin(process.env.FRONTEND_URL || process.env.APP_URL);
  if (configured) return configured;
  if (process.env.NODE_ENV === "development") {
    return `${req.protocol}://${req.get("host")}`;
  }
  return PRODUCTION_FRONTEND_ORIGIN;
}

function oauthFrontendOrigin(req: express.Request, state?: OAuthStateRecord | null): string {
  return state?.returnOrigin || frontendOrigin(req);
}

function backendOrigin(req: express.Request): string {
  const configured = configuredOrigin(process.env.BACKEND_URL);
  if (configured) return configured;
  
  const forwardedHost = req.headers["x-forwarded-host"];
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (forwardedHost && typeof forwardedHost === "string") {
    const host = forwardedHost.split(',')[0].trim();
    const proto = (typeof forwardedProto === "string" ? forwardedProto.split(',')[0].trim() : req.protocol) || "http";
    return `${proto}://${host}`;
  }

  if (process.env.NODE_ENV === "development") {
    return `${req.protocol}://${req.get("host")}`;
  }
  return PRODUCTION_BACKEND_ORIGIN;
}

async function issueEmailVerification(
  req: express.Request,
  user: { id: string; email: string; name?: string },
): Promise<{ success: boolean; configured: boolean }> {
  const rawToken = await UserService.createEmailVerificationToken(user.id);
  const verificationLink = `${backendOrigin(req)}/api/auth/verify-email?token=${encodeURIComponent(rawToken)}`;
  return EmailService.sendEmailVerificationEmail(
    user.email,
    verificationLink,
    user.name || "Student",
  );
}

function oauthRedirectUri(req: express.Request, provider: string): string {
  // Google Cloud Console must contain exactly this production URI. Do not let
  // a stale backend/frontend environment value change Google's callback target.
  const origin = provider === "google" && process.env.NODE_ENV === "production"
    ? PRODUCTION_BACKEND_ORIGIN
    : backendOrigin(req);
  return `${origin}/auth/callback/${provider}`;
}

async function isUserCurrentlyBanned(user: any): Promise<boolean> {
  if (!user || String(user.accountStatus || "").toLowerCase() !== "banned") return false;
  const client = getPrisma();
  const ban = await client.userBan.findUnique({ where: { userId: user.id } });
  return !ban || ban.isPermanent || !ban.endTime || ban.endTime > new Date();
}

// Never classify a temporary Supabase/Prisma outage as an invalid account.
// Doing so makes the client clear a valid session and report "user not found".
function isInfrastructureError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = String(candidate?.code || "");
  const message = String(candidate?.message || error || "").toLowerCase();
  return /^(P1001|P1008|P1017|P2024)$/.test(code) ||
    /database|prisma|connection|connection pool|pool timeout|max clients|too many clients|can't reach|timed out|econn|socket hang up/.test(message);
}

function sendAuthFailure(
  res: express.Response,
  error: unknown,
  invalidSessionMessage: string,
) {
  if (isInfrastructureError(error)) {
    return res.status(503).json({
      error: "Authentication service is temporarily unavailable. Please retry.",
      retryable: true,
    });
  }
  // Only a token that failed cryptographic verification is an expired/invalid
  // session. A token that verified but still produced an error (DB lookup,
  // role check, etc.) is a genuine server fault — never report that as the
  // user's session being expired, which would log them out incorrectly.
  const failureName = (error as { name?: string } | null)?.name;
  if (failureName === "JsonWebTokenError" || failureName === "TokenExpiredError") {
    return res.status(401).json({ error: invalidSessionMessage });
  }
  return res.status(500).json({ error: "Authentication service error. Please try again." });
}

// Authentication checks are on the hot path for nearly every API request.
// Keep a very short-lived per-user snapshot to avoid a Supabase round trip for
// every parallel page request, while limiting the window for role/ban changes.
const authenticatedUserCache = new Map<string, { user: any; expiresAt: number }>();
const AUTH_USER_CACHE_TTL_MS = 3_000;

async function getAuthenticatedUser(userId: string): Promise<any> {
  const cached = authenticatedUserCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.user;
  authenticatedUserCache.delete(userId);

  const user = await UserService.findById(userId);
  if (user) {
    authenticatedUserCache.set(userId, {
      user,
      expiresAt: Date.now() + AUTH_USER_CACHE_TTL_MS,
    });
  }
  return user;
}

function invalidateAuthenticatedUser(userId: string): void {
  authenticatedUserCache.delete(userId);
}

// Middleware to verify if the student has administrative role credentials
async function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const token = getRequestToken(req);
    if (!token) {
      console.log("401 NO TOKEN"); return res.status(401).json({ error: "Authentication required." });
    }

    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as { userId: string; email: string; iat?: number; sessionVersion?: number };
    if (await isRevokedToken(token)) {
      console.log("401 REVOKED"); return res.status(401).json({ error: "Access denied. Session has been revoked." });
    }
    const user = await getAuthenticatedUser(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ error: "Access denied. Administrative student account not found." });
    }
    if ((decoded.sessionVersion ?? 0) !== (user.sessionVersion ?? 0)) {
      console.log("401 INVALID SESSION", decoded.sessionVersion, user.sessionVersion); return res.status(401).json({ error: "Access denied. Session is no longer valid." });
    }
    if (user.emailVerified === false) {
      return res.status(403).json({ verificationRequired: true, error: "Please verify your institutional email before continuing." });
    }

    if (await isUserCurrentlyBanned(user)) {
      return res.status(403).json({ error: "Access denied. Your student account has been suspended/banned." });
    }

    if (user.role !== "admin" && user.role !== "owner") {
      return res.status(403).json({ error: "Access denied. Administrative role required." });
    }

    // Automatic sliding session: refresh if token is more than 24 hours old
    if (decoded.iat) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (nowSeconds - decoded.iat > 24 * 60 * 60) {
        setCookieToken(res, user.id, user.email, user.sessionVersion);
      }
    }

    // Attach user to request context for downstream route handlers
    (req as any).user = user;
    next();
  } catch (err) {
    return sendAuthFailure(res, err, "Access denied. Verification token has expired or is invalid.");
  }
}

// Middleware to verify if the student has owner role credentials
async function requireOwner(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const token = getRequestToken(req);
    if (!token) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as { userId: string; email: string; iat?: number; sessionVersion?: number };
    if (await isRevokedToken(token)) {
      return res.status(401).json({ error: "Access denied. Session has been revoked." });
    }
    const user = await getAuthenticatedUser(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ error: "Access denied. Academic owner account not found." });
    }
    if ((decoded.sessionVersion ?? 0) !== (user.sessionVersion ?? 0)) {
      return res.status(401).json({ error: "Access denied. Session is no longer valid." });
    }
    if (user.emailVerified === false) {
      return res.status(403).json({ verificationRequired: true, error: "Please verify your institutional email before continuing." });
    }

    if (await isUserCurrentlyBanned(user)) {
      return res.status(403).json({ error: "Access denied. Your student account has been suspended/banned." });
    }

    if (user.role !== "owner") {
      return res.status(403).json({ error: "Access denied. Platform Owner role required." });
    }

    // Automatic sliding session: refresh if token is more than 24 hours old
    if (decoded.iat) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (nowSeconds - decoded.iat > 24 * 60 * 60) {
        setCookieToken(res, user.id, user.email, user.sessionVersion);
      }
    }

    // Attach user to request context for downstream route handlers
    (req as any).user = user;
    next();
  } catch (err) {
    return sendAuthFailure(res, err, "Access denied. Verification token has expired or is invalid.");
  }
}

function normalizePdfMaterialId(rawId: string): string {
  return rawId.toLowerCase().endsWith(".pdf") ? rawId.slice(0, -4) : rawId;
}

// PDF viewers opened outside the app cannot send the app's bearer header. They
// may use only the short-lived, material-scoped token issued by the URL route.
function requirePdfUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  const downloadToken =
    typeof req.query.download_token === "string" ? req.query.download_token : "";
  const materialId = normalizePdfMaterialId(req.params.id);

  // IMPORTANT: an explicit, material-scoped download token always takes
  // precedence over ambient browser cookies. External Safari/Chrome viewers can
  // carry an old Render-domain auth cookie from a different or deleted account.
  // The previous order checked that cookie first and ignored the freshly minted
  // download_token, producing an account-specific "Student account not found"
  // even though the app had just authorized the correct user.
  if (downloadToken) {
    const claims = verifyPdfDownloadToken(downloadToken, materialId, JWT_SECRET);

    // Fail closed: if a scoped token was explicitly supplied, never silently
    // fall back to an unrelated ambient session cookie.
    if (!claims) {
      return res.status(401).json({ error: "Authentication required." });
    }

    // A pdf-download token is deliberately handled here instead of being copied
    // into Authorization and passed to requireUser. It is scoped to one material
    // and must never become a general-purpose API bearer token.
    void (async () => {
      try {
        const user = await getAuthenticatedUser(claims.userId);
        if (!user) {
          console.log("401 PDF TOKEN USER NOT FOUND");
          return res.status(401).json({ error: "Access denied. Student account not found." });
        }
        if ((claims.sessionVersion ?? 0) !== (user.sessionVersion ?? 0)) {
          return res.status(401).json({ error: "Access denied. Session is no longer valid." });
        }
        if (user.emailVerified === false) {
          return res.status(403).json({
            verificationRequired: true,
            error: "Please verify your institutional email before continuing.",
          });
        }
        if (await isUserCurrentlyBanned(user)) {
          return res.status(403).json({ error: "Access denied. Your student account has been suspended." });
        }

        (req as any).user = user;
        (req as any).pdfDownloadClaims = claims;
        next();
      } catch (error) {
        logger.warn(
          "[PDF Access]",
          `Scoped download-token verification failed for material ${materialId}: ${error instanceof Error ? error.message.substring(0, 80) : "unknown"}`,
        );
        return res.status(401).json({ error: "Authentication required." });
      }
    })();
    return;
  }

  // In-app PDF requests that do not use an external viewer may still
  // authenticate normally with the user's application session.
  const normalSessionToken = getRequestToken(req);
  if (normalSessionToken) {
    return requireUser(req, res, next);
  }

  return res.status(401).json({ error: "Authentication required." });
}

// Middleware to verify if the student has a valid logged-in session (user or admin)
async function requireUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const token = getRequestToken(req);
    if (!token) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as { userId: string; email: string; iat?: number; sessionVersion?: number; scope?: string };
    if (decoded.scope === PDF_DOWNLOAD_SCOPE) {
      console.log("401 SCOPED PDF"); return res.status(401).json({ error: "Access denied. Scoped PDF token cannot be used as an API session." });
    }
    if (await isRevokedToken(token)) {
      return res.status(401).json({ error: "Access denied. Session has been revoked." });
    }
    const user = await getAuthenticatedUser(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ error: "Access denied. Student account not found." });
    }
    if ((decoded.sessionVersion ?? 0) !== (user.sessionVersion ?? 0)) {
      return res.status(401).json({ error: "Access denied. Session is no longer valid." });
    }
    if (user.emailVerified === false) {
      return res.status(403).json({ verificationRequired: true, error: "Please verify your institutional email before continuing." });
    }

    if (await isUserCurrentlyBanned(user)) {
      const prismaClient = getPrisma();
      const ban = await prismaClient.userBan.findUnique({ where: { userId: user.id } });
      return res.status(403).json({
        banned: true,
        error: "Your account has been suspended.",
        reason: ban?.reason || null,
        isPermanent: ban ? ban.isPermanent : true,
        endTime: ban?.endTime?.toISOString() || null,
      });
    }

    // Automatic sliding session: refresh if token is more than 24 hours old
    if (decoded.iat) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (nowSeconds - decoded.iat > 24 * 60 * 60) {
        setCookieToken(res, user.id, user.email, user.sessionVersion);
      }
    }

    // Attach user to request context for downstream route handlers
    (req as any).user = user;
    next();
  } catch (err) {
    return sendAuthFailure(res, err, "Access denied. Session has expired or is invalid.");
  }
}

/**
 * Role changes are stricter than general owner access. The persisted
 * isPrimaryOwner flag is the only authority that can manage owner accounts or
 * grant the owner role; no email or frontend state is trusted here.
 */
function canManageUserRole(
  caller: { id: string; role: string; isPrimaryOwner?: boolean },
  target: { id: string; role: string; isPrimaryOwner?: boolean },
  nextRole: string,
): boolean {
  if (caller.id === target.id) return false;
  if (target.isPrimaryOwner === true) return false;
  if (target.role === "owner" && caller.isPrimaryOwner !== true) return false;
  if (nextRole === "owner" && caller.isPrimaryOwner !== true) return false;
  return true;
}

// Development-only database synchronization helper. Production schema changes
// belong in reviewed migrations during deployment, not in a live request.
let dbSyncInProgress = false;
app.post("/api/admin/db-sync", requireOwner, (req, res) => {
  if (process.env.NODE_ENV !== "development" || process.env.ALLOW_RUNTIME_DB_SYNC !== "true") {
    return res.status(404).json({ error: "Runtime database synchronization is disabled." });
  }
  const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL || "";
  if (/supabase|pooler|neon\.tech|render\.com/i.test(dbUrl) && process.env.ALLOW_SHARED_DB_PUSH !== "true") {
    return res.status(403).json({ error: "Runtime database synchronization is disabled for shared databases." });
  }
  if (dbSyncInProgress) {
    return res.status(409).json({ error: "A database synchronization is already in progress." });
  }

  dbSyncInProgress = true;
  const prismaBinary = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "prisma.cmd" : "prisma",
  );
  execFile(prismaBinary, ["db", "push"], {
    cwd: process.cwd(),
    timeout: 60_000,
    maxBuffer: 256 * 1024,
    windowsHide: true,
  }, (error) => {
    dbSyncInProgress = false;
    if (error) {
      console.error("[DB-Sync] Database sync failed:", error instanceof Error ? error.message.substring(0, 120) : "Sanitized");
      return res.status(500).json({ error: "Database synchronization failed." });
    }
    return res.status(200).json({ message: "Database synced successfully" });
  });
});

// Get the currently authenticated user automatically from the JWT cookie or Authorization header
// Important: this endpoint distinguishes "no session at all" (HTTP 200, { user: null })
// from "a session was presented but it is dead" (HTTP 401, { user: null }). The client
// relies on the 401 to know it must drop its stale stored token and cached profile instead
// of booting a phantom "authenticated" shell whose protected requests all 401.
app.get("/api/auth/me", catchAsync(async (req, res) => {
  try {
    const token = getRequestToken(req);
    if (!token) {
      return res.json({ user: null });
    }

    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as { userId: string; sessionVersion?: number };
    if (await isRevokedToken(token)) {
      return res.status(401).json({ user: null });
    }
    const user = await getAuthenticatedUser(decoded.userId);

    if (!user || (decoded.sessionVersion ?? 0) !== (user.sessionVersion ?? 0)) {
      return res.status(401).json({ user: null });
    }
    if (user.emailVerified === false || await isUserCurrentlyBanned(user)) {
      return res.json({ user: null });
    }

    const fullData = await UserService.getFullUserData(user.id, user);
    // Check if this is an Apple user who hasn't selected their profile email yet
    const prisma = getPrisma();
    const appleIdentity = await prisma.oAuthIdentity.findFirst({
      where: { provider: "apple", userId: user.id },
    });
    const needsEmailSelection = !!appleIdentity && !user.profileEmail;
    // Return the token in the response body so the frontend can persist it
    // for Bearer auth (bypasses ITP cookie partitioning on iOS Safari).
    return res.json({ ...fullData, token, needsEmailSelection });
  } catch (err) {
    if (isInfrastructureError(err)) {
      return res.status(503).json({
        error: "Authentication service is temporarily unavailable. Please retry.",
        retryable: true,
      });
    }
    const failureName = (err as { name?: string } | null)?.name;
    if (failureName === "JsonWebTokenError" || failureName === "TokenExpiredError") {
      return res.status(401).json({ user: null });
    }
    return res.status(500).json({ error: "Authentication service error. Please try again." });
  }
}));

// Email ownership verification. The raw token is accepted only here, is
// hashed/consumed atomically by UserService, and is never returned or logged.
app.get("/api/auth/verify-email", catchAsync(async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
    return res.redirect(`${frontendOrigin(req)}/?verification_error=invalid`);
  }

  const verified = await UserService.verifyEmailToken(token);

  if (verified) {
    // Fresh verification — issue session cookie and enter the app.
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const tokenRecord = await getPrisma().emailVerificationToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    if (tokenRecord) {
      const user = await UserService.findById(tokenRecord.userId);
      if (user && user.emailVerified !== false) {
        setCookieToken(res, user.id, user.email, user.sessionVersion);
      }
    }
    return res.redirect(`${frontendOrigin(req)}/?email_verified=1`);
  }

  // Token was invalid or already consumed. Check if the user behind this
  // token is already verified (idempotent — user clicked the link twice).
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const tokenRecord = await getPrisma().emailVerificationToken.findUnique({
    where: { tokenHash },
    select: { userId: true },
  });
  if (tokenRecord) {
    const user = await UserService.findById(tokenRecord.userId);
    if (user && user.emailVerified !== false) {
      // Already verified — issue session so the user enters the app.
      setCookieToken(res, user.id, user.email, user.sessionVersion);
      return res.redirect(`${frontendOrigin(req)}/?email_verified=1`);
    }
    // Token was consumed but user is not verified (should not happen).
    // Token expired — tell frontend to show expiry message.
    if (user && user.emailVerified === false) {
      return res.redirect(`${frontendOrigin(req)}/?verification_error=expired`);
    }
  }

  // Completely invalid token (no matching record at all).
  return res.redirect(`${frontendOrigin(req)}/?verification_error=invalid`);
}));

// --- Real OAuth Integration Endpoints ---

// ── Apple Sign-In restriction notice page ────────────────────────────────────
// Opened as a small popup when the Apple button is clicked.
// Displays the same amber domain-restriction styling used for Google domain
// rejections, but does NOT send any postMessage back — the AuthScreen button
// state is managed entirely by the frontend timer.
app.get("/auth/apple-notice", (_req, res) => {
  const domain = "@comed.uobaghdad.edu.iq";
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Access Restricted — Baghdad Medical Portal</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
      background:linear-gradient(135deg,#FFF8F0 0%,#FEF3C7 100%);
      min-height:100vh;display:flex;align-items:center;
      justify-content:center;padding:1.5rem;
    }
    .card{
      background:#fff;border:1.5px solid #FED7AA;border-radius:20px;
      box-shadow:0 8px 32px rgba(0,0,0,0.08),0 2px 8px rgba(0,0,0,0.04);
      padding:2.5rem 2rem;text-align:center;max-width:420px;width:100%;
      animation:slideUp 0.3s cubic-bezier(0.22,1,0.36,1) both;
    }
    @keyframes slideUp{
      from{opacity:0;transform:translateY(16px) scale(0.97)}
      to{opacity:1;transform:translateY(0) scale(1)}
    }
    .icon-wrap{
      width:64px;height:64px;border-radius:50%;background:#FEF3C7;
      border:1.5px solid #FDE68A;display:flex;align-items:center;
      justify-content:center;margin:0 auto 1.25rem;
    }
    .icon-wrap svg{width:30px;height:30px}
    h2{font-size:1.2rem;font-weight:700;color:#92400E;margin-bottom:.6rem;letter-spacing:-.02em}
    p{font-size:.875rem;color:#78350F;line-height:1.65;margin-bottom:.75rem}
    .domain-chip{
      display:inline-block;background:#FEF9C3;border:1px solid #FDE68A;
      color:#92400E;padding:5px 14px;border-radius:99px;
      font-family:"SF Mono","Fira Code",Consolas,monospace;
      font-size:.82rem;font-weight:600;margin:.25rem 0 1rem;
    }
    .note{font-size:.75rem;color:#A16207;margin-top:1rem;opacity:.85}
    .progress{width:100%;height:3px;background:#FEF3C7;border-radius:99px;overflow:hidden;margin-top:1.5rem}
    .progress-bar{
      height:100%;background:#F59E0B;border-radius:99px;
      animation:drain 4.5s linear forwards;width:100%;
    }
    @keyframes drain{from{width:100%}to{width:0%}}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="#D97706" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        <line x1="9" y1="9" x2="15" y2="15"/>
        <line x1="15" y1="9" x2="9" y2="15"/>
      </svg>
    </div>
    <h2>Access Restricted</h2>
    <p>This Medical Portal is restricted to Baghdad University<br>College of Medicine students only.</p>
    <p>Please sign in with your official university email:</p>
    <span class="domain-chip">${domain}</span>
    <p class="note">This window will close automatically&hellip;</p>
    <div class="progress"><div class="progress-bar"></div></div>
  </div>
  <script nonce="${res.locals.cspNonce}">
    setTimeout(function(){ try{ window.close(); }catch(e){} }, 4500);
  </script>
</body>
</html>`);
});

async function issuePendingOAuthToken(res: express.Response, session: OAuthSessionRecord): Promise<string | null> {
  if (session.token) return session.token;
  if (!session.userId) return null;
  const user = await UserService.findById(session.userId);
  if (!user) return null;
  return setCookieToken(res, user.id, user.email, user.sessionVersion);
}

// ── Consume a pending OAuth session (one-time, for native Capacitor polling) ──
// The frontend polls this after opening the OAuth browser on native platforms
// where window.opener / postMessage is unavailable.
app.get("/api/auth/oauth-session/:token", catchAsync(async (req, res) => {
  const { token } = req.params;
  const session = await readOAuthSession(token);
  if (!session) {
    return res.status(404).json({ pending: true });
  }
  if (session.processing) {
    return res.status(404).json({ pending: true });
  }
  if (session.authorizationCode && !session.rejected && !session.failed) {
    return res.status(405).json({ error: "This OAuth session requires a PKCE exchange." });
  }
  const stateHeader = req.get("X-OAuth-State");
  if (req.cookies?.oauth_state !== token && stateHeader !== token) {
    return res.status(403).json({ error: "OAuth session is not bound to the initiating browser." });
  }
  const consumedSession = await consumeOAuthSession(token);
  if (!consumedSession) return res.status(404).json({ pending: true });
  // Domain rejection — popup's Safari ITP fallback polling path detects this.
  if (consumedSession.rejected) return res.json({ rejected: true });
  if (consumedSession.failed) {
    return res.status(502).json({ error: consumedSession.failureMessage || "OAuth authentication could not be completed." });
  }
  res.clearCookie("oauth_state", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", path: "/" });
  // Deliver the fresh JWT with the session. This GET fallback is consumed by
  // the popup-closed / iOS PWA cold-start polling path where postMessage is
  // unreliable and the popup's HttpOnly cookie lives in a partitioned cookie
  // jar. It is safe because the session is one-time use, bound to the
  // initiating browser via the oauth_state cookie/header binding, and expires after 5 minutes.
  // The app persists this token in SecureStorage and sends Authorization: Bearer.
  const issuedToken = await issuePendingOAuthToken(res, consumedSession);
  if (!issuedToken) return res.status(500).json({ error: "OAuth session could not create a valid session." });
  return res.json({ success: true, userId: consumedSession.userId, email: consumedSession.email, token: issuedToken });
}));

app.post("/api/auth/oauth-session/:token", catchAsync(async (req, res) => {
  const { token } = req.params;
  const session = await readOAuthSession(token);
  const codeVerifier = typeof req.body?.code_verifier === "string" ? req.body.code_verifier : "";
  if (session?.processing) {
    return res.status(404).json({ pending: true });
  }
  if (!session || !session.authorizationCode || !session.codeChallenge) {
    return res.status(404).json({ pending: true });
  }
  if (!codeVerifier || codeVerifier.length < 43 || codeVerifier.length > 128) {
    return res.status(400).json({ error: "Invalid PKCE verifier." });
  }
  const stateHeader = req.get("X-OAuth-State");
  if (req.cookies?.oauth_state !== token && stateHeader !== token) {
    return res.status(403).json({ error: "OAuth session is not bound to the initiating browser." });
  }
  const verifierChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  if (verifierChallenge !== session.codeChallenge) {
    return res.status(403).json({ error: "Invalid OAuth verifier." });
  }

  if (session.provider === "google" && session.token) {
    res.clearCookie("oauth_state", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", path: "/" });
    return res.json({ success: true, token: session.token, userId: session.userId, email: session.email });
  }
  if (session.provider === "google" && session.authorizationCode === "google:server-exchanged" && session.userId) {
    const retryToken = await issuePendingOAuthToken(res, session);
    if (!retryToken) return res.status(500).json({ error: "OAuth session could not create a valid session." });
    res.clearCookie("oauth_state", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", path: "/" });
    return res.json({ success: true, token: retryToken, userId: session.userId, email: session.email });
  }

  // Google code exchange is deliberately idempotent for the short handoff
  // lifetime. Safari can lose the first POST response while the server has
  // already exchanged Google's one-time code. Retaining the verified session
  // record lets a retry receive a fresh JWT for the same verified user instead
  // of seeing a false "pending" state after the authorization code was consumed.
  const consumedSession = session.codeChallenge
    ? session
    : await consumeOAuthSession(token);
  if (!consumedSession) return res.status(404).json({ pending: true });
  res.clearCookie("oauth_state", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", path: "/" });
  if (consumedSession.rejected) {
    return res.json({
      rejected: true,
      message: "Access denied — only @comed.uobaghdad.edu.iq accounts can sign in.",
    });
  }
  if (consumedSession.failed) {
    return res.status(502).json({ error: consumedSession.failureMessage || "OAuth authentication could not be completed." });
  }

  try {
    // Apple's authorization code was already exchanged server-side inside the
    // form_post callback (it needs the client-secret JWT that only the backend
    // holds). The polled session only hands the issued JWT to the native app
    // after PKCE proof — no second provider round-trip is required.
    if (consumedSession.provider === "apple" && consumedSession.authorizationCode === "apple:server-exchanged") {
      const issuedToken = await issuePendingOAuthToken(res, consumedSession);
      if (!issuedToken) return res.status(500).json({ error: "OAuth session is missing its user." });
      // Check if Apple user needs to select their profile email
      const appleUser = consumedSession.userId ? await UserService.findById(consumedSession.userId) : null;
      const needsEmailSelection = appleUser ? !appleUser.profileEmail : false;
      return res.json({ success: true, token: issuedToken, userId: consumedSession.userId, email: consumedSession.email, needsEmailSelection });
    }
    if (consumedSession.authorizationCode === "sandbox:server-exchanged") {
      const issuedToken = await issuePendingOAuthToken(res, consumedSession);
      if (!issuedToken) return res.status(500).json({ error: "OAuth session is missing its user." });
      return res.json({ success: true, token: issuedToken, userId: consumedSession.userId, email: consumedSession.email });
    }
    if (consumedSession.provider !== "google") {
      return res.status(400).json({ error: "PKCE exchange is currently supported for Google OAuth." });
    }
    const response = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: consumedSession.authorizationCode,
        client_id: process.env.GOOGLE_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
        redirect_uri: consumedSession.redirectUri || "",
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      }),
    });
    if (!response.ok) {
      return res.status(response.status >= 500 ? 503 : 401).json({
        error: "OAuth exchange failed.",
        retryable: response.status >= 500,
      });
    }
    const tokenData = await response.json() as { access_token?: string };
    if (!tokenData.access_token) return res.status(401).json({ error: "OAuth exchange failed." });
    const profileResponse = await fetchWithTimeout("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!profileResponse.ok) {
      return res.status(profileResponse.status >= 500 ? 503 : 401).json({
        error: "OAuth profile lookup failed.",
        retryable: profileResponse.status >= 500,
      });
    }
    const profile = await profileResponse.json() as { email?: string; email_verified?: boolean; name?: string; picture?: string };
    if (!profile.email || profile.email_verified !== true) return res.status(403).json({ error: "OAuth email could not be verified." });
    const user = await OAuthService.verifyAndUpsertOAuthUser({ email: profile.email, name: profile.name || profile.email.split("@")[0], avatar: profile.picture || "" });
    const jwtToken = setCookieToken(res, user.id, user.email, user.sessionVersion);
    try {
      await writeOAuthSession(token, {
        ...session,
        userId: user.id,
        email: user.email,
        authorizationCode: "google:server-exchanged",
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
    } catch {
      // The JWT is still delivered directly in this response. If Safari loses
      // it, the flow expires safely and the user can start a fresh attempt.
    }
    return res.json({ success: true, token: jwtToken, userId: user.id, email: user.email });
  } catch (err: any) {
    if (err?.code === "OAUTH_DOMAIN_REJECTED") {
      await writeOAuthSession(token, {
        ...session,
        authorizationCode: "google:rejected",
        token: "",
        rejected: true,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
      return res.json({ rejected: true, message: err.message });
    }
    if (err?.name === "AbortError" || err instanceof TypeError || isInfrastructureError(err)) {
      return res.status(503).json({
        error: "OAuth exchange is temporarily unavailable. Please try again.",
        retryable: true,
      });
    }
    return res.status(500).json({ error: "OAuth exchange failed." });
  }
}));

// Sandbox auth (mints real sessions from crafted emails) is an explicit
// development opt-in. Fails closed in every other configuration.
const IS_SANDBOX_AUTH_ENABLED =
  process.env.NODE_ENV === "development" && process.env.ALLOW_SANDBOX_AUTH === "true";

// Generates correct OAuth Authorize URL or offers Sandbox dev mode
app.get("/api/auth/oauth-url", catchAsync(async (req, res) => {
  const provider = (req.query.provider as string || "").toLowerCase();

  // Google must always return to the Render backend. Never derive this URI from
  // the frontend request host, which is the Cloudflare Workers origin in prod.
  const redirectUri = oauthRedirectUri(req, provider);

  // One-time state token: CSRF protection + native session polling key
  const stateToken = crypto.randomUUID();

  // Web redirect flow: client sends ?flow=redirect when it wants the callback
  // to redirect back to the app instead of serving the popup close HTML.
  // The flag is encoded into the OAuth state parameter as a "r:" prefix so
  // it survives the round-trip through the provider without an extra DB lookup.
  const isRedirectFlow = req.query.flow === "redirect";
  // In-app sheet flow (iOS installed PWA): the app stays alive underneath the
  // iOS in-app browser sheet and polls /api/auth/oauth-session/:token. The
  // callback must serve the success card WITHOUT redirecting back into the
  // app (the sheet has a separate cookie jar — loading the app there shows a
  // useless second copy that isn't signed in).
  const isInappFlow = req.query.flow === "inapp";
  const stateValue = isRedirectFlow ? `r:${stateToken}` : isInappFlow ? `i:${stateToken}` : stateToken;

  // Record this state token for one-time validation in the callback.
  // The callback deletes the entry on use — prevents CSRF, replay, and the
  // sandbox-bypass attack where an attacker calls /auth/callback/sandbox
  // directly with a crafted email (they cannot obtain a server-issued state).
  const rawCodeChallenge = typeof req.query.code_challenge === "string" ? req.query.code_challenge : undefined;
  const codeChallenge = isValidPkceCodeChallenge(rawCodeChallenge) ? rawCodeChallenge : undefined;
  if ((provider === "google" || provider === "apple") && !codeChallenge) {
    return res.status(400).json({ error: `${provider === "google" ? "Google" : "Apple"} OAuth requires a valid PKCE code challenge.` });
  }
  try {
    await writeOAuthState(stateToken, {
      expiresAt: Date.now() + 10 * 60 * 1000,
      provider,
      codeChallenge,
      returnOrigin: getValidatedRequestOrigin(req),
    });
  } catch {
    return res.status(503).json({ error: "OAuth service is temporarily unavailable. Please try again.", retryable: true });
  }
  res.cookie("oauth_state", stateToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
    maxAge: 10 * 60 * 1000,
  });

  // Google OAuth 2.0 URL Construct
  if (provider === "google") {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      // Return Sandbox Mode URL only when dev sandbox auth is explicitly enabled
      if (!IS_SANDBOX_AUTH_ENABLED) {
        return res.status(503).json({
          url: null,
          stateToken,
          error: "OAuth provider is not configured and developer sandbox auth is disabled.",
          requiredVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]
        });
      }
      return res.json({
        url: null,
        stateToken,
        sandboxUrl: `/auth/callback/sandbox?provider=google&name=Google%20Student&email=google@comed.uobaghdad.edu.iq&state=${stateValue}`,
        message: "Google OAuth is ready, but Client ID is not configured yet in your environment. Falling back to secure Developer Sandbox.",
        requiredVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]
      });
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      prompt: "select_account",
      state: stateValue,
    });
    if (codeChallenge) {
      params.set("code_challenge", codeChallenge);
      params.set("code_challenge_method", "S256");
    }
    return res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, stateToken });
  }

  // Facebook OAuth 2.0 URL Construct
  if (provider === "facebook") {
    const clientId = process.env.FACEBOOK_CLIENT_ID;
    const clientSecret = process.env.FACEBOOK_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      if (!IS_SANDBOX_AUTH_ENABLED) {
        return res.status(503).json({
          url: null,
          stateToken,
          error: "OAuth provider is not configured and developer sandbox auth is disabled.",
          requiredVars: ["FACEBOOK_CLIENT_ID", "FACEBOOK_CLIENT_SECRET"]
        });
      }
      return res.json({
        url: null,
        stateToken,
        sandboxUrl: `/auth/callback/sandbox?provider=facebook&name=Facebook%20Student&email=facebook@comed.uobaghdad.edu.iq&state=${stateValue}`,
        message: "Facebook OAuth is ready, but App ID is not configured yet in your environment. Falling back to secure Developer Sandbox.",
        requiredVars: ["FACEBOOK_CLIENT_ID", "FACEBOOK_CLIENT_SECRET"]
      });
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "email,public_profile",
      state: stateToken,
    });
    return res.json({ url: `https://www.facebook.com/v12.0/dialog/oauth?${params}`, stateToken });
  }

  // Apple Sign-In OAuth 2.0 URL Construct
  // Note: stateToken is also recorded in the shared OAuth store below
  if (provider === "apple") {
    const clientId = process.env.APPLE_CLIENT_ID;
    const privateKey = process.env.APPLE_PRIVATE_KEY;
    const teamId = process.env.APPLE_TEAM_ID;
    const keyId = process.env.APPLE_KEY_ID;

    if (!clientId || !privateKey || !teamId || !keyId) {
      if (!IS_SANDBOX_AUTH_ENABLED) {
        return res.status(503).json({
          url: null,
          stateToken,
          error: "OAuth provider is not configured and developer sandbox auth is disabled.",
          requiredVars: ["APPLE_CLIENT_ID", "APPLE_PRIVATE_KEY", "APPLE_TEAM_ID", "APPLE_KEY_ID"]
        });
      }
      return res.json({
        url: null,
        stateToken,
        sandboxUrl: `/auth/callback/sandbox?provider=apple&name=Apple%20Student&email=apple@comed.uobaghdad.edu.iq&state=${stateValue}`,
        message: "Apple Sign-In is ready, but configuration variables are not set yet in your environment. Falling back to secure Developer Sandbox.",
        requiredVars: ["APPLE_CLIENT_ID", "APPLE_PRIVATE_KEY", "APPLE_TEAM_ID", "APPLE_KEY_ID"]
      });
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "name email",
      response_mode: "form_post",
      state: stateValue,
    });
    return res.json({ url: `https://appleid.apple.com/auth/authorize?${params}`, stateToken });
  }

  return res.status(400).json({ error: "Unsupported OAuth provider requested." });
}));

// Developer Sandbox Login page
// SECURITY: sandbox auth mints real sessions from client-supplied emails, so it
// is gated on an EXPLICIT dev opt-in (ALLOW_SANDBOX_AUTH=true). It fails closed:
// any other configuration — including production, a missing NODE_ENV, or any
// accidental deploy — returns 404 and can never authenticate a user.
app.get("/auth/callback/sandbox", catchAsync(async (req, res) => {
  if (!IS_SANDBOX_AUTH_ENABLED) {
    return res.status(404).send("Not found");
  }

  const provider = (req.query.provider as string || "Google");
  const name     = (req.query.name     as string || "OAuth Student");
  const email    = (req.query.email    as string || "student@comed.uobaghdad.edu.iq");

  // Parse state token and redirect-flow flag (same "r:" convention as real callback)
  const parsedSandboxState = parseOAuthState(req.query.state);
  const isSandboxRedirectFlow = parsedSandboxState?.mode === "redirect";
  const sandboxStateToken = parsedSandboxState?.token;

  // Validate state was issued by this server — prevents CSRF and crafted-URL bypass.
  const sandboxState = sandboxStateToken ? await readOAuthState(sandboxStateToken) : null;
  if (!sandboxStateToken || !sandboxState || sandboxState.provider !== provider) {
    return res.status(403).send("Invalid or expired state token. Please sign in again.");
  }
  if (!isOAuthStateBound(sandboxStateToken, req.cookies?.oauth_state, sandboxState.codeChallenge)) {
    return res.status(403).send("OAuth flow is not bound to the initiating browser.");
  }
  if (!await consumeOAuthState(sandboxStateToken)) {
    return res.status(403).send("Invalid or expired state token. Please sign in again.");
  }

  try {
    // Apply the same domain restriction and role policy as real OAuth.
    // Throws OAUTH_DOMAIN_REJECTED for non-institutional emails.
    const user = await OAuthService.verifyAndUpsertOAuthUser({ email, name });

    const sandboxSessionToken = setCookieToken(res, user.id, user.email, user.sessionVersion);

    // Store pending session for native Capacitor polling
    if (sandboxStateToken) {
      await writeOAuthSession(sandboxStateToken, {
        userId: user.id,
        email: user.email,
        token: sandboxSessionToken,
        provider,
        authorizationCode: sandboxState.codeChallenge ? "sandbox:server-exchanged" : undefined,
        codeChallenge: sandboxState.codeChallenge,
        returnOrigin: sandboxState.returnOrigin,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
    }

    // Redirect flow: cookie is in first-party context, redirect back to app.
    if (isSandboxRedirectFlow) {
      if (sandboxState.codeChallenge) {
        return res.redirect(`${oauthFrontendOrigin(req, sandboxState)}/?${buildOAuthPendingQuery(sandboxStateToken)}`);
      }
      return res.redirect(`${oauthFrontendOrigin(req, sandboxState)}/?oauth_done=1`);
    }

    // Auto-closing success page — no user action required.
    // Sends OAUTH_AUTH_SUCCESS to the opener (popup path) then closes.
    // On native Capacitor, window.opener is null; the polling path handles
    // session completion via the shared OAuth store instead.
    return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Signing you in…</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
      background:#F8F9FC;display:flex;align-items:center;justify-content:center;
      height:100vh;
    }
    .card{
      background:#fff;border:1px solid #E2E8F0;border-radius:20px;
      box-shadow:0 4px 20px rgba(0,0,0,0.06);
      padding:2.5rem 2rem;text-align:center;max-width:380px;width:90%;
      animation:up 0.28s cubic-bezier(.22,1,.36,1) both;
    }
    @keyframes up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
    .check{
      width:56px;height:56px;border-radius:50%;background:#ECFDF5;
      border:1.5px solid #A7F3D0;display:flex;align-items:center;
      justify-content:center;margin:0 auto 1.25rem;
    }
    h2{color:#1E2D4A;font-size:1.2rem;font-weight:700;margin-bottom:.5rem;}
    p{color:#64748B;font-size:.875rem;line-height:1.5;}
    .closing{margin-top:1rem;font-size:.75rem;color:#94A3B8;}
  </style>
</head>
<body>
  <div class="card">
    <div class="check">
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
        <path d="M5 13.5l5.5 5.5L21 8" stroke="#10B981" stroke-width="2.5"
              stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <h2>Signed in successfully</h2>
    <p>Welcome, <strong>${escapeHtml(user.name)}</strong>. Returning to the app…</p>
    <p class="closing">This window will close in a moment…</p>
  </div>
   <script nonce="${res.locals.cspNonce}">
    (function () {
      // Values are server-side JSON.stringify'd to prevent JS injection.
      var payload = {
        type:   'OAUTH_AUTH_SUCCESS',
        userId: ${JSON.stringify(user.id)},
        email:  ${JSON.stringify(user.email)},
        token:  ${JSON.stringify(sandboxSessionToken)},
      };
      // Pin postMessage to the app origin — never use '*' with auth tokens.
      var appOrigin = ${JSON.stringify(oauthFrontendOrigin(req, sandboxState))};

      // ── Send postMessage IMMEDIATELY (before any delay) ────────────────────
      // This lets the app start processing the login while the success card is
      // still visible.  The 1-second delay below is purely so the user can see
      // that sign-in succeeded before the window disappears.
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, appOrigin);
        }
      } catch(e){}

      // ── Close after 1 second ───────────────────────────────────────────────
      // window.close() is reliable for any window opened by window.open().
      // On Safari ITP, window.opener may be null but window.close() still
      // works (the popup was opened by script, not by the user navigating).
      // If for any reason close() is blocked, fall back to navigating home.
      setTimeout(function () {
        try { window.close(); } catch(e){}
        // If close() didn't work (document still visible after 200 ms),
        // redirect back to the app so the user isn't stranded.
        setTimeout(function () {
          if (!document.hidden) { window.location.replace('/'); }
        }, 200);
      }, 1000);
    })();
  </script>
</body>
</html>`);
  } catch (error: any) {
    if ((error as any)?.code === "OAUTH_DOMAIN_REJECTED") {
      // Record rejection so the popup's Safari-ITP fallback polling path can
      // detect domain rejection (postMessage is blocked when window.opener is
      // nullified by ITP after the cross-origin Google redirect).
      if (sandboxStateToken) {
        await writeOAuthSession(sandboxStateToken, {
          token: "", userId: "", email: "",
          provider,
          authorizationCode: "sandbox:rejected",
          codeChallenge: sandboxState.codeChallenge,
          returnOrigin: sandboxState.returnOrigin,
          expiresAt: Date.now() + 5 * 60 * 1000,
          rejected: true,
        });
      }
      const appOrigin = oauthFrontendOrigin(req, sandboxState);
      return res.status(403).send(OAuthService.buildDomainRejectionPage(isSandboxRedirectFlow, appOrigin, res.locals.cspNonce));
    }
    console.error("Sandbox authentication failure:", error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
    // Return a generic message — never reflect error.message in HTML (XSS risk).
    return res.status(500).send('<h3>Authentication Error</h3><p>An error occurred during sign-in. Please close this window and try again.</p>');
  }
}));

// ── Apple Sign-In POST callback (response_mode: form_post) ──────────────────
// Apple POSTs the authorization code to this endpoint when the user approves.
// The `user` field (JSON string) is only included on the FIRST authorization.
type AppleIdentityClaims = {
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  iss?: string;
  aud?: string;
};

let appleJwksCache: { keys: Array<Record<string, unknown>>; expiresAt: number } | null = null;

async function verifyAppleIdentityToken(idToken: unknown, clientId: string): Promise<AppleIdentityClaims> {
  if (typeof idToken !== "string" || !idToken) throw new Error("Apple identity token is missing.");
  const complete = jwt.decode(idToken, { complete: true }) as { header?: { alg?: string; kid?: string } } | null;
  const header = complete?.header;
  if (header?.alg !== "RS256" || !header.kid) throw new Error("Apple identity token algorithm or key is invalid.");

  if (!appleJwksCache || appleJwksCache.expiresAt <= Date.now()) {
    const response = await fetchWithTimeout("https://appleid.apple.com/auth/keys");
    if (!response.ok) throw new Error("Apple signing keys could not be retrieved.");
    const payload = await response.json() as { keys?: Array<Record<string, unknown>> };
    if (!Array.isArray(payload.keys)) throw new Error("Apple signing keys are invalid.");
    appleJwksCache = { keys: payload.keys, expiresAt: Date.now() + 60 * 60 * 1000 };
  }

  const jwk = appleJwksCache.keys.find((key) => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) throw new Error("Apple signing key was not found.");
  const publicKey = crypto.createPublicKey({ key: jwk as any, format: "jwk" });
  return jwt.verify(idToken, publicKey, {
    algorithms: ["RS256"],
    issuer: "https://appleid.apple.com",
    audience: clientId,
  }) as AppleIdentityClaims;
}

function decodeApplePrivateKey(raw: string): string {
  // Step 1: Trim leading/trailing whitespace
  let decoded = raw.trim();

  // Step 2: If the raw key does not contain PEM markers, try base64-decoding it
  if (!decoded.includes("-----BEGIN PRIVATE KEY-----")) {
    try {
      decoded = Buffer.from(decoded, "base64").toString("utf-8");
    } catch {
      // If base64 decode fails, keep the original value; validation will catch it later
    }
  }

  // Step 3: Normalize line endings — convert \r\n and \r to \n
  decoded = decoded.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Step 4: Convert literal \n sequences (backslash-n) to actual newlines.
  // This handles the case where the environment variable stores "\n" as two
  // characters (Render) rather than dotenv interpreting them as actual newlines.
  decoded = decoded.replace(/\\n/g, "\n");

  // Step 5: If the key has PEM markers but no newlines, format them with 64-char wrapping
  if (!decoded.includes("\n") && decoded.includes("-----BEGIN PRIVATE KEY-----")) {
    const bodyMatch = decoded.match(/-----BEGIN PRIVATE KEY-----(.*?)-----END PRIVATE KEY-----/);
    if (bodyMatch) {
      const body = bodyMatch[1].replace(/\s+/g, "");
      const formattedBody = body.match(/.{1,64}/g)?.join("\n") || body;
      return `-----BEGIN PRIVATE KEY-----\n${formattedBody}\n-----END PRIVATE KEY-----`;
    }
  }

  // Step 6: Validate that the resulting key is a valid PEM private key.
  // A valid PKCS#8 PEM must contain both BEGIN and END markers.
  if (
    !decoded.includes("-----BEGIN PRIVATE KEY-----") ||
    !decoded.includes("-----END PRIVATE KEY-----")
  ) {
    throw new Error("APPLE_PRIVATE_KEY_INVALID");
  }

  return decoded;
}

app.post("/auth/callback/apple", catchAsync(async (req, res) => {
  // Apple returns from a different browsing context. Preserve the opener so
  // desktop popup delivery can use postMessage; PKCE polling remains the
  // authoritative fallback when the browser severs it.
  res.setHeader("Cross-Origin-Opener-Policy", "unsafe-none");

  const parsedAppleState = parseOAuthState(req.body.state);
  const isRedirectFlow = parsedAppleState?.mode === "redirect";
  const isInappFlow = parsedAppleState?.mode === "inapp";
  const appleState = parsedAppleState?.token || "";

// ── 0. Diagnostics: callback received ───────────────────────────────────
  logger.info("APPLE_AUTH_CALLBACK_RECEIVED", "callback received");

  const sendPendingHandoff = (appOrigin: string) => {
    if (isRedirectFlow) {
      return res.redirect(`${appOrigin}/?${buildOAuthPendingQuery(appleState)}`);
    }
    return res.send(`<!DOCTYPE html><html><body><script nonce="${res.locals.cspNonce}">
      (function(){
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: "OAUTH_AUTH_PENDING", stateToken: ${JSON.stringify(appleState)} }, ${JSON.stringify(appOrigin)});
          }
        } catch (e) {}
        setTimeout(function(){ try { window.close(); } catch (e) {} }, 250);
      })();
    </script></body></html>`);
  };
  const appleStateRecord = appleState ? await readOAuthState(appleState) : null;
  if (!appleStateRecord && appleState) {
    // The state row is intentionally consumed before the provider exchange.
    // A duplicate form_post can therefore arrive after the row is gone but
    // while the short-lived session handoff is still available.
    const pendingSession = await readOAuthSession(appleState);
    if (pendingSession?.provider === "apple") {
      logger.warn("APPLE_PENDING_HANDOFF_FROM_SESSION", "pending handoff from session");
      return sendPendingHandoff(pendingSession.returnOrigin || frontendOrigin(req));
    }
  }
  if (!appleState || !appleStateRecord || appleStateRecord.provider !== "apple") {
    return res.status(400).send("Authentication state is invalid or expired.");
  }
  // The frontend and API are different sites in production, and Safari/iOS
  // commonly partitions or drops the API cookie during Apple's form_post.
  // A server-issued PKCE challenge is an equivalent flow binding: the client
  // must later prove possession of the verifier before receiving the session.
  // Cookie-less callbacks remain rejected for legacy non-PKCE callers.
  if (!isOAuthStateBound(appleState, req.cookies?.oauth_state, appleStateRecord.codeChallenge)) {
    logger.warn("APPLE_PKCE_STATE_NOT_BOUND", "PKCE state not bound");
    return res.status(403).send("Authentication state is not bound to the initiating browser.");
  }
  if (!appleStateRecord.codeChallenge) {
    logger.warn("APPLE_PKCE_REQUIRED", "PKCE required", { appleAuth: { provider: "apple" } });
    return res.status(403).send("Apple Sign-In must use a secure PKCE handoff.");
  }

  const code       = req.body.code  as string | undefined;
  const errorParam = req.body.error || req.body.error_description;

  // User cancelled or Apple returned an error. Redirect-based flows must return
  // to the app; popup/native flows close and notify the opener/poller.
  if (errorParam || !code) {
    if (isRedirectFlow) {
      const reason = errorParam ? String(errorParam) : "Authorization code missing";
      logger.warn("APPLE_AUTH_CANCELLED", "auth cancelled", { appleAuth: { reason: errorParam ? "authorization_pending" : "cancellation" } });
      return res.redirect(`${oauthFrontendOrigin(req, appleStateRecord)}/?oauth_error=${encodeURIComponent(reason)}`);
    }
    const appleErrOrigin = JSON.stringify(oauthFrontendOrigin(req, appleStateRecord));
    return res.send(`<!DOCTYPE html><html><body><script nonce="${res.locals.cspNonce}">
      (function(){
        var appOrigin = ${appleErrOrigin};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: 'OAUTH_CANCELLED' }, appOrigin);
          }
        } catch (e) {}
        window.close();
      })();
    </script></body></html>`);
  }

  // Claim the callback before consuming state. This closes the small race in
  // which Apple retries form_post after state consumption but before the
  // original request has written its processing handoff.
  if (appleStateRecord.codeChallenge) {
    const existingSession = await readOAuthSession(appleState);
    if (existingSession) {
      logger.warn("APPLE_EXISTING_SESSION", "existing session", { appleAuth: { returnOrigin: existingSession.returnOrigin } });
      return sendPendingHandoff(existingSession.returnOrigin || oauthFrontendOrigin(req, appleStateRecord));
    }
    try {
      await writeOAuthSession(appleState, {
        provider: "apple",
        authorizationCode: "apple:processing",
        codeChallenge: appleStateRecord.codeChallenge,
        processing: true,
        returnOrigin: appleStateRecord.returnOrigin,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
    } catch {
      // unchanged
    }
  }

  const consumedAppleState = await consumeOAuthState(appleState);
  if (!consumedAppleState) {
    // A provider/browser retry can arrive after the first callback has already
    // created the short-lived handoff session. Do not re-exchange Apple's
    // single-use authorization code in that case.
    const pendingSession = await readOAuthSession(appleState);
    if (pendingSession) {
      logger.warn("APPLE_PENDING_SESSION_AFTER_CONSUMPTION", "pending session after consumption", { appleAuth: { returnOrigin: pendingSession.returnOrigin } });
      return sendPendingHandoff(pendingSession.returnOrigin || oauthFrontendOrigin(req, appleStateRecord));
    }
    return res.status(400).send("Authentication state is invalid or expired.");
  }

  res.clearCookie("oauth_state", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
  });

  try {
    // ── 1. Extract name from the one-time `user` payload ────────────────────
    // Apple provides the user's real name ONLY during the first authorization.
    // On subsequent logins, req.body.user is absent — this is expected.
    let name = "";
    if (req.body.user) {
      try {
        const userInfo = JSON.parse(req.body.user as string);
        const first = userInfo?.name?.firstName || "";
        const last  = userInfo?.name?.lastName  || "";
        if (first || last) name = `${first} ${last}`.trim();
      } catch { /* user field absent on subsequent logins — expected */ }
    }

    // ── 2. Build Apple client-secret JWT (ES256) ─────────────────────────────
    const privateKeyRaw = process.env.APPLE_PRIVATE_KEY;
    const teamId        = process.env.APPLE_TEAM_ID;
    const clientId      = process.env.APPLE_CLIENT_ID;
    const keyId         = process.env.APPLE_KEY_ID;

    if (!privateKeyRaw || !teamId || !clientId || !keyId) {
      logger.error("APPLE_CONFIG_MISSING", "config missing", {
        appleAuth: { hasPrivateKey: !!privateKeyRaw, keyId: keyId },
      });
      throw new Error("Apple Sign-In server configuration is incomplete (missing APPLE_* env vars).");
    }

    const pKey = decodeApplePrivateKey(privateKeyRaw);

    logger.info("APPLE_CLIENT_SECRET_JWT_GENERATED", "client secret jwt generated", { appleAuth: { keyId: keyId } });

    const clientSecret = jwt.sign({}, pKey, {
      algorithm : "ES256",
      expiresIn : "60m",
      audience  : "https://appleid.apple.com",
      issuer    : teamId,
      subject   : clientId,
      keyid     : keyId,
    });

    // ── 3. Exchange authorization code for Apple tokens ──────────────────────
    // The redirect_uri MUST exactly match the one used in the authorization
    // request (oauthRedirectUri) or Apple rejects the exchange. It is always
    // the backend origin — never the Cloudflare frontend origin.
    const redirectUri = oauthRedirectUri(req, "apple");
    logger.info("APPLE_TOKEN_EXCHANGE_STARTED", "token exchange started", { appleAuth: { redirectUri } });

    const tokenResponse = await fetchWithTimeout("https://appleid.apple.com/auth/token", {
      method  : "POST",
      headers : { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id     : clientId,
        client_secret : clientSecret,
        code,
        grant_type    : "authorization_code",
        redirect_uri  : redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text();
      logger.warn("APPLE_TOKEN_EXCHANGE_FAILED", "token exchange failed", { appleAuth: { httpStatus: tokenResponse.status } });
      throw new Error(`Apple token exchange failed: ${errBody}`);
    }

    const tokenData = await tokenResponse.json() as { id_token?: string };
    logger.info("APPLE_TOKEN_EXCHANGE_SUCCEEDED", "token exchange succeeded", { appleAuth: { hasIdToken: !!tokenData.id_token } });

    // Apple identity-token verification
    // Verify signature, issuer, audience, expiration
    const decodedToken = await verifyAppleIdentityToken(tokenData.id_token, clientId);

    logger.info("APPLE_IDENTITY_TOKEN_VERIFIED", "identity token verified", {
        appleAuth: { hasSub: true, emailPresent: true, emailVerified: decodedToken.email_verified === true }
      });

    // Do not synthesize an institutional address when Apple withholds email:
    // that would let an arbitrary Apple identity pass the domain gate.
    const email = typeof decodedToken?.email === "string" ? decodedToken.email.trim().toLowerCase() : "";
    const emailVerified = decodedToken.email_verified === true || decodedToken.email_verified === "true";
    if (!decodedToken.sub) {
      logger.warn("APPLE_EMAIL_NOT_VERIFIED", "email not verified", { appleAuth: { hasSub: false, emailPresent: false, emailVerified: false } });
    } else if (!email || !emailVerified) {
      logger.warn("APPLE_EMAIL_NOT_VERIFIED", "email not verified", { appleAuth: { hasSub: true, emailPresent: !!email, emailVerified: emailVerified } });
    } else {
      logger.info("APPLE_EMAIL_NOT_VERIFIED", "email verified", { appleAuth: { hasSub: true, emailPresent: true, emailVerified: true } });
    }
const avatar = "";

    // ── 4. Apple identity linking ───────────────────────────────────────────
    // Look up existing Apple identity by sub — this enables subsequent
    // Apple logins (even when email is withheld) to authenticate using
    // the already-established Apple identity instead of creating a new account.
    const prisma = getPrisma();
    const existingIdentity = await prisma.oAuthIdentity.findFirst({
      where: { provider: "apple", providerSubject: decodedToken.sub }
    });
    let linkedUser: any = null;
    if (existingIdentity) {
      // Linked Apple identity found — use the existing user
      const foundUser = await prisma.user.findUnique({ where: { id: existingIdentity.userId } });
      if (foundUser) {
        linkedUser = foundUser;
        // Upgrade fallback name if Apple provided a real name on first auth
        if (name) {
          const fallbackNames = ["apple student", "apple user"];
          const currentName = (foundUser.name || "").trim().toLowerCase();
          if (fallbackNames.includes(currentName)) {
            await prisma.user.update({ where: { id: foundUser.id }, data: { name } });
            linkedUser.name = name;
          }
        }
      } else {
        // Orphaned identity — clear it and proceed with normal flow
        await prisma.oAuthIdentity.delete({ where: { id: existingIdentity.id } });
      }
    }

    // ── 5. Domain gate + find-or-create user ────────────────────────────────
    // Apple accounts use personal emails (gmail, icloud, etc.) — the domain
    // restriction is bypassed for Apple only. The allowAnyEmail flag is set
    // server-side here, not from any client-supplied parameter.
    const user  = await OAuthService.verifyAndUpsertOAuthUser({ email, name, avatar, allowAnyEmail: true, appleName: name || undefined });

    // ── 6. Resolve final user ───────────────────────────────────────────────
    // If an existing Apple identity was found and linked, use that user;
    // otherwise the user from verifyAndUpsertOAuthUser is the final user.
    const finalUser = linkedUser ?? user;

    logger.info("APPLE_USER_UPSERT_SUCCEEDED", "user upsert succeeded", { userId: finalUser.id, appleAuth: { emailPresent: true } });

    const appleSessionToken = setCookieToken(res, user.id, user.email, user.sessionVersion);

    // Native (Capacitor in-app browser) flows complete by polling
    // /api/auth/oauth-session/:stateToken with the PKCE verifier. Apple's
    // form_post callback already exchanged the authorization code server-side
    // (it requires the client-secret JWT), so publish the issued session token
    // through that same polling channel instead of re-exchanging the code.
    if (appleStateRecord?.codeChallenge) {
      try {
        await writeOAuthSession(appleState, {
          userId: user.id,
          email: user.email,
          provider: "apple",
          codeChallenge: appleStateRecord.codeChallenge,
          authorizationCode: "apple:server-exchanged",
          returnOrigin: appleStateRecord.returnOrigin,
          expiresAt: Date.now() + 5 * 60 * 1000,
        });
        logger.info("APPLE_SESSION_POLLING_PUBLISHED", "session polling published", { userId: user.id });
      } catch (sessionErr) {
        logger.error("APPLE_SESSION_POLLING_FAILED", "session polling failed");
        // The user and JWT are already established. A failed session write
        // only affects the PKCE polling fallback — the success HTML below
        // still delivers the token via postMessage. Log and continue so
        // the auth flow completes instead of surfacing a 500 to the user.
      }
    }

    // Redirect-based web clients cannot depend on a cookie set on the API
    // origin. Return the state token and let the app complete the existing
    // one-time PKCE handoff over its normal API channel.
    if (isRedirectFlow && appleStateRecord.codeChallenge) {
      return res.redirect(
        `${oauthFrontendOrigin(req, appleStateRecord)}/?${buildOAuthPendingQuery(appleState)}`,
      );
    }

    // A legacy non-PKCE redirect still has a first-party API cookie available;
    // keep its completion contract compatible with the other OAuth callback.
    if (isRedirectFlow) {
      return res.redirect(`${oauthFrontendOrigin(req, appleStateRecord)}/?oauth_done=1`);
    }

    const appleSuccessOrigin = JSON.stringify(oauthFrontendOrigin(req, appleStateRecord));
    const needsEmailSelection = !finalUser.profileEmail;
    logger.info("APPLE_AUTH_SUCCESS", "auth success", { userId: user.id, appleAuth: { emailPresent: true } });
    return res.send(`<!DOCTYPE html><html><body><script nonce="${res.locals.cspNonce}">
      (function(){
        var payload = {
          type:   'OAUTH_AUTH_SUCCESS',
          userId: ${JSON.stringify(user.id)},
          email:  ${JSON.stringify(user.email)},
          token:  ${JSON.stringify(appleSessionToken)},
          needsEmailSelection: ${JSON.stringify(needsEmailSelection)},
        };
        var appOrigin = ${appleSuccessOrigin};
        if (window.opener && !window.opener.closed) {
          try { window.opener.postMessage(payload, appOrigin); } catch(e){}
        }
        window.close();
        setTimeout(function(){
          if (!${JSON.stringify(isInappFlow)} && !document.hidden) {
            window.location.replace(${JSON.stringify(
              `${oauthFrontendOrigin(req, appleStateRecord)}/?${appleStateRecord.codeChallenge
                ? buildOAuthPendingQuery(appleState)
                : "oauth_done=1"}`,
            )});
          }
        }, 800);
      })();
    </script></body></html>`);

  } catch (error: any) {
    // Apple-specific errors must be diagnosable — never collapse into generic 500.
    if ((error as any)?.code === "OAUTH_DOMAIN_REJECTED") {
      if (appleState) {
        try {
          await writeOAuthSession(appleState, {
            token: "", userId: "",
            email: "",
            provider: "apple",
            authorizationCode: "apple:rejected",
            codeChallenge: appleStateRecord.codeChallenge,
            returnOrigin: appleStateRecord.returnOrigin,
            expiresAt: Date.now() + 5 * 60 * 1000,
            rejected: true,
          });
        } catch {
          // unchanged
        }
      }
      const appleAppOrigin = oauthFrontendOrigin(req, appleStateRecord);
      return res.status(403).send(OAuthService.buildDomainRejectionPage(isRedirectFlow, appleAppOrigin, res.locals.cspNonce));
    }

    if (appleStateRecord.codeChallenge) {
      try {
        await writeOAuthSession(appleState, {
          provider: "apple",
          authorizationCode: "apple:failed",
          codeChallenge: appleStateRecord.codeChallenge,
          failed: true,
          returnOrigin: appleStateRecord.returnOrigin,
          expiresAt: Date.now() + 5 * 60 * 1000,
        });
      } catch {
        // The callback response below still reports the failure; cleanup is
        // best-effort and the normal store expiry rejects stale state safely.
      }
    }
    logger.error("APPLE_AUTH_CALLBACK_ERROR", "auth callback error", {
      details: {
        operation: (() => {
          if ((error as any)?.code === "OAUTH_DOMAIN_REJECTED") return "domain_gate";
          if ((error as any)?.message?.includes("token exchange")) return "token_exchange";
          if ((error as any)?.message?.includes("identity token")) return "identity_verification";
          if ((error as any)?.message?.includes("signing keys")) return "jwks_fetch";
          if ((error as any)?.message?.includes("Apple Sign-In server configuration")) return "config_missing";
          if ((error as any)?.message?.includes("private key") || (error as any)?.code === "APPLE_PRIVATE_KEY_INVALID") return "private_key";
          if ((error as any)?.name === "PrismaClientKnownRequestError") return "database";
          if ((error as any)?.name === "PrismaClientInitializationError") return "database_init";
          return "unknown";
        })(),
        errorType: (error as any)?.name || "Error",
        errorCode: (error as any)?.code || "UNKNOWN",
        hasCode: !!code,
        hasState: !!appleState,
        isRedirectFlow,
        isInappFlow,
      },
    });
    if (isRedirectFlow) {
      return res.redirect(`${oauthFrontendOrigin(req, appleStateRecord)}/?oauth_error=${encodeURIComponent("Apple authentication could not be completed")}`);
    }
    const appleErrorOrigin = JSON.stringify(oauthFrontendOrigin(req, appleStateRecord));
    return res.status(500).send(`<!DOCTYPE html><html><body><script nonce="${res.locals.cspNonce}">
      (function(){
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: "OAUTH_AUTH_ERROR", message: "Apple authentication could not be completed." }, ${appleErrorOrigin});
          }
        } catch (e) {}
        setTimeout(function(){ try { window.close(); } catch (e) {} }, 250);
      })();
    </script></body></html>`);
  }
}));

// OAuth Callback Route for real providers
app.get(["/auth/callback/:provider", "/auth/callback/:provider/"], catchAsync(async (req, res) => {
  // The OAuth callback is loaded in a popup opened by the Cloudflare app.
  // Helmet's default COOP policy (same-origin) severs window.opener when the
  // popup navigates from Google to Render, preventing the success message from
  // reaching the app. This narrowly-scoped callback response must preserve the
  // opener; the pending-session poll remains the independent fallback.
  res.setHeader("Cross-Origin-Opener-Policy", "unsafe-none");

  const provider = (req.params.provider || "").toLowerCase();
  const code = req.query.code as string;
  const errorParam = req.query.error || req.query.error_description;

  // Parse the redirect-flow flag encoded in the state parameter by the client.
  // Web (non-native) clients prefix the stateToken with "r:" to signal that
  // the callback should redirect back to the app rather than serving popup HTML.
  const rawState = req.query.state as string | undefined;
  const isRedirectFlow = typeof rawState === "string" && rawState.startsWith("r:");
  // iOS installed-PWA in-app sheet flow — serve success card, never redirect
  // into the app (the sheet's cookie jar is separate from the installed app's).
  const isInappFlow = typeof rawState === "string" && rawState.startsWith("i:");
  // Clean stateToken (strip the prefix so it matches what the client stored)
  const stateToken = (isRedirectFlow || isInappFlow) && rawState ? rawState.slice(2) : rawState;
  const stateRecord = stateToken ? await readOAuthState(stateToken) : null;

  // Validate state token — CSRF protection and one-time-use enforcement.
  // An error from the provider (errorParam) may legitimately arrive without
  // the state having been consumed, so validate state only when we proceed.
  if (!errorParam) {
    if (!stateToken || !stateRecord || stateRecord.provider !== provider) {
      if (isRedirectFlow) {
        return res.redirect(`${frontendOrigin(req)}/?oauth_error=${encodeURIComponent("Invalid or expired state token")}`);
      }
      return res.status(403).send("<h3>Invalid State</h3><p>The request state is invalid or has expired. Please try signing in again.</p>");
    }
    if (!stateRecord.codeChallenge && req.cookies?.oauth_state !== stateToken) {
      return res.status(403).send("<h3>Invalid State</h3><p>The request was not initiated by this browser.</p>");
    }
    if (!await consumeOAuthState(stateToken)) {
      if (isRedirectFlow) {
        return res.redirect(`${frontendOrigin(req)}/?oauth_error=${encodeURIComponent("Invalid or expired state token")}`);
      }
      return res.status(403).send("<h3>Invalid State</h3><p>The request state is invalid or has already been used.</p>");
    }
  }

  if (errorParam) {
    if (isRedirectFlow) {
      // Redirect back to the app with the error encoded in the query string.
      // App.tsx reads this on startup and surfaces a user-friendly message.
      return res.redirect(`${oauthFrontendOrigin(req, stateRecord)}/?oauth_error=${encodeURIComponent(String(errorParam))}`);
    }
    return res.status(400).send(`
      <h3>OAuth Error</h3>
      <p>Sign-in was declined or cancelled by ${escapeHtml(provider)}.</p>
      <button id="close-oauth-window">Close Window</button>
      <script nonce="${res.locals.cspNonce}">
        document.getElementById("close-oauth-window")?.addEventListener("click", function () { window.close(); });
      </script>
    `);
  }

  if (!code) {
    if (isRedirectFlow) {
      return res.redirect(`${oauthFrontendOrigin(req, stateRecord)}/?oauth_error=${encodeURIComponent("Authorization code missing")}`);
    }
    return res.status(400).send(`<h3>Authorization Missing</h3><p>OAuth exchange did not provide a verification code.</p>`);
  }

  if ((provider === "google" || provider === "apple") && !stateRecord?.codeChallenge) {
    if (isRedirectFlow) {
      return res.redirect(`${oauthFrontendOrigin(req, stateRecord)}/?oauth_error=${encodeURIComponent(`${provider === "google" ? "Google" : "Apple"} OAuth requires PKCE`)}`);
    }
    return res.status(403).send(`<h3>Invalid OAuth flow</h3><p>${provider === "google" ? "Google" : "Apple"} Sign-In must use a secure PKCE handoff.</p>`);
  }

  // Native/public clients use PKCE. The callback stores only the provider code;
  // the app must later prove possession of the verifier before receiving a JWT.
  if (stateRecord?.codeChallenge) {
    const redirectUri = oauthRedirectUri(req, provider);
    await writeOAuthSession(stateToken!, {
      authorizationCode: code,
      provider,
      redirectUri,
      codeChallenge: stateRecord.codeChallenge,
      returnOrigin: stateRecord.returnOrigin,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    if (isRedirectFlow) {
      return res.redirect(`${oauthFrontendOrigin(req, stateRecord)}/?oauth_pending=1&oauth_state=${encodeURIComponent(stateToken!)}`);
    }
    const appOrigin = JSON.stringify(oauthFrontendOrigin(req, stateRecord));
    return res.send(`<!DOCTYPE html><html><body><script nonce="${res.locals.cspNonce}">
      (function(){
        try { if (window.opener && !window.opener.closed) window.opener.postMessage({type:'OAUTH_AUTH_PENDING', stateToken:${JSON.stringify(stateToken)}}, ${appOrigin}); } catch(e) {}
        setTimeout(function(){ try { window.close(); } catch(e) {} }, 250);
      })();
    </script></body></html>`);
  }

  try {
    let email = "";
    let name = "";
    let avatar = "";

    // 1. Google OAuth code exchange
    if (provider === "google") {
      const tokenUrl = "https://oauth2.googleapis.com/token";
      // This must exactly match the URI sent in the authorization request.
      const redirectUri = oauthRedirectUri(req, "google");

      const response = await fetchWithTimeout(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID || "",
          client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
          redirect_uri: redirectUri,
          grant_type: "authorization_code"
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google code exchange failed: ${errorText}`);
      }

      const tokenData = await response.json();
      const accessToken = tokenData.access_token;

      // Extract details from Google UserInfo
      const userInfoResponse = await fetchWithTimeout("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!userInfoResponse.ok) {
        throw new Error("Failed to retrieve user info profile from Google.");
      }

      const googleProfile = await userInfoResponse.json() as { email?: string; email_verified?: boolean; name?: string; given_name?: string; picture?: string };
      if (!googleProfile.email || googleProfile.email_verified !== true) {
        throw new Error("Google account email could not be verified.");
      }
      email = googleProfile.email;
      name = googleProfile.name || googleProfile.given_name || email.split("@")[0];
      avatar = googleProfile.picture || "";
    }

    // 2. Facebook Login code exchange
    else if (provider === "facebook") {
      const tokenUrl = "https://graph.facebook.com/v12.0/oauth/access_token";
      const redirectUri = oauthRedirectUri(req, "facebook");

      const params = new URLSearchParams({
        code,
        client_id: process.env.FACEBOOK_CLIENT_ID || "",
        client_secret: process.env.FACEBOOK_CLIENT_SECRET || "",
        redirect_uri: redirectUri
      });

      const response = await fetchWithTimeout(`${tokenUrl}?${params.toString()}`);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Facebook code exchange failed: ${errorText}`);
      }

      const tokenData = await response.json();
      const accessToken = tokenData.access_token;

      // Retrieve user node details
      const profileResponse = await fetchWithTimeout(`https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${accessToken}`);
      if (!profileResponse.ok) {
        throw new Error("Failed to retrieve profile data from Facebook Graph.");
      }

      const fbProfile = await profileResponse.json();
      email = fbProfile.email || `${fbProfile.id}@facebook.uob.edu.iq`;
      name = fbProfile.name || "Facebook Student";
      avatar = fbProfile.picture?.data?.url || "";
    }

    // 3. Apple Sign-In code exchange
    else if (provider === "apple") {
      const tokenUrl = "https://appleid.apple.com/auth/token";
      const redirectUri = oauthRedirectUri(req, "apple");

      // Apple Client Secret JWT Generator helper
      let clientSecret = "";
      const privateKeyDecoded = process.env.APPLE_PRIVATE_KEY;
      const teamId = process.env.APPLE_TEAM_ID;
      const clientId = process.env.APPLE_CLIENT_ID;
      const keyId = process.env.APPLE_KEY_ID;

      if (privateKeyDecoded && teamId && clientId && keyId) {
         const pKey = decodeApplePrivateKey(privateKeyDecoded);

        clientSecret = jwt.sign({}, pKey, {
          algorithm: "ES256",
          expiresIn: "60m",
          audience: "https://appleid.apple.com",
          issuer: teamId,
          subject: clientId,
          keyid: keyId
        });
      } else {
        throw new Error("Apple configuration keys are missing or incomplete to complete token signing.");
      }

      const response = await fetchWithTimeout(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Apple code exchange failed: ${errorText}`);
      }

       const tokenData = await response.json() as { id_token?: string };
       const decodedToken = await verifyAppleIdentityToken(tokenData.id_token, clientId);
       if (!decodedToken.sub || !decodedToken.email || (decodedToken.email_verified !== true && decodedToken.email_verified !== "true")) {
         throw new Error("Apple account email could not be verified.");
       }
       email = decodedToken.email;
      // Apple provides the user's real name ONLY during the first authorization.
      // On subsequent logins, req.body.user is absent — this is expected.
      if (req.body.user) {
        try {
          const userInfo = JSON.parse(req.body.user as string);
          const first = userInfo?.name?.firstName || "";
          const last  = userInfo?.name?.lastName  || "";
          if (first || last) name = `${first} ${last}`.trim();
        } catch { /* user field absent on subsequent logins — expected */ }
      }
    }

    else {
      throw new Error("Specified provider callback has not been configured.");
    }

    if (!email) {
      throw new Error("Could not construct identity. Provider email was null.");
    }

    // ── Domain restriction + role assignment ─────────────────────────────────
    // OAuthService is the single source of truth for both business rules.
    // Throws with err.code === "OAUTH_DOMAIN_REJECTED" for non-institutional
    // emails; that code is caught below and gets a styled denial page.
    // Apple accounts use personal emails — bypass domain check for Apple only.
    const user = await OAuthService.verifyAndUpsertOAuthUser({ email, name, avatar, allowAnyEmail: provider === "apple", appleName: provider === "apple" && name ? name : undefined });

    const oauthSessionToken = setCookieToken(res, user.id, user.email, user.sessionVersion);

    // Store session for native Capacitor polling.
    // stateToken was already parsed/cleaned near the top of this handler.
    if (stateToken) {
      await writeOAuthSession(stateToken, {
        userId: user.id,
        email: user.email,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
    }

    // ── Redirect flow (web non-native) ────────────────────────────────────────
    // The cookie set above is in the first-party browsing context (the entire
    // page navigated here — no popup, no third-party context).  ITP does not
    // restrict first-party cookies, so the startup /api/auth/me call in the
    // app will find it immediately after the redirect lands.
    if (isRedirectFlow) {
      return res.redirect(`${oauthFrontendOrigin(req, stateRecord)}/?oauth_done=1`);
    }

    return res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              display: flex; align-items: center; justify-content: center;
              min-height: 100vh; background: #F8F9FC;
            }
            .card {
              text-align: center; padding: 2.5rem 2rem;
              animation: up 0.28s cubic-bezier(.22,1,.36,1) both;
            }
            @keyframes up { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
            .check-wrap {
              width: 56px; height: 56px; border-radius: 50%;
              background: #ECFDF5; border: 1.5px solid #A7F3D0;
              display: flex; align-items: center; justify-content: center;
              margin: 0 auto 1.25rem;
            }
            .title { font-size: 1rem; font-weight: 700; color: #1E2D4A; }
            .sub   { font-size: 0.8125rem; color: #64748B; margin-top: 0.4rem; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="check-wrap">
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <path d="M5 14.5l6 6L23 8" stroke="#10B981" stroke-width="2.5"
                      stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <p class="title">Signed in successfully</p>
            <p class="sub">${isInappFlow ? "You can close this window and return to the app." : "Returning to the app…"}</p>
          </div>
          <script nonce="${res.locals.cspNonce}">
            (function () {
              // Values are server-side JSON.stringify'd to prevent JS injection.
              var payload = {
                type:   'OAUTH_AUTH_SUCCESS',
                userId: ${JSON.stringify(user.id)},
                email:  ${JSON.stringify(user.email)},
                // Required by the main window for cookie-partitioned contexts
                // (iOS installed PWA popup / Safari ITP): the app stores this
                // JWT in SecureStorage and sends it as Authorization: Bearer,
                // because the popup's HttpOnly cookie is not readable there.
                token:  ${JSON.stringify(oauthSessionToken)},
              };
              // Pin postMessage to the app origin — never broadcast auth tokens with '*'.
              var appOrigin = ${JSON.stringify(oauthFrontendOrigin(req, stateRecord))};

              // ── Send postMessage IMMEDIATELY ─────────────────────────────────
              // The app starts processing the login right away while the
              // 1-second success card is still visible.
              try {
                if (window.opener && !window.opener.closed) {
                  window.opener.postMessage(payload, appOrigin);
                }
              } catch (e) {}

              // ── Close after 1 second ───────────────────────────────────────
              // window.close() works reliably for any window opened by
              // window.open() — including Safari ITP contexts where
              // window.opener is nullified (the popup WAS opened by script,
              // so close() is still permitted).
              // The polling fallback in the app (the shared OAuth store) detects
              // the popup closing and fetches the token if postMessage was lost.
              // In-app sheet flow (iOS installed PWA): the sheet cannot be
              // closed by script and must NOT redirect to '/' — the app copy
              // loaded in the sheet would not be signed in (separate cookie
              // jar). The user closes the sheet manually; the installed app
              // underneath has already received the session via polling.
              var isInappFlow = ${JSON.stringify(isInappFlow)};
              setTimeout(function () {
                try { window.close(); } catch (e) {}
                // If close() was blocked (document still visible after 300 ms),
                // redirect back to the app so the user isn't stranded.
                setTimeout(function () {
                  if (!isInappFlow && !document.hidden) {
                    window.location.replace(${JSON.stringify(`${oauthFrontendOrigin(req, stateRecord)}/?oauth_done=1`)});
                  }
                }, 300);
              }, 1000);
            })();
          </script>
        </body>
      </html>
    `);

  } catch (error: any) {
    // Domain restriction violation — render styled denial page and notify parent
    if ((error as any)?.code === "OAUTH_DOMAIN_REJECTED") {
      // Record rejection so the popup's Safari-ITP polling fallback can detect
      // this was domain rejection, not a manual cancel.
      if (stateToken) {
        try {
          await writeOAuthSession(stateToken, {
            token: "", userId: "", email: "",
            provider,
            authorizationCode: `${provider}:rejected`,
            codeChallenge: stateRecord?.codeChallenge,
            returnOrigin: stateRecord?.returnOrigin,
            expiresAt: Date.now() + 5 * 60 * 1000,
            rejected: true,
          });
        } catch {
          // The denial page remains safe even if the optional poll marker fails.
        }
      }
      const appOrigin = oauthFrontendOrigin(req, stateRecord);
      return res.status(403).send(OAuthService.buildDomainRejectionPage(isRedirectFlow, appOrigin, res.locals.cspNonce));
    }
    if (stateToken && stateRecord?.codeChallenge) {
      try {
        await writeOAuthSession(stateToken, {
          provider,
          authorizationCode: `${provider}:failed`,
          codeChallenge: stateRecord.codeChallenge,
          returnOrigin: stateRecord.returnOrigin,
          expiresAt: Date.now() + 5 * 60 * 1000,
          failed: true,
          failureMessage: provider === "google"
            ? "Google authentication could not be completed."
            : "OAuth authentication could not be completed.",
        });
      } catch {
        // The callback response still reports the failure; expiry remains the
        // final cleanup path if the optional polling marker cannot be written.
      }
    }
    console.error(`OAuth verification failure [${provider}]:`, error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
    if (isRedirectFlow) {
      return res.redirect(`${oauthFrontendOrigin(req, stateRecord)}/?oauth_error=${encodeURIComponent(
        provider === "google" ? "Google authentication could not be completed" : "OAuth authentication could not be completed",
      )}`);
    }
    return res.status(500).send('<h3>Verification Failure</h3><p>Authentication could not be completed. Please close this window and try again.</p>');
  }
}));

// Peer-Student Login — authenticates existing accounts only
app.post("/api/auth/login", catchAsync(async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || typeof email !== "string" || !password || typeof password !== "string") {
      return res.status(400).json({ error: "Valid email and password strings are required." });
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!validateEmail(cleanEmail)) {
      return res.status(400).json({ error: "Invalid academic email format." });
    }

    // ── Access gate (mirrors OAuth policy — single source of truth) ──────────
    // Passes institutional domain members and operator-approved reviewer emails.
    if (!OAuthService.isAllowedEmail(cleanEmail)) {
      return res.status(403).json({
        error: "Access Denied: Only Baghdad University Medical College emails are allowed to register or login.",
        field: "email",
      });
    }

    const existing = await UserService.findByEmail(cleanEmail);

    // Always return the same error for missing user or wrong password
    // to prevent email enumeration attacks
    if (!existing) {
      return res.status(401).json({ error: "Invalid email or password." });
    }
    // Validate credentials securely using bcryptjs
    try {
      const validatedUser = await AuthService.authenticateUser(cleanEmail, password);
      if (validatedUser.emailVerified === false) {
        return res.status(403).json({
          verificationRequired: true,
          error: "Please verify your institutional email before signing in.",
        });
      }
      // Block banned users before issuing any token
      {
        const prismaClient = getPrisma();
        const activeBan = await prismaClient.userBan.findUnique({ where: { userId: validatedUser.id } });
        if (activeBan) {
          const isExpired = !activeBan.isPermanent && activeBan.endTime && activeBan.endTime <= new Date();
          if (!isExpired) {
            return res.status(403).json({
              banned: true,
              error: "Your account has been suspended.",
              reason: activeBan.reason,
              isPermanent: activeBan.isPermanent,
              endTime: activeBan.endTime?.toISOString() || null,
            });
          }
          // Expired ban — auto-unban and record expiry
          await prismaClient.$transaction(async (tx: any) => {
            await tx.userBan.delete({ where: { userId: validatedUser.id } });
            await tx.user.update({ where: { id: validatedUser.id }, data: { accountStatus: "ACTIVE" } });
          });
          await logModerationAction(prismaClient, { actionType: "BAN_EXPIRED", targetUserId: validatedUser.id, isSystemAction: true, metadata: { expiredAt: new Date().toISOString(), trigger: "login" } });
        }
      }
      const token = setCookieToken(res, validatedUser.id, validatedUser.email, validatedUser.sessionVersion);
      authMonitor.loginSuccess(validatedUser.id, req.ip);
      const fullData = await UserService.getFullUserData(validatedUser.id);
      // Token intentionally omitted from JSON — session is carried by httpOnly cookie only.
      // Exception: clients that cannot rely on cookie persistence (iOS installed
      // PWA, native shells) send X-Session-Delivery: bearer and receive the token
      // for SecureStorage + Authorization-header use.
      if (req.headers["x-session-delivery"] === "bearer") {
        return res.json({ success: true, token, ...fullData });
      }
      return res.json({ success: true, ...fullData });
    } catch (authError: any) {
      if (isInfrastructureError(authError)) {
        logger.error("AUTH", "Login dependency unavailable", { ip: req.ip, errorCode: "AUTH_DATABASE_UNAVAILABLE" });
        return res.status(503).json({
          error: "Authentication service is temporarily unavailable. Please try again.",
          retryable: true,
        });
      }
      authMonitor.loginFailed(cleanEmail.substring(0, 3) + "***", req.ip, "invalid_credentials");
      return res.status(401).json({ error: "Invalid email or password." });
    }
  } catch (error) {
    logger.error("AUTH", "Login route unexpected error", { ip: req.ip });
    if (isInfrastructureError(error)) {
      return res.status(503).json({
        error: "Authentication service is temporarily unavailable. Please try again.",
        retryable: true,
      });
    }
    return res.status(500).json({ error: "Authentication service error. Please try again." });
  }
}));

// Peer-Student Registration — creates a new account
app.post("/api/auth/register", catchAsync(async (req, res) => {
  try {
    const { email, password, name, studentGroup, signature } = req.body;
    if (!email || typeof email !== "string" || !password || typeof password !== "string") {
      return res.status(400).json({ error: "Valid email and password strings are required." });
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!validateEmail(cleanEmail)) {
      return res.status(400).json({ error: "Invalid academic email format.", field: "email" });
    }

    // ── Access gate (mirrors OAuth policy — single source of truth) ──────────
    // Passes institutional domain members and operator-approved reviewer emails.
    if (!OAuthService.isAllowedEmail(cleanEmail)) {
      return res.status(403).json({
        error: "Access Denied: Only Baghdad University Medical College emails are allowed to register or login.",
        field: "email",
      });
    }

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Full name is required for registration.", field: "name" });
    }
    if (name.trim().length > 200) {
      return res.status(400).json({ error: "Name must be under 200 characters.", field: "name" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters long.", field: "password" });
    }
    if (password.length > 128) {
      return res.status(400).json({ error: "Password must be under 128 characters.", field: "password" });
    }

    if (studentGroup && !["A", "B", "C", "D"].includes(studentGroup)) {
      return res.status(400).json({ error: "Invalid academic group. Allowed values: A, B, C, D", field: "studentGroup" });
    }

    if (signature !== undefined && signature !== null && signature !== "") {
      if (typeof signature !== "string" || signature.length > 5 * 1024 * 1024) {
        return res.status(400).json({ error: "Signature data must be under 5MB.", field: "signature" });
      }
    }

    const existing = await UserService.findByEmail(cleanEmail);
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists.", field: "email" });
    }

    // ── Role assignment ───────────────────────────────────────────────────────
    // All permitted emails start as regular "user" unless assigned via OAuth.
    const assignedRole = "user" as const;

    // Operator-approved reviewer accounts (ALLOWED_REVIEWER_EMAILS) are trusted
    // by configuration — they need no email-verification round trip and are
    // signed in immediately. Institutional-email registrations still require
    // proof of ownership through the single-use verification link below.
    const isReviewer = OAuthService.isReviewerEmail(cleanEmail);

    try {
      const freshUser = await AuthService.registerUser({
        email: cleanEmail,
        password: password,
        name: name.trim(),
        role: assignedRole,
        emailVerified: isReviewer,
        accountStatus: isReviewer ? "ACTIVE" : "PENDING",
        // Public registration cannot assign an authorization group.
        studentGroup: "A",
        signature: (typeof signature === "string" && signature) ? signature : undefined,
      });

      if (isReviewer) {
        const token = setCookieToken(res, freshUser.id, freshUser.email, freshUser.sessionVersion);
        authMonitor.registrationSuccess(freshUser.id, req.ip);
        const fullData = await UserService.getFullUserData(freshUser.id);
        if (req.headers["x-session-delivery"] === "bearer") {
          return res.json({ success: true, token, ...fullData });
        }
        return res.json({ success: true, ...fullData });
      }

      let delivery: { success: boolean; configured: boolean };
      try {
        delivery = await issueEmailVerification(req, freshUser);
      } catch {
        delivery = { success: false, configured: false };
      }
      if (!delivery.success || !delivery.configured) {
        // The account remains in the database. The verification token was
        // created before the email send attempt, so the user can request a
        // new verification email via /api/auth/resend-verification.
        authMonitor.registrationSuccess(freshUser.id, req.ip);
        return res.json({
          success: true,
          verificationRequired: true,
          initialEmailDeliveryFailed: true,
          message: delivery.configured
            ? "Verification email could not be sent. Please use the resend option."
            : "Email service is not configured. Please use the resend option to verify your account.",
        });
      }

      authMonitor.registrationSuccess(freshUser.id, req.ip);
      // No cookie, bearer token, or user payload is issued before ownership is
      // proven through the single-use email verification link.
      return res.json({
        success: true,
        verificationRequired: true,
        message: "Check your institutional inbox to verify your email before signing in.",
      });
    } catch (regError: any) {
      authMonitor.registrationFailed(req.ip, regError.message || "unknown");
      return res.status(400).json({ error: regError.message || "Registration failed." });
    }
  } catch (error) {
    logger.error("AUTH", "Register route unexpected error", { ip: req.ip });
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// Generic resend response prevents account enumeration. Only unverified
// institutional accounts receive a new short-lived token.
app.post("/api/auth/resend-verification", catchAsync(async (req, res) => {
  const genericResponse = {
    success: true,
    message: "If an unverified institutional account exists, a verification email has been sent.",
  };
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!validateEmail(email) || !OAuthService.isAllowedEmail(email)) return res.json(genericResponse);

  const user = await UserService.findByEmail(email);
  if (!user || user.emailVerified !== false) return res.json(genericResponse);

  const delivery = await issueEmailVerification(req, user);
  if (!delivery.success) {
    logger.warn("AUTH", "Resend verification email delivery failed", { details: { configured: delivery.configured } });
  }
  return res.json(genericResponse);
}));

// Revoke security session and wipe httpOnly authenticated session cookies
app.post("/api/auth/logout", catchAsync(async (req, res) => {
  try {
    // Server-side revocation: invalidate the presented token so it can no longer
    // be used even if it was exfiltrated before logout. Clearing the cookie alone
    // is insufficient because the JWT remains valid for up to 30 days.
    const token = getRequestToken(req);
    if (token) {
      // Per-device sign-out: revoke ONLY the presented token so this device
      // logs out while the student's other active devices stay signed in.
      // sessionVersion is intentionally NOT incremented here — bumping it
      // invalidates every session for that user, force-logging-out active
      // users on their other devices (the UI labels this button
      // "Sign out from this device"). Password changes still bump
      // sessionVersion (userService) to require re-authentication everywhere.
      await revokeToken(token);
    }
    res.clearCookie("auth_token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
    });
    return res.json({ success: true, message: "Logged out successfully from University core database." });
  } catch (error) {
    console.error("Logout fault:", error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// Self account deletion endpoint for App Store privacy compliance (Apple Guideline 5.1.1(v))
app.post("/api/auth/self-delete", requireUser, catchAsync(async (req: any, res) => {
  try {
    const userId = req.user.id;
    if (req.user.role === "owner") {
      return res.status(403).json({ error: "Forbidden: Owner accounts cannot be self-deleted." });
    }

    // Require an explicit uppercase confirmation phrase. Authentication is
    // already enforced by requireUser and no password is requested or checked.
    const { confirmation } = req.body;
    if (confirmation !== "DELETE") {
      return res.status(400).json({ error: "Type DELETE in uppercase English letters to confirm account deletion." });
    }

    const success = await UserService.deleteUser(userId);
    if (!success) {
      return res.status(404).json({ error: "User record not found in central database." });
    }
    await removeDeviceTokensForUser(userId);
    res.clearCookie("auth_token", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
    });
    return res.json({ success: true, message: "Student account successfully expunged." });
  } catch (error) {
    console.error("Self-delete fault:", error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// Endpoint to explicitly check/refresh the session token
app.post("/api/auth/refresh", requireUser, catchAsync(async (req, res) => {
  try {
    const authUser = (req as any).user;
    // Issue refreshed cookie with extended 30-day lifetime
    const token = setCookieToken(res, authUser.id, authUser.email, authUser.sessionVersion);
    // Token intentionally omitted from JSON — session is carried by httpOnly cookie only.
    // Exception: X-Session-Delivery: bearer clients (iOS installed PWA) — see login.
    if (req.headers["x-session-delivery"] === "bearer") {
      return res.json({ success: true, token, user: authUser });
    }
    return res.json({ success: true, user: authUser });
  } catch (err) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
}));

// --- Forgot and Reset Password Endpoints ---

// Forgot Password: Issue secure token and send recovery email
app.post("/api/auth/forgot-password", catchAsync(async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Valid academic email address string is required." });
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!validateEmail(cleanEmail)) {
      return res.status(400).json({ error: "Invalid academic email format." });
    }

    const user = await UserService.findByEmail(cleanEmail);

    if (!user) {
      // Standard secure return to thwart email harvesting
      return res.json({
        success: true,
        message: "If that academic record exists, a recovery authorization code has been dispatched."
      });
    }

    // Generate secure reset token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins expiration

    // Persist the token (SHA-256 hashed) to the database — survives server restarts
    await UserService.storeResetToken(user.id, token, expiresAt);

    // Build the reset URL from APP_URL env var so it cannot be poisoned via
    // a spoofed Origin/Host header from a misconfigured reverse proxy.
    const configuredAppUrl = process.env.APP_URL?.replace(/\/$/, "");
    if (process.env.NODE_ENV === "production" && !configuredAppUrl) {
      logger.error("AUTH", "APP_URL is required in production; refusing to create a host-derived reset link.");
      return res.status(500).json({ error: "Internal Server Error" });
    }
    const appBaseUrl = configuredAppUrl || `http://localhost:${PORT}`;
    const resetLink = `${appBaseUrl}/reset-password?token=${token}&email=${encodeURIComponent(cleanEmail)}`;

    
    // Call raw SMTP delivery
    const delivery = await EmailService.sendResetPasswordEmail(cleanEmail, resetLink, user.name || "Student");

    if (delivery.success) {
      return res.json({
        success: true,
        message: delivery.sandbox
          ? "A reset link has been simulated (Sandbox mode active)."
          : "A secure reset link has been dispatched to your academic email.",
        // sandboxLink intentionally omitted — reset tokens must never appear in HTTP responses,
        // even in development mode. Check server logs when SMTP is not configured.
        sandbox: !!delivery.sandbox
      });
    } else {
      // SMTP logs error but fallback to sandbox link so developers are never blocked
      return res.status(500).json({ error: "Internal Server Error" });
    }

  } catch (error: any) {
    console.error("Forgot password API fault:", error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// Reset Password: Exchange secure token for a fresh hashed password
app.post("/api/auth/reset-password", catchAsync(async (req, res) => {
  // Generic error used for ALL failure cases — prevents user-enumeration attacks.
  // An attacker cannot distinguish "email not found", "token expired", or "token invalid"
  // from each other via this endpoint.
  const GENERIC_FAIL = "Reset link is invalid or has expired. Please request a new one.";

  try {
    const { email, token, password } = req.body;
    if (!email || typeof email !== "string" || !token || typeof token !== "string" || !password || typeof password !== "string") {
      return res.status(400).json({ error: "Missing or invalid parameters." });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters long." });
    }
    // Mirror the same max-length cap enforced during registration to prevent bcrypt DoS.
    if (password.length > 128) {
      return res.status(400).json({ error: "Password must be under 128 characters." });
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!validateEmail(cleanEmail)) {
      return res.status(400).json({ error: GENERIC_FAIL });
    }

    const user = await UserService.findByEmail(cleanEmail);
    if (!user) {
      // Indistinguishable from token-invalid so an attacker cannot enumerate emails.
      return res.status(400).json({ error: GENERIC_FAIL });
    }

    // Hash the new password and atomically verify + consume the token in one DB transaction.
    // verifyAndConsumeResetToken returns false for missing, expired, or already-used tokens.
    const newPasswordHash = await AuthService.hashPassword(password);
    const ok = await UserService.verifyAndConsumeResetToken(user.id, token, newPasswordHash);
    if (!ok) {
      return res.status(400).json({ error: GENERIC_FAIL });
    }

    return res.json({ success: true, message: "Your password has been successfully updated." });
  } catch (error: any) {
    console.error("Reset password API fault:", error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// Complete first-time OAuth profile setup.
// New Google/Apple users are created in PENDING_PROFILE state and may only
// leave onboarding after providing the profile fields used throughout the app.
app.post("/api/auth/complete-profile", requireUser, catchAsync(async (req: any, res) => {
  const authUser = req.user;
  const { name, studentGroup, signature, avatar } = req.body ?? {};

  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Full name is required." });
  }
  if (name.trim().length > 200) {
    return res.status(400).json({ error: "Name must be under 200 characters." });
  }
  if (!studentGroup || !["A", "B", "C", "D"].includes(studentGroup)) {
    return res.status(400).json({ error: "Please select a valid academic group." });
  }
  if (!signature || typeof signature !== "string" || !signature.startsWith("data:image/")) {
    return res.status(400).json({ error: "A valid digital signature is required." });
  }
  if (signature.length > 5 * 1024 * 1024) {
    return res.status(400).json({ error: "Signature data must be under 5MB." });
  }
  if (avatar !== undefined && avatar !== null && avatar !== "") {
    if (typeof avatar !== "string" || (!avatar.startsWith("data:image/") && !/^https:\/\//i.test(avatar))) {
      return res.status(400).json({ error: "Invalid profile image." });
    }
    if (avatar.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: "Profile image must be under 5MB." });
    }
  }

  await UserService.updateUser({
    id: authUser.id,
    name: name.trim(),
    studentGroup,
    signature,
    ...(avatar ? { avatar } : {}),
    accountStatus: "active",
  });

  const fullData = await UserService.getFullUserData(authUser.id);
  if (!fullData?.user) {
    return res.status(500).json({ error: "Profile could not be loaded after saving." });
  }
  return res.json({ success: true, ...fullData });
}));

// Update peer profile card details
app.post("/api/auth/update-profile", requireUser, catchAsync(async (req, res) => {
  try {
    const { userId, name, email, avatar, studentGroup, signature, removeAvatar } = req.body;
    if (!userId) return res.status(400).json({ error: "User context ID is required." });
    if (removeAvatar !== undefined && typeof removeAvatar !== "boolean") {
      return res.status(400).json({ error: "removeAvatar must be a boolean." });
    }

    if (studentGroup && !["A", "B", "C", "D"].includes(studentGroup)) {
      return res.status(400).json({ error: "Invalid academic group. Allowed values: A, B, C, D" });
    }

    const authUser = (req as any).user;
    if (authUser.id !== userId && authUser.role !== "admin" && authUser.role !== "owner") {
      return res.status(403).json({ error: "Access denied. You can only update your own profile." });
    }

    const user = await UserService.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User session not matching data nodes." });
    }

    // Validate optional name field
    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "Name must be a non-empty string." });
      }
      if (name.trim().length > 200) {
        return res.status(400).json({ error: "Name must be under 200 characters." });
      }
    }

    // Validate optional avatar URL field
    if (avatar !== undefined && avatar !== null && avatar !== "") {
      if (typeof avatar !== "string" || avatar.length > 10 * 1024 * 1024) {
        return res.status(400).json({ error: "Avatar image data must be under 10MB." });
      }
    }

    if (signature !== undefined && signature !== null && signature !== "") {
      if (typeof signature !== "string" || signature.length > 5 * 1024 * 1024) {
        return res.status(400).json({ error: "Signature data must be under 5MB." });
      }
    }

    let cleanEmail: string | undefined = undefined;
    if (email !== undefined && email !== null) {
      if (typeof email !== "string" || !validateEmail(email)) {
        return res.status(400).json({ error: "Invalid email format." });
      }
      cleanEmail = email.trim().toLowerCase();
      if (cleanEmail !== user.email) {
        const existing = await UserService.findByEmail(cleanEmail);
        if (existing) {
          return res.status(400).json({ error: "Email is already registered by another student." });
        }
      }
    }

    if (authUser.id !== userId && studentGroup !== undefined && studentGroup !== authUser.studentGroup && authUser.role !== "admin" && authUser.role !== "owner") {
      return res.status(403).json({ error: "Student group membership can only be changed by an administrator." });
    }

    await UserService.updateUser({
      id: userId,
      name: name?.trim(),
      email: cleanEmail,
      avatar: removeAvatar === true ? undefined : avatar,
      clearAvatar: removeAvatar === true,
      studentGroup: (authUser.id === userId || authUser.role === "admin" || authUser.role === "owner") ? studentGroup : undefined,
      signature
    });

    const updated = await UserService.findById(userId);
    res.json({ success: true, user: updated });

    // Broadcast profile change so every connected client sees it immediately
    if (updated) {
      const { passwordHash: _ph, ...safeUpdated } = updated as any;
      io.to("admins").emit("userUpdated", safeUpdated);
      io.to("admins").emit("roster_updated");
    }
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// ── Apple email-selection onboarding ─────────────────────────────────────────
// After first Apple login, the user chooses whether to use the Apple-provided
// email (which may be a Private Relay address) or their university email as
// their application profile email.  The Apple identity (OAuthIdentity) and
// authentication email (User.email) remain unchanged.
app.post("/api/auth/apple/select-email", requireUser, catchAsync(async (req, res) => {
  try {
    const { userId, choice, universityEmail } = req.body;
    if (!userId) return res.status(400).json({ error: "User ID is required." });

    const authUser = (req as any).user;
    if (authUser.id !== userId) {
      return res.status(403).json({ error: "Access denied." });
    }

    // Verify this is an Apple-authenticated user
    const prisma = getPrisma();
    const appleIdentity = await prisma.oAuthIdentity.findFirst({
      where: { provider: "apple", userId },
    });
    if (!appleIdentity) {
      return res.status(400).json({ error: "This feature is only available for Apple Sign-In accounts." });
    }

    const user = await UserService.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found." });

    // If profileEmail is already set, the user has already made a selection
    if (user.profileEmail) {
      return res.status(400).json({ error: "Email selection has already been completed." });
    }

    let selectedEmail: string;

    if (choice === "apple") {
      // Use the exact email Apple provided (may be a Private Relay address)
      selectedEmail = user.email;
    } else if (choice === "university") {
      // Validate university email
      if (!universityEmail || typeof universityEmail !== "string") {
        return res.status(400).json({ error: "University email is required." });
      }
      const cleanUni = universityEmail.trim().toLowerCase();
      if (!cleanUni.endsWith("@comed.uobaghdad.edu.iq")) {
        return res.status(400).json({ error: "Only @comed.uobaghdad.edu.iq emails are accepted." });
      }
      if (!validateEmail(cleanUni)) {
        return res.status(400).json({ error: "Invalid email format." });
      }
      // Check uniqueness — this email must not be another user's authentication email
      const existing = await UserService.findByEmail(cleanUni);
      if (existing && existing.id !== userId) {
        return res.status(400).json({ error: "This email is already associated with another account." });
      }
      selectedEmail = cleanUni;
    } else {
      return res.status(400).json({ error: "Invalid choice. Use 'apple' or 'university'." });
    }

    await UserService.updateUser({ id: userId, profileEmail: selectedEmail });

    const updated = await UserService.findById(userId);
    res.json({ success: true, user: updated });
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// Track study minutes spent in app
app.post("/api/auth/track-time", requireUser, catchAsync(async (req, res) => {
  try {
    const { userId, minutes = 1 } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });

    const authUser = (req as any).user;
    if (authUser.id !== userId && authUser.role !== "admin" && authUser.role !== "owner") {
      return res.status(403).json({ error: "Access denied. You can only track study time for your own profile." });
    }

    const minutesNum = Number(minutes);
    if (isNaN(minutesNum) || !Number.isInteger(minutesNum) || minutesNum <= 0 || minutesNum > 120) {
      return res.status(400).json({ error: "Invalid study minutes value. Must be a positive integer less than or equal to 120." });
    }

    const user = await UserService.findById(userId);
    if (user) {
      const newTime = (user.totalTimeSpent || 0) + minutesNum;
      await UserService.updateUser({
        id: userId,
        totalTimeSpent: newTime,
        lastActive: new Date().toISOString()
      });
      res.json({ success: true, totalTimeSpent: newTime });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// Full state bidirectional sync (merges client databases with server-side nodes)
app.post("/api/auth/sync", requireUser, catchAsync(async (req, res) => {
  try {
    const { userId, user, progress = [], pointsLogs = [], calendarEvents = [] } = req.body;
    if (!userId) return res.status(400).json({ error: "User context ID is required." });
    if (!Array.isArray(progress) || !Array.isArray(pointsLogs) || !Array.isArray(calendarEvents)) {
      return res.status(400).json({ error: "progress, pointsLogs, and calendarEvents must be arrays." });
    }

    const authUser = (req as any).user;
    if (authUser.id !== userId && authUser.role !== "admin" && authUser.role !== "owner") {
      return res.status(403).json({ error: "Access denied. You can only synchronize your own student node." });
    }

    const existing = await UserService.findById(userId);

    if (!existing) {
      return res.status(404).json({ error: "User account not found." });
    } else if (user && typeof user === "object") {
      // Only synchronize editable profile presentation fields. Identity, role,
      // points, level, and streaks are server-authoritative.
      // DEFENSIVE: Only sync avatar if the client sends a non-empty value.
      // An empty string from stale client state must not overwrite a valid avatar.
      await UserService.updateUser({
        id: userId,
        name: user.name,
        avatar: user.avatar || undefined,
        lastActive: new Date().toISOString()
      });
    }

    const prismaClient = getPrisma();
    const ops = [];

    if (pointsLogs.length > 100) {
      return res.status(400).json({ error: "Too many points records in one synchronization request." });
    }

    const suppliedPointIds = pointsLogs
      .map((entry: any) => typeof entry?.id === "string" ? entry.id : "")
      .filter(Boolean);
    const existingPointLogs = suppliedPointIds.length > 0
      ? await prismaClient.pointsLog.findMany({ where: { id: { in: suppliedPointIds } }, select: { id: true, userId: true, points: true, reason: true, createdAt: true } })
      : [];
    const pointById = new Map<string, { userId: string; points: number; reason: string; createdAt: Date }>(
      existingPointLogs.map((entry: any) => [entry.id, entry] as [string, { userId: string; points: number; reason: string; createdAt: Date }])
    );
    for (const pointLog of pointsLogs) {
      const storedPoint = pointLog?.id ? pointById.get(pointLog.id) : undefined;
      if (storedPoint && storedPoint.userId !== userId) {
        return res.status(403).json({ error: "A points record belongs to another account." });
      }
      if (authUser.role !== "admin" && authUser.role !== "owner" &&
          (!storedPoint || Number(pointLog.points) !== storedPoint.points ||
           String(pointLog.reason).trim() !== storedPoint.reason ||
           (pointLog.createdAt && new Date(pointLog.createdAt).getTime() !== storedPoint.createdAt.getTime()))) {
        return res.status(403).json({ error: "Client-created or modified point awards are not accepted." });
      }
    }

    const suppliedEventIds = calendarEvents
      .map((entry: any) => typeof entry?.id === "string" ? entry.id : "")
      .filter(Boolean);
    const existingCalendarEvents = suppliedEventIds.length > 0
      ? await prismaClient.calendarEvent.findMany({ where: { id: { in: suppliedEventIds } }, select: { id: true, userId: true } })
      : [];
    const eventOwnerById = new Map(existingCalendarEvents.map((entry: any) => [entry.id, entry.userId]));
    for (const event of calendarEvents) {
      if (event?.id && eventOwnerById.has(event.id) && eventOwnerById.get(event.id) !== userId) {
        return res.status(403).json({ error: "A calendar event belongs to another account." });
      }
    }

    // Save/Sync Course progress items
    for (const p of progress) {
      const score = Number(p.quizScore || 0);
      const safeScore = (score >= 0 && score <= 100) ? score : 0;
      ops.push(prismaClient.lectureProgress.upsert({
        where: { userId_lectureId: { userId, lectureId: p.lectureId } },
        update: {
          pdfCompleted: !!p.pdfCompleted,
          notesCompleted: !!p.notesCompleted,
          videoCompleted: !!p.videoCompleted,
          flashcardsCompleted: !!p.flashcardsCompleted,
          quizCompleted: !!p.quizCompleted,
          quizScore: safeScore,
          lastAccessed: p.lastAccessed ? new Date(p.lastAccessed) : new Date()
        },
        create: {
          userId,
          lectureId: p.lectureId,
          pdfCompleted: !!p.pdfCompleted,
          notesCompleted: !!p.notesCompleted,
          videoCompleted: !!p.videoCompleted,
          flashcardsCompleted: !!p.flashcardsCompleted,
          quizCompleted: !!p.quizCompleted,
          quizScore: safeScore,
          lastAccessed: p.lastAccessed ? new Date(p.lastAccessed) : new Date()
        }
      }));
    }

    // Save/Sync Points logs
    for (const l of pointsLogs) {
      if (!l || (l.id !== undefined && typeof l.id !== "string")) {
        return res.status(400).json({ error: "Invalid points log identifier." });
      }
      if (typeof l.reason !== "string" || !l.reason.trim() || l.reason.length > 500) {
        return res.status(400).json({ error: "Invalid points log reason." });
      }
      const logPoints = Number(l.points || 0);
      if (authUser.role !== "admin" && authUser.role !== "owner" && (logPoints > 100 || logPoints < -100)) continue;
      if (!Number.isFinite(logPoints) || !Number.isInteger(logPoints)) {
        return res.status(400).json({ error: "Invalid points log value." });
      }
      const createdAt = l.createdAt ? new Date(l.createdAt) : new Date();
      if (Number.isNaN(createdAt.getTime())) {
        return res.status(400).json({ error: "Invalid points log timestamp." });
      }
      const logId = l.id || crypto.randomUUID();
      ops.push(prismaClient.pointsLog.upsert({
        where: { id: logId },
        update: { points: logPoints, reason: l.reason.trim(), createdAt },
        create: { id: logId, userId, points: logPoints, reason: l.reason.trim(), createdAt }
      }));
    }

    // Save/Sync Custom planner events (personal only — never overwrite global/admin events)
    for (const e of calendarEvents) {
      if (!e || typeof e.id !== "string" || !e.id.trim()) {
        return res.status(400).json({ error: "Every calendar event must have a stable identifier." });
      }
      // Skip global/admin events (they have no userId — created via Console by supervisors).
      // Letting a progress sync overwrite these would corrupt schedule dates for all users.
      if (!e.userId && !e.date) continue;

      // Resolve start time: prefer the explicit `date` field set by the client planner.
      // Fall back to the ISO `startDateTime` already stored on server-returned events.
      // Never fall back to new Date() — that would silently reset all dates to today.
      let startDateTime: Date | null = null;
      if (e.date) {
        startDateTime = new Date(`${e.date}T${e.time || "09:00"}:00`);
      } else if (e.startDateTime) {
        startDateTime = new Date(e.startDateTime);
      }
      if (!startDateTime || isNaN(startDateTime.getTime())) continue;

      if (typeof e.title !== "string" || !e.title.trim() || e.title.length > 500) {
        return res.status(400).json({ error: "Invalid calendar event title." });
      }

      const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);
      ops.push(prismaClient.calendarEvent.upsert({
        where: { id: e.id },
        update: { title: e.title.trim(), eventType: (e.type || "other").toUpperCase(), startDateTime, endDateTime, isCompleted: !!e.completed },
        create: { id: e.id, userId, title: e.title.trim(), eventType: (e.type || "other").toUpperCase(), startDateTime, endDateTime, isCompleted: !!e.completed }
      }));
    }

    if (ops.length > 0) {
      await prismaClient.$transaction(ops);
    }

    // Recalculate server-authoritative points
    const agg = await prismaClient.pointsLog.aggregate({
      where: { userId },
      _sum: { points: true }
    });
    const calculatedPoints = agg._sum.points ?? 10;
    
    // Update user point totals definitively
    await prismaClient.user.update({
      where: { id: userId },
      data: { totalPoints: calculatedPoints }
    });

    // Compile refreshed database aggregates
    const syncData = await UserService.getFullUserData(userId);
    const mDb = await readMaterialsDb();

    // Fetch global calendar events from Prisma
    const globalEvents = await prismaClient.calendarEvent.findMany({
      take: 2000,
      where: { userId: null },
      orderBy: { startDateTime: "asc" }
    });
    const visibleGlobalEvents = (authUser.role === "admin" || authUser.role === "owner")
      ? globalEvents
      : globalEvents.filter(event => eventVisibleToGroup(event.targetGroups, authUser.studentGroup));

    res.json({
      ...syncData,
      calendarEvents: syncData.calendarEvents,
      globalCalendarEvents: visibleGlobalEvents.map(event => ({
        ...event,
        targetGroups: parseTargetGroups(event.targetGroups)
      })),
      globalMaterials: {
        subjects: mDb.subjects,
        mcqs: mDb.mcqs,
        flashcards: mDb.flashcards,
        videos: mDb.videos
      }
    });
  } catch (error) {
    console.error("Sync fault:", error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// Offline-First Conflict Resolution and Reconciliation Endpoint
app.post("/api/offline/reconcile", requireUser, catchAsync(async (req, res) => {
  try {
    const { items = [] } = req.body;
    if (!Array.isArray(items) || items.length > 500) {
      return res.status(400).json({ error: "items must be an array containing at most 500 records." });
    }
    const prismaClient = getPrisma();
        
    const authUser = (req as any).user;
    const allowedTypes = new Set(["lecture_progress", "mcq_score", "flashcard_sr"]);
    for (const item of items) {
      if (!item || item.userId !== authUser.id || !allowedTypes.has(item.type) || typeof item.targetId !== "string" || !item.targetId.trim()) {
        return res.status(403).json({ error: "Offline records must belong to the authenticated account and use a supported type." });
      }
      if (typeof item.lastUpdated !== "string" || Number.isNaN(new Date(item.lastUpdated).getTime())) {
        return res.status(400).json({ error: "Offline record timestamp is invalid." });
      }
    }

    const resolved: any[] = [];
    const ops: any[] = [];

    // Optimisation: Batch-fetch existing lectureProgress records
    const lectureIdsToFetch = Array.from(new Set(
      items
        .filter((item: any) => (item.type === 'lecture_progress' || item.type === 'mcq_score') && item.userId === authUser.id)
        .map((item: any) => item.targetId)
    )).filter(Boolean) as string[];

    const existingProgs = lectureIdsToFetch.length > 0
      ? await prismaClient.lectureProgress.findMany({
          where: {
            userId: authUser.id,
            lectureId: { in: lectureIdsToFetch }
          }
        })
      : [];

    const progMap = new Map<string, any>();
    existingProgs.forEach((p: any) => {
      progMap.set(p.lectureId, p);
    });

    // Optimisation: Batch-fetch existing flashcardProgress records
    const flashcardIdsToFetch = Array.from(new Set(
      items
        .filter((item: any) => item.type === 'flashcard_sr' && item.userId === authUser.id)
        .map((item: any) => item.targetId)
    )).filter(Boolean) as string[];

    const existingSRs = flashcardIdsToFetch.length > 0
      ? await prismaClient.flashcardProgress.findMany({
          where: {
            userId: authUser.id,
            flashcardId: { in: flashcardIdsToFetch }
          }
        })
      : [];

    const srMap = new Map<string, any>();
    existingSRs.forEach((sr: any) => {
      srMap.set(sr.flashcardId, sr);
    });

    for (const item of items) {
      const { userId, type, targetId, payload, lastUpdated } = item;
      
      const clientTime = new Date(lastUpdated).getTime();

      if (type === 'lecture_progress' || type === 'mcq_score') {
        const lectureId = targetId;
        const existingProg = progMap.get(lectureId);
        const serverTime = existingProg ? new Date(existingProg.lastAccessed).getTime() : 0;

        if (existingProg && serverTime > clientTime) {
          // Server wins - return server's latest version
          resolved.push({
            id: item.id,
            userId,
            type,
            targetId,
            payload: {
              pdfCompleted: existingProg.pdfCompleted,
              notesCompleted: existingProg.notesCompleted,
              videoCompleted: existingProg.videoCompleted,
              flashcardsCompleted: existingProg.flashcardsCompleted,
              quizCompleted: existingProg.quizCompleted,
              quizScore: existingProg.quizScore || 0,
              lastAccessed: existingProg.lastAccessed.toISOString()
            },
            lastUpdated: existingProg.lastAccessed.toISOString(),
            synced: 1
          });
        } else {
          // Client wins (or no server record) - save client state to server SQL DB
          const rawScore = type === 'mcq_score' ? payload.score : (payload.quizScore || 0);
          const scoreNum = Number(rawScore);
          const quizScore = (scoreNum >= 0 && scoreNum <= 100) ? scoreNum : 0;
          const quizCompleted = type === 'mcq_score' ? true : !!payload.quizCompleted;

          const lastAccessedDate = lastUpdated ? new Date(lastUpdated) : new Date();

          ops.push(prismaClient.lectureProgress.upsert({
            where: { userId_lectureId: { userId, lectureId } },
            update: {
              pdfCompleted: !!payload.pdfCompleted,
              notesCompleted: !!payload.notesCompleted,
              videoCompleted: !!payload.videoCompleted,
              flashcardsCompleted: !!payload.flashcardsCompleted,
              quizCompleted,
              quizScore,
              lastAccessed: lastAccessedDate
            },
            create: {
              userId,
              lectureId,
              pdfCompleted: !!payload.pdfCompleted,
              notesCompleted: !!payload.notesCompleted,
              videoCompleted: !!payload.videoCompleted,
              flashcardsCompleted: !!payload.flashcardsCompleted,
              quizCompleted,
              quizScore,
              lastAccessed: lastAccessedDate
            }
          }));

          resolved.push({
            ...item,
            synced: 1
          });
        }
      } else if (type === 'flashcard_sr') {
        const cardId = targetId;
        const existingSR = srMap.get(cardId);
        const serverTime = existingSR ? new Date(existingSR.updatedAt).getTime() : 0;

        if (existingSR && serverTime > clientTime) {
          // Server wins - return server's version
          resolved.push({
            id: item.id,
            userId,
            type,
            targetId,
            payload: { status: existingSR.status },
            lastUpdated: existingSR.updatedAt.toISOString(),
            synced: 1
          });
        } else {
          // Client wins - update server SQL state
          const updatedAtDate = lastUpdated ? new Date(lastUpdated) : new Date();
          const newStatus = payload.status || "medium";

          ops.push(prismaClient.flashcardProgress.upsert({
            where: { userId_flashcardId: { userId, flashcardId: cardId } },
            update: { status: newStatus, updatedAt: updatedAtDate },
            create: { userId, flashcardId: cardId, status: newStatus, updatedAt: updatedAtDate }
          }));

          resolved.push({
            ...item,
            synced: 1
          });
        }
      } else {
        return res.status(400).json({ error: "Unsupported offline mutation type." });
      }
    }

    if (ops.length > 0) {
      await prismaClient.$transaction(ops);
    }

    res.json({ success: true, resolved });
  } catch (error: any) {
    console.error('[Offline Reconcile Error]:', error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// Material Progress persistent API paths
app.post("/api/progress/view", requireUser, catchAsync(async (req, res) => {
  try {
    const { userId, materialId } = req.body;
    if (!userId || !materialId) {
      return res.status(400).json({ error: "userId and materialId are required." });
    }

    const authUser = (req as any).user;
    if (userId !== authUser.id && authUser.role !== "admin" && authUser.role !== "owner") {
      return res.status(403).json({ error: "Access denied. You can only record viewing progress for yourself." });
    }

    const client = getPrisma();
    const materialExists = await client.material.findUnique({ where: { id: materialId } });
    if (!materialExists) {
      return res.json({ success: true, progress: { userId, materialId, hasViewed: true, isCompleted: false } });
    }
    const progress = await client.userProgress.upsert({
      where: {
        userId_materialId: {
          userId,
          materialId
        }
      },
      update: {
        hasViewed: true
      },
      create: {
        userId,
        materialId,
        hasViewed: true,
        isCompleted: false
      }
    });
    res.json({ success: true, progress });
  } catch (error) {
    console.error("Error setting material progress to viewed:", error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

app.post("/api/progress/complete", requireUser, catchAsync(async (req, res) => {
  try {
    const { userId, materialId } = req.body;
    if (!userId || !materialId) {
      return res.status(400).json({ error: "userId and materialId are required." });
    }

    const authUser = (req as any).user;
    if (userId !== authUser.id && authUser.role !== "admin" && authUser.role !== "owner") {
      return res.status(403).json({ error: "Access denied. You can only record completion progress for yourself." });
    }

    const client = getPrisma();
    const materialExists = await client.material.findUnique({ where: { id: materialId } });
    if (!materialExists) {
      return res.json({ success: true, progress: { userId, materialId, hasViewed: true, isCompleted: true } });
    }
    const progress = await client.userProgress.upsert({
      where: {
        userId_materialId: {
          userId,
          materialId
        }
      },
      update: {
        isCompleted: true
      },
      create: {
        userId,
        materialId,
        hasViewed: true,
        isCompleted: true
      }
    });
    res.json({ success: true, progress });
  } catch (error) {
    console.error("Error setting material progress to completed:", error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

app.get("/api/progress/:userId/:materialId", requireUser, catchAsync(async (req, res) => {
  try {
    const { userId, materialId } = req.params;
    if (!userId || !materialId) {
      return res.status(400).json({ error: "userId and materialId are required params." });
    }

    const authUser = (req as any).user;
    if (userId !== authUser.id && authUser.role !== "admin" && authUser.role !== "owner") {
      return res.status(403).json({ error: "Access denied. You can only view your own material progress." });
    }

    const client = getPrisma();
    const progress = await client.userProgress.findUnique({
      where: {
        userId_materialId: {
          userId,
          materialId
        }
      }
    });
    if (!progress) {
      return res.json({ hasViewed: false, isCompleted: false });
    }
    res.json({
      hasViewed: !!progress.hasViewed,
      isCompleted: !!progress.isCompleted
    });
  } catch (error) {
    console.error("Error fetching material progress status:", error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// --- Roster Administration APIS ---

// GET full list of all students for the admin roster panel (excluding sensitive fields)
app.get("/api/roster", requireOwner, catchAsync(async (req, res) => {
  try {
    const list = await UserService.listAllUsers();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// ADD (Invite) student account directly via Admin roster panel
app.post("/api/roster/add", requireOwner, catchAsync(async (req, res) => {
  try {
    const { name, email, password, isAdmin, avatarUrl, avatar } = req.body;
    if (!email || !name) {
      return res.status(400).json({ error: "Email and name are required." });
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!validateEmail(cleanEmail)) {
      return res.status(400).json({ error: "Invalid academic email format." });
    }

    if (typeof password !== "string" || !password) {
      return res.status(400).json({ error: "A password is required when creating an account." });
    }
    const resolvedPassword = password;
    if (resolvedPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters long." });
    }

    const existing = await UserService.findByEmail(cleanEmail);
    if (existing) {
      return res.status(400).json({ error: "Email is already registered." });
    }

    // Register securely using AuthService (hashes password via bcryptjs)
    const freshUser = await AuthService.registerUser({
      email: cleanEmail,
      password: resolvedPassword,
      name,
      role: isAdmin ? "admin" : "user"
    });

    const finalAvatar = avatarUrl || avatar || "";
    if (finalAvatar) {
      await UserService.updateUser({ id: freshUser.id, avatar: finalAvatar });
      freshUser.avatar = finalAvatar;
    }

    io.to("admins").emit("roster_updated");
    res.json({
      success: true,
      user: {
        id: freshUser.id,
        name: freshUser.name,
        email: freshUser.email,
        avatar: freshUser.avatar,
        isAdmin: freshUser.role === "admin",
        role: freshUser.role,
        createdAt: freshUser.created_at
      }
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Failed to add student to database." });
  }
}));

// DELETE student account directly
app.post("/api/roster/delete", requireOwner, catchAsync(async (req, res) => {
  try {
    const { userIdToDelete } = req.body;
    if (!userIdToDelete) return res.status(400).json({ error: "ID is required." });
    const user = await UserService.findById(userIdToDelete);
    if (user?.role === "owner") {
      auditLog(req, "DELETE_USER", userIdToDelete, "Denied - Owner Protection");
      return res.status(403).json({ error: "Forbidden: Owner accounts cannot be deleted." });
    }
    const deleted = await UserService.deleteUser(userIdToDelete);
    if (deleted) {
      await removeDeviceTokensForUser(userIdToDelete);
      await refreshUserSocketAuthorization(userIdToDelete);
      io.to("admins").emit("roster_updated");
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "User record doesn't exist." });
    }
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// TOGGLE Admin role for a student. Database roles are the only authority.
app.post("/api/roster/toggle-admin", requireOwner, catchAsync(async (req, res) => {
  try {
    const { userIdToToggle } = req.body;
    if (!userIdToToggle) return res.status(400).json({ error: "ID is required." });

    // Prevent any owner from changing their own role
    const caller = (req as any).user;
    if (caller?.id === userIdToToggle) {
      auditLog(req, "TOGGLE_ADMIN", userIdToToggle, "Denied - Self-role change not allowed");
      return res.status(403).json({ error: "Forbidden: You cannot change your own role." });
    }

    const targetUser = await UserService.findById(userIdToToggle);
    if (!targetUser) return res.status(404).json({ error: "Record not found." });

    if (!canManageUserRole(caller, targetUser, targetUser.role === "admin" ? "user" : "admin")) {
      auditLog(req, "TOGGLE_ADMIN", userIdToToggle, "Denied - Primary Owner hierarchy protection");
      return res.status(403).json({ error: "Forbidden: This account's role cannot be modified by this owner." });
    }

    const nextRole = targetUser.role === "admin" ? "user" : "admin";
      await UserService.updateUser({ id: userIdToToggle, role: nextRole });
      invalidateAuthenticatedUser(userIdToToggle);
      await refreshUserSocketAuthorization(userIdToToggle);
    io.to("admins").emit("roster_updated");
    res.json({ success: true, isAdmin: nextRole === "admin" });
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// TOGGLE Ban code for users instantly terminating session
app.post("/api/roster/toggle-ban", requireOwner, catchAsync(async (req, res) => {
  try {
    const { userIdToToggle } = req.body;
    if (!userIdToToggle) return res.status(400).json({ error: "ID is required." });

    const user = await UserService.findById(userIdToToggle);
    if (user?.role === "owner") {
      auditLog(req, "TOGGLE_BAN", userIdToToggle, "Denied - Owner Protection");
      return res.status(403).json({ error: "Forbidden: Owner accounts cannot be banned." });
    }
    if (user) {
      const currentStatus = user.accountStatus || "active";
      const nextStatus = currentStatus === "banned" ? "active" : "banned";
      await UserService.updateUser({ id: userIdToToggle, accountStatus: nextStatus });
      invalidateAuthenticatedUser(userIdToToggle);
      await refreshUserSocketAuthorization(userIdToToggle);
      res.json({ success: true, accountStatus: nextStatus });
    } else {
      res.status(404).json({ error: "Record not found." });
    }
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// PATCH role update API — database role is the only authority.
app.patch("/api/users/role", requireOwner, catchAsync(async (req, res) => {
  try {
    const { userId, role } = req.body;
    if (!userId || !role) {
      return res.status(400).json({ error: "userId and role are required." });
    }

    // The existing database stores students as "user". Accept the public
    // "student" name without introducing a second persisted role value.
    const normalizedRole = role === "student" ? "user" : role;
    if (normalizedRole !== "user" && normalizedRole !== "admin" && normalizedRole !== "owner") {
      return res.status(400).json({ error: "Invalid role value. Must be 'student', 'admin', or 'owner'." });
    }

    const caller = (req as any).user;

    // Prevent any caller from changing their own role
    if (caller?.id === userId) {
      return res.status(403).json({ error: "Forbidden: You cannot change your own role." });
    }

    const targetUser = await UserService.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: "Target user not found." });
    }

    if (!canManageUserRole(caller, targetUser, normalizedRole)) {
      return res.status(403).json({
        error: targetUser.isPrimaryOwner === true
          ? "Forbidden: The Primary Owner is protected from role changes."
          : "Forbidden: Only the Primary Owner can manage owner accounts or grant the owner role."
      });
    }

    await UserService.updateUser({ id: userId, role: normalizedRole });
    invalidateAuthenticatedUser(userId);
    await refreshUserSocketAuthorization(userId);
    io.to("admins").emit("roster_updated");
    res.json({ success: true, userId, role: normalizedRole });
  } catch (err: any) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}));



// --- DAILY MOTTO ROUTES ---
app.get("/api/mottos/active", requireUser, catchAsync(async (req, res) => {
  try {
    const mottos = await prisma.dailyMotto.findMany({
      take: 100,
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
    });
    res.json({ mottos });
  } catch (error) {
    console.error("Fetch active mottos error:", error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

app.get("/api/mottos", requireOwner, catchAsync(async (req, res) => {
  try {
    const mottos = await prisma.dailyMotto.findMany({
      take: 100,
      orderBy: { createdAt: "desc" },
    });
    res.json({ mottos });
  } catch (error) {
    console.error("Fetch mottos error:", error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

app.post("/api/mottos", requireOwner, catchAsync(async (req, res) => {
  try {
    const { message, isActive } = req.body;
    const motto = await prisma.dailyMotto.create({
      data: { message, isActive: isActive ?? true, createdBy: (req as any).user?.id },
    });
    await syncContentUpsert("DailyMotto", toDailyMottoContentRow(motto));
    io.to("authenticated").emit("motto_updated");
    res.status(201).json({ motto });
  } catch (error) {
    console.error("Create motto error:", error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

app.patch("/api/mottos/:id", requireOwner, catchAsync(async (req, res) => {
  try {
    const { message, isActive } = req.body;
    const motto = await prisma.dailyMotto.update({
      where: { id: req.params.id },
      data: { message, isActive },
    });
    await syncContentUpsert("DailyMotto", toDailyMottoContentRow(motto));
    io.to("authenticated").emit("motto_updated");
    res.json({ motto });
  } catch (error) {
    console.error("Update motto error:", error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

app.delete("/api/mottos/:id", requireOwner, catchAsync(async (req, res) => {
  try {
    await prisma.dailyMotto.delete({ where: { id: req.params.id } });
    await syncContentDelete("DailyMotto", req.params.id);
    io.to("authenticated").emit("motto_updated");
    res.json({ success: true });
  } catch (error) {
    console.error("Delete motto error:", error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// --- Simpler Academic Upload APIS ---

// ADD standard lecture PDF / Note PDF / quizzes / YouTube links / Flashcards


// Global error handler for safe operations and avoiding server crashes from unhandled db writes
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const userId: string | null = (req as any).user?.id ?? null;
  const sanitizedMessage = err instanceof Error ? err.message.substring(0, 120) : "Unknown error";

  // Classify DB vs generic errors for better observability
  const isDbError =
    sanitizedMessage.toLowerCase().includes("prisma") ||
    sanitizedMessage.toLowerCase().includes("connection") ||
    sanitizedMessage.toLowerCase().includes("query");

  if (isDbError) {
    dbMonitor.logQueryError(err, req.path, userId);
  } else {
    logger.error("HTTP", `Unhandled error on ${req.method} ${req.path}`, {
      userId,
      method: req.method,
      endpoint: req.path,
      statusCode: 500,
      errorCode: err.code ?? "UNHANDLED_ERROR",
      ip: req.ip,
      details: { sanitizedMessage },
    });
  }

  res.status(500).json({ error: "Internal Server Error" });
});



async function verifyDatabaseHealth() {
  try {
    const client = getPrisma();
    await client.user.findFirst();
    logger.info("DATABASE", "Database health check passed");
  } catch (err: any) {
    dbMonitor.logHealthCheckFailed(err);
  }
}

// ── Admin Monitoring Endpoints ────────────────────────────────────────────────

/** GET /api/admin/health — lightweight system health snapshot */
app.get("/api/admin/health", requireOwner, catchAsync(async (req, res) => {
  const memMB = process.memoryUsage();
  const uptimeSec = process.uptime();

  // Quick DB connectivity check
  let dbStatus: "ok" | "error" = "ok";
  try {
    const client = getPrisma();
    await client.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = "error";
  }

  res.json({
    status: dbStatus === "ok" ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    uptime: {
      seconds: Math.floor(uptimeSec),
      human: `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`,
    },
    memory: {
      heapUsedMB: Math.round(memMB.heapUsed / 1_048_576),
      heapTotalMB: Math.round(memMB.heapTotal / 1_048_576),
      rssMB: Math.round(memMB.rss / 1_048_576),
    },
    database: { status: dbStatus },
    nodeVersion: process.version,
  });
}));

/** GET /api/admin/logs — recent structured log entries */
app.get("/api/admin/logs", requireOwner, (req, res) => {
  const limit = Math.min(parseInt((req.query.limit as string) || "100", 10), 500);
  const level = (req.query.level as string | undefined)?.toUpperCase() as any;
  const allowed = ["INFO", "WARNING", "ERROR", "CRITICAL"];

  const entries = getRecentLogs(limit, allowed.includes(level) ? level : undefined);
  res.json({ count: entries.length, entries });
});

/*
 * Database Schema Update Requirement:
 * To support these preferences in a PostgreSQL database, run the following SQL query:
 * 
 * ALTER TABLE "User" 
 * ADD COLUMN preferences JSONB DEFAULT '{"theme": "system", "language": "en", "pushAlerts": true}'::jsonb;
 */
app.patch("/api/user/preferences", requireUser, catchAsync(async (req, res) => {
  try {
    // We expect the auth middleware to attach the user object
    const userId = (req as any).user.id;
    const { theme, language, pushAlerts } = req.body;

    // Validate enum values to prevent arbitrary data injection into the JSONB preferences field
    const ALLOWED_THEMES = ["light", "dark", "system"];
    const ALLOWED_LANGUAGES = ["en", "ar"];
    if (theme !== undefined && !ALLOWED_THEMES.includes(theme)) {
      return res.status(400).json({ error: `Invalid theme. Allowed: ${ALLOWED_THEMES.join(", ")}.` });
    }
    if (language !== undefined && !ALLOWED_LANGUAGES.includes(language)) {
      return res.status(400).json({ error: `Invalid language. Allowed: ${ALLOWED_LANGUAGES.join(", ")}.` });
    }
    if (pushAlerts !== undefined && typeof pushAlerts !== "boolean") {
      return res.status(400).json({ error: "pushAlerts must be a boolean." });
    }

    // Only extract the keys we care about
    const updates = {
      ...(theme !== undefined && { theme }),
      ...(language !== undefined && { language }),
      ...(pushAlerts !== undefined && { pushAlerts })
    };

    const client = getPrisma();

    // Get existing preferences
    const user = await client.user.findUnique({
      where: { id: userId },
      select: { preferences: true }
    });

    let currentPrefs = {};
    if (user?.preferences) {
      try {
        currentPrefs = typeof user.preferences === 'string' ? JSON.parse(user.preferences) : user.preferences;
      } catch (e) {
        logger.warn("[Preferences]", `Malformed preferences JSON for user ${userId.substring(0, 8)} — using empty defaults`);
      }
    }

    const newPrefs = { ...currentPrefs, ...updates };

    await client.user.update({
      where: { id: userId },
      data: {
        preferences: newPrefs
      }
    });

    return res.json({ success: true, message: "Preferences updated securely." });
  } catch (error) {
    console.error("Failed to update preferences:", error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
    return res.status(500).json({ error: "Internal Server Error" });
  }
}));

import os from "os";

// Configure Vite middleware in development or serve production build
async function startServer() {
  const allowedEnvironments = new Set(["development", "test", "production"]);
  if (!process.env.NODE_ENV || !allowedEnvironments.has(process.env.NODE_ENV)) {
    console.error("FATAL ERROR: NODE_ENV must be explicitly set to development, test, or production.");
    process.exit(1);
  }
  if (process.env.NODE_ENV === "production") {
    const missingProductionConfig = [
      ["DATABASE_URL", process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL],
      ["JWT_SECRET", process.env.JWT_SECRET],
      ["APP_URL", process.env.APP_URL],
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missingProductionConfig.length > 0) {
      console.error(`FATAL ERROR: Missing production configuration: ${missingProductionConfig.join(", ")}`);
      process.exit(1);
    }
    const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
    if (dbUrl && !dbUrl.startsWith("postgresql://")) {
      console.error("FATAL ERROR: DATABASE_URL must be a valid PostgreSQL connection string starting with 'postgresql://'");
      process.exit(1);
    }
  }

  // Start DB initialization in the background so it doesn't block the server from listening
  verifyDatabaseHealth().then(() => {
    if (process.env.NODE_ENV === "development" && process.env.INITIALIZE_SYSTEM === "true") {
      return initializeSystem();
    }
    logger.info("[Startup]", "Skipping system initialization; set INITIALIZE_SYSTEM=true for explicit local setup.");
  }).catch((err: unknown) => {
    logger.error("[Startup]", `Database initialization failed: ${err instanceof Error ? err.message : String(err)}`);
  });
  
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server: httpServer },
        watch: {
          ignored: [
            "**/.cache/**",
            "**/.local/**",
            "**/node_modules/**",
            "**/dist/**",
            "**/.git/**",
          ],
        },
      },
      appType: "spa",
    });
    app.use((req, res, next) => {
      if (req.path.startsWith("/uploads/") || req.path.endsWith(".pdf")) {
         return res.status(404).send("404 - PDF / File Not Found (It may have been deleted or the container restarted).");
      }
      next();
    });
    app.use("/api", (req, res) => {
      res.status(404).json({ error: "API endpoint not found" });
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    // Unmatched /api routes must return JSON 404, never SPA HTML.
    app.use("/api", (req, res) => {
      res.status(404).json({ error: "API endpoint not found" });
    });
    // Backend bundles and source maps are runtime artifacts, never public app
    // assets. Deny them even if an old build left them in dist/.
    app.use((req, res, next) => {
      if (req.path === "/server.cjs" || req.path.endsWith(".map")) {
        return res.status(404).send("Not found");
      }
      next();
    });
    app.use(express.static(distPath));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/uploads/") || req.path.endsWith(".pdf")) {
        return res.status(404).send("404 - PDF / File Not Found (It may have been deleted or the container restarted).");
      }
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`\n✅ Server is running! You can now view it in your browser.`);
    
    // Fold legacy ephemeral local files into durable database storage. Runs a
    // few seconds after boot (non-blocking) and only in production.
    if (process.env.NODE_ENV === "production") {
      setTimeout(() => { void migrateLegacyLocalFilesToDb(); }, 3000);
    }
    
    // Dynamically calculate and display Local & Network URLs
    const networkInterfaces = os.networkInterfaces();
    let networkIP = '';
    for (const interfaceName in networkInterfaces) {
      const interfaces = networkInterfaces[interfaceName];
      if (interfaces) {
        for (const iface of interfaces) {
          if (iface.family === 'IPv4' && !iface.internal) {
            networkIP = iface.address;
            break;
          }
        }
      }
      if (networkIP) break;
    }
    
    console.log(`  ➜  Local:   http://localhost:${PORT}/`);
    if (networkIP) {
      console.log(`  ➜  Network: http://${networkIP}:${PORT}/\n`);
    } else {
      console.log(`  ➜  Network: http://${process.env.HOST || "0.0.0.0"}:${PORT}/\n`);
    }
  });
}

startServer();

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Ensures in-flight requests finish, Socket.IO drains, and Prisma disconnects
// cleanly before the process exits. Without this, deploy restarts drop active
// connections and can leave DB connection slots open.
let _isShuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (_isShuttingDown) return;
  _isShuttingDown = true;
  logger.info("[Shutdown]", `${signal} received — starting graceful shutdown`);

  const forceExit = setTimeout(() => {
    logger.error("[Shutdown]", "Graceful shutdown timed out after 10 s — forcing exit");
    process.exit(1);
  }, 10_000);

  try {
    // Stop accepting new HTTP connections
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    // Drain Socket.IO connections
    await new Promise<void>((resolve) => io.close(() => resolve()));
    // Release Prisma connection pool
    await disconnectPrisma();
    clearTimeout(forceExit);
    logger.info("[Shutdown]", "Clean exit");
    process.exit(0);
  } catch (err) {
    clearTimeout(forceExit);
    logger.error("[Shutdown]", `Error during shutdown: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

process.on("SIGTERM", () => { void gracefulShutdown("SIGTERM"); });
process.on("SIGINT",  () => { void gracefulShutdown("SIGINT"); });
