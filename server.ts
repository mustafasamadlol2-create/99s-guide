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
import rateLimit from "express-rate-limit";
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
import { exec } from "child_process";

// ── Monitoring & Logging ──────────────────────────────────────────────────────
import { logger, getRecentLogs } from "./server/services/logger.js";
import { authMonitor } from "./server/services/authMonitor.js";
import { dbMonitor } from "./server/services/dbMonitor.js";
import { requestLogger } from "./server/middleware/requestLogger.js";


// --- Production-Grade In-Memory Caches for read-heavy operations ---
let materialsCache: any | null = null;

function invalidateMaterialsCache() { materialsCache = null; }

const app = express();

const catchAsync = (fn: any) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

app.set("trust proxy", 1);
const PORT = parseInt(process.env.PORT || "5000");
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
  ];
  
  if (process.env.NODE_ENV !== "production") {
    origins.push(
      "http://localhost",
      "http://localhost:5173",
      /^https?:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/, // Allow local IP addresses dynamically (like 192.168.x.x)
      /\.trycloudflare\.com$/, // Allow Cloudflare secure tunnels (used for dev previews)
      /\.replit\.dev$/, // Allow Replit preview domains
      /\.pike\.replit\.dev$/ // Allow Replit pike preview domains
    );
  }

  if (process.env.APP_URL) {
    origins.push(process.env.APP_URL);
    // Add subdomains if needed, or exact URL
    try {
      const url = new URL(process.env.APP_URL);
      origins.push(url.origin);
    } catch (e) {
      // Ignore invalid URL format
    }
  }

  return origins;
};

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
        if (process.env.NODE_ENV !== "production") {
          callback(null, origin);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      }
    },
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Register real-time database-to-socket listeners via UserService
UserService.onCreate = (createdUser) => {
  // Strip sensitive fields before broadcasting — password_hash and reset_token
  // must never travel over the socket to connected clients.
  const { password_hash: _ph, reset_token: _rt, reset_token_expires: _rte, ...safeCreatedUser } = createdUser as any;
  io.emit("userCreated", safeCreatedUser);
  io.emit("userStatusChanged", { email: createdUser.email, isOnline: createdUser.isOnline });
  io.emit("userStatusUpdate", { email: createdUser.email, isOnline: createdUser.isOnline });
};

UserService.onUpdate = (updatedUser) => {
  // Strip sensitive fields before broadcasting.
  const { password_hash: _ph, reset_token: _rt, reset_token_expires: _rte, ...safeUpdatedUser } = updatedUser as any;
  io.emit("userUpdated", safeUpdatedUser);
  io.emit("userStatusChanged", safeUpdatedUser);
  io.emit("userStatusUpdate", safeUpdatedUser);
};

UserService.onDelete = (userId) => {
  io.emit("userDeleted", { id: userId });
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
      // Still return success in development to avoid local blocks, but enforce strictly in prod
      if (process.env.NODE_ENV !== "production") {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
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
    "Pragma"
  ],
  exposedHeaders: ["Content-Range", "X-Content-Range", "Content-Disposition", "Content-Length"]
}));
app.use(cookieParser());

// Prerelease reverse proxy for Prisma Studio running inside the secure sandbox
app.use("/prisma-studio", (req, res) => {
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
  xFrameOptions: false,
}));

// Sanitize user input to prevent XSS
app.use(xss());

app.use(compression());
app.use(express.json({ limit: "20mb" }));

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
  skip: (req, res) => process.env.NODE_ENV !== "production", // Increased limit each IP to 1000 requests per window to avoid arbitrary blocks on normal usage
  standardHeaders: true,
  legacyHeaders: false,
  // validate: false removed — trust proxy is set (app.set("trust proxy", 1)) so
  // express-rate-limit's internal validation passes cleanly without suppression.
  message: { error: "Too many requests from this IP, please try again after 15 minutes." }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // 15 attempts per 15-minute window per IP — tight brute-force protection
  standardHeaders: true,
  legacyHeaders: false,
  // validate: false removed — trust proxy is configured; validation is safe to run.
  message: { error: "Too many authentication attempts from this IP, please try again after 15 minutes." }
});

// Use a wrapper to skip rate-limiting for static streaming and uploads (Safari chunking needs this)
app.use("/api/", (req, res, next) => {
  if (req.path.startsWith('/materials/pdf') || req.path.startsWith('/uploads')) {
    return next();
  }
  return generalLimiter(req, res, next);
});

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/forgot-password", authLimiter);
app.use("/api/auth/reset-password", authLimiter);
app.use("/api/auth/verify-email", authLimiter);
app.use("/api/auth/otp", authLimiter);

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


// ── Pending OAuth sessions (native Capacitor polling mechanism) ──────────────
// Maps a one-time state token → completed session data.
// Populated when /auth/callback/:provider finishes, consumed once by
// GET /api/auth/oauth-session/:token (5-minute TTL).
const pendingOAuthSessions = new Map<string, {
  token: string; userId: string; email: string; expiresAt: number;
}>();
const _pendingOAuthCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingOAuthSessions.entries()) {
    if (val.expiresAt < now) pendingOAuthSessions.delete(key);
  }
}, 10 * 60 * 1000);
if (typeof _pendingOAuthCleanup.unref === "function") _pendingOAuthCleanup.unref();

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

app.use("/uploads", requireUser, express.static(UPLOADS_DIR, {
  dotfiles: "deny",   // never serve hidden files (e.g. .htaccess, .env backups)
  setHeaders: (res, filePath) => {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
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

// Configure multer storage structure
const fileFilter = (req: any, file: any, cb: any) => {
  const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png', 'application/json'];
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, JPEG, PNG, and JSON are allowed.'));
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
    if (file.mimetype === 'application/pdf') ext = '.pdf';
    else if (file.mimetype === 'image/jpeg') ext = '.jpg';
    else if (file.mimetype === 'image/png') ext = '.png';
    else if (file.mimetype === 'application/json') ext = '.json';
    else ext = '.bin';
    cb(null, `${uniqueId}${ext}`);
  }
});


const uploadMaterials = multer({
  storage: materialsStorage,
  limits: { fileSize: 250 * 1024 * 1024 }, // 250 MB — covers large academic PDFs and lecture slides
  fileFilter
});


// Single endpoint /api/upload that receives a file and returns its static state local URL

// Real-Time Socket Presence state storage


io.on("connection", (socket) => {

  // Verify JWT from handshake to establish trusted identity.
  // Clients that pass a valid token are trusted; others get presence-only.
  let verifiedUserId: string | undefined;
  const socketToken = (socket.handshake.auth?.token || socket.handshake.query?.token) as string | undefined;
  if (socketToken) {
    try {
      const payload = jwt.verify(socketToken, JWT_SECRET) as { userId: string };
      if (payload?.userId) verifiedUserId = payload.userId;
    } catch {
      // Invalid / expired token — treat as anonymous presence connection
    }
  }

  // Fall back to the client-claimed userId only when a verified identity is not available.
  // This preserves backward compatibility while preferring the secure path.
  const handshakeUserId = verifiedUserId || ((socket.handshake.query?.userId || socket.handshake.auth?.userId) as string | undefined);

  if (handshakeUserId && handshakeUserId.trim()) {
    socket.data.userId = handshakeUserId;
    socket.data.verified = !!verifiedUserId; // flag whether this userId was JWT-verified
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
        io.emit('userStatusChanged', { email: updatedUser.email, isOnline: true });
        io.emit('userStatusUpdate', { email: updatedUser.email, isOnline: true });

        // Notify other connected clients of presence status update
        const liveOnline = await client.user.findMany({ where: { isOnline: true }, select: { id: true, name: true, email: true, lastActive: true } });
        io.emit("presence-update", liveOnline.map(u => ({
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
    const emailVal = (userData.email || "").trim().toLowerCase();
    if (!emailVal) {
      return;
    }

    const client = getPrisma();
    try {
      // Find matching user by email first or fallback to specified ID to avoid unique key conflicts
      const existingUser = await client.user.findFirst({
        where: {
          OR: [
            { email: emailVal },
            { id: userData.id || userData.userId || "" }
          ].filter(cond => cond.email || cond.id)
        }
      });

      // SECURITY: if this socket has a JWT-verified identity, enforce that the
      // registerUser call can only act on that verified user — prevents a
      // client from sending a different id/email to overwrite another account.
      const clientUserId = existingUser?.id || userData.id || userData.userId || `usr_${Date.now()}`;
      const userId = verifiedUserId ? verifiedUserId : clientUserId;
      if (verifiedUserId && clientUserId !== verifiedUserId) {
        // Log the mismatch but proceed using the verified identity (don't reject;
        // some clients call registerUser immediately after connecting, before
        // the token propagates, so silently correcting is safer than disconnecting).
      }

      // Attach tracking data to the socket instance
      socket.data.userId = userId;
      socket.data.userEmail = emailVal;

      const rawAvatar = userData.avatarUrl || userData.avatar;
      const cleanAvatarVal = (rawAvatar && (rawAvatar.includes("base64-") || rawAvatar.startsWith("data:"))) ? undefined : rawAvatar;

      const u = await client.user.upsert({
        where: { id: userId },
        update: {
          // SECURITY: role, totalPoints, level, levelBadge, streakDays are intentionally
          // excluded — they must only be modified via authenticated HTTP endpoints,
          // never via client-controlled socket payloads (prevents privilege escalation).
          email: emailVal,
          name: userData.name || undefined,
          avatar: cleanAvatarVal || undefined,
          avatarUrl: cleanAvatarVal || undefined,
          isOnline: true,
          lastActive: new Date(),
          lastSeen: new Date(),
          socketId: socket.id,
        },
        create: {
          id: userId,
          email: emailVal,
          passwordHash: "", // Never accept passwordHash from client
          role: "user",    // Always default to least privilege; role is set server-side only
          name: userData.name || emailVal.split("@")[0],
          avatar: userData.avatarUrl || userData.avatar || "",
          avatarUrl: userData.avatarUrl || userData.avatar || "",
          isOnline: true,
          lastActive: new Date(),
          lastSeen: new Date(),
          socketId: socket.id,
          totalPoints: 0,
          level: "Rising (Resident) 🔬",
          levelBadge: "Lvl 1",
          streakDays: 0,
          totalTimeSpent: 0,
          createdAt: new Date()
        }
      });


      // Immediately use io.emit('userStatusChanged' / 'userStatusUpdate') to broadcast this change to ALL connected clients.
      io.emit('userStatusChanged', { email: u.email, isOnline: true });
      io.emit('userStatusUpdate', { email: u.email, isOnline: true });

      // Join the user's group room for targeted announcement broadcasts
      if (u.studentGroup) {
        socket.join("group:" + u.studentGroup);
      }

      // Legacy fallback memory update helper if needed
      try {
        await UserService.updateUser({ id: u.id, isOnline: true });
      } catch (err) {
        logger.error("[Socket registerUser]", `UserService sync failed for ${u.id.substring(0, 8)}: ${err instanceof Error ? err.message.substring(0, 50) : 'Unknown'}`);
      }

      // Emit update lists query directly and physically from the database
      const liveOnline = await client.user.findMany({ where: { isOnline: true }, select: { id: true, name: true, email: true, lastActive: true } });
      io.emit("presence-update", liveOnline.map(onlineUser => ({
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
        io.emit('userStatusChanged', { email: email, isOnline: false });
        io.emit('userStatusUpdate', { email: email, isOnline: false });
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
      io.emit("presence-update", liveOnline.map(onlineUser => ({
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
    
    if (!parsed.subjects) parsed.subjects = seedSubjects;
    if (!parsed.mcqs) parsed.mcqs = seedMcqs;
    if (!parsed.flashcards) parsed.flashcards = seedFlashcards;
    if (!parsed.videos) parsed.videos = seedVideos;
    if (!parsed.calendarEvents) parsed.calendarEvents = [];
    
    return parsed;
  } catch (e) {
    // Bootstrap fresh catalog seeds
    const freshCatalog = {
      subjects: seedSubjects,
      mcqs: seedMcqs,
      flashcards: seedFlashcards,
      videos: seedVideos,
      calendarEvents: []
    };
    await writeMaterialsDb(freshCatalog);
    return freshCatalog;
  }
}

// Helper to write back catalog materials
async function writeMaterialsDb(data: any) {
  await fs.writeFile(MATERIALS_DB_PATH, JSON.stringify(data, null, 2), "utf-8");
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


    // Ensure main administrator exists securely in databases
    const adminEmail = "ss70eng1@gmail.com";
    const existingAdmin = await UserService.findByEmail(adminEmail);
    if (!existingAdmin) {
      // Use ADMIN_INITIAL_PASSWORD env var; fall back to a random secret that
      // forces the owner to use the password-reset flow on first login.
      const initialAdminPassword = process.env.ADMIN_INITIAL_PASSWORD || crypto.randomBytes(20).toString("hex");
      const password_hash = await AuthService.hashPassword(initialAdminPassword);
      await UserService.createUser({
        id: "admin_ss70",
        email: adminEmail,
        password_hash,
        role: "owner",
        name: "Academic Board Owner",
        avatar: "",
        totalPoints: 1500,
        level: "Grand Master 👑",
        levelBadge: "👑",
        streakDays: 30,
        totalTimeSpent: 120,
        lastActive: new Date().toISOString()
      });
    } else {
      // Re-assert owner role in database if email matches
      if (existingAdmin.role !== "owner") {
        await UserService.updateUser({ id: existingAdmin.id, role: "owner" });
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
        isOnline: u.isOnline,
        lastSeen: u.lastSeen,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
        studentGroup: u.studentGroup,
        accountStatus: u.accountStatus,
      }));
      return res.json(formatted);
    } catch (prismaErr) {
    }

    // 2. Fallback to Local Sandbox Memory JSON database
    const list = await UserService.listAllUsers();
    const isPrivileged = (req as any).user?.role === 'admin' || (req as any).user?.role === 'owner';
    const formatted = list.map(u => ({
      ...u,
      email: (isPrivileged || u.id === (req as any).user?.id) ? u.email : undefined,
      avatarUrl: u.avatarUrl || u.avatar || ""
    }));
    res.json(formatted);
  } catch (err: any) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}));





// 2. Content/Lectures CRUD Endpoints (/api/content)
// Content/Lectures support fields: title, youtubeUrl (string), pdfUrl (local URL from multer)
app.get("/api/content", requireUser, catchAsync(async (req, res) => {
  try {
    const db = await readMaterialsDb();
    if (!db.content) {
      // Bootstrap dynamic content from existing subjects
      const flat: any[] = [];
      if (db.subjects) {
        db.subjects.forEach((s: any) => {
          if (s.modules) {
            s.modules.forEach((m: any) => {
              if (m.lectures) {
                m.lectures.forEach((l: any) => {
                  flat.push({
                    id: l.id,
                    title: l.title,
                    youtubeUrl: l.youtubeUrl || "",
                    pdfUrl: l.pdfUrl || "",
                    notesPdfUrl: l.notesPdfUrl || "",
                    doctorName: l.doctorName || "",
                    description: l.description || ""
                  });
                });
              }
            });
          }
        });
      }
      db.content = flat;
      await writeMaterialsDb(db);
      invalidateMaterialsCache();
    }
    res.json(db.content);
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

  // If it's already an external HTTP link (and not localhost), return it directly
  if (cleanedUrl.startsWith("http")) return cleanedUrl;

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
    const contentList = db.content || [];
    const lecture = contentList.find((c: any) => c.id === req.params.id);
    
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
    const targetLectureId = lectureId || "all";

    if (!textFront || !textBack) {
      return res.status(400).json({ error: "Front text (clinicalConcept) and back text (explanation) are required." });
    }

    const cardId = `card_${Date.now()}`;

    // --- 1. Write to JSON DB for backward rendering compat ---
    const db = await readMaterialsDb();
    const newJsonCard = {
      id: cardId,
      lectureId: targetLectureId,
      front: textFront,
      back: textBack,
      frontText: textFront,
      backText: textBack,
      clinicalConcept: textFront,
      explanation: textBack
    };
    db.flashcards.push(newJsonCard);
    await writeMaterialsDb(db);
    invalidateMaterialsCache();

    // --- 2. Write to database (Prisma) for unified clinical view ---
    let createdInSql = false;
    let sqlCard = null;

    if (targetLectureId && targetLectureId !== "all") {
      const prismaClient = getPrisma();
      
      const lectureExists = await prismaClient.lecture.findUnique({
        where: { id: targetLectureId }
      });

      if (lectureExists) {
        sqlCard = await prismaClient.flashcard.create({
          data: {
            id: cardId,
            clinicalConcept: textFront,
            explanation: textBack,
            lectureId: targetLectureId
          }
        });
        createdInSql = true;
      }
    }

    io.emit("materials_updated");
    res.status(201).json({
      success: true,
      card: newJsonCard,
      createdInSql,
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
    const prismaClient = getPrisma();
    const lectures = await prismaClient.lecture.findMany({
      include: { materials: true, mcqs: true, flashcards: true },
      orderBy: { createdAt: "desc" }
    });
    res.json(lectures);
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

app.post("/api/lectures", requireAdmin, catchAsync(async (req, res) => {
  try {
    const { id, name, mainSubject, subSubject, trackMode, department } = req.body;

    if (!name || !mainSubject || !trackMode) {
      return res.status(400).json({ error: "Missing required fields: name, mainSubject, trackMode are required." });
    }

    const prismaClient = getPrisma();

    const lecture = await prismaClient.lecture.create({
      data: {
        id: id || undefined,
        name,
        mainSubject,
        subSubject: subSubject || null,
        trackMode,
        department: department || null,
      }
    });

    invalidateMaterialsCache();
    io.emit("lecture_created", lecture);
    res.status(201).json(lecture);
  } catch (err: any) {
    console.error("[Post Lecture Error]:", err instanceof Error ? err.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

app.get("/api/lectures/:id", requireUser, catchAsync(async (req, res) => {
  try {
    const prismaClient = getPrisma();
    const lecture = await prismaClient.lecture.findUnique({
      where: { id: req.params.id },
      include: { materials: true, mcqs: true, flashcards: true }
    });
    if (!lecture) return res.status(404).json({ error: "Lecture not found" });
    res.json(lecture);
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

app.delete("/api/lectures/:id", requireAdmin, catchAsync(async (req, res) => {
  try {
    const lectureId = req.params.id;
    const prismaClient = getPrisma();
    
    const materials = await prismaClient.material.findMany({
      where: { lectureId }
    });
    
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
    
    invalidateMaterialsCache();
    io.emit("lecture_deleted", { lectureId });
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
    }
    
    invalidateMaterialsCache();
    io.emit("materials_updated");
    res.json({ success: true });
  } catch (err: any) {
    console.error("[Delete Material Error]:", err instanceof Error ? err.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// 2. Material Routes
app.post("/api/materials/upload", requireAdmin, (req: any, res: any, next: any) => {
  // Run multer and surface errors as structured JSON instead of crashing.
  uploadMaterials.single("file")(req, res, (err: any) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "File too large. Maximum allowed size is 250 MB." });
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
    let isFoundInPrisma = false;
    let lectureExists = null;

    try {
      lectureExists = await prismaClient.lecture.findUnique({
        where: { id: lectureId }
      });
      if (lectureExists) {
        isFoundInPrisma = true;
      }
    } catch (dbErr) {
      console.warn("Prisma lookup failed, falling back to JSON check:", dbErr);
    }

    // Check pre-seeded/JSON academic database
    const db = await readMaterialsDb();
    let isFoundInJson = false;
    let foundSubjectIdx = -1, foundModuleIdx = -1, foundLectureIdx = -1;

    for (let sIdx = 0; sIdx < db.subjects.length; sIdx++) {
      for (let mIdx = 0; mIdx < db.subjects[sIdx].modules.length; mIdx++) {
        const lecs = db.subjects[sIdx].modules[mIdx].lectures;
        for (let lIdx = 0; lIdx < lecs.length; lIdx++) {
          if (lecs[lIdx].id === lectureId) {
            isFoundInJson = true;
            foundSubjectIdx = sIdx;
            foundModuleIdx = mIdx;
            foundLectureIdx = lIdx;
            break;
          }
        }
        if (isFoundInJson) break;
      }
      if (isFoundInJson) break;
    }

    if (!isFoundInPrisma && !isFoundInJson) {
      // Cleanup file
      if (req.file && req.file.path) {
        try { await fs.unlink(req.file.path); } catch (e) {}
      }
      return res.status(404).json({ error: `Lecture with reference target ID '${lectureId}' could not be resolved in the database.` });
    }

    const uniqueId = crypto.randomUUID();
    // Always use the API endpoint so the PDF is fetched from the database (where it persists)
    const fileUrlOrLink = `/api/materials/pdf/${uniqueId}`;

    // Read the file data into a buffer so we can store it in the database
    let fileBuffer: Buffer | null = null;
    if (req.file && req.file.path) {
      try {
        fileBuffer = await fs.readFile(req.file.path);
      } catch (e) {
        console.warn("Failed to read file buffer for DB storage:", e);
      }
    }

    // Update JSON database if applicable
    if (isFoundInJson) {
      const matchedLec = db.subjects[foundSubjectIdx].modules[foundModuleIdx].lectures[foundLectureIdx];
      if (type === 'PDF') {
        matchedLec.pdfUrl = fileUrlOrLink;
      } else if (type === 'NOTE') {
        matchedLec.notesPdfUrl = fileUrlOrLink;
      }
      await writeMaterialsDb(db);
      invalidateMaterialsCache();
    }

    // Attempt to store record in Prisma
    let material = null;
    if (isFoundInPrisma) {
      material = await prismaClient.material.create({
        data: {
          id: uniqueId,
          title,
          type,
          fileUrlOrLink,
          fileData: fileBuffer, // Added back to prevent file loss on container restarts
          lectureId
        }
      });
      invalidateMaterialsCache();
    }

    io.emit("materials_updated");
    res.status(201).json({ id: uniqueId, title, type, fileUrlOrLink, lectureId, material });
  } catch (err: any) {
    console.error("[Upload Material Error]:", err);
    if (req.file && req.file.path) {
      try { await fs.unlink(req.file.path); } catch (e) {}
    }
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

app.post("/api/materials/video", requireAdmin, catchAsync(async (req, res) => {
  try {
    const { title, fileUrlOrLink, type, lectureId } = req.body;
    if (!title || !fileUrlOrLink || !lectureId) {
      return res.status(400).json({ error: "Missing required fields: title, fileUrlOrLink, and lectureId are required." });
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

    invalidateMaterialsCache();
    io.emit("materials_updated");

    res.status(201).json(material);
  } catch (err: any) {
    console.error("[Create Video Material Error]:", err instanceof Error ? err.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));


// Endpoint to serve PDF directly from PostgreSQL
app.get("/api/materials/pdf/:id", requireUser, catchAsync(async (req, res) => {
  try {
    const prismaClient = getPrisma();
    let idToFind = req.params.id;
    // Strip .pdf if it's there
    if (idToFind.endsWith('.pdf')) {
      idToFind = idToFind.slice(0, -4);
    }
    const material = await prismaClient.material.findUnique({
      where: { id: idToFind },
      select: { fileData: true, fileUrlOrLink: true, title: true, type: true, createdAt: true }
    });

    if (!material) {
      return res.status(404).send("PDF not found.");
    }

    // If the binary data is not in the DB, redirect to the stored file URL
    if (!material.fileData) {
      if (material.fileUrlOrLink && material.fileUrlOrLink !== `/api/materials/pdf/${idToFind}`) {
        // Strip any stale localhost/127.0.0.1 origins so the redirect works in production
        let redirectTarget = material.fileUrlOrLink;
        try {
          const parsed = new URL(redirectTarget);
          if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
            redirectTarget = parsed.pathname + parsed.search + parsed.hash;
          }
        } catch (_) { /* already a relative path — keep as-is */ }
        return res.redirect(302, redirectTarget);
      }
      return res.status(404).send("PDF file data unavailable.");
    }

    const fileData = material.fileData;
    const total = fileData.length;

    // Strong caching with ETag and Cache-Control
    const etag = `W/"${total}-${material.createdAt?.getTime() || 0}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year caching

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(material.title) + '.pdf"');
    res.setHeader('Accept-Ranges', 'bytes');

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const partialstart = parts[0];
      const partialend = parts[1];

      const start = parseInt(partialstart, 10);
      const end = partialend ? parseInt(partialend, 10) : total - 1;
      const chunksize = (end - start) + 1;

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', chunksize.toString());
      res.end(fileData.slice(start, end + 1));
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

    invalidateMaterialsCache();
    io.emit("materials_updated");

    res.status(201).json(mcq);
  } catch (err: any) {
    console.error("[Post MCQ Error]:", err instanceof Error ? err.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// -----------------------------------------------------------------------------

// PDF upload endpoint (receives base64 encoded streams)

// GET all academic materials (subjects, mcqs, flashcards, videos) + dynamic rosters
app.get("/api/materials", requireUser, catchAsync(async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-cache");
    if (materialsCache && !req.query.forceRefresh) {
      return res.json(materialsCache);
    }
    const materials = await readMaterialsDb();
    const prismaClient = getPrisma();
    
    // Fetch from relational DB
    const [dbMcqs, dbFlashcards, dbMaterials, dbEvents] = await Promise.all([
      prismaClient.mcq.findMany({ take: 2000 }).catch((e: unknown) => { logger.error("[Catalog]", `MCQ fetch failed: ${e instanceof Error ? e.message.substring(0, 80) : 'Unknown'}`); return []; }),
      prismaClient.flashcard.findMany({ take: 2000 }).catch((e: unknown) => { logger.error("[Catalog]", `Flashcard fetch failed: ${e instanceof Error ? e.message.substring(0, 80) : 'Unknown'}`); return []; }),
      prismaClient.material.findMany({ take: 2000, select: { id: true, title: true, type: true, fileUrlOrLink: true, lectureId: true } }).catch((e: unknown) => { logger.error("[Catalog]", `Material fetch failed: ${e instanceof Error ? e.message.substring(0, 80) : 'Unknown'}`); return []; }),
      prismaClient.calendarEvent.findMany({ take: 2000, where: { userId: null } }).catch((e: unknown) => { logger.error("[Catalog]", `CalendarEvent fetch failed: ${e instanceof Error ? e.message.substring(0, 80) : 'Unknown'}`); return []; })
    ]);

    // Merge logic
    const mergedSubjects = [...(materials.subjects || [])];

    const mergedMcqs = [...(materials.mcqs || [])];
    for (const mcq of dbMcqs) {
      if (!mergedMcqs.some(m => m.id === mcq.id)) {
        mergedMcqs.push({
          ...mcq,
          options: [mcq.optionA, mcq.optionB, mcq.optionC, mcq.optionD].filter(Boolean)
        });
      }
    }

    const mergedFlashcards = [...(materials.flashcards || [])];
    for (const f of dbFlashcards) {
      if (!mergedFlashcards.some(m => m.id === f.id)) {
        mergedFlashcards.push({
          ...f,
          frontText: f.clinicalConcept,
          backText: f.explanation,
          front: f.clinicalConcept,
          back: f.explanation
        });
      }
    }

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
    for (const e of dbEvents) {
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

    materialsCache = {
      subjects: mergedSubjects,
      mcqs: mergedMcqs,
      flashcards: normalizedFlashcards,
      videos: mergedVideos,
      calendarEvents: mergedEvents
    };
    res.json(materialsCache);
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// Robust PostgreSQL-compatible Search Endpoint
app.get("/api/search", requireUser, catchAsync(async (req, res) => {
  try {
    const q = req.query.q as string;
    if (!q || q.trim() === "") {
      return res.json([]);
    }

    const query = q.trim();
    const prismaClient = getPrisma();
    
    // Check if running on postgres to apply mode: 'insensitive'
    // database uses LIKE internally which is already case-insensitive, but throws if mode is provided.
    const isPostgres = process.env.DATABASE_URL?.startsWith("postgres") || process.env.DATABASE_URL?.startsWith("postgresql");
    const modeConfig = isPostgres ? { mode: 'insensitive' as const } : {};

    const keywordFilters = query.split(/\s+/).filter(w => w.length > 0);

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
      const key = `db-${type}-${m.lectureId}`;
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
      const key = `db-mcq-${m.lectureId}`;
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
      const key = `db-flashcard-${f.lectureId}`;
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
    const subjectsSet = new Set(relatedLectures.map(l => l.mainSubject));
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
      io.emit("receiveSystemNotification", savedNotification);
    }

    res.status(201).json(savedNotification);
  } catch (err: any) {
    console.error("Failed to create notification:", err instanceof Error ? err.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

app.post("/api/notifications/register-token", requireUser, catchAsync(async (req, res) => {
  try {
    const { userId, token } = req.body;
    if (!userId || !token) {
      return res.status(400).json({ error: "userId and token are required." });
    }
    
    const tokenDbPath = path.join(process.cwd(), "device_tokens.json");
    let tokens: Record<string, string[]> = {};
    try {
      const content = await fs.readFile(tokenDbPath, "utf-8");
      tokens = JSON.parse(content);
    } catch {}
    
    if (!tokens[userId]) {
      tokens[userId] = [];
    }
    if (!tokens[userId].includes(token)) {
      tokens[userId].push(token);
    }
    await fs.writeFile(tokenDbPath, JSON.stringify(tokens, null, 2), "utf-8");
    
    res.json({ success: true, message: "Token registered successfully." });
  } catch (err: any) {
    console.error("Failed to register device token:", err instanceof Error ? err.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

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
  io.emit("qa_question_created", questionPayload);
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
  io.emit("qa_question_updated", { id: updated.id, content: updated.content, lectureId: question.lectureId });
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

  io.emit("qa_question_deleted", { questionId: id, lectureId: question.lectureId });
  res.json({ success: true });
}));

// POST /api/qa/questions/:id/upvote — toggle upvote on question
app.post("/api/qa/questions/:id/upvote", requireUser, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const { id } = req.params;
  const { delta } = req.body; // +1 or -1

  const d = delta === 1 || delta === -1 ? delta : 1;
  const question = await prismaClient.qaQuestion.findUnique({ where: { id } });
  if (!question || question.isDeleted) return res.status(404).json({ error: "Question not found." });

  const updated = await prismaClient.qaQuestion.update({
    where: { id },
    data: { upvotes: Math.max(0, question.upvotes + d) },
  });
  io.emit("qa_question_updated", { id: updated.id, upvotes: updated.upvotes, lectureId: question.lectureId });
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
  io.emit("qa_answer_created", { ...answerPayload, lectureId: question.lectureId });
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
  io.emit("qa_answer_updated", { id: updated.id, content: updated.content, questionId: answer.questionId });
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

  io.emit("qa_answer_deleted", { answerId: id, questionId: answer.questionId });
  res.json({ success: true });
}));

// POST /api/qa/answers/:id/upvote — toggle upvote on answer
app.post("/api/qa/answers/:id/upvote", requireUser, catchAsync(async (req, res) => {
  const prismaClient = getPrisma();
  const { id } = req.params;
  const { delta } = req.body;

  const d = delta === 1 || delta === -1 ? delta : 1;
  const answer = await prismaClient.qaAnswer.findUnique({ where: { id } });
  if (!answer || answer.isDeleted) return res.status(404).json({ error: "Answer not found." });

  const updated = await prismaClient.qaAnswer.update({
    where: { id },
    data: { upvotes: Math.max(0, answer.upvotes + d) },
  });
  io.emit("qa_answer_updated", { id: updated.id, upvotes: updated.upvotes, questionId: answer.questionId });
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
  io.emit("qa_answer_updated", { id: updated.id, isBest: updated.isBest, questionId: answer.questionId });
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

  if (!reportedUserId || !commentId || !commentType || !commentContent || !reason) {
    return res.status(400).json({ error: "All required fields must be provided." });
  }
  if (!validReasons.includes(reason)) {
    return res.status(400).json({ error: "Invalid reason." });
  }
  if (!validTypes.includes(commentType)) {
    return res.status(400).json({ error: "Invalid comment type." });
  }
  if (reporterId === reportedUserId) {
    return res.status(400).json({ error: "You cannot report your own content." });
  }

  // Verify the reported user exists
  const target = await prismaClient.user.findUnique({ where: { id: reportedUserId } });
  if (!target) return res.status(404).json({ error: "Reported user not found." });

  try {
    const report = await prismaClient.report.create({
      data: {
        reporterId,
        reportedUserId,
        lectureId: lectureId || null,
        commentId,
        commentType,
        commentContent: commentContent.slice(0, 500),
        reason,
        description: description?.trim() || null,
        status: "Pending",
      },
    });
    io.emit("report_created", { id: report.id, status: report.status });
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
  io.emit("reportStatusUpdated", {
    id: updated.id,
    status: updated.status,
    reporterId: report.reporterId,
  });
  io.emit("moderation_history_updated");

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
    include: { reportedUser: { select: { id: true, email: true } } },
  });
  if (!report) return res.status(404).json({ error: "Report not found." });
  if (report.status !== "Pending") return res.status(400).json({ error: "Only pending reports can be approved." });

  // Protect primary owner from penalties
  if (report.reportedUser.email?.toLowerCase().trim() === "ss70eng1@gmail.com") {
    return res.status(403).json({ error: "Forbidden: Primary Academic Owner cannot be penalized." });
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
    io.emit("userMuteUpdate", {
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
    io.emit("userBanNotification", {
      userId: targetUserId,
      reason: reason.trim(),
      isPermanent: !!isPermanent,
      endTime: endTime?.toISOString() || null,
    });
    io.emit("userForcedLogout", { userId: targetUserId });
  }

  // Broadcast report status update
  io.emit("reportStatusUpdated", { id, status: "Approved", reporterId: report.reporterId });
  io.emit("moderation_history_updated");

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

  if (target.email?.toLowerCase().trim() === "ss70eng1@gmail.com") {
    return res.status(403).json({ error: "Forbidden: Primary Academic Owner cannot be banned." });
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
  io.emit("userBanNotification", {
    userId,
    reason: reason.trim(),
    isPermanent: !!isPermanent,
    endTime: endTime?.toISOString() || null,
  });
  io.emit("userForcedLogout", { userId });

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

  io.emit("ban_list_updated");
  io.emit("moderation_history_updated");
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

  if (target.email?.toLowerCase().trim() === "ss70eng1@gmail.com") {
    return res.status(403).json({ error: "Forbidden: Primary Academic Owner cannot be muted." });
  }

  const endTime = isPermanent ? null : new Date(Date.now() + (durationMinutes || 60) * 60 * 1000);

  await prismaClient.userMute.upsert({
    where: { userId },
      create: { userId, reason: reason.trim(), endTime, isPermanent: !!isPermanent, createdBy: adminId },
    update: { reason: reason.trim(), endTime, isPermanent: !!isPermanent },
  });

  // Real-time mute update to the targeted user
  io.emit("userMuteUpdate", {
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

  io.emit("mute_list_updated");
  io.emit("moderation_history_updated");
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
  io.emit("userMuteUpdate", { userId, isMuted: false, isPermanent: false, endTime: null, reason: null });
  io.emit("mute_list_updated");
  io.emit("moderation_history_updated");

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
  io.emit("userMuteUpdate", {
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

  io.emit("mute_list_updated");
  io.emit("moderation_history_updated");
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
  io.emit("userBanRemoved", { userId });

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

  io.emit("ban_list_updated");
  io.emit("moderation_history_updated");
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

  io.emit("ban_list_updated");
  io.emit("moderation_history_updated");
  res.json({ success: true, endTime: updated.endTime?.toISOString() || null, isPermanent: updated.isPermanent });
}));

// Calendar Events Endpoints
app.delete("/api/calendar/events/:id", requireAdmin, catchAsync(async (req, res) => {
  const eventId = req.params.id;
  const prismaClient = getPrisma();

  // Use deleteMany for idempotent delete — returns {count:0} when not found instead of throwing
  const result = await prismaClient.calendarEvent.deleteMany({ where: { id: eventId } });

  if (result.count > 0 && io) {
    io.emit("calendar_updated");
  }

  auditLog(req, "DELETE_CALENDAR_EVENT", eventId, "Success");
  res.json({ success: true, deleted: result.count > 0 });
}));

app.get("/api/calendar/events", requireUser, catchAsync(async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-cache");
    const prismaClient = getPrisma();
    const userId = (req as any).user?.id;
    
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

    const parsedEvents = events.map(event => ({
      ...event,
      targetGroups: typeof event.targetGroups === "string" ? event.targetGroups.split(",").filter(Boolean) : (event.targetGroups || [])
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
      
      const savedNotification = await prismaClient.notification.create({
        data: {
          title: `${badgeTitle} ${title}`,
          message: notificationMessage,
          isSystem: true
        }
      });

      // Broadcast via socket to alert students in real-time
      io.emit("receiveSystemNotification", savedNotification);
      io.emit("calendar_updated");
    } else {
      io.emit("calendar_updated");
    }

    res.status(201).json(parsedSavedEvent);
    invalidateMaterialsCache();
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

    // Broadcast to all connected clients so everyone sees the change instantly
    if (io) {
      io.emit("calendar_updated");
    }

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
function setCookieToken(res: any, userId: string, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "30d" });
  res.cookie("auth_token", token, {
    httpOnly: true,
    secure: true, // Enforce secure for cross-origin over the internet / secure tunnels
    sameSite: "none", // Enforce "none" for cross-origin browser context
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  });
  return token;
}

// Helper to extract JWT token from either cookies or the Authorization header
function getRequestToken(req: express.Request): string | null {
  if (req.cookies && req.cookies.auth_token) {
    return req.cookies.auth_token;
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7).trim();
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

// Middleware to verify if the student has administrative role credentials
async function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const token = getRequestToken(req);
    if (!token) {
      return res.status(401).json({ error: "Access denied. No authenticated academic session." });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string; iat?: number };
    const user = await UserService.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ error: "Access denied. Administrative student account not found." });
    }

    if (user.accountStatus === "banned") {
      return res.status(403).json({ error: "Access denied. Your student account has been suspended/banned." });
    }

    if (user.role !== "admin" && user.role !== "owner") {
      return res.status(403).json({ error: "Access denied. Administrative role required." });
    }

    // Automatic sliding session: refresh if token is more than 24 hours old
    if (decoded.iat) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (nowSeconds - decoded.iat > 24 * 60 * 60) {
        setCookieToken(res, user.id, user.email);
      }
    }

    // Attach user to request context for downstream route handlers
    (req as any).user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Access denied. Verification token has expired or is invalid." });
  }
}

// Middleware to verify if the student has owner role credentials
async function requireOwner(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const token = getRequestToken(req);
    if (!token) {
      return res.status(401).json({ error: "Access denied. No authenticated academic session." });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string; iat?: number };
    const user = await UserService.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ error: "Access denied. Academic owner account not found." });
    }

    if (user.accountStatus === "banned") {
      return res.status(403).json({ error: "Access denied. Your student account has been suspended/banned." });
    }

    if (user.role !== "owner") {
      return res.status(403).json({ error: "Access denied. Platform Owner role required." });
    }

    // Automatic sliding session: refresh if token is more than 24 hours old
    if (decoded.iat) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (nowSeconds - decoded.iat > 24 * 60 * 60) {
        setCookieToken(res, user.id, user.email);
      }
    }

    // Attach user to request context for downstream route handlers
    (req as any).user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Access denied. Verification token has expired or is invalid." });
  }
}

// Middleware to verify if the student has a valid logged-in session (user or admin)
async function requireUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const token = getRequestToken(req);
    if (!token) {
      return res.status(401).json({ error: "Access denied. No authenticated academic session." });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string; iat?: number };
    const user = await UserService.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ error: "Access denied. Student account not found." });
    }

    if (user.accountStatus === "banned") {
      // Auto-restore if timed ban has expired
      const prismaClient = getPrisma();
      const ban = await prismaClient.userBan.findUnique({ where: { userId: user.id } });
      if (ban && !ban.isPermanent && ban.endTime && ban.endTime <= new Date()) {
        await prismaClient.$transaction(async (tx: any) => {
          await tx.userBan.delete({ where: { userId: user.id } });
          await tx.user.update({ where: { id: user.id }, data: { accountStatus: "ACTIVE" } });
        });
        await logModerationAction(prismaClient, { actionType: "BAN_EXPIRED", targetUserId: user.id, isSystemAction: true, metadata: { expiredAt: new Date().toISOString() } });
        // Expired — allow through
      } else {
        return res.status(403).json({
          banned: true,
          error: "Your account has been suspended.",
          reason: ban?.reason || null,
          isPermanent: ban ? ban.isPermanent : true,
          endTime: ban?.endTime?.toISOString() || null,
        });
      }
    }

    // Automatic sliding session: refresh if token is more than 24 hours old
    if (decoded.iat) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (nowSeconds - decoded.iat > 24 * 60 * 60) {
        setCookieToken(res, user.id, user.email);
      }
    }

    // Attach user to request context for downstream route handlers
    (req as any).user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Access denied. Session has expired or is invalid." });
  }
}

// Execute database synchronization and migrations directly from an API call
app.post("/api/admin/db-sync", requireOwner, (req, res) => {
  exec("npx prisma db push && npx prisma generate", (error, stdout, stderr) => {
    if (error) {
      console.error("[DB-Sync] Database sync failed:", error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
      return res.status(500).json({ error: "Internal Server Error" });
    }
    // stdout intentionally omitted from response — it can contain schema details
    // (table names, column definitions) that should not be exposed to clients.
    return res.status(200).json({ message: "Database synced successfully" });
  });
});

// Get the currently authenticated user automatically from the JWT cookie or Authorization header
app.get("/api/auth/me", catchAsync(async (req, res) => {
  try {
    const token = getRequestToken(req);
    if (!token) {
      return res.json({ user: null });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    const user = await UserService.findById(decoded.userId);
    
    if (!user || user.accountStatus === "banned") {
      return res.json({ user: null });
    }

    const fullData = await UserService.getFullUserData(user.id);
    return res.json(fullData);
  } catch (err) {
    return res.json({ user: null });
  }
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
    <p>Apple Sign-In is not available for this portal.<br>
       Use your institutional email or Continue with Google.</p>
    <p class="note">This window will close automatically&hellip;</p>
    <div class="progress"><div class="progress-bar"></div></div>
  </div>
  <script>
    setTimeout(function(){ try{ window.close(); }catch(e){} }, 4500);
  </script>
</body>
</html>`);
});

// ── Consume a pending OAuth session (one-time, for native Capacitor polling) ──
// The frontend polls this after opening the OAuth browser on native platforms
// where window.opener / postMessage is unavailable.
app.get("/api/auth/oauth-session/:token", (req, res) => {
  const { token } = req.params;
  const session = pendingOAuthSessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    pendingOAuthSessions.delete(token);
    return res.status(404).json({ pending: true });
  }
  pendingOAuthSessions.delete(token); // one-time use
  return res.json({ success: true, token: session.token, userId: session.userId, email: session.email });
});

// Generates correct OAuth Authorize URL or offers Sandbox dev mode
app.get("/api/auth/oauth-url", (req, res) => {
  const provider = (req.query.provider as string || "").toLowerCase();

  // Server always computes the redirect URI from its own host.
  // This avoids the capacitor://localhost / https://localhost rejection from Google,
  // and guarantees the redirect_uri in the authorization URL exactly matches the
  // one used in the token exchange (no GOOGLE_REDIRECT_URI env var needed).
  const serverOrigin = `${req.protocol}://${req.get("host")}`;
  const redirectUri = `${serverOrigin}/auth/callback/${provider}`;

  // One-time state token: CSRF protection + native session polling key
  const stateToken = crypto.randomUUID();

  // Web redirect flow: client sends ?flow=redirect when it wants the callback
  // to redirect back to the app instead of serving the popup close HTML.
  // The flag is encoded into the OAuth state parameter as a "r:" prefix so
  // it survives the round-trip through the provider without an extra DB lookup.
  const isRedirectFlow = req.query.flow === "redirect";
  const stateValue = isRedirectFlow ? `r:${stateToken}` : stateToken;

  // Google OAuth 2.0 URL Construct
  if (provider === "google") {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      // Return Sandbox Mode URL when real configuration is absent
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
    return res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, stateToken });
  }

  // Facebook OAuth 2.0 URL Construct
  if (provider === "facebook") {
    const clientId = process.env.FACEBOOK_CLIENT_ID;
    const clientSecret = process.env.FACEBOOK_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
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
  if (provider === "apple") {
    const clientId = process.env.APPLE_CLIENT_ID;
    const privateKey = process.env.APPLE_PRIVATE_KEY;
    const teamId = process.env.APPLE_TEAM_ID;
    const keyId = process.env.APPLE_KEY_ID;

    if (!clientId || !privateKey || !teamId || !keyId) {
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
      state: stateToken,
    });
    return res.json({ url: `https://appleid.apple.com/auth/authorize?${params}`, stateToken });
  }

  return res.status(400).json({ error: "Unsupported OAuth provider requested." });
});

// Developer Sandbox Login page
app.get("/auth/callback/sandbox", catchAsync(async (req, res) => {
  const provider = (req.query.provider as string || "Google");
  const name = (req.query.name as string || "OAuth Student");
  const email = (req.query.email as string || "student@comed.uobaghdad.edu.iq");

  // Parse state token and redirect-flow flag (same "r:" convention as real callback)
  const rawSandboxState = req.query.state as string | undefined;
  const isSandboxRedirectFlow = typeof rawSandboxState === "string" && rawSandboxState.startsWith("r:");
  const sandboxStateToken = isSandboxRedirectFlow && rawSandboxState
    ? rawSandboxState.slice(2)
    : rawSandboxState;

  try {
    // Apply the same domain restriction and role policy as real OAuth.
    // Throws OAUTH_DOMAIN_REJECTED for non-institutional emails.
    const user = await OAuthService.verifyAndUpsertOAuthUser({ email, name });

    const token = setCookieToken(res, user.id, user.email);

    // Store pending session for native Capacitor polling
    if (sandboxStateToken) {
      pendingOAuthSessions.set(sandboxStateToken, {
        token,
        userId: user.id,
        email: user.email,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
    }

    // Redirect flow: cookie is in first-party context, redirect back to app.
    if (isSandboxRedirectFlow) {
      return res.redirect("/?oauth_done=1");
    }

    // Auto-closing success page — no user action required.
    // Sends OAUTH_AUTH_SUCCESS to the opener (popup path) then closes.
    // On native Capacitor, window.opener is null; the polling path handles
    // session completion via pendingOAuthSessions instead.
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
    <p>Welcome, <strong>${user.name}</strong>. Returning to the app…</p>
    <p class="closing">This window will close automatically.</p>
  </div>
  <script>
    (function () {
      var payload = {
        type: 'OAUTH_AUTH_SUCCESS',
        userId: '${user.id}',
        email: '${user.email}',
        token: '${token}'
      };
      // Popup path: send to parent and close this window
      if (window.opener && !window.opener.closed) {
        try { window.opener.postMessage(payload, '*'); } catch(e){}
        setTimeout(function(){ window.close(); }, 400);
      } else {
        // Fallback (e.g. mobile redirect flow): navigate back to app root.
        // The polling mechanism in the app will pick up the session token.
        window.location.replace('/');
      }
    })();
  </script>
</body>
</html>`);
  } catch (error: any) {
    if ((error as any)?.code === "OAUTH_DOMAIN_REJECTED") {
      return res.status(403).send(OAuthService.buildDomainRejectionPage(isSandboxRedirectFlow));
    }
    console.error("Sandbox authentication failure:", error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
    return res.status(500).send(`<h3>Sandbox Auth Fault</h3><p>${error.message || error}</p>`);
  }
}));

// ── Apple Sign-In POST callback (response_mode: form_post) ──────────────────
// Apple POSTs the authorization code to this endpoint when the user approves.
// The `user` field (JSON string) is only included on the FIRST authorization.
app.post("/auth/callback/apple", catchAsync(async (req, res) => {
  const code       = req.body.code  as string | undefined;
  const errorParam = req.body.error || req.body.error_description;

  // User cancelled or Apple returned an error — close the popup silently
  if (errorParam || !code) {
    return res.send(`<!DOCTYPE html><html><body><script>
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: 'OAUTH_CANCELLED' }, '*');
        }
      } catch (e) {}
      window.close();
    </script></body></html>`);
  }

  try {
    // ── 1. Extract name from the one-time `user` payload ────────────────────
    let name = "Apple Student";
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
      throw new Error("Apple Sign-In server configuration is incomplete (missing APPLE_* env vars).");
    }

    const pKey = privateKeyRaw.includes("-----BEGIN PRIVATE KEY-----")
      ? privateKeyRaw
      : Buffer.from(privateKeyRaw, "base64").toString("utf-8");

    const clientSecret = jwt.sign({}, pKey, {
      algorithm : "ES256",
      expiresIn : "60m",
      audience  : "https://appleid.apple.com",
      issuer    : teamId,
      subject   : clientId,
      keyid     : keyId,
    });

    // ── 3. Exchange authorization code for Apple tokens ──────────────────────
    const redirectUri = `${req.protocol}://${req.get("host")}/auth/callback/apple`;
    const tokenResponse = await fetch("https://appleid.apple.com/auth/token", {
      method  : "POST",
      headers : { "Content-Type": "application/x-www-form-urlencoded" },
      body    : new URLSearchParams({
        client_id     : clientId,
        client_secret : clientSecret,
        code,
        grant_type    : "authorization_code",
        redirect_uri  : redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text();
      throw new Error(`Apple token exchange failed: ${errBody}`);
    }

    const tokenData    = await tokenResponse.json() as any;
    const decodedToken = jwt.decode(tokenData.id_token) as any;

    // Apple hides email when user picks "Hide My Email" — fall back to sub-based address
    const email  = decodedToken?.email
      ?? `apple.${(decodedToken?.sub as string ?? "user").replace(/[^a-z0-9]/gi, "")}@comed.uobaghdad.edu.iq`;
    const avatar = "";

    // ── 4. Domain gate + find-or-create user ────────────────────────────────
    const user  = await OAuthService.verifyAndUpsertOAuthUser({ email, name, avatar });
    const token = setCookieToken(res, user.id, user.email);

    return res.send(`<!DOCTYPE html><html><body><script>
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
          { type: 'OAUTH_AUTH_SUCCESS', userId: '${user.id}', email: '${user.email}', token: '${token}' },
          '*'
        );
        window.close();
      } else {
        window.location.href = '/';
      }
    </script></body></html>`);

  } catch (error: any) {
    if ((error as any)?.code === "OAUTH_DOMAIN_REJECTED") {
      return res.status(403).send(OAuthService.buildDomainRejectionPage());
    }
    logger.error("Apple OAuth POST callback error", (error instanceof Error ? error.message : String(error)).substring(0, 120));
    return res.status(500).send(`<h3>Apple Sign-In Error</h3><p>Authentication could not be completed.</p>
      <button onclick="window.close()">Close</button>`);
  }
}));

// OAuth Callback Route for real providers
app.get(["/auth/callback/:provider", "/auth/callback/:provider/"], catchAsync(async (req, res) => {
  const provider = (req.params.provider || "").toLowerCase();
  const code = req.query.code as string;
  const errorParam = req.query.error || req.query.error_description;

  // Parse the redirect-flow flag encoded in the state parameter by the client.
  // Web (non-native) clients prefix the stateToken with "r:" to signal that
  // the callback should redirect back to the app rather than serving popup HTML.
  const rawState = req.query.state as string | undefined;
  const isRedirectFlow = typeof rawState === "string" && rawState.startsWith("r:");
  // Clean stateToken (strip the prefix so it matches what the client stored)
  const stateToken = isRedirectFlow && rawState ? rawState.slice(2) : rawState;

  if (errorParam) {
    if (isRedirectFlow) {
      // Redirect back to the app with the error encoded in the query string.
      // App.tsx reads this on startup and surfaces a user-friendly message.
      return res.redirect(`/?oauth_error=${encodeURIComponent(String(errorParam))}`);
    }
    return res.status(400).send(`
      <h3>OAuth Error Event</h3>
      <p>Error returned from ${provider}: ${errorParam}</p>
      <button onclick="window.close()">Close Window</button>
    `);
  }

  if (!code) {
    if (isRedirectFlow) {
      return res.redirect(`/?oauth_error=${encodeURIComponent("Authorization code missing")}`);
    }
    return res.status(400).send(`<h3>Authorization Missing</h3><p>OAuth exchange did not provide a verification code.</p>`);
  }

  try {
    let email = "";
    let name = "";
    let avatar = "";

    // 1. Google OAuth code exchange
    if (provider === "google") {
      const tokenUrl = "https://oauth2.googleapis.com/token";
      // Always derive from the request host — matches the redirect_uri sent during authorization
      const redirectUri = `${req.protocol}://${req.get("host")}/auth/callback/google`;

      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID || "",
          client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
          redirect_uri: redirectUri,
          grant_type: "authorization_code"
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google code exchange failed: ${errorText}`);
      }

      const tokenData = await response.json();
      const accessToken = tokenData.access_token;

      // Extract details from Google UserInfo
      const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!userInfoResponse.ok) {
        throw new Error("Failed to retrieve user info profile from Google.");
      }

      const googleProfile = await userInfoResponse.json();
      email = googleProfile.email;
      name = googleProfile.name || googleProfile.given_name || email.split("@")[0];
      avatar = googleProfile.picture || "";
    }

    // 2. Facebook Login code exchange
    else if (provider === "facebook") {
      const tokenUrl = "https://graph.facebook.com/v12.0/oauth/access_token";
      const redirectUri = `${req.protocol}://${req.get("host")}/auth/callback/facebook`;

      const params = new URLSearchParams({
        code,
        client_id: process.env.FACEBOOK_CLIENT_ID || "",
        client_secret: process.env.FACEBOOK_CLIENT_SECRET || "",
        redirect_uri: redirectUri
      });

      const response = await fetch(`${tokenUrl}?${params.toString()}`);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Facebook code exchange failed: ${errorText}`);
      }

      const tokenData = await response.json();
      const accessToken = tokenData.access_token;

      // Retrieve user node details
      const profileResponse = await fetch(`https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${accessToken}`);
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
      const redirectUri = `${req.protocol}://${req.get("host")}/auth/callback/apple`;

      // Apple Client Secret JWT Generator helper
      let clientSecret = "";
      const privateKeyDecoded = process.env.APPLE_PRIVATE_KEY;
      const teamId = process.env.APPLE_TEAM_ID;
      const clientId = process.env.APPLE_CLIENT_ID;
      const keyId = process.env.APPLE_KEY_ID;

      if (privateKeyDecoded && teamId && clientId && keyId) {
        const pKey = privateKeyDecoded.includes("-----BEGIN PRIVATE KEY-----")
          ? privateKeyDecoded
          : Buffer.from(privateKeyDecoded, "base64").toString("utf-8");

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

      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Apple code exchange failed: ${errorText}`);
      }

      const tokenData = await response.json();
      const decodedToken = jwt.decode(tokenData.id_token) as any;

      email = decodedToken?.email || `apple_user_${decodedToken?.sub}@apple.uob.edu.iq`;
      // Apple only returns user info once during initial authorization
      name = "Apple Student"; 
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
    const user = await OAuthService.verifyAndUpsertOAuthUser({ email, name, avatar });

    const token = setCookieToken(res, user.id, user.email);

    // Store session for native Capacitor polling.
    // stateToken was already parsed/cleaned near the top of this handler.
    if (stateToken) {
      pendingOAuthSessions.set(stateToken, {
        token,
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
      return res.redirect("/?oauth_done=1");
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
            }
            .spinner {
              width: 36px; height: 36px; border: 3px solid #E2E8F0;
              border-top-color: #1E2D4A; border-radius: 50%;
              animation: spin 0.8s linear infinite; margin: 0 auto 1.25rem;
            }
            @keyframes spin { to { transform: rotate(360deg); } }
            .title { font-size: 1rem; font-weight: 600; color: #1E2D4A; }
            .sub   { font-size: 0.8125rem; color: #64748B; margin-top: 0.375rem; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="spinner"></div>
            <p class="title">Signing you in…</p>
            <p class="sub">Returning to the app automatically.</p>
          </div>
          <script>
            (function () {
              var payload = {
                type: 'OAUTH_AUTH_SUCCESS',
                userId: '${user.id}',
                email: '${user.email}',
                token: '${token}'
              };

              // Popup path: notify the parent app window when opener is
              // available (Chrome, Firefox, non-ITP Safari on desktop).
              if (window.opener && !window.opener.closed) {
                try { window.opener.postMessage(payload, '*'); } catch (e) {}
              }

              // ── Unconditional self-close ──────────────────────────────────
              // window.close() is allowed for any window originally opened by
              // window.open() — even on Safari ITP where window.opener is
              // nullified after the popup navigates through accounts.google.com.
              // The polling fallback in the app (pendingOAuthSessions) handles
              // the session regardless of whether postMessage was delivered.
              window.close();

              // Safety net: if close() was blocked (rare, e.g. a window that
              // wasn't opened by script), show a manual close prompt instead
              // of navigating away. Triggered 800 ms after close() to give it
              // time to take effect; document.hidden = true means it already
              // closed successfully.
              setTimeout(function () {
                if (!document.hidden) {
                  document.body.innerHTML =
                    '<div style="font-family:-apple-system,sans-serif;text-align:center;padding:3rem 2rem;color:#1E2D4A">' +
                    '<p style="font-size:1.1rem;font-weight:600;margin-bottom:.5rem">Signed in successfully</p>' +
                    '<p style="color:#64748B;font-size:.875rem">You can close this window and return to the app.</p>' +
                    '</div>';
                }
              }, 800);
            })();
          </script>
        </body>
      </html>
    `);

  } catch (error: any) {
    // Domain restriction violation — render styled denial page and notify parent
    if ((error as any)?.code === "OAUTH_DOMAIN_REJECTED") {
      // Pass redirectOnClose=true so the page navigates to "/" instead of
      // calling window.close() — which is blocked when the callback IS the
      // main window (redirect flow) rather than a script-opened popup.
      return res.status(403).send(OAuthService.buildDomainRejectionPage(isRedirectFlow));
    }
    console.error(`OAuth verification failure [${provider}]:`, error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
    return res.status(500).send(`
      <h3>Verification Failure</h3>
      <p>Error linking account of ${provider}: ${error.message || error}</p>
      <button onclick="window.close()">Close and Try Again</button>
    `);
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
    // Passes institutional domain members and the developer whitelist address.
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
      const token = setCookieToken(res, validatedUser.id, validatedUser.email);
      authMonitor.loginSuccess(validatedUser.id, req.ip);
      const fullData = await UserService.getFullUserData(validatedUser.id);
      return res.json({ success: true, token, ...fullData });
    } catch (authError: any) {
      authMonitor.loginFailed(cleanEmail.substring(0, 3) + "***", req.ip, "invalid_credentials");
      return res.status(401).json({ error: "Invalid email or password." });
    }
  } catch (error) {
    logger.error("AUTH", "Login route unexpected error", { ip: req.ip });
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// Peer-Student Registration — creates a new account
app.post("/api/auth/register", catchAsync(async (req, res) => {
  try {
    const { email, password, name, studentGroup } = req.body;
    if (!email || typeof email !== "string" || !password || typeof password !== "string") {
      return res.status(400).json({ error: "Valid email and password strings are required." });
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!validateEmail(cleanEmail)) {
      return res.status(400).json({ error: "Invalid academic email format.", field: "email" });
    }

    // ── Access gate (mirrors OAuth policy — single source of truth) ──────────
    // Passes institutional domain members and the developer whitelist address.
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

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters long.", field: "password" });
    }
    if (password.length > 128) {
      return res.status(400).json({ error: "Password must be under 128 characters.", field: "password" });
    }

    if (studentGroup && !["A", "B", "C", "D"].includes(studentGroup)) {
      return res.status(400).json({ error: "Invalid academic group. Allowed values: A, B, C, D", field: "studentGroup" });
    }

    const existing = await UserService.findByEmail(cleanEmail);
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists.", field: "email" });
    }

    // ── Role assignment ───────────────────────────────────────────────────────
    // Primary owner and developer whitelist both receive "owner" (idempotent
    // with the OAuth policy in oauthService.ts — single source of truth).
    // Every other permitted email starts as a regular "user".
    const assignedRole: "owner" | "user" =
      cleanEmail === OAuthService.PRIMARY_OWNER_EMAIL ||
      cleanEmail === OAuthService.DEVELOPER_EMAIL
        ? "owner"
        : "user";

    try {
      const freshUser = await AuthService.registerUser({
        email: cleanEmail,
        password: password,
        name: name.trim(),
        role: assignedRole,
        studentGroup: studentGroup
      });

      const token = setCookieToken(res, freshUser.id, freshUser.email);
      authMonitor.registrationSuccess(freshUser.id, req.ip);
      const fullData = await UserService.getFullUserData(freshUser.id);
      return res.json({ success: true, token, ...fullData });
    } catch (regError: any) {
      authMonitor.registrationFailed(req.ip, regError.message || "unknown");
      return res.status(400).json({ error: regError.message || "Registration failed." });
    }
  } catch (error) {
    logger.error("AUTH", "Register route unexpected error", { ip: req.ip });
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// Revoke security session and wipe httpOnly authenticated session cookies
app.post("/api/auth/logout", catchAsync(async (req, res) => {
  try {
    res.clearCookie("auth_token", {
      httpOnly: true,
      secure: true,
      sameSite: "none"
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
    if (req.user.email?.toLowerCase().trim() === "ss70eng1@gmail.com") {
      return res.status(403).json({ error: "Forbidden: Primary Academic Owner cannot be deleted." });
    }
    const success = await UserService.deleteUser(userId);
    if (!success) {
      return res.status(404).json({ error: "User record not found in central database." });
    }
    res.clearCookie("auth_token", {
      httpOnly: true,
      secure: true,
      sameSite: "none"
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
    const token = setCookieToken(res, authUser.id, authUser.email);
    return res.json({ success: true, token, user: authUser });
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
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins expiration

    // Save token coordinates to the student's node
    await UserService.updateUser({
      id: user.id,
      reset_token: token,
      reset_token_expires: expires
    });

    // Formulate the recovery link
    const clientOrigin = req.get("origin") || `${req.protocol}://${req.get("host")}`;
    const resetLink = `${clientOrigin}/reset-password?token=${token}&email=${encodeURIComponent(cleanEmail)}`;

    
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
  try {
    const { email, token, password } = req.body;
    if (!email || typeof email !== "string" || !token || typeof token !== "string" || !password || typeof password !== "string") {
      return res.status(400).json({ error: "Missing or invalid parameters: email, authorization token, or new credentials." });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters long." });
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!validateEmail(cleanEmail)) {
      return res.status(400).json({ error: "Invalid academic email format." });
    }

    const user = await UserService.findByEmail(cleanEmail);

    if (!user) {
      return res.status(400).json({ error: "No student matching that academic address exists in this node." });
    }

    if (!user.reset_token || user.reset_token !== token) {
      return res.status(400).json({ error: "The provided reset token is invalid or has already been used." });
    }

    // Check expiration securely
    const expiresDate = user.reset_token_expires ? new Date(user.reset_token_expires) : null;
    if (!expiresDate || expiresDate.getTime() < Date.now()) {
      return res.status(400).json({ error: "The reset authorization token has expired (15-minute time limit)." });
    }

    // Hash the new password using central AuthService
    const password_hash = await AuthService.hashPassword(password);

    // Update the record: change password and wipe the token for single-use guarantee
    await UserService.updateUser({
      id: user.id,
      password_hash,
      reset_token: "",
      reset_token_expires: ""
    });


    return res.json({ success: true, message: "Your academic password has been successfully updated." });
  } catch (error: any) {
    console.error("Reset password API fault:", error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// Update peer profile card details
app.post("/api/auth/update-profile", requireUser, catchAsync(async (req, res) => {
  try {
    const { userId, name, email, avatar, studentGroup } = req.body;
    if (!userId) return res.status(400).json({ error: "User context ID is required." });

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
      if (typeof avatar !== "string" || avatar.length > 500) {
        return res.status(400).json({ error: "Avatar URL must be a string under 500 characters." });
      }
    }

    let cleanEmail: string | undefined = undefined;
    if (email !== undefined && email !== null) {
      if (typeof email !== "string" || !validateEmail(email)) {
        return res.status(400).json({ error: "Invalid email format." });
      }
      cleanEmail = email.trim().toLowerCase();
      // Block changing email to the hardcoded owner email
      const OWNER_EMAIL = "ss70eng1@gmail.com";
      if (cleanEmail === OWNER_EMAIL && authUser.email?.toLowerCase().trim() !== OWNER_EMAIL) {
        return res.status(403).json({ error: "This email address cannot be used." });
      }
      if (cleanEmail !== user.email) {
        const existing = await UserService.findByEmail(cleanEmail);
        if (existing) {
          return res.status(400).json({ error: "Email is already registered by another student." });
        }
      }
    }

    await UserService.updateUser({
      id: userId,
      name: name?.trim(),
      email: cleanEmail,
      avatar,
      studentGroup
    });

    const updated = await UserService.findById(userId);
    res.json({ success: true, user: updated });

    // Broadcast profile change so every connected client sees it immediately
    if (updated) {
      const { passwordHash: _ph, ...safeUpdated } = updated as any;
      io.emit("userUpdated", safeUpdated);
      io.emit("roster_updated");
    }
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

    const authUser = (req as any).user;
    if (authUser.id !== userId && authUser.role !== "admin" && authUser.role !== "owner") {
      return res.status(403).json({ error: "Access denied. You can only synchronize your own student node." });
    }

    let existing = await UserService.findById(userId);

    if (!existing) {
      // Create user context immediately in SQL relational database
      const safePassword = user?.password || "123456";
      const password_hash = await AuthService.hashPassword(safePassword);
      
      const parsedPoints = Number(user?.totalPoints || 10);
      const safePoints = (!isNaN(parsedPoints) && parsedPoints >= 0) ? parsedPoints : 10;

      existing = await UserService.createUser({
        id: userId,
        email: (user?.email || `student_${Date.now()}@uob.edu.iq`).toLowerCase().trim(),
        password_hash,
        role: user?.isAdmin ? "admin" : "user",
        name: user?.name || "Student 99",
        avatar: user?.avatar,
        totalPoints: safePoints,
        level: user?.level || "Rising (Resident) 🔬",
        levelBadge: user?.levelBadge || "Lvl 1",
        streakDays: user?.streakDays || 3,
        totalTimeSpent: user?.totalTimeSpent || 0,
        lastActive: new Date().toISOString()
      });
    } else if (user) {
// Update metadata metrics safely
      await UserService.updateUser({
        id: userId,
        name: user.name,
        email: user.email ? user.email.trim().toLowerCase() : undefined,
        avatar: user.avatar,
        
        level: user.level,
        levelBadge: user.levelBadge,
        streakDays: user.streakDays,
        totalTimeSpent: Math.max(existing.totalTimeSpent || 0, user.totalTimeSpent || 0),
        lastActive: new Date().toISOString()
      });
    }

    const prismaClient = getPrisma();
    const ops = [];

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
      const logPoints = Number(l.points || 0);
      if (authUser.role !== "admin" && authUser.role !== "owner" && (logPoints > 100 || logPoints < -100)) continue;
      const logId = l.id || `log_${Date.now()}_${Math.random()}`;
      ops.push(prismaClient.pointsLog.upsert({
        where: { id: logId },
        update: { points: logPoints, reason: l.reason, createdAt: l.createdAt ? new Date(l.createdAt) : new Date() },
        create: { id: logId, userId, points: logPoints, reason: l.reason, createdAt: l.createdAt ? new Date(l.createdAt) : new Date() }
      }));
    }

    // Save/Sync Custom planner events (personal only — never overwrite global/admin events)
    for (const e of calendarEvents) {
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

      const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);
      ops.push(prismaClient.calendarEvent.upsert({
        where: { id: e.id },
        update: { title: e.title, eventType: (e.type || "other").toUpperCase(), startDateTime, endDateTime, isCompleted: !!e.completed },
        create: { id: e.id, userId, title: e.title, eventType: (e.type || "other").toUpperCase(), startDateTime, endDateTime, isCompleted: !!e.completed }
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
    const calculatedPoints = agg._sum.points || 10;
    
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

    res.json({
      ...syncData,
      calendarEvents: syncData.calendarEvents,
      globalCalendarEvents: globalEvents.map(event => ({
        ...event,
        targetGroups: typeof event.targetGroups === "string" ? event.targetGroups.split(",").filter(Boolean) : (event.targetGroups || [])
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
    const prismaClient = getPrisma();
        
    const authUser = (req as any).user;

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
      
      // Enforce authorization: Students can only reconcile their own offline progress
      if (userId !== authUser.id && authUser.role !== "admin" && authUser.role !== "owner") {
        return res.status(403).json({ error: "Access denied. You cannot reconcile offline progress for another student." });
      }

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
    const list = await UserService.listAllUsers(false);
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

    const resolvedPassword = password || "123456";
    if (resolvedPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters long." });
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

    io.emit("roster_updated");
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
    if (user?.email?.toLowerCase().trim() === "ss70eng1@gmail.com") {
      auditLog(req, "DELETE_USER", userIdToDelete, "Denied - Primary Owner Protection");
      return res.status(403).json({ error: "Forbidden: Primary Academic Owner cannot be deleted." });
    }
    const deleted = await UserService.deleteUser(userIdToDelete);
    if (deleted) {
      io.emit("roster_updated");
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "User record doesn't exist." });
    }
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// TOGGLE Admin role for a student
// Role hierarchy enforced here:
//   • Primary Owner (PRIMARY_OWNER_EMAIL / DEVELOPER_EMAIL): can toggle any user except protected accounts.
//   • Regular Owner: can only toggle between user ↔ admin. Cannot touch another Owner's role.
//   • Self-change is blocked for all callers.
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

    // Protect Primary Owner and Developer — their roles can never be modified by anyone
    const targetEmail = (targetUser.email ?? "").toLowerCase().trim();
    if (targetEmail === OAuthService.PRIMARY_OWNER_EMAIL || targetEmail === OAuthService.DEVELOPER_EMAIL) {
      auditLog(req, "TOGGLE_ADMIN", userIdToToggle, "Denied - Protected account");
      return res.status(403).json({ error: "Forbidden: This account's role cannot be modified." });
    }

    const callerEmail = (caller?.email ?? "").toLowerCase().trim();
    const callerIsPrimaryOwner =
      callerEmail === OAuthService.PRIMARY_OWNER_EMAIL ||
      callerEmail === OAuthService.DEVELOPER_EMAIL;

    // Regular owners cannot touch another owner's role — only the Primary Owner can
    if (!callerIsPrimaryOwner && targetUser.role === "owner") {
      auditLog(req, "TOGGLE_ADMIN", userIdToToggle, "Denied - Regular owner cannot modify another owner");
      return res.status(403).json({ error: "Forbidden: You cannot modify another Owner's role." });
    }

    const nextRole = targetUser.role === "admin" ? "user" : "admin";
    await UserService.updateUser({ id: userIdToToggle, role: nextRole });
    io.emit("roster_updated");
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
    // Protect Primary Owner and Developer — they can never be banned
    {
      const e = user?.email?.toLowerCase().trim() ?? "";
      if (e === OAuthService.PRIMARY_OWNER_EMAIL || e === OAuthService.DEVELOPER_EMAIL) {
        auditLog(req, "TOGGLE_BAN", userIdToToggle, "Denied - Protected account");
        return res.status(403).json({ error: "Forbidden: This account cannot be banned." });
      }
    }
    if (user) {
      const currentStatus = user.accountStatus || "active";
      const nextStatus = currentStatus === "banned" ? "active" : "banned";
      await UserService.updateUser({ id: userIdToToggle, accountStatus: nextStatus });
      res.json({ success: true, accountStatus: nextStatus });
    } else {
      res.status(404).json({ error: "Record not found." });
    }
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

// PATCH role update API — enforces role hierarchy
//
// Primary Owner (PRIMARY_OWNER_EMAIL / DEVELOPER_EMAIL):
//   • Can manage every user: promote/demote Owners, Admins, and Users.
//   • Cannot change their own role (self-change blocked for all callers).
//
// Regular Owner (role === "owner" but not a protected email):
//   • Can promote/demote Admins and Users only.
//   • Cannot touch another Owner's role.
//   • Cannot promote anyone to the Owner role.
//   • Cannot change their own role.
//
// Admin / User:
//   • Blocked entirely by requireOwner middleware.
app.patch("/api/users/role", requireOwner, catchAsync(async (req, res) => {
  try {
    const { userId, role } = req.body;
    if (!userId || !role) {
      return res.status(400).json({ error: "userId and role are required." });
    }

    if (role !== "user" && role !== "admin" && role !== "owner") {
      return res.status(400).json({ error: "Invalid role value. Must be 'user', 'admin', or 'owner'." });
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

    const callerEmail = (caller?.email ?? "").toLowerCase().trim();
    const targetEmail = (targetUser.email ?? "").toLowerCase().trim();

    // Determine whether the caller is a Primary Owner (highest privilege)
    const callerIsPrimaryOwner =
      callerEmail === OAuthService.PRIMARY_OWNER_EMAIL ||
      callerEmail === OAuthService.DEVELOPER_EMAIL;

    // Nobody can modify a Primary Owner / Developer account — ever
    if (
      targetEmail === OAuthService.PRIMARY_OWNER_EMAIL ||
      targetEmail === OAuthService.DEVELOPER_EMAIL
    ) {
      return res.status(403).json({ error: "Forbidden: This account's role cannot be modified." });
    }

    // Regular Owner restrictions (non-Primary Owner callers)
    if (!callerIsPrimaryOwner) {
      // Cannot touch another Owner's role
      if (targetUser.role === "owner") {
        return res.status(403).json({ error: "Forbidden: You cannot modify another Owner's role." });
      }
      // Cannot promote anyone to Owner
      if (role === "owner") {
        return res.status(403).json({ error: "Forbidden: You cannot promote users to the Owner role." });
      }
    }

    await UserService.updateUser({ id: userId, role });
    io.emit("roster_updated");
    res.json({ success: true, userId, role });
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
    io.emit("motto_updated");
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
    io.emit("motto_updated");
    res.json({ motto });
  } catch (error) {
    console.error("Update motto error:", error instanceof Error ? error.message.substring(0, 50) : "Sanitized");
    res.status(500).json({ error: "Internal Server Error" });
  }
}));

app.delete("/api/mottos/:id", requireOwner, catchAsync(async (req, res) => {
  try {
    await prisma.dailyMotto.delete({ where: { id: req.params.id } });
    io.emit("motto_updated");
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
  // Start DB initialization in the background so it doesn't block the server from listening
  verifyDatabaseHealth().then(() => initializeSystem()).catch((err: unknown) => {
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
